/* ===== 首頁 (index.html #page-home) =====
   The landing page, after osu-web's signed-in home: a greeting with what
   changed, the tracked players, maps matching your smart categories, and
   the latest tournaments and osu! news. Everything here reuses data the
   site already has (collection, PP history, tracked players, the catalog,
   the news and wyBin endpoints); this file only lays it out.

   The "new maps" row needs the ~2 MB catalog, so it appears only for a
   visitor with a smart (dynamic) category, and only loads once the row is
   on screen. Without one, the 熱門新曲 row below already covers new songs. */

let homeLoaded = false;

function ensureHomeLoaded() {
    renderHomeHero();
    renderHomeTracked();
    if (homeLoaded) return;
    homeLoaded = true;
    loadHomeNews();
    loadHomeTournaments();
    setupHomeNewMaps();
}

function homeCollectionSets() {
    const col = getOsuCollection();
    const seen = new Set();
    return OSU_MODES.flatMap((m) => col[m] || []).filter((s) => !seen.has(s.beatmapset_id) && seen.add(s.beatmapset_id));
}

function renderHomeHero() {
    const el = document.getElementById('home-hero');
    if (!el) return;
    const user = typeof getLoggedInOsuUser === 'function' ? getLoggedInOsuUser() : null;
    const sets = homeCollectionSets();
    const cats = typeof getOsuCategories === 'function' ? getOsuCategories().length : 0;

    let ppLine = '';
    if (user && user.id && typeof getPpHistory === 'function') {
        const history = getPpHistory(ppHistoryKeyFor(user.id));
        if (history.length) {
            const latest = history[history.length - 1];
            const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
            const base = [...history].reverse().find((h) => h.date <= weekAgo);
            const d = base ? Math.round(latest.pp - base.pp) : 0;
            ppLine = `<span>${escHtml(t('home_pp_total', { pp: Math.round(latest.pp).toLocaleString() }))}</span>`
                + (d ? ` · <span class="${d > 0 ? 'home-up' : 'home-down'}">${escHtml(t('home_pp_week', { d: (d > 0 ? '+' : '') + d.toLocaleString() }))}</span>` : '');
        }
    }

    const avatar = user && user.id
        ? `<img class="home-hero-avatar" src="${osuAvatarUrl(user.id)}" alt="" onerror="this.style.visibility='hidden';">`
        : '<span class="home-hero-avatar" aria-hidden="true"></span>';
    const hello = user && user.id
        ? t('home_hello', { name: user.username || ('#' + user.id) })
        : t('home_hello_guest');
    const summary = sets.length ? t('home_summary', { n: sets.length.toLocaleString(), c: cats }) : t('home_summary_empty');
    const cta = user && user.id
        ? `<button type="button" class="btn" onclick="switchTab('collection')">${escHtml(t(sets.length ? 'home_continue' : 'home_start'))}</button>`
        : `<a class="btn" href="/.netlify/functions/osu-login">${escHtml(t('osu_login_btn'))}</a>`;

    el.innerHTML = `${avatar}
        <div class="home-hero-text">
            <p class="home-hello">${escHtml(hello)}</p>
            <p class="home-summary">${escHtml(summary)}</p>
            ${ppLine ? `<p class="home-pp">${ppLine}</p>` : ''}
        </div>
        ${cta}`;
}

function renderHomeTracked() {
    const el = document.getElementById('home-tracked');
    if (!el) return;
    const list = typeof getTrackedPlayers === 'function' ? getTrackedPlayers() : [];
    if (!list.length) {
        el.innerHTML = `<p class="home-empty">${escHtml(t('tracked_players_empty'))}</p>`;
        return;
    }
    el.innerHTML = list.slice(0, 5).map((p) => `
        <button type="button" class="home-list-row" onclick="switchTab('lookup');loadVisitorProfileById('${String(p.id).replace(/\D/g, '')}', false)">
            <img class="home-list-av" src="${osuAvatarUrl(p.id)}" alt="" onerror="this.style.visibility='hidden';">
            <span class="home-list-main">${escHtml(p.username || ('#' + p.id))}</span>
            <span class="home-list-side">${Math.round(p.lastPp || 0).toLocaleString()}pp</span>
        </button>`).join('');
}

async function loadHomeNews() {
    const el = document.getElementById('home-news');
    if (!el) return;
    const render = (items) => {
        el.innerHTML = items.length
            ? items.slice(0, 3).map((n) => `
                <a class="home-list-row" href="${OSU_NEWS_PAGE_BASE}${encodeURIComponent(n.slug || '')}" target="_blank" rel="noopener noreferrer">
                    <span class="home-list-main">${escHtml(n.title || '')}</span>
                    <span class="home-list-side">${escHtml((n.published_at || '').slice(0, 10))}</span>
                </a>`).join('')
            : `<p class="home-empty">${escHtml(t('updates_load_fail'))}</p>`;
    };
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(OSU_NEWS_CACHE_KEY) || 'null'); } catch { cached = null; }
    if (Array.isArray(cached) && cached.length) render(cached);
    else el.innerHTML = `<p class="home-empty">${escHtml(t('updates_loading'))}</p>`;
    try {
        const res = await fetch(OSU_NEWS_FUNCTION_URL);
        if (!res.ok) throw new Error('bad response');
        const items = ((await res.json()).news_posts || []).slice(0, 20);
        try { localStorage.setItem(OSU_NEWS_CACHE_KEY, JSON.stringify(items)); } catch { /* full */ }
        render(items);
    } catch {
        if (!cached) render([]);
    }
}

async function loadHomeTournaments() {
    const el = document.getElementById('home-tournaments');
    if (!el) return;
    const render = (raw) => {
        const items = (raw || []).map(normalizeWybinTournament).slice(0, 4);
        el.innerHTML = items.length
            ? items.map((it) => `
                <a class="home-list-row" href="${escHtml(it.url)}" target="_blank" rel="noopener noreferrer">
                    <span class="home-list-main">${escHtml(it.title)}</span>
                    <span class="home-list-side">${it.meta || escHtml(it.date)}</span>
                </a>`).join('')
            : `<p class="home-empty">${escHtml(t('updates_load_fail'))}</p>`;
    };
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(WYBIN_TOURNAMENTS_CACHE_KEY) || 'null'); } catch { cached = null; }
    if (Array.isArray(cached) && cached.length) render(cached);
    else el.innerHTML = `<p class="home-empty">${escHtml(t('updates_loading'))}</p>`;
    try {
        const res = await fetch(WYBIN_TOURNAMENTS_FUNCTION_URL);
        if (!res.ok) throw new Error('bad response');
        const items = (await res.json()).items || [];
        try { localStorage.setItem(WYBIN_TOURNAMENTS_CACHE_KEY, JSON.stringify(items)); } catch { /* full */ }
        render(items);
    } catch {
        if (!cached) render([]);
    }
}

/* Newest ranked maps matching the visitor's first smart category: the same
   query the category's own refresh runs (js/osu.js refreshSmartCategory). */
function setupHomeNewMaps() {
    const box = document.getElementById('home-new');
    if (!box || typeof getSmartCategories !== 'function' || typeof catalogFetchLocal !== 'function') return;
    const smart = Object.entries(getSmartCategories()).find(([, meta]) => meta && meta.facet);
    if (!smart) return;
    const [catId, meta] = smart;
    const cat = (getOsuCategories() || []).find((c) => c.id === catId);
    const label = (cat && cat.name) || meta.label || '';
    box.hidden = false;
    document.getElementById('home-new-title').textContent = t('home_new_for_cat', { label });
    document.getElementById('home-new-sub').textContent = t('home_new_sub');
    const grid = document.getElementById('home-new-maps');
    grid.innerHTML = `<p class="home-empty">${escHtml(t('gallery_loading'))}</p>`;

    const load = async () => {
        try {
            const params = new URLSearchParams({ sort: 'ranked_desc', page: '0', pageSize: '6' });
            params.set(meta.facet.type, meta.facet.value);
            if (meta.mode) params.set('mode', String(meta.mode));
            const data = await catalogFetchLocal(params);
            const have = new Set(homeCollectionSets().map((s) => s.beatmapset_id));
            const items = (data.items || []).slice(0, 6);
            grid.innerHTML = items.length
                ? items.map((item) => catalogCardHtml(item, have)).join('')
                : `<p class="home-empty">${escHtml(t('catalog_empty'))}</p>`;
        } catch {
            grid.innerHTML = `<p class="home-empty">${escHtml(t('updates_load_fail'))}</p>`;
        }
    };
    if (typeof IntersectionObserver !== 'function') { load(); return; }
    const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { io.disconnect(); load(); }
    }, { rootMargin: '200px' });
    io.observe(box);
}

/* Language switch (js/main.js refreshDynamicContent): redraw the parts of
   首頁 built from t() strings. News and tournament rows are the sources'
   own titles, so they stay as they are. */
function refreshHomeLocalized() {
    if (!homeLoaded) return;
    renderHomeHero();
    renderHomeTracked();
    const box = document.getElementById('home-new');
    if (box && !box.hidden) {
        const smart = Object.entries(getSmartCategories()).find(([, meta]) => meta && meta.facet);
        if (smart) {
            const cat = (getOsuCategories() || []).find((c) => c.id === smart[0]);
            document.getElementById('home-new-title').textContent = t('home_new_for_cat', { label: (cat && cat.name) || smart[1].label || '' });
            document.getElementById('home-new-sub').textContent = t('home_new_sub');
        }
    }
}
