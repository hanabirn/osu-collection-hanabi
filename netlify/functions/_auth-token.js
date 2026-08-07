/* Stateless, signed identity token for the visitor's own osu! id — mints in
   osu-callback.js after a real OAuth round-trip, verified by any function
   that needs to trust "this request really is osu! user X" (currently just
   collections-publish.js / collections-unpublish.js). No session store: the
   HMAC signature is the only thing that needs to stay secret (OSU_AUTH_SECRET),
   so any warm or cold function instance can verify a token on its own.

   This exists because the plain ?osu_login=<id> redirect param that the rest
   of the site's login flow uses (see osu-callback.js, js/osu.js's
   checkOsuLoginFromUrl()) is NOT verifiable — a visitor can put any id in the
   URL bar and the client trusts it blindly. That's fine for the read-only
   personalization it's used for today, but not for an action that writes
   public data under someone's name. */
const crypto = require('crypto');

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function signAuthToken({ id, username }) {
    const payload = JSON.stringify({ id: String(id), username: username || '', exp: Date.now() + TOKEN_TTL_MS });
    const payloadB64 = Buffer.from(payload).toString('base64url');
    const sig = crypto.createHmac('sha256', process.env.OSU_AUTH_SECRET).update(payloadB64).digest();
    return `${payloadB64}.${sig.toString('base64url')}`;
}

function verifyAuthToken(token) {
    if (!token || typeof token !== 'string') return null;
    const dot = token.indexOf('.');
    if (dot < 0) return null;
    const payloadB64 = token.slice(0, dot);
    const sigB64 = token.slice(dot + 1);

    let expected, got;
    try {
        expected = crypto.createHmac('sha256', process.env.OSU_AUTH_SECRET).update(payloadB64).digest();
        got = Buffer.from(sigB64, 'base64url');
    } catch {
        return null;
    }
    if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return null;

    try {
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        if (!payload.id || !payload.exp || Date.now() > payload.exp) return null;
        return { id: String(payload.id), username: payload.username || '' };
    } catch {
        return null;
    }
}

module.exports = { signAuthToken, verifyAuthToken };
