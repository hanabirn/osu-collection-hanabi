/* Site-wide "like this site" counter for anonymous visitors — no osu! login,
   unlike collections-like.js. State is one blob-backed integer at key
   `count`, plus a per-day list of hashed client IPs (`seen:<yyyy-mm-dd>`) so
   a refresh-spam or double-tap from one address only counts once per day.
   This is a vanity number, not an audited metric: the client's localStorage
   guard does most of the de-duping and this is just a light server backstop.

     GET  -> { likes }
     POST -> { likes, counted }   counted:false when this IP already liked
                                  today (still returns the current total)
*/
const crypto = require('crypto');
const { getSiteStatsStore } = require('./_blobs-store');

const COUNT_KEY = 'count';

function todayKey() {
    return 'seen:' + new Date().toISOString().slice(0, 10);
}

function clientIpHash(event) {
    const h = event.headers || {};
    const ip = h['x-nf-client-connection-ip']
        || (h['x-forwarded-for'] || '').split(',')[0].trim()
        || 'unknown';
    return crypto.createHash('sha256').update(ip + '|osu-site-like').digest('hex').slice(0, 16);
}

async function readCount(store) {
    return Number(await store.get(COUNT_KEY, { type: 'text' })) || 0;
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
        if (event.httpMethod === 'GET') {
            return { statusCode: 200, headers, body: JSON.stringify({ likes: await readCount(store) }) };
        }

        if (event.httpMethod === 'POST') {
            const count = await readCount(store);
            const dayK = todayKey();
            const seen = (await store.get(dayK, { type: 'json' })) || [];
            const hash = clientIpHash(event);

            if (seen.includes(hash)) {
                return { statusCode: 200, headers, body: JSON.stringify({ likes: count, counted: false }) };
            }

            const next = count + 1;
            await store.set(COUNT_KEY, String(next));
            seen.push(hash);
            await store.setJSON(dayK, seen);
            return { statusCode: 200, headers, body: JSON.stringify({ likes: next, counted: true }) };
        }

        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
