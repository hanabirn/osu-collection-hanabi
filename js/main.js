/* ===== Tab switching ===== */
function switchTab(tab, el) {
    document.querySelectorAll('.site-page').forEach(p => p.style.display = 'none');
    document.getElementById('page-' + tab).style.display = 'block';
    document.querySelectorAll('.site-nav-btn').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
}

/* ===== Re-render already-rendered dynamic content after a language switch =====
   The collection grid bakes t()-driven strings (mapped_by, empty-state text)
   into its innerHTML at render time, so a language switch needs a re-render
   to pick up the new strings — same reasoning as the main site's
   refreshDynamicContent() for quiz content. */
function refreshDynamicContent() {
    renderOsuCollection();
    renderPpHistoryChart();
    const activeModeTab = document.querySelector('#osu-mode-tabs .osu-mode-tab.active');
    if (activeModeTab) renderOsuModeStats(parseInt(activeModeTab.dataset.mode));
}

/* ===== Init ===== */
document.addEventListener('DOMContentLoaded', () => {
    applyLang(siteLang);
    fetchOsuProfile();
    initOsuBgCarousel();
});
