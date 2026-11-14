/* Kicks off the osu! OAuth authorization-code flow. Redirects the browser to
   osu!'s consent screen with the "identify" scope — the only thing we need
   is the visitor's own user id, so osu-callback.js can hand it straight back
   to the client and forget the token (see osu-callback.js for why no session
   is kept server-side). OSU_REDIRECT_URI must exactly match the callback URL
   registered in the osu! OAuth app settings.

   A random `state` goes both into the authorize URL and into a short-lived
   cookie; osu-callback.js refuses a callback whose state doesn't match the
   cookie. Without it, someone could send a visitor a callback link carrying
   the attacker's own code and silently log them in as the attacker
   (login CSRF). SameSite=Lax is enough: the callback is a top-level GET. */
const crypto = require('crypto');
const { OAUTH_STATE_COOKIE } = require('./_oauth-state');

exports.handler = async () => {
    const state = crypto.randomBytes(16).toString('hex');
    const params = new URLSearchParams({
        client_id: process.env.OSU_CLIENT_ID,
        redirect_uri: process.env.OSU_REDIRECT_URI,
        response_type: 'code',
        scope: 'identify',
        state,
    });

    return {
        statusCode: 302,
        headers: {
            Location: `https://osu.ppy.sh/oauth/authorize?${params.toString()}`,
            'Set-Cookie': `${OAUTH_STATE_COOKIE}=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
            'Cache-Control': 'no-store',
        },
        body: '',
    };
};
