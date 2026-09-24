/* osu! API v1 從 Cloudflare Workers 打過去會被 429 限流（實測約 3/10），
   原因是 Workers 的對外 IP 是共用的，osu! 以 IP 計算配額。Netlify 上
   沒遇到是因為它的 CDN 會快取函式回應，真正打到上游的次數少得多。
   這裡退避重試：429 是暫時性的，隔幾百毫秒再試多半就過了。 */
async function apiFetch(url, label) {
    const delays = [400, 1200, 2500];
    let res;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
        res = await fetch(url);
        if (res.status !== 429) return res;
        if (attempt < delays.length) {
            await new Promise((r) => setTimeout(r, delays[attempt]));
        }
    }
    console.error(`osu! API v1 ${label}: 重試 ${delays.length} 次後仍為 429`);
    return res;
}

/* osu! API v1 失敗時回的是 HTML 錯誤頁，不是 JSON。原本各分支直接
   res.json()，於是任何上游問題都變成看不懂的
   "Unexpected token '<'" —— 看不出是金鑰失效、被速率限制，還是被擋。
   這裡集中檢查狀態碼與內容型別，並把實情記進 log。 */
async function readApiJson(res, label) {
    const body = await res.text();
    if (!res.ok || body.trimStart().startsWith('<')) {
        console.error(
            `osu! API v1 ${label} 失敗: HTTP ${res.status} ${res.headers.get('content-type') ?? ''} ` +
                body.slice(0, 200).replace(/\s+/g, ' '),
        );
        throw new Error(`osu! API v1 ${label} 失敗 (HTTP ${res.status})`);
    }
    return JSON.parse(body);
}

exports.handler = async (event) => {
    const API_KEY = process.env.OSU_API_KEY;
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const qs = event.queryStringParameters || {};
        const params = new URLSearchParams({ k: API_KEY });

        if (qs.recent) {
            params.set('u', qs.recent);
            params.set('type', qs.recent_type === 'string' ? 'string' : 'id');
            params.set('limit', qs.limit || '10');
            if (qs.m !== undefined) params.set('m', qs.m);
            const res = await apiFetch(`https://osu.ppy.sh/api/get_user_recent?${params.toString()}`, 'get_user_recent');
            const data = await readApiJson(res, 'get_user_recent');
            return { statusCode: 200, headers, body: JSON.stringify(data) };
        }

        if (qs.best) {
            params.set('u', qs.best);
            params.set('type', qs.best_type === 'string' ? 'string' : 'id');
            params.set('limit', qs.limit || '10');
            if (qs.m !== undefined) params.set('m', qs.m);
            const res = await apiFetch(`https://osu.ppy.sh/api/get_user_best?${params.toString()}`, 'get_user_best');
            const data = await readApiJson(res, 'get_user_best');
            return { statusCode: 200, headers, body: JSON.stringify(data) };
        }

        if (qs.u) {
            params.set('u', qs.u);
            params.set('type', qs.type === 'string' ? 'string' : 'id');
            if (qs.m !== undefined) params.set('m', qs.m);
            const res = await apiFetch(`https://osu.ppy.sh/api/get_user?${params.toString()}`, 'get_user');
            const data = await readApiJson(res, 'get_user');
            return { statusCode: 200, headers, body: JSON.stringify(data) };
        }

        if (qs.mapper) {
            // get_beatmaps' own `u` param filters by mapper (not by whoever
            // played it, despite the name) — same endpoint the no-param
            // branch below uses, just with an author filter instead of a
            // specific b=/s= id.
            params.set('u', qs.mapper);
            params.set('type', qs.mapper_type === 'string' ? 'string' : 'id');
            if (qs.m !== undefined) params.set('m', qs.m);
            const res = await apiFetch(`https://osu.ppy.sh/api/get_beatmaps?${params.toString()}`, 'get_beatmaps');
            const data = await readApiJson(res, 'get_beatmaps');
            return { statusCode: 200, headers, body: JSON.stringify(data) };
        }

        if (qs.scoreBeatmap) {
            // get_scores' own `u` filters to just that player's score(s) on
            // this one beatmap — exactly "did this user play this map, and
            // with what rank/miss count" (see checkCollectionPlayedStatus()).
            params.set('b', qs.scoreBeatmap);
            if (qs.scoreUser) {
                params.set('u', qs.scoreUser);
                params.set('type', qs.scoreUserType === 'string' ? 'string' : 'id');
            }
            if (qs.m !== undefined) params.set('m', qs.m);
            params.set('limit', '1');
            const res = await apiFetch(`https://osu.ppy.sh/api/get_scores?${params.toString()}`, 'get_scores');
            const data = await readApiJson(res, 'get_scores');
            return { statusCode: 200, headers, body: JSON.stringify(data) };
        }

        if (qs.b) params.set('b', qs.b);
        if (qs.s) params.set('s', qs.s);
        // h=<md5>: look a beatmap up by its file hash — used when importing an
        // in-game collection.db (js/osu.js importOsuGameCollection), whose
        // entries are MD5 hashes rather than ids.
        if (qs.h) params.set('h', qs.h);

        const res = await apiFetch(`https://osu.ppy.sh/api/get_beatmaps?${params.toString()}`, 'get_beatmaps');
        const data = await readApiJson(res, 'get_beatmaps');
        return { statusCode: 200, headers, body: JSON.stringify(data) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
