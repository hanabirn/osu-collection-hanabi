/* Server-side copy of js/osu.js's primaryArtist() / artistKeys() — the
   catalog crawler (_catalog-crawl-core.js) pre-computes primary_artist and
   artist_keys per set so catalog-list.js can facet on artist without
   re-parsing every record on every request.

   SOURCE OF TRUTH IS js/osu.js (lines ~100-128). Keep the two in sync — the
   collection page's artist filter and this crawler must bucket a given
   "Camellia feat. Nanahira" identically. */

/* Collapses an osu! Artist string to its lead artist: strips a trailing
   feat./ft./featuring or (CV: ...), never inner separators like "&", ",",
   or "vs." (a mashup stays its own entry). */
function primaryArtist(artist) {
    let a = (artist || '').trim();
    if (!a) return '';
    a = a.replace(/\s*\((?:CV|cv)[:：][^)]*\)\s*$/, '');
    a = a.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.+$/i, '');
    return a.trim();
}

/* Every artist a set should be findable under: the lead artist plus any name
   credited after a feat./ft./featuring, split on the safe separators only
   (",", "&", "×", " x "). Deduped. */
function artistKeys(artist) {
    const raw = (artist || '').trim();
    if (!raw) return [];
    const keys = new Set();
    const lead = primaryArtist(raw);
    if (lead) keys.add(lead);
    const m = raw.match(/\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/i);
    if (m) {
        const tail = m[1].replace(/\s*\([^)]*\)\s*$/, '');
        for (const part of tail.split(/\s*[,&×]\s*|\s+x\s+/i)) {
            const p = part.trim();
            if (p) keys.add(p);
        }
    }
    return [...keys];
}

module.exports = { primaryArtist, artistKeys };
