/* ===== 通關進度 (collection clear progress) =====
   For the signed-in player: how much of the collection, and of each
   category and mode, is passed, full-combo'd and S or better. Like
   completionist trackers, but per collection.

   Counted per beatmapset, on its hardest difficulty (the same target the
   已遊玩 button checks), with one get_scores lookup each. A big collection
   is thousands of sets, so the scan runs 4 at a time in the background,
   can be stopped, and resumes; results are kept in this browser
   (osu_clear_cache_v1). Collection cards show the cached grade badge.

   Keeping it current without rescanning: a score only changes when the
   player plays, so on sign-in (and when the window opens) the site reads
   their recent plays (last 24 h, 50 per mode) and top 100 per mode, 8
   requests in all, and updates the sets those maps belong to
   (syncClearRecent). New sets in the collection are scanned on their own;
   removed ones simply drop out of the counts. The full recheck is only a
   30-day safety net, and the window warns when more than a day passed
   since the last sync (plays in that gap may be missed). */

const CLEAR_CACHE_KEY = 'osu_clear_cache_v1';
const CLEAR_SYNC_KEY = 'osu_clear_synced_at';
const CLEAR_RECHECK_MS = { none: 30 * 864e5, played: 30 * 864e5 }; // safety net; recent-play sync does the rest
const CLEAR_S_PLUS = new Set(['S', 'SH', 'X', 'XH']);
const CLEAR_RANK_ORDER = ['F', 'D', 'C', 'B', 'A', 'S', 'SH', 'X', 'XH'];
let clearScan = null; // { stop: bool, done, total } while scanning
let clearSyncing = null; // the running syncClearRecent() promise

/* Update the cache from the player's recent plays and top 100 (per mode):
   a better grade or a new full combo on a collected set's hardest
   difficulty replaces what was stored. Throttled to once per 10 minutes. */
async function syncClearRecent(force = false) {
    const user = getLoggedInOsuUser();
    if (!user) return 0;
    if (clearSyncing) return clearSyncing;
    const last = Number(localStorage.getItem(CLEAR_SYNC_KEY)) || 0;
    if (!force && Date.now() - last < 10 * 60e3) return 0;
    clearSyncing = (async () => {
        const byMap = new Map(clearTargets().map((x) => [String(x.beatmapId), x.setId]));
        const cache = getClearCache();
        let changed = 0;
        const lists = await Promise.all([0, 1, 2, 3].flatMap((m) => [
            osuFetch(`recent=${encodeURIComponent(user.id)}&m=${m}&limit=50`).catch(() => null),
            osuFetch(`best=${encodeURIComponent(user.id)}&m=${m}&limit=100`).catch(() => null),
        ]));
        for (const list of lists) {
            for (const s of Array.isArray(list) ? list : []) {
                const setId = byMap.get(String(s.beatmap_id));
                if (!setId || !s.rank || s.rank === 'F') continue;
                const cur = cache[setId];
                const fc = String(s.perfect) === '1';
                if (!cur || !cur.r || CLEAR_RANK_ORDER.indexOf(s.rank) > CLEAR_RANK_ORDER.indexOf(cur.r)) {
                    cache[setId] = { r: s.rank, fc: fc || !!(cur && cur.fc), t: Date.now() };
                    changed++;
                } else if (fc && !cur.fc) {
                    cur.fc = true;
                    changed++;
                }
            }
        }
        if (changed) saveClearCache(cache);
        if (lists.some(Array.isArray)) localStorage.setItem(CLEAR_SYNC_KEY, String(Date.now()));
        applyCachedPlayStatus();
        return changed;
    })();
    try { return await clearSyncing; } finally { clearSyncing = null; }
}

// On sign-in / page load, quietly bring the stored grades up to date.
window.addEventListener('load', () => setTimeout(() => {
    if (getLoggedInOsuUser() && Object.keys(getClearCache()).length) syncClearRecent();
}, 4000));

function getClearCache() {
    try { return JSON.parse(localStorage.getItem(CLEAR_CACHE_KEY)) || {}; } catch { return {}; }
}
function saveClearCache(c) {
    try { localStorage.setItem(CLEAR_CACHE_KEY, JSON.stringify(c)); } catch { /* full: keep going */ }
}

/* Every collected set once, with the hardest difficulty and its mode index. */
function clearTargets() {
    const col = getOsuCollection();
    const seen = new Set();
    const out = [];
    OSU_MODES.forEach((m, mi) => {
        for (const set of col[m] || []) {
            if (seen.has(set.beatmapset_id)) continue;
            seen.add(set.beatmapset_id);
            const maps = set.beatmaps || [];
            if (!maps.length) continue;
            const hardest = maps.reduce((a, b) => ((b.difficulty_rating || 0) > (a.difficulty_rating || 0) ? b : a));
            out.push({ setId: set.beatmapset_id, beatmapId: hardest.beatmap_id, mode: mi });
        }
    });
    return out;
}

function clearIsFresh(entry) {
    if (!entry) return false;
    if (entry.r === 'X' || entry.r === 'XH') return true;
    return Date.now() - entry.t < (entry.r ? CLEAR_RECHECK_MS.played : CLEAR_RECHECK_MS.none);
}

/* The 已遊玩 badge on a card, from a cache entry. */
function setPlayBadge(el, entry) {
    if (!el || !entry) return;
    if (!entry.r) {
        el.className = 'osu-play-status unplayed';
        el.title = t('play_status_unplayed_title');
        el.textContent = '–';
    } else {
        el.className = `osu-play-status rank-${OSU_RANK_CLASS[entry.r] || 'f'}`;
        el.title = t(entry.fc ? 'play_status_fc_title' : 'play_status_played_title', { rank: entry.r });
        el.textContent = entry.r;
    }
    el.style.display = 'flex';
    el.closest('.osu-card')?.classList.add('has-play-status');
}

function applyCachedPlayStatus() {
    if (!getLoggedInOsuUser()) return;
    const cache = getClearCache();
    for (const { setId } of (typeof osuPageCheckTargets !== 'undefined' ? osuPageCheckTargets : [])) {
        if (cache[setId]) setPlayBadge(document.getElementById(`play-status-${setId}`), cache[setId]);
    }
}
// Cards get their cached badge on every collection render.
if (typeof renderOsuCollection === 'function') {
    const renderOsuCollectionBase = renderOsuCollection;
    // eslint-disable-next-line no-func-assign
    renderOsuCollection = function (...args) {
        const r = renderOsuCollectionBase.apply(this, args);
        applyCachedPlayStatus();
        return r;
    };
}

async function scanClearProgress(opts = {}) {
    const user = getLoggedInOsuUser();
    if (!user || clearScan) return;
    const cache = getClearCache();
    const todo = clearTargets().filter((x) => (opts.full ? true : opts.onlyNew ? !cache[x.setId] : !clearIsFresh(cache[x.setId])));
    if (!todo.length) { renderClearProgress(); return; }
    clearScan = { stop: false, done: 0, total: todo.length };
    renderClearProgress();
    let i = 0;
    let sinceSave = 0;
    const worker = async () => {
        while (!clearScan.stop && i < todo.length) {
            const x = todo[i++];
            try {
                const res = await osuFetch(`scoreBeatmap=${x.beatmapId}&scoreUser=${encodeURIComponent(user.id)}&m=${x.mode}`);
                const s = Array.isArray(res) ? res[0] : null;
                cache[x.setId] = s
                    ? { r: s.rank || 'F', fc: String(s.perfect) === '1', t: Date.now() }
                    : { r: '', fc: false, t: Date.now() };
                setPlayBadge(document.getElementById(`play-status-${x.setId}`), cache[x.setId]);
            } catch {
                await new Promise((r) => setTimeout(r, 1500)); // back off, try it next scan
            }
            clearScan.done++;
            if (++sinceSave >= 20) { saveClearCache(cache); sinceSave = 0; renderClearProgress(); }
        }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    saveClearCache(cache);
    try { localStorage.setItem('osu_clear_scanned_at', String(Date.now())); } catch { /* ignore */ }
    clearScan = null;
    renderClearProgress();
}

function stopClearScan() {
    if (clearScan) clearScan.stop = true;
}

/* passed / FC / S+ over a list of set ids, from the cache. */
function clearTally(setIds, cache) {
    const tally = { total: setIds.length, checked: 0, passed: 0, fc: 0, s: 0 };
    for (const id of setIds) {
        const e = cache[id];
        if (!e) continue;
        tally.checked++;
        if (e.r && e.r !== 'F') {
            tally.passed++;
            if (e.fc) tally.fc++;
            if (CLEAR_S_PLUS.has(e.r)) tally.s++;
        }
    }
    return tally;
}

function clearRowHtml(label, tally, strong) {
    const pct = (n) => (tally.total ? (n / tally.total) * 100 : 0);
    const cell = (n) => `<b>${n.toLocaleString()}</b><small>${tally.total ? Math.round(pct(n)) : 0}%</small>`;
    return `<div class="cp-row${strong ? ' is-total' : ''}">
        <span class="cp-name">${escHtml(label)}<small>${escHtml(t('cp_sets', { n: tally.total.toLocaleString() }))}</small></span>
        <span class="cp-bar" aria-hidden="true">
            <i class="is-passed" style="width:${pct(tally.passed).toFixed(1)}%"></i>
            <i class="is-s" style="width:${pct(tally.s).toFixed(1)}%"></i>
            <i class="is-fc" style="width:${pct(tally.fc).toFixed(1)}%"></i>
        </span>
        <span class="cp-num">${cell(tally.passed)}</span>
        <span class="cp-num">${cell(tally.s)}</span>
        <span class="cp-num">${cell(tally.fc)}</span>
    </div>`;
}

function renderClearProgress() {
    const body = document.getElementById('cp-body');
    if (!body) return;
    const user = getLoggedInOsuUser();
    if (!user) {
        body.innerHTML = `<p class="cp-note">${escHtml(t('cp_need_login'))}</p>
            <a class="btn" href="/.netlify/functions/osu-login">${escHtml(t('osu_login_btn'))}</a>`;
        return;
    }
    const cache = getClearCache();
    const targets = clearTargets();
    if (!targets.length) {
        body.innerHTML = `<p class="cp-note">${escHtml(t('stats_dashboard_empty'))}</p>`;
        return;
    }
    const allIds = targets.map((x) => x.setId);
    const all = clearTally(allIds, cache);
    const stale = targets.filter((x) => !clearIsFresh(cache[x.setId])).length;
    const col = getOsuCollection();
    const modeRows = OSU_MODES
        .map((m, mi) => [OSU_MODE_LABELS[mi] || m, [...new Set((col[m] || []).map((s) => s.beatmapset_id))]])
        .filter(([, ids]) => ids.length)
        .map(([label, ids]) => clearRowHtml(label, clearTally(ids, cache)));
    const catRows = getOsuCategories()
        .map((c) => [c.name, getCategoryMemberIds(c.id)])
        .filter(([, ids]) => ids.length)
        .map(([name, ids]) => clearRowHtml(name, clearTally(ids, cache)));
    const at = Number(localStorage.getItem('osu_clear_scanned_at')) || 0;
    const synced = Number(localStorage.getItem(CLEAR_SYNC_KEY)) || 0;
    const fmt = (ms) => new Date(ms).toLocaleString(siteLang === 'zh' ? 'zh-TW' : (siteLang || undefined), { dateStyle: 'medium', timeStyle: 'short' });
    const gap = all.checked && synced && Date.now() - synced > 864e5;
    const scanning = !!clearScan;
    const status = scanning
        ? t('cp_scanning', { n: clearScan.done.toLocaleString(), t: clearScan.total.toLocaleString() })
        : (stale ? t('cp_stale', { n: stale.toLocaleString() }) : t('cp_up_to_date'));

    body.innerHTML = `
        <div class="cp-controls">
            <span class="cp-status">${escHtml(status)}${at && !scanning ? ` · ${escHtml(t('cp_last', { d: fmt(at) }))}` : ''}${synced && !scanning ? `<br>${escHtml(t('cp_synced', { d: fmt(synced) }))}` : ''}</span>
            <span class="cp-buttons">${scanning
                ? `<button type="button" class="btn btn-ghost" onclick="stopClearScan()">${escHtml(t('cp_stop'))}</button>`
                : `${all.checked ? `<button type="button" class="btn btn-ghost" onclick="scanClearProgress({ full: true })" title="${escHtml(t('cp_full_title'))}">${escHtml(t('cp_full'))}</button>` : ''}
                   <button type="button" class="btn" onclick="scanClearProgress()" ${stale ? '' : 'disabled'}>${escHtml(t(all.checked ? 'cp_continue' : 'cp_scan'))}</button>`}</span>
        </div>
        ${gap && !scanning ? `<p class="cp-warn">${escHtml(t('cp_sync_gap'))}</p>` : ''}
        ${scanning ? `<div class="cp-scanbar"><i style="width:${clearScan.total ? (clearScan.done / clearScan.total) * 100 : 0}%"></i></div>` : ''}
        <div class="cp-table">
            <div class="cp-row cp-head"><span></span><span class="cp-legend"><i class="is-passed"></i>${escHtml(t('cp_passed'))}<i class="is-s"></i>${escHtml(t('cp_s'))}<i class="is-fc"></i>FC</span>
                <span class="cp-num">${escHtml(t('cp_passed'))}</span><span class="cp-num">${escHtml(t('cp_s'))}</span><span class="cp-num">FC</span></div>
            ${clearRowHtml(t('cp_total'), all, true)}
            ${modeRows.join('')}
            ${catRows.length ? `<p class="cp-group">${escHtml(t('cp_categories'))}</p>${catRows.join('')}` : ''}
        </div>
        <p class="cp-note">${escHtml(t('cp_basis', { n: all.checked.toLocaleString(), t: all.total.toLocaleString() }))}</p>`;
}

function openClearProgressModal() {
    let m = document.getElementById('cp-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'cp-modal';
        m.className = 'cp-modal';
        m.setAttribute('role', 'dialog');
        m.setAttribute('aria-modal', 'true');
        m.setAttribute('aria-labelledby', 'cp-title');
        m.innerHTML = `<div class="cp-scrim" onclick="closeClearProgressModal()"></div>
            <div class="cp-panel">
                <div class="cp-top"><h2 id="cp-title">${escHtml(t('col_clear'))}</h2>
                    <button type="button" class="cp-close" onclick="closeClearProgressModal()" aria-label="${escHtml(t('close_label'))}">${icon('x')}</button></div>
                <div id="cp-body"></div>
            </div>`;
        document.body.appendChild(m);
    }
    m.hidden = false;
    document.getElementById('cp-title').textContent = t('col_clear');
    renderClearProgress();
    m.querySelector('.cp-close').focus();
    // Bring it up to date: recent plays first, then any sets added since.
    if (getLoggedInOsuUser() && Object.keys(getClearCache()).length) {
        syncClearRecent().then(() => {
            renderClearProgress();
            const cache = getClearCache();
            if (clearTargets().some((x) => !cache[x.setId])) scanClearProgress({ onlyNew: true });
        });
    }
}

function closeClearProgressModal() {
    const m = document.getElementById('cp-modal');
    if (m) m.hidden = true;
}

document.addEventListener('keydown', (e) => {
    const m = document.getElementById('cp-modal');
    if (e.key === 'Escape' && m && !m.hidden) closeClearProgressModal();
});
