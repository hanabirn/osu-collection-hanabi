#!/usr/bin/env node
/* Catalog crawler for GitHub Actions (.github/workflows/catalog-crawl.yml).
 *
 * Why not a Worker cron: every run parses and rewrites the whole catalog
 * (~26 MB of JSON, ~0.5 s of CPU, ~0.8 s with the lean copy for the
 * browser). The free Workers plan allows 10 ms of CPU per invocation, Cron
 * Triggers included, so most runs were killed before saving anything. A
 * GitHub-hosted runner has no such limit and costs nothing for a public
 * repo; it also calls osu! from its own IP instead of Cloudflare's shared
 * egress, which is where the crawler's 429s came from.
 *
 * One run:
 *   1. download catalog:all and catalog-state from the osu-catalog R2
 *      bucket (wrangler r2 object get),
 *   2. run the unchanged crawl logic (netlify/functions/_catalog-crawl-core.js)
 *      against a file-backed store in a temp dir,
 *   3. upload what it wrote — catalog:all, catalog-state, and the
 *      browser-facing catalog:lean + catalog:meta the Worker serves
 *      (worker/catalog-data.js).
 *
 * Guards against wiping the live catalog: a missing or unreadable
 * catalog:all aborts the run (the crawler would otherwise start from an
 * empty dataset and upload a few hundred sets over 59k), and nothing is
 * uploaded if the dataset came back smaller than it went in — the crawler
 * only ever adds or updates sets.
 *
 * Env: CLOUDFLARE_API_TOKEN (R2 read/write) + CLOUDFLARE_ACCOUNT_ID for
 * wrangler, OSU_CLIENT_ID + OSU_CLIENT_SECRET for the osu! API.
 *
 *   node scripts/catalog-crawl.mjs           # against the real bucket
 *   node scripts/catalog-crawl.mjs --local   # against wrangler's local R2
 *                                              (for testing; osu! creds optional)
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { runCrawlBatch, DATASET_KEY, STATE_KEY } = require('../netlify/functions/_catalog-crawl-core.js');
const { LEAN_KEY, META_KEY } = require('../netlify/functions/_catalog-lean.js');

const BUCKET = 'osu-catalog';
const WRANGLER = 'wrangler@4.139.0';
/* The loop is capped at 40 search pages per run anyway (MAX_SEARCH_PAGES in
   the core, kept as a courtesy to the osu! API); this only needs to be long
   enough to reach it. */
const RUN_BUDGET_MS = 180000;

const LOCAL = process.argv.includes('--local');
const target = LOCAL ? '--local' : '--remote';

function fail(msg) {
    console.error(`::error::${msg}`);
    process.exit(1);
}

const required = LOCAL ? [] : ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'OSU_CLIENT_ID', 'OSU_CLIENT_SECRET'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) fail(`missing secrets: ${missing.join(', ')}`);

function wrangler(args) {
    return execFileSync('npx', ['--yes', WRANGLER, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        // npx is a .cmd shim on Windows, which execFile can only start through a shell.
        shell: process.platform === 'win32',
    });
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-crawl-'));
// R2 keys contain ':', which Windows filenames can't.
const fileFor = (key) => path.join(workDir, encodeURIComponent(key));

/* Returns false only when R2 says the key doesn't exist; any other failure
   (auth, network) throws, so it can never be mistaken for "empty". */
function download(key) {
    try {
        wrangler(['r2', 'object', 'get', `${BUCKET}/${key}`, target, '--file', fileFor(key)]);
        return true;
    } catch (err) {
        const out = `${err.stdout || ''}${err.stderr || ''}`;
        if (/does not exist|not found|NoSuchKey/i.test(out)) return false;
        throw new Error(`downloading ${key} failed: ${out.trim().split('\n').slice(-3).join(' | ')}`);
    }
}

function upload(key, contentType) {
    wrangler(['r2', 'object', 'put', `${BUCKET}/${key}`, target, '--file', fileFor(key), '--ct', contentType]);
}

/* Same get / set / setJSON surface as the Blobs and R2 stores the core
   normally receives (see _cf-store.js). */
function fileStore() {
    const written = new Set();
    const write = (key, buf) => {
        fs.writeFileSync(fileFor(key), buf);
        written.add(key);
    };
    return {
        written,
        async get(key, opts) {
            const file = fileFor(key);
            if (!fs.existsSync(file)) return null;
            const buf = fs.readFileSync(file);
            const type = opts?.type ?? 'text';
            if (type === 'json') return JSON.parse(buf.toString('utf8'));
            if (type === 'arrayBuffer') return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            return buf.toString('utf8');
        },
        async set(key, value) {
            let buf;
            if (value instanceof Blob) buf = Buffer.from(await value.arrayBuffer());
            else if (typeof value === 'string') buf = Buffer.from(value, 'utf8');
            else buf = Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
            write(key, buf);
        },
        async setJSON(key, value) {
            write(key, Buffer.from(JSON.stringify(value), 'utf8'));
        },
    };
}

async function datasetSize(store) {
    const { getJSONGz } = require('../netlify/functions/_blob-json.js');
    const data = await getJSONGz(store, DATASET_KEY);
    return Array.isArray(data) ? data.length : 0;
}

async function main() {
    console.log(`catalog crawl (${LOCAL ? 'local R2' : 'remote R2'}), work dir ${workDir}`);

    if (!download(DATASET_KEY)) fail(`${DATASET_KEY} not found in ${BUCKET} — refusing to start from an empty catalog`);
    download(STATE_KEY); // missing state just means a fresh cursor

    const store = fileStore();
    const before = await datasetSize(store);
    if (before === 0) fail(`${DATASET_KEY} downloaded but held no sets — refusing to overwrite it`);

    const result = await runCrawlBatch(RUN_BUDGET_MS, { store });
    console.log('crawl result:', JSON.stringify(result));

    const after = await datasetSize(store);
    if (after < before) fail(`dataset shrank from ${before} to ${after} sets — not uploading`);

    // Dataset first, then the state that points past it, then the derived copies.
    const order = [
        [DATASET_KEY, 'application/octet-stream'],
        [STATE_KEY, 'application/json'],
        [LEAN_KEY, 'application/octet-stream'],
        [META_KEY, 'application/json'],
    ];
    for (const [key, type] of order) {
        if (!store.written.has(key)) continue;
        upload(key, type);
        console.log(`uploaded ${key} (${fs.statSync(fileFor(key)).size} bytes)`);
    }

    const summary = [
        `### Catalog crawl`,
        `- sets: ${before} → ${after} (+${after - before})`,
        `- search pages: ${result.pages}, upserted: ${result.upserted}`,
        `- dataset write: ${result.writeOk ? 'ok' : 'FAILED'}, lean copy: ${result.leanOk ? 'ok' : 'FAILED'}`,
        `- error: ${result.error || 'none'}`,
    ].join('\n');
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');

    // A 429 part-way through is normal (what was found is saved, the next
    // run resumes from the cursor); a failed write is not.
    if (!result.writeOk || !result.leanOk) fail('a catalog write failed — see the result above');
}

main()
    .catch((err) => fail(err?.stack || String(err)))
    .finally(() => fs.rmSync(workDir, { recursive: true, force: true }));
