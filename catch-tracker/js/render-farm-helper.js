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
   mania-tracker.com/farm-helper's own version. Checked live and it's a
   genuine 3D sphere, not a flat rotating ring: peer nodes clearly vary in
   size/brightness and occlude each other as they move (near = bigger/
   brighter/drawn on top, far = smaller/dimmer/drawn behind), and dragging
   moves nodes along curved paths consistent with rotating a globe, not a
   flat disc. Reimplemented here as that: peers are points on a unit
   sphere (Fibonacci-sphere distribution — evenly spaced, no pole
   clustering), rotated each frame by 3D rotation matrices (Y-axis for
   idle auto-spin + horizontal drag, X-axis for vertical drag — a
   standard trackball/globe interaction), then rendered with simple
   orthographic projection (screen x/y = the rotated point's x/y directly)
   plus depth-based size/opacity scaling from the rotated z, painter's-
   algorithm sorted (far-to-near) so near nodes correctly draw over far
   ones. No 3D library — it's ~10 lines of matrix math per point, plain
   Canvas 2D for the actual drawing. Pointer Events (not mouse-specific)
   so drag-to-spin works on touch too. */
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

    // Fibonacci sphere: N points spread evenly over a unit sphere's
    // surface using the golden angle — no clustering at the poles the way
    // a naive lat/long grid would have.
    const N = peers.length;
    const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
    const nodes = peers.map((p, i) => {
        const y = 1 - (i / Math.max(1, N - 1)) * 2; // 1 .. -1
        const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = i * GOLDEN_ANGLE;
        return {
            img: loadImg(p.avatar_url),
            // Unit-sphere coordinates — rotated fresh each frame, never
            // mutated in place.
            ux: Math.cos(theta) * radiusAtY,
            uy: y,
            uz: Math.sin(theta) * radiusAtY,
        };
    });

    const dust = Array.from({ length: 24 }, () => ({
        x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.3,
    }));

    const IDLE_YAW_SPEED = 0.00022; // rad/ms
    let yaw = Math.random() * Math.PI * 2;
    let pitch = -0.25; // slight tilt so the sphere doesn't read as a flat edge-on ring at rest
    let yawVelocity = reduceMotion ? 0 : IDLE_YAW_SPEED;
    let pitchVelocity = 0;
    let dragging = false;
    let lastX = 0, lastY = 0;
    let lastTime = performance.now();

    canvas.addEventListener('pointerdown', (e) => {
        dragging = true;
        yawVelocity = 0;
        pitchVelocity = 0;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        canvas.classList.add('dragging');
    });
    canvas.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        const dYaw = reduceMotion ? 0 : dx * 0.012;
        const dPitch = reduceMotion ? 0 : dy * 0.012;
        yaw += dYaw;
        pitch = Math.max(-1.4, Math.min(1.4, pitch + dPitch));
        yawVelocity = dYaw * 3.5; // seeds momentum from the last drag step's speed
        pitchVelocity = dPitch * 3.5;
        lastX = e.clientX;
        lastY = e.clientY;
    });
    function endDrag() { dragging = false; canvas.classList.remove('dragging'); }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerleave', endDrag);

    function drawAvatar(img, x, y, r, alpha) {
        ctx.save();
        ctx.globalAlpha = alpha;
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
            // Momentum decays back toward the idle baseline (yaw keeps
            // auto-spinning; pitch settles back to 0 rather than to
            // wherever a drag left it, so the sphere doesn't end up stuck
            // looking at its own pole) rather than to a hard stop.
            yawVelocity += (IDLE_YAW_SPEED - yawVelocity) * Math.min(1, dt / 900);
            pitchVelocity += (0 - pitchVelocity) * Math.min(1, dt / 900);
            pitch += (0 - pitch) * Math.min(1, dt / 4000);
            yaw += yawVelocity * dt;
            pitch += pitchVelocity * dt * 0.002;
        }
        const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw);
        const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch);

        const rect = canvas.getBoundingClientRect();
        const w = rect.width, h = rect.height;
        if (w === 0 || h === 0) { requestAnimationFrame(draw); return; }
        ctx.clearRect(0, 0, w, h);

        const cx = w / 2, cy = h / 2;
        const R = Math.min(w, h) * 0.4;

        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        for (const d of dust) {
            ctx.beginPath();
            ctx.arc(d.x * w, d.y * h, d.r, 0, Math.PI * 2);
            ctx.fill();
        }

        // Rotate each unit-sphere point by yaw (around Y) then pitch
        // (around X), scale to R, project orthographically (screen x/y =
        // rotated x/y, z only drives depth-based size/opacity/order).
        const projected = nodes.map(n => {
            const x1 = n.ux * cosYaw - n.uz * sinYaw;
            const z1 = n.ux * sinYaw + n.uz * cosYaw;
            const y2 = n.uy * cosPitch - z1 * sinPitch;
            const z2 = n.uy * sinPitch + z1 * cosPitch;
            return { img: n.img, x: cx + x1 * R, y: cy + y2 * R, z: z2 };
        });
        projected.sort((a, b) => a.z - b.z); // far first (painter's algorithm)

        const nodeR = Math.max(8, R * 0.11);
        for (const p of projected) {
            const depth = (p.z + 1) / 2; // 0 (far) .. 1 (near)
            const size = nodeR * (0.55 + 0.55 * depth);
            const alpha = 0.35 + 0.65 * depth;
            ctx.globalAlpha = alpha * 0.5;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            drawAvatar(p.img, p.x, p.y, size, alpha);
        }
        ctx.globalAlpha = 1;

        const centerR = nodeR * 1.7;
        drawAvatar(centerImg, cx, cy, centerR, 1);
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
