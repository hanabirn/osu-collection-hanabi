/* One-shot: upload osu! grade / ruleset / mod icons as this bot's
   *application emojis* (usable by the app in any server, no Nitro), so score
   embeds can show real badges instead of plain text.

     DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... node scripts/upload-discord-emojis.mjs

   Both values also read from a local .env. Idempotent: an emoji whose name
   already exists is left alone (pass --force to delete and re-upload).
   Prints JS maps to paste into netlify/functions/_discord-lib.js
   (GRADE_EMOJI / MODE_EMOJI / MOD_EMOJI) — application-emoji ids are stable
   once created.

   Sources:
   - grades: ppy/osu-web legacy score-rank PNGs (used as-is)
   - rulesets: this repo's assets/icons/mode-*.svg, recoloured pink
   - mods: ppy/osu-web badges/mods/mod-*.svg, composited onto a slate badge
   SVGs are rasterised to 128px PNG via `npx @resvg/resvg-js-cli` (no repo
   dependency added — it runs from the npm cache). */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);
const IS_WIN = process.platform === 'win32';
const NPX = IS_WIN ? 'npx.cmd' : 'npx';

async function loadDotEnv() {
    try {
        const txt = await readFile(new URL('../.env', import.meta.url), 'utf8');
        for (const line of txt.split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
            if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    } catch { /* no .env */ }
}

const OSUWEB = 'https://raw.githubusercontent.com/ppy/osu-web/master';

// name -> osu-web legacy PNG (downloaded, uploaded as-is)
const GRADES = [
    ['grade_ss', 'legacy-ranking-X.png'], ['grade_ssh', 'legacy-ranking-XH.png'],
    ['grade_s', 'legacy-ranking-S.png'], ['grade_sh', 'legacy-ranking-SH.png'],
    ['grade_a', 'legacy-ranking-A.png'], ['grade_b', 'legacy-ranking-B.png'],
    ['grade_c', 'legacy-ranking-C.png'], ['grade_d', 'legacy-ranking-D.png'],
];

// emoji name -> local ruleset svg basename
const MODES = [
    ['mode_osu', 'mode-standard'], ['mode_taiko', 'mode-taiko'],
    ['mode_catch', 'mode-catch'], ['mode_mania', 'mode-mania'],
];

// emoji name -> osu-web mod-badge svg basename (the score-embed-relevant set)
const MODS = [
    ['mod_nm', 'mod-no-mod'], ['mod_nf', 'mod-no-fail'], ['mod_ez', 'mod-easy'],
    ['mod_ht', 'mod-half-time'], ['mod_dc', 'mod-daycore'], ['mod_hd', 'mod-hidden'],
    ['mod_hr', 'mod-hard-rock'], ['mod_sd', 'mod-sudden-death'], ['mod_pf', 'mod-perfect'],
    ['mod_dt', 'mod-double-time'], ['mod_nc', 'mod-nightcore'], ['mod_fl', 'mod-flashlight'],
    ['mod_bl', 'mod-blinds'], ['mod_so', 'mod-spun-out'], ['mod_rx', 'mod-relax'],
    ['mod_ap', 'mod-autopilot'], ['mod_mr', 'mod-mirror'], ['mod_rd', 'mod-random'],
    ['mod_fi', 'mod-fade-in'], ['mod_cl', 'mod-classic'],
    ['mod_4k', 'mod-four-keys'], ['mod_5k', 'mod-five-keys'], ['mod_6k', 'mod-six-keys'],
    ['mod_7k', 'mod-seven-keys'], ['mod_8k', 'mod-eight-keys'], ['mod_9k', 'mod-nine-keys'],
];

let TMP;
async function rasterize(svg) {
    const inPath = join(TMP, 'in.svg');
    const outPath = join(TMP, 'out.png');
    await writeFile(inPath, svg);
    // shell:true so Windows can launch npx.cmd (spawn EINVAL otherwise); the
    // temp paths are shell-safe (no spaces/quotes).
    await run(NPX, ['--yes', '@resvg/resvg-js-cli', '--fit-width', '128', inPath, outPath], { maxBuffer: 16 << 20, shell: true, windowsHide: true });
    return readFile(outPath);
}

async function pngForMode(basename) {
    const svg = (await readFile(new URL(`../assets/icons/${basename}.svg`, import.meta.url), 'utf8'))
        .replace(/currentColor/g, '#ff66aa');
    return rasterize(svg);
}

async function pngForMod(basename) {
    const res = await fetch(`${OSUWEB}/public/images/badges/mods/${basename}.svg`);
    if (!res.ok) throw new Error(`${basename}: HTTP ${res.status}`);
    const inner = (await res.text()).replace(/^<\?xml[^>]*>\s*/, '');
    // The osu-web badge svgs are the 120x84 foreground glyph only; drop a
    // slate rounded-rect behind it so a white glyph stays visible on both
    // Discord themes.
    const composited = inner.replace(
        /(<svg[^>]*>)/,
        '$1<rect x="0" y="0" width="120" height="84" rx="18" fill="#3b4252"/>',
    );
    return rasterize(composited);
}

async function main() {
    await loadDotEnv();
    const appId = process.env.DISCORD_APP_ID;
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!appId || !botToken) {
        console.error('Missing DISCORD_APP_ID or DISCORD_BOT_TOKEN (env or .env).');
        process.exit(1);
    }
    const force = process.argv.includes('--force');
    const only = process.argv.find(a => ['grades', 'modes', 'mods'].includes(a));
    const auth = { Authorization: `Bot ${botToken}` };
    const base = `https://discord.com/api/v10/applications/${appId}/emojis`;

    TMP = await mkdtemp(join(tmpdir(), 'osu-emoji-'));

    const listRes = await fetch(base, { headers: auth });
    if (!listRes.ok) { console.error('list emojis failed:', listRes.status, await listRes.text()); process.exit(1); }
    const existing = new Map(((await listRes.json()).items || []).map(e => [e.name, e.id]));
    const result = {};

    async function put(name, pngBuf) {
        if (existing.has(name) && !force) { result[name] = existing.get(name); console.log(`= ${name}`); return; }
        if (existing.has(name) && force) await fetch(`${base}/${existing.get(name)}`, { method: 'DELETE', headers: auth });
        const res = await fetch(base, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, image: `data:image/png;base64,${pngBuf.toString('base64')}` }),
        });
        const body = await res.json();
        if (!res.ok) { console.error(`  ! ${name}: ${res.status}`, body); return; }
        result[name] = body.id;
        console.log(`+ ${name} -> ${body.id}`);
        await new Promise(r => setTimeout(r, 400));
    }

    try {
        if (!only || only === 'grades') {
            for (const [name, file] of GRADES) {
                const img = await fetch(`${OSUWEB}/resources/images/scores/${file}`);
                if (!img.ok) { console.error(`  ! ${file}: ${img.status}`); continue; }
                await put(name, Buffer.from(await img.arrayBuffer()));
            }
        }
        if (!only || only === 'modes') {
            for (const [name, basename] of MODES) await put(name, await pngForMode(basename));
        }
        if (!only || only === 'mods') {
            for (const [name, basename] of MODS) {
                try { await put(name, await pngForMod(basename)); }
                catch (e) { console.error(`  ! ${name}: ${e.message}`); }
            }
        }
    } finally {
        await rm(TMP, { recursive: true, force: true });
    }

    const tag = (n) => `<:${n}:${result[n] || '0'}>`;
    const line = (pairs) => pairs.map(([k, n]) => `    ${k}: '${tag(n)}',`).join('\n');
    console.log('\n--- paste into netlify/functions/_discord-lib.js ---\n');
    if (!only || only === 'grades') console.log(`const GRADE_EMOJI = {
    X: '${tag('grade_ss')}', SS: '${tag('grade_ss')}',
    XH: '${tag('grade_ssh')}', SSH: '${tag('grade_ssh')}',
    S: '${tag('grade_s')}', SH: '${tag('grade_sh')}',
    A: '${tag('grade_a')}', B: '${tag('grade_b')}', C: '${tag('grade_c')}', D: '${tag('grade_d')}', F: '',
};`);
    if (!only || only === 'modes') console.log(`const MODE_EMOJI = {\n${line([['osu', 'mode_osu'], ['taiko', 'mode_taiko'], ['fruits', 'mode_catch'], ['mania', 'mode_mania']])}\n};`);
    if (!only || only === 'mods') console.log(`const MOD_EMOJI = {\n${line(MODS.map(([n]) => [n.slice(4).toUpperCase(), n]))}\n};`);
}

main().catch(e => { console.error(e); process.exit(1); });
