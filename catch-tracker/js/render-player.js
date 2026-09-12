const GRADE_COUNT_FIELDS = [
    ['x', 'ss'], ['xh', 'ssh'], ['s', 's'], ['sh', 'sh'], ['a', 'a'],
];

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
        <tbody>${scores.map(s => scoreRow(s)).join('')}</tbody>
    </table></div>`;
}

function gradeTallyHtml(gradeCounts) {
    if (!gradeCounts) return '';
    const items = GRADE_COUNT_FIELDS
        .map(([grade, field]) => ({ grade: grade.toUpperCase(), n: gradeCounts[field] }))
        .filter(g => g.n != null);
    if (!items.length) return '';
    return `<div class="grade-tally">${items.map(g => `
        <div class="grade-tally-item">${gradeBadge(g.grade)}<span class="count">${g.n}</span></div>
    `).join('')}</div>`;
}

function fmtJoinDate(iso) {
    if (!iso) return null;
    try {
        return new Date(iso).toLocaleDateString(getLang() === 'zh' ? 'zh-TW' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return null;
    }
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

        const extraStats = [];
        const joinDate = fmtJoinDate(p.join_date);
        if (joinDate) extraStats.push(`<span>${t('stat_joined', { date: joinDate })}</span>`);
        if (p.play_time_seconds != null) extraStats.push(`<span>${t('stat_playtime', { h: Math.round(p.play_time_seconds / 3600).toLocaleString() })}</span>`);

        const coverStyle = p.cover_url ? ` style="background-image:url('${p.cover_url.replace(/'/g, '%27')}')"` : '';
        const bestPlays = data.bestPlays || [];
        const sortedByDate = bestPlays.filter(s => s.created_at).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const newest = sortedByDate[0];
        const oldest = sortedByDate[sortedByDate.length - 1];
        const mostUsedMod = data.mostUsedMod;

        main.innerHTML = `
            <div class="card profile-header${p.cover_url ? ' has-cover' : ''}"${coverStyle}>
                ${avatarWithFlagHtml(p.avatar_url, p.country_code)}
                <div>
                    <h1 style="margin:0">${escapeHtml(p.username || userId)}</h1>
                    <div class="profile-stats">
                        <span>${fmtPP(p.pp)}</span>
                        <span>${t('stat_country', { code: p.country_code || '—', n: p.country_rank ?? '—' })}</span>
                        <span>${t('stat_global', { n: p.global_rank ?? '—' })}</span>
                        <span>${t('stat_acc', { acc: fmtAccuracy(p.accuracy) })}</span>
                        <span>${t('stat_plays', { n: p.play_count ?? '—' })}</span>
                        ${extraStats.join('')}
                    </div>
                </div>
                <a class="pill farm-helper-link" href="farm-helper.html?id=${encodeURIComponent(userId)}">${escapeHtml(t('farm_helper_view'))}</a>
            </div>

            ${p.grade_counts || mostUsedMod ? `
            <div class="card">
                <div style="display:flex;gap:32px;flex-wrap:wrap">
                    ${p.grade_counts ? `<div><h2 style="margin-top:0">${t('grade_tally')}</h2>${gradeTallyHtml(p.grade_counts)}</div>` : ''}
                    ${mostUsedMod ? `<div><h2 style="margin-top:0">${t('most_used_mod')}</h2><div class="grade-tally-item" style="display:inline-flex"><span class="mods-tag">${escapeHtml(mostUsedMod.mod)}</span><span class="count">${mostUsedMod.count}/${mostUsedMod.total}</span></div></div>` : ''}
                </div>
            </div>` : ''}

            ${newest || oldest ? `
            <div class="highlight-strip">
                ${newest ? highlightCard({ ...newest, username: p.username }).replace('highlight-card"', `highlight-card" data-label="${escapeHtml(t('newest_best'))}"`) : ''}
                ${oldest && oldest !== newest ? highlightCard({ ...oldest, username: p.username }).replace('highlight-card"', `highlight-card" data-label="${escapeHtml(t('oldest_best'))}"`) : ''}
            </div>` : ''}

            <h2>${t('best_plays')}</h2>
            ${scoreTable(bestPlays, t('no_best_plays'))}
            <h2>${t('recent_plays')}</h2>
            ${scoreTable(data.recentPlays || [], t('no_recent_plays'))}
        `;
    } catch (err) {
        main.innerHTML = `<p class="empty-state">${t('player_not_found')}</p>`;
    }
}

loadPlayer();
