/* ===== Osekai medal database proxy =====
   osu!'s own API only ever returns achievement *ids* for a user (see
   osu-user-achievements.js's header comment — there's no public osu! API
   endpoint for medal names/icons/descriptions/rarity), so this proxies
   osekai.net's public medals endpoint to fill that gap: name, icon,
   description, category and global rarity % per medal, keyed by the same
   achievement id osu!'s API uses. Trimmed down to only the fields the medal
   gallery UI actually renders — the raw osekai response also carries
   solution text, pack ids, etc. that would just bloat the payload. Cached
   for 6 hours since the medal list barely changes between osu! updates. */
const OSEKAI_MEDALS_URL = 'https://osekai.net/medals/api/medals.php';
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    try {
        const res = await fetch(OSEKAI_MEDALS_URL);
        if (!res.ok) throw new Error(`osekai.net returned ${res.status}`);
        const raw = await res.json();

        const medals = (Array.isArray(raw) ? raw : []).map(m => ({
            id: m.MedalID,
            name: m.Name,
            icon: m.Link,
            description: m.Description,
            grouping: m.Grouping,
            rarity: typeof m.Rarity === 'number' ? m.Rarity : parseFloat(m.Rarity) || null,
        })).filter(m => Number.isFinite(m.id));

        return {
            statusCode: 200,
            headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=21600' },
            body: JSON.stringify({ medals }),
        };
    } catch (err) {
        return { statusCode: 502, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
