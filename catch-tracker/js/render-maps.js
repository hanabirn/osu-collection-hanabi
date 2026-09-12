let _page = 0;
let _status = '';
let _q = '';
let _searchDebounce = null;
let _starDebounce = null;

const MAX_DIFF_ICONS = 8;
const PAGE_SIZE = 16; // 4x4 grid
const STAR_SLIDER_MAX = 10; // the max thumb sitting at its rightmost = "10+", unbounded

function osuLinkBtn(beatmapsetId) {
    if (!beatmapsetId) return '';
    return `<a class="cover-link-btn" href="https://osu.ppy.sh/beatmapsets/${beatmapsetId}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" title="Open on osu!">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
    </a>`;
}

function mapCard(set) {
    const cover = coverArtUrlCard(set.beatmapset_id);
    const style = cover ? ` style="background-image:url('${cover.replace(/'/g, '%27')}')"` : '';
    const starLabel = set.star_min != null && set.star_max != null
        ? (set.star_min === set.star_max ? set.star_min.toFixed(2) + '★' : `${set.star_min.toFixed(2)}–${set.star_max.toFixed(2)}★`)
        : '';
    const shown = set.diffs.slice(0, MAX_DIFF_ICONS);
    const overflow = set.diffs.length - shown.length;
    const diffRow = shown.map(d => diffIcon(d.beatmap_id, d.difficulty_rating, d.version)).join('')
        + (overflow > 0 ? `<span class="diff-icon-more">+${overflow}</span>` : '');
    const target = set.primary_beatmap_id ?? (set.diffs[0] && set.diffs[0].beatmap_id);

    return `<div class="map-card" onclick="location.href='map.html?id=${encodeURIComponent(target)}'">
        <div class="map-card-cover"${style}>
${statusBadge(set.status)}
            ${starLabel ? `<span class="map-star">${escapeHtml(starLabel)}</span>` : ''}
            ${previewButton(set.beatmapset_id, set.bpm, set.title, set.artist, cover)}
            ${osuLinkBtn(set.beatmapset_id)}
        </div>
        <div class="map-card-body">
            <div class="map-title">${escapeHtml(set.title || '')}</div>
            <div class="map-artist">${escapeHtml(set.artist || '')}</div>
            <div class="diff-icon-row">${diffRow}<span class="diff-count-label">${set.diffs.length}${escapeHtml(t('diff_count_suffix'))}</span></div>
            <div class="map-meta">${set.bpm != null ? Math.round(set.bpm) + ' BPM · ' : ''}${fmtLength(set.total_length)}</div>
        </div>
    </div>`;
}

async function loadMaps() {
    const grid = document.getElementById('maps-grid');
    const note = document.getElementById('coverage-note');
    try {
        const starMinInput = parseFloat(document.getElementById('star-min').value);
        const starMaxInput = parseFloat(document.getElementById('star-max').value);
        const data = await apiGet('maps-list', {
            page: _page, limit: PAGE_SIZE,
            status: _status || undefined,
            q: _q || undefined,
            sort: document.getElementById('maps-sort').value,
            starMin: starMinInput > 0 ? starMinInput : undefined,
            starMax: starMaxInput < STAR_SLIDER_MAX ? starMaxInput : undefined,
        });

        // A page/filter/sort change is about to replace the whole grid —
        // any currently-playing preview's card is going away, and the
        // preview queue (see common.js's previewButton()) needs to start
        // fresh so its indices match the new cards about to be rendered.
        stopPreview();
        resetPreviewQueue();

        grid.innerHTML = data.items.length
            ? data.items.map(mapCard).join('')
            : `<p class="empty-state">${t('empty_maps')}</p>`;

        const c = data.coverage || {};
        const counts = c.countsByStatus || {};
        note.textContent = t('coverage_maps', { n: c.datasetSize || 0, ranked: counts.ranked || 0, loved: counts.loved || 0 });

        document.getElementById('page-label').textContent = t('page_label', { n: _page + 1 });
        document.getElementById('prev-page').disabled = _page === 0;
        document.getElementById('next-page').disabled = (_page + 1) * PAGE_SIZE >= data.total;
    } catch (err) {
        note.textContent = t('failed_maps');
    }
}

document.getElementById('prev-page').addEventListener('click', () => { if (_page > 0) { _page--; loadMaps(); } });
document.getElementById('next-page').addEventListener('click', () => { _page++; loadMaps(); });
document.getElementById('maps-sort').addEventListener('change', () => { _page = 0; loadMaps(); });

document.querySelectorAll('#status-filter .pill').forEach(btn => {
    btn.addEventListener('click', () => {
        _status = btn.getAttribute('data-status');
        _page = 0;
        document.querySelectorAll('#status-filter .pill').forEach(b => b.classList.toggle('active', b === btn));
        loadMaps();
    });
});

document.getElementById('maps-search').addEventListener('input', (e) => {
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(() => { _q = e.target.value.trim(); _page = 0; loadMaps(); }, 300);
});

/* ---------- star range slider ---------- */

function updateStarRangeUI(triggerLoad) {
    const minInput = document.getElementById('star-min');
    const maxInput = document.getElementById('star-max');
    const fill = document.getElementById('star-range-fill');
    const label = document.getElementById('star-range-label');

    let minVal = parseFloat(minInput.value);
    let maxVal = parseFloat(maxInput.value);
    // Keep a minimum gap so the two thumbs never cross/overlap exactly.
    if (minVal > maxVal - 0.2) {
        if (document.activeElement === minInput) { minVal = Math.max(0, maxVal - 0.2); minInput.value = minVal; }
        else { maxVal = Math.min(STAR_SLIDER_MAX, minVal + 0.2); maxInput.value = maxVal; }
    }

    const minPct = (minVal / STAR_SLIDER_MAX) * 100;
    const maxPct = (maxVal / STAR_SLIDER_MAX) * 100;
    fill.style.left = minPct + '%';
    fill.style.width = Math.max(0, maxPct - minPct) + '%';

    // Whichever thumb sits further from the middle gets input priority so
    // it stays grabbable when the two are close together.
    minInput.style.zIndex = minVal > (STAR_SLIDER_MAX - maxVal) ? 3 : 2;
    maxInput.style.zIndex = minVal > (STAR_SLIDER_MAX - maxVal) ? 2 : 3;

    label.textContent = (minVal <= 0 && maxVal >= STAR_SLIDER_MAX)
        ? t('star_any')
        : `${minVal.toFixed(1)}–${maxVal >= STAR_SLIDER_MAX ? maxVal.toFixed(0) + '+' : maxVal.toFixed(1)}★`;

    if (triggerLoad) {
        clearTimeout(_starDebounce);
        _starDebounce = setTimeout(() => { _page = 0; loadMaps(); }, 300);
    }
}

['star-min', 'star-max'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => updateStarRangeUI(true));
});
updateStarRangeUI(false);

loadMaps();
