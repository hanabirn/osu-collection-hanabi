/* ===== Replay Analyzer =====
   Uploads a .osr file (base64 JSON body, reusing blobToBase64 from
   js/skins.js) to netlify/functions/replay-analyze.js and renders the score
   summary plus the approximate hit-timing histogram it returns. See that
   function's header comment for what "approximate" means here and why —
   this is a from-scratch replacement for the old o!rdr-backed Replay 錄影
   tab, not a revival of it (no video, no third-party render service, so no
   expiring-link problem to repeat). */

function handleReplayDrop(event) {
    event.preventDefault();
    const zone = document.getElementById('replay-upload-zone');
    if (zone) zone.classList.remove('dragover');
    const files = event.dataTransfer && event.dataTransfer.files;
    if (files && files.length) handleReplayFileSelected(files);
}

async function handleReplayFileSelected(files) {
    if (!files || !files.length) return;
    const file = files[0];
    const status = document.getElementById('replay-analyze-status');
    const resultEl = document.getElementById('replay-analyze-result');
    if (!status || !resultEl) return;

    resultEl.style.display = 'none';
    resultEl.innerHTML = '';
    status.innerText = t('replay_analyzing');
    status.style.color = '#f9a8d4';

    try {
        const dataBase64 = await blobToBase64(file);
        const res = await fetch('/.netlify/functions/replay-analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataBase64 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'analyze failed');
        status.innerText = '';
        renderReplayAnalysis(data);
    } catch (e) {
        console.error('Replay analysis failed:', e);
        status.innerText = `${t('replay_analyze_fail')}${e.message ? ' (' + e.message + ')' : ''}`;
        status.style.color = '#ff5252';
    } finally {
        // Cleared so re-uploading the exact same filename fires onchange again.
        const input = document.getElementById('replay-file-input');
        if (input) input.value = '';
    }
}

function replayStatTile(label, value) {
    return `<div class="osu-stat"><div class="osu-stat-value">${value}</div><div class="osu-stat-label">${label}</div></div>`;
}

function renderReplayAnalysis(data) {
    const resultEl = document.getElementById('replay-analyze-result');
    if (!resultEl) return;

    let html = '<div class="pp-calc-result">';
    html += replayStatTile(t('replay_stat_player'), escapeHtmlOsu(data.player || '—'));
    html += replayStatTile(t('replay_stat_rank'), escapeHtmlOsu(data.rank || '—'));
    html += replayStatTile(t('replay_stat_accuracy'), data.accuracy != null ? data.accuracy.toFixed(2) + '%' : '—');
    html += replayStatTile(t('replay_stat_combo'), data.maxCombo != null ? data.maxCombo.toLocaleString() + 'x' : '—');
    html += replayStatTile(t('replay_stat_misses'), data.counts ? data.counts.miss.toLocaleString() : '—');
    html += replayStatTile(t('replay_stat_mods'), data.mods && data.mods.length ? escapeHtmlOsu(data.mods.join('')) : 'NM');
    html += '</div>';

    if (data.beatmap) {
        const b = data.beatmap;
        html += `
        <div class="replay-beatmap-card">
            <div class="replay-beatmap-title">${escapeHtmlOsu(b.title || '')} <span class="farm-card-version">[${escapeHtmlOsu(b.version || '')}]</span></div>
            <div class="replay-beatmap-artist">${escapeHtmlOsu(b.artist || '')}</div>
            <div class="replay-beatmap-meta">
                <span>${(b.star || 0).toFixed(2)}⭐</span>
                <span class="replay-recalc-pp">${t('replay_recalculated_pp_label')}: ${Math.round(b.pp || 0)}pp</span>
            </div>
        </div>`;
    } else {
        html += `<p class="osu-empty">${t('replay_no_beatmap_match')}</p>`;
    }

    if (data.hitErrors && data.hitErrors.length) {
        html += `
        <div class="pp-calc-section-label">${t('replay_hit_error_title')}</div>
        <div class="trend-chart-wrap">${hitErrorChartSvg(data.hitErrors)}</div>
        <p class="replay-approx-note">${t('replay_approx_note')}</p>`;
    } else {
        html += `<p class="osu-empty">${t('replay_hit_error_unsupported')}</p>`;
    }

    resultEl.innerHTML = html;
    resultEl.style.display = 'block';
}

/* Histogram of hit-timing deltas (ms) centered on zero — a scatter/area
   fill like strainChartSvg's would read oddly here since these values
   straddle zero rather than accumulating upward, so bars around a zero
   line (osu!'s own "unstable rate" style display) fit the data better. */
function hitErrorChartSvg(errors) {
    const width = 600, height = 140;
    const padL = 10, padR = 10, padT = 10, padB = 20;
    const innerW = width - padL - padR;
    const innerH = height - padT - padB;

    const RANGE = 150; // ms; outliers beyond this clip into the edge bins
    const BIN_MS = 10;
    const binCount = Math.round((RANGE * 2) / BIN_MS);
    const bins = new Array(binCount).fill(0);
    for (const e of errors) {
        const clamped = Math.max(-RANGE, Math.min(RANGE - 1, e));
        const idx = Math.min(binCount - 1, Math.floor((clamped + RANGE) / BIN_MS));
        bins[idx]++;
    }
    const maxCount = Math.max(1, ...bins);
    const barW = innerW / binCount;

    const bars = bins.map((count, i) => {
        if (!count) return '';
        const h = (count / maxCount) * innerH;
        const x = padL + i * barW;
        const y = padT + innerH - h;
        return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${Math.max(0, barW - 1).toFixed(2)}" height="${h.toFixed(2)}" class="hit-error-bar" />`;
    }).join('');

    const zeroX = padL + innerW / 2;
    const zeroLine = `<line x1="${zeroX}" y1="${padT}" x2="${zeroX}" y2="${padT + innerH}" class="hit-error-zero-line" />`;
    const baseline = `<line x1="${padL}" y1="${padT + innerH}" x2="${padL + innerW}" y2="${padT + innerH}" class="trend-chart-grid" />`;
    const labels = `
        <text x="${padL}" y="${height - 4}" text-anchor="start" class="trend-chart-axis-label">-${RANGE}ms</text>
        <text x="${zeroX}" y="${height - 4}" text-anchor="middle" class="trend-chart-axis-label">0</text>
        <text x="${padL + innerW}" y="${height - 4}" text-anchor="end" class="trend-chart-axis-label">+${RANGE}ms</text>`;

    return `<svg viewBox="0 0 ${width} ${height}" class="hit-error-chart-svg" preserveAspectRatio="none">
        ${bars}${zeroLine}${baseline}${labels}
    </svg>`;
}
