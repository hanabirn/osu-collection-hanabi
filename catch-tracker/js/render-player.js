function scoreRow(s) {
    return `<tr>
        <td>${mapLink(s.beatmap_id, `${s.artist || ''} - ${s.title || ''} [${s.version || ''}]`)}</td>
        <td>${modsTag(s.mods)}</td>
        <td>${gradeBadge(s.rank)}${fcTag(s.is_fc)}</td>
        <td>${fmtAccuracy(s.accuracy)}</td>
        <td>${fmtPP(s.pp)}</td>
        <td>${relTime(s.created_at)}</td>
    </tr>`;
}

function scoreTable(scores, emptyMsg) {
    if (!scores.length) return `<p class="empty-state">${emptyMsg}</p>`;
    return `<div class="table-wrap"><table>
        <thead><tr><th>${t('th_map')}</th><th>${t('th_mods')}</th><th>${t('th_grade')}</th><th>${t('th_acc')}</th><th>${t('th_pp')}</th><th>${t('th_when')}</th></tr></thead>
        <tbody>${scores.map(scoreRow).join('')}</tbody>
    </table></div>`;
}

async function loadPlayer() {
    const main = document.getElementById('player-main');
    const params = new URLSearchParams(location.search);
    const userId = params.get('id');
    if (!userId) {
        main.innerHTML = `<p class="empty-state">${t('player_no_id')}</p>`;
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
                        <span>${t('stat_tw', { n: p.country_rank ?? '—' })}</span>
                        <span>${t('stat_global', { n: p.global_rank ?? '—' })}</span>
                        <span>${t('stat_acc', { acc: fmtAccuracy(p.accuracy) })}</span>
                        <span>${t('stat_plays', { n: p.play_count ?? '—' })}</span>
                    </div>
                </div>
            </div>
            <h2>${t('best_plays')}</h2>
            ${scoreTable(data.bestPlays || [], t('no_best_plays'))}
            <h2>${t('recent_plays')}</h2>
            ${scoreTable(data.recentPlays || [], t('no_recent_plays'))}
        `;
    } catch (err) {
        main.innerHTML = `<p class="empty-state">${t('player_not_found')}</p>`;
    }
}

loadPlayer();
