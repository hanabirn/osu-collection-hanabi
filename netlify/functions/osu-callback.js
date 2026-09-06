/* Completes the osu! OAuth flow started in osu-login.js: exchanges the
   authorization code for an access token, uses it exactly once to call
   /api/v2/me for the visitor's own {id, username}, then discards the token.

   No session is kept — the site has no backend store (everything else lives
   in the visitor's own localStorage, see js/osu.js), so we just hand the id
   back to the client via a redirect query param. Downstream personalization
   (stats, recent plays, PP history) reuses the existing anonymous v1 API
   proxy (netlify/functions/osu.js) the same way manual profile lookup
   already does — the id is all that's needed for that.

   Also mints a signed osu_login_token (see _auth-token.js) alongside the
   plain id/username — the plain params are trivially spoofable (anyone can
   type ?osu_login=<id> into the URL bar) which is fine for read-only
   personalization, but not for collections-publish.js/unpublish.js, which
   need real proof of identity before writing public data under someone's
   name. */
const { signAuthToken } = require('./_auth-token');

/* `stage` is echoed in the failure redirect (?osu_login_error=<stage>) and
   logged, so an opaque login failure can be diagnosed without guessing:
   no_code | env | token_exchange | me | sign. */
function fail(stage, detail) {
    console.error(`osu-callback failed at "${stage}": ${detail || ''}`);
    return { statusCode: 302, headers: { Location: `/?osu_login_error=${encodeURIComponent(stage)}` }, body: '' };
}

exports.handler = async (event) => {
    const code = event.queryStringParameters && event.queryStringParameters.code;
    if (!code) return fail('no_code');

    for (const k of ['OSU_CLIENT_ID', 'OSU_CLIENT_SECRET', 'OSU_REDIRECT_URI', 'OSU_AUTH_SECRET']) {
        if (!process.env[k]) return fail('env', `${k} is not set`);
    }

    let tokenData;
    try {
        // OAuth2 spec: the token endpoint takes application/x-www-form-urlencoded.
        const form = new URLSearchParams({
            client_id: process.env.OSU_CLIENT_ID,
            client_secret: process.env.OSU_CLIENT_SECRET,
            redirect_uri: process.env.OSU_REDIRECT_URI,
            grant_type: 'authorization_code',
            code: String(code),
        });
        const tokenRes = await fetch('https://osu.ppy.sh/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: form.toString(),
        });
        const text = await tokenRes.text();
        if (!tokenRes.ok) {
            return fail('token_exchange',
                `${tokenRes.status} ${text.slice(0, 500)} | sent redirect_uri=${JSON.stringify(process.env.OSU_REDIRECT_URI)} client_id=${JSON.stringify(process.env.OSU_CLIENT_ID)} codeLen=${String(code).length}`);
        }
        tokenData = JSON.parse(text);
    } catch (err) {
        return fail('token_exchange', err.message);
    }

    let me;
    try {
        const meRes = await fetch('https://osu.ppy.sh/api/v2/me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/json' },
        });
        if (!meRes.ok) return fail('me', `${meRes.status}`);
        me = await meRes.json();
    } catch (err) {
        return fail('me', err.message);
    }

    let token;
    try {
        token = signAuthToken({ id: me.id, username: me.username });
    } catch (err) {
        return fail('sign', err.message);
    }

    const params = new URLSearchParams({
        osu_login: me.id,
        osu_login_name: me.username,
        osu_login_token: token,
    });
    return { statusCode: 302, headers: { Location: `/?${params.toString()}` }, body: '' };
};
