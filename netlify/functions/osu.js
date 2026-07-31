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

        if (qs.u) {
            params.set('u', qs.u);
            params.set('type', qs.type === 'string' ? 'string' : 'id');
            if (qs.m !== undefined) params.set('m', qs.m);
            const res = await fetch(`https://osu.ppy.sh/api/get_user?${params.toString()}`);
            const data = await res.json();
            return { statusCode: 200, headers, body: JSON.stringify(data) };
        }

        if (qs.b) params.set('b', qs.b);
        if (qs.s) params.set('s', qs.s);

        const res = await fetch(`https://osu.ppy.sh/api/get_beatmaps?${params.toString()}`);
        const data = await res.json();
        return { statusCode: 200, headers, body: JSON.stringify(data) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
