/* ===== 重播: the replay page (nav 重播, #page-replay) =====
   Three ways in, as mania-tracker's replay page has them:
   - 找玩家: a country's top players, or any player by name; their best
     scores with the ones osu! keeps a replay for, ▶ to watch, ⚔ to compare
     with someone on the same map;
   - 雙人比較: two scores (links or .osr files) side by side;
   - 上傳檔案: an .osr from the visitor's computer.
   最近觀看 on the right keeps the last replays watched in this browser (the
   files themselves in IndexedDB, so any of them opens again offline).
   Lists come from netlify/functions/replay-hub.js. */
(function () {
    const L = (zh) => (window.replayText ? window.replayText(zh) : zh);
    const esc = (s) => (typeof escHtml === 'function' ? escHtml(String(s)) : String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`));
    const ENDPOINT = () => window.REPLAY_HUB_ENDPOINT || '/.netlify/functions/replay-hub';
    const MODES = [['osu', 'osu!'], ['taiko', 'taiko'], ['fruits', 'catch'], ['mania', 'mania']];
    const MODE_NUM = { osu: 0, taiko: 1, fruits: 2, mania: 3 };
    const PER_PAGE = 12;

    const state = { pane: 'player', mode: 'mania', country: '', page: 0, players: null, user: null, scores: null, onlyReplays: true, busy: '', error: '' };
    try { const m = localStorage.getItem('replay-hub-mode'); if (MODE_NUM[m] != null) state.mode = m; } catch { /* default */ }

    /* ----- 最近觀看: list in localStorage, files in IndexedDB ----- */
    const RECENT_KEY = 'replay-recent-v1';
    const RECENT_MAX = 12;
    const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } };
    const writeRecent = (list) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch { /* per-device nicety */ } };
    let dbP = null;
    const db = () => dbP || (dbP = new Promise((res, rej) => {
        const r = indexedDB.open('osu-replay-recent', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('files');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    }));
    const idb = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction('files', mode); const q = fn(tx.objectStore('files')); tx.oncomplete = () => res(q && q.result); tx.onerror = () => rej(tx.error); }); };

    // called by the player once a replay is loaded (js/replay/player.js)
    async function remember(file, replay, bm, acc) {
        const key = replay.replayMd5 || `${replay.beatmapMd5}:${replay.player}:${replay.score}`;
        const item = {
            key, mode: replay.mode, player: replay.player, acc, mods: replay.mods, score: replay.score,
            title: bm.title, artist: bm.artist, version: bm.version, setId: bm.beatmapset_id, at: Date.now(),
        };
        const list = [item, ...readRecent().filter((x) => x.key !== key)];
        writeRecent(list);
        try {
            const buf = await file.arrayBuffer();
            await idb('readwrite', (s) => { s.put(buf, key); for (const old of list.slice(RECENT_MAX)) s.delete(old.key); });
        } catch { /* the list still shows it; reopening asks for the file */ }
        renderRecent();
    }
    async function openRecent(key) {
        const item = readRecent().find((x) => x.key === key);
        let buf = null;
        try { buf = await idb('readonly', (s) => s.get(key)); } catch { buf = null; }
        if (!buf) { setError(L('這個重播的檔案已經不在這個瀏覽器裡了，請重新上傳')); return; }
        window.loadReplayFile(new File([buf], `${(item && item.title) || 'replay'}.osr`));
    }
    function clearRecent() {
        writeRecent([]);
        idb('readwrite', (s) => s.clear()).catch(() => {});
        renderRecent();
    }

    /* ----- data ----- */
    async function getJson(params) {
        const base = ENDPOINT();
        // a local preview can point at static files: …/rank-mania.json, …/user-mania-name.json
        const url = base.endsWith('/')
            ? `${base}${params.rankings ? `rank-${params.mode}` : `user-${params.mode}-${String(params.user).toLowerCase()}`}.json`
            : `${base}?${new URLSearchParams(params)}`;
        const res = await fetch(url);
        if (res.status === 404) throw new Error(L('找不到這個玩家'));
        if (!res.ok) throw new Error(L('osu! 暫時連不上，稍後再試'));
        return res.json();
    }
    async function loadPlayers() {
        state.players = null; state.busy = 'players'; state.error = ''; render();
        try { state.players = (await getJson(state.country ? { rankings: 1, mode: state.mode, country: state.country } : { rankings: 1, mode: state.mode })).players || []; }
        catch (e) { state.error = e.message; }
        state.busy = ''; render();
    }
    async function loadUser(name) {
        state.user = { name }; state.scores = null; state.busy = 'user'; state.error = ''; render();
        try {
            const d = await getJson({ user: name, mode: state.mode });
            state.user = d.user; state.scores = d.scores || [];
        } catch (e) { state.error = e.message; state.user = null; }
        state.busy = ''; render();
    }
    const setError = (msg) => { state.error = msg; render(); };

    // what the search box holds: a score (link, or a long id) or a player (name, link, short id)
    function readQuery(text) {
        const s = String(text || '').trim();
        if (!s) return null;
        if (/scores\//.test(s) || /^\d{9,}$/.test(s)) return { score: s };
        const u = s.match(/users\/(\d+)/) || s.match(/users\/([^/?#]+)/);
        return { user: u ? decodeURIComponent(u[1]) : s };
    }
    function submitSearch(text) {
        const q = readQuery(text);
        if (!q) return;
        if (q.score) window.loadReplayFromScore(q.score);
        else loadUser(q.user);
    }

    /* ----- 雙人比較: two scores, each a link or a file ----- */
    const cmp = { a: null, b: null }; // { file } or { text }
    async function asFile(side) {
        const v = cmp[side];
        if (v && v.file) return v.file;
        const text = document.getElementById(`rh-cmp-${side}`)?.value || '';
        if (!text.trim()) throw new Error(L('請兩邊都放一份成績'));
        return window.replayScoreFile(text);
    }
    async function startCompare() {
        const msg = document.getElementById('rh-cmp-msg');
        const say = (m) => { if (msg) { msg.textContent = m; msg.hidden = !m; } };
        try {
            say(L('讀取中…'));
            const [fa, fb] = await Promise.all([asFile('a'), asFile('b')]);
            say('');
            await window.loadReplayFile(fa);
            if (window.replayCompareWith) await window.replayCompareWith(fb);
        } catch (e) { say(e && e.message ? e.message : String(e)); }
    }

    /* ----- rendering ----- */
    const n = (v) => Number(v || 0).toLocaleString();
    const flag = (cc) => (cc ? `<img class="rh-flag" src="https://flagcdn.com/24x18/${esc(String(cc).toLowerCase())}.png" alt="${esc(cc)}" title="${esc(cc)}" loading="lazy">` : '');
    const modBadges = (mods) => (mods || []).filter((m) => m !== 'NM').map((m) => (typeof scModBadge === 'function' ? scModBadge(m) : `<b class="rh-mod">${esc(m)}</b>`)).join('');
    const modsFromBits = (bits) => (typeof decodeOsuMods === 'function' ? decodeOsuMods(bits).filter((m) => m !== 'NM' && !(m === 'DT' && decodeOsuMods(bits).includes('NC'))) : []);
    const ago = (t) => {
        const s = Math.max(0, (Date.now() - t) / 1000);
        if (s < 3600) return L('{0} 分鐘前').replace('{0}', Math.max(1, Math.round(s / 60)));
        if (s < 86400) return L('{0} 小時前').replace('{0}', Math.round(s / 3600));
        return L('{0} 天前').replace('{0}', Math.round(s / 86400));
    };

    function modeChips() {
        return `<div class="rh-modes" role="radiogroup" aria-label="${esc(L('模式'))}">${MODES.map(([k, lab]) =>
            `<button type="button" role="radio" aria-checked="${state.mode === k}" data-mode="${k}">${lab}</button>`).join('')}</div>`;
    }

    function playersHtml() {
        if (state.busy === 'players') return `<div class="rh-grid">${Array.from({ length: PER_PAGE }, () => '<div class="rh-pcard is-skel"></div>').join('')}</div>`;
        const list = state.players || [];
        if (!list.length) return `<p class="rh-empty">${esc(state.error || L('沒有資料'))}</p>`;
        const pages = Math.ceil(list.length / PER_PAGE);
        state.page = Math.min(state.page, pages - 1);
        const shown = list.slice(state.page * PER_PAGE, (state.page + 1) * PER_PAGE);
        return `
            <div class="rh-sub">
                <h3>${state.country ? `${flag(state.country)} ${esc(L('頂尖玩家'))}` : `<span aria-hidden="true">🌐</span> ${esc(L('全球頂尖玩家'))}`}</h3>
                <div class="rh-pager">
                    <button type="button" data-page="-1" aria-label="${esc(L('上一頁'))}" ${state.page ? '' : 'disabled'}>‹</button>
                    <span>${state.page + 1} / ${pages}</span>
                    <button type="button" data-page="1" aria-label="${esc(L('下一頁'))}" ${state.page < pages - 1 ? '' : 'disabled'}>›</button>
                </div>
            </div>
            <div class="rh-grid">${shown.map((p, i) => `
                <button type="button" class="rh-pcard" data-user="${esc(p.id)}" style="${p.cover ? `--cover:url('${esc(p.cover)}')` : ''}">
                    <img class="rh-av" src="${esc(p.avatar || `https://a.ppy.sh/${p.id}`)}" alt="" loading="lazy">
                    <span class="rh-pname"><b>${flag(p.country)} ${esc(p.name)}</b><small>#${n(p.rank || state.page * PER_PAGE + i + 1)} · ${n(Math.round(p.pp || 0))}pp</small></span>
                </button>`).join('')}
            </div>`;
    }

    function userHtml() {
        const u = state.user;
        const head = `
            <div class="rh-sub">
                <button type="button" class="rh-back" data-back>‹ ${esc(L('頂尖玩家'))}</button>
                ${u && u.id ? `<div class="rh-who"><img class="rh-av" src="${esc(u.avatar)}" alt=""><b>${esc(u.name)}</b>${flag(u.country)}<small>${u.rank ? `#${n(u.rank)} · ` : ''}${n(Math.round(u.pp || 0))}pp</small></div>` : `<b>${esc((u && u.name) || '')}</b>`}
                <label class="rh-only"><input type="checkbox" data-only ${state.onlyReplays ? 'checked' : ''}> ${esc(L('只顯示有重播的'))}</label>
            </div>`;
        if (state.busy === 'user') return head + `<div class="rh-scores">${Array.from({ length: 8 }, () => '<div class="rh-row is-skel"></div>').join('')}</div>`;
        const all = state.scores || [];
        const list = state.onlyReplays ? all.filter((s) => s.replay) : all;
        if (!list.length) return head + `<p class="rh-empty">${esc(all.length ? L('這位玩家的最佳成績都沒有線上重播') : L('這個模式還沒有最佳成績'))}</p>`;
        return head + `<ol class="rh-scores">${list.map((s) => `
            <li class="rh-row${s.replay ? '' : ' is-off'}">
                <img class="rh-thumb" src="https://assets.ppy.sh/beatmaps/${esc(s.set && s.set.id)}/covers/list@2x.jpg" alt="" loading="lazy">
                <span class="rh-map"><b>${esc(s.set ? s.set.title : '')}</b><small>${esc(s.beatmap ? s.beatmap.version : '')}${s.beatmap ? ` · ${Number(s.beatmap.stars || 0).toFixed(2)}★` : ''}</small></span>
                <span class="rh-mods">${modBadges(s.mods)}</span>
                <span class="rh-rank is-${esc(String(s.rank || '').toLowerCase())}">${esc(String(s.rank || '').replace('XH', 'SS').replace('X', 'SS').replace('SH', 'S'))}</span>
                <span class="rh-acc">${(Number(s.acc || 0) * 100).toFixed(2)}%</span>
                <span class="rh-pp">${n(Math.round(s.pp || 0))}pp</span>
                ${s.replay ? `<span class="rh-acts">
                    <button type="button" class="rh-act" data-play="${esc(s.id)}" title="${esc(L('播放'))}" aria-label="${esc(L('播放'))}">▶</button>
                    <button type="button" class="rh-act" data-vs="${esc(s.id)}" title="${esc(L('雙人比較'))}" aria-label="${esc(L('雙人比較'))}">⚔</button>
                </span>` : `<span class="rh-acts rh-noreplay">${esc(L('沒有重播'))}</span>`}
            </li>`).join('')}</ol>`;
    }

    function paneHtml() {
        if (state.pane === 'player') {
            return `
                <form class="rh-search" data-search>
                    <input type="search" id="rh-q" placeholder="${esc(L('搜尋玩家，或貼上成績網址'))}" aria-label="${esc(L('搜尋玩家，或貼上成績網址'))}" autocomplete="off">
                    <button type="submit" class="rh-go">${esc(L('搜尋'))}</button>
                </form>
                ${modeChips()}
                ${state.error && state.pane === 'player' && state.user === null && state.players ? `<p class="rh-err">${esc(state.error)}</p>` : ''}
                <div class="rh-list">${state.user ? userHtml() : playersHtml()}</div>`;
        }
        if (state.pane === 'compare') {
            const side = (k, label) => `
                <div class="rh-cmp-side is-${k}">
                    <h3>${esc(label)}</h3>
                    <input type="text" id="rh-cmp-${k}" placeholder="${esc(L('貼上 osu! 成績網址或成績 ID'))}" autocomplete="off">
                    <label class="rh-drop rh-drop-sm" data-cmp-file="${k}">
                        <input type="file" accept=".osr" hidden>
                        <span>${cmp[k] && cmp[k].file ? `✔ ${esc(cmp[k].file.name)}` : esc(L('或選擇 .osr 檔案'))}</span>
                    </label>
                </div>`;
            return `
                <p class="rh-hint">${esc(L('兩份成績要是同一張譜面、同樣的倍速'))}</p>
                <div class="rh-cmp">${side('a', L('左邊玩家'))}<div class="rh-vs">VS</div>${side('b', L('右邊玩家'))}</div>
                <p class="rh-err" id="rh-cmp-msg" hidden></p>
                <button type="button" class="rh-go rh-go-big" data-cmp-start>⚔ ${esc(L('開始比較'))}</button>`;
        }
        return `
            <label class="rh-drop" data-upload>
                <input type="file" accept=".osr" hidden>
                <span class="rh-drop-ic" aria-hidden="true">▶</span>
                <b>${esc(L('把 .osr 重播檔拖到這裡，或點一下選擇檔案'))}</b>
                <small>${esc(L('支援 osu! 全部四個模式。譜面和音樂會自動從 osu.direct 下載。'))}</small>
            </label>
            <form class="rh-search" data-score>
                <input type="text" placeholder="${esc(L('貼上 osu! 成績網址或成績 ID'))}" aria-label="${esc(L('貼上 osu! 成績網址或成績 ID'))}" autocomplete="off">
                <button type="submit" class="rh-go">${esc(L('載入'))}</button>
            </form>`;
    }

    function recentHtml() {
        const list = readRecent();
        return `
            <div class="rh-side-head"><h3>${esc(L('最近觀看'))}</h3>${list.length ? `<button type="button" class="rh-link" data-clear>${esc(L('清除'))}</button>` : ''}</div>
            ${list.length ? `<ol class="rh-recent">${list.map((r) => `
                <li><button type="button" class="rh-rcard" data-recent="${esc(r.key)}" style="--cover:url('https://assets.ppy.sh/beatmaps/${esc(r.setId)}/covers/card@2x.jpg')">
                    <span class="rh-rmain"><b>${esc(r.title)}</b><small>[${esc(r.version)}] · ${esc(r.player)}</small></span>
                    <span class="rh-rside"><b>${(Number(r.acc || 0) * 100).toFixed(2)}%</b><small>${esc(MODES.find(([k]) => MODE_NUM[k] === r.mode)?.[1] || '')} · ${esc(ago(r.at))}</small></span>
                </button></li>`).join('')}</ol>` : `<p class="rh-empty">${esc(L('看過的重播會出現在這裡'))}</p>`}`;
    }

    let root = null;
    function render() {
        root = document.getElementById('replay-hub');
        if (!root) return;
        const tabs = [['player', L('找玩家')], ['compare', L('雙人比較')], ['upload', L('上傳檔案')]];
        const q = root.querySelector('#rh-q');
        const keepQ = q ? q.value : '';
        root.innerHTML = `
            <div class="rh-head">
                <h2 class="rh-title"><span aria-hidden="true">▶</span> ${esc(L('重播播放器'))}</h2>
                <div class="rh-tabs" role="tablist">${tabs.map(([k, lab]) => `<button type="button" role="tab" aria-selected="${state.pane === k}" data-pane="${k}">${esc(lab)}</button>`).join('')}</div>
            </div>
            <div class="rh-body">
                <div class="rh-main">${paneHtml()}</div>
                <aside class="rh-side" id="rh-recent">${recentHtml()}</aside>
            </div>`;
        const q2 = root.querySelector('#rh-q');
        if (q2 && keepQ) q2.value = keepQ;
    }
    function renderRecent() { const el = document.getElementById('rh-recent'); if (el) el.innerHTML = recentHtml(); }

    function wire() {
        root = document.getElementById('replay-hub');
        if (!root || root.dataset.wired) return;
        root.dataset.wired = '1';
        root.addEventListener('click', (e) => {
            const t = e.target;
            const pick = (sel) => t.closest(sel);
            let b;
            if ((b = pick('[data-pane]'))) { state.pane = b.dataset.pane; state.error = ''; render(); return; }
            if ((b = pick('[data-mode]'))) {
                state.mode = b.dataset.mode; state.page = 0;
                try { localStorage.setItem('replay-hub-mode', state.mode); } catch { /* fine */ }
                if (state.user && state.user.id) loadUser(state.user.id); else loadPlayers();
                return;
            }
            if ((b = pick('[data-page]'))) { state.page += Number(b.dataset.page); render(); return; }
            if ((b = pick('[data-user]'))) { loadUser(b.dataset.user); return; }
            if (pick('[data-back]')) { state.user = null; state.scores = null; state.error = ''; render(); if (!state.players) loadPlayers(); return; }
            if ((b = pick('[data-play]'))) { window.loadReplayFromScore(`https://osu.ppy.sh/scores/${b.dataset.play}`); return; }
            if ((b = pick('[data-vs]'))) { window.loadReplayFromScore(`https://osu.ppy.sh/scores/${b.dataset.vs}`).then(() => { if (window.replayOpenComparePick) window.replayOpenComparePick(); }); return; }
            if ((b = pick('[data-recent]'))) { openRecent(b.dataset.recent); return; }
            if (pick('[data-clear]')) { clearRecent(); return; }
            if (pick('[data-cmp-start]')) { startCompare(); }
        });
        root.addEventListener('change', (e) => {
            const t = e.target;
            if (t.matches('[data-only]')) { state.onlyReplays = t.checked; render(); return; }
            if (t.matches('input[type=file]')) {
                const f = t.files && t.files[0];
                if (!f) return;
                const side = t.closest('[data-cmp-file]');
                if (side) { cmp[side.dataset.cmpFile] = { file: f }; render(); return; }
                if (t.closest('[data-upload]')) window.loadReplayFile(f);
            }
        });
        root.addEventListener('submit', (e) => {
            e.preventDefault();
            const f = e.target;
            const val = f.querySelector('input').value;
            if (f.matches('[data-search]')) submitSearch(val);
            else if (f.matches('[data-score]')) window.loadReplayFromScore(val);
        });
        // dropping an .osr on the upload box (the page-wide drop in player.js also works)
        root.addEventListener('dragover', (e) => { if (e.target.closest('.rh-drop')) { e.preventDefault(); e.target.closest('.rh-drop').classList.add('is-over'); } });
        root.addEventListener('dragleave', (e) => { const d = e.target.closest('.rh-drop'); if (d) d.classList.remove('is-over'); });
        root.addEventListener('drop', (e) => {
            const d = e.target.closest('.rh-drop');
            const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (!d || !f) return;
            e.preventDefault(); e.stopPropagation();
            d.classList.remove('is-over');
            if (d.dataset.cmpFile) { cmp[d.dataset.cmpFile] = { file: f }; render(); }
            else window.loadReplayFile(f);
        });
    }

    window.ensureReplayHub = function ensureReplayHub() {
        render();
        wire();
        if (!state.players && !state.user && state.busy !== 'players') loadPlayers();
    };
    window.refreshReplayHub = function refreshReplayHub() { if (document.getElementById('replay-hub')?.childElementCount) render(); };
    window.replayHub = { remember };
})();
