/* ===== Replay player: visitor skins (.osk) =====
   An osu! skin is a zip of images + skin.ini. For mania the player needs the
   [Mania] section for the key count (column widths, hit position, image
   names per column) and the images it names, falling back to the standard
   file names (mania-note1, mania-key1D, mania-hit300g, ...). @2x images win
   over plain ones and are drawn at half their pixel size, as in the game.
   The .osk the visitor picks is kept in their browser (IndexedDB) so it
   stays for next time; nothing is uploaded anywhere. */
(function () {
    const DB = 'osu-replay-skin', STORE = 'skin';

    function idb(mode, op) {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction(STORE, mode);
                const r = op(tx.objectStore(STORE));
                tx.oncomplete = () => { db.close(); resolve(r ? r.result : undefined); };
                tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
            };
        });
    }

    /* skin.ini -> { general: {}, mania: { [keys]: {} } } (keys of [Mania] kept as written) */
    function parseSkinIni(text) {
        const out = { general: {}, colours: {}, fonts: {}, ctb: {}, mania: {} };
        let sec = '', cur = null;
        for (const raw of text.split(/\r?\n/)) {
            const line = raw.replace(/\/\/.*$/, '').trim();
            if (!line) continue;
            const m = /^\[(\w+)\]$/.exec(line);
            if (m) { sec = m[1].toLowerCase(); cur = sec === 'mania' ? {} : null; continue; }
            const i = line.indexOf(':');
            if (i < 0) continue;
            const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
            if (sec === 'mania') {
                cur[k] = v;
                if (k === 'Keys') out.mania[Number(v)] = cur;
            } else if (sec === 'general') out.general[k] = v;
            else if (sec === 'colours') out.colours[k] = v;
            else if (sec === 'fonts') out.fonts[k] = v;
            else if (sec === 'catchthebeat') out.ctb[k] = v;
        }
        return out;
    }

    const list = (v, n, d) => {
        const a = String(v ?? '').split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
        return Array.from({ length: n }, (_, i) => (a.length ? a[Math.min(i, a.length - 1)] : d));
    };
    const colour = (v) => {
        if (!v) return null;
        const [r, g, b, a] = v.split(',').map((x) => Number(x.trim()));
        return Number.isFinite(r) ? `rgba(${r},${g},${b},${Number.isFinite(a) ? a / 255 : 1})` : null;
    };

    function skinVersion(v) {
        if (!v) return 1;
        if (/latest/i.test(v)) return 99;
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : 1;
    }

    /* the default image letter for a column: 1/2 alternating out from the
       middle, S for the middle column of an odd key count (4K: 1 2 2 1) */
    function columnType(keys, c) {
        const mid = (keys - 1) / 2;
        if (keys % 2 === 1 && c === mid) return 'S';
        return (c < mid ? c : keys - 1 - c) % 2 === 0 ? '1' : '2';
    }

    async function loadSkin(blob, name) {
        const F = window.replayFormats;
        const zip = await F.readZip(await blob.arrayBuffer());
        // the outermost skin.ini (a zip may carry alternates in subfolders)
        const iniEntry = zip.entries
            .filter((e) => /(^|\/)skin\.ini$/i.test(e.name))
            .sort((p, q) => p.name.split('/').length - q.name.split('/').length)[0];
        const ini = iniEntry ? parseSkinIni(new TextDecoder().decode(await zip.read(iniEntry))) : { general: {}, colours: {}, fonts: {}, mania: {} };
        const base = iniEntry ? iniEntry.name.replace(/skin\.ini$/i, '') : '';
        const index = new Map(zip.entries.map((e) => [e.name.toLowerCase().replace(/\\/g, '/'), e]));
        const cache = new Map();
        // "mania/note1" -> ImageBitmap at 1x scale (s = 0.5 for @2x)
        async function image(path) {
            if (!path) return null;
            const key = path.toLowerCase().replace(/\\/g, '/');
            if (cache.has(key)) return cache.get(key);
            const p = (async () => {
                for (const [suffix, s] of [['@2x', 0.5], ['', 1]]) {
                    for (const frame of ['', '-0']) {
                        for (const ext of ['.png', '.jpg']) {
                            const e = index.get(`${base}${key}${frame}${suffix}${ext}`.toLowerCase()) || index.get(`${key}${frame}${suffix}${ext}`);
                            if (!e) continue;
                            try {
                                const bmp = await createImageBitmap(new Blob([await zip.read(e)]));
                                if (bmp.width <= 1 && bmp.height <= 1) return null; // a blank placeholder hides the element
                                return { bmp, s };
                            } catch { /* unreadable image: try the next */ }
                        }
                    }
                }
                return null;
            })();
            cache.set(key, p);
            return p;
        }

        // whether the skin has a file for this element at all (a blank one still counts:
        // it means "draw nothing", not "use the default")
        function exists(path) {
            const key = path.toLowerCase();
            for (const suffix of ['@2x', '']) for (const frame of ['', '-0']) for (const ext of ['.png', '.jpg']) {
                if (index.has(`${base}${key}${frame}${suffix}${ext}`.toLowerCase()) || index.has(`${key}${frame}${suffix}${ext}`)) return true;
            }
            return false;
        }

        /* everything drawMania needs for a key count, images loaded */
        async function forKeys(keys) {
            const m = ini.mania[keys] || {};
            const cfg = {
                columnWidth: list(m.ColumnWidth, keys, 30),
                columnSpacing: list(m.ColumnSpacing, Math.max(1, keys - 1), 0),
                columnStart: Number(m.ColumnStart ?? 136),
                hitPosition: Number(m.HitPosition ?? 402),
                scorePosition: Number(m.ScorePosition ?? 325),
                comboPosition: Number(m.ComboPosition ?? 111),
                judgementLine: m.JudgementLine !== '0',
                // notes are as tall as they'd be in a column this wide (osu! skin.ini)
                noteHeightWidth: Number(m.WidthForNoteHeightScale) > 0 ? Number(m.WidthForNoteHeightScale) : 0,
                keysUnderNotes: m.KeysUnderNotes === '1',
                // skin version: "latest" counts as new; no Version means 1.0.
                // From 2.5 the long-note body is laid from the top by default
                // instead of stretched, and the tail image is flipped.
                version: skinVersion(ini.general.Version),
                bodyStyle: Array.from({ length: keys }, (_, i) => {
                    const v = m[`NoteBodyStyle${i}`] ?? m.NoteBodyStyle;
                    if (v != null && v !== '') return Number(v);
                    return skinVersion(ini.general.Version) >= 2.5 ? 1 : 0;
                }),
                flipTail: Array.from({ length: keys }, (_, i) => {
                    const v = m[`NoteFlipWhenUpsideDown${i}T`] ?? m.NoteFlipWhenUpsideDownT;
                    return skinVersion(ini.general.Version) >= 2.5 && v !== '0';
                }),
                upsideDown: m.UpsideDown === '1',
                colours: Array.from({ length: keys }, (_, i) => colour(m[`Colour${i + 1}`])),
                notes: [], heads: [], bodies: [], tails: [], keys: [], keysDown: [],
            };
            for (let i = 0; i < keys; i++) {
                const t = columnType(keys, i);
                const [n, h, l, tl, k, kd] = await Promise.all([
                    image(m[`NoteImage${i}`] || `mania-note${t}`),
                    image(m[`NoteImage${i}H`] || `mania-note${t}H`),
                    image(m[`NoteImage${i}L`] || `mania-note${t}L`),
                    image(m[`NoteImage${i}T`] || `mania-note${t}T`),
                    image(m[`KeyImage${i}`] || `mania-key${t}`),
                    image(m[`KeyImage${i}D`] || `mania-key${t}D`),
                ]);
                cfg.notes.push(n); cfg.heads.push(h || n); cfg.bodies.push(l); cfg.tails.push(tl);
                cfg.keys.push(k); cfg.keysDown.push(kd || k);
            }
            const [stageLeft, stageRight, stageHint, stageBottom] = await Promise.all([
                image(m.StageLeft || 'mania-stage-left'), image(m.StageRight || 'mania-stage-right'),
                image(m.StageHint || 'mania-stage-hint'), image(m.StageBottom || 'mania-stage-bottom'),
            ]);
            Object.assign(cfg, { stageLeft, stageRight, stageHint, stageBottom });
            const hits = {};
            for (const [j, f] of [['MAX', 'Hit300g'], ['300', 'Hit300'], ['200', 'Hit200'], ['100', 'Hit100'], ['50', 'Hit50'], ['MISS', 'Hit0']]) {
                hits[j] = await image(m[f] || `mania-${f.toLowerCase().replace('hit', 'hit')}`);
            }
            cfg.hits = hits;
            // combo number: the skin's combo font (ComboPrefix, default "score")
            const prefix = (ini.fonts && ini.fonts.ComboPrefix) || 'score';
            cfg.comboDigits = await Promise.all(Array.from({ length: 10 }, (_, d) => image(`${prefix}-${d}`)));
            if (cfg.comboDigits.some((d) => !d)) cfg.comboDigits = null;
            cfg.comboOverlap = Number((ini.fonts && ini.fonts.ComboOverlap) || 0);
            return cfg;
        }

        async function comboFont() {
            const prefix = (ini.fonts && ini.fonts.ComboPrefix) || 'score';
            const ds = await Promise.all(Array.from({ length: 10 }, (_, d) => image(`${prefix}-${d}`)));
            return ds.every(Boolean) ? ds : null;
        }

        /* osu!catch: fruit (tinted with the combo colours) and their overlays,
           droplets, bananas, the catcher's idle / fail / kiai looks */
        async function forCatch() {
            const def = await loadDefaultCatch();
            // each image on its own: the skin's if it has it, else osu!'s default
            const pair = async (n, d) => ({ base: (await image(n)) || (d && d.base), overlay: (await image(`${n}-overlay`)) || (d && d.overlay) });
            const fruits = await Promise.all(['fruit-pear', 'fruit-grapes', 'fruit-apple', 'fruit-orange'].map((n, i) => pair(n, def.fruits[i])));
            const idle = (await image('fruit-catcher-idle')) || (await image('fruit-ryuuta')) || def.catcherIdle;
            const combo = [];
            for (let i = 1; i <= 8; i++) { const c = colour(ini.colours[`Combo${i}`]); if (c) combo.push(c); }
            const hf = ini.ctb.HyperDashFruit && colour(ini.ctb.HyperDashFruit.split(',').slice(0, 3).join(',') + ',230');
            return {
                fruits,
                drop: await pair('fruit-drop', def.drop),
                banana: await pair('fruit-bananas', def.banana),
                catcherIdle: idle,
                catcherFail: (await image('fruit-catcher-fail')) || def.catcherFail || idle,
                catcherKiai: (await image('fruit-catcher-kiai')) || def.catcherKiai || idle,
                combo: combo.length ? combo : def.combo,
                hyperFruit: hf,
                comboDigits: await comboFont(),
                comboOverlap: Number((ini.fonts && ini.fonts.ComboOverlap) || 0),
            };
        }

        /* osu!taiko: every image by name (the skin's, else osu!'s default), the
           mascot's animation frames, the combo font */
        async function forTaiko() {
            const def = await loadDefaultTaiko();
            const img = {};
            for (const n of TAIKO_IMAGES) img[n] = (await image(n)) || def.img[n] || null;
            const frames = async (state) => {
                const out = [];
                for (let i = 0; i < 30; i++) { const f = await image(`pippidon${state}${i}`); if (!f) break; out.push(f); }
                return out.length ? out : def.mascot[state];
            };
            const mascot = { idle: await frames('idle'), kiai: await frames('kiai'), fail: await frames('fail'), clear: await frames('clear') };
            const own = await comboFont();
            return { img, mascot, comboDigits: own || def.comboDigits, comboOverlap: own ? Number((ini.fonts && ini.fonts.ComboOverlap) || 0) : 0 };
        }

        /* the results screen: ranking images, judgement images, the score font */
        async function forRanking() {
            const def = await loadDefaultRanking();
            const out = { scoreOverlap: Number((ini.fonts && ini.fonts.ScoreOverlap) || 0) };
            const prefix = (ini.fonts && ini.fonts.ScorePrefix) || 'score';
            const digits = await Promise.all(SCORE_GLYPHS.map((g) => image(`${prefix}-${g}`)));
            const ownFont = digits.slice(0, 10).every(Boolean);
            SCORE_GLYPHS.forEach((g, i) => { out[`score-${g}`] = (ownFont && digits[i]) || def[`score-${g}`] || null; });
            if (!ownFont) out.scoreOverlap = 0;
            for (const n of RANK_IMAGES) out[n] = (await image(n)) || def[n] || null;
            return out;
        }

        /* osu! (standard): circles, sliders, spinners, cursor, judgements and
           the skin.ini settings that change how they look */
        async function forStd() {
            const def = await loadDefaultStd();
            const img = {};
            for (const n of STD_IMAGES) img[n] = (await image(n)) || null;
            // a skin's own circle stands in for its slider start; osu!'s default only when it has neither
            if (!img.sliderstartcircle) { img.sliderstartcircle = img.hitcircle; img.sliderstartcircleoverlay = img.hitcircleoverlay; }
            for (const n of STD_IMAGES) if (!img[n] && def.img[n] && !STD_NO_DEFAULT.has(n) && !exists(n)) img[n] = def.img[n];
            const sliderb = [];
            for (let i = 0; i < 10; i++) { const f = await image(`sliderb${i}`); if (!f) break; sliderb.push(f); }
            if (!sliderb.length) { const one = await image('sliderb'); if (one) sliderb.push(one); }
            const prefix = (ini.fonts && ini.fonts.HitCirclePrefix) || 'default';
            const digits = await Promise.all(Array.from({ length: 10 }, (_, d) => image(`${prefix}-${d}`)));
            const combo = [];
            for (let i = 1; i <= 8; i++) { const c = colour(ini.colours[`Combo${i}`]); if (c) combo.push(c); }
            const g = ini.general || {};
            const yes = (v, d) => (v == null ? d : String(v).trim() === '1');
            const ownSpinnerOld = !!((await image('spinner-background')) || (await image('spinner-circle'))) && !(await image('spinner-top'));
            return {
                img,
                sliderb: sliderb.length ? sliderb : def.sliderb,
                digits: digits.every(Boolean) ? digits : def.digits,
                overlap: digits.every(Boolean) ? Number((ini.fonts && ini.fonts.HitCircleOverlap) || -2) : -2,
                combo: combo.length ? combo : def.combo,
                sliderBorder: colour(ini.colours.SliderBorder) || 'rgba(255,255,255,1)',
                sliderTrack: colour(ini.colours.SliderTrackOverride) || null,
                allowBallTint: yes(g.AllowSliderBallTint, false),
                overlayAbove: yes(g.HitCircleOverlayAboveNumber ?? g.HitCircleOverlayAboveNumer, true),
                cursorRotate: yes(g.CursorRotate, true),
                cursorExpand: yes(g.CursorExpand, true),
                cursorCentre: yes(g.CursorCentre, true),
                spinnerOld: ownSpinnerOld,
            };
        }

        return { name: name || ini.general.Name || 'skin', ini, forKeys, forCatch, forTaiko, forRanking, forStd };
    }

    /* osu!stable's default catch images (ppy/osu-resources Skins/Legacy,
       CC BY-NC 4.0, in assets/osu-resources/skin-legacy): what the game
       shows for any catch image a skin doesn't have. */
    const DEFAULT_CATCH_COMBO = ['rgba(255,192,0,1)', 'rgba(0,202,0,1)', 'rgba(18,124,255,1)', 'rgba(242,24,57,1)'];
    let defaultCatchPromise = null;
    function loadDefaultCatch() {
        if (!defaultCatchPromise) {
            const img = async (n) => {
                try {
                    const res = await fetch(`assets/osu-resources/skin-legacy/${n}@2x.png`);
                    if (!res.ok) return null;
                    return { bmp: await createImageBitmap(await res.blob()), s: 0.5 };
                } catch { return null; }
            };
            const pair = async (n) => ({ base: await img(n), overlay: await img(`${n}-overlay`) });
            defaultCatchPromise = (async () => ({
                fruits: await Promise.all(['fruit-pear', 'fruit-grapes', 'fruit-apple', 'fruit-orange'].map(pair)),
                drop: { base: await img('fruit-drop'), overlay: null },
                banana: await pair('fruit-bananas'),
                catcherIdle: await img('fruit-catcher-idle'),
                catcherFail: await img('fruit-catcher-fail'),
                catcherKiai: await img('fruit-catcher-kiai'),
                combo: DEFAULT_CATCH_COMBO,
                hyperFruit: null,
                comboDigits: null,
                comboOverlap: 0,
            }))();
        }
        return defaultCatchPromise;
    }

    /* osu!stable's default taiko images (same source and licence as above) */
    const TAIKO_IMAGES = ['taiko-bar-left', 'taiko-bar-right', 'taiko-bar-right-glow', 'taiko-barline', 'taiko-drum-inner', 'taiko-drum-outer', 'taiko-glow', 'taiko-hit0', 'taiko-hit100', 'taiko-hit300', 'taiko-hit100k', 'taiko-hit300k', 'taiko-roll-end', 'taiko-roll-middle', 'taiko-slider', 'taiko-slider-fail', 'taikobigcircle', 'taikobigcircleoverlay', 'taikohitcircle', 'taikohitcircleoverlay', 'spinner-warning', 'spinner-circle', 'spinner-approachcircle', 'approachcircle'];
    let defaultTaikoPromise = null;
    function loadDefaultTaiko() {
        if (!defaultTaikoPromise) {
            const get = async (n) => {
                for (const [suffix, s] of [['@2x', 0.5], ['', 1]]) {
                    try {
                        const res = await fetch(`assets/osu-resources/skin-legacy/${n}${suffix}.png`);
                        if (res.ok) return { bmp: await createImageBitmap(await res.blob()), s };
                    } catch { /* next */ }
                }
                return null;
            };
            const COUNTS = { idle: 2, kiai: 2, fail: 3, clear: 9 };
            defaultTaikoPromise = (async () => {
                const img = {};
                await Promise.all(TAIKO_IMAGES.map(async (n) => { img[n] = await get(n); }));
                const mascot = {};
                for (const [state, n] of Object.entries(COUNTS)) mascot[state] = (await Promise.all(Array.from({ length: n }, (_, i) => get(`pippidon${state}${i}`)))).filter(Boolean);
                const digits = await Promise.all(Array.from({ length: 10 }, (_, d) => get(`score-${d}`)));
                return { img, mascot, comboDigits: digits.every(Boolean) ? digits : null, comboOverlap: 0 };
            })();
        }
        return defaultTaikoPromise;
    }

    /* One skin per mode (players often use a different skin for each), kept
       under 'mode-{n}'. A skin saved before this (under 'current') still
       serves any mode that has none of its own; resetting a mode stores a
       "none" so it shows the default without touching the other modes. */
    const SCORE_GLYPHS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'x', 'dot', 'percent', 'comma'];
    const RANK_IMAGES = ['ranking-panel', 'ranking-title', 'ranking-accuracy', 'ranking-maxcombo', 'ranking-graph', 'ranking-perfect',
        'ranking-X', 'ranking-XH', 'ranking-S', 'ranking-SH', 'ranking-A', 'ranking-B', 'ranking-C', 'ranking-D',
        'hit0', 'hit50', 'hit100', 'hit300', 'hit300g', 'hit100k', 'mania-hit0', 'mania-hit50', 'mania-hit100', 'mania-hit200', 'mania-hit300', 'mania-hit300g',
        'taiko-hit0', 'taiko-hit100', 'taiko-hit300', 'taiko-hit300g', 'taiko-hit100k', 'fruit-pear', 'fruit-pear-overlay', 'fruit-drop'];
    let defaultRankingPromise = null;
    function loadDefaultRanking() {
        if (!defaultRankingPromise) {
            const get = async (n) => {
                for (const [file, s] of [[`${n}@2x`, 0.5], [`${n}-0@2x`, 0.5], [n, 1]]) {
                    try {
                        const res = await fetch(`assets/osu-resources/skin-legacy/${file}.png`);
                        if (res.ok) return { bmp: await createImageBitmap(await res.blob()), s };
                    } catch { /* next */ }
                }
                return null;
            };
            defaultRankingPromise = (async () => {
                const out = { scoreOverlap: 0 };
                await Promise.all([...RANK_IMAGES, ...SCORE_GLYPHS.map((g) => `score-${g}`)].map(async (n) => { out[n] = await get(n); }));
                return out;
            })();
        }
        return defaultRankingPromise;
    }

    const STD_IMAGES = ['hitcircle', 'hitcircleoverlay', 'sliderstartcircle', 'sliderstartcircleoverlay', 'sliderendcircle', 'sliderendcircleoverlay',
        'approachcircle', 'sliderfollowcircle', 'sliderscorepoint', 'reversearrow', 'followpoint', 'cursor', 'cursormiddle', 'cursortrail',
        'hit0', 'hit50', 'hit100', 'hit300', 'spinner-background', 'spinner-circle', 'spinner-approachcircle', 'spinner-metre',
        'spinner-glow', 'spinner-bottom', 'spinner-top', 'spinner-middle', 'spinner-middle2', 'spinner-clear', 'spinner-spin'];
    // parts that are simply absent when a skin doesn't draw them (no default stands in)
    const STD_NO_DEFAULT = new Set(['sliderendcircle', 'sliderendcircleoverlay', 'sliderstartcircle', 'sliderstartcircleoverlay', 'cursormiddle',
        'spinner-background', 'spinner-circle', 'spinner-metre']);
    let defaultStdPromise = null;
    function loadDefaultStd() {
        if (!defaultStdPromise) {
            const get = async (n) => {
                for (const [file, s] of [[`${n}@2x`, 0.5], [`${n}-0@2x`, 0.5], [n, 1]]) {
                    try {
                        const res = await fetch(`assets/osu-resources/skin-legacy/${file}.png`);
                        if (res.ok) return { bmp: await createImageBitmap(await res.blob()), s };
                    } catch { /* next */ }
                }
                return null;
            };
            defaultStdPromise = (async () => {
                const img = {};
                await Promise.all(STD_IMAGES.map(async (n) => { img[n] = await get(n); }));
                const digits = await Promise.all(Array.from({ length: 10 }, (_, d) => get(`default-${d}`)));
                const b = await get('sliderb0');
                return { img, digits: digits.every(Boolean) ? digits : null, sliderb: b ? [b] : [], combo: ['rgba(255,192,0,1)', 'rgba(0,202,0,1)', 'rgba(18,124,255,1)', 'rgba(242,24,57,1)'] };
            })();
        }
        return defaultStdPromise;
    }

    async function saveSkin(blob, name, mode) { await idb('readwrite', (s) => s.put({ blob, name }, mode == null ? 'current' : `mode-${mode}`)); }
    async function loadSavedSkin(mode) {
        try {
            let v = mode == null ? null : await idb('readonly', (s) => s.get(`mode-${mode}`));
            if (v && v.none) return null;
            if (!v) v = await idb('readonly', (s) => s.get('current'));
            return v && v.blob ? loadSkin(v.blob, v.name) : null;
        } catch { return null; }
    }
    async function clearSkin(mode) {
        try {
            if (mode == null) await idb('readwrite', (s) => s.delete('current'));
            else await idb('readwrite', (s) => s.put({ none: true }, `mode-${mode}`));
        } catch { /* nothing saved */ }
    }

    window.replaySkin = { loadSkin, saveSkin, loadSavedSkin, clearSkin, columnType, parseSkinIni, loadDefaultCatch, loadDefaultTaiko, loadDefaultRanking, loadDefaultStd };
})();
