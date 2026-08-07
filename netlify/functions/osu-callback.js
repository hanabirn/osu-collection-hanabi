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

exports.handler = async (event) => {
    const code = event.queryStringParameters && event.queryStringParameters.code;
    if (!code) {
        return { statusCode: 302, headers: { Location: '/?osu_login_error=1' }, body: '' };
    }

    try {
        const tokenRes = await fetch('https://osu.ppy.sh/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                client_id: process.env.OSU_CLIENT_ID,
                client_secret: process.env.OSU_CLIENT_SECRET,
                redirect_uri: process.env.OSU_REDIRECT_URI,
                grant_type: 'authorization_code',
                code,
            }),
        });
        if (!tokenRes.ok) throw new Error('token exchange failed');
        const tokenData = await tokenRes.json();

        const meRes = await fetch('https://osu.ppy.sh/api/v2/me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/json' },
        });
        if (!meRes.ok) throw new Error('/me request failed');
        const me = await meRes.json();

        const params = new URLSearchParams({
            osu_login: me.id,
            osu_login_name: me.username,
            osu_login_token: signAuthToken({ id: me.id, username: me.username }),
        });
        return { statusCode: 302, headers: { Location: `/?${params.toString()}` }, body: '' };
    } catch (err) {
        return { statusCode: 302, headers: { Location: '/?osu_login_error=1' }, body: '' };
    }
};
