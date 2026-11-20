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
        const out = { general: {}, colours: {}, mania: {} };
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
        const iniEntry = zip.entries.find((e) => /(^|\/)skin\.ini$/i.test(e.name));
        const ini = iniEntry ? parseSkinIni(new TextDecoder().decode(await zip.read(iniEntry))) : { general: {}, colours: {}, mania: {} };
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
            return cfg;
        }

        return { name: name || ini.general.Name || 'skin', ini, forKeys };
    }

    async function saveSkin(blob, name) { await idb('readwrite', (s) => s.put({ blob, name }, 'current')); }
    async function loadSavedSkin() {
        try {
            const v = await idb('readonly', (s) => s.get('current'));
            return v && v.blob ? loadSkin(v.blob, v.name) : null;
        } catch { return null; }
    }
    async function clearSkin() { try { await idb('readwrite', (s) => s.delete('current')); } catch { /* nothing saved */ } }

    window.replaySkin = { loadSkin, saveSkin, loadSavedSkin, clearSkin, columnType, parseSkinIni };
})();
