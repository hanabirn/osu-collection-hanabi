/* 以 KV 實作的回應快取，補 Cache API 在 *.workers.dev 上無效的洞。
 *
 * 背景：這 53 個函式都回 Cache-Control（例如 osu-tournaments 的
 * public, max-age=600），在 Netlify 上由 CDN 遵守，函式每 10 分鐘才真的
 * 跑一次。Cloudflare 的 caches.default 本該扮演同樣角色，但在
 * workers.dev 子網域上是 no-op —— 實測永遠 MISS，從無 HIT。
 * 結果 osu-tournaments 每次請求都對 osu! 發 25 個追加請求，約半數被
 * 上游速率限制擋掉。
 *
 * 只快取「真的很貴」的回應（產生耗時 >= EXPENSIVE_MS），原因是 KV 免費
 * 方案每天只有 1,000 次寫入。用耗時當門檻，寫入量自然被綁住：便宜的
 * 端點（讀個 KV 就回）不會佔用配額，而它們本來就不需要這層快取。
 *
 * 接上自訂網域後 caches.default 會先命中，這層幾乎不會被用到，
 * 但留著仍有價值：Cache API 是各個邊緣節點各自獨立的，KV 是全域共用。
 */

const EXPENSIVE_MS = 1000;
/* KV 的 expirationTtl 最低 60 秒 */
const MIN_TTL = 60;
/* 綁住單筆大小，避免大回應吃光 KV 配額（KV 單值上限 25 MiB） */
const MAX_BYTES = 1024 * 1024;

function parseMaxAge(cacheControl) {
    const m = /max-age=(\d+)/i.exec(cacheControl ?? '');
    return m ? parseInt(m[1], 10) : 0;
}

function isPubliclyCacheable(cacheControl) {
    const cc = cacheControl ?? '';
    return /public/i.test(cc) && parseMaxAge(cc) > 0 && !/no-store|private/i.test(cc);
}

/* KV 的鍵上限是 512 bytes，超過會丟例外。網址帶長 query 時很容易撞到——
   osu! 的 OAuth 授權碼就有 700 多字元，實測讓整個 Worker 回 Error 1101
   （未捕捉的例外），登入直接壞掉。這類一次性網址本來也不該進快取，
   所以太長就直接不碰快取。 */
const MAX_KEY_BYTES = 480;

function keyTooLong(key) {
    return new TextEncoder().encode(key).length > MAX_KEY_BYTES;
}

async function readFromKv(ns, key) {
    if (!ns || keyTooLong(key)) return null;
    let hit;
    try {
        hit = await ns.getWithMetadata(key, 'text');
    } catch (err) {
        /* 快取失敗絕不能拖垮請求本身 */
        console.error('KV 快取讀取失敗:', String(err?.message || err));
        return null;
    }
    if (hit?.value == null) return null;
    const meta = hit.metadata ?? {};
    return new Response(hit.value, {
        status: 200,
        headers: { ...(meta.headers ?? {}), 'X-Edge-Cache': 'KV-HIT' },
    });
}

async function writeToKv(ns, key, response, maxAge) {
    if (!ns || keyTooLong(key)) return;
    const body = await response.text();
    if (body.length > MAX_BYTES) return;

    const headers = {};
    for (const [k, v] of response.headers) {
        /* 不存逐跳標頭與我們自己加的除錯標頭 */
        if (/^(x-edge-cache|content-length|transfer-encoding|connection)$/i.test(k)) continue;
        headers[k] = v;
    }

    await ns.put(key, body, {
        expirationTtl: Math.max(MIN_TTL, maxAge),
        metadata: { headers },
    });
}

module.exports = { EXPENSIVE_MS, parseMaxAge, isPubliclyCacheable, readFromKv, writeToKv };
