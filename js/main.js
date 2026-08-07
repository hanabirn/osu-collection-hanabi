/* ===== Tab switching ===== */
function switchTab(tab, el) {
    document.querySelectorAll('.site-page').forEach(p => p.style.display = 'none');
    document.getElementById('page-' + tab).style.display = 'block';
    document.querySelectorAll('.site-nav-btn').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    if (tab === 'skins' && typeof renderSkinsList === 'function') renderSkinsList();
    if (tab === 'updates') ensureUpdatesLoaded();
    if (tab === 'tournaments') ensureTournamentsLoaded();
    if (tab === 'public-collections') ensurePublicCollectionsLoaded();
}

/* ===== 🌐 Language Dropdown ===== */
function toggleLangMenu(forceOpen) {
    const wrap = document.getElementById('lang-globe');
    const btn = document.getElementById('lang-globe-btn');
    const header = document.querySelector('.site-header');
    if (!wrap || !btn) return;
    const open = typeof forceOpen === 'boolean' ? forceOpen : !wrap.classList.contains('open');
    wrap.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    if (header) header.classList.toggle('lang-menu-open', open);
    if (open) {
        document.addEventListener('click', onLangMenuOutsideClick);
        document.addEventListener('keydown', onLangMenuEscape);
    } else {
        document.removeEventListener('click', onLangMenuOutsideClick);
        document.removeEventListener('keydown', onLangMenuEscape);
    }
}
function onLangMenuOutsideClick(e) {
    if (!e.target.closest('#lang-globe')) toggleLangMenu(false);
}
function onLangMenuEscape(e) {
    if (e.key === 'Escape') toggleLangMenu(false);
}

/* ===== Re-render already-rendered dynamic content after a language switch =====
   The collection grid bakes t()-driven strings (mapped_by, empty-state text)
   into its innerHTML at render time, so a language switch needs a re-render
   to pick up the new strings — same reasoning as the main site's
   refreshDynamicContent() for quiz content. */
function refreshDynamicContent() {
    renderOsuCollection();
    if (visitorLookupUserId) renderPpHistoryChart(null, ppHistoryKeyFor(visitorLookupUserId), 'visitor-pp-history-panel');
    if (typeof renderSkinsList === 'function') renderSkinsList();
    if (typeof renderReplayHistory === 'function') renderReplayHistory();
    if (typeof renderPublicCollectionsList === 'function') renderPublicCollectionsList();
    if (typeof updatePublishButtonLabel === 'function') updatePublishButtonLabel();
}

/* ===== Init ===== */
document.addEventListener('DOMContentLoaded', () => {
    applyLang(siteLang);
    initOsuBgCarousel();
    checkImportFromHash();
    checkOsuLoginFromUrl();
});
