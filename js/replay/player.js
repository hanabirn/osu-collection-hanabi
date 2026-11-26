/* ===== Replay player: full-screen view, loading, playback =====
   openReplayViewer() covers the page; drop or pick an .osr (or drop one
   anywhere on the page). Loading:
     .osr -> beatmap by its MD5 (osu! API get_beatmaps h=, via our proxy)
          -> the set's .osz from osu.direct (it allows cross-site reads)
          -> unzip in the browser -> the .osu, audio and background
          -> prepare (judgements etc.) -> play.
   Layout, after mania-tracker's theatre view: the canvas fills the screen
   (background, centred stage); live accuracy top-left, live judgement
   counts + UR top-right, misses per hand on the left, and along the
   bottom the timeline and an info bar (player, map, final result, play
   controls; scroll speed, background dim and skin under ⚙).
   The audio element is the clock: its currentTime is song time whatever the
   playback rate (DT/HT), so drawing just follows it.
   osu!mania for now; text in every site language via js/replay/strings.js. */
(function () {
    const L = (zh) => (window.replayText ? window.replayText(zh) : zh); // js/replay/strings.js
    const JUDGES = ['MAX', '300', '200', '100', '50', 'MISS'];
    /* What differs between modes: how to prepare and draw, the judgement
       names (and what to call them), the replay's own counts, accuracy,
       the skin part, and the map numbers on the info card. */
    const MODES = {
        0: {
            judges: ['300', '100', '50', 'MISS'],
            labels: {},
            colors: () => window.replayStd.JUDGE_COLOR,
            // a lazer score's accuracy as osu! shows it (slider ticks and ends count; js/replay/formats.js)
            record: (r) => ({ 300: r.n300, 100: r.n100, 50: r.n50, MISS: r.nMiss, lazerAcc: r.lazerAcc }),
            acc: (c) => { if (c.lazerAcc != null) return c.lazerAcc; const n = c[300] + c[100] + c[50] + c.MISS; return n ? (300 * c[300] + 100 * c[100] + 50 * c[50]) / (300 * n) : 1; },
            prepare: (map, replay) => window.replayStd.prepareStd(map, replay),
            draw: (ctx, view, prep, t) => window.replayStd.drawStd(ctx, view, prep, t),
            skin: (skin) => skin.forStd(),
            stats: (map, prep) => [['CS', num1(prep.diff.cs)], ['AR', num1(prep.diff.ar)], ['OD', num1(prep.diff.od)], ['HP', num1(prep.diff.hp)]],
            // osu!stable: by the share of 300s, 50s and misses
            rank: (c) => {
                const n = c[300] + c[100] + c[50] + c.MISS, r3 = n ? c[300] / n : 1, r5 = n ? c[50] / n : 0, clean = c.MISS === 0;
                return r3 >= 1 ? 'SS' : r3 > 0.9 && r5 <= 0.01 && clean ? 'S' : (r3 > 0.8 && clean) || r3 > 0.9 ? 'A' : (r3 > 0.7 && clean) || r3 > 0.8 ? 'B' : r3 > 0.6 ? 'C' : 'D';
            },
            ur: true,
            scroll: false, judgeSize: true, hands: false,
        },
        3: {
            judges: ['MAX', '300', '200', '100', '50', 'MISS'],
            labels: {},
            colors: () => window.replayMania.JUDGE_COLOR,
            record: (r) => ({ MAX: r.nGeki, 300: r.n300, 200: r.nKatu, 100: r.n100, 50: r.n50, MISS: r.nMiss }),
            acc: (c) => { const n = c.MAX + c[300] + c[200] + c[100] + c[50] + c.MISS; return n ? (300 * (c.MAX + c[300]) + 200 * c[200] + 100 * c[100] + 50 * c[50]) / (300 * n) : 1; },
            prepare: (map, replay) => window.replayMania.prepareMania(map, replay),
            draw: (ctx, view, prep, t) => window.replayMania.drawMania(ctx, view, prep, t),
            skin: (skin, prep) => skin.forKeys(prep.keys),
            stats: (map, prep) => [['Keys', `${prep.keys}K`], ['OD', num1(map.od)], ['HP', num1(map.hp)]],
            rank: (c, acc) => (acc >= 1 ? 'SS' : acc > 0.95 ? 'S' : acc > 0.9 ? 'A' : acc > 0.8 ? 'B' : acc > 0.7 ? 'C' : 'D'),
            ur: true,
            scroll: true, judgeSize: true, hands: true,
        },
        2: {
            judges: ['FRUIT', 'DROP', 'TINY', 'TINYMISS', 'MISS'],
            labels: { FRUIT: '水果', DROP: '大水滴', TINY: '小水滴', TINYMISS: '漏小水滴', MISS: 'MISS' },
            colors: () => window.replayCatch.JUDGE_COLOR,
            record: (r) => ({ FRUIT: r.n300, DROP: r.n100, TINY: r.n50, TINYMISS: r.nKatu, MISS: r.nMiss }),
            acc: (c) => { const hit = c.FRUIT + c.DROP + c.TINY; const n = hit + c.TINYMISS + c.MISS; return n ? hit / n : 1; },
            prepare: (map, replay) => window.replayCatch.prepareCatch(map, replay),
            draw: (ctx, view, prep, t) => window.replayCatch.drawCatch(ctx, view, prep, t),
            skin: (skin) => skin.forCatch(),
            stats: (map, prep) => [['CS', num1(prep.diff.cs)], ['AR', num1(prep.diff.ar)], ['OD', num1(prep.diff.od)], ['HP', num1(prep.diff.hp)]],
            rank: (c, acc) => (acc >= 1 ? 'SS' : acc > 0.98 ? 'S' : acc > 0.94 ? 'A' : acc > 0.9 ? 'B' : acc > 0.85 ? 'C' : 'D'),
            ur: false,
            scroll: false, judgeSize: false, hands: false,
        },
        1: {
            judges: ['300', '100', 'MISS'],
            labels: {},
            colors: () => window.replayTaiko.JUDGE_COLOR,
            record: (r) => ({ 300: r.n300, 100: r.n100, MISS: r.nMiss }),
            acc: (c) => { const n = c[300] + c[100] + c.MISS; return n ? (c[300] + 0.5 * c[100]) / n : 1; },
            prepare: (map, replay) => window.replayTaiko.prepareTaiko(map, replay),
            draw: (ctx, view, prep, t) => window.replayTaiko.drawTaiko(ctx, view, prep, t),
            skin: (skin) => skin.forTaiko(),
            stats: (map, prep) => [['OD', num1(prep.diff.od)], ['HP', num1(prep.diff.hp)], ['SV', num1(map.sliderMultiplier || 1.4)]],
            // osu!stable's taiko ranks go by the share of 300s and misses
            rank: (c) => {
                const n = c[300] + c[100] + c.MISS, r3 = n ? c[300] / n : 1, clean = c.MISS === 0;
                return r3 >= 1 ? 'SS' : r3 > 0.9 && clean ? 'S' : (r3 > 0.8 && clean) || r3 > 0.9 ? 'A' : (r3 > 0.7 && clean) || r3 > 0.8 ? 'B' : r3 > 0.6 ? 'C' : 'D';
            },
            ur: true,
            scroll: false, judgeSize: true, hands: false,
        },
    };
    let root = null;
    let session = null; // { audio, raf, urls[], prep, map, replay, view, ro }
    const savedSkins = {}; // by mode; undefined = not looked up yet, null = none

    /* the visitor's choices, kept in this browser */
    const PREFS_KEY = 'osu_replay_prefs_v1';
    const prefs = { size: 'm', volume: 0.6, muted: false, music: 1, fx: 0.7, cursorScale: 1, errorScale: 1, scroll: 24, dim: 0.75, judgeScale: 0.6, comboScale: 0.6, cmpSound: 'a' };
    try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY)) || {}); } catch { /* defaults */ }
    const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* per-device nicety */ } };
    const SIZES = [['s', '小'], ['m', '中'], ['l', '大'], ['full', '填滿畫面']];
    const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

    const esc = (s) => (typeof escHtml === 'function' ? escHtml(String(s)) : String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`));
    const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    const $ = (id) => document.getElementById(id);

    function ensureRoot() {
        if (root) return root;
        root = document.createElement('div');
        root.className = 'rp-overlay';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-label', L('重播播放器'));
        root.hidden = true;
        root.innerHTML = `<div class="rp-frame" id="rp-frame" data-size="${esc(prefs.size)}">
                <div class="rp-body" id="rp-body"></div>
                <button type="button" class="rp-close" aria-label="${L('關閉')}" onclick="closeReplayViewer()">✕</button>
            </div>`;
        root.addEventListener('click', (e) => { if (e.target === root) closeReplayViewer(); });
        document.body.appendChild(root);
        document.addEventListener('keydown', onKey);
        return root;
    }

    function onKey(e) {
        if (!root || root.hidden) return;
        if (e.key === 'Escape') { closeReplayViewer(); return; }
        if (!session || !session.audio) return;
        if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'range') return;
        if (e.ctrlKey && (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_')) {
            e.preventDefault();
            if (session.setScroll && $('rp-speed')) session.setScroll(session.view.scroll + (e.key === '-' || e.key === '_' ? -1 : 1));
            return;
        }
        // a slider the visitor last touched (volume, scroll speed, dim, sizes) takes the arrow keys
        // for fine steps; only the timeline (or nothing) seeks with them
        const slider = e.target && e.target.type === 'range' && e.target.id !== 'rp-seek';
        if (slider && /^Arrow/.test(e.key)) return;
        if (e.key === ' ') { e.preventDefault(); togglePlay(); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-5000); }
        if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(5000); }
    }

    function card(html) {
        $('rp-body').innerHTML = `<div class="rp-card">${html}</div>`;
    }

    function showPicker(msg) {
        card(`<label class="rp-drop" id="rp-drop">
                <input type="file" accept=".osr" hidden onchange="if(this.files[0])loadReplayFile(this.files[0])">
                <span class="rp-drop-icon">▶</span>
                <b>${L('把 .osr 重播檔拖到這裡，或點一下選擇檔案')}</b>
                <small>${L('支援 osu! 全部四個模式。譜面和音樂會自動從 osu.direct 下載。')}</small>
                ${msg ? `<p class="rp-error">${esc(msg)}</p>` : ''}
            </label>
            <form class="rp-url" id="rp-url-form">
                <span class="rp-url-or">${L('或')}</span>
                <input type="text" id="rp-url" inputmode="url" autocomplete="off" placeholder="${L('貼上 osu! 成績網址或成績 ID')}" aria-label="${L('貼上 osu! 成績網址或成績 ID')}">
                <button type="submit" class="rp-btn">${L('載入')}</button>
            </form>`);
        $('rp-url-form').addEventListener('submit', (e) => { e.preventDefault(); loadReplayFromScore($('rp-url').value); });
        const drop = $('rp-drop');
        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
        drop.addEventListener('drop', (e) => {
            e.preventDefault();
            drop.classList.remove('is-over');
            const f = e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) loadReplayFile(f);
        });
    }

    function showStatus(steps, current, extra) {
        card(`<ol class="rp-steps">${steps.map((s, i) => `<li class="${i < current ? 'is-done' : i === current ? 'is-now' : ''}">${esc(s)}${i === current && extra ? ` <small>${esc(extra)}</small>` : ''}</li>`).join('')}</ol>`);
    }

    function stop() {
        if (!session) return;
        cancelAnimationFrame(session.raf);
        if (session.audio) { session.audio.pause(); session.audio.src = ''; }
        (session.urls || []).forEach((u) => URL.revokeObjectURL(u));
        if (session.ro) session.ro.disconnect();
        if (session.mixer) session.mixer.close();
        session = null;
    }

    function open() {
        ensureRoot();
        stop();
        root.hidden = false;
        document.documentElement.classList.add('rp-open');
    }

    // the replay page (nav 重播) when the site has it; the window's own picker otherwise
    window.openReplayViewer = function openReplayViewer() {
        if (document.getElementById('page-replay') && typeof switchTab === 'function') { closeReplayViewer(); switchTab('replay'); return; }
        open(); showPicker();
    };
    window.closeReplayViewer = function closeReplayViewer() {
        stop();
        if (root) root.hidden = true;
        document.documentElement.classList.remove('rp-open');
    };

    async function fetchWithProgress(url, onProgress) {
        let res = await fetch(url);
        // a mirror's "not found" can stick in the browser's cache after the map has
        // been mirrored since; ask again past the cache before giving up
        if (!res.ok) res = await fetch(url, { cache: 'reload' });
        if (!res.ok) {
            const err = new Error(res.status === 404 ? L('下載不到這張譜面（osu.direct 上還沒有），稍後再試') : L('下載譜面失敗（HTTP {0}），稍後再試').replace('{0}', res.status));
            err.friendly = true;
            throw err;
        }
        const total = Number(res.headers.get('content-length')) || 0;
        if (!res.body || !res.body.getReader) return new Uint8Array(await res.arrayBuffer());
        const reader = res.body.getReader();
        const parts = [];
        let got = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(value);
            got += value.length;
            onProgress(got, total);
        }
        const out = new Uint8Array(got);
        let p = 0;
        for (const part of parts) { out.set(part, p); p += part.length; }
        return out;
    }

    // "https://osu.ppy.sh/scores/123", ".../scores/mania/456" (legacy) or just an id
    function scoreRef(text) {
        const s = String(text || '').trim();
        let m = s.match(/scores\/(osu|taiko|fruits|mania)\/(\d+)/);
        if (m) return { mode: m[1], id: m[2] };
        m = s.match(/scores\/(\d+)/) || s.match(/^(\d{5,12})$/);
        return m ? { id: m[1] } : null;
    }
    async function fetchScoreReplay(ref) {
        const q = new URLSearchParams({ score: ref.id });
        if (ref.mode) q.set('mode', ref.mode);
        const res = await fetch(`/.netlify/functions/replay-fetch?${q}`);
        if (res.status === 404) throw new Error(L('這份成績沒有線上重播（osu! 只保留部分成績的重播）'));
        if (!res.ok) throw new Error(L('取得重播失敗，稍後再試'));
        return new File([await res.arrayBuffer()], `score-${ref.id}.osr`);
    }
    // a score link or id → its replay as a file (js/replay/hub.js's comparison)
    window.replayScoreFile = async function replayScoreFile(text) {
        const ref = scoreRef(text);
        if (!ref) throw new Error(L('看不懂這個網址，請貼 osu! 成績頁的網址（osu.ppy.sh/scores/…）或成績 ID'));
        return fetchScoreReplay(ref);
    };
    window.loadReplayFromScore = async function loadReplayFromScore(text) {
        const ref = scoreRef(text);
        open();
        if (!ref) { showPicker(L('看不懂這個網址，請貼 osu! 成績頁的網址（osu.ppy.sh/scores/…）或成績 ID')); return; }
        card(`<ol class="rp-steps"><li class="is-now">${esc(L('從 osu! 取得重播'))}</li></ol>`);
        try { await loadReplayFile(await fetchScoreReplay(ref)); }
        catch (err) { showPicker(err && err.message ? err.message : String(err)); }
    };

    window.loadReplayFile = async function loadReplayFile(file) {
        open();
        const steps = [L('讀取重播檔'), L('查詢譜面'), L('下載譜面和音樂'), L('解壓縮'), L('計算判定')];
        const F = window.replayFormats;
        try {
            showStatus(steps, 0);
            const replay = F.parseOsr(await file.arrayBuffer());
            const M = MODES[replay.mode];
            if (!M) throw new Error(L('這個模式的重播目前還不支援（支援 Mania、Catch 和 Taiko）'));

            showStatus(steps, 1);
            const found = await osuFetch(`h=${encodeURIComponent(replay.beatmapMd5)}`).catch(() => null);
            const bm = Array.isArray(found) ? found[0] : null;
            if (!bm) throw new Error(L('找不到這張譜面：可能已經更新過、被刪除，或還沒上架'));

            showStatus(steps, 2);
            const osz = await fetchWithProgress(`https://osu.direct/api/d/${encodeURIComponent(bm.beatmapset_id)}`, (got, total) => {
                showStatus(steps, 2, total ? `${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB` : `${(got / 1048576).toFixed(1)} MB`);
            });

            showStatus(steps, 3);
            const zip = await F.readZip(osz.buffer);
            let map = null;
            for (const e of zip.entries.filter((x) => /\.osu$/i.test(x.name))) {
                const m = F.parseOsuFile(new TextDecoder().decode(await zip.read(e)));
                if (String(m.metadata.BeatmapID) === String(bm.beatmap_id) || m.metadata.Version === bm.version) { map = m; break; }
            }
            if (!map) throw new Error(L('譜面組裡找不到這個難度'));
            if (replay.mode === 3 && map.mode !== 3) throw new Error(L('這是轉換譜（由 Standard 轉成 Mania），目前還不支援'));
            const urls = [];
            const audioEntry = zip.byName(map.audio);
            if (!audioEntry) throw new Error(L('譜面組裡找不到音樂檔'));
            const audioUrl = URL.createObjectURL(new Blob([await zip.read(audioEntry)]));
            urls.push(audioUrl);
            let bg = null;
            const bgEntry = map.background && zip.byName(map.background);
            if (bgEntry) { try { bg = await createImageBitmap(new Blob([await zip.read(bgEntry)])); } catch { bg = null; } }

            showStatus(steps, 4);
            await new Promise((r) => setTimeout(r, 0));
            const prep = M.prepare(map, replay);
            if (replay.mode === 2 && window.replaySkin.loadDefaultCatch) prep.defaultSkin = await window.replaySkin.loadDefaultCatch().catch(() => null);
            if (replay.mode === 1 && window.replaySkin.loadDefaultTaiko) prep.defaultSkin = await window.replaySkin.loadDefaultTaiko().catch(() => null);
            if (replay.mode === 0 && window.replaySkin.loadDefaultStd) prep.defaultSkin = await window.replaySkin.loadDefaultStd().catch(() => null);
            if (savedSkins[replay.mode] === undefined) savedSkins[replay.mode] = await window.replaySkin.loadSavedSkin(replay.mode);
            const savedSkin = savedSkins[replay.mode];
            const skinCfg = savedSkin ? await M.skin(savedSkin, prep).catch(() => null) : null;
            startPlayer({ replay, map, bm, prep, audioUrl, bg, urls, skinCfg, M });
            // 最近觀看 on the replay page
            if (window.replayHub) window.replayHub.remember(file, replay, bm, M.acc(M.record(replay))).catch(() => {});
        } catch (err) {
            console.error('replay load failed', err);
            open();
            showPicker(err && err.message ? err.message : String(err));
        }
    };

    function modsLabel(mods) {
        if (typeof decodeOsuMods === 'function') { const m = decodeOsuMods(mods); return m.length ? m.join('') : 'NM'; }
        return String(mods);
    }
    function modsHtml(mods) {
        const list = typeof decodeOsuMods === 'function' ? decodeOsuMods(mods) : [];
        const shown = list.filter((m) => m !== 'NM' && !(m === 'DT' && list.includes('NC')) && !(m === 'SD' && list.includes('PF')));
        if (!shown.length) return '';
        const badge = (m) => (typeof scModBadge === 'function' ? scModBadge(m) : `<b class="rp-mod-text">${esc(m)}</b>`);
        return `<div class="rp-mods" aria-label="Mods">${shown.map(badge).join('')}</div>`;
    }
    const num1 = (v) => { const n = Number(v) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(1); };

    /* the score after each judged object, in the shape rosu-pp's gradual
       calculation wants: standard counts every object, taiko its hits,
       catch its fruit and droplets, mania its notes */
    function ppStatesFor(mode, prep) {
        const out = [];
        let best = 0;
        if (mode === 0) {
            for (const e of prep.events) {
                best = Math.max(best, e.comboAfter || 0);
                if (!e.count) continue;
                const c = e.countsAfter;
                out.push({ t: e.jt, n: out.length + 1, combo: best, n300: c[300], n100: c[100], n50: c[50], miss: c.MISS, lt: e.ltAfter || 0, se: e.seAfter || 0 });
            }
        } else if (mode === 1) {
            for (const e of prep.events) {
                best = Math.max(best, e.comboAfter || 0);
                const c = e.countsAfter;
                out.push({ t: e.jt, n: out.length + 1, combo: best, n300: c[300], n100: c[100], miss: c.MISS });
            }
        } else if (mode === 2) {
            for (const o of prep.flat) {
                best = Math.max(best, o.comboAfter || 0);
                if (o.kind !== 'fruit' && o.kind !== 'droplet') continue;
                const c = o.countsAfter;
                out.push({ t: o.time, n: out.length + 1, combo: best, n300: c.FRUIT, n100: c.DROP, n50: c.TINY, katu: c.TINYMISS, miss: c.MISS });
            }
        } else if (mode === 3) {
            for (const e of prep.events) {
                best = Math.max(best, e.comboAfter || 0);
                const c = e.countsAfter;
                out.push({ t: e.judgedAt, n: out.length + 1, combo: best, geki: c.MAX, n300: c[300], katu: c[200], n100: c[100], n50: c[50], miss: c.MISS });
            }
        }
        // fewer than a few thousand: one per object is fine
        return out;
    }

    function ppLookup(replay, prep, beatmapId) {
        const states = ppStatesFor(replay.mode, prep);
        const out = { times: null, values: null };
        if (states.length && beatmapId) {
            fetch(window.REPLAY_PP_ENDPOINT || '/.netlify/functions/replay-pp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: Number(beatmapId), mods: replay.mods >>> 0, mode: replay.mode, lazer: replay.mode === 0 && replay.lazerAcc != null, states: states.map(({ t: _t, ...rest }) => rest) }),
            }).then((res) => (res.ok ? res.json() : null)).then((data) => {
                if (!data || !Array.isArray(data.pp) || data.pp.length !== states.length) return;
                out.times = states.map((s2) => s2.t);
                out.values = data.pp;
            }).catch(() => {});
        }
        return (t) => {
            if (!out.times) return null;
            let lo = 0, hi = out.times.length - 1, ans = -1;
            while (lo <= hi) { const mid = (lo + hi) >> 1; if (out.times[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
            return ans < 0 ? 0 : out.values[ans];
        };
    }

    /* the running score as the replay goes, shaped like osu!'s (each hit's value,
       catch's combo bonus) and scaled so it ends exactly on the score the replay recorded */
    function scoreTimeline(mode, prep, finalScore) {
        const times = [], vals = [];
        let sum = 0;
        if (mode === 3) {
            const v = { MAX: 320, 300: 300, 200: 200, 100: 100, 50: 50, MISS: 0 };
            for (const e of prep.events || []) { sum += v[e.judge] || 0; times.push(e.judgedAt); vals.push(sum); }
        } else if (mode === 0) {
            // standard: each object's result with the combo multiplier (stable: × (1 + combo / 25))
            for (const e of prep.events || []) {
                if (!e.count) continue;
                const v = { 300: 300, 100: 100, 50: 50, MISS: 0 }[e.result] || 0;
                sum += v * (1 + Math.max(0, (e.comboAfter || 1) - 1) / 25);
                times.push(e.jt); vals.push(sum);
            }
        } else if (mode === 1) {
            // taiko: a hit's value with the combo bonus (up to +100% from 100 combo on, as in stable)
            for (const e of prep.events || []) {
                if (e.result !== 'MISS') sum += (e.result === '300' ? 300 : 150) * (1 + Math.min(100, e.comboAfter || 0) / 100);
                times.push(e.jt); vals.push(sum);
            }
        } else if (mode === 2) {
            for (const o of prep.flat || []) {
                if (!o.caught || o.kind === 'banana') continue;
                const base = o.kind === 'fruit' ? 300 : o.kind === 'droplet' ? 100 : 10;
                sum += base * (1 + Math.max(0, (o.comboAfter || 1) - 1) / 25);
                times.push(o.time); vals.push(sum);
            }
        }
        const k = sum > 0 ? (Number(finalScore) || 0) / sum : 0;
        return (t) => {
            let lo = 0, hi = times.length - 1, ans = -1;
            while (lo <= hi) { const mid = (lo + hi) >> 1; if (times[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
            return ans < 0 ? 0 : Math.round(vals[ans] * k);
        };
    }

    /* early / late hits so far and their mean offset (mania): one pass, looked up by time */
    function timingTimeline(prep) {
        const ev = (prep.events || []).filter((e) => e.hitAt != null && e.judge !== 'MISS');
        const times = [], early = [], late = [], mean = [];
        let ne = 0, nl = 0, sum = 0;
        for (const e of ev) {
            const off = (e.hitAt - e.time) / (prep.rate || 1);
            if (off < 0) ne++; else if (off > 0) nl++;
            sum += off;
            times.push(e.judgedAt); early.push(ne); late.push(nl); mean.push(sum / (ne + nl || 1));
        }
        return (t) => {
            let lo = 0, hi = times.length - 1, ans = -1;
            while (lo <= hi) { const mid = (lo + hi) >> 1; if (times[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
            return ans < 0 ? { early: 0, late: 0, mean: 0 } : { early: early[ans], late: late[ans], mean: mean[ans] };
        };
    }

    function startPlayer({ replay, map, bm, prep, audioUrl, bg, urls, skinCfg, M }) {
        const R = { JUDGE_COLOR: M.colors(), MOD: { NC: 512 } };
        const JUDGES = M.judges;
        const jl = (j) => esc(L(M.labels[j] || j));
        const accOf = M.acc;
        const record = M.record(replay);
        const mapStats = M.stats(map, prep);
        const sr = Number(bm.difficultyrating) || 0;
        const srColor = typeof starRatingColor === 'function' ? starRatingColor(sr) : '#f472b6';
        const played = replay.playedAt && !isNaN(replay.playedAt) ? replay.playedAt.toLocaleDateString() : '';
        // a lazer score's grade as osu! gave it (lazer grades by accuracy, stable by the 300 share)
        const lzRank = replay.lazer && replay.lazer.rank ? ({ X: 'SS', XH: 'SS', SH: 'S' }[replay.lazer.rank] || replay.lazer.rank) : '';
        const rankBase = lzRank || (M.rank ? M.rank(record, accOf(record)) : '');
        const silver = (replay.mods & (8 | 1024)) && (rankBase === 'SS' || rankBase === 'S'); // HD / FL
        const rankKey = silver ? `${rankBase}H` : rankBase;
        const rankImage = (rankBase === 'SS' ? 'X' : rankBase) + (silver ? 'H' : '');
        let lifeBar = String(replay.lifeBar || '').split(',').map((s) => { const [a, b] = s.split('|'); return { t: Number(a), hp: Number(b) }; }).filter((x) => Number.isFinite(x.t) && Number.isFinite(x.hp));
        // replays from the website carry no life bar: rebuild one from our own
        // judgements (up on good hits, down on misses) so the graph still tells the story
        if (lifeBar.length < 2) {
            const q = replay.mode === 3 ? prep.events.map((e) => ({ t: e.judgedAt, q: { MAX: 1, 300: 1, 200: 0.6, 100: 0.3, 50: 0, MISS: -1 }[e.judge] }))
                : replay.mode === 1 ? prep.events.map((e) => ({ t: e.jt, q: { 300: 1, 100: 0.5, MISS: -1 }[e.result] }))
                : replay.mode === 2 ? prep.flat.filter((o) => o.kind !== 'banana').map((o) => ({ t: o.time, q: o.caught ? (o.kind === 'tiny' ? 0.3 : 1) : o.kind === 'tiny' ? -0.3 : -1 }))
                : [];
            let hp = 1;
            lifeBar = [{ t: q.length ? q[0].t : 0, hp }];
            for (const e of q) {
                hp = Math.min(1, Math.max(0, hp + (e.q > 0 ? 0.02 * e.q : e.q * 0.08)));
                lifeBar.push({ t: e.t, hp });
            }
        }
        $('rp-body').dataset.mode = String(replay.mode);
        $('rp-body').innerHTML = `
            <div class="rp-stage" id="rp-stage"><canvas id="rp-canvas"></canvas></div>
            <div class="rp-hud rp-infocard" id="rp-infocard">
                <div class="rp-ic-cover" style="--cover:url('https://assets.ppy.sh/beatmaps/${encodeURIComponent(bm.beatmapset_id)}/covers/card@2x.jpg')">
                    <b class="rp-ic-title">${esc(map.metadata.Title || bm.title)}</b>
                    <span class="rp-ic-artist">${esc(map.metadata.Artist || bm.artist)}</span>
                </div>
                <div class="rp-ic-sec rp-ic-map">
                    <div class="rp-ic-line"><i class="rp-sr" style="background:${srColor}">★ ${sr.toFixed(2)}</i><b class="rp-ic-ellip">${esc(map.metadata.Version || bm.version)}</b></div>
                    <div class="rp-ic-sub rp-ic-ellip">mapped by ${esc(map.metadata.Creator || bm.creator)}</div>
                    <dl class="rp-ic-stats" style="grid-template-columns: repeat(${mapStats.length + 2}, minmax(0, 1fr))">
                        ${mapStats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
                        <div><dt>BPM</dt><dd>${Math.round((Number(bm.bpm) || 0) * prep.rate)}</dd></div>
                        <div><dt>${L('長度')}</dt><dd>${fmt(((Number(bm.total_length) || 0) * 1000) / prep.rate)}</dd></div>
                    </dl>
                </div>
                <div class="rp-ic-sec rp-ic-player">
                    <img class="rp-avatar" id="rp-avatar" alt="" hidden>
                    <div class="rp-ic-who">
                        <div class="rp-ic-line"><b class="rp-ic-ellip">${esc(replay.player)}</b><img class="rp-flag" id="rp-flag" alt="" hidden></div>
                        <div class="rp-ic-sub" id="rp-who-stats">&nbsp;</div>
                    </div>
                </div>
                <div class="rp-ic-sec rp-ic-play">
                    <div class="rp-ic-line rp-ic-sub"><span class="rp-ic-mods">${esc(modsLabel(replay.mods))}</span>${played ? `<span>${esc(played)}</span>` : ''}</div>
                    <dl class="rp-ic-stats rp-ic-result">
                        <div><dt>${L('準確率')}</dt><dd>${(accOf(record) * 100).toFixed(2)}%</dd></div>
                        <div><dt>${L('連擊')}</dt><dd>${replay.maxCombo.toLocaleString()}x</dd></div>
                    </dl>
                    <div class="rp-ic-counts" style="grid-template-columns: repeat(${JUDGES.length}, minmax(0, 1fr))">${JUDGES.map((j) => `<span><i style="color:${R.JUDGE_COLOR[j]}">${jl(j)}</i>${record[j]}</span>`).join('')}</div>
                </div>
            </div>
            <div class="rp-hud rp-hud-top" id="rp-hud-top">
                <div class="rp-gauge">
                    <svg class="rp-pie" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5"></circle><path id="rp-pie" d=""></path></svg>
                    <span class="rp-acc" id="rp-acc">100.00%</span>
                </div>
                ${modsHtml(replay.mods)}
                <div class="rp-pp" title="${L('目前的 PP')}"><b id="rp-pp">–</b><small>pp</small></div>
            </div>
            <div class="rp-hud rp-hud-tr" id="rp-hud-stats">
                <dl class="rp-live-counts">${JUDGES.map((j) => `<dt style="color:${R.JUDGE_COLOR[j]}">${jl(j)}</dt><dd id="rp-c-${j}">0</dd>`).join('')}
                    ${M.ur ? '<dt class="rp-ur">UR</dt><dd id="rp-ur">0</dd>' : ''}</dl>
                ${M.hands ? `<div class="rp-hands">
                    <div><small>L MISS</small><b id="rp-lmiss">0</b></div>
                    <div><small>R MISS</small><b id="rp-rmiss">0</b></div>
                </div>` : ''}
            </div>
            <div class="rp-pause" id="rp-pause" hidden>
                <button type="button" class="rp-pause-btn" data-act="resume"><span class="rp-pause-ic">▶</span>${L('繼續觀看')}</button>
                <button type="button" class="rp-pause-btn" data-act="restart"><span class="rp-pause-ic">↺</span>${L('從頭再看')}</button>
                <button type="button" class="rp-pause-btn" data-act="change"><span class="rp-pause-ic">☰</span>${L('換一個重播')}</button>
            </div>
            <div class="rp-results" id="rp-results" hidden>
                <div class="rp-res-card" role="dialog" aria-label="${L('結算')}">
                    <div class="rp-res-head" style="--cover:url('https://assets.ppy.sh/beatmaps/${encodeURIComponent(bm.beatmapset_id)}/covers/cover@2x.jpg')">
                        <b class="rp-ic-ellip">${esc(map.metadata.Artist || bm.artist)} - ${esc(map.metadata.Title || bm.title)} [${esc(map.metadata.Version || bm.version)}]</b>
                        <span class="rp-ic-ellip">mapped by ${esc(map.metadata.Creator || bm.creator)} · ${esc(replay.player)}${played ? ` · ${esc(played)}` : ''}</span>
                    </div>
                    <div class="rp-res-main">
                        <div class="rp-res-left">
                            <div class="rp-res-score"><small>${L('分數')}</small><b>${(Number(replay.score) || 0).toLocaleString()}</b></div>
                            <div class="rp-res-counts" style="grid-template-columns: repeat(${Math.min(3, JUDGES.length)}, minmax(0, 1fr))">${JUDGES.map((j) => `<div><small style="color:${R.JUDGE_COLOR[j]}">${jl(j)}</small><b>${record[j]}</b></div>`).join('')}</div>
                            <div class="rp-res-pair">
                                <div><small>${L('最大連擊')}</small><b>${replay.maxCombo.toLocaleString()}x</b></div>
                                <div><small>${L('準確率')}</small><b>${(accOf(record) * 100).toFixed(2)}%</b></div>
                            </div>
                        </div>
                        <div class="rp-res-right">
                            <div class="rp-res-rank" data-rank="${rankKey}">${rankBase}</div>
                            <div class="rp-res-mods">${esc(modsLabel(replay.mods))}</div>
                        </div>
                    </div>
                    <div class="rp-res-actions" id="rp-res-actions">
                        <button type="button" class="rp-btn" id="rp-res-again">↺ ${L('再看一次')}</button>
                        <button type="button" class="rp-btn" id="rp-res-hide">${L('關閉結算')}</button>
                        <button type="button" class="rp-btn" onclick="openReplayViewer()">⏏ ${L('換一個重播')}</button>
                    </div>
                </div>
            </div>
            <div class="rp-bottom">
                <div class="rp-seekbar" id="rp-seekbar">
                    <span class="rp-seek-t" id="rp-seek-now">0:00</span>
                    <span class="rp-seek-track"><input type="range" class="rp-seek" id="rp-seek" min="0" max="1000" step="1" value="0" aria-label="${L('進度')}"><output class="rp-seek-tip" id="rp-seek-tip" hidden>0:00</output></span>
                    <span class="rp-seek-t" id="rp-seek-end">0:00</span>
                </div>
                <div class="rp-bar">
                    <button type="button" class="rp-play" id="rp-play" aria-label="${L('播放')}">▶</button>
                    <span class="rp-time"><span id="rp-time">0:00</span> / <span id="rp-dur">0:00</span></span>
                    <span class="rp-ctl rp-vol">
                        <button type="button" class="rp-icon" id="rp-mute" aria-label="${L('靜音')}">🔊</button>
                        <input type="range" id="rp-volume" min="0" max="1" step="0.01" value="${prefs.volume}" aria-label="${L('總音量')}" title="${L('總音量')}">
                    </span>
                    <label class="rp-ctl" title="${L('播放速度')}"><span class="rp-ctl-name">${L('速度')}</span>
                        <select id="rp-rate">${RATES.map((r) => `<option value="${r}"${r === 1 ? ' selected' : ''}>${r}×</option>`).join('')}</select>
                    </label>
                    ${M.scroll ? `<label class="rp-ctl rp-scroll" title="${L('捲動速度（Ctrl + ＋／－）')}"><span class="rp-ctl-name">${L('捲動')}</span><span class="rp-scroll-wrap"><output id="rp-scroll-val">${Number(prefs.scroll).toFixed(1)}</output><input type="range" id="rp-speed" min="1" max="40" step="0.1" value="${prefs.scroll}" aria-label="${L('捲動速度')}"></span></label>` : ''}
                    <label class="rp-ctl" title="${L('背景暗度')}"><span class="rp-ctl-name">${L('背景')}</span><input type="range" id="rp-dim" min="0" max="1" step="0.01" value="${prefs.dim}" aria-label="${L('背景暗度')}"></label>
                    <label class="rp-ctl" title="${L('畫面大小')}"><span class="rp-ctl-name">${L('大小')}</span>
                        <select id="rp-size">${SIZES.map(([v, n]) => `<option value="${v}"${v === prefs.size ? ' selected' : ''}>${L(n)}</option>`).join('')}</select>
                    </label>
                    <button type="button" class="rp-icon" id="rp-fs" aria-label="${L('全螢幕')}" title="${L('全螢幕')}">⛶</button>
                    <span class="rp-spacer"></span>
                    <details class="rp-menu">
                        <summary class="rp-btn" title="${L('皮膚・設定')}">⚙<span class="rp-btn-text"> ${L('皮膚・設定')}</span></summary>
                        <div class="rp-menu-panel">
                            <button type="button" class="rp-menu-close" aria-label="${L('關閉')}" onclick="this.closest('details').open = false">✕</button>
                            <div class="rp-opt">${L('皮膚')} <span class="rp-skin-name" id="rp-skin-name">${esc(savedSkins[replay.mode] ? savedSkins[replay.mode].name : L('預設'))}</span>
                                <span class="rp-skin-btns">
                                    <label class="rp-btn">${L('上傳皮膚（.osk / .zip）')}<input type="file" accept=".osk,.zip" hidden id="rp-skin-file"></label>
                                    <button type="button" class="rp-btn" id="rp-skin-reset">${L('恢復預設')}</button>
                                </span>
                                <select class="rp-skin-pick" id="rp-skin-pick" aria-label="${L('從「我的皮膚」選')}" hidden><option value="">${L('從「我的皮膚」選')}</option></select>
                                <small class="rp-skin-note">${L('上傳的皮膚也會收進「我的皮膚」')}</small></div>
                            ${M.judgeSize ? `<label class="rp-opt">${L('判定大小')} <output id="rp-judge-val">${Math.round((prefs.judgeScale || 0.6) * 100)}%</output><input type="range" id="rp-judge-scale" min="0.2" max="1.5" step="0.05" value="${prefs.judgeScale || 0.6}"></label>` : ''}
                            <label class="rp-opt">${L('音樂音量')} <output id="rp-music-val">${Math.round(prefs.music * 100)}%</output><input type="range" id="rp-music" min="0" max="1" step="0.01" value="${prefs.music}"></label>
                            <label class="rp-opt">${L('音效音量')} <output id="rp-fx-val">${Math.round(prefs.fx * 100)}%</output><input type="range" id="rp-fx" min="0" max="1" step="0.01" value="${prefs.fx}"></label>
                            <div class="rp-opt rp-opt-cmp">${L('比較時的打擊音效')}
                                <span class="rp-seg" id="rp-cmp-sound" role="radiogroup">${[['a', L('左邊玩家')], ['b', L('右邊玩家')], ['both', L('兩邊')]].map(([v, lab]) => `<button type="button" role="radio" data-v="${v}" aria-checked="${(prefs.cmpSound || 'a') === v}">${lab}</button>`).join('')}</span>
                                <small class="rp-opt-hint">${L('兩邊：左耳是左邊玩家，右耳是右邊玩家')}</small></div>
                            ${replay.mode === 0 ? `<label class="rp-opt">${L('游標大小')} <output id="rp-cursor-val">${Math.round(prefs.cursorScale * 100)}%</output><input type="range" id="rp-cursor" min="0.5" max="2" step="0.05" value="${prefs.cursorScale}"></label>` : ''}
                            ${M.ur ? `<label class="rp-opt">${L('誤差條大小')} <output id="rp-error-val">${Math.round(prefs.errorScale * 100)}%</output><input type="range" id="rp-error" min="0.5" max="2.5" step="0.05" value="${prefs.errorScale}"></label>` : ''}
                            ${replay.mode === 0 || replay.mode === 2 ? `<label class="rp-opt rp-opt-check"><input type="checkbox" id="rp-border"${prefs.border !== false ? ' checked' : ''}> ${L('遊戲區邊框')}</label>` : ''}
                            <label class="rp-opt rp-opt-check"><input type="checkbox" id="rp-board"${prefs.board !== false ? ' checked' : ''}> ${L('左側排行榜')}</label>
                            <label class="rp-opt">${L('連擊大小')} <output id="rp-combo-val">${Math.round((prefs.comboScale || 0.6) * 100)}%</output><input type="range" id="rp-combo-scale" min="0.2" max="1.5" step="0.05" value="${prefs.comboScale || 0.6}"></label>
                            <table class="rp-counts"><thead><tr><th></th><th>${L('本站判定')}</th><th>${L('重播紀錄')}</th></tr></thead>
                                <tbody>${JUDGES.map((j) => `<tr><th style="color:${R.JUDGE_COLOR[j]}">${jl(j)}</th><td>${prep.counts[j]}</td><td>${record[j]}</td></tr>`).join('')}</tbody>
                                <tfoot><tr><th>${L('準確率')}</th><td>${(accOf(prep.counts) * 100).toFixed(2)}%</td><td>${(accOf(record) * 100).toFixed(2)}%</td></tr></tfoot></table>
                            <p class="rp-note">${L('「本站判定」是播放器依按鍵時間自己算的，和遊戲可能有些微差距；畫面上的即時數字也是用它算的。')}</p>
                        </div>
                    </details>
                    ${MODES[replay.mode] ? `<button type="button" class="rp-btn" id="rp-compare-btn" title="${L('雙人比較')}">⚔<span class="rp-btn-text"> ${L('雙人比較')}</span></button>` : ''}
                    <button type="button" class="rp-btn" onclick="openReplayViewer()" title="${L('換一個重播')}" aria-label="${L('換一個重播')}">⏏<span class="rp-btn-text"> ${L('換一個重播')}</span></button>
                </div>
            </div>`;

        // the player's profile in this mode: avatar, country, total PP, ranks
        // the video's opening shows the player's flag: Twemoji (CC BY 4.0), which
        // sends CORS headers, so the canvas stays recordable
        const introFlag = new Image();
        introFlag.crossOrigin = 'anonymous';
        const profileP = osuFetch(`u=${encodeURIComponent(replay.player)}&type=string&m=${replay.mode}`).then((r) => {
            const u = Array.isArray(r) ? r[0] : null;
            if (u && /^[A-Za-z]{2}$/.test(u.country || '')) {
                const cps = [...String(u.country).toUpperCase()].map((ch) => (0x1f1e6 + ch.charCodeAt(0) - 65).toString(16)).join('-');
                introFlag.src = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/${cps}.png`;
            }
            if (!u || !$('rp-who-stats')) return;
            const av = $('rp-avatar');
            av.src = `https://a.ppy.sh/${encodeURIComponent(u.user_id)}`;
            av.hidden = false;
            av.onerror = () => { av.hidden = true; };
            if (u.country) {
                const fl = $('rp-flag');
                fl.src = `https://flagcdn.com/48x36/${String(u.country).toLowerCase()}.png`;
                fl.alt = u.country;
                fl.title = u.country;
                fl.hidden = false;
            }
            const n = (v) => Number(v || 0).toLocaleString();
            $('rp-who-stats').innerHTML = `<b>${n(Math.round(Number(u.pp_raw) || 0))}pp</b> · 🌐 #${n(u.pp_rank)} · ${esc(u.country || '')} #${n(u.pp_country_rank)}`;
        }).catch(() => {});

        const audio = new Audio(audioUrl);
        audio.preload = 'auto';
        const musicVol = () => Math.max(0, Math.min(1, prefs.volume * prefs.music));
        const fxVol = () => (prefs.muted ? 0 : Math.max(0, Math.min(1, prefs.volume * prefs.fx)));
        audio.volume = musicVol();
        audio.muted = !!prefs.muted;
        let userRate = 1;
        const applyRate = () => { audio.playbackRate = prep.rate * userRate; };
        applyRate();
        audio.preservesPitch = !(replay.mods & R.MOD.NC);
        const canvas = $('rp-canvas');
        const stage = $('rp-stage');
        let ctx = canvas.getContext('2d');
        let view = { w: 0, h: 0, dpr: 1, scroll: Number(prefs.scroll) || 24, bg, bgDim: prefs.dim, skin: skinCfg, judgeScale: Number(prefs.judgeScale) || 0.6, comboScale: Number(prefs.comboScale) || 0.6, cursorScale: Number(prefs.cursorScale) || 1, errorScale: Number(prefs.errorScale) || 1 };
        session = { audio, urls, prep, map, replay, view, raf: 0 };
        // scroll speed as in osu! (1-40, default 24); the value rides above the slider thumb
        function setScroll(v) {
            view.scroll = Math.min(40, Math.max(1, Math.round(v * 10) / 10));
            prefs.scroll = view.scroll;
            savePrefs();
            const input = $('rp-speed'), out = $('rp-scroll-val');
            if (input && Number(input.value) !== view.scroll) input.value = String(view.scroll);
            if (out) {
                out.textContent = view.scroll.toFixed(1);
                out.style.left = `${((view.scroll - 1) / 39) * 100}%`;
            }
        }
        session.setScroll = setScroll;

        const muteBtn = $('rp-mute');
        const showMute = () => { muteBtn.textContent = audio.muted || prefs.volume === 0 ? '🔇' : '🔊'; };
        showMute();
        muteBtn.addEventListener('click', () => { audio.muted = !audio.muted; prefs.muted = audio.muted; savePrefs(); showMute(); if (session && session.mixer) session.mixer.setVolume(fxVol()); });
        $('rp-volume').addEventListener('input', (e) => {
            prefs.volume = Number(e.target.value);
            if (prefs.volume > 0 && audio.muted) audio.muted = false;
            audio.volume = musicVol();
            prefs.muted = audio.muted; savePrefs(); showMute();
            if (session && session.mixer) session.mixer.setVolume(fxVol());
        });
        const volSlider = (id, key, out) => {
            const el = $(id);
            if (!el) return;
            el.addEventListener('input', (e) => {
                prefs[key] = Number(e.target.value);
                $(out).textContent = `${Math.round(prefs[key] * 100)}%`;
                savePrefs();
                audio.volume = musicVol();
                if (session && session.mixer) session.mixer.setVolume(fxVol());
                if (key === 'cursorScale') view.cursorScale = prefs.cursorScale;
                if (key === 'errorScale') view.errorScale = prefs.errorScale;
            });
        };
        volSlider('rp-music', 'music', 'rp-music-val');
        volSlider('rp-fx', 'fx', 'rp-fx-val');
        $('rp-cmp-sound').addEventListener('click', (e) => {
            const b = e.target.closest('[data-v]');
            if (!b) return;
            prefs.cmpSound = b.dataset.v; savePrefs();
            for (const x of $('rp-cmp-sound').children) x.setAttribute('aria-checked', String(x === b));
        });
        volSlider('rp-cursor', 'cursorScale', 'rp-cursor-val');
        volSlider('rp-error', 'errorScale', 'rp-error-val');
        $('rp-rate').addEventListener('change', (e) => { userRate = Number(e.target.value) || 1; applyRate(); });
        $('rp-size').addEventListener('change', (e) => {
            prefs.size = e.target.value;
            savePrefs();
            $('rp-frame').dataset.size = prefs.size;
            // picking a size means leaving true full screen (⛶)
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        });
        $('rp-fs').addEventListener('click', () => {
            const frame = $('rp-frame');
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            else if (frame.requestFullscreen) frame.requestFullscreen().catch(() => {});
        });

        const resize = () => {
            const r = stage.getBoundingClientRect();
            view.dpr = Math.min(2, window.devicePixelRatio || 1);
            view.w = Math.max(200, r.width);
            view.h = Math.max(200, r.height);
            canvas.width = Math.round(view.w * view.dpr);
            canvas.height = Math.round(view.h * view.dpr);
            canvas.style.width = `${view.w}px`;
            canvas.style.height = `${view.h}px`;
        };
        session.ro = new ResizeObserver(resize);
        session.ro.observe(stage);
        resize();

        const seek = $('rp-seek'), playBtn = $('rp-play');
        const seekNow = $('rp-seek-now');
        const timeEl = $('rp-time'), durEl = $('rp-dur'), accEl = $('rp-acc'), urEl = $('rp-ur');
        const lEl = $('rp-lmiss'), rEl = $('rp-rmiss');
        const countEls = Object.fromEntries(JUDGES.map((j) => [j, $(`rp-c-${j}`)]));
        // the timeline runs to the moment the results have faded in (the way out
        // takes about 3 s after the last object), even past the end of the music
        const endMs = () => Math.max(prep.lastTime + 3400 * (prep.rate || 1), (audio.duration || 0) * 1000);
        const setPlayIcon = (on) => { playBtn.textContent = on ? '❚❚' : '▶'; playBtn.setAttribute('aria-label', L(on ? '暫停' : '播放')); $('rp-body').classList.toggle('rp-playing', !!on); };
        /* The player's clock: the music's own time, and once the music has ended,
           a silent stretch that keeps counting (at the same speed) to the end of
           the timeline. Play / pause / seek work the same in both. */
        const clock = {
            tail: null, // { base, start, running } past the music's end
            musicEnd: () => (audio.duration || 0) * 1000,
            now() {
                if (!this.tail) return audio.currentTime * 1000;
                const tl = this.tail;
                let t = tl.base + (tl.running ? (performance.now() - tl.start) * (audio.playbackRate || 1) : 0);
                if (t >= endMs()) { t = endMs(); if (tl.running) { tl.base = t; tl.running = false; setPlayIcon(false); } }
                return t;
            },
            running() { return this.tail ? this.tail.running : !audio.paused; },
            seekTo(ms) {
                ms = Math.max(0, Math.min(endMs(), ms));
                const d = this.musicEnd();
                const wasRunning = this.running();
                if (d && ms >= d - 5) {
                    this.tail = { base: ms, start: performance.now(), running: wasRunning };
                    if (!audio.paused) audio.pause();
                    audio.currentTime = d / 1000;
                    setPlayIcon(wasRunning);
                } else {
                    const fromTail = !!this.tail;
                    this.tail = null;
                    audio.currentTime = ms / 1000;
                    if (fromTail && wasRunning) audio.play().catch(() => {});
                    else if (fromTail) setPlayIcon(false);
                }
            },
            toggle() {
                const tl = this.tail;
                if (tl) {
                    if (tl.running) { tl.base = this.now(); tl.running = false; setPlayIcon(false); }
                    else if (this.now() >= endMs() - 1) { this.tail = null; audio.currentTime = Math.max(0, first - 1500) / 1000; audio.play().catch(() => {}); }
                    else { tl.start = performance.now(); tl.running = true; setPlayIcon(true); }
                    return;
                }
                if (audio.paused) audio.play().catch((e) => console.warn('play blocked', e));
                else audio.pause();
            },
        };
        session.clock = clock;
        audio.addEventListener('ended', () => {
            if (!clock.tail) { clock.tail = { base: clock.musicEnd(), start: performance.now(), running: true }; setPlayIcon(true); }
        });
        // times on screen are real time: song time ÷ the mod's speed (DT 1.5, HT 0.75)
        const fmtReal = (ms) => fmt(ms / (prep.rate || 1));
        let seeking = false;
        seek.addEventListener('input', () => { seeking = true; clock.seekTo((seek.value / 1000) * endMs()); showTip(seek.value / 1000); });
        // hover: the time under the pointer, in a bubble above it
        const tip = $('rp-seek-tip');
        function showTip(frac) {
            frac = Math.min(1, Math.max(0, frac));
            tip.textContent = fmtReal(frac * endMs());
            tip.style.left = `${frac * 100}%`;
            tip.hidden = false;
        }
        seek.addEventListener('pointermove', (e) => {
            const r = seek.getBoundingClientRect();
            showTip((e.clientX - r.left) / r.width);
        });
        seek.addEventListener('pointerleave', () => { if (!seeking) tip.hidden = true; });
        seek.addEventListener('change', () => { seeking = false; tip.hidden = true; });
        playBtn.addEventListener('click', togglePlay);
        const sounds = window.replaySounds ? window.replaySounds.soundEvents(replay.mode, map, prep) : [];
        session.mixer = window.replaySounds ? window.replaySounds.createMixer(savedSkins[replay.mode]) : null;
        if (session.mixer) session.mixer.setVolume(fxVol());
        // one cursor through a list of hit sounds; a comparison has one per player
        const makeSoundPlayer = (list) => {
        let soundAt = null, soundIdx = 0, warmed = false;
        const sounds = list;
        return (t, running, pan) => {
            if (!session.mixer || !sounds.length) return;
            if (!running || seeking || soundAt == null || t < soundAt || t - soundAt > 300) {
                // paused, seeking or jumped: start again from here without playing what was skipped
                soundAt = t;
                let lo = 0, hi = sounds.length;
                while (lo < hi) { const mid = (lo + hi) >> 1; if (sounds[mid].t <= t) lo = mid + 1; else hi = mid; }
                soundIdx = lo;
                return;
            }
            if (!warmed) { warmed = true; session.mixer.warm([...new Set(sounds.flatMap((s2) => s2.names))]); }
            while (soundIdx < sounds.length && sounds[soundIdx].t <= t) {
                const s2 = sounds[soundIdx++];
                if (t - s2.t < 120) session.mixer.play(s2.names, s2.vol, pan);
            }
            soundAt = t;
        };
        };
        const playA = makeSoundPlayer(sounds);
        // comparing: the left player's hit sounds, the right one's, or both (left ear / right ear)
        const playSounds = (t, running) => {
            const c = session.cmp;
            const pick = c ? prefs.cmpSound || 'a' : 'a';
            const both = pick === 'both';
            playA(t, running && pick !== 'b', both ? -0.75 : 0);
            if (c && window.replaySounds) {
                if (!c.playSounds) c.playSounds = makeSoundPlayer(window.replaySounds.soundEvents(c.replay.mode, map, c.prep));
                c.playSounds(t, running && pick !== 'a', both ? 0.75 : 0);
            }
        };
        if ($('rp-speed')) { $('rp-speed').addEventListener('input', (e) => setScroll(Number(e.target.value))); setScroll(view.scroll); }
        if ($('rp-border')) $('rp-border').addEventListener('change', (e) => { prefs.border = e.target.checked; savePrefs(); });
        $('rp-board').addEventListener('change', (e) => { prefs.board = e.target.checked; savePrefs(); });
        $('rp-dim').addEventListener('input', (e) => { view.bgDim = Number(e.target.value); prefs.dim = view.bgDim; savePrefs(); });
        // 我的皮膚 (js/skins.js) is the one place skins are kept: the player picks from it,
        // and a skin uploaded here is added to it too
        const fillSkinPick = async () => {
            const sel = $('rp-skin-pick');
            if (!sel || typeof getAllSkins !== 'function') return;
            const list = await getAllSkins().catch(() => []);
            list.sort((a, b) => b.addedAt - a.addedAt);
            sel.innerHTML = `<option value="">${esc(L('從「我的皮膚」選'))}</option>${list.map((s) => `<option value="${s.id}">${esc(String(s.name).replace(/\.(osk|zip)$/i, ''))}</option>`).join('')}`;
            sel.hidden = !list.length;
        };
        fillSkinPick();
        $('rp-skin-pick').addEventListener('change', async (e) => {
            const id = Number(e.target.value);
            if (!id || typeof getAllSkins !== 'function') return;
            const rec = (await getAllSkins().catch(() => [])).find((s) => s.id === id);
            e.target.value = '';
            if (rec && rec.file) applySkinFile(new File([rec.file], rec.name), false);
        });
        async function applySkinFile(f, keep) {
            $('rp-skin-name').textContent = L('讀取中…');
            try {
                const skin = await window.replaySkin.loadSkin(f, f.name.replace(/\.(osk|zip)$/i, ''));
                view.skin = await M.skin(skin, prep);
                savedSkins[replay.mode] = skin;
                loadRankSkin(skin);
                if (session.mixer) { session.mixer.close(); session.mixer = window.replaySounds.createMixer(skin); session.mixer.setVolume(fxVol()); }
                await window.replaySkin.saveSkin(f, skin.name, replay.mode).catch(() => {});
                $('rp-skin-name').textContent = skin.name;
                if (keep && typeof getAllSkins === 'function' && typeof addSkinFile === 'function') {
                    const have = await getAllSkins().catch(() => []);
                    if (!have.some((s) => s.name === f.name && s.size === f.size)) { await addSkinFile(f).catch(() => {}); fillSkinPick(); }
                }
                return skin.name;
            } catch (err) {
                console.error('skin load failed', err);
                $('rp-skin-name').textContent = L('讀不到這個皮膚');
                return null;
            }
        }
        $('rp-skin-file').addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            if (f) applySkinFile(f, true);
        });
        window.replayApplySkinFile = (f, keep = true) => applySkinFile(f, keep);
        window.replayFillSkinPick = fillSkinPick;
        for (const [id, key, out] of [['rp-judge-scale', 'judgeScale', 'rp-judge-val'], ['rp-combo-scale', 'comboScale', 'rp-combo-val']]) {
            if (!$(id)) continue;
            $(id).addEventListener('input', (e) => {
                view[key] = prefs[key] = Number(e.target.value);
                $(out).textContent = `${Math.round(view[key] * 100)}%`;
                savePrefs();
            });
        }
        // two steps, so a stray click doesn't throw the visitor's skin away
        let resetArmed = null;
        $('rp-skin-reset').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            if (!resetArmed) {
                btn.textContent = L('再按一次確認');
                resetArmed = setTimeout(() => { resetArmed = null; btn.textContent = L('恢復預設'); }, 3000);
                return;
            }
            clearTimeout(resetArmed);
            resetArmed = null;
            btn.textContent = L('恢復預設');
            await window.replaySkin.clearSkin(replay.mode);
            savedSkins[replay.mode] = null;
            loadRankSkin(null);
            if (session.mixer) { session.mixer.close(); session.mixer = window.replaySounds.createMixer(null); session.mixer.setVolume(fxVol()); }
            view.skin = null;
            $('rp-skin-name').textContent = L('預設');
        });
        audio.addEventListener('play', () => setPlayIcon(true));
        audio.addEventListener('pause', () => { if (!clock.tail) setPlayIcon(false); });
        audio.addEventListener('loadedmetadata', () => { durEl.textContent = fmtReal(endMs()); $('rp-seek-end').textContent = fmtReal(endMs()); });
        const first = prep.notes.length ? prep.notes[0].time : 0;
        audio.addEventListener('loadedmetadata', () => { audio.currentTime = Math.max(0, first - 1500) / 1000; }, { once: true });

        // the results: after the last object (as the game does); going back before it hides them
        const resultsEl = $('rp-results');
        /* The way out, as osu! (and mania-tracker) do it, timed on its own clock
           so it finishes even when the song stops right after the last note:
             0–500 ms after the last object (+0.4 s): the play fades out, the background brightens;
             then the background alone; 1.9–2.4 s: it fades to black;
             2.4–3.0 s: the ranking screen fades in. */
        const OUTRO = { fade: 500, black: 1900, rank: 2400, rankIn: 600 };
        const outroAt = prep.lastTime + 400 * (prep.rate || 1);
        let resultsDismissed = false;
        const bgOnly = (alpha) => {
            if (alpha <= 0) return;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, view.w, view.h);
            if (bg) {
                const sc = Math.max(view.w / bg.width, view.h / bg.height);
                ctx.globalAlpha = alpha * Math.min(1, 1 - view.bgDim * 0.4 + 0.2);
                ctx.drawImage(bg, (view.w - bg.width * sc) / 2, (view.h - bg.height * sc) / 2, bg.width * sc, bg.height * sc);
            }
            ctx.restore();
        };
        const blackOver = (alpha) => {
            if (alpha <= 0) return;
            ctx.save();
            ctx.globalAlpha = Math.min(1, alpha);
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, view.w, view.h);
            ctx.restore();
        };
        $('rp-res-hide').addEventListener('click', () => { resultsDismissed = true; resultsEl.hidden = true; });
        $('rp-res-again').addEventListener('click', () => {
            resultsDismissed = false;
            resultsEl.hidden = true;
            clock.tail = null;
            audio.currentTime = Math.max(0, first - 1500) / 1000;
            audio.play().catch(() => {});
        });
        // the combo at the bottom left, in the skin's font where it has one;
        // once it has broken, the best so far sits above it
        const comboFont = () => {
            const sk = view.skin || prep.defaultSkin;
            if (!sk) return null;
            if (sk.comboFont) return sk.comboFont;
            if (sk.comboDigits) return { digits: sk.comboDigits, x: null, overlap: sk.comboOverlap || 0 };
            return null;
        };
        // a comparison screen's judgement counts and UR, as on the single-player screen's
        // right-hand panel: under the mod icons (taiko: under the lane, clear of the notes)
        function drawSideCounts(st2, x, y, vw, vh) {
            const counts = st2.counts || {};
            const rows = JUDGES.map((j) => [L(M.labels[j] || j), String(counts[j] || 0), R.JUDGE_COLOR[j]]);
            if (M.ur) rows.push(['UR', String(Math.round(st2.ur || 0)), '#8bd5ff']);
            const rh = Math.max(13, vh * 0.042);
            ctx.save();
            ctx.font = `800 ${Math.round(rh * 0.66)}px system-ui, sans-serif`;
            const labW = Math.max(...rows.map((r) => ctx.measureText(r[0]).width));
            const valW = Math.max(ctx.measureText('0000').width, ...rows.map((r) => ctx.measureText(r[1]).width));
            const pad = rh * 0.45, gap = rh * 1.1;
            const bw = labW + gap + valW + pad * 2, bh = rows.length * rh + pad * 2;
            const modsBottom = vh * 0.135 + 12 + Math.max(22, Math.min(40, vh * 0.06)) + 10;
            const by = y + (replay.mode === 1 ? vh * 0.57 : modsBottom);
            const bx = x + vw - 10 - bw;
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, rh * 0.35) : ctx.rect(bx, by, bw, bh); ctx.fill();
            ctx.textBaseline = 'middle';
            rows.forEach(([lab, val, col], k) => {
                const cy = by + pad + rh * (k + 0.5);
                ctx.textAlign = 'left'; ctx.fillStyle = col; ctx.fillText(lab, bx + pad, cy);
                ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.fillText(val, bx + bw - pad, cy);
            });
            ctx.restore();
        }
        // one bump state per screen ('main', or 'a' / 'b' in a comparison)
        const comboAnim = {};
        function drawCombo(st, h = view.h, key = 'main') {
            const combo = st.combo || 0, best = st.best || 0;
            const an = comboAnim[key] || (comboAnim[key] = { shown: 0, at: 0 });
            if (combo !== an.shown) { if (combo > an.shown) an.at = performance.now(); an.shown = combo; }
            const comboShownAt = an.at;
            const cs = (view.comboScale || 0.6) / 0.6;
            const bump = 1 + 0.12 * Math.max(0, 1 - (performance.now() - comboShownAt) / 120);
            const ch = h * 0.065 * cs;
            const base = h - 16;
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 6;
            const cf = comboFont();
            const drawNum = (text, size, y, alpha) => {
                ctx.globalAlpha = alpha;
                if (cf) {
                    const kk = size / (cf.digits[0].bmp.height * cf.digits[0].s);
                    let dx = 14;
                    for (const ch2 of text) {
                        if (ch2 === 'x') {
                            if (cf.x) { const gw = cf.x.bmp.width * cf.x.s * kk, gh = cf.x.bmp.height * cf.x.s * kk; ctx.drawImage(cf.x.bmp, dx, y - gh, gw, gh); dx += gw; }
                            else { ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(size * 0.7)}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('x', dx + 2, y); }
                            continue;
                        }
                        const g = cf.digits[Number(ch2)];
                        const gw = g.bmp.width * g.s * kk, gh = g.bmp.height * g.s * kk;
                        ctx.drawImage(g.bmp, dx, y - gh, gw, gh);
                        dx += gw - (cf.overlap || 0) * kk;
                    }
                } else {
                    ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(size)}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
                    ctx.fillText(text, 14, y);
                }
            };
            if (combo > 0) drawNum(`${combo}x`, ch * bump, base, 1);
            if (best > combo) {
                // the best combo so far, smaller, above
                ctx.globalAlpha = 0.85;
                ctx.fillStyle = 'rgba(255,255,255,0.8)';
                ctx.font = `800 ${Math.round(ch * 0.32)}px system-ui, sans-serif`;
                ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
                const y = base - (combo > 0 ? ch * 1.08 : 0);
                ctx.fillText(L('最大連擊'), 16, y - ch * 0.5);
                drawNum(`${best}x`, ch * 0.5, y, 0.85);
            }
            ctx.restore();
        }

        /* The playfield border (standard and catch; taiko's lane and mania's stage
           are their own frame): a thin outline round where the notes can be, the
           area outside a little darker, as danser draws it. Same geometry as
           std.js / catch.js. */
        function fieldBounds(v) {
            const { w, h } = v;
            let x0, x1, y0, y1;
            if (replay.mode === 0) {
                const k = Math.min((h * 0.8) / 384, (w * 0.92) / 512);
                const R = (prep.radius || 32) * k;
                const ox = (w - 512 * k) / 2, oy = (h - 384 * k) / 2 + 4 * k;
                x0 = ox - R; x1 = ox + 512 * k + R; y0 = Math.max(1, oy - R); y1 = Math.min(h - 1, oy + 384 * k + R);
            } else if (replay.mode === 2) {
                const k = Math.min(h / 480, (w * 0.96) / 592);
                const ox = (w - 512 * k) / 2;
                x0 = ox - 24 * k; x1 = ox + 512 * k + 24 * k; y0 = 1; y1 = h - 1;
            } else return null;
            return { x0, x1, y0, y1 };
        }
        function drawFieldBorder(c, v) {
            const fb = fieldBounds(v);
            if (!fb) return;
            const { w, h } = v;
            const { x0, x1, y0, y1 } = fb;
            c.save();
            c.fillStyle = 'rgba(0,0,0,0.28)';
            c.fillRect(0, 0, x0, h); c.fillRect(x1, 0, w - x1, h);
            if (y0 > 1) { c.fillRect(x0, 0, x1 - x0, y0); c.fillRect(x0, y1, x1 - x0, h - y1); }
            c.strokeStyle = 'rgba(255,255,255,0.45)';
            c.lineWidth = Math.max(1, h / 540);
            c.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0), Math.round(y1 - y0));
            c.restore();
        }

        /* The map's global top 50 down the left side, with this play's score
           climbing through it as it goes (as in-game / danser): #1 always, then the
           places just above the player. The player's own scores on the board are
           left out. */
        let mapScoresP = null;
        function mapScores() {
            if (!mapScoresP) {
                const modeName = ['osu', 'taiko', 'fruits', 'mania'][replay.mode];
                mapScoresP = fetch(`/.netlify/functions/replay-scores?b=${encodeURIComponent(bm.beatmap_id)}&mode=${modeName}`)
                    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))));
                mapScoresP.catch(() => { mapScoresP = null; });
            }
            return mapScoresP;
        }
        let board = null; // [{ name, score, combo }], best first
        const liveScore = scoreTimeline(replay.mode, prep, replay.score);
        mapScores().then((d) => {
            const me = String(replay.player || '').toLowerCase();
            // the board in the replay's own kind of score: stable's (millions, combo-
            // weighted) or lazer's standardised (up to ~1M); scores without that kind
            // are left out rather than mixed in
            const big = (Number(replay.score) || 0) > 1.2e6;
            const pick = (s) => {
                if (big) return Number(s.legacy) || (Number(s.score) > 1.2e6 ? Number(s.score) : 0);
                return Number(s.total) || (Number(s.score) <= 1.2e6 ? Number(s.score) : 0);
            };
            board = (d.scores || []).filter((s) => s.user && s.user.name.toLowerCase() !== me)
                .map((s) => ({ name: s.user.name, score: pick(s), combo: Number(s.combo) || 0 }))
                .filter((e) => e.score > 0)
                .sort((a, b) => b.score - a.score);
        }).catch(() => { board = []; });
        function drawBoard(c, v, t, st2 = {}) {
            if (!board) return;
            const { w, h } = v;
            const nRows = replay.mode === 1 ? 5 : 6;
            const score = liveScore(t);
            const pos = board.filter((e) => e.score > score).length; // places above the player
            const me = { name: replay.player, score, combo: st2.best || st2.combo || 0, me: true };
            let rows;
            if (pos < nRows) rows = [...board.slice(0, pos), me, ...board.slice(pos)].slice(0, nRows).map((e, i) => ({ ...e, rank: i + 1 }));
            else rows = [{ ...board[0], rank: 1 }, ...board.slice(pos - (nRows - 2), pos).map((e, i) => ({ ...e, rank: pos - (nRows - 2) + i + 1 })), { ...me, rank: pos + 1 }];
            const fb = fieldBounds(v);
            // left of the field's border (standard / catch), so the two frames don't overlap
            const rw = Math.max(96, Math.min(230, w * 0.15, fb ? fb.x0 - 16 : 230)), rh = Math.max(24, Math.min(h * 0.05, rw * 0.26));
            const x = 8;
            // below the info card's corner (the player) and the lane (taiko)
            let y = replay.mode === 1 ? h * 0.575 : Math.max(h * 0.42, (h - rows.length * (rh + 3)) / 2);
            c.save();
            c.textBaseline = 'alphabetic';
            for (const r of rows) {
                c.fillStyle = r.me ? 'rgba(244,114,182,0.38)' : 'rgba(0,0,0,0.42)';
                c.beginPath(); c.roundRect ? c.roundRect(x, y, rw, rh, rh * 0.18) : c.rect(x, y, rw, rh); c.fill();
                if (r.me) { c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 1; c.stroke(); }
                const pad = rh * 0.16;
                // line 1: the name, and the place small at the right
                c.textAlign = 'right'; c.fillStyle = 'rgba(255,255,255,0.55)';
                c.font = `700 ${Math.round(rh * 0.34)}px system-ui, sans-serif`;
                const rankText = `#${r.me && pos >= board.length && board.length >= 50 ? '50+' : r.rank}`;
                c.fillText(rankText, x + rw - pad, y + rh * 0.44);
                const rankW = c.measureText(rankText).width;
                c.textAlign = 'left'; c.fillStyle = '#fff';
                c.font = `700 ${Math.round(rh * 0.4)}px system-ui, sans-serif`;
                let name = r.name || '';
                const maxW = rw - pad * 3 - rankW;
                while (name.length > 1 && c.measureText(name).width > maxW) name = name.slice(0, -1);
                if (name !== r.name) name = name.slice(0, -1) + '…';
                c.fillText(name, x + pad, y + rh * 0.44);
                // line 2: the score at the left, the combo at the right
                c.font = `600 ${Math.round(rh * 0.32)}px system-ui, sans-serif`;
                c.fillStyle = 'rgba(255,255,255,0.85)';
                c.fillText(r.score.toLocaleString(), x + pad, y + rh * 0.86);
                c.textAlign = 'right'; c.fillStyle = '#7fd3ff';
                c.font = `800 ${Math.round(rh * 0.32)}px system-ui, sans-serif`;
                c.fillText(`${r.combo.toLocaleString()}x`, x + rw - pad, y + rh * 0.86);
                y += rh + 3;
            }
            c.restore();
        }

        /* The opening of a video: the map's background, our logo beating at the
           map's BPM, and the map / player under it; it fades into the play. */
        const introIcon = new Image();
        introIcon.src = `assets/replay-intro/${['osu', 'taiko', 'fruits', 'mania'][replay.mode] || 'osu'}.png`;
        function drawIntro(c, v, sec, total) {
            const { w, h } = v;
            const a = Math.min(1, sec / 0.4) * Math.min(1, Math.max(0, (total - sec) / 0.6));
            if (a <= 0) return;
            c.save();
            c.globalAlpha = a;
            c.fillStyle = '#05040a'; c.fillRect(0, 0, w, h);
            if (bg) {
                const zoom = 1.04 + 0.03 * (sec / total);
                const s = Math.max(w / bg.width, h / bg.height) * zoom;
                c.globalAlpha = a * 0.22;
                c.drawImage(bg, (w - bg.width * s) / 2, (h - bg.height * s) / 2, bg.width * s, bg.height * s);
                c.globalAlpha = a;
            }
            // the logo: the site's icon (gradient disc, ring, dot), pulsing on the beat
            const bpm = Number(bm.bpm) * (prep.rate || 1) || 120;
            const beat = (sec * bpm / 60) % 1;
            const pulse = 1 + 0.045 * Math.exp(-beat * 6);
            const cx = w / 2, cy = h * 0.4, r = h * 0.17 * pulse;
            c.save();
            c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = h * 0.03;
            const g = c.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
            g.addColorStop(0, '#a855f7'); g.addColorStop(1, '#f472b6');
            c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
            c.restore();
            if (introIcon.complete && introIcon.naturalWidth) {
                // the mode's icon (assets/replay-intro/, the site owner's own; it has its own ring)
                const s2 = r * 1.72;
                c.drawImage(introIcon, cx - s2 / 2, cy - s2 / 2, s2, s2);
            } else {
                c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineWidth = r * 0.1;
                c.beginPath(); c.arc(cx, cy, r * 0.7, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.arc(cx, cy, r * 0.36, 0, Math.PI * 2); c.fill();
            }
            // the words
            c.textAlign = 'center'; c.textBaseline = 'top';
            c.shadowColor = 'rgba(0,0,0,0.8)'; c.shadowBlur = 6;
            let y = cy + h * 0.17 * 1.05 + h * 0.03;
            c.font = `800 ${Math.round(h * 0.024)}px system-ui, sans-serif`; c.fillStyle = 'rgba(255,255,255,0.7)';
            c.fillText('osu! Collection', cx, y); y += h * 0.05;
            const fit = (text, max) => { let s2 = text; while (s2.length > 4 && c.measureText(s2).width > max) s2 = s2.slice(0, -2); return s2 === text ? text : s2 + '…'; };
            c.font = `800 ${Math.round(h * 0.046)}px system-ui, sans-serif`; c.fillStyle = '#fff';
            c.fillText(fit(`${map.metadata.Artist || bm.artist} - ${map.metadata.Title || bm.title}`, w * 0.86), cx, y); y += h * 0.06;
            c.font = `700 ${Math.round(h * 0.032)}px system-ui, sans-serif`; c.fillStyle = srColor || '#f472b6';
            c.fillText(fit(`[${map.metadata.Version || bm.version}]  ${sr.toFixed(2)}★`, w * 0.86), cx, y); y += h * 0.05;
            c.font = `600 ${Math.round(h * 0.028)}px system-ui, sans-serif`; c.fillStyle = 'rgba(255,255,255,0.85)';
            c.fillText(`mapped by ${map.metadata.Creator || bm.creator}`, cx, y); y += h * 0.042;
            const modTxt = modsLabel(replay.mods);
            // "played by NAME [flag]  +MODS", centred as one line
            const who = session.cmp ? `${replay.player}  vs  ${session.cmp.replay.player}` : `played by ${replay.player}`;
            const modPart = modTxt && modTxt !== 'NM' ? `  +${modTxt.replace(/^\+/, '')}` : '';
            const hasFlag = introFlag.complete && introFlag.naturalWidth > 0;
            const fs2 = h * 0.028, fw = hasFlag ? fs2 * 1.3 : 0, gap = hasFlag ? fs2 * 0.35 : 0;
            const wWho = c.measureText(who).width, wMod = c.measureText(modPart).width;
            let lx = cx - (wWho + gap + fw + wMod) / 2;
            c.textAlign = 'left';
            c.fillText(who, lx, y); lx += wWho + gap;
            if (hasFlag) { c.shadowBlur = 0; c.drawImage(introFlag, lx, y + fs2 * 0.55 - fw / 2, fw, fw); c.shadowBlur = 6; lx += fw; }
            c.fillText(modPart, lx, y);
            c.restore();
        }

        /* Two players in a video: taiko as two full-width lanes one above the other,
           standard, mania and catch side by side (each player's own field, cursor and
           judgements); the score bar along the bottom. */
        const CMP_A = '#f472b6', CMP_B = '#5fb4ff';
        const cmpFlagB = new Image();
        cmpFlagB.crossOrigin = 'anonymous';
        function twemojiFlag(code) {
            if (!/^[A-Za-z]{2}$/.test(code || '')) return '';
            const cps = [...String(code).toUpperCase()].map((ch) => (0x1f1e6 + ch.charCodeAt(0) - 65).toString(16)).join('-');
            return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/${cps}.png`;
        }
        function cmpLabel(c, x, y, align, col, name, flag, st2, ppV, size, modBits) {
            c.save();
            c.textBaseline = 'top'; c.shadowColor = 'rgba(0,0,0,0.85)'; c.shadowBlur = 4;
            c.font = `italic 800 ${Math.round(size)}px system-ui, sans-serif`;
            const nw = c.measureText(name).width;
            const fw = flag && flag.complete && flag.naturalWidth ? size * 1.1 : 0;
            const x0 = align === 'left' ? x : x - nw - (fw ? fw + size * 0.3 : 0);
            c.fillStyle = col; c.textAlign = 'left';
            c.fillText(name, x0, y);
            if (fw) { c.shadowBlur = 0; c.drawImage(flag, x0 + nw + size * 0.3, y - size * 0.02, fw, fw); c.shadowBlur = 4; }
            const counts = st2.counts || {};
            const ml = modsLabel(modBits || 0);
            const line = `${ml && ml !== 'NM' ? `+${ml} · ` : ''}${((st2.acc ?? 1) * 100).toFixed(2)}%${ppV != null ? ` · ${Math.round(ppV)}pp` : ''} · ${(st2.combo || 0).toLocaleString()}x · ${counts.MISS || 0} miss`;
            c.font = `700 ${Math.round(size * 0.62)}px system-ui, sans-serif`; c.fillStyle = 'rgba(255,255,255,0.92)';
            c.textAlign = align;
            c.fillText(line, x, y + size * 1.12);
            c.restore();
        }
        function cmpScoreBar(c, w, h, top, sA, sB) {
            const bh = h - top;
            c.save();
            c.fillStyle = 'rgba(8,6,14,0.92)'; c.fillRect(0, top, w, bh);
            const m = w * 0.04, ty = top + bh * 0.2, th = Math.max(6, bh * 0.14);
            c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(m, ty, w - m * 2, th);
            const d = sA - sB, span = Math.max(50000, Math.max(sA, sB) * 0.15);
            const frac = Math.min(1, Math.abs(d) / span) * 0.5 * (w - m * 2);
            c.fillStyle = d >= 0 ? CMP_A : CMP_B;
            if (d >= 0) c.fillRect(w / 2 - frac, ty, frac, th); else c.fillRect(w / 2, ty, frac, th);
            c.fillStyle = '#fff'; c.fillRect(w / 2 - 1, ty - 3, 2, th + 6);
            c.textBaseline = 'top';
            const fs = Math.round(bh * 0.36), sy = ty + th + bh * 0.1;
            c.font = `800 ${fs}px system-ui, sans-serif`;
            c.textAlign = 'left'; c.fillStyle = d >= 0 ? CMP_A : 'rgba(255,255,255,0.75)'; c.fillText(sA.toLocaleString(), m, sy);
            c.textAlign = 'right'; c.fillStyle = d < 0 ? CMP_B : 'rgba(255,255,255,0.75)'; c.fillText(sB.toLocaleString(), w - m, sy);
            if (d) {
                c.textAlign = 'center'; c.font = `700 ${Math.round(fs * 0.62)}px system-ui, sans-serif`;
                c.fillStyle = d > 0 ? CMP_A : CMP_B; c.fillText(`+${Math.abs(d).toLocaleString()}`, w / 2, sy + fs * 0.2);
            }
            c.restore();
        }
        function drawCompareVideo(c, v, t) {
            const cmp = session.cmp;
            const { w, h } = v;
            const barTop = Math.round(h * 0.875);
            const sA = cmp.scoreA(t), sB = cmp.scoreB(t);
            const pA = ppAt(t), pB = cmp.ppAt(t);
            let stA, stB;
            c.fillStyle = '#05040a'; c.fillRect(0, 0, w, h);
            const lab = h * 0.034;
            if (replay.mode === 1) {
                // two full-width lanes, one above the other (taiko.js puts its lane at
                // 0.3 h – 0.525 h of the view it is given)
                const hv = h * 0.85, band = hv * 0.225;
                const ys = [h * 0.15, h * 0.15 + band + h * 0.12];
                [[prep, 0, CMP_A], [cmp.prep, 1, CMP_B]].forEach(([pp2, i, col]) => {
                    c.save();
                    c.beginPath(); c.rect(0, ys[i], w, band); c.clip();
                    c.translate(0, ys[i] - hv * 0.3);
                    const s2 = M.draw(c, { ...v, h: hv }, pp2, t);
                    c.restore();
                    if (i) stB = s2; else stA = s2;
                    c.fillStyle = col; c.fillRect(0, ys[i] - 3, w, 3);
                });
                cmpLabel(c, 14, ys[0] - lab * 2.05, 'left', CMP_A, replay.player, introFlag, stA, pA, lab, replay.mods);
                cmpLabel(c, 14, ys[1] - lab * 2.05, 'left', CMP_B, cmp.replay.player, cmpFlagB, stB, pB, lab, cmp.replay.mods);
            } else {
                // standard, mania and catch: two halves side by side
                const half = w / 2;
                [[prep, 0, CMP_A], [cmp.prep, 1, CMP_B]].forEach(([pp2, i, col]) => {
                    c.save();
                    c.beginPath(); c.rect(i * half, 0, half, barTop); c.clip();
                    c.translate(i * half, 0);
                    const s2 = M.draw(c, { ...v, w: half, h: barTop, maxField: half * 0.8, fieldW: 0.76 }, pp2, t);
                    c.restore();
                    if (i) stB = s2; else stA = s2;
                });
                c.fillStyle = 'rgba(255,255,255,0.5)'; c.fillRect(half - 1, 0, 2, barTop);
                cmpLabel(c, 14, 10, 'left', CMP_A, replay.player, introFlag, stA, pA, lab * 0.9, replay.mods);
                cmpLabel(c, half + 14, 10, 'left', CMP_B, cmp.replay.player, cmpFlagB, stB, pB, lab * 0.9, cmp.replay.mods);
            }
            cmpScoreBar(c, w, h, barTop, sA, sB);
        }

        const pauseEl = $('rp-pause');
        const showPause = (on) => { pauseEl.hidden = !on; };
        stage.addEventListener('click', () => {
            if (!pauseEl.hidden) { showPause(false); if (!clock.running()) clock.toggle(); return; }
            if (clock.running()) { clock.toggle(); showPause(true); }
            else clock.toggle();
        });
        pauseEl.addEventListener('click', (e) => {
            const b = e.target.closest('[data-act]');
            if (!b) { showPause(false); if (!clock.running()) clock.toggle(); return; }
            showPause(false);
            if (b.dataset.act === 'resume') { if (!clock.running()) clock.toggle(); }
            else if (b.dataset.act === 'restart') { clock.tail = null; audio.currentTime = Math.max(0, first - 1500) / 1000; audio.play().catch(() => {}); }
            else if (b.dataset.act === 'change') openReplayViewer();
        });
        audio.addEventListener('play', () => showPause(false));

        // the control bar slides out when the pointer comes near the bottom (devices with a mouse)
        const body = $('rp-body');
        let barTimer = 0;
        const showBar = (on) => { body.classList.toggle('rp-bar-shown', on); };
        body.addEventListener('mousemove', (e) => {
            const rect = body.getBoundingClientRect();
            const near = e.clientY > rect.bottom - 150;
            if (near) { showBar(true); clearTimeout(barTimer); }
            else if (body.classList.contains('rp-bar-shown') && !body.querySelector('.rp-menu[open]')) {
                clearTimeout(barTimer);
                barTimer = setTimeout(() => { if (!body.querySelector('.rp-menu[open]')) showBar(false); }, 150);
            }
        });
        body.addEventListener('mouseleave', () => { clearTimeout(barTimer); barTimer = setTimeout(() => { if (!body.querySelector('.rp-menu[open]')) showBar(false); }, 150); });

        /* ===== two replays of one map, side by side (as mania-tracker does) ===== */
        const body2 = $('rp-body');
        const cmpBtn = $('rp-compare-btn');
        const timed = replay.mode === 3; // modes with hit timing (UR, early / late)
        const timingA = timed ? timingTimeline(prep) : () => ({ early: 0, late: 0, mean: 0 });
        const rateOf = (mods) => (mods & 64 || mods & 512 ? 1.5 : mods & 256 ? 0.75 : 1);
        const CMP_ROWS = [
            ['acc', L('準確率'), 'hi'], ...(timed ? [['ur', 'UR', 'lo']] : []),
            // more of the good judgements is better, fewer of the rest
            ...JUDGES.map((j) => [j, jl(j), ['MAX', '300', 'FRUIT', 'DROP', 'TINY'].includes(j) ? 'hi' : 'lo', R.JUDGE_COLOR[j]]),
            ...(timed ? [['early', L('偏早'), ''], ['late', L('偏晚'), ''], ['mean', L('平均偏差'), 'abs']] : []),
            ['pp', 'PP', 'hi'],
        ];
        function closeCompare() {
            session.cmp = null;
            body2.classList.remove('rp-comparing');
            const h = $('rp-cmp'); if (h) h.remove();
        }
        async function startCompare(file) {
            const pick = $('rp-cmp-pick');
            const say = (msg) => { const el = pick && pick.querySelector('.rp-cmp-msg'); if (el) { el.textContent = msg; el.hidden = !msg; } };
            try {
                say(L('讀取中…'));
                const rB = window.replayFormats.parseOsr(await file.arrayBuffer());
                if (rB.beatmapMd5 !== replay.beatmapMd5) throw new Error(L('這個重播不是同一張譜面（或譜面版本不同）'));
                if (rateOf(rB.mods) !== rateOf(replay.mods)) throw new Error(L('兩個重播的倍速不同（例如一個有 DT），沒辦法並排比較'));
                if (rB.scoreId && rB.scoreId === replay.scoreId) throw new Error(L('這是同一份成績'));
                const prepB = M.prepare(map, rB);
                if (prep.defaultSkin) prepB.defaultSkin = prep.defaultSkin;
                session.cmp = { replay: rB, prep: prepB, ppAt: ppLookup(rB, prepB, bm.beatmap_id), timing: timed ? timingTimeline(prepB) : timingA, ppA: ppAt, scoreA: scoreTimeline(replay.mode, prep, replay.score), scoreB: scoreTimeline(rB.mode, prepB, rB.score) };
                if (pick) pick.remove();
                renderCompareHud();
                body2.classList.add('rp-comparing');
                lastCmp = '';
                return null;
            } catch (err) { const m = err && err.message ? err.message : String(err); say(m); return m; }
        }
        // the replay page starts a comparison of two scores it already has
        window.replayCompareWith = async (file) => {
            const err = await startCompare(file);
            if (err) { if (!$('rp-cmp-pick')) openComparePick(); const el = $('rp-cmp-pick')?.querySelector('.rp-cmp-msg'); if (el) { el.textContent = err; el.hidden = false; } }
        };
        window.replayOpenComparePick = () => { if (!$('rp-cmp-pick')) openComparePick(); };
        // the 🆚 render job: the second score by its osu! link / id; null when it worked, else the reason
        window.replayCompareWithScore = async (text) => {
            const ref = scoreRef(text);
            if (!ref) return L('看不懂這個網址，請貼 osu! 成績頁的網址（osu.ppy.sh/scores/…）或成績 ID');
            try { return await startCompare(await fetchScoreReplay(ref)); } catch (err) { return err && err.message ? err.message : String(err); }
        };
        function renderCompareHud() {
            const c = session.cmp;
            const old = $('rp-cmp'); if (old) old.remove();
            const flag = (r2, side) => `<span class="rp-cmp-who"><img class="rp-flag" id="rp-cmp-flag-${side}" alt="" hidden>${esc(r2.player)}</span>`;
            const wrap = document.createElement('div');
            wrap.className = 'rp-cmp is-broadcast';
            wrap.id = 'rp-cmp';
            const stats = M.stats(map, prep);
            const lenMs = ((Number(bm.total_length) || 0) * 1000) / (prep.rate || 1);
            wrap.innerHTML = `
                <div class="rp-bc-team is-a"><img class="rp-flag" id="rp-cmp-flag-a" alt="" hidden><div><b>${esc(replay.player)}</b><small id="rp-cmp-prof-a"></small></div></div>
                <div class="rp-bc-title"><b>${esc(map.metadata.Title || bm.title)}</b><small>${L('雙人比較')}</small></div>
                <div class="rp-bc-team is-b"><div><b>${esc(c.replay.player)}</b><small id="rp-cmp-prof-b"></small></div><img class="rp-flag" id="rp-cmp-flag-b" alt="" hidden></div>
                <button type="button" class="rp-cmp-close" id="rp-cmp-close" title="${L('結束比較')}" aria-label="${L('結束比較')}">✕</button>
                <div class="rp-bc-screenmods is-a">${modsHtml(replay.mods)}</div>
                <div class="rp-bc-screenmods is-b">${modsHtml(c.replay.mods)}</div>
                <div class="rp-bc-bar"><i class="rp-bc-push" id="rp-bc-push"></i><span class="rp-bc-diff" id="rp-bc-diff"></span></div>
                <div class="rp-bc-scores"><b class="is-a" id="rp-bc-sa">0</b><b class="is-b" id="rp-bc-sb">0</b></div>
                <div class="rp-bc-map" style="--cover:url('https://assets.ppy.sh/beatmaps/${encodeURIComponent(bm.beatmapset_id)}/covers/cover@2x.jpg')">
                    <b>${esc(map.metadata.Artist || bm.artist)} - ${esc(map.metadata.Title || bm.title)}</b>
                    <small>mapper <b>${esc(map.metadata.Creator || bm.creator)}</b> &nbsp; difficulty <b>${esc(map.metadata.Version || bm.version)}</b></small>
                </div>
                <dl class="rp-bc-stats">
                    ${stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
                    <div><dt>Star Rating</dt><dd>${sr.toFixed(2)}</dd></div>
                    <div><dt>Length</dt><dd>${fmt(lenMs)}</dd></div>
                    <div><dt>BPM</dt><dd>${Math.round((Number(bm.bpm) || 0) * (prep.rate || 1))}</dd></div>
                </dl>
                <div class="rp-cmp-top" hidden>
                    <div class="rp-cmp-name is-a"><b>${flag(replay, 'a')}</b><small class="rp-cmp-pp-line" id="rp-cmp-prof-a"></small><small>${esc(modsLabel(replay.mods))}${replay.playedAt && !isNaN(replay.playedAt) ? ` · ${esc(replay.playedAt.toLocaleDateString())}` : ''}</small></div>
                    <div class="rp-cmp-map"><b>${esc(map.metadata.Title || bm.title)}</b><small>[${esc(map.metadata.Version || bm.version)}]</small></div>
                    <div class="rp-cmp-name is-b"><b>${flag(c.replay, 'b')}</b><small class="rp-cmp-pp-line" id="rp-cmp-prof-b"></small><small>${esc(modsLabel(c.replay.mods))}${c.replay.playedAt && !isNaN(c.replay.playedAt) ? ` · ${esc(c.replay.playedAt.toLocaleDateString())}` : ''}</small></div>
                    <button type="button" class="rp-cmp-close" id="rp-cmp-close" title="${L('結束比較')}" aria-label="${L('結束比較')}">✕</button>
                </div>
                <div class="rp-cmp-lead"><i id="rp-cmp-lead"></i></div>
                <dl class="rp-cmp-rows">${CMP_ROWS.map(([k, label, , col]) => `<div class="rp-cmp-row" data-k="${k}"><dd class="is-a" id="rp-cmp-a-${k}">–</dd><dt${col ? ` style="color:${col}"` : ''}>${label}</dt><dd class="is-b" id="rp-cmp-b-${k}">–</dd></div>`).join('')}</dl>`;
            wrap.insertAdjacentHTML('beforeend', compareResultsHtml());
            body2.appendChild(wrap);
            $('rp-cmp-close').addEventListener('click', closeCompare);
            wrap.querySelector('[data-act="again"]').addEventListener('click', () => { clock.tail = null; audio.currentTime = Math.max(0, first - 1500) / 1000; audio.play().catch(() => {}); });
            wrap.querySelector('[data-act="end"]').addEventListener('click', closeCompare);
            // each player's flag and standing in this mode
            for (const [side, r2] of [['a', replay], ['b', c.replay]]) {
                osuFetch(`u=${encodeURIComponent(r2.player)}&type=string&m=${r2.mode}`).then((res) => {
                    const u = Array.isArray(res) ? res[0] : null;
                    if (!u) return;
                    const n = (v) => Number(v || 0).toLocaleString();
                    // no ranking (inactive or restricted accounts come back with 0) shows nothing
                    const line = Number(u.pp_rank) > 0 ? `${n(Math.round(Number(u.pp_raw) || 0))}pp · #${n(u.pp_rank)}` : '';
                    document.querySelectorAll(`#rp-cmp-prof-${side}, #rp-cmpr-prof-${side}`).forEach((el2) => { el2.textContent = line; });
                    if (u.country) {
                        document.querySelectorAll(`#rp-cmp-flag-${side}, #rp-cmpr-flag-${side}`).forEach((fl) => {
                            fl.src = `https://flagcdn.com/48x36/${String(u.country).toLowerCase()}.png`;
                            fl.alt = u.country; fl.title = u.country; fl.hidden = false;
                        });
                    }
                    document.querySelectorAll(`#rp-cmpr-av-${side}`).forEach((av) => { av.src = `https://a.ppy.sh/${encodeURIComponent(u.user_id)}`; av.hidden = false; });
                }).catch(() => {});
            }
        }
        // the results for both players, from what each replay recorded (as the game shows it)
        function compareResultsHtml() {
            const c = session.cmp;
            const sides = [['a', replay], ['b', c.replay]].map(([side, r2]) => {
                const rec = M.record(r2);
                const acc = accOf(rec);
                const rk = (r2.lazer && r2.lazer.rank ? ({ X: 'SS', XH: 'SS', SH: 'S' }[r2.lazer.rank] || r2.lazer.rank) : '') || (M.rank ? M.rank(rec, acc) : '');
                const silver = (r2.mods & (8 | 1024)) && (rk === 'SS' || rk === 'S');
                return { side, r2, rec, acc, rk, key: silver ? `${rk}H` : rk };
            });
            const [A, B] = sides;
            const win = A.r2.score === B.r2.score ? '' : A.r2.score > B.r2.score ? 'a' : 'b';
            const col = (x) => `
                <div class="rp-cmpr-side is-${x.side}${win === x.side ? ' is-winner' : ''}">
                    ${win === x.side ? `<span class="rp-cmpr-crown">👑 ${L('勝利')}</span>` : '<span class="rp-cmpr-crown is-empty"></span>'}
                    <div class="rp-cmpr-player"><img class="rp-cmpr-av" id="rp-cmpr-av-${x.side}" alt="" hidden>
                        <div><b><img class="rp-flag" id="rp-cmpr-flag-${x.side}" alt="" hidden>${esc(x.r2.player)}</b><small id="rp-cmpr-prof-${x.side}"></small></div></div>
                    <div class="rp-res-rank" data-rank="${x.key}">${x.rk}</div>
                    <div class="rp-cmpr-score">${(Number(x.r2.score) || 0).toLocaleString()}</div>
                    <div class="rp-cmpr-pair"><div><small>${L('準確率')}</small><b>${(x.acc * 100).toFixed(2)}%</b></div><div><small>${L('最大連擊')}</small><b>${x.r2.maxCombo.toLocaleString()}x</b></div></div>
                    <div class="rp-cmpr-counts">${JUDGES.map((j) => `<div><small style="color:${R.JUDGE_COLOR[j]}">${jl(j)}</small><b>${x.rec[j]}</b></div>`).join('')}</div>
                    <div class="rp-cmpr-pp"><b id="rp-cmpr-pp-${x.side}">–</b><small>pp</small></div>
                    <div class="rp-cmpr-mods">${esc(modsLabel(x.r2.mods))}</div>
                </div>`;
            return `<div class="rp-cmpr" id="rp-cmpr" hidden>
                <div class="rp-cmpr-card" role="dialog" aria-label="${L('結算')}">
                    <div class="rp-cmpr-head"><b>${esc(map.metadata.Artist || bm.artist)} - ${esc(map.metadata.Title || bm.title)}</b><small>[${esc(map.metadata.Version || bm.version)}]</small></div>
                    <div class="rp-cmpr-grid">${col(A)}<div class="rp-cmpr-vs">VS</div>${col(B)}</div>
                    ${win ? `<span class="rp-cmpr-wincrown is-${win}">👑 ${L('勝利')}</span>` : ''}
                    <div class="rp-res-actions">
                        <button type="button" class="rp-btn" data-act="again">↺ ${L('再看一次')}</button>
                        <button type="button" class="rp-btn" data-act="end">${L('結束比較')}</button>
                        <button type="button" class="rp-btn" onclick="openReplayViewer()">⏏ ${L('換一個重播')}</button>
                    </div>
                </div>
            </div>`;
        }
        function showCompareResults(on, fade, onCanvas) {
            const el2 = $('rp-cmpr');
            if (!el2) return;
            el2.classList.toggle('is-wide', !!onCanvas);
            if (el2.hidden === on) el2.hidden = !on;
            if (!on) return;
            el2.style.opacity = String(Math.max(0, Math.min(1, fade)));
            const end = prep.lastTime + 1;
            const pa = ppAt(end), pb = session.cmp.ppAt(end);
            $('rp-cmpr-pp-a').textContent = pa == null ? '–' : Math.round(pa).toLocaleString();
            $('rp-cmpr-pp-b').textContent = pb == null ? '–' : Math.round(pb).toLocaleString();
        }
        let lastBc = '';
        function updateBroadcast(scores, geo) {
            const wrap = $('rp-cmp');
            if (!wrap) return;
            const key = `${scores[0]}|${scores[1]}|${geo.top}|${geo.vh}|${geo.rightA}`;
            if (key === lastBc) return;
            lastBc = key;
            // the mod badges sit on each screen, under its score / accuracy / pp
            wrap.style.setProperty('--bc-mods-top', `${geo.top + geo.vh * 0.135 + 12}px`);
            wrap.style.setProperty('--bc-mods-h', `${Math.round(Math.max(22, Math.min(40, geo.vh * 0.06)))}px`);
            wrap.style.setProperty('--bc-right-a', `${geo.rightA + 10}px`);
            wrap.style.setProperty('--bc-right-b', `${geo.rightB + 10}px`);
            // the flags line up with the outer edges of the two screens below, the same on both sides
            wrap.style.setProperty('--bc-edge', `${geo.rightB}px`);
            wrap.style.setProperty('--bc-top', `${geo.top}px`);
            wrap.style.setProperty('--bc-bottom', `${geo.top + geo.vh}px`);
            const [a, b] = scores;
            $('rp-bc-sa').textContent = a.toLocaleString();
            $('rp-bc-sb').textContent = b.toLocaleString();
            $('rp-bc-sa').classList.toggle('is-lead', a > b);
            $('rp-bc-sb').classList.toggle('is-lead', b > a);
            // the push: from the middle toward the leader's side, longer the further ahead
            const d = a - b;
            const span = Math.max(50000, Math.max(a, b) * 0.15);
            const frac = Math.min(1, Math.abs(d) / span) * 50;
            const push = $('rp-bc-push');
            push.style.width = `${frac}%`;
            push.style.left = d >= 0 ? `${50 - frac}%` : '50%';
            push.className = `rp-bc-push ${d >= 0 ? 'is-a' : 'is-b'}`;
            const diff = $('rp-bc-diff');
            diff.textContent = d === 0 ? '' : `${d > 0 ? '-' : '-'}${Math.abs(d).toLocaleString()}`;
            diff.className = `rp-bc-diff ${d > 0 ? 'is-b' : 'is-a'}`;
        }
        let lastCmp = '';
        function updateCompareHud(sA, sB, t) {
            const c = session.cmp;
            const tA = timingA(t), tB = c.timing(t);
            const ppA = ppAt(t), ppB = c.ppAt(t);
            const val = {
                acc: [sA.acc, sB.acc], ur: [sA.ur, sB.ur],
                ...Object.fromEntries(JUDGES.map((j) => [j, [sA.counts[j], sB.counts[j]]])),
                early: [tA.early, tB.early], late: [tA.late, tB.late], mean: [tA.mean, tB.mean], pp: [ppA, ppB],
            };
            const key = JSON.stringify(val);
            if (key === lastCmp) return;
            lastCmp = key;
            const fmtV = (k, v) => (v == null ? '–' : k === 'acc' ? `${(v * 100).toFixed(2)}%` : k === 'ur' ? v.toFixed(1) : k === 'mean' ? `${v > 0 ? '+' : ''}${v.toFixed(1)}ms` : k === 'pp' ? Math.round(v).toLocaleString() : String(v));
            for (const [k, , better] of CMP_ROWS) {
                const [a, b] = val[k];
                const ea = $(`rp-cmp-a-${k}`), eb = $(`rp-cmp-b-${k}`);
                ea.textContent = fmtV(k, a); eb.textContent = fmtV(k, b);
                let win = 0;
                if (a != null && b != null && a !== b && better) {
                    if (better === 'hi') win = a > b ? -1 : 1;
                    else if (better === 'lo') win = a < b ? -1 : 1;
                    else if (better === 'abs') win = Math.abs(a) < Math.abs(b) ? -1 : 1;
                }
                ea.classList.toggle('is-win', win === -1); eb.classList.toggle('is-win', win === 1);
            }
            // the lead bar: pp share once known, accuracy until then
            const pa = ppA != null && ppB != null && ppA + ppB > 0 ? ppA / (ppA + ppB) : sA.acc + sB.acc > 0 ? sA.acc / (sA.acc + sB.acc) : 0.5;
            $('rp-cmp-lead').style.width = `${(pa * 100).toFixed(1)}%`;
        }
        function openComparePick() {
            const old = $('rp-cmp-pick'); if (old) { old.remove(); return; }
            const pick = document.createElement('div');
            pick.className = 'rp-cmp-pick';
            pick.id = 'rp-cmp-pick';
            pick.innerHTML = `
                <div class="rp-cmp-pick-card" role="dialog" aria-label="${L('雙人比較')}">
                    <button type="button" class="rp-menu-close" aria-label="${L('關閉')}">✕</button>
                    <b class="rp-cmp-pick-title">${L('選另一份成績來比較')}</b>
                    <small>${L('同一張譜面、倍速相同的成績才能比較。')}</small>
                    <form class="rp-url" id="rp-cmp-url"><input type="text" autocomplete="off" placeholder="${L('貼上 osu! 成績網址或成績 ID')}" aria-label="${L('貼上 osu! 成績網址或成績 ID')}"><button type="submit" class="rp-btn">${L('載入')}</button>
                        <label class="rp-btn">${L('上傳 .osr')}<input type="file" accept=".osr" hidden></label></form>
                    <p class="rp-cmp-msg rp-error" hidden></p>
                    <div class="rp-cmp-list"><p class="rp-note">${L('讀取排行榜…')}</p></div>
                </div>`;
            body2.appendChild(pick);
            pick.querySelector('.rp-menu-close').addEventListener('click', () => pick.remove());
            pick.addEventListener('click', (e) => { if (e.target === pick) pick.remove(); });
            const say = (msg) => { const el = pick.querySelector('.rp-cmp-msg'); el.textContent = msg; el.hidden = !msg; };
            pick.querySelector('input[type=file]').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) startCompare(f); });
            pick.querySelector('#rp-cmp-url').addEventListener('submit', async (e) => {
                e.preventDefault();
                const ref = scoreRef(e.target.querySelector('input[type=text]').value);
                if (!ref) { say(L('看不懂這個網址，請貼 osu! 成績頁的網址（osu.ppy.sh/scores/…）或成績 ID')); return; }
                try { say(L('從 osu! 取得重播')); await startCompare(await fetchScoreReplay(ref)); } catch (err) { say(err.message); }
            });
            mapScores()
                .then((data) => {
                    const list = pick.querySelector('.rp-cmp-list');
                    const rate = rateOf(replay.mods);
                    const bits = { DT: 64, NC: 512, HT: 256 };
                    const rows = (data.scores || []).map((s, i) => [s, i]).filter(([s]) => s.replay !== false).map(([s, i]) => {
                        const sr = s.mods.reduce((acc, m) => acc | (bits[m] || 0), 0);
                        const ok = rateOf(sr) === rate && String(s.id) !== String(replay.scoreId) && String(s.legacyId) !== String(replay.scoreId);
                        return `<button type="button" class="rp-cmp-item" data-id="${s.id}"${ok ? '' : ' disabled'} title="${ok ? '' : esc(L('倍速不同或是同一份成績'))}">
                            <span class="rp-cmp-rank">#${i + 1}</span>
                            ${s.user && s.user.avatar ? `<img src="${esc(s.user.avatar)}" alt="" loading="lazy">` : '<i></i>'}
                            <b>${esc(s.user ? s.user.name : '?')}</b>
                            <span class="rp-cmp-mods">${esc(s.mods.join('') || 'NM')}</span>
                            <span>${(s.acc * 100).toFixed(2)}%</span>
                            <span class="rp-cmp-pp">${s.pp ? `${Math.round(s.pp)}pp` : ''}</span>
                        </button>`;
                    });
                    list.innerHTML = rows.length ? rows.join('') : `<p class="rp-note">${L('排行榜上沒有可以下載重播的成績')}</p>`;
                    list.querySelectorAll('.rp-cmp-item:not([disabled])').forEach((b) => b.addEventListener('click', async () => {
                        try { say(L('從 osu! 取得重播')); await startCompare(await fetchScoreReplay({ id: b.dataset.id })); } catch (err) { say(err.message); }
                    }));
                })
                .catch(() => { pick.querySelector('.rp-cmp-list').innerHTML = `<p class="rp-note">${L('讀不到排行榜，可以貼成績網址或上傳 .osr')}</p>`; });
        }
        if (cmpBtn) cmpBtn.addEventListener('click', openComparePick);

        // the counts follow the top-right block down (taiko keeps them under its lane)
        if (replay.mode !== 1 && typeof ResizeObserver === 'function') {
            const topBox = $('rp-hud-top'), stats = $('rp-hud-stats');
            const place = () => { stats.style.top = `${topBox.offsetTop + topBox.offsetHeight + 8}px`; };
            new ResizeObserver(place).observe(topBox);
            place();
        }
        // the time pie: how far through the map (first object to last)
        const pieEl = $('rp-pie'), ppEl = $('rp-pp');
        const pieFrom = first, pieTo = Math.max(first + 1, prep.lastTime);
        let lastPie = -1;
        const drawPie = (t) => {
            const f = Math.max(0, Math.min(1, (t - pieFrom) / (pieTo - pieFrom)));
            const q = Math.round(f * 400) / 400;
            if (q === lastPie) return;
            lastPie = q;
            if (q <= 0) { pieEl.setAttribute('d', ''); return; }
            if (q >= 1) { pieEl.setAttribute('d', 'M18 18 m-15.5 0 a15.5 15.5 0 1 0 31 0 a15.5 15.5 0 1 0 -31 0'); return; }
            const a = q * Math.PI * 2 - Math.PI / 2;
            const x = 18 + 15.5 * Math.cos(a), y = 18 + 15.5 * Math.sin(a);
            pieEl.setAttribute('d', `M18 18 L18 2.5 A15.5 15.5 0 ${q > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`);
        };
        // the pp as the replay goes: worked out on the server in one pass
        const ppStates = ppStatesFor(replay.mode, prep);
        let ppTimes = null, ppValues = null, lastPp = null;
        if (ppStates.length && bm.beatmap_id) {
            fetch(window.REPLAY_PP_ENDPOINT || '/.netlify/functions/replay-pp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: Number(bm.beatmap_id), mods: replay.mods >>> 0, mode: replay.mode, states: ppStates.map(({ t: _t, ...rest }) => rest) }),
            }).then((res) => (res.ok ? res.json() : null)).then((data) => {
                if (!data || !Array.isArray(data.pp) || data.pp.length !== ppStates.length) return;
                ppTimes = ppStates.map((s2) => s2.t);
                ppValues = data.pp;
            }).catch(() => {});
        }
        const ppAt = (t) => {
            if (!ppTimes) return null;
            let lo = 0, hi = ppTimes.length - 1, ans = -1;
            while (lo <= hi) { const mid = (lo + hi) >> 1; if (ppTimes[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
            return ans < 0 ? 0 : ppValues[ans];
        };
        let lastShown = '';
        session.cmp = null;
        let lastStats = { combo: 0, acc: 1, counts: Object.fromEntries(JUDGES.map((j) => [j, 0])), ur: 0, lMiss: 0, rMiss: 0 };
        const resultsData = {
            mode: replay.mode, record, replay, rank: rankImage, acc: accOf(record), bg, lifeBar,
            title: `${map.metadata.Artist || bm.artist} - ${map.metadata.Title || bm.title} [${map.metadata.Version || bm.version}]`,
            line2: `${L('譜面作者')}: ${map.metadata.Creator || bm.creator}`,
            line3: `${L('遊玩者')}: ${replay.player}${played ? ` · ${played}` : ''}`,
        };
        function resultsDataFor(r2, p2) {
            const rec = M.record(r2);
            const acc = accOf(rec);
            const rb = (r2.lazer && r2.lazer.rank ? ({ X: 'SS', XH: 'SS', SH: 'S' }[r2.lazer.rank] || r2.lazer.rank) : '') || (M.rank ? M.rank(rec, acc) : '');
            const sv = (r2.mods & (8 | 1024)) && (rb === 'SS' || rb === 'S');
            let lb = String(r2.lifeBar || '').split(',').map((x) => { const [a, b] = x.split('|'); return { t: Number(a), hp: Number(b) }; }).filter((x) => Number.isFinite(x.t) && Number.isFinite(x.hp));
            if (lb.length < 2 && r2.mode === 0) {
                let hp = 1;
                lb = [{ t: 0, hp }];
                for (const e of p2.events) {
                    if (!e.count) continue;
                    const q = { 300: 1, 100: 0.5, 50: 0.2, MISS: -1 }[e.result];
                    hp = Math.min(1, Math.max(0, hp + (q > 0 ? 0.02 * q : q * 0.08)));
                    lb.push({ t: e.jt, hp });
                }
            }
            if (lb.length < 2 && r2.mode === 1) {
                let hp = 1;
                lb = [{ t: 0, hp }];
                for (const e of p2.events) {
                    const q = { 300: 1, 100: 0.5, MISS: -1 }[e.result];
                    hp = Math.min(1, Math.max(0, hp + (q > 0 ? 0.02 * q : q * 0.08)));
                    lb.push({ t: e.jt, hp });
                }
            }
            if (lb.length < 2 && r2.mode === 2) {
                let hp = 1;
                lb = [{ t: 0, hp }];
                for (const o of p2.flat) {
                    if (o.kind === 'banana') continue;
                    const q = o.caught ? (o.kind === 'tiny' ? 0.3 : 1) : o.kind === 'tiny' ? -0.3 : -1;
                    hp = Math.min(1, Math.max(0, hp + (q > 0 ? 0.02 * q : q * 0.08)));
                    lb.push({ t: o.time, hp });
                }
            }
            if (lb.length < 2 && r2.mode === 3) {
                let hp = 1;
                lb = [{ t: p2.events.length ? p2.events[0].judgedAt : 0, hp }];
                for (const e of p2.events) {
                    const q = { MAX: 1, 300: 1, 200: 0.6, 100: 0.3, 50: 0, MISS: -1 }[e.judge];
                    hp = Math.min(1, Math.max(0, hp + (q > 0 ? 0.02 * q : q * 0.08)));
                    lb.push({ t: e.judgedAt, hp });
                }
            }
            const pl = r2.playedAt && !isNaN(r2.playedAt) ? r2.playedAt.toLocaleDateString() : '';
            return {
                mode: r2.mode, record: rec, replay: r2, rank: (rb === 'SS' ? 'X' : rb) + (sv ? 'H' : ''), acc, bg, lifeBar: lb,
                title: `${map.metadata.Title || bm.title} [${map.metadata.Version || bm.version}]`,
                line2: `${L('譜面作者')}: ${map.metadata.Creator || bm.creator}`,
                line3: `${L('遊玩者')}: ${r2.player}${pl ? ` · ${pl}` : ''}`,
            };
        }
        // two ranking screens side by side, each in its half; the winner framed in its colour
        function drawCompareRanking(fadeIn) {
            const c = session.cmp;
            if (!c.resA) { c.resA = resultsDataFor(replay, prep); c.resB = resultsDataFor(c.replay, c.prep); }
            c.resA.pp = ppAt(prep.lastTime + 1);
            c.resB.pp = c.ppAt(c.prep.lastTime + 1);
            // each half laid out as wide as the single-player screen would be, then scaled into its half
            const uFull = Math.min(view.h / 768, view.w / 1024);
            c.resA.minWidth = c.resB.minWidth = view.w / uFull;
            const half = view.w / 2;
            const win = replay.score === c.replay.score ? '' : replay.score > c.replay.score ? 'a' : 'b';
            [['a', c.resA, 0, '#f472b6'], ['b', c.resB, half, '#5fb4ff']].forEach(([side, data, x, col]) => {
                ctx.save();
                ctx.translate(x, 0);
                ctx.beginPath(); ctx.rect(0, 0, half, view.h); ctx.clip();
                window.replayResults.drawResults(ctx, { ...view, w: half }, data);
                ctx.fillStyle = col;
                ctx.fillRect(0, 0, half, 4);
                if (win === side) { ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.strokeRect(3, 3, half - 6, view.h - 6); }
                ctx.restore();
            });
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.fillRect(half - 1, 0, 2, view.h);
            blackOver(1 - fadeIn);
        }
        const loadRankSkin = (sk) => { view.rankSkin = null; (sk ? sk.forRanking() : window.replaySkin.loadDefaultRanking()).then((v) => { view.rankSkin = v; }).catch(() => { window.replaySkin.loadDefaultRanking().then((v) => { view.rankSkin = v; }); }); };
        loadRankSkin(savedSkins[replay.mode]);
        const tick = () => {
            const t = clock.now();
            playSounds(t, clock.running());
            // the way out follows the clock, so it pauses, seeks and ends with the timeline
            const atEnd = t >= outroAt && !seeking;
            if (!atEnd) resultsDismissed = false;
            const el = !atEnd || resultsDismissed ? -1 : (t - outroAt) / (audio.playbackRate || 1);
            const showResAll = el >= OUTRO.rank;
            const showRes = showResAll && !session.cmp;
            if (resultsEl.hidden === showRes) resultsEl.hidden = !showRes;
            const cmpWide = !!(session.cmp && showResAll && view.rankSkin && view.w >= 640);
            if (session.cmp) showCompareResults(showResAll, (el - OUTRO.rank) / OUTRO.rankIn, cmpWide);
            // wide views get osu!'s own ranking screen on the canvas; narrow ones the card
            const wide = showRes && view.rankSkin && view.w >= 640;
            resultsEl.classList.toggle('is-wide', !!wide);
            $('rp-body').classList.toggle('rp-show-results', !!wide);
            ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
            let s;
            if (cmpWide) {
                drawCompareRanking(Math.max(0, Math.min(1, (el - OUTRO.rank) / OUTRO.rankIn)));
                s = lastStats;
            } else if (wide) {
                resultsData.pp = ppAt(prep.lastTime + 1);
                const out = window.replayResults.drawResults(ctx, view, resultsData);
                const acts = $('rp-res-actions');
                acts.style.top = `${Math.round(out.actions.top)}px`;
                acts.style.right = `${Math.round(out.actions.right)}px`;
                const inP = (el - OUTRO.rank) / OUTRO.rankIn;
                blackOver(1 - inP); // the ranking screen fades in from black
                acts.style.opacity = String(Math.max(0, Math.min(1, inP)));
                s = lastStats;
            } else {
                if (session.cmp) {
                    // a tournament-broadcast frame: names in the corners, two 4:3 game
                    // screens side by side, the score bar and the map below
                    const W2 = view.w, H2 = view.h;
                    const head = 96, below = 176; // above: the names; under the screens: the score bar, the scores, the map
                    const vh = Math.max(120, Math.min((W2 / 2 - 24) * 0.75, H2 - head - below));
                    // the whole frame centred top to bottom when the screens are width-bound
                    const top = Math.round(Math.max(head, (H2 - vh - below - head) / 2 + head));
                    const vw = vh * 4 / 3;
                    const gap = Math.max(12, (W2 - vw * 2) / 3);
                    const xs = [gap, W2 - gap - vw];
                    // the backdrop: the map's background, dim
                    ctx.fillStyle = '#05040a'; ctx.fillRect(0, 0, W2, H2);
                    if (bg) { const sc = Math.max(W2 / bg.width, H2 / bg.height); ctx.globalAlpha = 0.28; ctx.drawImage(bg, (W2 - bg.width * sc) / 2, (H2 - bg.height * sc) / 2, bg.width * sc, bg.height * sc); ctx.globalAlpha = 1; }
                    const side = { ...view, w: vw, h: vh, maxField: vw * 0.72 };
                    const sides = [[prep, replay, xs[0], '#f472b6'], [session.cmp.prep, session.cmp.replay, xs[1], '#5fb4ff']];
                    const st = sides.map(([pp2, rr, x]) => {
                        ctx.save(); ctx.translate(x, top); ctx.beginPath(); ctx.rect(0, 0, vw, vh); ctx.clip();
                        const out = M.draw(ctx, side, pp2, t);
                        ctx.restore();
                        return out;
                    });
                    s = st[0];
                    const sB = st[1];
                    const scores = [session.cmp.scoreA(t), session.cmp.scoreB(t)];
                    const pps = [ppAt(t), session.cmp.ppAt(t)];
                    sides.forEach(([, rr, x, col], i) => {
                        // on each screen: score and accuracy top right, the name bottom right (as in-game)
                        ctx.save();
                        ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
                        ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4;
                        ctx.font = `800 ${Math.round(vh * 0.07)}px system-ui, sans-serif`;
                        ctx.fillText(String(scores[i]).padStart(8, '0'), x + vw - 10, top + 6);
                        ctx.font = `700 ${Math.round(vh * 0.04)}px system-ui, sans-serif`;
                        const acc = `${(st[i].acc * 100).toFixed(2)}%`;
                        ctx.fillText(acc + (pps[i] != null ? `  ·  ${Math.round(pps[i])}pp` : ''), x + vw - 10, top + 8 + vh * 0.075);
                        ctx.font = `italic 800 ${Math.round(vh * 0.065)}px system-ui, sans-serif`;
                        ctx.fillStyle = col; ctx.textBaseline = 'bottom';
                        ctx.fillText(rr.player, x + vw - 10, top + vh - 8);
                        ctx.restore();
                        // combo and best combo bottom left, as on the single-player screen
                        ctx.save(); ctx.translate(x, top); ctx.beginPath(); ctx.rect(0, 0, vw, vh); ctx.clip();
                        drawCombo(st[i] || {}, vh, i ? 'b' : 'a');
                        ctx.restore();
                        drawSideCounts(st[i] || {}, x, top, vw, vh);
                        ctx.fillStyle = col; ctx.fillRect(x, top - 3, vw, 3);
                    });
                    updateBroadcast(scores, { top, vh, below, rightA: W2 - (xs[0] + vw), rightB: W2 - (xs[1] + vw) });
                    updateCompareHud(s, sB, t);
                } else {
                    s = M.draw(ctx, view, prep, t);
                    if (prefs.border !== false) drawFieldBorder(ctx, view);
                    if (prefs.board !== false) drawBoard(ctx, view, t, s);
                    drawCombo(s);
                }
                if (el >= 0) {
                    bgOnly(Math.min(1, el / OUTRO.fade)); // the play fades out, the background comes up
                    if (!showRes) blackOver((el - OUTRO.black) / (OUTRO.rank - OUTRO.black));
                }
            }
            lastStats = s;
            // the HUD fades with the play
            $('rp-body').style.setProperty('--rp-outro', el >= 0 ? String(Math.max(0, 1 - el / OUTRO.fade)) : '1');
            const key = `${s.acc}|${s.ur}|${s.lMiss}|${s.rMiss}|${JUDGES.map((j) => s.counts[j]).join()}`;
            if (key !== lastShown) {
                lastShown = key;
                accEl.textContent = `${(s.acc * 100).toFixed(2)}%`;
                if (urEl) urEl.textContent = s.ur.toFixed(0);
                if (lEl) lEl.textContent = s.lMiss;
                if (rEl) rEl.textContent = s.rMiss;
                for (const j of JUDGES) countEls[j].textContent = s.counts[j];
            }
            drawPie(t);
            const ppNow = ppAt(t);
            if (ppNow !== lastPp) { lastPp = ppNow; ppEl.textContent = ppNow == null ? '–' : Math.round(ppNow).toLocaleString(); }
            timeEl.textContent = fmtReal(t);
            seekNow.textContent = timeEl.textContent;
            if (!seeking) seek.value = String(Math.round((t / endMs()) * 1000));
            session.raf = requestAnimationFrame(tick);
        };
        session.raf = requestAnimationFrame(tick);

        /* ----- the replay as a video file (for Discord) -----
           Drawn frame by frame as fast as the computer can (not in real time),
           encoded with WebCodecs (H.264 + AAC) into an mp4 by mp4-muxer
           (js/vendor/mp4-muxer.js, MIT). The sound is mixed offline: the
           music at the replay's speed and every hit sound at its time.
           opts: { width, height, fps, bitrate, onProgress(0..1), signal } → Blob */
        const yieldNow = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
        session.renderVideo = async function renderVideo(opts = {}) {
            const W = opts.width || 1280, H = opts.height || 720, FPS = opts.fps || 60;
            const rate = prep.rate || 1;
            const INTRO_S = 3; // the opening card, in real seconds, over the song's own lead-in
            const t0 = Math.max(0, first - 2000) - INTRO_S * 1000 * rate;
            const tPlayEnd = prep.lastTime + 1500 * rate;
            const RESULTS_S = 5; // the ranking screen at the end, in real seconds
            const playSecs = (tPlayEnd - t0) / rate / 1000;
            // opts.previewSecs: only the first seconds (to check the opening without recording a whole map)
            const total = opts.previewSecs ? Math.min(opts.previewSecs, playSecs + RESULTS_S) : playSecs + RESULTS_S;
            const nFrames = Math.ceil(total * FPS);
            const say = (p) => { if (opts.onProgress) opts.onProgress(Math.max(0, Math.min(1, p))); };
            if (!window.VideoEncoder || !window.AudioEncoder) throw new Error(L('這個瀏覽器不支援錄製影片，請用最新版的 Chrome 或 Edge'));
            if (!window.Mp4Muxer) {
                await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'js/vendor/mp4-muxer.js'; sc.onload = res; sc.onerror = () => rej(new Error('mp4-muxer')); document.head.appendChild(sc); });
            }
            const vCodec = 'avc1.64002A';
            const vCfg = { codec: vCodec, width: W, height: H, bitrate: opts.bitrate || (playSecs > 300 ? 2_000_000 : 3_500_000) /* long maps a little lighter */, framerate: FPS, latencyMode: 'quality' };
            if (!(await VideoEncoder.isConfigSupported(vCfg)).supported) throw new Error(L('這個瀏覽器不支援錄製影片，請用最新版的 Chrome 或 Edge'));
            const SR = 48000;
            const aCfg = { codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate: 160_000 };
            const aacOk = (await AudioEncoder.isConfigSupported(aCfg).catch(() => ({ supported: false }))).supported;

            // ---- sound: music + hit sounds, mixed offline ----
            say(0);
            const actx = new OfflineAudioContext(2, Math.ceil(total * SR), SR);
            const master = actx.createGain(); master.connect(actx.destination);
            try {
                const music = await actx.decodeAudioData(await (await fetch(audioUrl)).arrayBuffer());
                const src = actx.createBufferSource();
                // DT / HT keep the song's pitch, as in the game: the music is time-stretched
                // (js/replay/stretch.js) and played at its own rate. NC (512) is meant to sound
                // higher, so it keeps the plain faster playback.
                let stretched = false;
                if (rate !== 1 && !(replay.mods & 512) && window.replayStretch) {
                    const chans = Array.from({ length: music.numberOfChannels }, (_, i) => music.getChannelData(i));
                    const outCh = await window.replayStretch(chans, rate, music.sampleRate, yieldNow);
                    const buf = actx.createBuffer(outCh.length, outCh[0].length, music.sampleRate);
                    outCh.forEach((d, i) => buf.copyToChannel(d, i));
                    src.buffer = buf; src.playbackRate.value = 1; stretched = true;
                } else { src.buffer = music; src.playbackRate.value = rate; }
                const g = actx.createGain(); g.gain.value = Math.max(0.05, prefs.music) * 0.8;
                src.connect(g); g.connect(master);
                // the song starts where the video's time reaches 0 (before that: silence);
                // the offset is in the buffer's own seconds (a stretched buffer is 1/rate as long)
                src.start(Math.max(0, -t0 / 1000 / rate), Math.max(0, t0 / 1000) / (stretched ? rate : 1));
                // the music fades out under the ranking screen
                g.gain.setValueAtTime(g.gain.value, playSecs);
                g.gain.linearRampToValueAtTime(0, total);
            } catch { /* a silent video rather than none */ }
            if (window.replaySounds && sounds.length) {
                const skin = savedSkins[replay.mode];
                const bufs = new Map();
                for (const name of new Set(sounds.flatMap((x) => x.names))) {
                    const data = await window.replaySounds.sampleData(skin, name);
                    if (data) { try { bufs.set(name, await actx.decodeAudioData(data)); } catch { /* skip */ } }
                }
                const fx = actx.createGain(); fx.gain.value = Math.max(0.05, prefs.fx) * 0.8; fx.connect(master);
                for (const ev of sounds) {
                    if (ev.t < t0 || ev.t > tPlayEnd) continue;
                    const at = (ev.t - t0) / rate;
                    for (const n of ev.names) {
                        const b = bufs.get(n); if (!b) continue;
                        const sn = actx.createBufferSource(); sn.buffer = b;
                        const gv = actx.createGain(); gv.gain.value = Math.max(0, Math.min(1, ev.vol));
                        sn.connect(gv); gv.connect(fx); sn.start(at);
                    }
                }
            }
            const mixed = await actx.startRendering();
            say(0.03);

            // ---- the file ----
            const M4 = window.Mp4Muxer;
            const target = new M4.ArrayBufferTarget();
            const muxer = new M4.Muxer({
                target, fastStart: 'in-memory',
                video: { codec: 'avc', width: W, height: H, frameRate: FPS },
                audio: aacOk ? { codec: 'aac', numberOfChannels: 2, sampleRate: SR } : undefined,
            });
            let fail = null;
            const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { fail = e; } });
            venc.configure(vCfg);
            if (aacOk) {
                const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { fail = e; } });
                aenc.configure(aCfg);
                const L0 = mixed.getChannelData(0), R0 = mixed.getChannelData(1);
                const STEP = 4096;
                for (let i = 0; i < mixed.length; i += STEP) {
                    const n = Math.min(STEP, mixed.length - i);
                    const buf = new Float32Array(n * 2);
                    buf.set(L0.subarray(i, i + n), 0); buf.set(R0.subarray(i, i + n), n);
                    const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / SR) * 1e6), data: buf });
                    aenc.encode(ad); ad.close();
                }
                await aenc.flush();
            }

            // ---- pictures ----
            const cv = document.createElement('canvas');
            cv.width = W; cv.height = H;
            const c2 = cv.getContext('2d');
            const vview = { ...view, w: W, h: H, dpr: 1, bgDim: Math.max(0.85, Number(view.bgDim) || 0) };
            try { await introIcon.decode(); } catch { /* the drawn ring instead */ }
            // the flag needs the profile: wait a little for it, not forever
            await Promise.race([profileP, new Promise((r) => setTimeout(r, 4000))]);
            if (introFlag.src) { try { await introFlag.decode(); } catch { /* no flag */ } }
            if (session.cmp && !cmpFlagB.src) {
                try {
                    const r = await Promise.race([osuFetch(`u=${encodeURIComponent(session.cmp.replay.player)}&type=string&m=${replay.mode}`), new Promise((res) => setTimeout(() => res(null), 4000))]);
                    const u = Array.isArray(r) ? r[0] : null;
                    if (u && twemojiFlag(u.country)) { cmpFlagB.src = twemojiFlag(u.country); await cmpFlagB.decode(); }
                } catch { /* no flag */ }
            }
            const realCtx = ctx, realView = view;
            const mods = typeof decodeOsuMods === 'function' ? decodeOsuMods(replay.mods).filter((m) => m !== 'NM') : [];
            const head = `${map.metadata.Title || bm.title} [${map.metadata.Version || bm.version}]`;
            // the mod badges under the pp (the live player shows them as page elements,
            // which a recording doesn't see): the bot's hexagons, assets/discord-emoji/
            const modList = mods.filter((m) => !(m === 'DT' && mods.includes('NC')) && !(m === 'SD' && mods.includes('PF')));
            const modImgs = (await Promise.all(modList.map((m) => new Promise((res) => {
                const im = new Image();
                im.onload = () => res(im); im.onerror = () => res(null);
                im.src = `assets/discord-emoji/m_${m.toLowerCase()}.png`;
            })))).filter(Boolean);
            let st = lastStats;
            let thumb = null;
            try {
                for (let i = 0; i < nFrames; i++) {
                    if (opts.signal && opts.signal.aborted) throw new Error('aborted');
                    if (fail) throw fail;
                    const sec = i / FPS;
                    // the drawing helpers use the player's own ctx / view: point them at the video's
                    ctx = c2; view = vview;
                    c2.setTransform(1, 0, 0, 1, 0, 0);
                    if (sec < playSecs && session.cmp) {
                        // two players: a layout per mode (drawCompareVideo)
                        const t = t0 + sec * 1000 * rate;
                        drawCompareVideo(c2, vview, t);
                        const left = playSecs - sec;
                        if (left < 1) { c2.fillStyle = `rgba(0,0,0,${1 - left})`; c2.fillRect(0, 0, W, H); }
                        if (sec < INTRO_S) drawIntro(c2, vview, sec, INTRO_S);
                    } else if (sec >= playSecs && session.cmp) {
                        drawCompareRanking(Math.min(1, (sec - playSecs) / 0.6));
                        const inP = (sec - playSecs) / 0.6;
                        if (inP < 1) { c2.fillStyle = `rgba(0,0,0,${1 - inP})`; c2.fillRect(0, 0, W, H); }
                    } else if (sec < playSecs) {
                        const t = t0 + sec * 1000 * rate;
                        st = M.draw(c2, vview, prep, t);
                        drawFieldBorder(c2, vview);
                        drawBoard(c2, vview, t, st);
                        drawCombo(st, H, 'video');
                        drawSideCounts(st, 0, 0, W, H);
                        // top right: accuracy and pp; top left: the map, the player and mods
                        c2.save();
                        c2.shadowColor = 'rgba(0,0,0,0.8)'; c2.shadowBlur = 4; c2.fillStyle = '#fff';
                        c2.textAlign = 'right'; c2.textBaseline = 'top';
                        c2.font = `800 ${Math.round(H * 0.05)}px system-ui, sans-serif`;
                        c2.fillText(`${(st.acc * 100).toFixed(2)}%`, W - 14, 12);
                        const ppNow = ppAt(t);
                        c2.font = `700 ${Math.round(H * 0.032)}px system-ui, sans-serif`; c2.fillStyle = '#ffcf5a';
                        if (ppNow != null) c2.fillText(`${Math.round(ppNow).toLocaleString()}pp`, W - 14, 14 + H * 0.055);
                        if (modImgs.length) {
                            const ms = Math.round(H * 0.06), my = 18 + H * 0.055 + H * 0.04;
                            c2.shadowBlur = 0;
                            modImgs.forEach((im, k) => c2.drawImage(im, W - 14 - ms * (modImgs.length - k) - 4 * (modImgs.length - 1 - k), my, ms, ms));
                            c2.shadowBlur = 4;
                        }
                        c2.textAlign = 'left'; c2.fillStyle = '#fff';
                        c2.font = `800 ${Math.round(H * 0.028)}px system-ui, sans-serif`;
                        c2.fillText(head.length > 60 ? `${head.slice(0, 58)}…` : head, 14, 12);
                        c2.font = `700 ${Math.round(H * 0.024)}px system-ui, sans-serif`; c2.fillStyle = 'rgba(255,255,255,0.8)';
                        c2.fillText(`${replay.player}${mods.length ? `  +${mods.join('')}` : ''}`, 14, 14 + H * 0.034);
                        c2.restore();
                        // the play fades out over its last second
                        const left = playSecs - sec;
                        if (left < 1) { c2.fillStyle = `rgba(0,0,0,${1 - left})`; c2.fillRect(0, 0, W, H); }
                        if (sec < INTRO_S) drawIntro(c2, vview, sec, INTRO_S);
                    } else {
                        resultsData.pp = ppAt(prep.lastTime + 1);
                        if (vview.rankSkin) window.replayResults.drawResults(c2, vview, resultsData);
                        else { c2.fillStyle = '#000'; c2.fillRect(0, 0, W, H); }
                        const inP = (sec - playSecs) / 0.6;
                        if (inP < 1) { c2.fillStyle = `rgba(0,0,0,${1 - inP})`; c2.fillRect(0, 0, W, H); }
                    }
                    ctx = realCtx; view = realView;
                    // one frame of play (40% in, past the opening) as the link preview's picture
                    if (!thumb && sec >= INTRO_S + (playSecs - INTRO_S) * 0.4 && sec < playSecs) thumb = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.85));
                    const frame = new VideoFrame(cv, { timestamp: Math.round(sec * 1e6), duration: Math.round(1e6 / FPS) });
                    venc.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
                    frame.close();
                    // wait for the encoder by its own event, and let the page breathe through a
                    // message port: timers in a background tab are slowed to once a second or less
                    while (venc.encodeQueueSize > 6) await new Promise((r) => venc.addEventListener('dequeue', r, { once: true }));
                    if (i % 30 === 0) { say(0.03 + 0.95 * (i / nFrames)); await yieldNow(); }
                }
                await venc.flush();
            } finally { ctx = realCtx; view = realView; }
            if (fail) throw fail;
            muxer.finalize();
            say(1);
            const out = new Blob([target.buffer], { type: 'video/mp4' });
            out.thumb = thumb; // a JPEG of the play, for the Discord preview
            return out;
        };
        window.replayRenderVideo = (o) => session.renderVideo(o);
        // what the Discord message says about the video (worker/replay-video.js)
        window.replayCurrentMeta = () => ({
            title: map.metadata.Title || bm.title, version: map.metadata.Version || bm.version, player: replay.player,
            mods: typeof decodeOsuMods === 'function' ? decodeOsuMods(replay.mods).filter((m) => m !== 'NM').join('') : '',
            acc: accOf(record), skin: savedSkins[replay.mode] ? savedSkins[replay.mode].name : '',
            setId: Number(bm.beatmapset_id) || 0, // the cover on the video's link preview
            artist: map.metadata.Artist || bm.artist || '', stars: sr,
            playerB: session.cmp ? session.cmp.replay.player : '',
            accB: session.cmp ? M.acc(M.record(session.cmp.replay)) : null,
        });
        window.replayPause = () => { if (session.clock && session.clock.running()) session.clock.toggle(); };
    }

    function togglePlay() {
        if (!session || !session.audio) return;
        if (session.clock) { session.clock.toggle(); return; }
        const a = session.audio;
        if (a.paused) a.play().catch((e) => console.warn('play blocked', e));
        else a.pause();
    }
    function seekBy(ms) {
        if (!session || !session.audio) return;
        if (session.clock) { session.clock.seekTo(session.clock.now() + ms); return; }
        session.audio.currentTime = Math.max(0, session.audio.currentTime + ms / 1000);
    }
    window.toggleReplayPlay = togglePlay;

    // drop an .osr anywhere on the page
    document.addEventListener('dragover', (e) => {
        if (e.dataTransfer && [...(e.dataTransfer.items || [])].some((i) => i.kind === 'file')) e.preventDefault();
    });
    document.addEventListener('drop', (e) => {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f && /\.osr$/i.test(f.name) && !(root && !root.hidden)) { e.preventDefault(); loadReplayFile(f); }
    });
    // /?replay opens the replay page (the old link to the window keeps working)
    if (/[?&]replay\b/.test(location.search)) {
        const go = () => setTimeout(() => openReplayViewer(), 0);
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
        else go();
    }
})();
