/* ===== Side rails (desktop-only, >=1700px) =====
   The centered content column leaves big empty gutters on a wide monitor —
   rather than pure decoration there (the old .world-globe, removed), these
   two panels are compact previews of two existing tabs: 賽事 (left) and
   資源 (right). Both reuse that tab's own data/loader instead of duplicating
   it:
   - Tournaments: calls js/tournaments.js's own loadOsuTournaments() (skipped
     if already loaded) and its normalize-fn / current-items globals, so
     opening the real 賽事 tab afterward is instant rather than double-fetching.
   - Resources: js/resources-data.js's OSU_RESOURCES is already a plain
     array with no fetch involved, so this just re-renders a compact slice
     of it with the same .resource-link-card markup the full tab uses.
   Only loaded once the rails are actually visible (matchMedia-gated), so
   narrower viewports never pay for the tournaments fetch at all. See
   css/base.css .side-rail for the layout math that keeps both clear of the
   content column at any width. */
const SIDE_RAIL_MIN_WIDTH_MQ = window.matchMedia('(min-width: 1700px)');
const SIDE_RAIL_TOURNAMENTS_LIMIT = 7;
let sideRailsLoaded = false;

function initSideRails() {
    if (SIDE_RAIL_MIN_WIDTH_MQ.matches) loadSideRails();
    else SIDE_RAIL_MIN_WIDTH_MQ.addEventListener('change', function onFirstMatch(e) {
        if (!e.matches) return;
        loadSideRails();
        SIDE_RAIL_MIN_WIDTH_MQ.removeEventListener('change', onFirstMatch);
    });
}

function loadSideRails() {
    if (sideRailsLoaded) return;
    sideRailsLoaded = true;
    loadSideRailTournaments();
    renderSideRailResources();
}

async function loadSideRailTournaments() {
    const listEl = document.getElementById('side-rail-tournaments-list');
    if (!listEl) return;
    try {
        if (typeof osuTournamentsLoaded !== 'undefined' && !osuTournamentsLoaded && typeof loadOsuTournaments === 'function') {
            await loadOsuTournaments();
        }
        renderSideRailTournaments();
    } catch (e) {
        console.error('Side rail tournaments load failed:', e);
        listEl.innerHTML = `<p class="osu-empty">${t('updates_load_fail')}</p>`;
    }
}

function renderSideRailTournaments() {
    const listEl = document.getElementById('side-rail-tournaments-list');
    if (!listEl) return;
    if (typeof normalizeWybinTournament !== 'function' || typeof normalizeForumTopic !== 'function') return;

    const merged = [
        ...(osuWybinTournamentsCurrentItems || []).map(normalizeWybinTournament),
        ...(osuTournamentsCurrentItems || []).map(normalizeForumTopic),
    ]
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .slice(0, SIDE_RAIL_TOURNAMENTS_LIMIT);

    listEl.innerHTML = merged.length ? merged.map(item => `
        <a class="news-item" href="${item.url}" target="_blank" rel="noopener">
            ${item.thumb ? `<img class="news-thumb" src="${item.thumb}" alt="" loading="lazy" onerror="this.remove()">` : ''}
            <div class="news-item-body">
                <div class="news-item-header"><span class="news-date">${item.date}</span></div>
                <span class="news-title">${escapeHtmlOsu(item.title)}</span>
            </div>
        </a>`).join('') : `<p class="osu-empty">${t('updates_empty')}</p>`;
}

function renderSideRailResources() {
    const listEl = document.getElementById('side-rail-resources-list');
    if (!listEl || typeof OSU_RESOURCES === 'undefined') return;
    listEl.innerHTML = OSU_RESOURCES.map(r => `
        <a class="resource-link-card" href="${r.url}" target="_blank" rel="noopener noreferrer">
            <div class="resource-link-title">${escapeHtmlOsu(r.name)} ${icon('externalLink')}</div>
            <div class="resource-link-desc">${escapeHtmlOsu(t(r.descKey))}</div>
        </a>`).join('');
}
