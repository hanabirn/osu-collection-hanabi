/* Farm helper (刷圖助手) page — see netlify/functions/farm-helper.js for
   the actual recommendation logic. This just renders whatever it returns:
   a header card for the player these recommendations are for, a coverage
   note (peer-crawl progress is gradual, same "coverage degrades
   gracefully" pattern as the rest of this site), and a results table
   sorted by estimated pp gain. The no-?id= landing view (renderLanding())
   is modeled on mania-tracker.com/farm-helper's own landing screen, per
   request — search box + a localStorage-backed "recent" list + a plain-
   language explainer for each category, scoped to this site's actual v1
   categories (未打過/可提升 only — see the disclaimer text for why the
   other two aren't here). */

const FARM_HELPER_RECENT_KEY = 'ct_farm_helper_recent';
const FARM_HELPER_RECENT_MAX = 5;

function loadRecentFarmHelper() {
    try {
        const raw = JSON.parse(localStorage.getItem(FARM_HELPER_RECENT_KEY));
        return Array.isArray(raw) ? raw.filter(r => r && r.id && r.username) : [];
    } catch { return []; }
}

function pushRecentFarmHelper(id, username) {
    if (!id || !username) return;
    try {
        const list = loadRecentFarmHelper().filter(r => String(r.id) !== String(id));
        list.unshift({ id: String(id), username });
        localStorage.setItem(FARM_HELPER_RECENT_KEY, JSON.stringify(list.slice(0, FARM_HELPER_RECENT_MAX)));
    } catch { /* private mode etc. — recent list just won't persist */ }
}

function removeRecentFarmHelper(id) {
    try {
        const list = loadRecentFarmHelper().filter(r => String(r.id) !== String(id));
        localStorage.setItem(FARM_HELPER_RECENT_KEY, JSON.stringify(list));
    } catch { /* ignore */ }
}

function categoryLabel(category) {
    return category === 'new' ? t('farm_helper_category_new') : t('farm_helper_category_improve');
}

function refScoreHtml(item) {
    const mods = item.ref_mods && item.ref_mods.length ? modsTag(item.ref_mods) : modsTag([]);
    const acc = item.ref_accuracy != null ? fmtAccuracy(item.ref_accuracy) : '—';
    return `${gradeBadge(item.ref_rank)} ${mods} ${acc}`;
}

const FARM_HELPER_CATEGORY_ICONS = {
    new: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></svg>',
    improve: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 6"/><polyline points="15 6 21 6 21 12"/></svg>',
};

function renderLanding(main) {
    const recent = loadRecentFarmHelper();
    const loggedInUser = getCtLoggedInUser();
    main.innerHTML = `
        <div class="farm-helper-landing">
            <h1>${t('farm_helper_landing_title')}</h1>
            ${loggedInUser ? `
            <a class="pill farm-helper-landing-self-link" href="farm-helper.html?id=${encodeURIComponent(loggedInUser.id)}">
                ${escapeHtml(t('farm_helper_my_own', { username: loggedInUser.username || `#${loggedInUser.id}` }))}
            </a>` : ''}
            <div class="farm-helper-landing-search">
                <span class="farm-helper-landing-for">${t('farm_helper_landing_for')}</span>
                <div class="search-wrap farm-helper-search-wrap">
                    <input type="text" id="farm-helper-search-input" class="search-input" placeholder="${escapeHtml(t('search_placeholder'))}" autocomplete="off">
                    <div class="search-results" id="farm-helper-search-results" hidden></div>
                </div>
            </div>
            ${recent.length ? `
            <div class="farm-helper-recent">
                <span class="farm-helper-recent-label">${t('farm_helper_recent')}</span>
                <div class="farm-helper-recent-chips" id="farm-helper-recent-chips">
                    ${recent.map(r => `
                        <span class="farm-helper-recent-chip">
                            <a href="farm-helper.html?id=${encodeURIComponent(r.id)}">${escapeHtml(r.username)}</a>
                            <button type="button" class="farm-helper-recent-remove" data-id="${escapeHtml(r.id)}" title="${escapeHtml(t('remove'))}">&times;</button>
                        </span>`).join('')}
                </div>
            </div>` : ''}
            <div class="farm-helper-landing-explainer">
                <p class="farm-helper-landing-explainer-title">${t('farm_helper_explainer_title')}</p>
                <div class="farm-helper-landing-cat">
                    <span class="farm-helper-landing-cat-icon farm-helper-cat--new">${FARM_HELPER_CATEGORY_ICONS.new}</span>
                    <div><strong>${t('farm_helper_category_new')}</strong><span>${t('farm_helper_desc_new')}</span></div>
                </div>
                <div class="farm-helper-landing-cat">
                    <span class="farm-helper-landing-cat-icon farm-helper-cat--improve">${FARM_HELPER_CATEGORY_ICONS.improve}</span>
                    <div><strong>${t('farm_helper_category_improve')}</strong><span>${t('farm_helper_desc_improve')}</span></div>
                </div>
            </div>
        </div>`;

    const input = document.getElementById('farm-helper-search-input');
    const results = document.getElementById('farm-helper-search-results');
    let debounceTimer = null;

    async function runSearch(q) {
        try {
            const data = await apiGet('rankings-list', { q, limit: 8 });
            results.innerHTML = data.items.length
                ? data.items.map(r => `
                    <a class="search-result-row" href="farm-helper.html?id=${encodeURIComponent(r.user_id)}">
                        ${avatarWithFlagHtml(r.avatar_url, r.country_code)}
                        <span>${escapeHtml(r.username)}</span>
                        <span class="search-result-pp">${fmtPP(r.pp)}</span>
                    </a>`).join('')
                : `<div class="search-empty">${escapeHtml(t('search_no_results'))}</div>`;
            results.hidden = false;
        } catch {
            results.hidden = true;
        }
    }

    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const q = input.value.trim();
        if (!q) { results.hidden = true; return; }
        debounceTimer = setTimeout(() => runSearch(q), 250);
    });
    input.addEventListener('focus', () => { if (input.value.trim() && results.innerHTML) results.hidden = false; });
    document.addEventListener('click', (e) => {
        if (!input.parentElement.contains(e.target)) results.hidden = true;
    });

    document.getElementById('farm-helper-recent-chips')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.farm-helper-recent-remove');
        if (!btn) return;
        e.preventDefault();
        removeRecentFarmHelper(btn.getAttribute('data-id'));
        renderLanding(main);
    });
}

/* Decorative rotating peer-network graph, per request — modeled on
   mania-tracker.com/farm-helper's own version (observed live: a canvas
   with the viewed player centered, ~20 peer avatars connected to it by
   thin lines arranged in a ring, the ring auto-rotating slowly on its own
   and spinning faster/with momentum when dragged, plus a few unconnected
   background dust particles). Built from scratch here — no library, plain
   Canvas 2D + requestAnimationFrame, since nothing about the effect
   itself needs one (just circles, lines, and an angle that changes over
   time). Pointer Events (not mouse-specific) so drag-to-spin works with
   touch too. */
function initPeerGraph(canvas, center, peers) {
    if (!canvas || !peers.length) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function resize() {
        const rect = canvas.getBoundingClientRect();
        canvas.width = Math.max(1, Math.round(rect.width * dpr));
        canvas.height = Math.max(1, Math.round(rect.height * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    function loadImg(url) {
        const img = new Image();
        img.decoding = 'async';
        img.src = url || '';
        return img;
    }
    const centerImg = loadImg(center.avatar_url);
    const nodes = peers.map((p, i) => ({
        img: loadImg(p.avatar_url),
        baseAngle: (i / peers.length) * Math.PI * 2,
        // Slight per-node distance variation (not a perfect circle) —
        // reads as more organic than every node sitting exactly on one
        // ring, closer to the reference's own irregular layout.
        radiusFactor: 0.78 + ((i * 37) % 7) / 7 * 0.18,
    }));

    const dust = Array.from({ length: 24 }, () => ({
        x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.3,
    }));

    const IDLE_VELOCITY = 0.00022; // rad/ms
    let rotation = Math.random() * Math.PI * 2;
    let velocity = reduceMotion ? 0 : IDLE_VELOCITY;
    let dragging = false;
    let lastAngle = 0;
    let lastTime = performance.now();

    function pointerAngle(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        return Math.atan2(clientY - (rect.top + rect.height / 2), clientX - (rect.left + rect.width / 2));
    }

    canvas.addEventListener('pointerdown', (e) => {
        dragging = true;
        velocity = 0;
        lastAngle = pointerAngle(e.clientX, e.clientY);
        canvas.setPointerCapture(e.pointerId);
        canvas.classList.add('dragging');
    });
    canvas.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const a = pointerAngle(e.clientX, e.clientY);
        let delta = a - lastAngle;
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        rotation += delta;
        velocity = reduceMotion ? 0 : delta * 60; // seed momentum from the last drag step's angular speed
        lastAngle = a;
    });
    function endDrag() { dragging = false; canvas.classList.remove('dragging'); }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerleave', endDrag);

    function drawAvatar(img, x, y, r) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        if (img.complete && img.naturalWidth) {
            ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
        } else {
            ctx.fillStyle = '#2a2a4a';
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
        ctx.restore();
    }

    let stopped = false;
    function draw(now) {
        if (stopped) return;
        const dt = Math.min(64, now - lastTime);
        lastTime = now;

        if (!dragging) {
            // momentum decays back toward the idle baseline speed rather
            // than to a full stop, so a drag-kick gradually settles into
            // the same slow auto-drift it started from.
            velocity += (IDLE_VELOCITY - velocity) * Math.min(1, dt / 900);
            rotation += velocity * dt;
        }

        const rect = canvas.getBoundingClientRect();
        const w = rect.width, h = rect.height;
        if (w === 0 || h === 0) { requestAnimationFrame(draw); return; }
        ctx.clearRect(0, 0, w, h);

        const cx = w / 2, cy = h / 2;
        const R = Math.min(w, h) * 0.42;

        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        for (const d of dust) {
            ctx.beginPath();
            ctx.arc(d.x * w, d.y * h, d.r, 0, Math.PI * 2);
            ctx.fill();
        }

        const positions = nodes.map(n => {
            const a = n.baseAngle + rotation;
            const r = R * n.radiusFactor;
            return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, img: n.img };
        });

        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 1;
        for (const p of positions) {
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
        }

        const nodeR = Math.max(9, R * 0.1);
        for (const p of positions) drawAvatar(p.img, p.x, p.y, nodeR);

        const centerR = nodeR * 1.6;
        drawAvatar(centerImg, cx, cy, centerR);
        ctx.beginPath();
        ctx.arc(cx, cy, centerR, 0, Math.PI * 2);
        ctx.strokeStyle = '#fb5a8c';
        ctx.lineWidth = 3;
        ctx.stroke();

        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);

    // If this canvas gets torn out of the DOM (page navigation via the SPA-
    // style history API isn't used here, but a future re-render of #farm-
    // helper-main would orphan the old rAF loop otherwise), stop drawing
    // once it's no longer attached rather than looping forever unseen.
    const observer = new MutationObserver(() => {
        if (!document.body.contains(canvas)) { stopped = true; observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

async function loadFarmHelper() {
    const main = document.getElementById('farm-helper-main');
    const params = new URLSearchParams(location.search);
    const userId = params.get('id');
    if (!userId) {
        document.title = `Catch Tracker — ${t('farm_helper_title')}`;
        renderLanding(main);
        return;
    }

    try {
        const [playerData, farmData] = await Promise.all([
            apiGet('player-get', { user_id: userId }),
            apiGet('farm-helper', { user_id: userId }),
        ]);
        const p = playerData.profile;
        document.title = `Catch Tracker — ${t('farm_helper_title')}: ${p.username || userId}`;
        pushRecentFarmHelper(userId, p.username || userId);

        const items = farmData.items || [];
        const coverage = farmData.coverage || {};

        const rows = items.length
            ? items.map(item => `
                <tr>
                    <td><span class="farm-helper-cat farm-helper-cat--${item.category}">${categoryLabel(item.category)}</span></td>
                    <td>${mapLink(item.beatmap_id, `${item.artist || ''} - ${item.title || ''} [${item.version || ''}]`)}${item.difficulty_rating != null ? ` <span class="mods-tag">${item.difficulty_rating.toFixed(2)}★</span>` : ''}</td>
                    <td>${refScoreHtml(item)}</td>
                    <td class="farm-helper-gain">+${item.gain}pp</td>
                </tr>`).join('')
            : `<tr><td colspan="4" class="empty-state">${t('farm_helper_no_data')}</td></tr>`;

        const peers = farmData.peers || [];

        main.innerHTML = `
            <div class="farm-helper-top">
                <div class="card profile-header${p.cover_url ? ' has-cover' : ''}"${p.cover_url ? ` style="background-image:url('${p.cover_url.replace(/'/g, '%27')}')"` : ''}>
                    ${avatarWithFlagHtml(p.avatar_url, p.country_code)}
                    <div>
                        <h1 style="margin:0">${t('farm_helper_title')}</h1>
                        <div class="profile-stats"><span>${escapeHtml(p.username || userId)}</span><span>${fmtPP(p.pp)}</span></div>
                    </div>
                </div>
                ${peers.length ? `<div class="card farm-helper-graph-card"><canvas id="farm-helper-graph" class="farm-helper-graph"></canvas></div>` : ''}
            </div>
            <p class="coverage-note">${coverage.inRankings
                ? t('farm_helper_coverage', { n: coverage.peersCovered ?? 0, total: coverage.peerWindowSize ?? 0 })
                : t('farm_helper_not_ranked')}</p>
            <p class="farm-helper-disclaimer">${t('farm_helper_disclaimer')}</p>
            <div class="table-wrap">
            <table>
                <thead><tr><th>${t('th_category')}</th><th>${t('th_map')}</th><th>${t('farm_helper_ref')}</th><th>${t('farm_helper_gain')}</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
            </div>
        `;

        if (peers.length) {
            initPeerGraph(document.getElementById('farm-helper-graph'), { avatar_url: p.avatar_url, username: p.username || userId }, peers);
        }
    } catch (err) {
        main.innerHTML = `<p class="empty-state">${t('farm_helper_failed')}</p>`;
    }
}

loadFarmHelper();
