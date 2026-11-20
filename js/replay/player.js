/* ===== Replay player: window, loading, playback =====
   openReplayViewer() shows a full-screen window; drop or pick an .osr
   (or drop one anywhere on the page). Loading:
     .osr -> beatmap by its MD5 (osu! API get_beatmaps h=, via our proxy)
          -> the set's .osz from osu.direct (it allows cross-site reads)
          -> unzip in the browser -> the .osu, audio and background
          -> prepare (judgements etc.) -> play.
   The audio element is the clock: its currentTime is song time, whatever
   the playback rate (DT/HT), so drawing just follows it.
   Prototype: osu!mania only; text in Chinese until the design is settled. */
(function () {
    const L = (zh) => zh; // placeholder until the strings go into js/i18n
    let root = null;
    let session = null; // { audio, raf, urls[], prep, map, replay, view }

    function el(tag, cls, html) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    }
    const esc = (s) => (typeof escHtml === 'function' ? escHtml(String(s)) : String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`));
    const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

    function ensureRoot() {
        if (root) return root;
        root = el('div', 'rp-overlay');
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-label', L('重播'));
        root.hidden = true;
        root.innerHTML = `
            <div class="rp-window">
                <header class="rp-head">
                    <div class="rp-title" id="rp-title">${L('重播播放器')} <span class="rp-beta">Beta · Mania</span></div>
                    <button type="button" class="rp-close" aria-label="${L('關閉')}" onclick="closeReplayViewer()">✕</button>
                </header>
                <div class="rp-body" id="rp-body"></div>
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
        if (e.key === ' ') { e.preventDefault(); togglePlay(); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-5000); }
        if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(5000); }
    }

    function showPicker(msg) {
        const body = document.getElementById('rp-body');
        body.innerHTML = `
            <label class="rp-drop" id="rp-drop">
                <input type="file" accept=".osr" hidden onchange="if(this.files[0])loadReplayFile(this.files[0])">
                <span class="rp-drop-icon">▶</span>
                <b>${L('把 .osr 重播檔拖到這裡，或點一下選擇檔案')}</b>
                <small>${L('目前支援 osu!mania。譜面和音樂會自動從 osu.direct 下載。')}</small>
                ${msg ? `<p class="rp-error">${esc(msg)}</p>` : ''}
            </label>`;
        const drop = document.getElementById('rp-drop');
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
        const body = document.getElementById('rp-body');
        body.innerHTML = `<ol class="rp-steps">${steps.map((s, i) => `<li class="${i < current ? 'is-done' : i === current ? 'is-now' : ''}">${esc(s)}${i === current && extra ? ` <small>${esc(extra)}</small>` : ''}</li>`).join('')}</ol>`;
    }

    function stop() {
        if (!session) return;
        cancelAnimationFrame(session.raf);
        if (session.audio) { session.audio.pause(); session.audio.src = ''; }
        (session.urls || []).forEach((u) => URL.revokeObjectURL(u));
        if (session.ro) session.ro.disconnect();
        session = null;
    }

    window.openReplayViewer = function openReplayViewer() {
        ensureRoot();
        stop();
        root.hidden = false;
        document.documentElement.classList.add('rp-open');
        showPicker();
    };

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
        ensureRoot();
        stop();
        root.hidden = false;
        document.documentElement.classList.add('rp-open');
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
            startPlayer({ replay, map, bm, prep, audioUrl, bg, urls });
        } catch (err) {
            console.error('replay load failed', err);
            showPicker(err && err.message ? err.message : String(err));
        }
    };

    function modsLabel(mods) {
        if (typeof decodeOsuMods === 'function') { const m = decodeOsuMods(mods); return m.length ? m.join('') : 'NM'; }
        return String(mods);
    }

    function startPlayer({ replay, map, bm, prep, audioUrl, bg, urls }) {
        const R = window.replayMania;
        const body = document.getElementById('rp-body');
        const accOf = (c) => { const n = c.MAX + c[300] + c[200] + c[100] + c[50] + c.MISS; return n ? (300 * (c.MAX + c[300]) + 200 * c[200] + 100 * c[100] + 50 * c[50]) / (300 * n) : 1; };
        const theirs = { MAX: replay.nGeki, 300: replay.n300, 200: replay.nKatu, 100: replay.n100, 50: replay.n50, MISS: replay.nMiss };
        const row = (j) => `<tr><th style="color:${R.JUDGE_COLOR[j]}">${j}</th><td>${prep.counts[j]}</td><td>${theirs[j]}</td></tr>`;
        document.getElementById('rp-title').innerHTML = `${esc(map.metadata.Artist || bm.artist)} - ${esc(map.metadata.Title || bm.title)} <span class="rp-diff">[${esc(map.metadata.Version || bm.version)}]</span>`;
        body.innerHTML = `
            <div class="rp-stage" id="rp-stage"><canvas id="rp-canvas"></canvas></div>
            <aside class="rp-side">
                <div class="rp-player"><b>${esc(replay.player)}</b>
                    <span>${esc(modsLabel(replay.mods))} · ${prep.keys}K · ${replay.playedAt && !isNaN(replay.playedAt) ? replay.playedAt.toLocaleDateString() : ''}</span></div>
                <div class="rp-live"><div><small>${L('連擊')}</small><b id="rp-combo">0</b></div><div><small>${L('準確率')}</small><b id="rp-acc">100.00%</b></div></div>
                <table class="rp-counts"><thead><tr><th></th><th>${L('本站判定')}</th><th>${L('重播紀錄')}</th></tr></thead>
                    <tbody>${R.JUDGE.map(row).join('')}</tbody>
                    <tfoot><tr><th>${L('準確率')}</th><td>${(accOf(prep.counts) * 100).toFixed(2)}%</td><td>${(accOf(theirs) * 100).toFixed(2)}%</td></tr>
                    <tr><th>${L('最大連擊')}</th><td>${prep.bestCombo}</td><td>${replay.maxCombo}</td></tr></tfoot></table>
                <p class="rp-note">${L('「本站判定」是播放器依按鍵時間自己算的，和遊戲可能有些微差距；「重播紀錄」是遊戲存的正式結果。')}</p>
                <label class="rp-opt">${L('捲動速度')}<input type="range" id="rp-speed" min="0.4" max="3" step="0.05" value="1.2"></label>
                <label class="rp-opt">${L('背景暗度')}<input type="range" id="rp-dim" min="0" max="1" step="0.05" value="0.8"></label>
            </aside>
            <div class="rp-controls">
                <button type="button" class="rp-play" id="rp-play" aria-label="${L('播放')}">▶</button>
                <span class="rp-time" id="rp-time">0:00</span>
                <input type="range" class="rp-seek" id="rp-seek" min="0" max="1000" step="1" value="0" aria-label="${L('進度')}">
                <span class="rp-time" id="rp-dur">0:00</span>
                <button type="button" class="rp-btn" onclick="openReplayViewer()">${L('換一個重播')}</button>
            </div>`;

        const audio = new Audio(audioUrl);
        audio.preload = 'auto';
        audio.playbackRate = prep.rate;
        audio.preservesPitch = !(replay.mods & R.MOD.NC);
        const canvas = document.getElementById('rp-canvas');
        const stage = document.getElementById('rp-stage');
        const ctx = canvas.getContext('2d');
        const view = { w: 0, h: 0, dpr: 1, speed: 1.2, bg, bgDim: 0.8 };
        session = { audio, urls, prep, map, replay, view, raf: 0 };

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

        const seek = document.getElementById('rp-seek');
        const playBtn = document.getElementById('rp-play');
        const timeEl = document.getElementById('rp-time');
        const durEl = document.getElementById('rp-dur');
        const comboEl = document.getElementById('rp-combo');
        const accEl = document.getElementById('rp-acc');
        const endMs = () => Math.max(prep.lastTime + 1500, (audio.duration || 0) * 1000);
        let seeking = false;
        seek.addEventListener('input', () => { seeking = true; audio.currentTime = (seek.value / 1000) * endMs() / 1000; });
        seek.addEventListener('change', () => { seeking = false; });
        playBtn.addEventListener('click', togglePlay);
        document.getElementById('rp-speed').addEventListener('input', (e) => { view.speed = Number(e.target.value); });
        document.getElementById('rp-dim').addEventListener('input', (e) => { view.bgDim = Number(e.target.value); });
        audio.addEventListener('play', () => { playBtn.textContent = '❚❚'; playBtn.setAttribute('aria-label', L('暫停')); });
        audio.addEventListener('pause', () => { playBtn.textContent = '▶'; playBtn.setAttribute('aria-label', L('播放')); });
        audio.addEventListener('loadedmetadata', () => { durEl.textContent = fmt(endMs()); });

        // start a little before the first note
        const first = prep.notes.length ? prep.notes[0].time : 0;
        audio.addEventListener('loadedmetadata', () => { audio.currentTime = Math.max(0, first - 1500) / 1000; }, { once: true });

        const tick = () => {
            const t = audio.currentTime * 1000;
            ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
            const s = R.drawMania(ctx, view, prep, t);
            comboEl.textContent = s.combo;
            accEl.textContent = `${(s.acc * 100).toFixed(2)}%`;
            timeEl.textContent = fmt(t);
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
