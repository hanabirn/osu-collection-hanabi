/* Shared osu! API v2 OAuth (client_credentials) helper, used by any proxy
   function that needs API v2 (news, forum topics, ...) rather than the
   legacy-API-v1-keyed osu.js/osu-avatar.js proxies. Token is cached in-module
   so a warm function container doesn't re-auth on every request — each
   function file gets its own cache since Netlify bundles them separately,
   but that's fine, it just means a cold start per function. */
const { getEnv } = require('./_cf-env');

let cachedToken = null;
let cachedTokenExpiry = 0;

/* 跨 isolate 共用的 token 快取。
   模組層的 cachedToken 只在同一個 isolate 內有效，而 Workers 會不斷
   建立新的 isolate —— 每個新 isolate 都去要一次 token，把 osu! 的配額
   打爆（實測 catalog 爬蟲重試 4 次仍全數 429）。token 本身有效期以小時
   計，放進 KV 讓所有 isolate 共用，請求次數就從「每次冷啟動一次」降到
   「每個有效期一次」。Netlify 上 getEnv() 回 null，行為不變。 */
const KV_TOKEN_KEY = 'osu:token:v1';

function tokenKv() {
    return getEnv()?.KV_RESP_CACHE ?? null;
}

async function readSharedToken() {
    const kv = tokenKv();
    if (!kv) return null;
    try {
        const hit = await kv.get(KV_TOKEN_KEY, 'json');
        if (hit?.token && Date.now() < hit.expiry) return hit;
    } catch {
        /* 快取讀不到就當沒有，照常去要新的 */
    }
    return null;
}

async function writeSharedToken(token, expiry) {
    const kv = tokenKv();
    if (!kv) return;
    try {
        const ttl = Math.max(60, Math.floor((expiry - Date.now()) / 1000));
        await kv.put(KV_TOKEN_KEY, JSON.stringify({ token, expiry }), { expirationTtl: ttl });
    } catch {
        /* 寫不進去不影響本次請求，下次再試 */
    }
}

async function getOsuToken() {
    if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;

    const shared = await readSharedToken();
    if (shared) {
        cachedToken = shared.token;
        cachedTokenExpiry = shared.expiry;
        return cachedToken;
    }

    /* 429 退避重試：Workers 的對外 IP 是共用的，osu! 以 IP 計配額，
       實測 token 端點會間歇回 429（在 Netlify 上沒遇到，因為 CDN 快取
       讓真正打到上游的次數少很多）。 */
    const request = () =>
        fetch('https://osu.ppy.sh/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                client_id: process.env.OSU_CLIENT_ID,
                client_secret: process.env.OSU_CLIENT_SECRET,
                grant_type: 'client_credentials',
                scope: 'public',
            }),
        });

    const delays = [400, 1200, 2500];
    let res = await request();
    for (let attempt = 0; res.status === 429 && attempt < delays.length; attempt++) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        res = await request();
    }
    if (!res.ok) {
        /* 把上游的狀態碼與回應內容帶進錯誤訊息。原本只丟一句
           'osu! token request failed'，在 Cloudflare 上出現間歇性失敗時
           完全無從判斷是速率限制、憑證問題還是上游故障。 */
        let detail = '';
        try {
            detail = (await res.text()).slice(0, 200);
        } catch {
            /* 讀不到 body 就算了，狀態碼本身已經夠用 */
        }
        console.error(`osu! token request failed: HTTP ${res.status} ${detail}`);
        throw new Error(`osu! token request failed (HTTP ${res.status})`);
    }
    const data = await res.json();
    cachedToken = data.access_token;
    cachedTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    await writeSharedToken(cachedToken, cachedTokenExpiry);
    return cachedToken;
}

module.exports = { getOsuToken };
