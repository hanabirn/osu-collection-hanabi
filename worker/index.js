/* Cloudflare Worker 入口：靜態資源 + 66 個移植過來的 function。
 *
 * 路由對照（左邊是 Netlify 上的網址，必須一字不差地保留，
 * 因為前端 js/ 裡 34 處硬寫了 /.netlify/functions/... 的路徑）：
 *
 *   /.netlify/functions/<name>   -> ROUTES[name]
 *   /c/<id>                      -> collection-share-page?id=<id>   （rewrite，網址列不變）
 *   /gallery.xml                 -> gallery-feed
 *   /chat-media/<id>             -> chat-media（函式從路徑尾端讀 id）
 *   /discord                     -> 尚未移植，回 503 而不是 404，
 *                                   免得 Discord 以為端點不存在而關閉整合
 *   其他                          -> 靜態資源（env.ASSETS）
 */
/* rosu-pp 的 WASM 必須在任何 require 之前就緒。ESM 的 import 保證先於
   模組主體執行，所以這裡拿到的 WebAssembly.Module 一定早於下面的 require
   —— 而 routes.js -> farm-crawl-run -> _farm-crawl-core -> rosu-pp-js 這條
   鏈在載入當下就會用到它（見 scripts/patch-rosu-wasm.mjs）。 */
import rosuWasmModule from '../netlify/functions/node_modules/rosu-pp-js/rosu_pp_js_bg.wasm';
globalThis.__ROSU_WASM_MODULE__ = rosuWasmModule;

const { runWithEnv } = require('../netlify/functions/_cf-env');
const { ROUTES, CRON_HANDLERS } = require('./routes');
const {
    EXPENSIVE_MS,
    parseMaxAge,
    isPubliclyCacheable,
    readFromKv,
    writeToKv,
} = require('./response-cache');

const FN_PREFIX = '/.netlify/functions/';

/* Discord 尚未移植。回 503 + Retry-After 而非 404：
   Discord 對持續 404 的 Interactions Endpoint 會停用整合，
   503 則被視為暫時性故障。 */
function discordNotPorted() {
    return new Response(JSON.stringify({ error: 'discord integration not migrated yet' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' },
    });
}

function resolveRoute(url) {
    const path = url.pathname;

    if (path.startsWith(FN_PREFIX)) {
        const name = path.slice(FN_PREFIX.length).replace(/\/$/, '');
        if (name === 'discord-interactions' || name === 'discord-work-background') {
            return { special: discordNotPorted };
        }
        const fn = ROUTES[name];
        return fn ? { fn } : null;
    }

    if (path === '/discord') return { special: discordNotPorted };

    /* 以下三條對應 netlify.toml 的 [[redirects]] status=200（rewrite）。
       用 200 rewrite 而不是轉址，網址列要保持原樣。 */
    const share = path.match(/^\/c\/([^/]+)\/?$/);
    if (share) {
        return { fn: ROUTES['collection-share-page'], searchOverride: { id: share[1] } };
    }

    if (path === '/gallery.xml') return { fn: ROUTES['gallery-feed'] };

    /* chat-media 刻意保留原始路徑：函式是從 event.path 的最後一段讀 id 的
       （netlify.toml 註解寫過 :id -> ?id= 的替換在這條路徑上不可靠）。 */
    if (/^\/chat-media\/[^/]+$/.test(path)) return { fn: ROUTES['chat-media'] };

    return null;
}

/* cron 運算式 -> 要跑的排程函式。必須與 wrangler.jsonc 的 triggers.crons
   逐字一致，Cloudflare 是用字串比對把 event.cron 傳回來的。
   原本的排程宣告在 netlify.toml 的 [functions."<name>"] schedule。 */
const CRON_SCHEDULE = {
    '*/10 * * * *': 'farm-crawl-cron',
    '*/30 * * * *': 'catalog-crawl-cron',
    '0 */6 * * *': 'community-mappools-crawl-cron',
    '0 6 * * 1': 'wc-mappool-crawl-cron',
};

export default {
    async scheduled(event, env, ctx) {
        const name = CRON_SCHEDULE[event.cron];
        const handler = name && CRON_HANDLERS[name];
        if (!handler) {
            console.error('沒有對應的排程處理器:', event.cron);
            return;
        }
        try {
            /* 排程函式原本就是無參數的 exports.handler，回傳 Lambda 形狀的
               物件；這裡只取它的結果寫 log，沒有 HTTP 回應要送。 */
            const result = await runWithEnv(env, ctx, () => handler());
            console.log(`排程 ${name} 完成:`, result?.statusCode, String(result?.body ?? '').slice(0, 300));
        } catch (err) {
            console.error(`排程 ${name} 失敗:`, err?.stack || err);
        }
    },

    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        const route = resolveRoute(url);

        if (!route) return env.ASSETS.fetch(request);
        if (route.special) return route.special();
        if (!route.fn) return env.ASSETS.fetch(request);

        /* rewrite 進來的 id 要放進 query，讓函式照原本的
           event.queryStringParameters.id 讀得到。 */
        let effectiveUrl = url;
        if (route.searchOverride) {
            effectiveUrl = new URL(url.toString());
            for (const [k, v] of Object.entries(route.searchOverride)) {
                effectiveUrl.searchParams.set(k, v);
            }
        }

        /* 邊緣快取：還原 Netlify CDN 的行為。
         *
         * 53 個函式都回 Cache-Control（例如 osu-tournaments 的
         * public, max-age=600），在 Netlify 上由它的 CDN 遵守，函式因此
         * 每 10 分鐘才真的跑一次。Cloudflare 預設不快取 Worker 的回應，
         * 於是每個請求都重跑——osu-tournaments 每跑一次就對 osu! 發 25 個
         * 追加請求，實測約一半的請求被上游速率限制擋掉。
         *
         * 只快取 GET，且只在回應自己宣告可公開快取時才存。帶 Authorization
         * 的請求一律不碰快取，避免把某個使用者的私人資料發給別人。 */
        const isCacheable = request.method === 'GET' && !request.headers.has('authorization');
        const cache = caches.default;
        /* 用 effectiveUrl 當快取鍵：/c/<id> 這類 rewrite 會補上 query，
           不同 id 必須是不同的快取項目。 */
        const cacheKey = new Request(effectiveUrl.toString(), { method: 'GET' });

        const kvCacheKey = 'v1:' + effectiveUrl.toString();

        /* 查快取要整段包起來：快取只是加速手段，任何一層出問題都應該
           安靜地退回去實際執行函式，而不是讓請求整個失敗。
           曾經沒包，結果 KV 因為鍵過長丟例外，登入回呼直接變 Error 1101。 */
        if (isCacheable) {
            try {
                const hit = await cache.match(cacheKey);
                if (hit) {
                    const h = new Response(hit.body, hit);
                    h.headers.set('X-Edge-Cache', 'HIT');
                    return h;
                }
                /* caches.default 是各邊緣節點獨立的，KV 這層則是全域共用，
                   冷節點也能命中。見 response-cache.js 的說明。 */
                const kvHit = await readFromKv(env.KV_RESP_CACHE, kvCacheKey);
                if (kvHit) return kvHit;
            } catch (err) {
                console.error('查快取失敗，改為直接執行:', String(err?.message || err));
            }
        }

        try {
            const startedAt = Date.now();
            const response = await runWithEnv(env, ctx, () => route.fn(request, effectiveUrl));
            const elapsed = Date.now() - startedAt;

            if (isCacheable && response.status === 200) {
                const cc = response.headers.get('cache-control');
                if (isPubliclyCacheable(cc)) {
                    const tagged = new Response(response.body, response);
                    tagged.headers.set('X-Edge-Cache', 'MISS');

                    ctx.waitUntil(
                        cache.put(cacheKey, tagged.clone()).catch((err) => {
                            console.error('cache.put 失敗:', String(err?.message || err));
                        }),
                    );

                    /* 只有產生成本高的回應才進 KV —— KV 免費方案每天
                       1,000 次寫入，便宜的端點不值得佔用配額。 */
                    if (elapsed >= EXPENSIVE_MS) {
                        ctx.waitUntil(
                            writeToKv(env.KV_RESP_CACHE, kvCacheKey, tagged.clone(), parseMaxAge(cc)).catch(
                                (err) => console.error('KV 快取寫入失敗:', String(err?.message || err)),
                            ),
                        );
                    }
                    return tagged;
                }
            }
            return response;
        } catch (err) {
            console.error('function 未捕捉的例外:', url.pathname, err?.stack || err);
            return new Response(JSON.stringify({ error: 'internal error' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }
    },
};
