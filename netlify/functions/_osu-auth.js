/* Shared osu! API v2 OAuth (client_credentials) helper, used by any proxy
   function that needs API v2 (news, forum topics, ...) rather than the
   legacy-API-v1-keyed osu.js/osu-avatar.js proxies. Token is cached in-module
   so a warm function container doesn't re-auth on every request — each
   function file gets its own cache since Netlify bundles them separately,
   but that's fine, it just means a cold start per function. */
let cachedToken = null;
let cachedTokenExpiry = 0;

async function getOsuToken() {
    if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;

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
    return cachedToken;
}

module.exports = { getOsuToken };
