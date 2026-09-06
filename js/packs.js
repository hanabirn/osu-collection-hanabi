/* ===== 官方圖包 tab: browse osu!'s own curated beatmap packs =====
   (themed / featured-artist / tournament / spotlight / loved). osu!Collector
   only has user-uploaded collections, so this is a clean "they don't have it"
   resource. Backed by netlify/functions/osu-beatmap-packs.js (API v2 proxy).

   Reuses global helpers from osu.js: escHtml, icon, applyImportedCollections,
   addOsuBeatmap, downloadBeatmapset, playOsuPreview, copyBeatmapId,
   getOsuCollection, OSU_MODES, buildPaginationPageButtons (not needed —
   packs paginate by opaque cursor, not page number). */
/* Each type gets its own accent (fed to CSS as --pk on the pill and card) +
   a Lucide icon from icons.js, so the grid reads at a glance by category. */
const PACK_TYPES = [
    { key: 'standard',   i18n: 'packs_type_standard',    color: '#8b93a7', rgb: '139,147,167', icon: 'package' },
    { key: 'featured',   i18n: 'packs_type_featured',    color: '#34d399', rgb: '52,211,153',  icon: 'star' },
    { key: 'theme',      i18n: 'packs_type_theme',       color: '#a855f7', rgb: '168,85,247',  icon: 'tag' },
    { key: 'tournament', i18n: 'packs_type_tournament',  color: '#22d3ee', rgb: '34,211,238',  icon: 'swords' },
    { key: 'chart',      i18n: 'packs_type_spotlight',   color: '#fbbf24', rgb: '251,191,36',  icon: 'sparkles' },
    { key: 'loved',      i18n: 'packs_type_loved',       color: '#f472b6', rgb: '244,114,182', icon: 'heart' },
    { key: 'artist',     i18n: 'packs_type_artist',      color: '#c084fc', rgb: '192,132,252', icon: 'palette' },
];
const PACK_TYPE_BY_KEY = Object.fromEntries(PACK_TYPES.map(t => [t.key, t]));
function packTypeVars(pt) { return `--pk:${pt.color};--pk-rgb:${pt.rgb}`; }
const PACK_RULESET_LABEL = { 0: 'osu!', 1: 'osu!taiko', 2: 'osu!catch', 3: 'osu!mania' };

let packsLoaded = false;
let packsType = 'standard';
let packsCursor = null;
let packsItems = [];
let packsBusy = false;
let packsDetailSets = [];   // lean sets of the pack currently open in the modal
let packsDetailName = '';

function ensurePacksLoaded() {
    if (!packsLoaded) { packsLoaded = true; renderPackTypePills(); loadPacks(true); }
}

function renderPackTypePills() {
    const row = document.getElementById('packs-type-row');
    if (!row) return;
    row.innerHTML = PACK_TYPES.map(pt =>
        `<button class="packs-type-pill${pt.key === packsType ? ' active' : ''}" style="${packTypeVars(pt)}" onclick="switchPacksType('${pt.key}')">${icon(pt.icon)}<span>${escHtml(t(pt.i18n))}</span></button>`
    ).join('');
}

function switchPacksType(type) {
    if (packsBusy || type === packsType) return;
    packsType = type;
    packsCursor = null;
    packsItems = [];
    renderPackTypePills();
    loadPacks(true);
}

async function loadPacks(reset) {
    const listEl = document.getElementById('packs-list');
    const moreEl = document.getElementById('packs-more');
    if (!listEl) return;
    packsBusy = true;
    if (reset) listEl.innerHTML = `<p class="osu-empty">${t('gallery_loading')}</p>`;
    if (moreEl) moreEl.innerHTML = '';

    try {
        const params = new URLSearchParams({ type: packsType });
        if (packsCursor) params.set('cursor', packsCursor);
        const res = await fetch(`/.netlify/functions/osu-beatmap-packs?${params}`);
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();
        packsItems = reset ? (data.packs || []) : packsItems.concat(data.packs || []);
        packsCursor = data.cursor_string || null;
        renderPacksList();
    } catch (e) {
        console.error('Packs list failed:', e);
        if (reset) listEl.innerHTML = `<p class="osu-empty">${t('packs_load_fail')}</p>`;
    } finally {
        packsBusy = false;
    }
}

function renderPacksList() {
    const listEl = document.getElementById('packs-list');
    const moreEl = document.getElementById('packs-more');
    if (!listEl) return;

    if (packsItems.length === 0) {
        listEl.innerHTML = `<p class="osu-empty">${t('packs_empty')}</p>`;
        if (moreEl) moreEl.innerHTML = '';
        return;
    }

    const typeMeta = PACK_TYPE_BY_KEY[packsType] || PACK_TYPES[0];
    listEl.innerHTML = packsItems.map((p, i) => {
        const ruleset = p.ruleset_id != null ? PACK_RULESET_LABEL[p.ruleset_id] : '';
        const year = p.date ? new Date(p.date).getFullYear() : '';
        const foot = [ruleset, year].filter(Boolean).join(' · ');
        const challenge = p.no_diff_reduction
            ? `<span class="packs-card-challenge">${escHtml(t('packs_no_reduction'))}</span>` : '';
        return `
        <button class="packs-card" style="${packTypeVars(typeMeta)};--i:${i}" onclick="openPackDetail('${escHtml(p.tag)}')">
            <span class="packs-card-top">
                <span class="packs-card-tag">${escHtml(p.tag)}</span>
                <span class="packs-card-type">${icon(typeMeta.icon)}</span>
            </span>
            <span class="packs-card-name">${escHtml(p.name || p.tag)}</span>
            <span class="packs-card-foot">
                ${p.author ? `<span class="packs-card-author">${escHtml(t('packs_by', { n: p.author }))}</span>` : '<span></span>'}
                <span class="packs-card-tail">${challenge}${foot ? `<span class="packs-card-meta">${escHtml(foot)}</span>` : ''}</span>
            </span>
        </button>`;
    }).join('');

    if (moreEl) {
        moreEl.innerHTML = packsCursor
            ? `<button class="osu-page-btn packs-more-btn" onclick="loadPacks(false)">${t('packs_load_more')}</button>`
            : '';
    }
}

async function openPackDetail(tag) {
    const modal = document.getElementById('packs-detail-modal');
    const titleEl = document.getElementById('packs-detail-title');
    const bodyEl = document.getElementById('packs-detail-body');
    if (!modal || !bodyEl) return;

    packsDetailSets = [];
    packsDetailName = tag;
    titleEl.textContent = tag;
    bodyEl.innerHTML = `<p class="osu-empty">${t('gallery_loading')}</p>`;
    modal.style.display = 'flex';
    updatePacksDetailAddBtn();

    try {
        const res = await fetch(`/.netlify/functions/osu-beatmap-packs?tag=${encodeURIComponent(tag)}`);
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();
        packsDetailSets = data.beatmapsets || [];
        packsDetailName = (data.pack && data.pack.name) || tag;
        titleEl.textContent = packsDetailName;
        renderPackDetailBody();
    } catch (e) {
        console.error('Pack detail failed:', e);
        bodyEl.innerHTML = `<p class="osu-empty">${t('packs_load_fail')}</p>`;
    }
}

function renderPackDetailBody() {
    const bodyEl = document.getElementById('packs-detail-body');
    if (!bodyEl) return;
    if (packsDetailSets.length === 0) {
        bodyEl.innerHTML = `<p class="osu-empty">${t('packs_empty')}</p>`;
        updatePacksDetailAddBtn();
        return;
    }
    const collectionSet = new Set(
        OSU_MODES.flatMap(m => (getOsuCollection()[m] || []).map(s => s.beatmapset_id))
    );
    bodyEl.innerHTML = `<div class="osu-collection">` + packsDetailSets.map(s => {
        const coverUrl = `https://assets.ppy.sh/beatmaps/${s.id}/covers/card.jpg`;
        const inCollection = collectionSet.has(s.id);
        const stars = (s.star_min != null && s.star_max != null)
            ? (s.star_min === s.star_max ? s.star_min.toFixed(2) : `${s.star_min.toFixed(2)}–${s.star_max.toFixed(2)}`)
            : '';
        return `
        <div class="osu-card" onclick="window.open('https://osu.ppy.sh/beatmapsets/${s.id}','_blank')">
            <div class="osu-card-bg" style="background-image:url('${coverUrl}')"></div>
            <div class="osu-card-overlay"></div>
            <button class="farm-add-btn${inCollection ? ' in-collection' : ''}" ${inCollection ? 'disabled' : `onclick="addPackSetToCollection(${s.id}, event)"`} title="${inCollection ? t('farm_in_collection') : t('farm_add_btn_title')}">${icon(inCollection ? 'check' : 'plus')}</button>
            <button class="osu-copy-btn" onclick="copyBeatmapId(${s.id}, event)" title="${t('mappools_copy_id')}">${icon('copy')}</button>
            <button class="osu-download-btn" onclick="downloadBeatmapset(${s.id}, event)" title="${t('osu_download_btn_title')}">${icon('download')}</button>
            <button class="osu-play-btn" onclick="playOsuPreview(${s.id}, event)" title="${t('mappools_preview')}">${icon('play', { filled: true })}</button>
            <div class="osu-card-info">
                <div class="osu-card-title">${escHtml(s.title || '')}</div>
                <div class="osu-card-artist">${escHtml(s.artist || '')}</div>
                <div class="osu-card-mapper">${t('mapped_by', { n: escHtml(s.creator || '') })}</div>
                ${stars ? `<div class="catalog-card-meta"><span>${stars}★</span></div>` : ''}
            </div>
        </div>`;
    }).join('') + `</div>`;
    updatePacksDetailAddBtn();
}

function updatePacksDetailAddBtn() {
    const btn = document.getElementById('packs-detail-add-btn');
    if (!btn) return;
    const span = btn.querySelector('span');
    if (packsDetailSets.length === 0) {
        btn.disabled = true;
        span.textContent = t('packs_add_all_label');
        return;
    }
    const collectionSet = new Set(
        OSU_MODES.flatMap(m => (getOsuCollection()[m] || []).map(s => s.beatmapset_id))
    );
    const missing = packsDetailSets.filter(s => !collectionSet.has(s.id)).length;
    btn.disabled = missing === 0;
    span.textContent = missing > 0 ? t('packs_add_all_btn', { n: missing }) : t('packs_add_all_done');
}

async function addPackSetToCollection(setId, event) {
    if (event) event.stopPropagation();
    await addOsuBeatmap(String(setId));
    renderPackDetailBody();
}

async function addWholePackToCollection() {
    if (packsDetailSets.length === 0) return;
    const btn = document.getElementById('packs-detail-add-btn');
    const ids = packsDetailSets.map(s => s.id).filter(Boolean);
    if (!confirm(t('packs_add_all_confirm', { name: packsDetailName, n: ids.length }))) return;
    const named = [{ name: packsDetailName, entries: ids.map(id => ({ setId: id })) }];
    try {
        if (btn) btn.disabled = true;
        const report = await applyImportedCollections(named, (msg) => {
            if (btn) btn.querySelector('span').textContent = msg;
        });
        alert(t('catalog_create_collection_done', { name: packsDetailName, n: report.addedSets, cat: report.touchedCats }));
    } catch (e) {
        console.error('Pack import failed:', e);
        alert(t('packs_load_fail'));
    } finally {
        renderPackDetailBody();
    }
}

function closePacksDetailModal() {
    const modal = document.getElementById('packs-detail-modal');
    if (modal) modal.style.display = 'none';
}

/* Re-localize on a site-language switch (pills + any rendered list/modal). */
function refreshPacksLocalized() {
    if (!packsLoaded) return;
    renderPackTypePills();
    renderPacksList();
    if (document.getElementById('packs-detail-modal')?.style.display === 'flex') renderPackDetailBody();
}
