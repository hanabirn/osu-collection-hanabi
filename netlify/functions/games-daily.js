/* 每日猜圖 (osu!dle) backend.

   GET  ?date=YYYY-MM-DD (default: today, UTC)
        -> { date, coverUrl, previewUrl, maxGuesses, hintCount, done, result, streak }
        The answer + hint values are NOT sent here — the client gets a hint
        one at a time from POST responses.

   POST { date, guessNo (0-based), guess }
        -> { correct, done, revealHint: {k,v}|null, guessNo, answer?, streak? }
        On a correct guess or the last allowed guess, `answer` is included and
        (for a logged-in user) the result + streak are recorded.

   The day's puzzle is generated once from the ranked-catalog index
   (`catalog:all`), verified "recognisable" via one osu! API lookup
   (favourite_count), and cached in the games blob as `daily:<date>` with the
   answer kept server-side. */
const { getGamesStore, getCatalogStore } = require('./_blobs-store');
const { getOsuToken } = require('./_osu-auth');
const { verifyAuthToken } = require('./_auth-token');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const MAX_GUESSES = 3;                 // 6-way multiple choice => 2 hints then answer
const OPTION_COUNT = 6;
const FAVE_MIN = 150;                  // "recognisable enough" bar
const PICK_TRIES = 18;

const GENRES = {
    1: 'Unspecified', 2: 'Video Game', 3: 'Anime', 4: 'Rock', 5: 'Pop', 6: 'Other',
    7: 'Novelty', 9: 'Hip Hop', 10: 'Electronic', 11: 'Metal', 12: 'Classical',
    13: 'Folk', 14: 'Jazz',
};
const LANGS = {
    1: 'Unspecified', 2: 'English', 3: 'Japanese', 4: 'Chinese', 5: 'Instrumental',
    6: 'Korean', 7: 'French', 8: 'German', 9: 'Swedish', 10: 'Spanish', 11: 'Italian',
    12: 'Russian', 13: 'Polish', 14: 'Other',
};

const json = (code, obj, extraHeaders) => ({
    statusCode: code,
    headers: { ...CORS, ...(extraHeaders || {}) },
    body: JSON.stringify(obj),
});

function todayUTC() {
    return new Date().toISOString().slice(0, 10);
}
function prevDay(date) {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}
function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}
// Loose normalisation for guess matching — keeps CJK, drops case / punctuation
// / bracketed tags / feat. credits / "TV Size" etc.
function norm(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/\(tv (?:size|ver\.?)\)/g, ' ')
        .replace(/[[(].*?[\])]/g, ' ')
        .replace(/\b(?:feat|ft)\.?\s.*$/g, ' ')
        .replace(/[^a-z0-9぀-ヿ㐀-鿿가-힯]+/g, '')
        .trim();
}
function guessHits(guess, answer) {
    const g = norm(guess);
    if (g.length < 2) return false;
    for (const cand of [answer.titleN, answer.titleUN].filter(Boolean)) {
        if (g === cand) return true;
        // substring match only for a guess that's substantial on its own —
        // "gho" shouldn't win "ghost"
        if (g.length >= 4 && cand.length >= 4 && (g.includes(cand) || cand.includes(g))) return true;
    }
    // "artist - title" style guesses
    const at = norm(`${answer.artist} ${answer.title}`);
    if (at.length >= 6 && g === at) return true;
    return false;
}

async function resolveSet(id, token) {
    try {
        const res = await fetch(`https://osu.ppy.sh/api/v2/beatmapsets/${id}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

async function buildPuzzle(date) {
    const catalog = getCatalogStore();
    const dataset = (await catalog.get('catalog:all', { type: 'json' })) || [];
    const cands = dataset.filter(r =>
        r.id && !r.nsfw && r.ranked_date &&
        Array.isArray(r.modes) && r.modes.includes(0) &&
        (r.primary_artist || r.artist) && (r.title_unicode || r.title) &&
        r.star_max != null && r.star_max >= 3 && r.star_max <= 8);
    if (!cands.length) return null;

    const token = await getOsuToken();
    let picked = null;
    for (let attempt = 0; attempt < PICK_TRIES; attempt++) {
        const rec = cands[hashStr(`${date}:${attempt}`) % cands.length];
        const set = await resolveSet(rec.id, token);
        if (!set || !set.covers || !set.preview_url) continue;
        picked = set;
        if ((set.favourite_count || 0) >= FAVE_MIN) break; // else keep as fallback, try for a better one
    }
    if (!picked) return null;

    const diffs = (picked.beatmaps || []).map(b => b.difficulty_rating).filter(n => n > 0);
    const srMin = diffs.length ? Math.min(...diffs) : null;
    const srMax = diffs.length ? Math.max(...diffs) : null;
    const genreId = (picked.genre && picked.genre.id) || picked.genre_id || null;
    const genreName = (picked.genre && picked.genre.name) || GENRES[genreId] || 'Other';
    const langName = (picked.language && picked.language.name) || LANGS[picked.language_id] || 'Other';

    // Two hints get shown (one per wrong pick) — put the discriminating ones
    // first since the decoys already share genre / rough difficulty.
    const hints = [
        { k: 'year', v: String(picked.ranked_date || '').slice(0, 4) || '—' },
        { k: 'mapper', v: picked.creator || '—' },
        { k: 'sr', v: srMin != null ? `${srMin.toFixed(2)}★ – ${srMax.toFixed(2)}★` : '—' },
        { k: 'lang', v: langName },
        { k: 'genre', v: genreName },
    ];

    // 5 plausible-but-wrong options: same genre, similar top difficulty,
    // different primary artist. Relax to any candidate if that's too tight.
    const answerArtistN = (picked.artist || '').toLowerCase();
    const answerSR = srMax || 5;
    let decoyPool = cands.filter(r =>
        r.id !== picked.id &&
        (r.primary_artist || r.artist || '').toLowerCase() !== answerArtistN &&
        (genreId ? r.genre_id === genreId : true) &&
        Math.abs((r.star_max || 5) - answerSR) <= 1.8);
    if (decoyPool.length < OPTION_COUNT - 1) {
        decoyPool = cands.filter(r => r.id !== picked.id && (r.title_unicode || r.title));
    }
    const decoys = [];
    const seen = new Set([picked.id]);
    for (let i = 0; decoyPool.length && decoys.length < OPTION_COUNT - 1 && i < 400; i++) {
        const r = decoyPool[hashStr(`${date}:decoy:${i}`) % decoyPool.length];
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        decoys.push(r);
    }
    const optRecs = [...decoys.map(r => ({ id: r.id, artist: r.artist, title: r.title })),
        { id: picked.id, artist: picked.artist, title: picked.title }];
    for (let i = optRecs.length - 1; i > 0; i--) {
        const j = hashStr(`${date}:shuf:${i}`) % (i + 1);
        [optRecs[i], optRecs[j]] = [optRecs[j], optRecs[i]];
    }
    const options = optRecs.map(r => ({
        id: r.id,
        text: `${r.artist || ''} - ${r.title || ''}`.trim().slice(0, 90),
    }));

    return {
        date,
        setId: picked.id,
        coverUrl: (picked.covers['cover@2x'] || picked.covers.cover || `https://assets.ppy.sh/beatmaps/${picked.id}/covers/cover@2x.jpg`),
        previewUrl: picked.preview_url ? (picked.preview_url.startsWith('http') ? picked.preview_url : `https:${picked.preview_url}`) : null,
        hints,
        options,
        answer: {
            title: picked.title || '',
            artist: picked.artist || '',
            creator: picked.creator || '',
            setId: picked.id,
            url: `https://osu.ppy.sh/beatmapsets/${picked.id}`,
            titleN: norm(picked.title),
            titleUN: norm(picked.title_unicode || ''),
        },
    };
}

async function getPuzzle(store, date) {
    let p = await store.get(`daily:${date}`, { type: 'json' });
    if (p) return p;
    p = await buildPuzzle(date);
    if (p) await store.setJSON(`daily:${date}`, p);
    return p;
}

function userFrom(event) {
    const h = event.headers || {};
    const auth = h.authorization || h.Authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    return token ? verifyAuthToken(token) : null;
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

    const store = getGamesStore();
    const user = userFrom(event);

    // ---------- GET: the day's puzzle shell ----------
    if (event.httpMethod === 'GET') {
        const date = ((event.queryStringParameters || {}).date || todayUTC()).slice(0, 10);
        if (date > todayUTC()) return json(400, { error: 'no future puzzles' });
        const p = await getPuzzle(store, date);
        if (!p) return json(503, { error: 'puzzle not ready, try again shortly' });

        let result = null, streak = null;
        if (user) {
            result = await store.get(`daily-result:${date}:${user.id}`, { type: 'json' });
            const s = await store.get(`streak:${user.id}`, { type: 'json' });
            streak = s ? s.streak : 0;
        }
        return json(200, {
            date,
            coverUrl: p.coverUrl,
            previewUrl: p.previewUrl,
            maxGuesses: MAX_GUESSES,
            hintCount: Math.max(0, MAX_GUESSES - 1),
            options: p.options || [],
            done: !!result,
            result: result ? { won: !!result.won, guesses: result.guesses } : null,
            answer: result ? { title: p.answer.title, artist: p.answer.artist, creator: p.answer.creator, setId: p.answer.setId, url: p.answer.url } : null,
            streak,
        }, { 'Cache-Control': 'no-store' });
    }

    // ---------- POST: check a pick ----------
    if (event.httpMethod !== 'POST') return json(405, { error: 'GET or POST' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
    const date = String(body.date || todayUTC()).slice(0, 10);
    const guessNo = Math.max(0, Math.min(MAX_GUESSES - 1, parseInt(body.guessNo, 10) || 0));
    if (date > todayUTC()) return json(400, { error: 'no future puzzles' });

    const p = await getPuzzle(store, date);
    if (!p) return json(503, { error: 'puzzle not ready, try again shortly' });

    // choiceId is the picked beatmapset id; free-text `guess` still accepted
    // as a fallback (older client).
    const correct = body.choiceId != null
        ? String(body.choiceId) === String(p.answer.setId)
        : guessHits(String(body.guess || '').slice(0, 200), p.answer);
    const isLast = guessNo >= MAX_GUESSES - 1;
    const done = correct || isLast;
    const revealHint = (!correct && !isLast) ? (p.hints[guessNo] || null) : null;

    let streak = null;
    if (done && user) {
        const prev = await store.get(`daily-result:${date}:${user.id}`, { type: 'json' });
        if (!prev) {
            await store.setJSON(`daily-result:${date}:${user.id}`, {
                won: correct, guesses: guessNo + 1, at: new Date().toISOString(),
            });
            const s = (await store.get(`streak:${user.id}`, { type: 'json' })) || { streak: 0, maxStreak: 0, lastDate: null };
            if (correct) {
                s.streak = s.lastDate === prevDay(date) ? (s.streak || 0) + 1 : 1;
            } else {
                s.streak = 0;
            }
            s.lastDate = date;
            s.maxStreak = Math.max(s.maxStreak || 0, s.streak);
            await store.setJSON(`streak:${user.id}`, s);
            streak = s.streak;
        } else {
            const s = await store.get(`streak:${user.id}`, { type: 'json' });
            streak = s ? s.streak : null;
        }
    }

    return json(200, {
        correct,
        done,
        guessNo,
        revealHint,
        answer: done ? { title: p.answer.title, artist: p.answer.artist, creator: p.answer.creator, setId: p.answer.setId, url: p.answer.url } : null,
        streak,
    }, { 'Cache-Control': 'no-store' });
};
