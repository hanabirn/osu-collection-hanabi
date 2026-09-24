/* 產生 worker/routes.js：掃描 netlify/functions/ 下的端點，輸出靜態 require 的路由表。
 *
 * 為什麼要產生而不是手寫：esbuild 打包需要靜態 require（動態路徑打包不進去），
 * 但手寫 67 條容易跟檔案系統脫節。這支腳本在每次 build 前跑，保證同步。
 *
 * 排除的四類：
 *   _*.js          共用工具，不是端點
 *   *-cron.js      排程專用，改由 Workers 的 scheduled handler 觸發（階段 4）；
 *                  若掛成 HTTP 路由會變成任何人都能觸發爬蟲，白燒額度
 *   Discord 相關   使用者決定延後處理（見遷移計畫）
 *   preview-proxy  死程式碼，前端早已改成直接打 b.ppy.sh
 */
import { readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FN_DIR = join(ROOT, 'netlify/functions');
const OUT = join(ROOT, 'worker/routes.js');

const DEFERRED_DISCORD = new Set([
    'discord-interactions',
    'discord-work-background',
    'practice-generate', // 只有 discord-work-background 會呼叫
]);
const DEAD = new Set(['preview-proxy']);

const files = (await readdir(FN_DIR)).filter((f) => f.endsWith('.js'));

const names = files
    .map((f) => f.replace(/\.js$/, ''))
    .filter((n) => !n.startsWith('_'))
    .filter((n) => !n.endsWith('-cron'))
    .filter((n) => !DEFERRED_DISCORD.has(n))
    .filter((n) => !DEAD.has(n))
    .sort();

/* push-cron 先不納入：它 require('web-push')，那個套件依賴 Node 的 crypto
   實作，在 Workers 打包不過（VAPID 簽章要用 Web Crypto 重寫，見遷移計畫
   階段 3）。留在這裡會讓整包 build 失敗，所以等重寫完再加回來。 */
const NEEDS_REWRITE = new Set(['push-cron']);

const skipped = {
    cron: files
        .map((f) => f.replace(/\.js$/, ''))
        .filter((n) => n.endsWith('-cron'))
        .filter((n) => !NEEDS_REWRITE.has(n)),
    pending: [...NEEDS_REWRITE],
    discord: [...DEFERRED_DISCORD],
    dead: [...DEAD],
};

const lines = [
    '/* 自動產生，請勿手動編輯 —— 改用 `node scripts/gen-worker-routes.mjs`。',
    ` * 端點數: ${names.length}`,
    ` * 排除: 排程 ${skipped.cron.length} 個（階段 4 改走 scheduled handler）、`,
    ` *       Discord ${skipped.discord.length} 個（延後）、死程式碼 ${skipped.dead.length} 個`,
    ' */',
    "const { adapt } = require('./adapter');",
    '',
    'const ROUTES = {',
    ...names.map((n) => `    ${JSON.stringify(n)}: adapt(require('../netlify/functions/${n}').handler),`),
    '};',
    '',
    '/* 排程函式不掛 HTTP 路由，但階段 4 的 scheduled handler 需要拿得到。 */',
    'const CRON_HANDLERS = {',
    ...skipped.cron.map((n) => `    ${JSON.stringify(n)}: require('../netlify/functions/${n}').handler,`),
    '};',
    '',
    'module.exports = { ROUTES, CRON_HANDLERS };',
    '',
];

await writeFile(OUT, lines.join('\n'), 'utf8');

console.log(`worker/routes.js: ${names.length} 個端點`);
console.log(`  排除排程 ${skipped.cron.length} 個: ${skipped.cron.join(', ')}`);
console.log(`  排除 Discord ${skipped.discord.length} 個: ${skipped.discord.join(', ')}`);
console.log(`  排除死程式碼 ${skipped.dead.length} 個: ${skipped.dead.join(', ')}`);
console.log(`  待重寫 ${skipped.pending.length} 個: ${skipped.pending.join(', ')}`);
