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
            const res = await fetch(`https://osu.ppy.sh/api/get_user_recent?${params.toString()}`);
            const data = await res.json();
            return { statusCode: 200, headers, body: JSON.stringify(data) };
        }

        if (qs.best) {
            params.set('u', qs.best);
            params.set('type', qs.best_type === 'string' ? 'string' : 'id');
            params.set('limit', qs.limit || '10');
            if (qs.m !== undefined) params.set('m', qs.m);
            const res = await fetch(`https://osu.ppy.sh/api/get_user_best?${params.toString()}`);
            const data = await res.json();
            return { statusCode: 200, headers, body: JSON.stringify(data) };
        }

        if (qs.u) {
            params.set('u', qs.u);
            params.set('type', qs.type === 'string' ? 'string' : 'id');
            if (qs.m !== undefined) params.set('m', qs.m);
            const res = await fetch(`https://osu.ppy.sh/api/get_user?${params.toString()}`);
            const data = await res.json();
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
            const res = await fetch(`https://osu.ppy.sh/api/get_beatmaps?${params.toString()}`);
            const data = await res.json();
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
            const res = await fetch(`https://osu.ppy.sh/api/get_scores?${params.toString()}`);
            const data = await res.json();
            return { statusCode: 200, headers, body: JSON.stringify(data) };
        }

        if (qs.b) params.set('b', qs.b);
        if (qs.s) params.set('s', qs.s);
        // h=<md5>: look a beatmap up by its file hash — used when importing an
        // in-game collection.db (js/osu.js importOsuGameCollection), whose
        // entries are MD5 hashes rather than ids.
        if (qs.h) params.set('h', qs.h);

        const res = await fetch(`https://osu.ppy.sh/api/get_beatmaps?${params.toString()}`);
        const data = await res.json();
        return { statusCode: 200, headers, body: JSON.stringify(data) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
