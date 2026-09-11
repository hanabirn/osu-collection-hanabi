let _page = 0;
let _refreshTimer = null;

function currentFilters() {
    return {
        page: _page,
        limit: 30,
        grade: document.getElementById('filter-grade').value || undefined,
        fcOnly: document.getElementById('filter-fc').checked ? '1' : undefined,
        chokeOnly: document.getElementById('filter-choke').checked ? '1' : undefined,
    };
}

async function loadFeed() {
    const body = document.getElementById('feed-body');
    const note = document.getElementById('coverage-note');
    try {
        const params = Object.fromEntries(Object.entries(currentFilters()).filter(([, v]) => v !== undefined));
        const data = await apiGet('feed-list', params);

        body.innerHTML = data.items.length
            ? data.items.map(s => `
                <tr>
                    <td><img class="avatar" src="${escapeHtml(s.avatar_url || '')}" alt=""> ${playerLink(s.user_id, s.username)}</td>
                    <td>${mapLink(s.beatmap_id, `${s.artist || ''} - ${s.title || ''} [${s.version || ''}]`)}</td>
                    <td>${modsTag(s.mods)}</td>
                    <td>${gradeBadge(s.rank)}${fcTag(s.is_fc)}</td>
                    <td>${fmtAccuracy(s.accuracy)}</td>
                    <td>${fmtPP(s.pp)}</td>
                    <td>${relTime(s.created_at)}</td>
                </tr>`).join('')
            : `<tr><td colspan="7" class="empty-state">${t('empty_feed')}</td></tr>`;

        const c = data.coverage || {};
        note.textContent = c.lastOkAt
            ? t('coverage_feed', { n: c.totalPlayers || 0, time: relTime(c.lastOkAt), done: c.playersPolledThisSweep || 0, total: c.totalPlayers || 0 })
            : t('coverage_feed_pending', { n: c.totalPlayers || 0 });

        document.getElementById('page-label').textContent = t('page_label', { n: _page + 1 });
        document.getElementById('prev-page').disabled = _page === 0;
        document.getElementById('next-page').disabled = (_page + 1) * 30 >= data.total;
    } catch (err) {
        note.textContent = t('failed_feed');
    }
}

document.getElementById('prev-page').addEventListener('click', () => { if (_page > 0) { _page--; loadFeed(); } });
document.getElementById('next-page').addEventListener('click', () => { _page++; loadFeed(); });
['filter-grade', 'filter-fc', 'filter-choke'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => { _page = 0; loadFeed(); });
});

loadFeed();
_refreshTimer = setInterval(loadFeed, 45000);
