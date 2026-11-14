/* The OAuth `state` round-trip shared by osu-login.js (sets the cookie) and
   osu-callback.js (checks and clears it). */
const crypto = require('crypto');

const OAUTH_STATE_COOKIE = 'osu_oauth_state';

function readCookie(headers, name) {
    const raw = (headers && (headers.cookie || headers.Cookie)) || '';
    for (const part of raw.split(';')) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
    return null;
}

function stateMatches(headers, given) {
    const expected = readCookie(headers, OAUTH_STATE_COOKIE);
    if (!expected || typeof given !== 'string' || !given) return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(given);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const CLEAR_STATE_COOKIE = `${OAUTH_STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

module.exports = { OAUTH_STATE_COOKIE, CLEAR_STATE_COOKIE, stateMatches };
