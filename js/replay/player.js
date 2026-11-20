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
   Prototype: osu!mania only; text in Chinese until the design is settled. */
(function () {
    const L = (zh) => zh; // placeholder until the strings go into js/i18n
    const JUDGES = ['MAX', '300', '200', '100', '50', 'MISS'];
    let root = null;
    let session = null; // { audio, raf, urls[], prep, map, replay, view, ro }
    let savedSkin; // undefined = not looked up yet, null = none

    /* the visitor's choices, kept in this browser */
    const PREFS_KEY = 'osu_replay_prefs_v1';
    const prefs = { size: 'm', volume: 0.6, muted: false, scroll: 24, dim: 0.75, judgeScale: 0.6, comboScale: 0.6 };
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
            if (session.setScroll) session.setScroll(session.view.scroll + (e.key === '-' || e.key === '_' ? -1 : 1));
            return;
        }
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
                <small>${L('目前支援 osu!mania。譜面和音樂會自動從 osu.direct 下載。')}</small>
                ${msg ? `<p class="rp-error">${esc(msg)}</p>` : ''}
            </label>`);
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
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

    window.loadReplayFile = async function loadReplayFile(file) {
        open();
        const steps = [L('讀取重播檔'), L('查詢譜面'), L('下載譜面和音樂'), L('解壓縮'), L('計算判定')];
        const F = window.replayFormats;
        try {
            showStatus(steps, 0);
            const replay = F.parseOsr(await file.arrayBuffer());
            if (replay.mode !== 3) throw new Error(L('這個重播不是 osu!mania（目前只支援 Mania）'));

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
            if (map.mode !== 3) throw new Error(L('這是轉換譜（由 Standard 轉成 Mania），目前還不支援'));
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
            const prep = window.replayMania.prepareMania(map, replay);
            window.__replayDebug = { prep, map, replay }; // prototype: for checking judgements
            if (savedSkin === undefined) savedSkin = await window.replaySkin.loadSavedSkin();
            const skinCfg = savedSkin ? await savedSkin.forKeys(prep.keys).catch(() => null) : null;
            startPlayer({ replay, map, bm, prep, audioUrl, bg, urls, skinCfg });
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
    const num1 = (v) => { const n = Number(v) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(1); };
    const accOf = (c) => { const n = JUDGES.reduce((s, j) => s + c[j], 0); return n ? (300 * (c.MAX + c[300]) + 200 * c[200] + 100 * c[100] + 50 * c[50]) / (300 * n) : 1; };

    function startPlayer({ replay, map, bm, prep, audioUrl, bg, urls, skinCfg }) {
        const R = window.replayMania;
        const record = { MAX: replay.nGeki, 300: replay.n300, 200: replay.nKatu, 100: replay.n100, 50: replay.n50, MISS: replay.nMiss };
        const sr = Number(bm.difficultyrating) || 0;
        const srColor = typeof starRatingColor === 'function' ? starRatingColor(sr) : '#f472b6';
        const played = replay.playedAt && !isNaN(replay.playedAt) ? replay.playedAt.toLocaleDateString() : '';
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
                    <dl class="rp-ic-stats">
                        <div><dt>Keys</dt><dd>${prep.keys}K</dd></div>
                        <div><dt>OD</dt><dd>${num1(map.od)}</dd></div>
                        <div><dt>HP</dt><dd>${num1(map.hp)}</dd></div>
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
                    <div class="rp-ic-counts">${JUDGES.map((j) => `<span><i style="color:${R.JUDGE_COLOR[j]}">${j}</i>${record[j]}</span>`).join('')}</div>
                </div>
            </div>
            <div class="rp-hud rp-hud-tl"><span class="rp-acc" id="rp-acc">100.00%</span></div>
            <div class="rp-hud rp-hud-tr">
                <dl class="rp-live-counts">${JUDGES.map((j) => `<dt style="color:${R.JUDGE_COLOR[j]}">${j}</dt><dd id="rp-c-${j}">0</dd>`).join('')}
                    <dt class="rp-ur">UR</dt><dd id="rp-ur">0</dd></dl>
            </div>
            <div class="rp-hud rp-hud-l">
                <div><small>L MISS</small><b id="rp-lmiss">0</b></div>
                <div><small>R MISS</small><b id="rp-rmiss">0</b></div>
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
                        <input type="range" id="rp-volume" min="0" max="1" step="0.02" value="${prefs.volume}" aria-label="${L('音量')}">
                    </span>
                    <label class="rp-ctl" title="${L('播放速度')}"><span class="rp-ctl-name">${L('速度')}</span>
                        <select id="rp-rate">${RATES.map((r) => `<option value="${r}"${r === 1 ? ' selected' : ''}>${r}×</option>`).join('')}</select>
                    </label>
                    <label class="rp-ctl rp-scroll" title="${L('捲動速度（Ctrl + ＋／－）')}"><span class="rp-ctl-name">${L('捲動')}</span><span class="rp-scroll-wrap"><output id="rp-scroll-val">${Number(prefs.scroll).toFixed(1)}</output><input type="range" id="rp-speed" min="1" max="40" step="0.1" value="${prefs.scroll}" aria-label="${L('捲動速度')}"></span></label>
                    <label class="rp-ctl" title="${L('背景暗度')}"><span class="rp-ctl-name">${L('背景')}</span><input type="range" id="rp-dim" min="0" max="1" step="0.05" value="${prefs.dim}" aria-label="${L('背景暗度')}"></label>
                    <label class="rp-ctl" title="${L('畫面大小')}"><span class="rp-ctl-name">${L('大小')}</span>
                        <select id="rp-size">${SIZES.map(([v, n]) => `<option value="${v}"${v === prefs.size ? ' selected' : ''}>${L(n)}</option>`).join('')}</select>
                    </label>
                    <button type="button" class="rp-icon" id="rp-fs" aria-label="${L('全螢幕')}" title="${L('全螢幕')}">⛶</button>
                    <span class="rp-spacer"></span>
                    <details class="rp-menu">
                        <summary class="rp-btn" title="${L('Skin・判定')}">⚙<span class="rp-btn-text"> ${L('Skin・判定')}</span></summary>
                        <div class="rp-menu-panel">
                            <div class="rp-opt">Skin <span class="rp-skin-name" id="rp-skin-name">${esc(savedSkin ? savedSkin.name : L('預設'))}</span>
                                <span class="rp-skin-btns">
                                    <label class="rp-btn">${L('使用我的 skin（.osk / .zip）')}<input type="file" accept=".osk,.zip" hidden id="rp-skin-file"></label>
                                    <button type="button" class="rp-btn" id="rp-skin-reset">${L('恢復預設')}</button>
                                </span></div>
                            <label class="rp-opt">${L('判定大小')} <output id="rp-judge-val">${Math.round((prefs.judgeScale || 0.6) * 100)}%</output><input type="range" id="rp-judge-scale" min="0.2" max="1.5" step="0.05" value="${prefs.judgeScale || 0.6}"></label>
                            <label class="rp-opt">${L('連擊大小')} <output id="rp-combo-val">${Math.round((prefs.comboScale || 0.6) * 100)}%</output><input type="range" id="rp-combo-scale" min="0.2" max="1.5" step="0.05" value="${prefs.comboScale || 0.6}"></label>
                            <table class="rp-counts"><thead><tr><th></th><th>${L('本站判定')}</th><th>${L('重播紀錄')}</th></tr></thead>
                                <tbody>${JUDGES.map((j) => `<tr><th style="color:${R.JUDGE_COLOR[j]}">${j}</th><td>${prep.counts[j]}</td><td>${record[j]}</td></tr>`).join('')}</tbody>
                                <tfoot><tr><th>${L('準確率')}</th><td>${(accOf(prep.counts) * 100).toFixed(2)}%</td><td>${(accOf(record) * 100).toFixed(2)}%</td></tr></tfoot></table>
                            <p class="rp-note">${L('「本站判定」是播放器依按鍵時間自己算的，和遊戲可能有些微差距；畫面上的即時數字也是用它算的。')}</p>
                        </div>
                    </details>
                    <button type="button" class="rp-btn" onclick="openReplayViewer()" title="${L('換一個重播')}" aria-label="${L('換一個重播')}">⏏<span class="rp-btn-text"> ${L('換一個重播')}</span></button>
                </div>
            </div>`;

        // the player's profile in this mode: avatar, country, total PP, ranks
        osuFetch(`u=${encodeURIComponent(replay.player)}&type=string&m=3`).then((r) => {
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
        audio.volume = prefs.volume;
        audio.muted = !!prefs.muted;
        let userRate = 1;
        const applyRate = () => { audio.playbackRate = prep.rate * userRate; };
        applyRate();
        audio.preservesPitch = !(replay.mods & R.MOD.NC);
        const canvas = $('rp-canvas');
        const stage = $('rp-stage');
        const ctx = canvas.getContext('2d');
        const view = { w: 0, h: 0, dpr: 1, scroll: Number(prefs.scroll) || 24, bg, bgDim: prefs.dim, skin: skinCfg, judgeScale: Number(prefs.judgeScale) || 0.6, comboScale: Number(prefs.comboScale) || 0.6 };
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
        const showMute = () => { muteBtn.textContent = audio.muted || audio.volume === 0 ? '🔇' : '🔊'; };
        showMute();
        muteBtn.addEventListener('click', () => { audio.muted = !audio.muted; prefs.muted = audio.muted; savePrefs(); showMute(); });
        $('rp-volume').addEventListener('input', (e) => {
            audio.volume = Number(e.target.value);
            if (audio.volume > 0 && audio.muted) audio.muted = false;
            prefs.volume = audio.volume; prefs.muted = audio.muted; savePrefs(); showMute();
        });
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
        const endMs = () => Math.max(prep.lastTime + 1500, (audio.duration || 0) * 1000);
        let seeking = false;
        seek.addEventListener('input', () => { seeking = true; audio.currentTime = (seek.value / 1000) * endMs() / 1000; showTip(seek.value / 1000); });
        // hover: the time under the pointer, in a bubble above it
        const tip = $('rp-seek-tip');
        function showTip(frac) {
            frac = Math.min(1, Math.max(0, frac));
            tip.textContent = fmt(frac * endMs());
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
        $('rp-speed').addEventListener('input', (e) => setScroll(Number(e.target.value)));
        setScroll(view.scroll);
        $('rp-dim').addEventListener('input', (e) => { view.bgDim = Number(e.target.value); prefs.dim = view.bgDim; savePrefs(); });
        $('rp-skin-file').addEventListener('change', async (e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            $('rp-skin-name').textContent = L('讀取中…');
            try {
                const skin = await window.replaySkin.loadSkin(f, f.name.replace(/\.(osk|zip)$/i, ''));
                view.skin = await skin.forKeys(prep.keys);
                savedSkin = skin;
                await window.replaySkin.saveSkin(f, skin.name).catch(() => {});
                $('rp-skin-name').textContent = skin.name;
            } catch (err) {
                console.error('skin load failed', err);
                $('rp-skin-name').textContent = L('讀不到這個 skin');
            }
        });
        for (const [id, key, out] of [['rp-judge-scale', 'judgeScale', 'rp-judge-val'], ['rp-combo-scale', 'comboScale', 'rp-combo-val']]) {
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
            await window.replaySkin.clearSkin();
            savedSkin = null;
            view.skin = null;
            $('rp-skin-name').textContent = L('預設');
        });
        audio.addEventListener('play', () => { playBtn.textContent = '❚❚'; playBtn.setAttribute('aria-label', L('暫停')); });
        audio.addEventListener('pause', () => { playBtn.textContent = '▶'; playBtn.setAttribute('aria-label', L('播放')); });
        audio.addEventListener('loadedmetadata', () => { durEl.textContent = fmt(endMs()); $('rp-seek-end').textContent = fmt(endMs()); });
        const first = prep.notes.length ? prep.notes[0].time : 0;
        audio.addEventListener('loadedmetadata', () => { audio.currentTime = Math.max(0, first - 1500) / 1000; }, { once: true });

        let lastShown = '';
        const tick = () => {
            const t = audio.currentTime * 1000;
            ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
            const s = R.drawMania(ctx, view, prep, t);
            const key = `${s.acc}|${s.ur}|${s.lMiss}|${s.rMiss}|${JUDGES.map((j) => s.counts[j]).join()}`;
            if (key !== lastShown) {
                lastShown = key;
                accEl.textContent = `${(s.acc * 100).toFixed(2)}%`;
                urEl.textContent = s.ur.toFixed(0);
                lEl.textContent = s.lMiss;
                rEl.textContent = s.rMiss;
                for (const j of JUDGES) countEls[j].textContent = s.counts[j];
            }
            timeEl.textContent = fmt(t);
            seekNow.textContent = timeEl.textContent;
            if (!seeking) seek.value = String(Math.round((t / endMs()) * 1000));
            session.raf = requestAnimationFrame(tick);
        };
        session.raf = requestAnimationFrame(tick);
    }

    function togglePlay() {
        if (!session || !session.audio) return;
        const a = session.audio;
        if (a.paused) a.play().catch((e) => console.warn('play blocked', e));
        else a.pause();
    }
    function seekBy(ms) {
        if (!session || !session.audio) return;
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
