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
        // a frame of the play for the link preview (no harm if it fails)
        if (blob.thumb) { try { await api(id, 'action=thumb', { method: 'PUT', body: blob.thumb }); } catch { /* the map's cover instead */ } }
        const meta = window.replayCurrentMeta ? window.replayCurrentMeta() : {};
        return api(id, 'action=complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parts, meta }) });
    }

    function ready(id) {
        if (window.replayPause) window.replayPause();
        const meta = window.replayCurrentMeta ? window.replayCurrentMeta() : {};
        const p = show(`
            <p class="rj-map"><b>${esc(meta.title || '')}</b> [${esc(meta.version || '')}] · ${esc(meta.player || '')}${meta.playerB ? ` 🆚 ${esc(meta.playerB)}` : ''}${meta.mods ? ` +${esc(meta.mods)}` : ''}</p>
            <div class="rj-skin"><span>${esc(L('使用的皮膚'))}：<b id="rj-skin-name">${esc(meta.skin || L('預設'))}</b></span>
                <span class="rj-skin-change">
                    <select class="rj-skin-pick" id="rj-skin-pick" aria-label="${esc(L('從「我的皮膚」選'))}" hidden></select>
                    <label class="rh-link rj-skin-btn">${esc(L('或上傳新的'))}<input type="file" accept=".osk,.zip" hidden></label>
                </span></div>
            <p class="rj-hint">${esc(L('影片是 720p 60fps，錄好後會自動貼到 Discord。'))}</p>
            <div class="rj-acts"><button type="button" class="rh-link" data-close>${esc(L('取消'))}</button><button type="button" class="rh-go rh-go-big" data-start>${esc(L('開始錄影'))}</button></div>`);
        // the skin: one from 我的皮膚 (js/skins.js), or a new file (it's kept there too)
        const nameEl = () => document.getElementById('rj-skin-name');
        const use = async (file, keep) => {
            if (!window.replayApplySkinFile) return;
            nameEl().textContent = L('讀取中…');
            const name = await window.replayApplySkinFile(file, keep);
            nameEl().textContent = name || L('讀不到這個皮膚');
            fillPick();
        };
        const fillPick = async () => {
            const sel = document.getElementById('rj-skin-pick');
            if (!sel || typeof getAllSkins !== 'function') return;
            const list = (await getAllSkins().catch(() => [])).sort((a, b) => b.addedAt - a.addedAt);
            sel.innerHTML = `<option value="">${esc(L('從「我的皮膚」選'))}</option>${list.map((k) => `<option value="${k.id}">${esc(String(k.name).replace(/\.(osk|zip)$/i, ''))}</option>`).join('')}`;
            sel.hidden = !list.length;
        };
        fillPick();
        p.querySelector('#rj-skin-pick').addEventListener('change', async (e) => {
            const pickId = Number(e.target.value);
            if (!pickId || typeof getAllSkins !== 'function') return;
            const rec = (await getAllSkins().catch(() => [])).find((k) => k.id === pickId);
            if (rec && rec.file) use(new File([rec.file], rec.name), false);
        });
        p.querySelector('input[type=file]').addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) use(file, true);
        });
        p.querySelector('[data-start]').addEventListener('click', () => record(id));
    }

    async function record(id) {
        if (window.replayPause) window.replayPause();
        try {
            show(bar(L('錄影中…'), 0));
            let last = 0, t0 = 0, q0 = 0;
            const blob = await window.replayRenderVideo({
                onProgress: (q) => {
                    const now = performance.now();
                    if (!(now - last > 200 || q >= 1)) return;
                    last = now;
                    if (q < 0.03) { show(bar(L('準備中…'), q)); return; }
                    // time left, from the pace so far (the frames, once the sound is mixed)
                    if (!t0) { t0 = now; q0 = q; }
                    const pace = (q - q0) / Math.max(1, now - t0);
                    const left = pace > 0 && now - t0 > 2000 ? (1 - q) / pace / 1000 : null;
                    const eta = left == null ? '' : left >= 90 ? L('約剩 {0} 分鐘').replace('{0}', Math.ceil(left / 60)) : L('約剩 {0} 秒').replace('{0}', Math.max(1, Math.round(left)));
                    show(bar(`${L('錄影中 {0}%').replace('{0}', Math.round(q * 100))}${eta ? ` · ${eta}` : ''}`, q));
                },
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
            // 🆚: the second score, played against the first
            if (job.scoreIdB) {
                const err = window.replayCompareWithScore ? await window.replayCompareWithScore(`https://osu.ppy.sh/scores/${job.mode ? `${job.mode}/` : ''}${job.scoreIdB}`) : L('取得重播失敗，稍後再試');
                if (err) throw new Error(err);
            }
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
