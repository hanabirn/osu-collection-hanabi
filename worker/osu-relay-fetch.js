/* 讓 Worker 上所有對 osu.ppy.sh 的 fetch 改經 Netlify 轉送。
 *
 * osu.ppy.sh 的 nginx 依來源 IP 限流，Cloudflare Workers 的對外 IP 是共用的，
 * 2026-10 起 v1 / v2 / oauth 從 Worker 打過去全部 429（同一組金鑰從 Netlify
 * 打則正常）。30 多個函式各自直接呼叫 fetch('https://osu.ppy.sh/...')，
 * 與其逐一改，這裡把全域 fetch 包一層：網址主機是 osu.ppy.sh 就送到
 * netlify/functions/osu-relay.js，其他（a.ppy.sh 頭像、R2、外部服務）照舊直連。
 *
 * 設定（wrangler secret）：OSU_RELAY_URL、OSU_RELAY_SECRET。沒設定時一律直連，
 * 所以部署順序不影響網站運作。轉送站本身出問題（未設定、密鑰不符）時也退回
 * 直連並記 log —— 直連最壞就是跟現在一樣 429，不會比沒有轉送更糟。
 */
const { getEnv } = require('../netlify/functions/_cf-env');

const RELAYED_HOST = 'osu.ppy.sh';

function relayConfig() {
    const env = getEnv() || {};
    const url = env.OSU_RELAY_URL;
    const secret = env.OSU_RELAY_SECRET;
    return url && secret ? { url, secret } : null;
}

function install() {
    const directFetch = globalThis.fetch;
    if (directFetch.__osuRelay) return;

    async function relayedFetch(input, init) {
        const cfg = relayConfig();
        if (!cfg) return directFetch(input, init);

        const req = new Request(input, init);
        if (new URL(req.url).hostname !== RELAYED_HOST) return directFetch(input, init);

        const headers = {};
        for (const [k, v] of req.headers) headers[k] = v;
        const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
        const body = hasBody ? await req.arrayBuffer() : undefined;

        const res = await directFetch(cfg.url, {
            method: 'POST',
            headers: {
                'x-relay-secret': cfg.secret,
                'x-relay-target': req.url,
                'x-relay-method': req.method,
                'x-relay-headers': JSON.stringify(headers),
                'Content-Type': req.headers.get('content-type') || 'application/octet-stream',
            },
            body,
            signal: req.signal,
        });

        /* 轉送站自己的錯誤（不是 osu! 的回應）會帶這個標頭。 */
        if (res.headers.get('x-relay-error')) {
            console.error(`osu! 轉送站失敗 (HTTP ${res.status})，改為直連:`, await res.text());
            return directFetch(req.url, {
                method: req.method,
                headers: req.headers,
                body,
                signal: req.signal,
            });
        }
        return res;
    }

    relayedFetch.__osuRelay = true;
    globalThis.fetch = relayedFetch;
}

module.exports = { install };
