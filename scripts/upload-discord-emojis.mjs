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
   - grades: assets/discord-emoji/g_*.png, the site's score-card grade
     letters (our own artwork: Space Grotesk with the card's gradients)
   - mods: assets/discord-emoji/m_*.png, osu!lazer's mod glyphs from
     ppy/osu-resources (CC BY-NC 4.0, © ppy Pty Ltd) on a hexagon in the
     mod type's colour, as the score card draws them
   - rulesets: this repo's assets/icons/mode-*.svg, recoloured pink
   The grade and mod PNGs are drawn once in the browser (see
   assets/discord-emoji/README.md) and uploaded as-is. They replaced the
   earlier osu-web (AGPL) grade and mod images.
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


// name -> osu-web legacy PNG (downloaded, uploaded as-is)
// emoji name -> assets/discord-emoji/<name>.png
const GRADES = [
    ['g_ss', 'X'], ['g_ssh', 'XH'], ['g_s', 'S'], ['g_sh', 'SH'],
    ['g_a', 'A'], ['g_b', 'B'], ['g_c', 'C'], ['g_d', 'D'],
];

// emoji name -> local ruleset svg basename
const MODES = [
    ['mode_osu', 'mode-standard'], ['mode_taiko', 'mode-taiko'],
    ['mode_catch', 'mode-catch'], ['mode_mania', 'mode-mania'],
];

// emoji name -> osu-web mod-badge svg basename (the score-embed-relevant set)
// emoji name (m_<acronym>) -> assets/discord-emoji/<name>.png
const MODS = ['NM', 'NF', 'EZ', 'HT', 'DC', 'HD', 'HR', 'SD', 'PF', 'DT', 'NC', 'FL', 'BL', 'FI',
    'SO', 'RX', 'AP', 'MR', 'RD', 'CL', '4K', '5K', '6K', '7K', '8K', '9K'].map((a) => [`m_${a.toLowerCase()}`, a]);

const localPng = (name) => readFile(new URL(`../assets/discord-emoji/${name}.png`, import.meta.url));

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
            for (const [name] of GRADES) await put(name, await localPng(name));
        }
        if (!only || only === 'modes') {
            for (const [name, basename] of MODES) await put(name, await pngForMode(basename));
        }
        if (!only || only === 'mods') {
            for (const [name] of MODS) {
                try { await put(name, await localPng(name)); }
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
    X: '${tag('g_ss')}', SS: '${tag('g_ss')}',
    XH: '${tag('g_ssh')}', SSH: '${tag('g_ssh')}',
    S: '${tag('g_s')}', SH: '${tag('g_sh')}',
    A: '${tag('g_a')}', B: '${tag('g_b')}', C: '${tag('g_c')}', D: '${tag('g_d')}', F: '',
};`);
    if (!only || only === 'modes') console.log(`const MODE_EMOJI = {\n${line([['osu', 'mode_osu'], ['taiko', 'mode_taiko'], ['fruits', 'mode_catch'], ['mania', 'mode_mania']])}\n};`);
    if (!only || only === 'mods') console.log(`const MOD_EMOJI = {\n${line(MODS.map(([n, a]) => [/^\d/.test(a) ? `'${a}'` : a, n]))}\n};`);
}

main().catch(e => { console.error(e); process.exit(1); });
