/* ===== 賽事圖池 · 社群賽事 sub-tab =====
   The crowd-sourced counterpart to the auto-crawled World Cup pools
   (js/mappools.js). Visitors pick a tournament + mode, add rounds and mod
   brackets, and drop beatmap ids in; community-mappools-edit.js resolves the
   metadata. One pool per tournament+mode (server dedups on a slug id), so
   whoever fills OWC 2025's std pool first, everyone else just opens it.

   Reuses js/mappools.js globals: renderMappoolCard, mappoolBracketHead,
   mappoolImport, mappoolModeApi. And osu.js: escHtml, icon, t,
   getOsuAuthToken, getLoggedInOsuUser, showShareToast, modeIconSvg,
   getOsuCollection, OSU_MODES. */

const CMPOOL_MODES = ['standard', 'taiko', 'catch', 'mania', 'all'];
const CMPOOL_MODE_LABEL = { standard: 'osu!std', taiko: 'taiko', catch: 'catch', mania: 'mania' };
function cmpoolModeLabel(m) { return m === 'all' ? t('cmpool_mode_all') : CMPOOL_MODE_LABEL[m]; }
const CMPOOL_PRESET_ROUNDS = ['Qualifiers', 'Round of 64', 'Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Finals', 'Grand Finals'];
const CMPOOL_PRESET_BRACKETS = {
    standard: ['NM', 'HD', 'HR', 'DT', 'FM', 'TB'],
    taiko: ['NM', 'HD', 'HR', 'DT', 'FM', 'TB'],
    catch: ['NM', 'HD', 'HR', 'DT', 'FM', 'TB'],
    mania: ['RC', 'LN', 'HB', 'TB'],
    all: ['NM', 'HD', 'HR', 'DT', 'FM', 'RC', 'LN', 'HB', 'TB'],
};

// Safe to drop into a double-quoted onclick="" as decodeURIComponent('…') —
// encodeURIComponent leaves ' alone, so also swap it (same trick as
// chat.js's chatEncodeForOnclick). Round/bracket labels can be user text.
function cmEnc(s) { return encodeURIComponent(String(s)).replace(/'/g, '%27'); }

const CMPOOL_SOURCES = ['wybin', 'forum', 'custom'];

let cmpoolIndexLoaded = false;
let cmpoolIndex = [];          // [{ id, tournamentName, mode, roundCount, mapCount, contributorCount, updatedAt, ... }]
let cmpoolCur = null;          // resolved pool currently open in #cmpool-detail
let cmpoolCreateMode = 'standard';
let cmpoolCreateSource = 'wybin';
let cmpoolWybinOptions = [];   // { name, slug, url, source:'wybin', gamemode }
let cmpoolForumOptions = [];   // { name, url, source:'forum' }
let cmpoolWybinLoading = false, cmpoolForumLoading = false;
let cmpoolPickedTourney = null; // the { name, slug, url, source } chosen from the <select>, if any
let cmpoolPage = 0;
const CMPOOL_PAGE_SIZE = 12;
const CMPOOL_SOURCE_TAG = { wybin: 'wyBin', forum: '論壇', custom: '自訂' };

// Called from switchTab('cmpool') — lazy-load the pool index once.
function ensureCmpoolLoaded() {
    if (!cmpoolIndexLoaded) loadCommunityPoolIndex();
}

async function loadCommunityPoolIndex(fresh) {
    cmpoolIndexLoaded = true;
    const listEl = document.getElementById('cmpool-list');
    if (listEl && !cmpoolCur) { listEl.classList.remove('cmpool-grid'); listEl.innerHTML = `<p class="osu-empty">${t('gallery_loading')}</p>`; }
    try {
        // `fresh` bypasses the CDN cache right after a write, so the list
        // reflects the change immediately instead of after max-age.
        const res = await fetch('/.netlify/functions/community-mappools-list' + (fresh ? `?_=${Date.now()}` : ''));
        if (!res.ok) throw new Error('bad response');
        cmpoolIndex = (await res.json()).pools || [];
    } catch (e) {
        console.error('Community mappool index failed:', e);
        if (listEl) listEl.innerHTML = `<p class="osu-empty">${t('mappools_load_fail')}</p>`;
        return;
    }
    renderCommunityPoolList();
}

function cmpoolModeIcon(mode) {
    return mode === 'all'
        ? icon('sparkles', { size: '0.95em' })
        : (typeof modeIconSvg === 'function' ? modeIconSvg(mode) : '');
}

function renderCommunityPoolList() {
    const listEl = document.getElementById('cmpool-list');
    const pagerEl = document.getElementById('cmpool-pagination');
    if (!listEl) return;
    if (pagerEl) pagerEl.innerHTML = '';

    const q = (document.getElementById('cmpool-search') || {}).value || '';
    const needle = q.trim().toLowerCase();
    const rows = cmpoolIndex.filter(p => !needle || (p.tournamentName || '').toLowerCase().includes(needle));

    if (!rows.length) {
        listEl.classList.remove('cmpool-grid');
        listEl.innerHTML = `<p class="osu-empty">${t(cmpoolIndex.length ? 'cmpool_no_match' : 'cmpool_empty')}</p>`;
        return;
    }
    listEl.classList.add('cmpool-grid');

    const totalPages = Math.ceil(rows.length / CMPOOL_PAGE_SIZE);
    if (cmpoolPage >= totalPages) cmpoolPage = 0;
    const pageRows = rows.slice(cmpoolPage * CMPOOL_PAGE_SIZE, (cmpoolPage + 1) * CMPOOL_PAGE_SIZE);

    listEl.innerHTML = pageRows.map(p => {
        const tag = CMPOOL_SOURCE_TAG[p.source] || p.source || '';
        return `<button class="cmpool-card" onclick="openCommunityPool('${escHtml(p.id)}')">
            <span class="cmpool-card-name">${cmpoolModeIcon(p.mode)}<span>${escHtml(p.tournamentName)}</span></span>
            <span class="cmpool-card-meta">
                <span class="cmpool-card-stat">${t('cmpool_card_rounds', { n: p.roundCount })}</span>
                <span class="cmpool-card-stat">${t('cmpool_card_maps', { n: p.mapCount.toLocaleString() })}</span>
                ${p.contributorCount ? `<span class="cmpool-card-stat">${icon('sparkles', { size: '0.8em' })}${p.contributorCount}</span>` : ''}
                ${tag ? `<span class="cmpool-card-source cmpool-src-${escHtml(p.source || 'custom')}">${escHtml(tag)}</span>` : ''}
            </span>
        </button>`;
    }).join('');

    if (pagerEl && totalPages > 1) {
        let h = `<button class="osu-page-btn" onclick="cmpoolGoPage(0)" ${cmpoolPage === 0 ? 'disabled' : ''}>«</button>`;
        h += `<button class="osu-page-btn" onclick="cmpoolGoPage(${cmpoolPage - 1})" ${cmpoolPage === 0 ? 'disabled' : ''}>‹</button>`;
        h += buildPaginationPageButtons(cmpoolPage, totalPages, (i) => `cmpoolGoPage(${i})`);
        h += `<button class="osu-page-btn" onclick="cmpoolGoPage(${cmpoolPage + 1})" ${cmpoolPage >= totalPages - 1 ? 'disabled' : ''}>›</button>`;
        h += `<button class="osu-page-btn" onclick="cmpoolGoPage(${totalPages - 1})" ${cmpoolPage >= totalPages - 1 ? 'disabled' : ''}>»</button>`;
        pagerEl.innerHTML = h;
    }
}

function cmpoolGoPage(i) {
    cmpoolPage = Math.max(0, i);
    renderCommunityPoolList();
    document.getElementById('cmpool-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── create / join ── */
const CMPOOL_WYBIN_GM = { standard: 0, taiko: 1, catch: 2, mania: 3, all: 4 };

function openCommunityPoolCreate() {
    const box = document.getElementById('cmpool-create');
    if (!box) return;
    box.hidden = false;
    cmpoolCreateMode = 'standard';
    cmpoolCreateSource = 'wybin';
    cmpoolPickedTourney = null;
    const nameEl = document.getElementById('cmpool-create-name');
    if (nameEl) nameEl.value = '';
    cmpoolCreateStatus('');
    // Render each piece independently — one failing shouldn't leave the
    // whole form half-built.
    try { renderCmpoolSourceTabs(); } catch (e) { console.error('cmpool source tabs:', e); }
    try { renderCmpoolCreateModeTabs(); } catch (e) { console.error('cmpool mode tabs:', e); }
    try { applyCmpoolSource(); } catch (e) { console.error('cmpool source apply:', e); }
    nameEl?.focus();
}
function closeCommunityPoolCreate() {
    const box = document.getElementById('cmpool-create');
    if (box) box.hidden = true;
}
function cmpoolCreateStatus(msg, err) {
    const el = document.getElementById('cmpool-create-status');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
    el.style.color = err ? '#ff7676' : 'var(--text-dim)';
}

function renderCmpoolSourceTabs() {
    const el = document.getElementById('cmpool-source-tabs');
    if (!el) return;
    el.innerHTML = CMPOOL_SOURCES.map(s =>
        `<button class="osu-mode-tab${s === cmpoolCreateSource ? ' active' : ''}" onclick="cmpoolSetSource('${s}')">${t('cmpool_source_' + s)}</button>`
    ).join('');
}
function cmpoolSetSource(s) {
    cmpoolCreateSource = s;
    cmpoolPickedTourney = null;
    renderCmpoolSourceTabs();
    applyCmpoolSource();
}
function renderCmpoolCreateModeTabs() {
    const el = document.getElementById('cmpool-create-mode');
    if (!el) return;
    el.innerHTML = CMPOOL_MODES.map(m => {
        const ico = m === 'all' ? icon('sparkles', { size: '0.9em' }) : (typeof modeIconSvg === 'function' ? modeIconSvg(m) : '');
        return `<button class="osu-mode-tab${m === cmpoolCreateMode ? ' active' : ''}" onclick="cmpoolSetCreateMode('${m}')">${ico} ${cmpoolModeLabel(m)}</button>`;
    }).join('');
}
function cmpoolSetCreateMode(m) {
    cmpoolCreateMode = m;
    renderCmpoolCreateModeTabs();
    if (cmpoolCreateSource === 'wybin') renderCmpoolTourneySelect(); // wybin list is mode-filtered
}

// Show/populate the dropdown for the chosen source; lazy-load its list.
function applyCmpoolSource() {
    const row = document.getElementById('cmpool-select-row');
    const sel = document.getElementById('cmpool-tourney-select');
    if (!row || !sel) return;
    if (cmpoolCreateSource === 'custom') {
        sel.hidden = true;
        renderCmpoolTourneySelect();
        return;
    }
    sel.hidden = false;
    const loaded = cmpoolCreateSource === 'wybin' ? cmpoolWybinOptions.length : cmpoolForumOptions.length;
    if (!loaded) {
        sel.innerHTML = `<option value="">${escHtml(t('gallery_loading'))}</option>`;
        const loader = cmpoolCreateSource === 'wybin' ? loadCmpoolWybinOptions : loadCmpoolForumOptions;
        loader().then(() => { if (!document.getElementById('cmpool-create').hidden) renderCmpoolTourneySelect(); });
    } else {
        renderCmpoolTourneySelect();
    }
}

async function loadCmpoolWybinOptions() {
    if (cmpoolWybinLoading) return;
    cmpoolWybinLoading = true;
    try {
        const res = await fetch('/.netlify/functions/wybin-tournaments');
        const data = res.ok ? await res.json() : [];
        const arr = Array.isArray(data) ? data : (data.tournaments || data.items || []);
        cmpoolWybinOptions = arr.map(x => ({
            name: x.name || x.title || '',
            slug: x.slug || '',
            url: x.slug ? `https://wybin.xyz/tournaments/${x.slug}` : '',
            source: 'wybin',
            gamemode: typeof x.gamemode === 'number' ? x.gamemode : null,
        })).filter(o => o.name).sort((a, b) => a.name.localeCompare(b.name));
    } catch { cmpoolWybinOptions = []; }
    cmpoolWybinLoading = false;
}
async function loadCmpoolForumOptions() {
    if (cmpoolForumLoading) return;
    cmpoolForumLoading = true;
    try {
        const res = await fetch('/.netlify/functions/osu-tournaments');
        const data = res.ok ? await res.json() : {};
        const topics = data.topics || (Array.isArray(data) ? data : []);
        cmpoolForumOptions = topics.map(x => ({
            name: (x.title || '').trim(),
            url: `https://osu.ppy.sh/community/forums/topics/${x.id}`,
            source: 'forum',
        })).filter(o => o.name).sort((a, b) => a.name.localeCompare(b.name));
    } catch { cmpoolForumOptions = []; }
    cmpoolForumLoading = false;
}

function renderCmpoolTourneySelect() {
    const sel = document.getElementById('cmpool-tourney-select');
    if (!sel) return;
    if (cmpoolCreateSource === 'custom') { sel.innerHTML = ''; sel._rows = []; return; }
    let rows;
    if (cmpoolCreateSource === 'wybin') {
        const want = CMPOOL_WYBIN_GM[cmpoolCreateMode];
        rows = cmpoolWybinOptions.filter(o => o.gamemode == null || o.gamemode === want || o.gamemode === 4);
    } else {
        rows = cmpoolForumOptions;
    }
    sel.innerHTML = `<option value="">${escHtml(t('cmpool_pick_from_list'))}</option>` +
        rows.slice(0, 800).map((o, i) => `<option value="${i}">${escHtml(o.name)}</option>`).join('');
    sel._rows = rows;
}
function onCmpoolTourneyPicked(sel) {
    const o = sel.value !== '' && sel._rows ? sel._rows[parseInt(sel.value, 10)] : null;
    cmpoolPickedTourney = o || null;
    const nameEl = document.getElementById('cmpool-create-name');
    if (nameEl && o) nameEl.value = o.name;
}
async function submitCommunityPoolCreate() {
    const name = (document.getElementById('cmpool-create-name') || {}).value.trim();
    if (!name) { showShareToast(t('cmpool_need_name')); return; }
    const token = getOsuAuthToken();
    if (!token) { showShareToast(t('chat_login_required')); return; }
    const pool = cmpoolCreateSource === 'wybin' ? cmpoolWybinOptions : cmpoolForumOptions;
    const match = (cmpoolPickedTourney && cmpoolPickedTourney.name.toLowerCase() === name.toLowerCase())
        ? cmpoolPickedTourney
        : pool.find(o => o.name.toLowerCase() === name.toLowerCase());
    const tournament = match
        ? { name: match.name, slug: match.slug || '', source: match.source, url: match.url || '' }
        : { name, source: cmpoolCreateSource === 'custom' ? 'custom' : cmpoolCreateSource };
    const goBtn = document.getElementById('cmpool-create-go');
    if (goBtn) goBtn.disabled = true;
    if (tournament.source === 'wybin') cmpoolCreateStatus(t('cmpool_importing'));
    try {
        const res = await fetch('/.netlify/functions/community-mappools-edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action: 'create', tournament, mode: cmpoolCreateMode }),
        });
        if (res.status === 401) { showShareToast(t('osu_login_fail')); cmpoolCreateStatus(''); return; }
        if (!res.ok) throw new Error('create failed');
        const data = await res.json();
        const pool = data.pool;
        if (data.imported > 0) showShareToast(t('cmpool_imported_n', { n: data.imported }));
        else if (tournament.source === 'wybin') showShareToast(t('cmpool_import_none'));
        closeCommunityPoolCreate();
        cmpoolIndexLoaded = false;
        await loadCommunityPoolIndex(true);
        openCommunityPool(pool.id, true);
    } catch (e) {
        console.error('Community pool create failed:', e);
        showShareToast(t('mappools_load_fail'));
        cmpoolCreateStatus('');
    } finally {
        if (goBtn) goBtn.disabled = false;
    }
}

/* ── open + render one pool ── */
async function openCommunityPool(id, fresh) {
    const detail = document.getElementById('cmpool-detail');
    const listEl = document.getElementById('cmpool-list');
    if (!detail) return;
    detail.hidden = false;
    // Only show the full-page spinner on a first open, not on the silent
    // re-fetch after an edit (that would flash the whole pool away).
    if (!fresh || !cmpoolCur || cmpoolCur.id !== id) detail.innerHTML = `<p class="osu-empty">${t('gallery_loading')}</p>`;
    if (listEl) listEl.hidden = true;
    document.getElementById('cmpool-bar').hidden = true;
    const pagerEl = document.getElementById('cmpool-pagination');
    if (pagerEl) pagerEl.hidden = true;
    try {
        // `fresh` bypasses the CDN cache so a just-made edit shows at once.
        const res = await fetch(`/.netlify/functions/community-mappools-list?id=${encodeURIComponent(id)}` + (fresh ? `&_=${Date.now()}` : ''));
        if (!res.ok) throw new Error('bad response');
        cmpoolCur = await res.json();
        renderCommunityPoolDetail();
    } catch (e) {
        console.error('Community pool load failed:', e);
        detail.innerHTML = `<p class="osu-empty">${t('mappools_load_fail')}</p>`;
    }
}

function closeCommunityPoolDetail() {
    cmpoolCur = null;
    const detail = document.getElementById('cmpool-detail');
    const listEl = document.getElementById('cmpool-list');
    if (detail) { detail.hidden = true; detail.innerHTML = ''; }
    if (listEl) listEl.hidden = false;
    document.getElementById('cmpool-bar').hidden = false;
    const pagerEl = document.getElementById('cmpool-pagination');
    if (pagerEl) pagerEl.hidden = false;
    // Edits inside the detail view mark the list stale — refresh it now so
    // the counts / new pool are right when we land back on it.
    if (!cmpoolIndexLoaded) loadCommunityPoolIndex(true);
    else renderCommunityPoolList();
}

function cmpoolCanEdit() {
    return !!(typeof getLoggedInOsuUser === 'function' && getLoggedInOsuUser());
}
function cmpoolIsOwner() {
    const u = typeof getLoggedInOsuUser === 'function' && getLoggedInOsuUser();
    return !!(u && String(u.id) === (typeof CHAT_OWNER_OSU_ID_HINT !== 'undefined' ? CHAT_OWNER_OSU_ID_HINT : '26696007'));
}

function renderCommunityPoolDetail() {
    const detail = document.getElementById('cmpool-detail');
    if (!detail || !cmpoolCur) return;
    const p = cmpoolCur;
    const editable = cmpoolCanEdit();
    const owner = cmpoolIsOwner();
    const me = (typeof getLoggedInOsuUser === 'function' && getLoggedInOsuUser()) || {};
    const collected = new Set(OSU_MODES.flatMap(m => (getOsuCollection()[m] || []).map(s => s.beatmapset_id)));
    const ico = p.mode === 'all' ? icon('sparkles', { size: '0.9em' }) : (typeof modeIconSvg === 'function' ? modeIconSvg(p.mode) : '');
    let mapCount = 0;
    for (const r of p.rounds) for (const b of r.brackets) mapCount += b.maps.length;

    const roundsHtml = p.rounds.map((r, ri) => {
        const bracketsHtml = r.brackets.map(b => {
            const pid = cmEnc(p.id), rid = cmEnc(r.id), lbl = cmEnc(b.label);
            const cards = b.maps.map(mp => {
                const base = renderMappoolCard(mp, mp.setId ? collected.has(mp.setId) : false);
                if (!editable) return base;
                const canRemove = owner || String(mp.addedBy) === String(me.id);
                const rm = canRemove
                    ? `<button class="cmpool-map-rm" title="${t('cmpool_remove_map')}" onclick="cmpoolEdit('remove-map',{poolId:decodeURIComponent('${pid}'),roundId:decodeURIComponent('${rid}'),label:decodeURIComponent('${lbl}'),beatmapId:${mp.beatmapId}},event)">${icon('x')}</button>`
                    : '';
                return `<div class="cmpool-map-wrap">${base}${rm}</div>`;
            }).join('');
            const addInput = editable && b.maps.length < 20
                ? `<div class="cmpool-add-map">
                     <input type="text" placeholder="${t('cmpool_add_map_ph')}" onkeydown="if(event.key==='Enter'){cmpoolAddMapFromInput(this,decodeURIComponent('${pid}'),decodeURIComponent('${rid}'),decodeURIComponent('${lbl}'))}">
                     <button onclick="cmpoolAddMapFromInput(this.previousElementSibling,decodeURIComponent('${pid}'),decodeURIComponent('${rid}'),decodeURIComponent('${lbl}'))">${icon('plus')}</button>
                   </div>`
                : '';
            const rmBracket = editable && (owner || !b.maps.length)
                ? `<button class="cmpool-bracket-rm" title="${t('cmpool_remove_bracket')}" onclick="cmpoolEdit('remove-bracket',{poolId:decodeURIComponent('${pid}'),roundId:decodeURIComponent('${rid}'),label:decodeURIComponent('${lbl}')})">${icon('x')}</button>`
                : '';
            return `<div class="cmpool-bracket">
                <div class="cmpool-bracket-head">${mappoolBracketHead(b.label)}${rmBracket}</div>
                <div class="osu-collection mappool-list">${cards}</div>
                ${addInput}
            </div>`;
        }).join('');
        const addBracket = editable ? cmpoolAddBracketBar(p, r) : '';
        const rmRound = editable && (owner || !r.brackets.some(b => b.maps.length))
            ? `<button class="cmpool-round-rm" title="${t('cmpool_remove_round')}" onclick="cmpoolEdit('remove-round',{poolId:decodeURIComponent('${cmEnc(p.id)}'),roundId:decodeURIComponent('${cmEnc(r.id)}')})">${icon('x')}</button>`
            : '';
        return `<div class="mappool-round">
            <div class="mappool-round-head">
                <h3>${escHtml(r.name)}</h3>
                ${rmRound}
                <button class="mappool-round-add" onclick="cmpoolImportRound(${ri})">${t('mappools_round_add_btn')}</button>
            </div>
            ${bracketsHtml}
            ${addBracket}
        </div>`;
    }).join('');

    detail.innerHTML = `
        <button class="cmpool-back" onclick="closeCommunityPoolDetail()">${icon('arrowLeft')} ${t('cmpool_back')}</button>
        <div class="cmpool-detail-head">
            <div class="cmpool-detail-title">${ico}<span>${escHtml(p.tournament.name)}</span></div>
            <span class="cmpool-detail-stats">${t('mappools_stats', { r: p.rounds.length, n: mapCount.toLocaleString() })} · ${t('cmpool_contributors', { n: (p.contributors || []).length })}</span>
        </div>
        <div class="cmpool-detail-actions">
            ${p.tournament.url ? `<a class="cmpool-tourney-link" href="${escHtml(p.tournament.url)}" target="_blank" rel="noopener">${icon('externalLink', { size: '0.95em' })} ${t('cmpool_open_tournament')}</a>` : ''}
            ${mapCount ? `<button class="mappool-round-add" onclick="cmpoolImportEvent()">${t('mappools_add_event_btn')}</button>` : ''}
            ${owner ? `<button class="cmpool-delete" onclick="cmpoolDeletePool('${escHtml(p.id)}')">${icon('trash2', { size: '0.95em' })} ${t('cmpool_delete_pool')}</button>` : ''}
        </div>
        ${editable ? cmpoolAddRoundBar(p) : (p.rounds.length ? '' : `<p class="osu-empty">${t('cmpool_login_to_fill')}</p>`)}
        ${roundsHtml}`;
}

function cmpoolAddRoundBar(p) {
    const pid = cmEnc(p.id);
    const chips = CMPOOL_PRESET_ROUNDS
        .filter(n => !p.rounds.some(r => r.name.toLowerCase() === n.toLowerCase()))
        .map(n => `<button class="cmpool-chip" onclick="cmpoolEdit('add-round',{poolId:decodeURIComponent('${pid}'),name:decodeURIComponent('${cmEnc(n)}')})">${escHtml(n)}</button>`).join('');
    return `<div class="cmpool-add-round">
        <span class="cmpool-add-label">${t('cmpool_add_round')}</span>
        ${chips}
        <input type="text" placeholder="${t('cmpool_custom_round_ph')}" onkeydown="if(event.key==='Enter'&&this.value.trim()){cmpoolEdit('add-round',{poolId:decodeURIComponent('${pid}'),name:this.value.trim()})}">
    </div>`;
}
function cmpoolAddBracketBar(p, r) {
    const pid = cmEnc(p.id), rid = cmEnc(r.id);
    const have = new Set(r.brackets.map(b => b.label.toLowerCase()));
    const chips = (CMPOOL_PRESET_BRACKETS[p.mode] || [])
        .filter(l => !have.has(l.toLowerCase()))
        .map(l => `<button class="cmpool-chip" onclick="cmpoolEdit('add-bracket',{poolId:decodeURIComponent('${pid}'),roundId:decodeURIComponent('${rid}'),label:decodeURIComponent('${cmEnc(l)}')})">${escHtml(l)}</button>`).join('');
    return `<div class="cmpool-add-bracket">
        <span class="cmpool-add-label">${t('cmpool_add_bracket')}</span>
        ${chips}
        <input type="text" maxlength="24" placeholder="${t('cmpool_custom_bracket_ph')}" onkeydown="if(event.key==='Enter'&&this.value.trim()){cmpoolEdit('add-bracket',{poolId:decodeURIComponent('${pid}'),roundId:decodeURIComponent('${rid}'),label:this.value.trim()})}">
    </div>`;
}

async function cmpoolAddMapFromInput(inputEl, poolId, roundId, label) {
    const ref = (inputEl.value || '').trim();
    if (!ref) return;
    inputEl.disabled = true;
    const okDone = await cmpoolEdit('add-map', { poolId, roundId, label, ref });
    if (okDone) inputEl.value = '';
    inputEl.disabled = false;
    inputEl.focus();
}

async function cmpoolEdit(action, params, event) {
    if (event) event.stopPropagation();
    const token = getOsuAuthToken();
    if (!token) { showShareToast(t('chat_login_required')); return false; }
    try {
        const res = await fetch('/.netlify/functions/community-mappools-edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action, ...params }),
        });
        if (res.status === 401) { showShareToast(t('osu_login_fail')); return false; }
        if (res.status === 429) { showShareToast(t('chat_rate_limited')); return false; }
        if (!res.ok) {
            let msg = t('mappools_load_fail');
            try { msg = (await res.json()).error || msg; } catch { /* keep default */ }
            showShareToast(msg);
            return false;
        }
        // Re-fetch the resolved view, cache-busted so the change shows now
        // (edit fn returns the raw, unresolved pool).
        await openCommunityPool(params.poolId || (cmpoolCur && cmpoolCur.id), true);
        cmpoolIndexLoaded = false; // list counts changed
        return true;
    } catch (e) {
        console.error(`Community pool ${action} failed:`, e);
        showShareToast(t('mappools_load_fail'));
        return false;
    }
}

async function cmpoolDeletePool(id) {
    if (!confirm(t('cmpool_delete_confirm'))) return;
    const token = getOsuAuthToken();
    if (!token) return;
    try {
        const res = await fetch('/.netlify/functions/community-mappools-edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action: 'delete-pool', poolId: id }),
        });
        if (!res.ok) throw new Error('delete failed');
        closeCommunityPoolDetail();
        cmpoolIndexLoaded = false;
        loadCommunityPoolIndex(true);
    } catch (e) {
        console.error('Community pool delete failed:', e);
        showShareToast(t('mappools_load_fail'));
    }
}

/* ── add-to-collection (reuse mappools.js mappoolImport) ── */
function cmpoolRoundSetIds(ri) {
    const r = cmpoolCur && cmpoolCur.rounds[ri];
    if (!r) return [];
    return [...new Set(r.brackets.flatMap(b => b.maps.map(m => m.setId)).filter(Boolean))];
}
function cmpoolEventSetIds() {
    if (!cmpoolCur) return [];
    return [...new Set(cmpoolCur.rounds.flatMap(r => r.brackets.flatMap(b => b.maps.map(m => m.setId))).filter(Boolean))];
}
function cmpoolImportRound(ri) {
    const r = cmpoolCur && cmpoolCur.rounds[ri];
    if (!r) return;
    mappoolImport(`${cmpoolCur.tournament.name} · ${r.name}`, cmpoolRoundSetIds(ri));
}
function cmpoolImportEvent() {
    if (!cmpoolCur) return;
    mappoolImport(cmpoolCur.tournament.name, cmpoolEventSetIds());
}

/* language switch — the tab content is JS-built */
function refreshCommunityMappoolsLocalized() {
    if (!cmpoolIndexLoaded) return;
    if (cmpoolCur) renderCommunityPoolDetail();
    else renderCommunityPoolList();
}
