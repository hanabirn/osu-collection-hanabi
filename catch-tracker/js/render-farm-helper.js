/* Farm helper (刷圖助手) page — see netlify/functions/farm-helper.js for
   the actual recommendation logic. This just renders whatever it returns:
   a header card for the player these recommendations are for, a coverage
   note (peer-crawl progress is gradual, same "coverage degrades
   gracefully" pattern as the rest of this site), and a results table
   sorted by estimated pp gain. */

function categoryLabel(category) {
    return category === 'new' ? t('farm_helper_category_new') : t('farm_helper_category_improve');
}

function refScoreHtml(item) {
    const mods = item.ref_mods && item.ref_mods.length ? modsTag(item.ref_mods) : modsTag([]);
    const acc = item.ref_accuracy != null ? fmtAccuracy(item.ref_accuracy) : '—';
    return `${gradeBadge(item.ref_rank)} ${mods} ${acc}`;
}

async function loadFarmHelper() {
    const main = document.getElementById('farm-helper-main');
    const params = new URLSearchParams(location.search);
    const userId = params.get('id');
    if (!userId) {
        main.innerHTML = `<p class="empty-state">${t('farm_helper_no_id')}</p>`;
        return;
    }

    try {
        const [playerData, farmData] = await Promise.all([
            apiGet('player-get', { user_id: userId }),
            apiGet('farm-helper', { user_id: userId }),
        ]);
        const p = playerData.profile;
        document.title = `Catch Tracker — ${t('farm_helper_title')}: ${p.username || userId}`;

        const items = farmData.items || [];
        const coverage = farmData.coverage || {};

        const rows = items.length
            ? items.map(item => `
                <tr>
                    <td><span class="farm-helper-cat farm-helper-cat--${item.category}">${categoryLabel(item.category)}</span></td>
                    <td>${mapLink(item.beatmap_id, `${item.artist || ''} - ${item.title || ''} [${item.version || ''}]`)}${item.difficulty_rating != null ? ` <span class="mods-tag">${item.difficulty_rating.toFixed(2)}★</span>` : ''}</td>
                    <td>${refScoreHtml(item)}</td>
                    <td class="farm-helper-gain">+${item.gain}pp</td>
                </tr>`).join('')
            : `<tr><td colspan="4" class="empty-state">${t('farm_helper_no_data')}</td></tr>`;

        main.innerHTML = `
            <div class="card profile-header${p.cover_url ? ' has-cover' : ''}"${p.cover_url ? ` style="background-image:url('${p.cover_url.replace(/'/g, '%27')}')"` : ''}>
                ${avatarWithFlagHtml(p.avatar_url, p.country_code)}
                <div>
                    <h1 style="margin:0">${t('farm_helper_title')}</h1>
                    <div class="profile-stats"><span>${escapeHtml(p.username || userId)}</span><span>${fmtPP(p.pp)}</span></div>
                </div>
            </div>
            <p class="coverage-note">${coverage.inRankings
                ? t('farm_helper_coverage', { n: coverage.peersCovered ?? 0, total: coverage.peerWindowSize ?? 0 })
                : t('farm_helper_not_ranked')}</p>
            <p class="farm-helper-disclaimer">${t('farm_helper_disclaimer')}</p>
            <div class="table-wrap">
            <table>
                <thead><tr><th>${t('th_category')}</th><th>${t('th_map')}</th><th>${t('farm_helper_ref')}</th><th>${t('farm_helper_gain')}</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
            </div>
        `;
    } catch (err) {
        main.innerHTML = `<p class="empty-state">${t('farm_helper_failed')}</p>`;
    }
}

loadFarmHelper();
