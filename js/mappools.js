/* ===== 世界盃圖池 tab: browse the official osu! World Cup mappools =====
   OWC / TWC / MWC 4K+7K / CWC, every year. Backed by this site's own index
   (netlify/functions/wc-mappools-list.js, fed by the wc-mappool-crawl-cron.js
   background crawler that parses the ppy/osu-wiki markdown). Pick a
   tournament + year -> pool grouped by round and mod bracket, each map a
   playable card. "把這一輪 / 整屆加入收藏" reuses the same
   applyImportedCollections() tail as the 曲庫分類 facet button.

   Reuses osu.js globals: escHtml, icon, playOsuPreview, copyBeatmapId,
   downloadBeatmapset, addOsuBeatmap, applyImportedCollections,
   showShareToast, getOsuCollection, OSU_MODES. */
const MAPPOOL_TOURNEYS = [
    { key: 'OWC', variant: '' },
    { key: 'TWC', variant: '' },
    { key: 'CWC', variant: '' },
    { key: 'MWC', variant: '4K' },
    { key: 'MWC', variant: '7K' },
];

let mappoolsLoaded = false;
let mappoolIndex = null;   // { editions:[{key,variant,year,label,folder,roundCount,mapCount}], coverage, lastRunAt }
let mappoolData = null;    // last-rendered edition payload
let mappoolCur = { key: '', variant: '', folder: '', year: 0 };

function ensureMappoolsLoaded() {
    if (!mappoolsLoaded) loadMappoolIndex();
}

function mappoolTourneyShort(key, variant) {
    return variant ? `${key} ${variant}` : key;
}

function mappoolEditionsFor(key, variant) {
    if (!mappoolIndex) return [];
    return (mappoolIndex.editions || [])
        .filter((e) => e.key === key && (e.variant || '') === (variant || ''))
        .sort((a, b) => a.year - b.year || String(a.folder).localeCompare(String(b.folder)));
}

/* Short label for the edition <select>: the year for most, "#1 (2011)" /
   "#2 (2011)" for the two 2011 OWCs, and just the year when the wiki title
   carries neither (e.g. the first CWC, titled "Catch the Beat World Cup"). */
function mappoolEditionShort(e) {
    const tok = (e.label || '').trim().split(/\s+/).pop() || '';
    if (/^20\d{2}$/.test(tok)) return tok;
    if (tok.charAt(0) === '#') return `${tok} (${e.year})`;
    return String(e.year);
}

async function loadMappoolIndex() {
    mappoolsLoaded = true;
    const roundsEl = document.getElementById('mappool-rounds');
    if (roundsEl) roundsEl.innerHTML = `<p class="osu-empty">${t('gallery_loading')}</p>`;
    try {
        const res = await fetch('/.netlify/functions/wc-mappools-list');
        if (!res.ok) throw new Error('bad response');
        mappoolIndex = await res.json();
    } catch (e) {
        console.error('Mappool index failed:', e);
        if (roundsEl) roundsEl.innerHTML = `<p class="osu-empty">${t('mappools_load_fail')}</p>`;
        return;
    }
    renderMappoolTourneyTabs();
    renderMappoolCoverage();

    const first = MAPPOOL_TOURNEYS.find((tr) => mappoolEditionsFor(tr.key, tr.variant).length);
    if (first) {
        const eds = mappoolEditionsFor(first.key, first.variant);
        selectMappool(eds[eds.length - 1]);
    } else if (roundsEl) {
        roundsEl.innerHTML = `<p class="osu-empty">${t('mappools_empty')}</p>`;
    }
}

function renderMappoolTourneyTabs() {
    const el = document.getElementById('mappool-tourney-tabs');
    if (!el) return;
    el.innerHTML = MAPPOOL_TOURNEYS.map((tr) => {
        const has = mappoolEditionsFor(tr.key, tr.variant).length;
        const active = mappoolCur.key === tr.key && mappoolCur.variant === (tr.variant || '');
        return `<button class="osu-mode-tab${active ? ' active' : ''}" ${has ? '' : 'disabled'} onclick="switchMappoolTourney('${tr.key}','${tr.variant}')">${mappoolTourneyShort(tr.key, tr.variant)}</button>`;
    }).join('');
}

function renderMappoolEditionSelect() {
    const sel = document.getElementById('mappool-year-select');
    if (!sel) return;
    const eds = mappoolEditionsFor(mappoolCur.key, mappoolCur.variant);
    sel.innerHTML = eds.slice().reverse()
        .map((e) => `<option value="${escHtml(e.folder)}"${e.folder === mappoolCur.folder ? ' selected' : ''}>${escHtml(mappoolEditionShort(e))}</option>`)
        .join('');
}

function switchMappoolTourney(key, variant) {
    const eds = mappoolEditionsFor(key, variant);
    if (eds.length) selectMappool(eds[eds.length - 1]);
}

function switchMappoolEdition(folder) {
    const e = mappoolIndex && (mappoolIndex.editions || []).find((x) => x.folder === folder);
    if (e) selectMappool(e);
}

function selectMappool(e) {
    if (!e) return;
    mappoolCur = { key: e.key, variant: e.variant || '', folder: e.folder, year: e.year };
    renderMappoolTourneyTabs();
    renderMappoolEditionSelect();
    loadMappool();
}

async function loadMappool() {
    const roundsEl = document.getElementById('mappool-rounds');
    const addBtn = document.getElementById('mappool-add-event-btn');
    if (addBtn) addBtn.disabled = true;
    if (roundsEl) roundsEl.innerHTML = `<p class="osu-empty">${t('gallery_loading')}</p>`;
    try {
        const res = await fetch(`/.netlify/functions/wc-mappools-list?folder=${encodeURIComponent(mappoolCur.folder)}`);
        if (!res.ok) throw new Error('bad response');
        mappoolData = await res.json();
        renderMappool();
    } catch (e) {
        console.error('Mappool load failed:', e);
        if (roundsEl) roundsEl.innerHTML = `<p class="osu-empty">${t('mappools_load_fail')}</p>`;
    }
}

function mappoolModeApi(m) {
    return (m === 'taiko' || m === 'fruits' || m === 'mania') ? m : 'osu';
}

/* Tournament-style mod badge for a bracket label — the 2-letter hexagon
   icons pools use (NM / HD / HR / DT / FM / TB), plus the osu!mania-only
   ones. `slug` -> a css/osu.css `.mod-badge--<slug>` colour class. */
const MOD_BADGE = {
    'No Mod': { ab: 'NM', slug: 'nm' },
    'Hidden': { ab: 'HD', slug: 'hd' },
    'Hard Rock': { ab: 'HR', slug: 'hr' },
    'Double Time': { ab: 'DT', slug: 'dt' },
    'Free Mod': { ab: 'FM', slug: 'fm' },
    'Tiebreaker': { ab: 'TB', slug: 'tb' },
    'Rice': { ab: 'RC', slug: 'rc' },
    'Long Note': { ab: 'LN', slug: 'ln' },
    'Hybrid': { ab: 'HB', slug: 'hb' },
    'SV': { ab: 'SV', slug: 'sv' },
    'Extreme': { ab: 'EX', slug: 'ex' },
    'Mixed Mod': { ab: 'MM', slug: 'mm' },
};

function mappoolBracketHead(label) {
    const b = MOD_BADGE[label];
    const badge = b
        ? `<span class="mod-badge mod-badge--${b.slug}" aria-hidden="true">${b.ab}</span>`
        : '';
    return `<div class="mappool-bracket-label">${badge}<span>${escHtml(label)}</span></div>`;
}

function renderMappoolCard(mp, inCollection) {
    const setId = mp.setId;
    const cover = `https://assets.ppy.sh/beatmaps/${setId}/covers/card.jpg`;
    const title = mp.resolved ? (mp.title || '') : (mp.wikiText || `#${mp.beatmapId}`);
    const artist = mp.resolved ? (mp.artist || '') : '';
    const creator = mp.resolved ? (mp.creator || '') : '';
    const meta = [];
    if (typeof mp.stars === 'number') meta.push(`${mp.stars.toFixed(2)}★`);
    if (mp.version) meta.push(escHtml(mp.version));
    if (typeof mp.bpm === 'number') meta.push(`${Math.round(mp.bpm)} BPM`);
    const openUrl = `https://osu.ppy.sh/beatmapsets/${setId}#${mappoolModeApi(mp.mode)}/${mp.beatmapId}`;
    return `
    <div class="osu-card${mp.isTiebreaker ? ' mappool-tb' : ''}" onclick="window.open('${openUrl}','_blank')">
        <div class="osu-card-bg" style="background-image:url('${cover}')"></div>
        <div class="osu-card-overlay"></div>
        <button class="farm-add-btn${inCollection ? ' in-collection' : ''}" ${inCollection ? 'disabled' : `onclick="addMappoolCardToCollection(${setId}, event)"`} title="${inCollection ? t('farm_in_collection') : t('farm_add_btn_title')}">${icon(inCollection ? 'check' : 'plus')}</button>
        <button class="osu-copy-btn" onclick="copyBeatmapId(${setId}, event)" title="${t('mappools_copy_id')}">${icon('copy')}</button>
        <button class="osu-download-btn" onclick="downloadBeatmapset(${setId}, event)" title="${t('osu_download_btn_title')}">${icon('download')}</button>
        <button class="osu-play-btn" onclick="playOsuPreview(${setId}, event)" title="${t('mappools_preview')}">${icon('play', { filled: true })}</button>
        <div class="osu-card-info">
            <div class="osu-card-title">${escHtml(title)}</div>
            <div class="osu-card-artist">${escHtml(artist)}</div>
            <div class="osu-card-mapper">${creator ? t('mapped_by', { n: escHtml(creator) }) : ''}</div>
            <div class="catalog-card-meta">${meta.length ? `<span>${meta.join(' · ')}</span>` : ''}</div>
        </div>
    </div>`;
}

function renderMappool() {
    const roundsEl = document.getElementById('mappool-rounds');
    const addBtn = document.getElementById('mappool-add-event-btn');
    if (!roundsEl || !mappoolData) return;
    const d = mappoolData;

    if (!d.rounds || !d.rounds.length) {
        roundsEl.innerHTML = `<p class="osu-empty">${t('mappools_empty')}</p>`;
        if (addBtn) addBtn.disabled = true;
        return;
    }

    const collected = new Set(OSU_MODES.flatMap((m) => (getOsuCollection()[m] || []).map((s) => s.beatmapset_id)));

    roundsEl.innerHTML = d.rounds.map((r, ri) => {
        const links = [];
        if (r.mappackUrl) links.push(`<a href="${escHtml(r.mappackUrl)}" target="_blank" rel="noopener">${t('mappools_mappack')}</a>`);
        if (r.showcaseUrl) links.push(`<a href="${escHtml(r.showcaseUrl)}" target="_blank" rel="noopener">${t('mappools_showcase')}</a>`);
        const brackets = r.brackets.map((b) => {
            const cards = b.maps.map((mp) => renderMappoolCard(mp, collected.has(mp.setId))).join('');
            return `${mappoolBracketHead(b.label)}<div class="osu-collection mappool-list">${cards}</div>`;
        }).join('');
        return `
        <div class="mappool-round">
            <div class="mappool-round-head">
                <h3>${escHtml(r.name)}</h3>
                <div class="mappool-round-links">${links.join('')}</div>
                <button class="btn mappool-round-add" onclick="addMappoolRoundToCollection(${ri})">${t('mappools_round_add_btn')}</button>
            </div>
            ${brackets}
        </div>`;
    }).join('');

    if (addBtn) addBtn.disabled = false;
}

function renderMappoolCoverage() {
    const el = document.getElementById('mappool-coverage');
    if (!el || !mappoolIndex) return;
    const c = mappoolIndex.coverage;
    if (!c || !mappoolIndex.lastRunAt) {
        el.textContent = t('catalog_coverage_pending');
        return;
    }
    el.textContent = t('mappools_coverage', {
        e: c.editions || 0,
        n: (c.maps || 0).toLocaleString(),
        t: new Date(mappoolIndex.lastRunAt).toLocaleDateString(),
    });
}

/* ── add-to-collection ── */
function mappoolRoundSetIds(ri) {
    const r = mappoolData && mappoolData.rounds && mappoolData.rounds[ri];
    if (!r) return [];
    return [...new Set(r.brackets.flatMap((b) => b.maps.map((m) => m.setId)).filter(Boolean))];
}
function mappoolEventSetIds() {
    if (!mappoolData) return [];
    return [...new Set(mappoolData.rounds.flatMap((r) => r.brackets.flatMap((b) => b.maps.map((m) => m.setId))).filter(Boolean))];
}

async function addMappoolCardToCollection(setId, event) {
    if (event) event.stopPropagation();
    await addOsuBeatmap(String(setId));
    renderMappool();
}

async function addMappoolRoundToCollection(ri) {
    const r = mappoolData && mappoolData.rounds && mappoolData.rounds[ri];
    if (!r) return;
    await mappoolImport(`${mappoolData.label} · ${r.name}`, mappoolRoundSetIds(ri));
}

async function addMappoolEventToCollection() {
    if (!mappoolData) return;
    await mappoolImport(mappoolData.label, mappoolEventSetIds());
}

async function mappoolImport(label, ids) {
    if (!ids.length) { alert(t('mappools_empty')); return; }
    if (!confirm(t('mappools_add_confirm', { name: label, n: ids.length }))) return;
    const named = [{ name: label, entries: ids.map((id) => ({ setId: id })) }];
    try {
        const report = await applyImportedCollections(named, (msg) => {
            if (typeof showShareToast === 'function') showShareToast(msg);
        });
        showShareToast(t('mappools_add_done', { name: label, n: report.addedSets, cat: report.touchedCats }));
    } catch (e) {
        console.error('Mappool import failed:', e);
        alert(t('mappools_load_fail'));
    }
    renderMappool();
}

/* Called from refreshDynamicContent() on a site-language switch — the
   tourney tabs / year <select> / cards are built in JS. */
function refreshMappoolsLocalized() {
    if (!mappoolsLoaded) return;
    renderMappoolTourneyTabs();
    renderMappoolEditionSelect();
    renderMappoolCoverage();
    if (mappoolData) renderMappool();
}
