/* Completes the osu! OAuth flow started in osu-replay-login.js — this is
   THIS site's general login (not scoped to any one feature). Filenames/
   route kept as osu-replay-* from the original Watch Replay-only version
   (removed and rebuilt as general login 2026-09) rather than renamed to
   something generic, because OSU_REPLAY_REDIRECT_URI (still set, unused
   env vars survive a feature's code being deleted) points the osu! OAuth
   app's own registered callback URL at this exact path — renaming it
   would mean going back into osu!'s developer settings to update it, for
   no real benefit.

   Unlike the main site's osu-callback.js (which uses the token once for
   /me and discards it — see that file), this stores the access + refresh
   tokens (encrypted — _token-crypto.js) in getAuthStore() keyed by user
   id, so a login-gated feature can call osu!'s API again on a later visit
   without asking for another login every time (see _user-auth.js). A
   signed identity token (_auth-token.js, this site's own OSU_AUTH_SECRET)
   is minted alongside so the browser can prove "this request really is
   user X" without ever holding the real osu! token itself.

   `state` carries the return_to path from osu-replay-login.js. */
const { signAuthToken } = require('./_auth-token');
const { encrypt } = require('./_token-crypto');
const { getAuthStore } = require('./_blobs-store');

function fail(returnTo, stage, detail) {
    console.error(`osu-replay-callback failed at "${stage}": ${detail || ''}`);
    const path = returnTo && returnTo.startsWith('/') ? returnTo : '/';
    const sep = path.includes('?') ? '&' : '?';
    return { statusCode: 302, headers: { Location: `${path}${sep}ct_login_error=${encodeURIComponent(stage)}` }, body: '' };
}

exports.handler = async (event) => {
    const qs = event.queryStringParameters || {};
    const code = qs.code;
    const returnTo = typeof qs.state === 'string' && qs.state.startsWith('/') ? qs.state : '/';
    if (!code) return fail(returnTo, 'no_code');

    for (const k of ['OSU_REPLAY_CLIENT_ID', 'OSU_REPLAY_CLIENT_SECRET', 'OSU_REPLAY_REDIRECT_URI', 'OSU_AUTH_SECRET', 'TOKEN_ENC_KEY']) {
        if (!process.env[k]) return fail(returnTo, 'env', `${k} is not set`);
    }

    let tokenData;
    try {
        const form = new URLSearchParams({
            client_id: process.env.OSU_REPLAY_CLIENT_ID,
            client_secret: process.env.OSU_REPLAY_CLIENT_SECRET,
            redirect_uri: process.env.OSU_REPLAY_REDIRECT_URI,
            grant_type: 'authorization_code',
            code: String(code),
        });
        const tokenRes = await fetch('https://osu.ppy.sh/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: form.toString(),
        });
        const text = await tokenRes.text();
        if (!tokenRes.ok) return fail(returnTo, 'token_exchange', `${tokenRes.status} ${text.slice(0, 300)}`);
        tokenData = JSON.parse(text);
    } catch (err) {
        return fail(returnTo, 'token_exchange', err.message);
    }

    let me;
    try {
        const meRes = await fetch('https://osu.ppy.sh/api/v2/me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/json' },
        });
        if (!meRes.ok) return fail(returnTo, 'me', `${meRes.status}`);
        me = await meRes.json();
    } catch (err) {
        return fail(returnTo, 'me', err.message);
    }

    let signedToken;
    try {
        signedToken = signAuthToken({ id: me.id, username: me.username });

        const store = getAuthStore();
        await store.setJSON(`user-token:${me.id}`, {
            access_token: encrypt(tokenData.access_token),
            refresh_token: encrypt(tokenData.refresh_token),
            expires_at: Date.now() + (tokenData.expires_in - 60) * 1000,
            updatedAt: new Date().toISOString(),
        });
    } catch (err) {
        return fail(returnTo, 'sign_or_store', err.message);
    }

    const params = new URLSearchParams({
        ct_login: me.id,
        ct_login_name: me.username,
        ct_login_token: signedToken,
    });
    const sep = returnTo.includes('?') ? '&' : '?';
    return { statusCode: 302, headers: { Location: `${returnTo}${sep}${params.toString()}` }, body: '' };
};
