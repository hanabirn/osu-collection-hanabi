/* ===== Replay render via o!rdr (ordr.issou.best, open-source: github.com/MasterIO02/ordr-server) =====
   Visitors upload a .osr file, this submits it (through netlify/functions/ordr-render.js,
   since apis.issou.best has no CORS for direct browser calls) and polls
   ordr-status.js until a videoUrl comes back. Render history (renderID +
   video link) lives in localStorage only, same as everything else on this
   site — there's no backend to keep it server-side. */
const REPLAY_HISTORY_KEY = 'osu_replay_renders';
const REPLAY_DEFAULT_SKIN = 'whitecatCK1.0';
let ordrSkinSearchTimer = null;

function getReplayHistory() {
    try { return JSON.parse(localStorage.getItem(REPLAY_HISTORY_KEY)) || []; }
    catch { return []; }
}

function saveReplayHistory(list) {
    localStorage.setItem(REPLAY_HISTORY_KEY, JSON.stringify(list.slice(-20)));
}

function searchOrdrSkins(query) {
    clearTimeout(ordrSkinSearchTimer);
    const resultsEl = document.getElementById('replay-skin-results');
    if (!resultsEl) return;
    delete document.getElementById('replay-skin-input').dataset.skinId;
    if (!query || query.trim().length < 2) {
        resultsEl.style.display = 'none';
        resultsEl.innerHTML = '';
        return;
    }
    ordrSkinSearchTimer = setTimeout(async () => {
        try {
            const res = await fetch(`/.netlify/functions/ordr-skins?search=${encodeURIComponent(query.trim())}`);
            const data = await res.json();
            const skins = data.skins || [];
            if (!skins.length) {
                resultsEl.innerHTML = `<div class="replay-skin-empty">${t('replay_skin_none')}</div>`;
                resultsEl.style.display = 'block';
                return;
            }
            resultsEl.innerHTML = skins.map(s => `
                <div class="replay-skin-option" onclick='selectOrdrSkin(${JSON.stringify(s.skin)}, ${JSON.stringify(s.presentationName)})'>
                    <img src="${s.gridPreview}" alt="" loading="lazy">
                    <span>${escHtml(s.presentationName)}</span>
                </div>
            `).join('');
            resultsEl.style.display = 'block';
        } catch {
            resultsEl.style.display = 'none';
        }
    }, 350);
}

function selectOrdrSkin(skinId, presentationName) {
    const input = document.getElementById('replay-skin-input');
    input.value = presentationName;
    input.dataset.skinId = skinId;
    document.getElementById('replay-skin-results').style.display = 'none';
}

async function handleReplaySubmit(event) {
    event.preventDefault();
    const fileInput = document.getElementById('replay-file-input');
    const file = fileInput.files[0];
    const status = document.getElementById('replay-status');
    if (!file) return false;

    const skinInput = document.getElementById('replay-skin-input');
    const skin = skinInput.dataset.skinId || skinInput.value.trim() || REPLAY_DEFAULT_SKIN;
    const username = document.getElementById('replay-username-input').value.trim() || 'osu! player';
    const resolution = document.getElementById('replay-resolution-select').value;
    const submitBtn = event.target.querySelector('.replay-submit-btn');

    submitBtn.disabled = true;
    status.textContent = t('replay_submitting');
    status.style.color = '#f9a8d4';

    try {
        const form = new FormData();
        form.append('replayFile', file);
        form.append('username', username);
        form.append('resolution', resolution);
        form.append('skin', skin);

        const res = await fetch('/.netlify/functions/ordr-render', { method: 'POST', body: form });
        const data = await res.json();

        if (!res.ok || data.errorCode) {
            status.textContent = t('replay_submit_fail', { n: data.message || `error ${data.errorCode}` });
            status.style.color = '#ff5252';
            submitBtn.disabled = false;
            return false;
        }

        status.textContent = t('replay_rendering');
        const history = getReplayHistory();
        history.push({ renderID: data.renderID, title: file.name, addedAt: Date.now(), videoUrl: null, failed: false });
        saveReplayHistory(history);
        renderReplayHistory();
        pollOrdrRender(data.renderID);

        fileInput.value = '';
        submitBtn.disabled = false;
    } catch (e) {
        status.textContent = t('replay_submit_fail', { n: e.message });
        status.style.color = '#ff5252';
        submitBtn.disabled = false;
    }
    return false;
}

function pollOrdrRender(renderID) {
    const status = document.getElementById('replay-status');
    const check = async () => {
        try {
            const res = await fetch(`/.netlify/functions/ordr-status?renderID=${renderID}`);
            const data = await res.json();
            const render = (data.renders || [])[0];
            if (!render) { setTimeout(check, 6000); return; }

            if (render.errorCode && render.errorCode !== 0) {
                if (status) { status.textContent = t('replay_render_fail', { n: render.errorCode }); status.style.color = '#ff5252'; }
                updateReplayHistoryEntry(renderID, { failed: true });
                return;
            }
            if (render.progress === 'Done.' && render.videoUrl) {
                if (status) { status.textContent = t('replay_render_done'); status.style.color = '#34d399'; }
                updateReplayHistoryEntry(renderID, { videoUrl: render.videoUrl, title: render.title || undefined });
                return;
            }
            if (status) status.textContent = t('replay_progress', { n: render.progress || '...' });
            setTimeout(check, 4000);
        } catch {
            setTimeout(check, 6000);
        }
    };
    check();
}

function updateReplayHistoryEntry(renderID, patch) {
    const history = getReplayHistory();
    const idx = history.findIndex(r => r.renderID === renderID);
    if (idx === -1) return;
    history[idx] = { ...history[idx], ...patch };
    saveReplayHistory(history);
    renderReplayHistory();
}

function renderReplayHistory() {
    const el = document.getElementById('replay-history-list');
    if (!el) return;
    const history = getReplayHistory().slice().reverse();
    if (!history.length) {
        el.innerHTML = `<p class="skins-empty">${t('replay_history_empty')}</p>`;
        return;
    }
    el.innerHTML = history.map(r => `
        <div class="replay-history-item">
            <div class="replay-history-title">${escHtml(r.title || ('#' + r.renderID))}</div>
            ${r.videoUrl
                ? `<a class="btn replay-watch-btn" href="${r.videoUrl}" target="_blank" rel="noopener">${t('replay_watch')}</a>`
                : r.failed
                    ? `<span class="replay-history-status fail">${t('replay_render_fail_short')}</span>`
                    : `<span class="replay-history-status">${t('replay_history_pending')}</span>`}
        </div>
    `).join('');
}

document.addEventListener('DOMContentLoaded', () => {
    renderReplayHistory();
    getReplayHistory().forEach(r => { if (!r.videoUrl && !r.failed) pollOrdrRender(r.renderID); });
});
