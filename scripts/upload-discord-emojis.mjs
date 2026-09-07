/* One-shot: upload the osu! grade icons as this bot's *application emojis*
   (usable by the app in any server, no Nitro), so score embeds can show a
   real SS/S/A/... badge instead of plain text.

     DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... node scripts/upload-discord-emojis.mjs

   Both values also read from a local .env. Idempotent: an emoji whose name
   already exists is left alone (pass --force to delete and re-upload it).
   Prints a JS map to paste into netlify/functions/_discord-lib.js
   (GRADE_EMOJI) — application-emoji ids are stable once created.

   Source images: ppy/osu-web legacy score-rank PNGs (small, ~5-13 KB each,
   well under Discord's 256 KB app-emoji limit). */
import { readFile } from 'node:fs/promises';

async function loadDotEnv() {
    try {
        const txt = await readFile(new URL('../.env', import.meta.url), 'utf8');
        for (const line of txt.split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
            if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    } catch { /* no .env */ }
}

const RAW = 'https://raw.githubusercontent.com/ppy/osu-web/master/resources/images/scores';
// emoji name -> source file. `grade_ss` = gold SS (API rank X), `grade_ssh`
// = silver SS (XH); `grade_sh` = silver S (SH).
const EMOJI = [
    ['grade_ss', 'legacy-ranking-X.png'],
    ['grade_ssh', 'legacy-ranking-XH.png'],
    ['grade_s', 'legacy-ranking-S.png'],
    ['grade_sh', 'legacy-ranking-SH.png'],
    ['grade_a', 'legacy-ranking-A.png'],
    ['grade_b', 'legacy-ranking-B.png'],
    ['grade_c', 'legacy-ranking-C.png'],
    ['grade_d', 'legacy-ranking-D.png'],
];

async function main() {
    await loadDotEnv();
    const appId = process.env.DISCORD_APP_ID;
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!appId || !botToken) {
        console.error('Missing DISCORD_APP_ID or DISCORD_BOT_TOKEN (env or .env).');
        process.exit(1);
    }
    const force = process.argv.includes('--force');
    const auth = { Authorization: `Bot ${botToken}` };
    const base = `https://discord.com/api/v10/applications/${appId}/emojis`;

    const listRes = await fetch(base, { headers: auth });
    if (!listRes.ok) { console.error('list emojis failed:', listRes.status, await listRes.text()); process.exit(1); }
    const existing = new Map(((await listRes.json()).items || []).map(e => [e.name, e.id]));

    const result = {};
    for (const [name, file] of EMOJI) {
        if (existing.has(name) && !force) {
            result[name] = existing.get(name);
            console.log(`= ${name} (exists, ${existing.get(name)})`);
            continue;
        }
        if (existing.has(name) && force) {
            await fetch(`${base}/${existing.get(name)}`, { method: 'DELETE', headers: auth });
        }
        const img = await fetch(`${RAW}/${file}`);
        if (!img.ok) { console.error(`  ! download ${file}: ${img.status}`); continue; }
        const b64 = Buffer.from(await img.arrayBuffer()).toString('base64');
        const res = await fetch(base, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, image: `data:image/png;base64,${b64}` }),
        });
        const body = await res.json();
        if (!res.ok) { console.error(`  ! create ${name}: ${res.status}`, body); continue; }
        result[name] = body.id;
        console.log(`+ ${name} -> ${body.id}`);
        await new Promise(r => setTimeout(r, 400)); // be gentle with the emoji rate limit
    }

    const g = (n) => `<:${n}:${result[n] || '0'}>`;
    console.log('\nPaste into netlify/functions/_discord-lib.js:\n');
    console.log(`const GRADE_EMOJI = {
    X: '${g('grade_ss')}', SS: '${g('grade_ss')}',
    XH: '${g('grade_ssh')}', SSH: '${g('grade_ssh')}',
    S: '${g('grade_s')}', SH: '${g('grade_sh')}',
    A: '${g('grade_a')}', B: '${g('grade_b')}', C: '${g('grade_c')}', D: '${g('grade_d')}', F: '',
};`);
}

main().catch(e => { console.error(e); process.exit(1); });
