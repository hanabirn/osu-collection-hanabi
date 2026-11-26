/* 網站更新 → Discord：把「網站更新紀錄」(js/site-changelog-data.js，打包時
   另存成 dist/changelog.json) 裡還沒貼過的項目，用機器人貼到我們伺服器的
   #my-website-update-inform 頻道。由排程（每 30 分鐘，見 worker/index.js）呼叫，
   不管用什麼方式部署都會自動貼。

   - 每個項目以「日期 + 第一句的雜湊」辨識，貼過的記在 KV changelog:announced。
   - 第一次執行（還沒有紀錄）時，ANNOUNCE_FROM 之前的舊項目只標記、不貼，
     免得一次洗版。
   - 項目可標 kind: 'bot'（Discord bot 的更新），貼文標題與顏色會分開。 */
const KEY = 'changelog:announced';
const ANNOUNCE_FROM = '2026-11-26';
const DEFAULT_CHANNEL = '1541940186982907934'; // #my-website-update-inform
const SITE = 'https://osu.hanabirn.xyz';

const text = (item, lang) => (typeof item === 'string' ? item : (item && (item[lang] || item.en || item.zh)) || '');

async function idOf(entry) {
    const first = text((entry.items || [])[0], 'zh');
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${entry.date}|${entry.kind || 'site'}|${first}`));
    return `${entry.date}#${[...new Uint8Array(buf)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// the languages the 🌐 menu offers (the site's nine)
const LANGS = [['zh', '繁體中文', '🇹🇼'], ['zh-Hans', '简体中文', '🇨🇳'], ['en', 'English', '🇬🇧'], ['ja', '日本語', '🇯🇵'], ['ko', '한국어', '🇰🇷'], ['de', 'Deutsch', '🇩🇪'], ['es', 'Español', '🇪🇸'], ['fr', 'Français', '🇫🇷'], ['ru', 'Русский', '🇷🇺']];

// lang given: that language alone (the 🌐 menu's answer); none: Chinese with English under it
function embedFor(entry, lang) {
    const bot = entry.kind === 'bot';
    const lines = (entry.items || []).map((it) => {
        if (lang) return `• ${text(it, lang)}`;
        const zh = text(it, 'zh'), en = text(it, 'en');
        return en && en !== zh ? `• ${zh}\n  ${en}` : `• ${zh}`;
    });
    let description = lines.join('\n');
    if (description.length > 3900) description = `${description.slice(0, 3890)}…`;
    const T = {
        zh: ['網站更新', 'Discord bot 更新'], 'zh-Hans': ['网站更新', 'Discord bot 更新'], en: ['Site update', 'Discord bot update'],
        ja: ['サイト更新', 'Discord ボット更新'], ko: ['사이트 업데이트', '디스코드 봇 업데이트'], de: ['Seiten-Update', 'Discord-Bot-Update'],
        es: ['Actualización del sitio', 'Actualización del bot de Discord'], fr: ['Mise à jour du site', 'Mise à jour du bot Discord'], ru: ['Обновление сайта', 'Обновление Discord-бота'],
    }[lang || 'zh'] || ['網站更新', 'Discord bot 更新'];
    return {
        title: `${bot ? `🤖 ${T[1]}` : `🌐 ${T[0]}`} · ${entry.date}`,
        url: bot ? undefined : SITE,
        description,
        color: bot ? 0x5865f2 : 0xf472b6,
        footer: { text: bot ? 'osu! Collection · Discord bot' : 'osu! Collection · 重新整理網頁就能看到 / reload the page to see it' },
    };
}

async function announceChangelog(env) {
    const kv = env.KV_RESP_CACHE;
    const token = env.DISCORD_BOT_TOKEN;
    const channel = env.DISCORD_UPDATES_CHANNEL || DEFAULT_CHANNEL;
    if (!kv || !token || !env.ASSETS) return 'not configured';
    const res = await env.ASSETS.fetch(new Request(`${SITE}/changelog.json`));
    if (!res.ok) return `changelog.json ${res.status}`;
    const entries = await res.json();
    const withIds = await Promise.all(entries.map(async (e) => ({ e, id: await idOf(e) })));

    let done = await kv.get(KEY, 'json');
    if (!Array.isArray(done)) {
        done = withIds.filter(({ e }) => e.date < ANNOUNCE_FROM).map(({ id }) => id);
        await kv.put(KEY, JSON.stringify(done));
    }
    const seen = new Set(done);
    // oldest first, so the channel reads in order
    const todo = withIds.filter(({ id }) => !seen.has(id)).reverse().slice(0, 5);
    let posted = 0;
    for (const { e, id } of todo) {
        const r = await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [embedFor(e)],
                // 🌐: anyone picks a language and gets the notes in it, seen only by them
                components: [{ type: 1, components: [{ type: 3, custom_id: `cltr|${id}`, placeholder: '🌐 翻譯 · Translate · 翻訳 · 번역', options: LANGS.map(([value, label, emoji]) => ({ value, label, emoji: { name: emoji } })) }] }],
                allowed_mentions: { parse: [] },
            }),
        });
        if (!r.ok) { console.error('changelog announce failed', r.status, await r.text().catch(() => '')); break; }
        done.push(id);
        posted++;
        await kv.put(KEY, JSON.stringify(done.slice(-500)));
    }
    return `posted ${posted}`;
}

/* The 🌐 menu under an announcement (discord-interactions.js): that entry's
   notes in the picked language. */
async function changelogInLanguage(origin, id, lang) {
    // the static file straight from the site's assets: a Worker fetching its own
    // domain doesn't reach them (that request fails), so only fall back to it
    const env = require('../netlify/functions/_cf-env').getEnv();
    const res = env && env.ASSETS ? await env.ASSETS.fetch(new Request(`${SITE}/changelog.json`)) : await fetch(`${origin}/changelog.json`);
    if (!res.ok) return null;
    for (const e of await res.json()) if ((await idOf(e)) === id) return embedFor(e, LANGS.some(([k]) => k === lang) ? lang : 'en');
    return null;
}

module.exports = { announceChangelog, changelogInLanguage };
