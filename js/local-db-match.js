'use strict';
/* Local osu!.db matcher — replaces the removed directory-picker feature
   (see [[local-download-scan-2026-09]]): Chrome hard-blocks any website
   from being granted a *folder* handle under %AppData%, and that's exactly
   where osu! stable's default install puts everything, including its
   Songs folder. A plain `<input type="file">` pick of a single file is NOT
   subject to that restriction, so instead of asking for the Songs folder
   itself we ask for osu! stable's own "osu!.db" cache file (same
   %localappdata%\osu!\ folder, picked one file at a time) and parse it
   client-side — nothing here is ever uploaded anywhere.

   osu!.db is a private binary format with no official parser library; the
   field layout below is transcribed from the community-documented spec
   (https://github.com/ppy/osu/wiki/Legacy-database-file-structure) and
   cross-checked against real-world parser implementations, since the wiki's
   own field *names* are actively misleading: the field it calls "Beatmap
   ID" is actually the beatmapset id (shared by every difficulty of one
   song — the id this site's whole collection is keyed on), while the field
   it calls "Difficulty ID" is the per-difficulty id nobody here needs. */

const LOCAL_DB_IDS_KEY = 'osu_local_db_ids';
const LOCAL_DB_SYNCED_KEY = 'osu_local_db_synced_at';

let osuLocalDbIds = null; // Set<number> | null until first load/sync

function loadLocalDbIds() {
    if (osuLocalDbIds) return osuLocalDbIds;
    try {
        const raw = localStorage.getItem(LOCAL_DB_IDS_KEY);
        osuLocalDbIds = raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
        osuLocalDbIds = new Set();
    }
    return osuLocalDbIds;
}

function isLocalDbMatched(beatmapsetId) {
    return loadLocalDbIds().has(beatmapsetId);
}

// ---- binary reader --------------------------------------------------

// Plain closure-based reader (matches this file's/the site's non-class
// style) over an ArrayBuffer, tracking a moving byte offset.
function makeOsuDbReader(buffer) {
    const view = new DataView(buffer);
    const r = { view, pos: 0 };
    r.byte = () => { const v = view.getUint8(r.pos); r.pos += 1; return v; };
    r.bool = () => r.byte() !== 0;
    r.short = () => { const v = view.getUint16(r.pos, true); r.pos += 2; return v; };
    r.int = () => { const v = view.getInt32(r.pos, true); r.pos += 4; return v; };
    r.long = () => { r.pos += 8; }; // never needed as a value here, just skip
    r.single = () => { const v = view.getFloat32(r.pos, true); r.pos += 4; return v; };
    r.double = () => { const v = view.getFloat64(r.pos, true); r.pos += 8; return v; };
    r.uleb128 = () => {
        let result = 0, shift = 0, b;
        do {
            b = r.byte();
            result |= (b & 0x7f) << shift;
            shift += 7;
        } while (b & 0x80);
        return result >>> 0;
    };
    // String type: 0x00 = absent, 0x0b = ULEB128 length + UTF-8 bytes follow.
    r.string = () => {
        const flag = r.byte();
        if (flag !== 0x0b) return;
        const len = r.uleb128();
        r.pos += len; // never need the text itself, just skip past it
    };
    return r;
}

// Int-Double (or, post-20250107, Int-Float) pair collection: one per game
// mode, used for per-mod star ratings. We only need to walk past them.
function skipStarRatings(r, useSingle) {
    const count = r.int();
    for (let i = 0; i < count; i++) {
        r.byte(); // 0x08 tag
        r.int();  // mod combo
        r.byte(); // 0x0d (Double) or 0x0c (Single) tag
        useSingle ? r.single() : r.double();
    }
}

function skipTimingPoints(r) {
    const count = r.int();
    for (let i = 0; i < count; i++) { r.double(); r.double(); r.bool(); }
}

// Reads one beatmap entry and returns its beatmapset_id.
function readBeatmapEntry(r, version) {
    if (version < 20191106) r.int(); // legacy per-entry byte-size prefix
    r.string(); r.string(); r.string(); r.string(); // artist(+unicode), title(+unicode)
    r.string(); // creator
    r.string(); // difficulty name
    r.string(); // audio filename
    r.string(); // md5 hash
    r.string(); // .osu filename
    r.byte();   // ranked status
    r.short(); r.short(); r.short(); // hitcircles, sliders, spinners
    r.long();   // last modified
    if (version >= 20140609) { r.single(); r.single(); r.single(); r.single(); } // AR CS HP OD
    else { r.byte(); r.byte(); r.byte(); r.byte(); }
    r.double(); // slider velocity
    const useSingleRating = version > 20250107;
    for (let m = 0; m < 4; m++) skipStarRatings(r, useSingleRating); // osu/taiko/ctb/mania
    r.int(); r.int(); r.int(); // drain time, total time, preview time
    skipTimingPoints(r);
    r.int(); // "Difficulty ID" per the wiki — actually the per-diff beatmap id, unused here
    const beatmapsetId = r.int(); // "Beatmap ID" per the wiki — actually the beatmapset id
    r.int(); // thread id
    r.byte(); r.byte(); r.byte(); r.byte(); // grades (osu/taiko/ctb/mania)
    r.short();  // local beatmap offset
    r.single(); // stack leniency
    r.byte();   // mode
    r.string(); r.string(); // source, tags
    r.short();  // online offset
    r.string(); // font used for the title
    r.bool();   // unplayed
    r.long();   // last played
    r.bool();   // is osz2
    r.string(); // folder name
    r.long();   // last checked online
    r.bool(); r.bool(); r.bool(); r.bool(); r.bool(); // ignore sound/skin, disable storyboard/video, visual override
    if (version < 20140609) r.short(); // legacy unknown field
    r.int();   // last modification time
    r.byte();  // mania scroll speed
    return beatmapsetId;
}

// Parses a whole osu!.db buffer, returning { version, ids: Set<number> }.
// Throws on anything that doesn't look like a real osu!.db — callers should
// never trust a partial result out of a catch block.
function parseOsuDb(buffer) {
    const r = makeOsuDbReader(buffer);
    const version = r.int();
    if (!(version > 20100000 && version < 21000000)) throw new Error('not an osu!.db file');
    r.int();   // folder count
    r.bool();  // account unlocked
    r.long();  // date account unlocked
    r.string(); // player name
    const numBeatmaps = r.int();
    if (!(numBeatmaps >= 0 && numBeatmaps < 1000000)) throw new Error('unexpected beatmap count');
    const ids = new Set();
    for (let i = 0; i < numBeatmaps; i++) {
        const setId = readBeatmapEntry(r, version);
        if (Number.isInteger(setId) && setId > 0) ids.add(setId);
    }
    // After the last entry only the trailing "user permissions" Int should
    // remain — if we've drifted further than that, a field somewhere above
    // didn't match this file's actual layout and nothing downstream of the
    // drift point can be trusted.
    const remaining = r.view.byteLength - r.pos;
    if (remaining < 0 || remaining > 64) throw new Error('did not land at end of file');
    return { version, ids };
}

// ---- UI wiring --------------------------------------------------------

// Native file-picker dialogs can't be pre-filled or navigated by page JS
// (no web API exposes that, by design) — copying the path so the visitor
// can paste it into the dialog's filename field is the closest we can get
// to "jump straight there" without them having to type/remember it.
const LOCAL_DB_PATH = '%localappdata%\\osu!\\osu!.db';

function copyLocalDbPath() {
    const toast = (msg) => { if (typeof showShareToast === 'function') showShareToast(msg); };
    if (!navigator.clipboard || !navigator.clipboard.writeText) { toast(LOCAL_DB_PATH); return; }
    navigator.clipboard.writeText(LOCAL_DB_PATH).then(
        () => toast(t('local_db_path_copied')),
        () => toast(LOCAL_DB_PATH),
    );
}

function handleLocalDbFile(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    input.value = ''; // allow re-picking the same file again later
    if (!file) return;
    const toast = (msg) => { if (typeof showShareToast === 'function') showShareToast(msg); };
    const reader = new FileReader();
    reader.onerror = () => toast(t('local_db_fail'));
    reader.onload = () => {
        let parsed;
        try {
            parsed = parseOsuDb(reader.result);
        } catch (err) {
            console.error('[local-db-match]', err);
            toast(t('local_db_fail'));
            return;
        }
        if (parsed.ids.size === 0) {
            toast(t('local_db_none'));
            return;
        }
        osuLocalDbIds = parsed.ids;
        try {
            localStorage.setItem(LOCAL_DB_IDS_KEY, JSON.stringify(Array.from(parsed.ids)));
            localStorage.setItem(LOCAL_DB_SYNCED_KEY, String(Date.now()));
        } catch { /* storage full/unavailable — matching still works for this session */ }
        toast(t('local_db_done', { n: parsed.ids.size }));
        if (typeof renderOsuCollection === 'function') renderOsuCollection();
    };
    reader.readAsArrayBuffer(file);
}
