/* ===== osu! Tournaments proxy =====
   Lists recent topics from the official "Tournaments" subforum
   (osu.ppy.sh/community/forums/55) via API v2's forum topics endpoint —
   that forum page itself is server-rendered with no public JSON endpoint,
   same situation as the news listing. See _osu-auth.js for the shared
   OAuth token helper.

   Each topic also gets a best-effort `thumb`: the topic list endpoint
   itself carries no image, only the opening post's rendered body does (via
   GET /forums/topics/{id}), so this fires one follow-up request per topic
   to pull that post's first <img> — the same "grab the first image out of
   the post body" a forum's own thread-preview thumbnail would do. Capped
   at concurrency 5 (25 topics × 1 request each, unbounded, risked either
   tripping the API's rate limit or just being needlessly bursty) and never
   lets one topic's failure fail the whole response — a topic simply keeps
   thumb: null, same as a plain-text post with no image ever would. */
const { getOsuToken } = require('./_osu-auth');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const TOURNAMENTS_FORUM_ID = 55;
const THUMB_FETCH_CONCURRENCY = 5;

async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

/* First <img src="..."> in the post's rendered BBCode HTML, attribute
   order-agnostic (osu!'s renderer puts alt="" before src on gallery
   images, see the sample this was written against). */
function extractFirstImageSrc(html) {
    const match = /<img\b[^>]*\bsrc="([^"]*)"/i.exec(html || '');
    return match ? match[1] : null;
}

async function fetchTopicThumb(token, topicId) {
    try {
        const res = await fetch(`https://osu.ppy.sh/api/v2/forums/topics/${topicId}?limit=1`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        if (!res.ok) return null;
        const data = await res.json();
        const firstPost = data.posts && data.posts[0];
        return firstPost ? extractFirstImageSrc(firstPost.body && firstPost.body.html) : null;
    } catch {
        return null;
    }
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    try {
        const token = await getOsuToken();
        const res = await fetch(`https://osu.ppy.sh/api/v2/forums/topics?forum_id=${TOURNAMENTS_FORUM_ID}&sort=new`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        if (!res.ok) throw new Error('osu! forum topics request failed');
        const data = await res.json();

        const topics = data.topics || [];
        const thumbs = await mapWithConcurrency(topics, THUMB_FETCH_CONCURRENCY, t => fetchTopicThumb(token, t.id));
        topics.forEach((topic, i) => { topic.thumb = thumbs[i]; });

        return { statusCode: 200, headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=600' }, body: JSON.stringify({ ...data, topics }) };
    } catch (err) {
        return { statusCode: 500, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
