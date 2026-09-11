async function loadMap() {
    const main = document.getElementById('map-main');
    const params = new URLSearchParams(location.search);
    const beatmapId = params.get('id');
    if (!beatmapId) {
        main.innerHTML = '<p class="empty-state">No map id given.</p>';
        return;
    }

    try {
        const data = await apiGet('map-stats', { beatmap_id: beatmapId });
        const m = data.meta;

        if (!m) {
            main.innerHTML = `<p class="empty-state">No scores observed yet for this map among tracked TW players.</p>`;
            return;
        }

        document.title = `Catch Tracker — ${m.title || beatmapId}`;

        const gradeRows = Object.entries(data.gradeCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([g, n]) => `<tr><td>${gradeBadge(g)}</td><td>${n}</td></tr>`).join('');
        const modRows = Object.entries(data.modCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([mod, n]) => `<tr><td>${escapeHtml(mod)}</td><td>${n}</td></tr>`).join('');

        main.innerHTML = `
            <div class="card">
                <h1 style="margin:0 0 6px">${escapeHtml(m.artist)} - ${escapeHtml(m.title)} [${escapeHtml(m.version)}]</h1>
                <p style="color:var(--text-dim);margin:0">mapped by ${escapeHtml(m.creator)} · ${m.difficulty_rating != null ? m.difficulty_rating.toFixed(2) + '★' : ''}</p>
            </div>
            <p class="coverage-note">${escapeHtml(data.note)} Sample size: ${data.sampleSize}, FC rate: ${data.sampleSize ? Math.round(100 * data.fcCount / data.sampleSize) : 0}%.</p>
            <div style="display:flex;gap:20px;flex-wrap:wrap">
                <div class="card" style="flex:1;min-width:200px">
                    <h2 style="margin-top:0">Grade distribution</h2>
                    <table><tbody>${gradeRows || '<tr><td class="empty-state">No data</td></tr>'}</tbody></table>
                </div>
                <div class="card" style="flex:1;min-width:200px">
                    <h2 style="margin-top:0">Mod usage</h2>
                    <table><tbody>${modRows || '<tr><td class="empty-state">No data</td></tr>'}</tbody></table>
                </div>
            </div>
            <h2>Tracked scores</h2>
            <table>
                <thead><tr><th>Player</th><th>Mods</th><th>Grade</th><th>Acc</th><th>pp</th><th>When</th></tr></thead>
                <tbody>${data.scores.map(s => `
                    <tr>
                        <td>${playerLink(s.user_id, s.username)}</td>
                        <td>${escapeHtml(formatMods(s.mods))}</td>
                        <td>${gradeBadge(s.rank)}${s.is_fc ? ' FC' : ''}</td>
                        <td>${fmtAccuracy(s.accuracy)}</td>
                        <td>${fmtPP(s.pp)}</td>
                        <td>${relTime(s.created_at)}</td>
                    </tr>`).join('') || '<tr><td colspan="6" class="empty-state">No scores</td></tr>'}</tbody>
            </table>
        `;
    } catch (err) {
        main.innerHTML = '<p class="empty-state">Failed to load map stats.</p>';
    }
}

loadMap();
