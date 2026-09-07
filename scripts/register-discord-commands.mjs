/* One-shot: (re)register the bot's global slash commands with Discord.
   Run after deploying discord-interactions.js and setting the app's
   Interactions Endpoint URL:

     DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... node scripts/register-discord-commands.mjs

   Both values also read from a local .env (gitignored) if present. A global
   PUT replaces the whole command set and can take up to ~1 h to propagate
   to every client (usually much faster). Pass a guild id as the first arg
   to register to just that server instead (instant, handy for testing):

     node scripts/register-discord-commands.mjs 123456789012345678
*/
import { readFile } from 'node:fs/promises';

async function loadDotEnv() {
    try {
        const txt = await readFile(new URL('../.env', import.meta.url), 'utf8');
        for (const line of txt.split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
            if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    } catch { /* no .env, fine */ }
}

// Option types: 3 = STRING, 4 = INTEGER, 5 = BOOLEAN.
const MODE_CHOICES = [
    { name: 'osu!', value: 'osu' },
    { name: 'osu!taiko', value: 'taiko' },
    { name: 'osu!catch', value: 'fruits' },
    { name: 'osu!mania', value: 'mania' },
];
const usernameOpt = { type: 3, name: 'username', required: false, description: 'osu! 名稱或 ID（省略則用 /link 綁定的帳號）' };
const modeOpt = { type: 3, name: 'mode', required: false, description: '遊戲模式（預設 osu!）', choices: MODE_CHOICES };

const commands = [
    {
        name: 'collection',
        description: '搜尋並顯示一份已發佈的 osu! 收藏',
        options: [
            { type: 3, name: 'query', required: true, autocomplete: true, description: '發佈者名稱、收藏 ID 或分類關鍵字' },
        ],
    },
    {
        name: 'gallery',
        description: '瀏覽收藏廣場最新發佈的收藏',
        options: [{ type: 4, name: 'page', required: false, description: '頁碼（從 1 開始）' }],
    },
    {
        name: 'pp',
        description: '查詢 osu! 玩家的 PP 與排名',
        options: [usernameOpt, modeOpt],
    },
    {
        name: 'recent',
        description: '查看某位玩家最近的一筆成績',
        options: [
            usernameOpt, modeOpt,
            { type: 4, name: 'index', required: false, description: '第幾筆（1 = 最新，最多 50）' },
        ],
    },
    {
        name: 'top',
        description: '查看某位玩家的最佳成績',
        options: [
            usernameOpt, modeOpt,
            { type: 4, name: 'index', required: false, description: '看第幾名的單筆詳情（1–100；省略則列前 5）' },
        ],
    },
    {
        name: 'map',
        description: '顯示一張圖譜的資訊與 PP 值',
        options: [{ type: 3, name: 'query', required: true, description: 'osu! 圖譜連結或 ID' }],
    },
    {
        name: 'mappool',
        description: '瀏覽官方世界盃圖池',
        options: [
            { type: 3, name: 'edition', required: true, autocomplete: true, description: '賽事版本（例如 OWC/2024）' },
            { type: 3, name: 'round', required: false, description: '輪次名稱（省略則列出所有輪次）' },
        ],
    },
    {
        name: 'skin',
        description: '搜尋站內皮膚庫',
        options: [{ type: 3, name: 'query', required: true, description: '皮膚名稱或作者' }],
    },
    {
        name: 'farm',
        description: '從農分圖資料庫抽一張圖',
        options: [
            { type: 3, name: 'mode', required: false, description: '遊戲模式（預設 osu!）', choices: [
                { name: 'osu!', value: 'osu' }, { name: 'osu!taiko', value: 'taiko' },
                { name: 'osu!catch', value: 'catch' }, { name: 'osu!mania', value: 'mania' },
            ] },
            { type: 4, name: 'pp_min', required: false, description: '最低 PP' },
        ],
    },
    {
        name: 'link',
        description: '把你的 Discord 帳號綁定一個 osu! 帳號',
        options: [{ type: 3, name: 'username', required: true, description: 'osu! 名稱或 ID' }],
    },
    {
        name: 'unlink',
        description: '解除 osu! 帳號綁定',
    },
];

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
