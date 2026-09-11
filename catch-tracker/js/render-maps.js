let _page = 0;
let _status = '';
let _q = '';
let _searchDebounce = null;

function mapCard(m) {
    const cover = coverArtUrl(m.beatmapset_id);
    const style = cover ? ` style="background-image:url('${cover.replace(/'/g, '%27')}')"` : '';
    const star = m.difficulty_rating != null ? m.difficulty_rating.toFixed(2) + '★' : '';
    return `<a class="map-card" href="map.html?id=${encodeURIComponent(m.beatmap_id)}"${style}>
        <span class="map-status">${escapeHtml(m.status || '')}</span>
        ${star ? `<span class="map-star">${escapeHtml(star)}</span>` : ''}
        <div class="map-title">${escapeHtml(m.title || '')} [${escapeHtml(m.version || '')}]</div>
        <div class="map-artist">${escapeHtml(m.artist || '')}</div>
        <div class="map-meta">${m.bpm != null ? Math.round(m.bpm) + ' BPM · ' : ''}${fmtLength(m.total_length)}</div>
    </a>`;
}

async function loadMaps() {
    const grid = document.getElementById('maps-grid');
    const note = document.getElementById('coverage-note');
    try {
        const data = await apiGet('maps-list', {
            page: _page, limit: 24,
            status: _status || undefined,
            q: _q || undefined,
            sort: document.getElementById('maps-sort').value,
        });

        grid.innerHTML = data.items.length
            ? data.items.map(mapCard).join('')
            : `<p class="empty-state">${t('empty_maps')}</p>`;

        const c = data.coverage || {};
        const counts = c.countsByStatus || {};
        note.textContent = t('coverage_maps', { n: c.datasetSize || 0, ranked: counts.ranked || 0, loved: counts.loved || 0 });

        document.getElementById('page-label').textContent = t('page_label', { n: _page + 1 });
        document.getElementById('prev-page').disabled = _page === 0;
        document.getElementById('next-page').disabled = (_page + 1) * 24 >= data.total;
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

loadMaps();
