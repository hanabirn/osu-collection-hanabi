/* ===== Tab switching ===== */
function switchTab(tab, el) {
    document.querySelectorAll('.site-page').forEach(p => p.style.display = 'none');
    const page = document.getElementById('page-' + tab);
    page.style.display = 'block';
    // Force a reflow so removing+re-adding the class restarts the CSS
    // animation even when switching back to a tab that already has it.
    page.classList.remove('page-fade-in');
    void page.offsetWidth;
    page.classList.add('page-fade-in');
    document.querySelectorAll('.site-nav-btn').forEach(b => b.classList.remove('active'));
    if (el) {
        el.classList.add('active');
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
    if (tab === 'skins' && typeof renderSkinsList === 'function') renderSkinsList();
    if (tab === 'skins' && typeof renderCloudSkinsList === 'function') renderCloudSkinsList();
    if (tab === 'updates') { ensureUpdatesLoaded(); if (typeof renderTrackedMappersList === 'function') renderTrackedMappersList(); }
    if (tab === 'tournaments') ensureTournamentsLoaded();
    if (tab === 'public-collections') ensurePublicCollectionsLoaded();
    if (tab === 'farm-maps') ensureFarmMapsLoaded();
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
    if (typeof renderTrackButtonState === 'function') renderTrackButtonState();
    if (typeof renderTrackedPlayersList === 'function') renderTrackedPlayersList();
    if (typeof renderTrackedMappersList === 'function') renderTrackedMappersList();
    if (typeof renderNotificationBell === 'function') renderNotificationBell();
    if (typeof renderFarmMapsList === 'function') renderFarmMapsList();
}

/* ===== Init ===== */
document.addEventListener('DOMContentLoaded', () => {
    if (typeof renderStaticIcons === 'function') renderStaticIcons();
    applyLang(siteLang);
    initOsuBgCarousel();
    checkImportFromHash();
    checkOsuLoginFromUrl();
    if (typeof renderTrackedPlayersList === 'function') renderTrackedPlayersList();
    if (typeof initNotifications === 'function') initNotifications();
});
