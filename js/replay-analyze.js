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

    if (data.cursorHeatmap) {
        html += `
        <div class="pp-calc-section-label">${t('replay_heatmap_title')}</div>
        <canvas class="replay-heatmap-canvas" id="replay-heatmap-canvas"></canvas>
        <p class="replay-approx-note">${t('replay_heatmap_note')}</p>`;
    }

    resultEl.innerHTML = html;
    resultEl.style.display = 'block';

    if (data.cursorHeatmap) {
        const canvas = document.getElementById('replay-heatmap-canvas');
        renderCursorHeatmap(data, canvas);
    }
}

/* ===== Cursor heatmap =====
   Renders netlify/functions/replay-analyze.js's cursorHeatmap density grid
   (over osu!std's fixed 512x384 playfield) as a soft blurred heat overlay
   on top of the beatmap's cover art, plus X markers for missPositions —
   see that function's header comment for how both are derived. No canvas/
   heatmap library involved: this is the same technique heatmap.js itself
   uses (accumulate greyscale "dabs" whose alpha encodes density, then remap
   alpha -> color per pixel), just implemented directly since a CDN-free
   site can't pull one in. */
const HEATMAP_PLAYFIELD_W = 512, HEATMAP_PLAYFIELD_H = 384;
const HEATMAP_SCALE = 2; // supersampled so the canvas stays crisp on HiDPI screens once CSS scales it down
const HEATMAP_CANVAS_W = HEATMAP_PLAYFIELD_W * HEATMAP_SCALE;
const HEATMAP_CANVAS_H = HEATMAP_PLAYFIELD_H * HEATMAP_SCALE;

// Density -> color ramp (transparent -> blue -> green -> yellow -> red),
// the same progression most heatmap tools use so "red" reads as "hot"
// without needing a legend.
const HEATMAP_COLOR_STOPS = [
    [0.00, [0, 0, 0, 0]],
    [0.20, [37, 99, 235, 90]],
    [0.45, [16, 185, 129, 150]],
    [0.70, [250, 204, 21, 190]],
    [1.00, [239, 68, 68, 225]],
];
function heatmapColorFor(alpha) {
    for (let i = 1; i < HEATMAP_COLOR_STOPS.length; i++) {
        const [t0, c0] = HEATMAP_COLOR_STOPS[i - 1];
        const [t1, c1] = HEATMAP_COLOR_STOPS[i];
        if (alpha <= t1 || i === HEATMAP_COLOR_STOPS.length - 1) {
            const t = t1 === t0 ? 0 : (alpha - t0) / (t1 - t0);
            return c0.map((v, idx) => Math.round(v + (c1[idx] - v) * t));
        }
    }
    return HEATMAP_COLOR_STOPS[HEATMAP_COLOR_STOPS.length - 1][1];
}

function loadImageQuiet(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

async function renderCursorHeatmap(data, canvas) {
    const heat = data.cursorHeatmap;
    if (!heat || !canvas) return;

    canvas.width = HEATMAP_CANVAS_W;
    canvas.height = HEATMAP_CANVAS_H;
    const ctx = canvas.getContext('2d');

    // Background: the beatmap's cover art stretched to the fixed 512x384
    // playfield box — an approximation of the real in-game crop/position,
    // just enough to orient the heatmap. Loaded without a CORS attribute
    // (assets.ppy.sh doesn't need to send CORS headers for that to work,
    // since drawImage alone never taints anything this file reads pixels
    // back from — see the heat layer below).
    ctx.fillStyle = '#0a0612';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const setId = data.beatmap && data.beatmap.beatmapsetId;
    if (setId) {
        const img = await loadImageQuiet(`https://assets.ppy.sh/beatmaps/${setId}/covers/cover.jpg`);
        if (img) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
    ctx.fillStyle = 'rgba(10,6,18,0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Heat layer lives on its own offscreen canvas that the cover image
    // above never touches, so getImageData below can't hit a tainted-canvas
    // SecurityError regardless of that image's own CORS headers.
    const heatCanvas = document.createElement('canvas');
    heatCanvas.width = canvas.width;
    heatCanvas.height = canvas.height;
    const heatCtx = heatCanvas.getContext('2d');
    const cellW = canvas.width / heat.w;
    const cellH = canvas.height / heat.h;
    // Wider than one grid cell on purpose — neighboring dabs need to
    // overlap for the result to read as smooth blobs instead of a grid of
    // discrete dots.
    const radius = Math.max(cellW, cellH) * 1.6;
    const maxCount = Math.max(1, ...heat.grid);
    for (let gy = 0; gy < heat.h; gy++) {
        for (let gx = 0; gx < heat.w; gx++) {
            const count = heat.grid[gy * heat.w + gx];
            if (!count) continue;
            const alpha = Math.min(1, count / maxCount);
            const cx = (gx + 0.5) * cellW;
            const cy = (gy + 0.5) * cellH;
            const grad = heatCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
            grad.addColorStop(0, `rgba(0,0,0,${(0.15 + alpha * 0.55).toFixed(3)})`);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            heatCtx.fillStyle = grad;
            heatCtx.beginPath();
            heatCtx.arc(cx, cy, radius, 0, Math.PI * 2);
            heatCtx.fill();
        }
    }

    const imgData = heatCtx.getImageData(0, 0, heatCanvas.width, heatCanvas.height);
    const px = imgData.data;
    for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3] / 255;
        if (a <= 0.02) { px[i + 3] = 0; continue; }
        const [r, g, b, outA] = heatmapColorFor(a);
        px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = outA;
    }
    heatCtx.putImageData(imgData, 0, 0);
    ctx.drawImage(heatCanvas, 0, 0);

    // Miss markers on top, mapped from osu!pixel coordinates into canvas space.
    ctx.strokeStyle = '#ff5252';
    ctx.lineWidth = 2.5 * HEATMAP_SCALE;
    for (const m of (data.missPositions || [])) {
        const x = (m.x / HEATMAP_PLAYFIELD_W) * canvas.width;
        const y = (m.y / HEATMAP_PLAYFIELD_H) * canvas.height;
        const r = 6 * HEATMAP_SCALE;
        ctx.beginPath();
        ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
        ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
        ctx.stroke();
    }
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
