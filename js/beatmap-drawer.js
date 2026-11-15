/* ===== Beatmap details drawer =====
   After osu-web's beatmap page and osu!Collector: a catalog card (曲庫, the
   首頁 new-maps row, 依實力推薦) opens this panel on the right instead of
   leaving for osu.ppy.sh. It shows the set's difficulties, BPM and length
   (one get_beatmaps call through the existing v1 proxy) with preview, add,
   download and "open on osu!".

   A real dialog: focus moves to its close button, Esc or the backdrop
   closes it, and focus goes back to the card that opened it. */

let beatmapDrawerOpener = null;
let beatmapDrawerReq = 0;

function fmtMapLength(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function openBeatmapDrawer(setId) {
    const id = Number(setId);
    if (!Number.isInteger(id) || id <= 0) return;
    const drawer = document.getElementById('beatmap-drawer');
    const body = document.getElementById('beatmap-drawer-body');
    if (!drawer || !body) {
        window.open(`https://osu.ppy.sh/beatmapsets/${id}`, '_blank');
        return;
    }
    beatmapDrawerOpener = document.activeElement;
    const req = ++beatmapDrawerReq;
    document.getElementById('beatmap-drawer-scrim').hidden = false;
    drawer.hidden = false;
    requestAnimationFrame(() => drawer.classList.add('open'));
    drawer.querySelector('.beatmap-drawer-close').focus();
    body.innerHTML = `<div class="beatmap-drawer-cover" style="background-image:url('https://assets.ppy.sh/beatmaps/${id}/covers/cover.jpg')"></div>
        <p class="beatmap-drawer-note">${escHtml(t('gallery_loading'))}</p>`;

    let maps;
    try {
        maps = await osuFetch(`s=${id}`);
    } catch {
        maps = null;
    }
    if (req !== beatmapDrawerReq) return; // another card was opened meanwhile
    if (!Array.isArray(maps) || !maps.length) {
        body.innerHTML = `<div class="beatmap-drawer-cover" style="background-image:url('https://assets.ppy.sh/beatmaps/${id}/covers/cover.jpg')"></div>
            <p class="beatmap-drawer-note">${escHtml(t('updates_load_fail'))}</p>
            <a class="btn" href="https://osu.ppy.sh/beatmapsets/${id}" target="_blank" rel="noopener noreferrer">${escHtml(t('drawer_open_osu'))}</a>`;
        return;
    }
    const first = maps[0];
    const diffs = [...maps].sort((a, b) => parseFloat(a.difficultyrating) - parseFloat(b.difficultyrating));
    const inCollection = OSU_MODES.some((m) => (getOsuCollection()[m] || []).some((s) => s.beatmapset_id === id));
    const modes = new Set(diffs.map((d) => String(d.mode)));
    document.getElementById('beatmap-drawer-title').textContent = first.title || '';

    body.innerHTML = `
        <div class="beatmap-drawer-cover" style="background-image:url('https://assets.ppy.sh/beatmaps/${id}/covers/cover.jpg')"></div>
        <div class="beatmap-drawer-head">
            <p class="beatmap-drawer-artist">${escHtml(first.artist || '')}</p>
            <p class="beatmap-drawer-mapper">${t('mapped_by', { n: escHtml(first.creator || '') })}</p>
        </div>
        <div class="beatmap-drawer-stats">
            <span><b>${Math.round(parseFloat(first.bpm) || 0)}</b> BPM</span>
            <span><b>${fmtMapLength(first.total_length)}</b> ${escHtml(t('drawer_length'))}</span>
            <span><b>${diffs.length}</b> ${escHtml(t('drawer_diffs'))}</span>
        </div>
        <ul class="beatmap-drawer-diffs">
            ${diffs.map((d) => {
                const sr = parseFloat(d.difficultyrating) || 0;
                const mode = OSU_MODES[Number(d.mode)] || 'standard';
                return `<li>
                    <span class="beatmap-drawer-dot" aria-hidden="true">${modes.size > 1 ? modeIconSvg(mode, starRatingColor(sr)) : `<i style="background:${starRatingColor(sr)}"></i>`}</span>
                    <a class="beatmap-drawer-diff" href="https://osu.ppy.sh/beatmapsets/${id}#${OSU_API_MODE[mode] || 'osu'}/${encodeURIComponent(d.beatmap_id)}" target="_blank" rel="noopener noreferrer">${escHtml(d.version || '')}</a>
                    <span class="beatmap-drawer-sr">${sr.toFixed(2)}★</span>
                </li>`;
            }).join('')}
        </ul>
        <div class="beatmap-drawer-actions">
            <button type="button" class="btn btn-ghost" onclick="playOsuPreview(${id}, event)">${icon('play', { extraClass: 'icon-label-gap' })}${escHtml(t('mappools_preview'))}</button>
            <button type="button" class="btn" ${inCollection ? 'disabled' : `onclick="drawerAddToCollection(${id}, this)"`}>${escHtml(t(inCollection ? 'farm_in_collection' : 'drawer_add'))}</button>
            <button type="button" class="btn btn-ghost" onclick="downloadBeatmapset(${id}, event)">${icon('download', { extraClass: 'icon-label-gap' })}${escHtml(t('osu_download_btn_title'))}</button>
            <a class="btn btn-ghost" href="https://osu.ppy.sh/beatmapsets/${id}" target="_blank" rel="noopener noreferrer">${escHtml(t('drawer_open_osu'))}</a>
        </div>`;
}

/* Add from the drawer, then show it as added (the shared card helper would
   re-enable the button when it finishes). */
async function drawerAddToCollection(id, btn) {
    btn.disabled = true;
    await addOsuBeatmap(String(id), { isSet: true });
    btn.textContent = t('farm_in_collection');
    if (typeof renderCatalogList === 'function') renderCatalogList();
}

function closeBeatmapDrawer() {
    const drawer = document.getElementById('beatmap-drawer');
    if (!drawer || drawer.hidden) return;
    beatmapDrawerReq++;
    drawer.classList.remove('open');
    document.getElementById('beatmap-drawer-scrim').hidden = true;
    drawer.hidden = true;
    if (beatmapDrawerOpener && document.contains(beatmapDrawerOpener)) beatmapDrawerOpener.focus();
    beatmapDrawerOpener = null;
}

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const drawer = document.getElementById('beatmap-drawer');
    if (drawer && !drawer.hidden) { e.stopPropagation(); closeBeatmapDrawer(); }
});
