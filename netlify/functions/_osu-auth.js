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

    const res = await fetch('https://osu.ppy.sh/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
            client_id: process.env.OSU_CLIENT_ID,
            client_secret: process.env.OSU_CLIENT_SECRET,
            grant_type: 'client_credentials',
            scope: 'public',
        }),
    });
    if (!res.ok) throw new Error('osu! token request failed');
    const data = await res.json();
    cachedToken = data.access_token;
    cachedTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return cachedToken;
}

module.exports = { getOsuToken };
