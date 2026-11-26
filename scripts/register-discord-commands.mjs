/* One-shot: (re)register the bot's global slash commands with Discord.
   Run after deploying discord-interactions.js and setting the app's
   Interactions Endpoint URL:

     DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... node scripts/register-discord-commands.mjs

   Both values also read from a local .env (gitignored) if present. A global
   PUT replaces the whole command set and can take up to ~1 h to propagate
   to every client (usually much faster). Pass a guild id as the first arg
   to register to just that server instead (instant, handy for testing):

     node scripts/register-discord-commands.mjs 123456789012345678

   Command *names* stay English (users type them, and localized names have
   strict charset rules); descriptions and option descriptions are localized
   via description_localizations. Response text is localized separately at
   runtime — see netlify/functions/_discord-i18n.js. Choice names (mode /
   mods) are language-neutral acronyms so they need no localization.

   Command definitions live in netlify/functions/_discord-commands.js. */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { commands } = require('../netlify/functions/_discord-commands.js');

async function loadDotEnv() {
    try {
        const txt = await readFile(new URL('../.env', import.meta.url), 'utf8');
        for (const line of txt.split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
            if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    } catch { /* no .env, fine */ }
}

async function main() {
    await loadDotEnv();
    const appId = process.env.DISCORD_APP_ID;
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!appId || !botToken) {
        console.error('Missing DISCORD_APP_ID or DISCORD_BOT_TOKEN (env or .env).');
        process.exit(1);
    }

    const guildId = process.argv[2];
    const url = guildId
        ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
        : `https://discord.com/api/v10/applications/${appId}/commands`;

    const res = await fetch(url, {
        method: 'PUT',
        headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(commands),
    });

    const text = await res.text();
    if (!res.ok) {
        console.error(`Discord API ${res.status}:`, text);
        process.exit(1);
    }
    const registered = JSON.parse(text);
    console.log(`Registered ${registered.length} command(s) ${guildId ? `to guild ${guildId}` : 'globally'}:`);
    for (const c of registered) console.log(`  /${c.name} — ${c.description}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
