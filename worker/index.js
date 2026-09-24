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
const { ROUTES } = require('./routes');
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

export default {
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

        if (isCacheable) {
            const hit = await cache.match(cacheKey);
            if (hit) {
                const h = new Response(hit.body, hit);
                h.headers.set('X-Edge-Cache', 'HIT');
                return h;
            }
            /* workers.dev 上 caches.default 是 no-op（實測永遠 MISS），
               所以再查一次 KV 這層。見 response-cache.js 的說明。 */
            const kvHit = await readFromKv(env.KV_RESP_CACHE, kvCacheKey);
            if (kvHit) return kvHit;
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
