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
            record: (r) => ({ 300: r.n300, 100: r.n100, 50: r.n50, MISS: r.nMiss }),
            acc: (c) => { const n = c[300] + c[100] + c[50] + c.MISS; return n ? (300 * c[300] + 100 * c[100] + 50 * c[50]) / (300 * n) : 1; },
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
    const prefs = { size: 'm', volume: 0.6, muted: false, music: 1, fx: 0.7, cursorScale: 1, errorScale: 1, scroll: 24, dim: 0.75, judgeScale: 0.6, comboScale: 0.6 };
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

    window.openReplayViewer = function openReplayViewer() { open(); showPicker(); };
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
                out.push({ t: e.jt, n: out.length + 1, combo: best, n300: c[300], n100: c[100], n50: c[50], miss: c.MISS });
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
                body: JSON.stringify({ id: Number(beatmapId), mods: replay.mods >>> 0, mode: replay.mode, states: states.map(({ t: _t, ...rest }) => rest) }),
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
        const rankBase = M.rank ? M.rank(record, accOf(record)) : '';
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
                        <summary class="rp-btn" title="${L('Skin・判定')}">⚙<span class="rp-btn-text"> ${L('Skin・判定')}</span></summary>
                        <div class="rp-menu-panel">
                            <button type="button" class="rp-menu-close" aria-label="${L('關閉')}" onclick="this.closest('details').open = false">✕</button>
                            <div class="rp-opt">Skin <span class="rp-skin-name" id="rp-skin-name">${esc(savedSkins[replay.mode] ? savedSkins[replay.mode].name : L('預設'))}</span>
                                <span class="rp-skin-btns">
                                    <label class="rp-btn">${L('使用我的 skin（.osk / .zip）')}<input type="file" accept=".osk,.zip" hidden id="rp-skin-file"></label>
                                    <button type="button" class="rp-btn" id="rp-skin-reset">${L('恢復預設')}</button>
                                </span></div>
                            ${M.judgeSize ? `<label class="rp-opt">${L('判定大小')} <output id="rp-judge-val">${Math.round((prefs.judgeScale || 0.6) * 100)}%</output><input type="range" id="rp-judge-scale" min="0.2" max="1.5" step="0.05" value="${prefs.judgeScale || 0.6}"></label>` : ''}
                            <label class="rp-opt">${L('音樂音量')} <output id="rp-music-val">${Math.round(prefs.music * 100)}%</output><input type="range" id="rp-music" min="0" max="1" step="0.01" value="${prefs.music}"></label>
                            <label class="rp-opt">${L('音效音量')} <output id="rp-fx-val">${Math.round(prefs.fx * 100)}%</output><input type="range" id="rp-fx" min="0" max="1" step="0.01" value="${prefs.fx}"></label>
                            ${replay.mode === 0 ? `<label class="rp-opt">${L('游標大小')} <output id="rp-cursor-val">${Math.round(prefs.cursorScale * 100)}%</output><input type="range" id="rp-cursor" min="0.5" max="2" step="0.05" value="${prefs.cursorScale}"></label>` : ''}
                            ${M.ur ? `<label class="rp-opt">${L('誤差條大小')} <output id="rp-error-val">${Math.round(prefs.errorScale * 100)}%</output><input type="range" id="rp-error" min="0.5" max="2.5" step="0.05" value="${prefs.errorScale}"></label>` : ''}
                            <label class="rp-opt">${L('連擊大小')} <output id="rp-combo-val">${Math.round((prefs.comboScale || 0.6) * 100)}%</output><input type="range" id="rp-combo-scale" min="0.2" max="1.5" step="0.05" value="${prefs.comboScale || 0.6}"></label>
                            <table class="rp-counts"><thead><tr><th></th><th>${L('本站判定')}</th><th>${L('重播紀錄')}</th></tr></thead>
                                <tbody>${JUDGES.map((j) => `<tr><th style="color:${R.JUDGE_COLOR[j]}">${jl(j)}</th><td>${prep.counts[j]}</td><td>${record[j]}</td></tr>`).join('')}</tbody>
                                <tfoot><tr><th>${L('準確率')}</th><td>${(accOf(prep.counts) * 100).toFixed(2)}%</td><td>${(accOf(record) * 100).toFixed(2)}%</td></tr></tfoot></table>
                            <p class="rp-note">${L('「本站判定」是播放器依按鍵時間自己算的，和遊戲可能有些微差距；畫面上的即時數字也是用它算的。')}</p>
                        </div>
                    </details>
                    ${replay.mode === 3 ? `<button type="button" class="rp-btn" id="rp-compare-btn" title="${L('雙人比較')}">⚔<span class="rp-btn-text"> ${L('雙人比較')}</span></button>` : ''}
                    <button type="button" class="rp-btn" onclick="openReplayViewer()" title="${L('換一個重播')}" aria-label="${L('換一個重播')}">⏏<span class="rp-btn-text"> ${L('換一個重播')}</span></button>
                </div>
            </div>`;

        // the player's profile in this mode: avatar, country, total PP, ranks
        osuFetch(`u=${encodeURIComponent(replay.player)}&type=string&m=${replay.mode}`).then((r) => {
            const u = Array.isArray(r) ? r[0] : null;
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
        const ctx = canvas.getContext('2d');
        const view = { w: 0, h: 0, dpr: 1, scroll: Number(prefs.scroll) || 24, bg, bgDim: prefs.dim, skin: skinCfg, judgeScale: Number(prefs.judgeScale) || 0.6, comboScale: Number(prefs.comboScale) || 0.6, cursorScale: Number(prefs.cursorScale) || 1, errorScale: Number(prefs.errorScale) || 1 };
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
        let soundAt = null, soundIdx = 0, warmed = false;
        const playSounds = (t, running) => {
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
                if (t - s2.t < 120) session.mixer.play(s2.names, s2.vol);
            }
            soundAt = t;
        };
        if ($('rp-speed')) { $('rp-speed').addEventListener('input', (e) => setScroll(Number(e.target.value))); setScroll(view.scroll); }
        $('rp-dim').addEventListener('input', (e) => { view.bgDim = Number(e.target.value); prefs.dim = view.bgDim; savePrefs(); });
        $('rp-skin-file').addEventListener('change', async (e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            $('rp-skin-name').textContent = L('讀取中…');
            try {
                const skin = await window.replaySkin.loadSkin(f, f.name.replace(/\.(osk|zip)$/i, ''));
                view.skin = await M.skin(skin, prep);
                savedSkins[replay.mode] = skin;
                loadRankSkin(skin);
                if (session.mixer) { session.mixer.close(); session.mixer = window.replaySounds.createMixer(skin); session.mixer.setVolume(fxVol()); }
                await window.replaySkin.saveSkin(f, skin.name, replay.mode).catch(() => {});
                $('rp-skin-name').textContent = skin.name;
            } catch (err) {
                console.error('skin load failed', err);
                $('rp-skin-name').textContent = L('讀不到這個 skin');
            }
        });
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
        let comboShownAt = 0, comboShown = 0;
        function drawCombo(st) {
            const combo = st.combo || 0, best = st.best || 0;
            if (combo !== comboShown) { if (combo > comboShown) comboShownAt = performance.now(); comboShown = combo; }
            const h = view.h;
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
        const timingA = replay.mode === 3 ? timingTimeline(prep) : null;
        const rateOf = (mods) => (mods & 64 || mods & 512 ? 1.5 : mods & 256 ? 0.75 : 1);
        const CMP_ROWS = [
            ['acc', L('準確率'), 'hi'], ['ur', 'UR', 'lo'],
            ...JUDGES.map((j) => [j, jl(j), j === 'MAX' || j === '300' ? 'hi' : 'lo', R.JUDGE_COLOR[j]]),
            ['early', L('偏早'), ''], ['late', L('偏晚'), ''], ['mean', L('平均偏差'), 'abs'],
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
                session.cmp = { replay: rB, prep: prepB, ppAt: ppLookup(rB, prepB, bm.beatmap_id), timing: timingTimeline(prepB), ppA: ppAt };
                if (pick) pick.remove();
                renderCompareHud();
                body2.classList.add('rp-comparing');
                lastCmp = '';
            } catch (err) { say(err && err.message ? err.message : String(err)); }
        }
        function renderCompareHud() {
            const c = session.cmp;
            const old = $('rp-cmp'); if (old) old.remove();
            const flag = (r2, side) => `<span class="rp-cmp-who"><img class="rp-flag" id="rp-cmp-flag-${side}" alt="" hidden>${esc(r2.player)}</span>`;
            const wrap = document.createElement('div');
            wrap.className = 'rp-cmp';
            wrap.id = 'rp-cmp';
            wrap.innerHTML = `
                <div class="rp-cmp-top">
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
                    const line = `${n(Math.round(Number(u.pp_raw) || 0))}pp · #${n(u.pp_rank)}`;
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
                const rk = M.rank ? M.rank(rec, acc) : '';
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
            const modeName = ['osu', 'taiko', 'fruits', 'mania'][replay.mode];
            fetch(`/.netlify/functions/replay-scores?b=${encodeURIComponent(bm.beatmap_id)}&mode=${modeName}`)
                .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
                .then((data) => {
                    const list = pick.querySelector('.rp-cmp-list');
                    const rate = rateOf(replay.mods);
                    const bits = { DT: 64, NC: 512, HT: 256 };
                    const rows = (data.scores || []).map((s, i) => {
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
            const rb = M.rank ? M.rank(rec, acc) : '';
            const sv = (r2.mods & (8 | 1024)) && (rb === 'SS' || rb === 'S');
            let lb = String(r2.lifeBar || '').split(',').map((x) => { const [a, b] = x.split('|'); return { t: Number(a), hp: Number(b) }; }).filter((x) => Number.isFinite(x.t) && Number.isFinite(x.hp));
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
                    const half = view.w / 2;
                    const side = { ...view, w: half, maxField: half * 0.6 };
                    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, half, view.h); ctx.clip();
                    s = M.draw(ctx, side, prep, t);
                    ctx.restore();
                    ctx.save(); ctx.translate(half, 0); ctx.beginPath(); ctx.rect(0, 0, half, view.h); ctx.clip();
                    const sB = M.draw(ctx, side, session.cmp.prep, t);
                    ctx.restore();
                    updateCompareHud(s, sB, t);
                } else {
                    s = M.draw(ctx, view, prep, t);
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
    // /?replay opens the window (prototype entry point)
    if (/[?&]replay\b/.test(location.search)) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => openReplayViewer());
        else openReplayViewer();
    }
})();
