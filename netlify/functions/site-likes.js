/* Site-wide "like this site" counter for anonymous visitors — no osu! login,
   unlike collections-like.js. Source of truth is one blob-backed array at
   key `likers` holding hashed client IPs; the like total is just its
   length. Keeping the set (rather than a bare integer) is what lets a like
   be undone later — including on a different day — without the count
   drifting. This is a vanity number, not an audited metric: visitors behind
   the same NAT share a hash and count once, and the client's localStorage
   guard does most of the de-duping. This is only a light server backstop.

     GET  -> { likes }
     POST { liked: true }  -> add this IP's like    -> { likes, liked: true }
     POST { liked: false } -> remove this IP's like -> { likes, liked: false }
     (POST with no body is treated as liked:true, matching the old behaviour.)
*/
const crypto = require('crypto');
const { getSiteStatsStore } = require('./_blobs-store');

const LIKERS_KEY = 'likers';

function clientIpHash(event) {
    const h = event.headers || {};
    const ip = h['x-nf-client-connection-ip']
        || (h['x-forwarded-for'] || '').split(',')[0].trim()
        || 'unknown';
    return crypto.createHash('sha256').update(ip + '|osu-site-like').digest('hex').slice(0, 16);
}

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    let store;
    try {
        store = getSiteStatsStore();
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }

    try {
        const likers = (await store.get(LIKERS_KEY, { type: 'json' })) || [];

        if (event.httpMethod === 'GET') {
            return { statusCode: 200, headers, body: JSON.stringify({ likes: likers.length }) };
        }

        if (event.httpMethod === 'POST') {
            let wantLiked = true;
            try {
                const body = JSON.parse(event.body || '{}');
                if (body && body.liked === false) wantLiked = false;
            } catch { /* no/!json body -> treat as a like */ }

            const hash = clientIpHash(event);
            const has = likers.includes(hash);

            if (wantLiked && !has) {
                likers.push(hash);
                await store.setJSON(LIKERS_KEY, likers);
            } else if (!wantLiked && has) {
                const next = likers.filter(x => x !== hash);
                await store.setJSON(LIKERS_KEY, next);
                return { statusCode: 200, headers, body: JSON.stringify({ likes: next.length, liked: false }) };
            }

            return { statusCode: 200, headers, body: JSON.stringify({ likes: likers.length, liked: wantLiked }) };
        }

        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
