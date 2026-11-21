/* ===== /?render=ID: recording a replay for Discord =====
   The bot's 🎬 button leads here (worker/replay-video.js keeps the job).
   The score's replay opens in the player; a panel over it shows the skin
   that will be used (with a way to change it) and starts the recording;
   the video is drawn in this browser (js/replay/player.js renderVideo),
   uploaded in parts, and the bot posts it in the channel. */
(function () {
    const L = (zh) => (window.replayText ? window.replayText(zh) : zh);
    const esc = (s) => (typeof escHtml === 'function' ? escHtml(String(s)) : String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`));
    const API = '/.netlify/functions/replay-render';
    const PART = 16 * 1024 * 1024; // R2 wants 5 MB or more for every part but the last

    let panel = null;
    function show(html) {
        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'rj-panel';
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-label', L('錄成影片'));
            document.body.appendChild(panel);
        }
        panel.innerHTML = `<div class="rj-card"><h2 class="rj-title">🎬 ${esc(L('錄成影片'))}</h2>${html}</div>`;
        return panel;
    }
    const bar = (label, p) => `<p class="rj-msg">${esc(label)}</p><div class="rj-bar"><i style="width:${(p * 100).toFixed(1)}%"></i></div><p class="rj-hint">${esc(L('錄影時請保持這個分頁開著'))}</p>`;
    const fail = (msg) => show(`<p class="rj-err">${esc(msg)}</p><div class="rj-acts"><button type="button" class="rh-go" data-close>${esc(L('關閉'))}</button></div>`);

    async function api(id, action, init) {
        const res = await fetch(`${API}?job=${encodeURIComponent(id)}${action ? `&${action}` : ''}`, init);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { const e = new Error(data.error || `HTTP ${res.status}`); e.status = res.status; e.data = data; throw e; }
        return data;
    }

    async function upload(id, blob, onProgress) {
        await api(id, 'action=start', { method: 'POST' });
        const parts = [];
        const n = Math.ceil(blob.size / PART);
        for (let i = 0; i < n; i++) {
            const chunk = blob.slice(i * PART, Math.min(blob.size, (i + 1) * PART));
            let tries = 0;
            for (;;) {
                try { parts.push(await api(id, `action=part&n=${i + 1}`, { method: 'PUT', body: chunk })); break; }
                catch (e) { if (++tries >= 3) throw e; await new Promise((r) => setTimeout(r, 1500 * tries)); }
            }
            onProgress((i + 1) / n);
        }
        const meta = window.replayCurrentMeta ? window.replayCurrentMeta() : {};
        return api(id, 'action=complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parts, meta }) });
    }

    function ready(id) {
        if (window.replayPause) window.replayPause();
        const meta = window.replayCurrentMeta ? window.replayCurrentMeta() : {};
        const p = show(`
            <p class="rj-map"><b>${esc(meta.title || '')}</b> [${esc(meta.version || '')}] · ${esc(meta.player || '')}${meta.mods ? ` +${esc(meta.mods)}` : ''}</p>
            <div class="rj-skin"><span>${esc(L('使用的 skin'))}：<b id="rj-skin-name">${esc(meta.skin || L('預設'))}</b></span>
                <label class="rh-link rj-skin-btn">${esc(L('換 skin'))}<input type="file" accept=".osk,.zip" hidden></label></div>
            <p class="rj-hint">${esc(L('影片是 720p 60fps，錄好後會自動貼到 Discord。'))}</p>
            <div class="rj-acts"><button type="button" class="rh-link" data-close>${esc(L('取消'))}</button><button type="button" class="rh-go rh-go-big" data-start>${esc(L('開始錄影'))}</button></div>`);
        p.querySelector('input[type=file]').addEventListener('change', async (e) => {
            const f = e.target.files && e.target.files[0];
            const real = document.getElementById('rp-skin-file');
            if (!f || !real) return;
            // hand the file to the player's own skin picker (it loads and saves it)
            const dt = new DataTransfer(); dt.items.add(f); real.files = dt.files;
            real.dispatchEvent(new Event('change'));
            document.getElementById('rj-skin-name').textContent = L('讀取中…');
            for (let i = 0; i < 60; i++) {
                await new Promise((r) => setTimeout(r, 250));
                const nm = document.getElementById('rp-skin-name');
                if (nm && nm.textContent !== L('讀取中…')) { document.getElementById('rj-skin-name').textContent = nm.textContent; break; }
            }
        });
        p.querySelector('[data-start]').addEventListener('click', () => record(id));
    }

    async function record(id) {
        if (window.replayPause) window.replayPause();
        try {
            show(bar(L('錄影中…'), 0));
            let last = 0;
            const blob = await window.replayRenderVideo({
                onProgress: (q) => { const now = performance.now(); if (now - last > 200 || q >= 1) { last = now; show(bar(q < 0.03 ? L('準備中…') : L('錄影中 {0}%').replace('{0}', Math.round(q * 100)), q)); } },
            });
            show(bar(L('上傳中 {0}%').replace('{0}', 0), 0));
            const out = await upload(id, blob, (q) => show(bar(L('上傳中 {0}%').replace('{0}', Math.round(q * 100)), q)));
            show(`<p class="rj-ok">${esc(out.posted ? L('影片已經貼到 Discord 了！') : L('影片錄好了，但沒辦法貼到 Discord（機器人可能不在那個伺服器），可以自己分享這個連結：'))}</p>
                <p class="rj-link"><a href="${esc(out.video)}" target="_blank" rel="noopener">${esc(out.video)}</a></p>
                <div class="rj-acts"><button type="button" class="rh-go" data-close>${esc(L('關閉'))}</button></div>`);
        } catch (e) {
            if (e && e.status === 409 && e.data && e.data.video) { done(e.data.video); return; }
            fail(e && e.message ? e.message : String(e));
        }
    }
    const done = (video) => show(`<p class="rj-ok">${esc(L('這支影片已經錄好了'))}</p><p class="rj-link"><a href="${esc(video)}" target="_blank" rel="noopener">${esc(video)}</a></p><div class="rj-acts"><button type="button" class="rh-go" data-close>${esc(L('關閉'))}</button></div>`);

    async function start(id) {
        show(bar(L('準備中…'), 0));
        let job;
        try { job = await api(id, ''); }
        catch (e) { fail(e.status === 404 ? L('這個錄影連結已經失效（24 小時內有效），請在 Discord 重新按一次') : L('osu! 暫時連不上，稍後再試')); return; }
        if (job.status === 'done' && job.video) { done(job.video); return; }
        try {
            await window.loadReplayFromScore(`https://osu.ppy.sh/scores/${job.mode ? `${job.mode}/` : ''}${job.scoreId}`);
            if (!window.replayCurrentMeta || !document.getElementById('rp-dur')) throw new Error(L('取得重播失敗，稍後再試'));
            ready(id);
        } catch (e) { fail(e && e.message ? e.message : String(e)); }
    }

    document.addEventListener('click', (e) => { if (panel && e.target.closest('.rj-panel [data-close]')) { panel.remove(); panel = null; } });
    window.replayRenderJob = start; // also callable by hand (testing)
    const m = /[?&]render=([a-f0-9]{32})\b/.exec(location.search);
    if (m) {
        const go = () => setTimeout(() => { if (typeof switchTab === 'function') switchTab('replay'); start(m[1]); }, 0);
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
        else go();
    }
})();
