/* ===== Lightweight in-app notifications =====
   No push, no server-side polling — this only checks when the site is
   actually open (see conversation: chose the light path over Web
   Push/VAPID/scheduled functions). Two sources, both diffed against a
   localStorage baseline so only *new* events since the last check surface:
     1. Tracked players' total PP (js/osu.js's getTrackedPlayers()) — refetched
        the same way loadVisitorProfileById() does (osuFetch across all 4 modes).
     2. New posts in the Tournaments forum feed (js/tournaments.js's
        osuTournamentsCurrentItems) — diffed by topic id, which the osu!
        forums hand out monotonically increasing.
   Throttled to once per NOTIF_CHECK_INTERVAL_MS regardless of how many times
   checkForNotifications() gets called (tab switches, reloads, etc.) so a
   busy visitor doesn't turn into a de-facto poll loop against the osu! API. */
const NOTIF_STORAGE_KEY = 'osu_notifications';
const NOTIF_LAST_CHECK_KEY = 'osu_notif_last_check_at';
const NOTIF_TOURNAMENTS_SEEN_KEY = 'osu_tournaments_last_max_id';
const NOTIF_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const NOTIF_MAX_STORED = 30;

function getNotifications() {
    try { return JSON.parse(localStorage.getItem(NOTIF_STORAGE_KEY)) || []; }
    catch { return []; }
}

function saveNotifications(list) {
    localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(list.slice(0, NOTIF_MAX_STORED)));
}

function addNotification(notif) {
    const list = getNotifications();
    if (list.some(n => n.id === notif.id)) return;
    if (notif.celebrate && typeof celebrateBurst === 'function') celebrateBurst();
    const { celebrate, ...stored } = notif;
    list.unshift(stored);
    saveNotifications(list);
}

function getUnreadNotifCount() {
    return getNotifications().filter(n => !n.read).length;
}

function markAllNotificationsRead() {
    saveNotifications(getNotifications().map(n => ({ ...n, read: true })));
    renderNotificationBell();
}

function clearAllNotifications() {
    saveNotifications([]);
    renderNotificationBell();
}

/* Re-fetches every tracked player's total PP and achievement list in one
   pass and compares each against what's stashed on the entry (`lastPp` /
   `knownAchievementIds`, both set at track-time by toggleTrackVisitorPlayer()
   in js/osu.js and kept current here), so only genuine changes since the
   last check produce a notification — never a flood on the very first
   check, since both are always seeded from real values at track-time (a
   player tracked before knownAchievementIds existed instead baselines it
   silently here on the first check that sees it).

   PP and achievements are checked together in a single read-modify-write of
   getTrackedPlayers()/saveTrackedPlayers() rather than as two separate
   functions — they used to be separate, but both independently reading the
   list, mutating their own in-memory copy, and saving back meant whichever
   finished last (unpredictable, since they're both awaited via the same
   Promise.all in checkForNotifications()) silently clobbered the other's
   update. One pass avoids the race instead of trying to schedule around it. */
async function checkTrackedPlayers() {
    if (typeof getTrackedPlayers !== 'function') return;
    const players = getTrackedPlayers();
    if (players.length === 0) return;

    let anyUpdated = false;
    for (const player of players) {
        try {
            const results = await Promise.all([0, 1, 2, 3].map(m => osuFetch(`u=${player.id}&m=${m}`)));
            const totalPp = results.reduce((sum, r) => sum + (r && r[0] && r[0].pp_raw != null ? parseFloat(r[0].pp_raw) : 0), 0);
            const prevPp = player.lastPp || 0;
            const delta = Math.round(totalPp) - Math.round(prevPp);

            if (delta !== 0) {
                addNotification({
                    id: `pp-${player.id}-${Date.now()}`,
                    type: 'pp',
                    title: player.username || `#${player.id}`,
                    detail: t('notif_pp_changed_detail', {
                        sign: delta > 0 ? '+' : '',
                        delta: delta.toLocaleString(),
                        pp: Math.round(totalPp).toLocaleString(),
                    }),
                    playerId: player.id,
                    createdAt: Date.now(),
                    read: false,
                    celebrate: delta > 0,
                });
            }
            player.lastPp = totalPp;
            // Backfills the flag for players tracked before country was
            // stored — this periodic check already fetches mode 0's profile,
            // which carries it, so no extra request is needed for that.
            if (results[0] && results[0][0] && results[0][0].country) player.country = results[0][0].country;
            anyUpdated = true;
        } catch (e) {
            console.error('Tracked player PP check failed:', player.id, e);
        }

        try {
            const res = await fetch(`/.netlify/functions/osu-user-achievements?id=${player.id}`);
            if (res.ok) {
                const ids = (await res.json()).achievements || [];
                if (!Array.isArray(player.knownAchievementIds)) {
                    player.knownAchievementIds = ids;
                    anyUpdated = true;
                } else {
                    const known = new Set(player.knownAchievementIds);
                    const newIds = ids.filter(id => !known.has(id));
                    if (newIds.length > 0) {
                        addNotification({
                            id: `achievement-${player.id}-${Date.now()}`,
                            type: 'achievement',
                            title: t('notif_achievement_new_title', { n: player.username || `#${player.id}` }),
                            // Links out to the player's real osu! profile
                            // rather than this site's own lookup view — this
                            // site has no medal UI of its own (no
                            // achievement id -> name/icon mapping, see
                            // osu-user-achievements.js's header comment), so
                            // that's the only place the new medal is
                            // actually visible.
                            detail: t('notif_achievement_detail', { count: newIds.length }),
                            url: `https://osu.ppy.sh/users/${player.id}`,
                            createdAt: Date.now(),
                            read: false,
                            celebrate: true,
                        });
                        player.knownAchievementIds = ids;
                        anyUpdated = true;
                    }
                }
            }
        } catch (e) {
            console.error('Tracked player achievement check failed:', player.id, e);
        }
    }
    if (anyUpdated) {
        saveTrackedPlayers(players);
        if (typeof renderTrackedPlayersList === 'function') renderTrackedPlayersList();
    }
}

/* First-ever check just baselines the max seen topic id instead of notifying
   — otherwise every one of the ~25 cached topics would fire as "new" the
   moment a visitor's browser has never checked before. */
async function checkNewTournamentPosts() {
    if (typeof loadOsuTournaments !== 'function') return;
    await loadOsuTournaments();
    const items = (typeof osuTournamentsCurrentItems !== 'undefined' && osuTournamentsCurrentItems) || [];
    if (items.length === 0) return;

    const maxId = items.reduce((m, i) => Math.max(m, i.id || 0), 0);
    const storedRaw = localStorage.getItem(NOTIF_TOURNAMENTS_SEEN_KEY);
    const stored = storedRaw ? parseInt(storedRaw, 10) : null;

    if (stored === null) {
        localStorage.setItem(NOTIF_TOURNAMENTS_SEEN_KEY, String(maxId));
        return;
    }

    items.filter(i => i.id > stored).slice(0, 5).forEach(topic => {
        addNotification({
            id: `tournament-${topic.id}`,
            type: 'tournament',
            title: t('notif_tournament_new_title'),
            detail: topic.title || '',
            url: OSU_TOURNAMENTS_TOPIC_BASE + topic.id,
            createdAt: Date.now(),
            read: false,
        });
    });
    if (maxId > stored) localStorage.setItem(NOTIF_TOURNAMENTS_SEEN_KEY, String(maxId));
}

async function checkForNotifications(force) {
    const last = parseInt(localStorage.getItem(NOTIF_LAST_CHECK_KEY), 10) || 0;
    if (!force && Date.now() - last < NOTIF_CHECK_INTERVAL_MS) return;
    localStorage.setItem(NOTIF_LAST_CHECK_KEY, String(Date.now()));

    // DM unread badge is intentionally its own thing, not routed through
    // addNotification()/getUnreadNotifCount() below — those track "read" in
    // localStorage, which would fight with a DM conversation's unreadCount
    // living server-side (see netlify/functions/dm-read.js). Piggybacks on
    // this same 15-min cycle for whenever the visitor isn't on the DM tab
    // itself (js/dm.js polls it directly, much faster, while that tab is open).
    await Promise.all([
        checkTrackedPlayers(), checkNewTournamentPosts(),
        typeof loadDmConversations === 'function' ? loadDmConversations() : Promise.resolve(),
    ]);
    renderNotificationBell();
}

function renderNotificationBell() {
    const badge = document.getElementById('notif-badge');
    const count = getUnreadNotifCount();
    if (badge) {
        badge.textContent = count > 9 ? '9+' : String(count);
        badge.style.display = count > 0 ? '' : 'none';
    }

    const list = document.getElementById('notif-menu-list');
    if (!list) return;
    const notifs = getNotifications();
    if (notifs.length === 0) {
        list.innerHTML = `<div class="notif-empty">${t('notif_empty')}</div>`;
        return;
    }

    list.innerHTML = notifs.map(n => {
        const timeStr = new Date(n.createdAt).toLocaleString();
        const ICON_BY_TYPE = { pp: 'trendingUp', mapper: 'palette', 'mapper-graveyard': 'palette', 'mapper-loved': 'heart', achievement: 'trophy' };
        const iconName = ICON_BY_TYPE[n.type] || 'trophy';
        const body = `
            <span class="notif-item-icon">${icon(iconName)}</span>
            <div class="notif-item-body">
                <div class="notif-item-title">${escapeHtmlOsu(n.title)}</div>
                <div class="notif-item-detail">${escapeHtmlOsu(n.detail)}</div>
                <div class="notif-item-time">${timeStr}</div>
            </div>`;
        const cls = `notif-item${n.read ? '' : ' unread'}`;
        if (['tournament', 'mapper', 'mapper-graveyard', 'mapper-loved', 'achievement'].includes(n.type) && n.url) {
            return `<a href="${n.url}" target="_blank" rel="noopener noreferrer" class="${cls}">${body}</a>`;
        }
        if (n.type === 'pp' && n.playerId) {
            return `<div class="${cls}" onclick="openNotifPlayer('${n.playerId}')">${body}</div>`;
        }
        return `<div class="${cls}">${body}</div>`;
    }).join('');
}

function openNotifPlayer(id) {
    toggleNotifDropdown(false);
    switchTab('lookup', document.getElementById('nav-btn-lookup'));
    loadVisitorProfileById(id, false);
}

function toggleNotifDropdown(forceOpen) {
    const wrap = document.getElementById('notif-bell');
    const btn = document.getElementById('notif-bell-btn');
    const header = document.querySelector('.site-header');
    if (!wrap || !btn) return;
    const open = typeof forceOpen === 'boolean' ? forceOpen : !wrap.classList.contains('open');
    wrap.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    // .site-header clips overflow by default (see css/base.css) — same
    // temporary-lift trick main.js's toggleLangMenu() uses for the language
    // dropdown, otherwise this menu renders fully but gets visually clipped
    // to the header's own box the moment it extends past it.
    if (header) header.classList.toggle('notif-menu-open', open);
    if (open) {
        markAllNotificationsRead();
        document.addEventListener('click', onNotifOutsideClick);
        document.addEventListener('keydown', onNotifEscape);
    } else {
        document.removeEventListener('click', onNotifOutsideClick);
        document.removeEventListener('keydown', onNotifEscape);
    }
}
function onNotifOutsideClick(e) {
    if (!e.target.closest('#notif-bell')) toggleNotifDropdown(false);
}
function onNotifEscape(e) {
    if (e.key === 'Escape') toggleNotifDropdown(false);
}

function initNotifications() {
    renderNotificationBell();
    checkForNotifications();
}
