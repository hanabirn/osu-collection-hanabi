let _page = 0;
let _country = '';
let _countriesPopulated = false;

function populateCountryFilter(countries) {
    if (_countriesPopulated || !countries || !countries.length) return;
    const select = document.getElementById('filter-country');
    if (!select) return;
    select.innerHTML = `<option value="">${escapeHtml(t('filter_all_countries'))}</option>` +
        countries.map(c => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.code)} (${c.count})</option>`).join('');
    _countriesPopulated = true;
}

async function loadHighlights() {
    const strip = document.getElementById('highlight-strip');
    try {
        const data = await apiGet('feed-list', { sort: 'pp', limit: 3 });
        strip.innerHTML = data.items.map(highlightCard).join('') || `<p class="empty-state">${t('no_data')}</p>`;
    } catch {
        strip.hidden = true;
    }
}

async function loadRankings() {
    const body = document.getElementById('rankings-body');
    const note = document.getElementById('coverage-note');
    try {
        const data = await apiGet('rankings-list', { page: _page, limit: 50, country: _country || undefined });
        const startRank = _page * 50 + 1;
        body.innerHTML = data.items.length
            ? data.items.map((r, i) => `
                <tr>
                    <td class="rank-num">${startRank + i}</td>
                    <td>${avatarWithFlagHtml(r.avatar_url, r.country_code)} ${playerLink(r.user_id, r.username)}</td>
                    <td>${fmtPP(r.pp)}</td>
                    <td>${fmtAccuracy(r.accuracy)}</td>
                    <td>${r.play_count ?? '—'}</td>
                </tr>`).join('')
            : `<tr><td colspan="5" class="empty-state">${t('empty_rankings')}</td></tr>`;

        populateCountryFilter(data.countries);

        const c = data.coverage || {};
        note.textContent = c.lastOkAt
            ? t('coverage_rankings', { n: data.total, time: relTime(c.lastOkAt) })
            : t('coverage_rankings_pending', { n: data.total });

        document.getElementById('page-label').textContent = t('page_label', { n: _page + 1 });
        document.getElementById('prev-page').disabled = _page === 0;
        document.getElementById('next-page').disabled = (_page + 1) * 50 >= data.total;
    } catch (err) {
        note.textContent = t('failed_rankings');
    }
}

document.getElementById('prev-page').addEventListener('click', () => { if (_page > 0) { _page--; loadRankings(); } });
document.getElementById('next-page').addEventListener('click', () => { _page++; loadRankings(); });
document.getElementById('filter-country').addEventListener('change', (e) => {
    _country = e.target.value;
    _page = 0;
    loadRankings();
});

loadRankings();
loadHighlights();
