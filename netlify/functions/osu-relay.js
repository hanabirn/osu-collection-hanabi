/* osu! API 轉送站 —— 只在 Netlify 上跑，Worker 不掛這條路由
   （scripts/gen-worker-routes.mjs 的 NETLIFY_ONLY）。
 *
 * 為什麼需要：osu.ppy.sh 的 nginx 依來源 IP 限流，Cloudflare Workers 的
 * 對外 IP 是許多網站共用的，2026-10 起打過去 v1 / v2 / oauth 全部 429。
 * 同一組金鑰從 Netlify 打則完全正常。所以 Worker 上所有對 osu.ppy.sh 的
 * fetch 都改經這裡（見 worker/osu-relay-fetch.js），網站其餘部分仍在
 * Cloudflare。
 *
 * 請求格式（由 Worker 發出）：
 *   POST /.netlify/functions/osu-relay
 *   x-relay-secret: <OSU_RELAY_SECRET>
 *   x-relay-target: https://osu.ppy.sh/...      要轉送的完整網址
 *   x-relay-method: GET | POST ...              原請求的方法
 *   x-relay-headers: {"authorization": "..."}   原請求的標頭（JSON）
 *   body: 原請求的 body（沒有就空）
 * 回應：上游的狀態碼、content-type、原始位元組（以 base64 交給 Netlify，
 * 它會解碼後再送出，二進位的 .osu / 回放檔也不會被弄壞）。
 */
const crypto = require('crypto');

const ALLOWED_HOST = 'osu.ppy.sh';
/* 只轉送這些標頭；其他（cookie、cf-*、x-forwarded-* 等）一律不帶。 */
const FORWARD_HEADERS = new Set(['authorization', 'accept', 'content-type', 'x-api-version', 'user-agent']);
const UPSTREAM_TIMEOUT_MS = 9000;

/* 轉送站自己的錯誤帶 X-Relay-Error，讓 Worker 分得出這不是 osu! 的回應。 */
function json(statusCode, obj) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Relay-Error': '1' },
        body: JSON.stringify(obj),
    };
}

function secretMatches(given, expected) {
    const a = Buffer.from(String(given || ''));
    const b = Buffer.from(String(expected || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

exports.handler = async (event) => {
    const expected = process.env.OSU_RELAY_SECRET;
    if (!expected) return json(503, { error: 'relay not configured' });

    const h = event.headers || {};
    if (event.httpMethod !== 'POST' || !secretMatches(h['x-relay-secret'], expected)) {
        return json(403, { error: 'forbidden' });
    }

    let target;
    try {
        target = new URL(h['x-relay-target'] || '');
    } catch {
        return json(400, { error: 'bad target' });
    }
    if (target.protocol !== 'https:' || target.hostname !== ALLOWED_HOST) {
        return json(400, { error: 'target not allowed' });
    }

    const method = String(h['x-relay-method'] || 'GET').toUpperCase();
    let srcHeaders = {};
    try {
        srcHeaders = JSON.parse(h['x-relay-headers'] || '{}');
    } catch {
        return json(400, { error: 'bad headers' });
    }
    const headers = {};
    for (const [k, v] of Object.entries(srcHeaders)) {
        if (FORWARD_HEADERS.has(k.toLowerCase())) headers[k] = String(v);
    }

    let body;
    if (method !== 'GET' && method !== 'HEAD' && event.body) {
        body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
        const res = await fetch(target.toString(), { method, headers, body, signal: controller.signal });
        const buf = Buffer.from(await res.arrayBuffer());
        return {
            statusCode: res.status,
            headers: {
                'Content-Type': res.headers.get('content-type') || 'application/octet-stream',
                'Cache-Control': 'no-store',
            },
            body: buf.toString('base64'),
            isBase64Encoded: true,
        };
    } catch (err) {
        const timedOut = err && err.name === 'AbortError';
        return json(timedOut ? 504 : 502, { error: timedOut ? 'upstream timeout' : 'upstream fetch failed' });
    } finally {
        clearTimeout(timer);
    }
};
