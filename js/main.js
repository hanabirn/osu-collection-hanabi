/* ===== Maintenance banner =====
   Manual on/off switch for a site-wide "we're mid-change" notice — flip
   MAINTENANCE_BANNER_ENABLED to true and redeploy to show it, flip back to
   false when done. A visitor who closes it won't see it again (tracked in
   localStorage, not sessionStorage — the point is not re-nagging them on
   their next visit, not just for the rest of this tab). The key has a
   version suffix so a *new* maintenance notice later can reset everyone's
   dismissal just by bumping it, without needing new code elsewhere. */
const MAINTENANCE_BANNER_ENABLED = false;
const MAINTENANCE_BANNER_DISMISSED_KEY = 'maintenance_banner_dismissed_v1';

function initMaintenanceBanner() {
    if (!MAINTENANCE_BANNER_ENABLED) return;
    if (localStorage.getItem(MAINTENANCE_BANNER_DISMISSED_KEY) === '1') return;
    const banner = document.getElementById('maintenance-banner');
    if (banner) banner.style.display = 'flex';
}

function dismissMaintenanceBanner() {
    localStorage.setItem(MAINTENANCE_BANNER_DISMISSED_KEY, '1');
    const banner = document.getElementById('maintenance-banner');
    if (banner) banner.style.display = 'none';
}

/* ===== Sections =====
   Sixteen pages grouped into five sections plus 更多, after osu-web: the
   slim header picks a section, the section band under it picks a page.
   A sub-tab with `choices` covers two pages that do the same job (世界盃 /
   社群 pools, skin screenshots / my skins); the band shows a switch between
   them. Pages keep their own ids, so switchTab() and every deep link work
   as before. */
const SITE_SECTIONS = [
    { id: 'home', label: 'nav_home', tabs: [{ tab: 'home', label: 'nav_home' }] },
    // 統計 and 工具 open things rather than pages: an `action` runs instead of switching.
    { id: 'collection', label: 'nav_collection', tabs: [
        { tab: 'collection', label: 'nav_my_collection' },
        { action: 'openStatsDashboardModal()', label: 'col_stats' },
        { action: 'openCollectionToolsMenu()', label: 'col_tools' },
    ] },
    { id: 'explore', label: 'nav_explore', tabs: [
        { tab: 'catalog', label: 'nav_catalog' },
        { tab: 'public-collections', label: 'nav_public_collections' },
        { tab: 'mappools', label: 'nav_pools', choices: [['mappools', 'nav_pools_wc'], ['cmpool', 'nav_pools_community']] },
        { tab: 'skin-screenshots', label: 'nav_skins', choices: [['skin-screenshots', 'nav_skin_screenshots'], ['skins', 'nav_my_skins']] },
    ] },
    { id: 'player', label: 'nav_player', tabs: [{ tab: 'lookup', label: 'nav_lookup' }, { tab: 'tournaments', label: 'nav_tournaments' }] },
    // 私訊 lives inside the chat page's sidebar now (switchTab maps 'dm' to 'chat').
    { id: 'community', label: 'nav_community', tabs: [{ tab: 'chat', label: 'nav_chat' }, { action: 'focusDiscordCard()', label: 'discord_bot_title' }] },
    { id: 'more', label: 'nav_more', tabs: [
        { tab: 'howto', label: 'nav_howto' }, { tab: 'updates', label: 'nav_updates' }, { tab: 'resources', label: 'nav_resources' },
        { tab: 'bbcode', label: 'nav_bbcode' }, { tab: 'feedback', label: 'nav_feedback' },
    ] },
];
const lastTabInSection = {};
let currentSiteTab = null;
/* Labels come from t(), so a language switch redraws the band (js/i18n.js applyLang). */
function refreshSectionBand() { if (currentSiteTab) renderSectionBand(currentSiteTab); }

function sectionOfTab(tab) {
    for (const sec of SITE_SECTIONS) {
        for (const st of sec.tabs) {
            if (st.tab && (st.tab === tab || (st.choices && st.choices.some(([c]) => c === tab)))) return { sec, st };
        }
    }
    return { sec: SITE_SECTIONS[0], st: SITE_SECTIONS[0].tabs[0] };
}

function goSection(id) {
    const sec = SITE_SECTIONS.find((s) => s.id === id) || SITE_SECTIONS[0];
    switchTab(lastTabInSection[id] || sec.tabs.find((x) => x.tab).tab);
}

function renderSectionBand(tab) {
    const { sec, st } = sectionOfTab(tab);
    currentSiteTab = tab;
    lastTabInSection[sec.id] = tab;
    document.documentElement.dataset.siteSection = sec.id;
    document.querySelectorAll('#site-nav .site-nav-sec').forEach((b) => {
        const on = b.dataset.section === sec.id;
        b.classList.toggle('active', on);
        if (on) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
    });
    const title = document.getElementById('section-band-title');
    const tabs = document.getElementById('section-band-tabs');
    const extra = document.getElementById('section-band-extra');
    if (!title || !tabs || !extra) return;
    title.textContent = t(sec.label);
    tabs.innerHTML = sec.tabs.length > 1
        ? sec.tabs.map((x) => {
            const on = x === st;
            const run = x.action || `switchTab('${x.tab}')`;
            return `<button type="button" class="section-band-tab${on ? ' active' : ''}"${on ? ' aria-current="page"' : ''} onclick="${run}">${escHtml(t(x.label))}</button>`;
        }).join('')
        : '';
    // 收藏's numbers and difficulty spread sit in the band (#osu-stats-panel is
    // moved, not copied, so renderOsuStats() keeps updating it); park the
    // panel in its hero again before the band is redrawn for another section.
    const stats = document.getElementById('osu-stats-panel');
    const statsHome = document.getElementById('collection-hero-v2');
    if (stats && statsHome && stats.parentElement === extra) statsHome.appendChild(stats);
    extra.innerHTML = st.choices
        ? `<div class="section-band-choice" role="group" aria-label="${escHtml(t(st.label))}">${st.choices.map(([c, label]) =>
            `<button type="button"${c === tab ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"'} onclick="switchTab('${c}')">${escHtml(t(label))}</button>`).join('')}</div>`
        : '';
    if (sec.id === 'collection' && stats) extra.appendChild(stats);
}

/* ===== 社群 ===== */
/* The bot's invite link (Discord Developer Portal > the app > OAuth2 >
   URL Generator, scope bot + applications.commands). Empty: the button stays
   hidden rather than pointing somewhere wrong. */
const DISCORD_BOT_INVITE_URL = '';
function setupDiscordInvite() {
    const a = document.getElementById('discord-invite-btn');
    if (!a || !DISCORD_BOT_INVITE_URL.startsWith('https://discord.com/')) return;
    a.href = DISCORD_BOT_INVITE_URL;
    a.hidden = false;
}
function focusDiscordCard() {
    const card = document.getElementById('community-discord');
    if (!card) return;
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 1200);
}
/* 「# 聊天室」 in the sidebar: leave any open private thread for the public room. */
function openPublicChat() {
    if (typeof dmView !== 'undefined' && dmView === 'thread' && typeof closeDmThread === 'function') closeDmThread();
    document.getElementById('chat-input')?.focus();
}

/* 工具 in the 收藏 band: open the collection panel's tools menu. */
function openCollectionToolsMenu() {
    const d = document.querySelector('details.collection-tools');
    if (!d) return;
    // After this click has finished bubbling: the menu closes on clicks outside it.
    setTimeout(() => {
        d.open = true;
        d.querySelector('summary')?.focus();
        d.scrollIntoView({ block: 'nearest' });
    }, 0);
}

/* ===== Tab switching ===== */
function switchTab(tab, el) {
    // 私訊 was its own page; its list and threads now sit in 社群's chat page.
    if (tab === 'dm') tab = 'chat';
    document.querySelectorAll('.site-page').forEach(p => p.style.display = 'none');
    const page = document.getElementById('page-' + tab);
    page.style.display = 'block';
    // Force a reflow so removing+re-adding the class restarts the CSS
    // animation even when switching back to a tab that already has it.
    page.classList.remove('page-fade-in');
    void page.offsetWidth;
    page.classList.add('page-fade-in');
    document.querySelectorAll('.site-nav-btn').forEach(b => b.classList.remove('active'));
    // Drawer (phone nav): highlight this page's button however the tab was
    // switched (header, band, explore card, deep link, ...).
    document.querySelectorAll('.site-nav-btn').forEach((b) => {
        if ((b.getAttribute('onclick') || '').includes(`switchTab('${tab}'`)) b.classList.add('active');
    });
    if (el && el.classList.contains('site-nav-btn')) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    // Header section + band of sub-tabs.
    renderSectionBand(tab);
    // Section hue (css/theme.css [data-section]): each area tints the shell
    // its own colour, the way osu-web does per section.
    document.documentElement.dataset.section = tab;
    if (tab === 'home' && typeof ensureHomeLoaded === 'function') ensureHomeLoaded();
    if (tab === 'skins' && typeof renderSkinsList === 'function') renderSkinsList();
    if (tab === 'skins' && typeof renderCloudSkinsList === 'function') renderCloudSkinsList();
    if (tab === 'updates') ensureUpdatesLoaded();
    if (tab === 'tournaments') ensureTournamentsLoaded();
    if (tab === 'public-collections') ensurePublicCollectionsLoaded();
    if (tab === 'catalog') ensureCatalogLoaded();
    if (tab === 'mappools' && typeof ensureMappoolsLoaded === 'function') ensureMappoolsLoaded();
    if (tab === 'cmpool' && typeof ensureCmpoolLoaded === 'function') ensureCmpoolLoaded();
    if (tab === 'skin-screenshots') ensureSkinScreenshotsLoaded();
    // Chat polls on a timer only while its own tab is visible — started/
    // stopped here on every tab switch (not just the lazy first-load other
    // ensureXLoaded() calls do) since leaving and returning to the tab
    // should resume polling, not just load once per session.
    if (tab === 'chat' && typeof ensureChatLoaded === 'function') ensureChatLoaded();
    if (tab !== 'chat' && typeof stopChatPolling === 'function') stopChatPolling();
    // Same start/stop-on-tab-switch reasoning as chat above — dm.js decides
    // internally whether that means polling the conversation list or an
    // open thread.
    if (tab === 'chat' && typeof ensureDmLoaded === 'function') ensureDmLoaded();
    if (tab !== 'chat' && typeof stopDmPolling === 'function') stopDmPolling();
    // Tab buttons now live in the slide-in drawer — picking one should also
    // dismiss it.
    if (typeof closeNavDrawer === 'function') closeNavDrawer();
}

/* ===== ☰ Navigation drawer =====
   The 12 tab buttons moved out of the old horizontal .site-nav bar into a
   right-side slide-in drawer (#nav-drawer + #nav-drawer-scrim in
   index.html, styling in css/base.css). Open/close mirror the language
   dropdown's outside-click / Escape pattern below; the panel starts
   [hidden] (display:none) and the .open class drives the CSS transform
   transition, so the class add has to land a frame after `hidden` is
   cleared or there's nothing to animate from. On close we wait for the
   slide-out transition before re-hiding (with a timeout backstop for
   prefers-reduced-motion, where the transition is suppressed and
   `transitionend` never fires). */
function openNavDrawer() {
    const drawer = document.getElementById('nav-drawer');
    const scrim = document.getElementById('nav-drawer-scrim');
    const btn = document.getElementById('nav-menu-btn');
    if (!drawer || !scrim) return;
    drawer.hidden = false;
    scrim.hidden = false;
    requestAnimationFrame(() => {
        drawer.classList.add('open');
        scrim.classList.add('open');
    });
    if (btn) btn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onNavDrawerEscape);
    drawer.querySelector('.site-nav-btn')?.focus();
}
function closeNavDrawer() {
    const drawer = document.getElementById('nav-drawer');
    const scrim = document.getElementById('nav-drawer-scrim');
    const btn = document.getElementById('nav-menu-btn');
    if (!drawer || !scrim || drawer.hidden) return;
    drawer.classList.remove('open');
    scrim.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onNavDrawerEscape);
    let done = false;
    const hide = () => {
        if (done) return;
        done = true;
        drawer.hidden = true;
        scrim.hidden = true;
        drawer.removeEventListener('transitionend', hide);
    };
    drawer.addEventListener('transitionend', hide);
    setTimeout(hide, 400);
    if (btn) btn.focus();
}
function onNavDrawerEscape(e) {
    if (e.key === 'Escape') closeNavDrawer();
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

/* ===== ✨ Changelog dropdown ===== (same open/outside-click/Escape pattern
   as the language/contact dropdowns above). Content is the manually
   maintained SITE_CHANGELOG list — see js/site-changelog-data.js. */
function toggleChangelogMenu(forceOpen) {
    const wrap = document.getElementById('site-changelog');
    const btn = document.getElementById('site-changelog-btn');
    const header = document.querySelector('.site-header');
    if (!wrap || !btn) return;
    const open = typeof forceOpen === 'boolean' ? forceOpen : !wrap.classList.contains('open');
    wrap.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    if (header) header.classList.toggle('changelog-menu-open', open);
    if (open) {
        document.addEventListener('click', onChangelogMenuOutsideClick);
        document.addEventListener('keydown', onChangelogMenuEscape);
    } else {
        document.removeEventListener('click', onChangelogMenuOutsideClick);
        document.removeEventListener('keydown', onChangelogMenuEscape);
    }
}
function onChangelogMenuOutsideClick(e) {
    if (!e.target.closest('#site-changelog')) toggleChangelogMenu(false);
}
function onChangelogMenuEscape(e) {
    if (e.key === 'Escape') toggleChangelogMenu(false);
}
/* Items are { lang: text } (see site-changelog-data.js); plain strings are
   shown as-is. */
function changelogItemText(item) {
    if (typeof item === 'string') return item;
    return item[siteLang] || item.en || item.zh || '';
}
function renderChangelogMenu() {
    const menu = document.getElementById('site-changelog-menu');
    if (!menu) return;
    const entries = typeof SITE_CHANGELOG !== 'undefined' ? SITE_CHANGELOG : [];
    if (!entries.length) {
        menu.innerHTML = `<div class="changelog-empty">${escHtml(t('site_changelog_title'))}</div>`;
        return;
    }
    menu.innerHTML = entries.map(entry => `
        <div class="changelog-entry">
            <div class="changelog-entry-date">${escHtml(entry.date)}</div>
            <ul class="changelog-entry-list">
                ${entry.items.map(item => `<li>${escHtml(changelogItemText(item))}</li>`).join('')}
            </ul>
        </div>`).join('');
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
    if (typeof renderResourcesList === 'function') renderResourcesList();
    if (typeof renderNotificationBell === 'function') renderNotificationBell();
    if (typeof renderFarmMapsList === 'function') renderFarmMapsList();
    if (typeof refreshCatalogLocalized === 'function') refreshCatalogLocalized();
    if (typeof refreshMappoolsLocalized === 'function') refreshMappoolsLocalized();
    if (typeof refreshGamesLocalized === 'function') refreshGamesLocalized();
    if (typeof refreshTrendingLocalized === 'function') refreshTrendingLocalized();
    if (typeof renderChangelogMenu === 'function') renderChangelogMenu();
}

/* ===== Keyboard shortcuts =====
   `/` or Ctrl/Cmd+K opens the global search (js/global-search.js) from
   anywhere, like GitHub/Slack/Notion's own search shortcut — a plain
   document-level keydown listener, since there's nothing else on the page
   competing for either binding. Ignored while typing in any input/
   textarea/select/contenteditable (so `/` still types a literal slash in,
   say, a chat message or the collection search box) and while a modal is
   already open (its own Escape handler already owns the keyboard then). */
function onGlobalShortcutKeydown(e) {
    const isSlash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey;
    const isCtrlK = e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey) && !e.altKey;
    if (!isSlash && !isCtrlK) return;

    const target = e.target;
    const tag = target && target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable)) return;
    if (document.querySelector('.pp-calc-modal-overlay[style*="flex"]')) return;

    e.preventDefault();
    if (typeof openGlobalSearch === 'function') openGlobalSearch();
}

/* Escape closes an open .pp-calc-modal-overlay dialog by clicking its own
   ✕, so each dialog's close function runs (and resets whatever it resets)
   exactly as it would from the button. The global search overlay has its
   own Escape handler in js/global-search.js and is left to it. With two
   dialogs stacked, only the later one in the DOM (the one on top) closes. */
function onModalEscapeKeydown(e) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const open = [...document.querySelectorAll('.pp-calc-modal-overlay')]
        .filter(m => m.id !== 'global-search-modal' && m.style.display === 'flex');
    const close = open.length ? open[open.length - 1].querySelector('.pp-calc-close') : null;
    if (!close) return;
    e.preventDefault();
    close.click();
}

/* ===== Keyboard access for clickable cards =====
   Several card templates (beatmap cards on 收藏 / 曲庫 / 圖池, gallery
   cards and tags, tracked players, per-difficulty icons) are <div>/<span>
   with an onclick, which Tab never reaches. Rather than rewrite each
   template, every such element that appears gets tabindex, a role and a
   short name, and Enter (Space too, for buttons) clicks it. Cards that open
   an osu! page are links; the rest act in place, so they are buttons. */
const CLICKABLE_CARDS = [
    { sel: '.osu-card[onclick]', role: 'link', name: (el) => [el.querySelector('.osu-card-title'), el.querySelector('.osu-card-artist')].map((n) => n && n.textContent.trim()).filter(Boolean).join(' - ') },
    { sel: '.mode-diff-icon[onclick]', role: 'link', name: (el) => el.getAttribute('title') || '' },
    { sel: '.public-collection-card[onclick]', role: 'button', name: (el) => (el.querySelector('.pcc-name')?.textContent || '').trim() },
    { sel: '.pcc-tag[onclick]', role: 'button', name: (el) => el.textContent.trim() },
    { sel: '.tracked-player-card[onclick]', role: 'button', name: (el) => el.textContent.trim().split(/\s+/)[0] || '' },
];
const CLICKABLE_SEL = CLICKABLE_CARDS.map((c) => c.sel).join(',');
function makeCardsFocusable(root) {
    if (!root || root.nodeType !== 1) return;
    const found = root.matches(CLICKABLE_SEL) ? [root] : [];
    found.push(...root.querySelectorAll(CLICKABLE_SEL));
    for (const el of found) {
        if (el.hasAttribute('tabindex')) continue;
        const spec = CLICKABLE_CARDS.find((c) => el.matches(c.sel));
        el.tabIndex = 0;
        el.setAttribute('role', spec.role);
        const name = spec.name(el);
        if (name && !el.hasAttribute('aria-label')) el.setAttribute('aria-label', name);
    }
}
document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (!(el instanceof Element) || !el.matches(CLICKABLE_SEL)) return;
    const isButton = el.getAttribute('role') === 'button';
    if (e.key === 'Enter' || (isButton && e.key === ' ')) {
        e.preventDefault();
        el.click();
    }
});
new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach(makeCardsFocusable);
}).observe(document.documentElement, { childList: true, subtree: true });

/* ===== File pickers =====
   A visible <input type="file"> renders the browser's own "Choose File / No
   file chosen", in the browser's language and unstyled. Each one gets the
   site's button (a <label> for it) and a line naming the chosen file; the
   input itself stays, visually hidden but focusable, so its onchange and
   keyboard use are unchanged. Inputs the page already hides (opened from
   another button) are left alone. */
function styleFilePickers() {
    document.querySelectorAll('input[type="file"]').forEach((input) => {
        if (input.hidden || input.style.display === 'none' || input.dataset.picker || !input.id) return;
        input.dataset.picker = '1';
        input.classList.add('file-native');
        const label = document.createElement('label');
        label.htmlFor = input.id;
        label.className = 'btn file-pick-btn';
        // Say what the input takes, so two pickers on one form don't read alike.
        const accept = (input.accept || '').toLowerCase();
        const key = accept.startsWith('image/') ? 'file_pick_image' : accept === '.osk' ? 'file_pick_osk' : accept === '.db' ? 'file_pick_db' : 'file_pick_btn';
        label.dataset.i18n = key;
        label.textContent = t(key);
        const name = document.createElement('span');
        name.className = 'file-pick-name';
        name.setAttribute('aria-live', 'polite');
        const update = () => {
            const n = input.files ? input.files.length : 0;
            name.textContent = n === 0 ? t('file_pick_none') : n === 1 ? input.files[0].name : t('file_pick_many', { n });
            // Only the empty state is a fixed string, so only it follows a language switch.
            if (n === 0) name.dataset.i18n = 'file_pick_none';
            else delete name.dataset.i18n;
        };
        input.addEventListener('change', update);
        update();
        input.after(label, name);
    });
}

/* ===== 回到頂端 =====
   For the long pages (賽事 ~4500px, 更新內容, 手冊, 圖池): a button in the
   bottom-left corner (bottom-right is the preview player's, bottom-centre
   the update toast's) that appears once you're 1.5 screens down. Back at
   the top, focus moves to the current tab in the top nav, so a keyboard
   user lands somewhere sensible rather than on a button that just vanished. */
function initBackToTop() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'back-to-top';
    btn.hidden = true;
    btn.dataset.i18nAria = 'back_to_top';
    btn.dataset.i18nTitle = 'back_to_top';
    btn.setAttribute('aria-label', t('back_to_top'));
    btn.title = t('back_to_top');
    btn.innerHTML = icon('chevronsUp');
    btn.addEventListener('click', () => {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
        // The current sub-tab in the section band, else the section in the header.
        const page = [...document.querySelectorAll('.site-page')].find((p) => p.style.display !== 'none');
        const target = document.querySelector('#section-band-tabs .section-band-tab.active, #site-nav .site-nav-sec.active') || page?.querySelector('h2');
        if (target) {
            if (!target.matches('button, a, [tabindex]')) target.tabIndex = -1;
            target.focus({ preventScroll: true });
        }
    });
    document.body.appendChild(btn);
    let queued = false;
    window.addEventListener('scroll', () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            btn.hidden = window.scrollY < window.innerHeight * 1.5;
            queued = false;
        });
    }, { passive: true });
}

/* ===== Init ===== */
document.addEventListener('DOMContentLoaded', () => {
    makeCardsFocusable(document.body);
    // Band for whichever page is showing on load (deep links switch again later).
    const firstPage = [...document.querySelectorAll('.site-page')].find((p) => p.style.display !== 'none');
    if (firstPage) renderSectionBand(firstPage.id.replace(/^page-/, ''));
    styleFilePickers();
    setupDiscordInvite();
    initBackToTop();
    document.addEventListener('keydown', onGlobalShortcutKeydown);
    document.addEventListener('keydown', onModalEscapeKeydown);
    if (typeof renderStaticIcons === 'function') renderStaticIcons();
    if (typeof wireModalHowto === 'function') wireModalHowto();
    if (typeof renderChangelogMenu === 'function') renderChangelogMenu();
    applyLang(siteLang);
    initMaintenanceBanner();
    // Top up language/genre for collection sets saved before that feature —
    // capped + paced inside; delayed so it yields to first paint.
    setTimeout(() => { if (typeof backfillOsuLanguages === 'function') backfillOsuLanguages(); }, 3000);
    checkImportFromHash();
    checkOsuLoginFromUrl();
    if (typeof checkGalleryDeepLink === 'function') checkGalleryDeepLink();
    if (typeof checkCmpoolDeepLink === 'function') checkCmpoolDeepLink();
    if (typeof checkGamesDeepLink === 'function') checkGamesDeepLink();
    // 首頁 is the landing page: fill it once sign-in state is known (above).
    if (typeof ensureHomeLoaded === 'function' && document.getElementById('page-home')?.style.display !== 'none') ensureHomeLoaded();
    if (typeof renderTrackedPlayersList === 'function') renderTrackedPlayersList();
    if (typeof initNotifications === 'function') initNotifications();
    // "為你更新" digest — runs after notifications so it can count what just
    // landed; its own network calls are gated (PP at most every 6h).
    setTimeout(() => { if (typeof renderCollectionDigest === 'function') renderCollectionDigest(); }, 1200);
    // 熱門新曲 — a discovery nice-to-have, yields to everything above it.
    setTimeout(() => { if (typeof loadTrendingSongs === 'function') loadTrendingSongs(); }, 1500);
});
