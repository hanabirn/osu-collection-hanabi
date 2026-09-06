/* ===== 段位認定 tab: browse osu! dan courses =====
   Dan courses are community skill-certification marathons — one beatmapset
   per dan, mostly graveyard/loved. The backend
   (netlify/functions/osu-dan-courses.js) returns a CURATED, project-grouped
   list per mode plus a tightly-filtered search page behind a "更多" toggle.
   Per-mode passing standard + resource links live here.

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

// Per-mode passing standard (i18n key) + external resource links.
const DAN_META = {
    osu: {
        std: 'dan_std_osu',
        links: [
            ['osu!std Tapping Dan Course（論壇）', 'https://osu.ppy.sh/community/forums/topics/2034200'],
        ],
    },
    taiko: {
        std: 'dan_std_taiko',
        links: [
            ['osu!Taiko Dan-i Dojo（論壇）', 'https://osu.ppy.sh/community/forums/topics/771253'],
        ],
    },
    catch: {
        std: 'dan_std_catch',
        links: [
            ['osu!catch Dan ~ CTB ~ Project（論壇）', 'https://osu.ppy.sh/community/forums/topics/756127'],
        ],
    },
    mania4k: {
        std: 'dan_std_mania',
        links: [
            ['Dan ~ REFORM ~ 官網', 'https://sites.google.com/view/danreform/home'],
            ["Signicial's Courses（論壇）", 'https://osu.ppy.sh/community/forums/topics/2135031'],
            ['4K Dan Courses（論壇）', 'https://osu.ppy.sh/community/forums/topics/304816'],
        ],
    },
    mania7k: {
        std: 'dan_std_mania',
        links: [
            ['7K Dan Courses（論壇・更新版）', 'https://osu.ppy.sh/community/forums/topics/981680'],
        ],
    },
};
const DAN_LINKS_COMMON = [['Mania Tracker · Dan 等級估算', 'https://mania-tracker.com/dan-estimates']];

let danLoaded = false;
let danMode = 'mania4k';
let danGroups = [];
let danSearch = [];
let danCursor = null;
let danBusy = false;

function ensureDanLoaded() {
    if (!danLoaded) { danLoaded = true; renderDanModePills(); loadDan(); }
}

function renderDanModePills() {
    const row = document.getElementById('dan-mode-row');
    if (!row) return;
    row.innerHTML = DAN_MODES.map(dm =>
        `<button class="dan-mode-pill${dm.key === danMode ? ' active' : ''}" style="${danModeVars(dm)}" onclick="switchDanMode('${dm.key}')">${modeIconSvg(dm.mode)}<span>${escHtml(dm.label)}</span></button>`
    ).join('');
}

function renderDanMeta() {
    const el = document.getElementById('dan-meta');
    if (!el) return;
    const meta = DAN_META[danMode];
    if (!meta) { el.innerHTML = ''; return; }
    const links = [...(meta.links || []), ...DAN_LINKS_COMMON]
        .map(([label, url]) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${escHtml(label)}</a>`)
        .join('');
    el.innerHTML = `
        <div class="dan-standard">${icon('award')}<span>${t('dan_standard_label')}：${escHtml(t(meta.std))}</span></div>
        <div class="dan-resources">${t('dan_resources_label')}：${links}</div>`;
}

function switchDanMode(key) {
    if (danBusy || key === danMode) return;
    danMode = key;
    danCursor = null;
    danGroups = [];
    danSearch = [];
    renderDanModePills();
    renderDanMeta();
    loadDan();
}

async function loadDan(more) {
    const listEl = document.getElementById('dan-list');
    if (!listEl) return;
    danBusy = true;
    if (!more) listEl.innerHTML = `<p class="osu-empty">${t('gallery_loading')}</p>`;

    try {
        const params = new URLSearchParams({ mode: danMode });
        if (more) { params.set('more', '1'); if (danCursor) params.set('cursor', danCursor); }
        const res = await fetch(`/.netlify/functions/osu-dan-courses?${params}`);
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();
        if (more) {
            danSearch = danSearch.concat(data.search || []);
        } else {
            danGroups = data.groups || [];
            danSearch = data.search || [];
        }
        danCursor = data.cursor_string || null;
        renderDanList();
    } catch (e) {
        console.error('Dan list failed:', e);
        if (!more) listEl.innerHTML = `<p class="osu-empty">${t('dan_load_fail')}</p>`;
    } finally {
        danBusy = false;
    }
}

function danCardHtml(s, dm, collectionSet) {
    const coverUrl = `https://assets.ppy.sh/beatmaps/${s.id}/covers/card.jpg`;
    const inCollection = collectionSet.has(s.id);
    const stars = (s.star_min != null && s.star_max != null)
        ? (s.star_min === s.star_max ? s.star_min.toFixed(2) : `${s.star_min.toFixed(2)}–${s.star_max.toFixed(2)}`)
        : '';
    const starColor = s.star_max != null && typeof starRatingColor === 'function' ? starRatingColor(s.star_max) : '';
    const pinMark = s.pinned ? `<span class="dan-pin-star" title="${escHtml(t('dan_pinned'))}">${icon('star', { filled: true })}</span>` : '';
    return `
    <div class="osu-card dan-card${s.pinned ? ' dan-pinned' : ''}" style="${danModeVars(dm)}" onclick="window.open('https://osu.ppy.sh/beatmapsets/${s.id}','_blank')">
        <div class="osu-card-bg" style="background-image:url('${coverUrl}')"></div>
        <div class="osu-card-overlay"></div>
        <button class="farm-add-btn${inCollection ? ' in-collection' : ''}" ${inCollection ? 'disabled' : `onclick="addDanToCollection(${s.id}, event)"`} title="${inCollection ? t('farm_in_collection') : t('farm_add_btn_title')}">${icon(inCollection ? 'check' : 'plus')}</button>
        <button class="osu-copy-btn" onclick="copyBeatmapId(${s.id}, event)" title="${t('mappools_copy_id')}">${icon('copy')}</button>
        <button class="osu-download-btn" onclick="downloadBeatmapset(${s.id}, event)" title="${t('osu_download_btn_title')}">${icon('download')}</button>
        <button class="osu-play-btn" onclick="playOsuPreview(${s.id}, event)" title="${t('mappools_preview')}">${icon('play', { filled: true })}</button>
        <div class="osu-card-info">
            <div class="osu-card-title">${pinMark}${escHtml(s.title || '')}</div>
            <div class="osu-card-artist">${escHtml(s.artist || '')}</div>
            <div class="osu-card-mapper">${t('mapped_by', { n: escHtml(s.creator || '') })}</div>
            <div class="catalog-card-meta">
                ${stars ? `<span style="color:${starColor}">${stars}★${s.diff_count ? ` · ${s.diff_count}` : ''}</span>` : ''}
                ${s.status ? `<span class="dan-status">${escHtml(s.status)}</span>` : ''}
            </div>
        </div>
    </div>`;
}

function renderDanList() {
    const listEl = document.getElementById('dan-list');
    if (!listEl) return;
    const dm = DAN_MODE_BY_KEY[danMode] || DAN_MODES[0];
    const collectionSet = new Set(
        OSU_MODES.flatMap(m => (getOsuCollection()[m] || []).map(s => s.beatmapset_id))
    );

    if (danGroups.length === 0 && danSearch.length === 0) {
        listEl.innerHTML = `<p class="osu-empty">${t('dan_empty')}</p>`;
        return;
    }

    let html = danGroups.map(g => `
        <div class="dan-group">
            <div class="dan-group-head">${escHtml(g.group)} <span>${g.sets.length}</span></div>
            <div class="osu-collection">${g.sets.map(s => danCardHtml(s, dm, collectionSet)).join('')}</div>
            <button class="btn btn-sm dan-group-add" onclick="addDanGroupToCollection(${JSON.stringify(g.group).replace(/"/g, '&quot;')}, [${g.sets.map(s => s.id).join(',')}])">${t('dan_add_group_btn', { name: escHtml(g.group) })}</button>
        </div>`).join('');

    if (danSearch.length || danCursor) {
        html += `
        <details class="dan-more-box">
            <summary>${t('dan_more_summary', { n: danSearch.length })}</summary>
            <p class="dan-more-note">${t('dan_more_note')}</p>
            <div class="osu-collection">${danSearch.map(s => danCardHtml(s, dm, collectionSet)).join('')}</div>
            ${danCursor ? `<button class="osu-page-btn dan-more-btn" onclick="loadDan(true)">${t('dan_load_more')}</button>` : ''}
        </details>`;
    }

    listEl.innerHTML = html;
}

async function addDanToCollection(setId, event) {
    if (event) event.stopPropagation();
    await addOsuBeatmap(String(setId));
    renderDanList();
}

async function addDanGroupToCollection(groupName, ids) {
    if (!ids || !ids.length) return;
    const dm = DAN_MODE_BY_KEY[danMode] || DAN_MODES[0];
    const name = t('dan_collection_name', { mode: `${dm.label} · ${groupName}` });
    if (!confirm(t('dan_add_group_confirm', { name: groupName, n: ids.length }))) return;
    try {
        const named = [{ name, entries: ids.map(id => ({ setId: id })) }];
        const report = await applyImportedCollections(named);
        alert(t('catalog_create_collection_done', { name, n: report.addedSets, cat: report.touchedCats }));
    } catch (e) {
        console.error('Dan group import failed:', e);
        alert(t('dan_load_fail'));
    } finally {
        renderDanList();
    }
}

/* Re-localize on a site-language switch. */
function refreshDanLocalized() {
    if (!danLoaded) return;
    renderDanModePills();
    renderDanMeta();
    renderDanList();
}
