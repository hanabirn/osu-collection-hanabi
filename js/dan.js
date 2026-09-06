/* ===== 段位認定 tab: browse osu! dan courses =====
   Dan courses are community skill-certification marathons — one beatmapset
   each, mostly graveyard/loved. No official API/wiki list exists, so the
   backend (netlify/functions/osu-dan-courses.js) drives off osu!'s own
   beatmapset search + a few hand-picked pins. osu!Collector has nothing
   like this.

   Reuses global helpers from osu.js: escHtml, icon, modeIconSvg,
   starRatingColor, applyImportedCollections, addOsuBeatmap,
   downloadBeatmapset, playOsuPreview, copyBeatmapId, getOsuCollection,
   OSU_MODES. */
const DAN_MODES = [
    { key: 'osu',     label: 'osu!',       mode: 'standard', color: '#f472b6', rgb: '244,114,182' },
    { key: 'taiko',   label: 'osu!taiko',  mode: 'taiko',    color: '#f87171', rgb: '248,113,113' },
    { key: 'catch',   label: 'osu!catch',  mode: 'catch',    color: '#34d399', rgb: '52,211,153' },
    { key: 'mania4k', label: 'mania 4K',   mode: 'mania',    color: '#a855f7', rgb: '168,85,247' },
    { key: 'mania7k', label: 'mania 7K',   mode: 'mania',    color: '#c084fc', rgb: '192,132,252' },
];
const DAN_MODE_BY_KEY = Object.fromEntries(DAN_MODES.map(m => [m.key, m]));
function danModeVars(dm) { return `--dan:${dm.color};--dan-rgb:${dm.rgb}`; }

let danLoaded = false;
let danMode = 'mania4k';
let danCursor = null;
let danItems = [];
let danBusy = false;

function ensureDanLoaded() {
    if (!danLoaded) { danLoaded = true; renderDanModePills(); loadDan(true); }
}

function renderDanModePills() {
    const row = document.getElementById('dan-mode-row');
    if (!row) return;
    row.innerHTML = DAN_MODES.map(dm =>
        `<button class="dan-mode-pill${dm.key === danMode ? ' active' : ''}" style="${danModeVars(dm)}" onclick="switchDanMode('${dm.key}')">${modeIconSvg(dm.mode)}<span>${escHtml(dm.label)}</span></button>`
    ).join('');
}

function switchDanMode(key) {
    if (danBusy || key === danMode) return;
    danMode = key;
    danCursor = null;
    danItems = [];
    renderDanModePills();
    loadDan(true);
}

async function loadDan(reset) {
    const listEl = document.getElementById('dan-list');
    const moreEl = document.getElementById('dan-more');
    if (!listEl) return;
    danBusy = true;
    if (reset) listEl.innerHTML = `<p class="osu-empty">${t('gallery_loading')}</p>`;
    if (moreEl) moreEl.innerHTML = '';

    try {
        const params = new URLSearchParams({ mode: danMode });
        if (danCursor) params.set('cursor', danCursor);
        const res = await fetch(`/.netlify/functions/osu-dan-courses?${params}`);
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();
        danItems = reset ? (data.sets || []) : danItems.concat(data.sets || []);
        danCursor = data.cursor_string || null;
        renderDanList();
    } catch (e) {
        console.error('Dan list failed:', e);
        if (reset) listEl.innerHTML = `<p class="osu-empty">${t('dan_load_fail')}</p>`;
    } finally {
        danBusy = false;
    }
}

function renderDanList() {
    const listEl = document.getElementById('dan-list');
    const moreEl = document.getElementById('dan-more');
    if (!listEl) return;

    if (danItems.length === 0) {
        listEl.innerHTML = `<p class="osu-empty">${t('dan_empty')}</p>`;
        if (moreEl) moreEl.innerHTML = '';
        return;
    }

    const dm = DAN_MODE_BY_KEY[danMode] || DAN_MODES[0];
    const collectionSet = new Set(
        OSU_MODES.flatMap(m => (getOsuCollection()[m] || []).map(s => s.beatmapset_id))
    );

    listEl.innerHTML = danItems.map(s => {
        const coverUrl = `https://assets.ppy.sh/beatmaps/${s.id}/covers/card.jpg`;
        const inCollection = collectionSet.has(s.id);
        const stars = (s.star_min != null && s.star_max != null)
            ? (s.star_min === s.star_max ? s.star_min.toFixed(2) : `${s.star_min.toFixed(2)}–${s.star_max.toFixed(2)}`)
            : '';
        const starColor = s.star_max != null && typeof starRatingColor === 'function' ? starRatingColor(s.star_max) : '';
        return `
        <div class="osu-card dan-card" style="${danModeVars(dm)}" onclick="window.open('https://osu.ppy.sh/beatmapsets/${s.id}','_blank')">
            <div class="osu-card-bg" style="background-image:url('${coverUrl}')"></div>
            <div class="osu-card-overlay"></div>
            ${s.pinned ? `<span class="dan-pin-badge">${icon('star', { filled: true })} ${escHtml(t('dan_pinned'))}</span>` : ''}
            <button class="farm-add-btn${inCollection ? ' in-collection' : ''}" ${inCollection ? 'disabled' : `onclick="addDanToCollection(${s.id}, event)"`} title="${inCollection ? t('farm_in_collection') : t('farm_add_btn_title')}">${icon(inCollection ? 'check' : 'plus')}</button>
            <button class="osu-copy-btn" onclick="copyBeatmapId(${s.id}, event)" title="${t('mappools_copy_id')}">${icon('copy')}</button>
            <button class="osu-download-btn" onclick="downloadBeatmapset(${s.id}, event)" title="${t('osu_download_btn_title')}">${icon('download')}</button>
            <button class="osu-play-btn" onclick="playOsuPreview(${s.id}, event)" title="${t('mappools_preview')}">${icon('play', { filled: true })}</button>
            <div class="osu-card-info">
                <div class="osu-card-title">${escHtml(s.title || '')}</div>
                <div class="osu-card-artist">${escHtml(s.artist || '')}</div>
                <div class="osu-card-mapper">${t('mapped_by', { n: escHtml(s.creator || '') })}</div>
                <div class="catalog-card-meta">
                    ${stars ? `<span style="color:${starColor}">${stars}★${s.diff_count ? ` · ${s.diff_count}` : ''}</span>` : ''}
                    ${s.status ? `<span class="dan-status">${escHtml(s.status)}</span>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');

    if (moreEl) {
        moreEl.innerHTML = danCursor
            ? `<button class="osu-page-btn dan-more-btn" onclick="loadDan(false)">${t('dan_load_more')}</button>`
            : '';
    }
}

async function addDanToCollection(setId, event) {
    if (event) event.stopPropagation();
    await addOsuBeatmap(String(setId));
    renderDanList();
}

async function addDanPageToCollection() {
    if (danItems.length === 0) return;
    const dm = DAN_MODE_BY_KEY[danMode] || DAN_MODES[0];
    const name = t('dan_collection_name', { mode: dm.label });
    const ids = danItems.map(s => s.id).filter(Boolean);
    if (!confirm(t('dan_add_page_confirm', { name, n: ids.length }))) return;
    const btn = document.getElementById('dan-add-page-btn');
    const lbl = btn && btn.querySelector('span');
    try {
        if (btn) btn.disabled = true;
        const named = [{ name, entries: ids.map(id => ({ setId: id })) }];
        const report = await applyImportedCollections(named, (msg) => { if (lbl) lbl.textContent = msg; });
        alert(t('catalog_create_collection_done', { name, n: report.addedSets, cat: report.touchedCats }));
    } catch (e) {
        console.error('Dan import failed:', e);
        alert(t('dan_load_fail'));
    } finally {
        if (btn) btn.disabled = false;
        if (lbl) lbl.textContent = t('dan_add_page_btn');
        renderDanList();
    }
}

/* Re-localize on a site-language switch. */
function refreshDanLocalized() {
    if (!danLoaded) return;
    renderDanModePills();
    renderDanList();
    const lbl = document.querySelector('#dan-add-page-btn span');
    if (lbl) lbl.textContent = t('dan_add_page_btn');
}
