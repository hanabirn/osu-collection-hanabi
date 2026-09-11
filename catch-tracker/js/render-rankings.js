let _page = 0;

async function loadRankings() {
    const body = document.getElementById('rankings-body');
    const note = document.getElementById('coverage-note');
    try {
        const data = await apiGet('rankings-list', { page: _page, limit: 50 });
        const startRank = _page * 50 + 1;
        body.innerHTML = data.items.length
            ? data.items.map((r, i) => `
                <tr>
                    <td>${startRank + i}</td>
                    <td><img class="avatar" src="${escapeHtml(r.avatar_url || '')}" alt=""> ${playerLink(r.user_id, r.username)}</td>
                    <td>${fmtPP(r.pp)}</td>
                    <td>${fmtAccuracy(r.accuracy)}</td>
                    <td>${r.play_count ?? '—'}</td>
                </tr>`).join('')
            : `<tr><td colspan="5" class="empty-state">No ranked TW catch players tracked yet — the first rankings sweep may not have run.</td></tr>`;

        const c = data.coverage || {};
        note.textContent = `Tracking ${data.total} TW catch players` +
            (c.lastOkAt ? ` — last refreshed ${relTime(c.lastOkAt)}` : ' — not yet refreshed');

        document.getElementById('page-label').textContent = `Page ${_page + 1}`;
        document.getElementById('prev-page').disabled = _page === 0;
        document.getElementById('next-page').disabled = (_page + 1) * 50 >= data.total;
    } catch (err) {
        note.textContent = 'Failed to load rankings.';
    }
}

document.getElementById('prev-page').addEventListener('click', () => { if (_page > 0) { _page--; loadRankings(); } });
document.getElementById('next-page').addEventListener('click', () => { _page++; loadRankings(); });

loadRankings();
