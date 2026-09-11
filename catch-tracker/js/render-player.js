function scoreRow(s) {
    return `<tr>
        <td>${mapLink(s.beatmap_id, `${s.artist || ''} - ${s.title || ''} [${s.version || ''}]`)}</td>
        <td>${escapeHtml(formatMods(s.mods))}</td>
        <td>${gradeBadge(s.rank)}${s.is_fc ? ' FC' : ''}</td>
        <td>${fmtAccuracy(s.accuracy)}</td>
        <td>${fmtPP(s.pp)}</td>
        <td>${relTime(s.created_at)}</td>
    </tr>`;
}

function scoreTable(scores, emptyMsg) {
    if (!scores.length) return `<p class="empty-state">${emptyMsg}</p>`;
    return `<table>
        <thead><tr><th>Map</th><th>Mods</th><th>Grade</th><th>Acc</th><th>pp</th><th>When</th></tr></thead>
        <tbody>${scores.map(scoreRow).join('')}</tbody>
    </table>`;
}

async function loadPlayer() {
    const main = document.getElementById('player-main');
    const params = new URLSearchParams(location.search);
    const userId = params.get('id');
    if (!userId) {
        main.innerHTML = '<p class="empty-state">No player id given.</p>';
        return;
    }

    try {
        const data = await apiGet('player-get', { user_id: userId });
        const p = data.profile;
        document.title = `Catch Tracker — ${p.username || userId}`;

        main.innerHTML = `
            <div class="card profile-header">
                <img class="avatar" src="${escapeHtml(p.avatar_url || '')}" alt="">
                <div>
                    <h1 style="margin:0">${escapeHtml(p.username || userId)}</h1>
                    <div class="profile-stats">
                        <span>${fmtPP(p.pp)}</span>
                        <span>#${p.country_rank ?? '—'} TW</span>
                        <span>#${p.global_rank ?? '—'} global</span>
                        <span>${fmtAccuracy(p.accuracy)} acc</span>
                        <span>${p.play_count ?? '—'} plays</span>
                    </div>
                </div>
            </div>
            <h2>Best Plays</h2>
            ${scoreTable(data.bestPlays || [], 'No best plays available.')}
            <h2>Recent Plays (seen by this tracker)</h2>
            ${scoreTable(data.recentPlays || [], 'No recent plays observed yet by this tracker.')}
        `;
    } catch (err) {
        main.innerHTML = '<p class="empty-state">Player not found.</p>';
    }
}

loadPlayer();
