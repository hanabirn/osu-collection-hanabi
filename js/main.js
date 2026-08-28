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
    if (tab === 'updates') ensureUpdatesLoaded();
    if (tab === 'mapper-tracking' && typeof renderTrackedMappersList === 'function') renderTrackedMappersList();
    if (tab === 'tournaments') ensureTournamentsLoaded();
    if (tab === 'public-collections') ensurePublicCollectionsLoaded();
    if (tab === 'farm-maps') ensureFarmMapsLoaded();
    if (tab === 'skin-screenshots') ensureSkinScreenshotsLoaded();
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

/* ===== ✉️ Contact info dropdown ===== (same open/outside-click/Escape
   pattern as the language dropdown above) */
function toggleContactMenu(forceOpen) {
    const wrap = document.getElementById('contact-info');
    const btn = document.getElementById('contact-info-btn');
    const header = document.querySelector('.site-header');
    if (!wrap || !btn) return;
    const open = typeof forceOpen === 'boolean' ? forceOpen : !wrap.classList.contains('open');
    wrap.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    if (header) header.classList.toggle('contact-menu-open', open);
    if (open) {
        document.addEventListener('click', onContactMenuOutsideClick);
        document.addEventListener('keydown', onContactMenuEscape);
    } else {
        document.removeEventListener('click', onContactMenuOutsideClick);
        document.removeEventListener('keydown', onContactMenuEscape);
    }
}
function onContactMenuOutsideClick(e) {
    if (!e.target.closest('#contact-info')) toggleContactMenu(false);
}
function onContactMenuEscape(e) {
    if (e.key === 'Escape') toggleContactMenu(false);
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
