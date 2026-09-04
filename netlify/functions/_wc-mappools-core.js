/* Shared crawl logic for the official World Cup mappool index — used by the
   scheduled handler (wc-mappool-crawl-cron.js) and the manual/backfill HTTP
   endpoint (wc-mappool-crawl-run.js). Read side is wc-mappools-list.js.

   Source: the ppy/osu-wiki markdown, one file per tournament edition, e.g.
     wiki/Tournaments/OWC/2024/en.md
   Every edition 2011..now uses the same "## Mappools" layout:
     ### Grand Finals
     **[Download the mappack here (185 MB)](https://packs.ppy.sh/…zip)**\
     [View the showcase VOD here](https://twitch.tv/…)
     - No Mod
       1. [Artist - Title (Mapper) \[Diff\]](https://osu.ppy.sh/beatmapsets/2287859#osu/4881501)
     - Tiebreaker
       1. **[Artist - Title (Mapper) \[Diff\]](…#osu/…)**
   Each map link carries setId + ruleset + beatmapId, so real metadata comes
   from GET /api/v2/beatmaps?ids[]=… (the wiki text is only a fallback).

   State lives in the osu-wc-mappools Blobs store:
     - `wc-state`     : { pageHashes, known404, resolveQueue, coverage, lastRunAt, lastError }
     - `pools:all`    : array of edition objects { key, variant, year, folder, label, rounds:[…] }
     - `beatmaps:cache`: { [beatmapId]: { setId, mode, artist, title, creator, version, stars, bpm, length, status } | { unresolvable:true } }

   Data is ~annual and near-static: a full folder sweep is ~90 CDN GETs
   (fast, unauthenticated, no rate limit), hash-compared so re-parses only
   happen when a page actually changed. Metadata resolution is the only
   multi-run part and only on the initial fill. */
const crypto = require('crypto');
const { getOsuToken } = require('./_osu-auth');
const { getWcMappoolsStore } = require('./_blobs-store');

const STATE_KEY = 'wc-state';
const DATASET_KEY = 'pools:all';
const BEATMAP_CACHE_KEY = 'beatmaps:cache';

const WIKI_BASE = 'https://raw.githubusercontent.com/ppy/osu-wiki/master/wiki/Tournaments';
const UA = 'osu-collection-hanabi/1.0 (+https://github.com/hanabirn/osu-collection-hanabi)';
const FETCH_CONCURRENCY = 8;
const RESOLVE_CHUNK = 50;
const REVISIT_404_MS = 30 * 24 * 60 * 60 * 1000; // re-check a missing folder monthly

function freshState() {
    return { pageHashes: {}, known404: {}, resolveQueue: [], coverage: null, lastRunAt: null, lastSweepAt: null, lastError: null };
}

function sha1(s) {
    return crypto.createHash('sha1').update(s).digest('hex');
}

/* Candidate wiki folders. A superset — 404s are recorded and skipped for a
   month. The edition's real year is parsed from the page content, not the
   folder name, so early ordinal folders (OWC/1, CWC/2, …) just work. */
function buildCandidates() {
    const now = new Date().getUTCFullYear();
    const out = [];
    for (const y of ['1', '2', '3', '4', '5']) {
        out.push({ key: 'OWC', variant: '', folder: `OWC/${y}` });
        out.push({ key: 'TWC', variant: '', folder: `TWC/${y}` });
        out.push({ key: 'CWC', variant: '', folder: `CWC/${y}` });
    }
    for (let y = 2011; y <= now + 1; y++) {
        out.push({ key: 'OWC', variant: '', folder: `OWC/${y}` });
        out.push({ key: 'TWC', variant: '', folder: `TWC/${y}` });
        out.push({ key: 'CWC', variant: '', folder: `CWC/${y}` });
        out.push({ key: 'MWC', variant: '4K', folder: `MWC/${y}_4K` });
        out.push({ key: 'MWC', variant: '7K', folder: `MWC/${y}_7K` });
    }
    // Early MWC (2014-15) was 4K-only and lives in a bare-year folder.
    out.push({ key: 'MWC', variant: '4K', folder: 'MWC/2014' });
    out.push({ key: 'MWC', variant: '4K', folder: 'MWC/2015' });
    return out;
}

function normBracket(raw) {
    const k = raw.toLowerCase().replace(/[\s_]+/g, '');
    const map = {
        nomod: 'No Mod', hidden: 'Hidden', hardrock: 'Hard Rock',
        doubletime: 'Double Time', freemod: 'Free Mod', tiebreaker: 'Tiebreaker',
        tiebreak: 'Tiebreaker', rice: 'Rice', longnote: 'Long Note', ln: 'Long Note',
        hybrid: 'Hybrid', sv: 'SV', extreme: 'Extreme', mixedmod: 'Mixed Mod',
    };
    return map[k] || raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseHeader(md) {
    const h1 = md.match(/^#\s+(.+?)\s*$/m);
    const label = h1 ? h1[1].trim() : null;
    const ym = (label && label.match(/(20\d{2})/)) || md.match(/World Cup\s+(20\d{2})/i) || md.slice(0, 2000).match(/(20\d{2})/);
    return { label, year: ym ? Number(ym[1]) : null };
}

/* Pull the "## Mappools" section into rounds → brackets → maps. */
function parseMappools(md) {
    const lines = md.split(/\r?\n/);
    let i = lines.findIndex((l) => /^##\s+Mappools\s*$/i.test(l));
    if (i < 0) return [];
    const rounds = [];
    let round = null;
    let bracket = null;

    for (i++; i < lines.length; i++) {
        const line = lines[i];
        if (/^##\s+/.test(line)) break; // next top-level section

        let m;
        if ((m = line.match(/^###\s+(.+?)\s*$/))) {
            round = { name: m[1].trim(), mappackUrl: null, showcaseUrl: null, brackets: [] };
            rounds.push(round);
            bracket = null;
            continue;
        }
        if (!round) continue;

        if (/download the mappack/i.test(line)) {
            const u = line.match(/\]\((https?:\/\/[^)]+)\)/);
            if (u) round.mappackUrl = u[1];
            continue;
        }
        if (/showcase|showcase vod/i.test(line) && /\]\(https?:/i.test(line)) {
            const u = line.match(/\]\((https?:\/\/[^)]+)\)/);
            if (u) round.showcaseUrl = u[1];
            continue;
        }

        const link = line.match(/osu\.ppy\.sh\/beatmapsets\/(\d+)#(osu|taiko|fruits|mania)\/(\d+)/);
        const isMapLine = link && /^\s*\d+\.\s/.test(line);

        // Bracket label: a bullet that is NOT a link line, e.g. "- No Mod",
        // "- FreeMod (*to be played in order*)".
        if (!isMapLine && (m = line.match(/^\s*[-*]\s+([A-Za-z][^[\]()]*?)\s*(?:\(\*[^)]*\*\)|\*[^*]*\*)?\s*$/))) {
            const lbl = m[1].trim();
            if (lbl) {
                bracket = { label: normBracket(lbl), maps: [] };
                round.brackets.push(bracket);
            }
            continue;
        }

        if (isMapLine) {
            if (!bracket) {
                bracket = { label: 'Pool', maps: [] };
                round.brackets.push(bracket);
            }
            const textM = line.match(/\[\s*\**(.+?)\**\s*\]\(/);
            const isTb = /^\s*\d+\.\s*\*\*/.test(line) || /tiebreak/i.test(bracket.label);
            bracket.maps.push({
                setId: Number(link[1]),
                mode: link[2],
                beatmapId: Number(link[3]),
                wikiText: textM ? textM[1].replace(/\\([\\_*~`[\]])/g, '$1').trim() : '',
                isTiebreaker: isTb,
            });
        }
    }

    // Drop rounds/brackets that yielded no parseable maps.
    for (const r of rounds) r.brackets = r.brackets.filter((b) => b.maps.length);
    return rounds.filter((r) => r.brackets.length);
}

function shrinkBeatmap(b) {
    const set = b.beatmapset || {};
    return {
        setId: b.beatmapset_id || set.id || null,
        mode: b.mode || null,
        artist: set.artist || '',
        title: set.title || '',
        creator: set.creator || '',
        version: b.version || '',
        stars: typeof b.difficulty_rating === 'number' ? b.difficulty_rating : null,
        bpm: typeof b.bpm === 'number' ? b.bpm : null,
        length: typeof b.total_length === 'number' ? b.total_length : null,
        status: b.status || '',
    };
}

async function resolveBatch(ids, token) {
    const qs = ids.map((id) => `ids[]=${id}`).join('&');
    const res = await fetch(`https://osu.ppy.sh/api/v2/beatmaps?${qs}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`beatmaps lookup failed: ${res.status}`);
    const data = await res.json();
    return data.beatmaps || [];
}

function computeCoverage(pools, cache) {
    let maps = 0;
    let resolved = 0;
    let unresolvable = 0;
    for (const p of pools) {
        for (const r of p.rounds) {
            for (const b of r.brackets) {
                for (const m of b.maps) {
                    maps++;
                    const c = cache[m.beatmapId];
                    if (c && c.unresolvable) unresolvable++;
                    else if (c) resolved++;
                }
            }
        }
    }
    return { editions: pools.length, maps, resolved, unresolvable };
}

async function runCrawlBatch(budgetMs) {
    const start = Date.now();
    const store = getWcMappoolsStore();
    const state = (await store.get(STATE_KEY, { type: 'json' })) || freshState();
    if (!state.pageHashes) state.pageHashes = {};
    if (!state.known404) state.known404 = {};
    if (!Array.isArray(state.resolveQueue)) state.resolveQueue = [];
    let pools = (await store.get(DATASET_KEY, { type: 'json' })) || [];
    const cache = (await store.get(BEATMAP_CACHE_KEY, { type: 'json' })) || {};

    let pagesFetched = 0;
    let pagesParsed = 0;
    let resolved = 0;
    let error = null;
    const seenQueue = new Set(state.resolveQueue);

    try {
        // ── Phase 1: discover / re-parse changed wiki pages ──
        const candidates = buildCandidates();
        const phase1Deadline = start + Math.min(budgetMs * 0.5, 8000);
        for (let i = 0; i < candidates.length; i += FETCH_CONCURRENCY) {
            if (Date.now() > phase1Deadline) break;
            const chunk = candidates.slice(i, i + FETCH_CONCURRENCY).filter((c) => {
                const miss = state.known404[c.folder];
                return !(miss && Date.now() - miss < REVISIT_404_MS);
            });
            const results = await Promise.all(chunk.map(async (c) => {
                try {
                    const res = await fetch(`${WIKI_BASE}/${c.folder}/en.md`, { headers: { 'User-Agent': UA } });
                    if (res.status === 404) return { c, status: 404 };
                    if (!res.ok) return { c, status: res.status };
                    return { c, status: 200, md: await res.text() };
                } catch (e) {
                    return { c, status: 0, err: e.message };
                }
            }));
            for (const r of results) {
                if (!r) continue;
                pagesFetched++;
                const folder = r.c.folder;
                if (r.status === 404) {
                    state.known404[folder] = Date.now();
                    pools = pools.filter((p) => p.folder !== folder);
                    continue;
                }
                if (r.status !== 200 || !r.md) continue;
                delete state.known404[folder];
                const hash = sha1(r.md);
                if (state.pageHashes[folder] === hash) continue;
                const { label, year } = parseHeader(r.md);
                const rounds = parseMappools(r.md);
                state.pageHashes[folder] = hash;
                if (!rounds.length || !year) {
                    pools = pools.filter((p) => p.folder !== folder);
                    continue;
                }
                pools = pools.filter((p) => p.folder !== folder);
                pools.push({
                    key: r.c.key,
                    variant: r.c.variant,
                    year,
                    folder,
                    label: label || `${r.c.key}${r.c.variant ? ' ' + r.c.variant : ''} ${year}`,
                    updatedAt: new Date().toISOString(),
                    rounds,
                });
                pagesParsed++;
                for (const rd of rounds) {
                    for (const b of rd.brackets) {
                        for (const mp of b.maps) {
                            if (!cache[mp.beatmapId] && !seenQueue.has(mp.beatmapId)) {
                                state.resolveQueue.push(mp.beatmapId);
                                seenQueue.add(mp.beatmapId);
                            }
                        }
                    }
                }
            }
        }

        // ── Phase 2: resolve real beatmap metadata (only backlog does work) ──
        if (state.resolveQueue.length) {
            const token = await getOsuToken();
            while (state.resolveQueue.length && Date.now() - start < budgetMs) {
                const batch = state.resolveQueue.slice(0, RESOLVE_CHUNK);
                const got = await resolveBatch(batch, token);
                const gotIds = new Set(got.map((b) => b.id));
                for (const b of got) cache[b.id] = shrinkBeatmap(b);
                for (const id of batch) if (!gotIds.has(id)) cache[id] = { unresolvable: true };
                state.resolveQueue = state.resolveQueue.slice(batch.length);
                resolved += batch.length;
            }
        }
    } catch (err) {
        error = err.message;
    }

    pools.sort((a, b) => a.key.localeCompare(b.key) || a.variant.localeCompare(b.variant) || a.year - b.year);
    state.lastRunAt = new Date().toISOString();
    state.lastError = error;
    state.coverage = computeCoverage(pools, cache);
    await store.setJSON(STATE_KEY, state);
    await store.setJSON(DATASET_KEY, pools);
    await store.setJSON(BEATMAP_CACHE_KEY, cache);

    return {
        pagesFetched,
        pagesParsed,
        resolved,
        queueLeft: state.resolveQueue.length,
        editions: pools.length,
        coverage: state.coverage,
        error,
    };
}

module.exports = {
    runCrawlBatch, STATE_KEY, DATASET_KEY, BEATMAP_CACHE_KEY,
    // exported for offline testing / debugging of the wiki-markdown parser
    parseMappools, parseHeader, normBracket, buildCandidates,
};
