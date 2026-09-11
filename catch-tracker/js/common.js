/* Small shared helpers: grade badge rendering, mod formatting, relative
   time, HTML escaping. This is a plain-HTML companion site (see the
   implementation plan for why it doesn't reuse the main site's i18n/theming
   machinery), so no locale system here — just English strings. */

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

const GRADE_COLORS = {
    XH: '#e0e0e0', X: '#ffd966', SH: '#e0e0e0', S: '#ffd966',
    A: '#8ee08e', B: '#7fb8ff', C: '#e0a0ff', D: '#ff8a8a',
};

function gradeBadge(grade) {
    const g = grade || '?';
    const color = GRADE_COLORS[g] || '#999';
    return `<span class="grade-badge" style="--grade-color:${color}">${escapeHtml(g)}</span>`;
}

function formatMods(mods) {
    if (!mods || mods.length === 0) return 'NM';
    return mods.join(',');
}

function relTime(iso) {
    if (!iso) return '—';
    const diffMs = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diffMs)) return '—';
    const sec = Math.max(0, Math.floor(diffMs / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `${day}d ago`;
}

function fmtPP(pp) {
    return pp != null ? `${Math.round(pp)}pp` : '—';
}

function fmtAccuracy(acc) {
    return acc != null ? `${(acc * 100).toFixed(2)}%` : '—';
}

function playerLink(userId, username) {
    return `<a class="player-link" href="player.html?id=${encodeURIComponent(userId)}">${escapeHtml(username || userId)}</a>`;
}

function mapLink(beatmapId, label) {
    return `<a class="map-link" href="map.html?id=${encodeURIComponent(beatmapId)}">${escapeHtml(label)}</a>`;
}
