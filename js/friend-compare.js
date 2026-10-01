/* ===== 和朋友比對收藏 =====
   Compares the visitor's collection with one someone published to 收藏廣場
   (collections-get): similarity, what each side has that the other doesn't,
   and artists both collect. Songs only the friend has can be added straight
   from the published set data, so no osu! API calls are needed. Opened from
   the collection toolbar (look the friend up by name, id or /c/ link) or
   from a gallery detail modal (compares with that collection). */
const FC_PAGE_SIZE = 24;
let fcFriend = null;     // { id, username, sets: Map<setId, { set, mode }> }
let fcView = 'theirs';   // 'theirs' | 'common' | 'mine'
let fcPage = 0;

function openFriendCompareModal() {
    const modal = document.getElementById('friend-compare-modal');
    if (!modal) return;
    fcFriend = null;
    document.getElementById('friend-compare-form').hidden = false;
    document.getElementById('friend-compare-result').innerHTML = '';
    fcSetStatus('');
    modal.style.display = 'flex';
    document.getElementById('friend-compare-input').focus();
}

function closeFriendCompareModal() {
    const modal = document.getElementById('friend-compare-modal');
    if (modal) modal.style.display = 'none';
}

function fcSetStatus(text, isError) {
    const el = document.getElementById('friend-compare-status');
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? '#ff5252' : '';
}

/* setId -> { set, mode }, first occurrence wins (a set lives in one mode list). */
function fcFlatten(collection) {
    const map = new Map();
    for (const mode of OSU_MODES) {
        for (const set of (collection && collection[mode]) || []) {
            if (set && Number.isInteger(set.beatmapset_id) && !map.has(set.beatmapset_id)) map.set(set.beatmapset_id, { set, mode });
        }
    }
    return map;
}

async function fcFetchPublished(id) {
    const res = await fetch(`/.netlify/functions/collections-get?id=${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`collections-get HTTP ${res.status}`);
    return res.json();
}

/* A username is looked up in the gallery index; only an exact (case-
   insensitive) name match counts, so a partial match never compares the
   wrong person. */
async function fcIdForUsername(name) {
    const params = new URLSearchParams({ page: 0, q: name });
    const res = await fetch(`/.netlify/functions/collections-list?${params}`);
    if (!res.ok) throw new Error(`collections-list HTTP ${res.status}`);
    const data = await res.json();
    const hit = (data.items || []).find(i => (i.username || '').toLowerCase() === name.toLowerCase());
    return hit ? String(hit.id) : null;
}

async function friendCompareFromInput() {
    const input = document.getElementById('friend-compare-input');
    const raw = input.value.trim();
    if (!raw) return;
    document.getElementById('friend-compare-result').innerHTML = '';
    fcSetStatus(t('gallery_loading'));
    try {
        const link = raw.match(/\/c\/(\d+)/);
        let data = null;
        if (link) data = await fcFetchPublished(link[1]);
        else {
            // All digits is most likely an osu! id, but could be a name.
            if (/^\d+$/.test(raw)) data = await fcFetchPublished(raw);
            if (!data) {
                const id = await fcIdForUsername(raw);
                if (id) data = await fcFetchPublished(id);
            }
        }
        if (!data || !data.collection) { fcSetStatus(t('fc_not_found'), true); return; }
        showFriendCompare(data);
    } catch (e) {
        console.error('Friend compare failed:', e);
        fcSetStatus(t('fc_load_fail'), true);
    }
}

function friendCompareWithGalleryDetail() {
    if (typeof galleryDetailData === 'undefined' || !galleryDetailData) return;
    openFriendCompareModal();
    document.getElementById('friend-compare-form').hidden = true;
    showFriendCompare(galleryDetailData);
}

function showFriendCompare(data) {
    fcFriend = {
        id: String(data.id || ''),
        username: data.username || `#${data.id}`,
        sets: fcFlatten(data.collection),
    };
    fcView = 'theirs';
    fcPage = 0;
    fcSetStatus('');
    renderFriendCompare();
}

function fcCompute() {
    const mine = fcFlatten(getOsuCollection());
    const theirs = fcFriend.sets;
    const common = [], theirsOnly = [], mineOnly = [];
    for (const [id, e] of theirs) (mine.has(id) ? common : theirsOnly).push(e);
    for (const [id, e] of mine) if (!theirs.has(id)) mineOnly.push(e);
    const union = mine.size + theirs.size - common.length;
    // Percent text; a real but tiny overlap shows as <1 rather than 0.
    const pct = (n, d) => {
        if (!d) return '0';
        const v = Math.round((n / d) * 100);
        return v === 0 && n > 0 ? '<1' : String(v);
    };

    // Artists both of you collect (not necessarily the same songs), ranked
    // by the smaller of the two counts so a shared favourite beats one side's
    // big pile.
    const countArtists = map => {
        const counts = new Map();
        for (const { set } of map.values()) {
            const lead = primaryArtist(set.artist);
            if (!lead) continue;
            const key = lead.toLowerCase();
            const c = counts.get(key) || { label: lead, n: 0 };
            c.n++;
            counts.set(key, c);
        }
        return counts;
    };
    const a = countArtists(mine), b = countArtists(theirs);
    const sharedArtists = [...a.entries()]
        .filter(([key]) => b.has(key))
        .map(([key, v]) => ({ label: v.label, mine: v.n, theirs: b.get(key).n }))
        .sort((x, y) => (Math.min(y.mine, y.theirs) - Math.min(x.mine, x.theirs)) || ((y.mine + y.theirs) - (x.mine + x.theirs)))
        .slice(0, 8);

    return {
        common, theirsOnly, mineOnly, sharedArtists,
        mineSize: mine.size, theirsSize: theirs.size,
        similarity: pct(common.length, union),
        mineCoveredPct: pct(common.length, mine.size),
        theirsCoveredPct: pct(common.length, theirs.size),
    };
}

function fcTileHtml({ set }, canAdd) {
    const id = set.beatmapset_id;
    const hardest = (set.beatmaps || []).reduce((h, b) => (!h || (b.difficulty_rating || 0) > (h.difficulty_rating || 0) ? b : h), null);
    return `
        <div class="osu-wall-tile" data-set-id="${id}" onclick="window.open('https://osu.ppy.sh/beatmapsets/${id}','_blank')" title="${escHtml(`${set.artist} - ${set.title}`)}">
            <img class="osu-wall-tile-cover" src="https://assets.ppy.sh/beatmaps/${id}/covers/list@2x.jpg" alt="" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">
            ${canAdd ? `<button class="card-add-btn" onclick="friendCompareAddOne(${id}, event)" title="${escHtml(t('fc_add_one'))}" aria-label="${escHtml(t('fc_add_one'))}">${icon('plus')}</button>` : ''}
            <button class="osu-play-btn" onclick="playOsuPreview(${id}, event)" title="${t('mappools_preview')}" aria-label="${t('mappools_preview')}"${osuPreviewBeatStyle(hardest ? hardest.bpm : 0)}>${playBtnIcon()}</button>
            <div class="osu-wall-tile-info">
                <div class="osu-wall-tile-title">${escHtml(set.title)}</div>
                <div class="osu-wall-tile-artist">${escHtml(set.artist)}</div>
            </div>
        </div>`;
}

function renderFriendCompare() {
    const el = document.getElementById('friend-compare-result');
    if (!el || !fcFriend) return;
    const r = fcCompute();
    const name = fcFriend.username;
    const lists = { theirs: r.theirsOnly, common: r.common, mine: r.mineOnly };
    const list = lists[fcView];
    const totalPages = Math.max(1, Math.ceil(list.length / FC_PAGE_SIZE));
    if (fcPage >= totalPages) fcPage = totalPages - 1;
    const pageItems = list.slice(fcPage * FC_PAGE_SIZE, (fcPage + 1) * FC_PAGE_SIZE);

    const profile = /^\d+$/.test(fcFriend.id)
        ? `<a class="fc-friend" href="https://osu.ppy.sh/users/${fcFriend.id}" target="_blank" rel="noopener noreferrer"><img class="fc-friend-avatar" src="${osuAvatarUrl(fcFriend.id)}" alt="" onerror="this.style.visibility='hidden'"><span>${escHtml(name)}</span></a>`
        : `<span class="fc-friend"><span>${escHtml(name)}</span></span>`;
    const artists = r.sharedArtists.length
        ? `<div class="fc-artists"><div class="fc-artists-label">${escHtml(t('fc_shared_artists'))}</div><div class="fc-artist-chips">${r.sharedArtists.map(a => `<span class="fc-artist-chip" title="${escHtml(`${a.mine} / ${a.theirs}`)}">${escHtml(a.label)} <small>${a.mine} / ${a.theirs}</small></span>`).join('')}</div></div>`
        : '';
    const tab = (view, label, n) => `<button class="osu-mode-tab ${fcView === view ? 'active' : ''}" onclick="switchFriendCompareView('${view}')">${escHtml(label)} (${n})</button>`;
    const addAll = fcView === 'theirs' && r.theirsOnly.length
        ? `<div class="fc-toolbar"><button class="btn" onclick="friendCompareAddAll()">${icon('plus', { extraClass: 'icon-label-gap' })}${escHtml(t('fc_add_all', { n: r.theirsOnly.length }))}</button></div>`
        : '';
    const grid = pageItems.length
        ? `<div class="fc-grid">${pageItems.map(e => fcTileHtml(e, fcView === 'theirs')).join('')}</div>`
        : `<p class="osu-empty">${escHtml(t('fc_empty_list'))}</p>`;
    let pager = '';
    if (totalPages > 1) {
        pager = `<div class="osu-pagination fc-pagination">`
            + `<button class="osu-page-btn" onclick="gotoFriendComparePage(${fcPage - 1})" ${fcPage === 0 ? 'disabled' : ''}>‹</button>`
            + buildPaginationPageButtons(fcPage, totalPages, i => `gotoFriendComparePage(${i})`)
            + `<button class="osu-page-btn" onclick="gotoFriendComparePage(${fcPage + 1})" ${fcPage >= totalPages - 1 ? 'disabled' : ''}>›</button>`
            + `</div>`;
    }

    el.innerHTML = `
        <div class="fc-summary">
            ${profile}
            <div class="fc-sim"><span class="fc-sim-value">${escHtml(r.similarity)}%</span><span class="fc-sim-label">${escHtml(t('fc_similarity'))}</span></div>
        </div>
        <p class="fc-detail">${escHtml(t('fc_overlap_detail', { a: r.mineCoveredPct, b: r.theirsCoveredPct, name }))}</p>
        ${artists}
        <div class="osu-mode-tabs fc-tabs">
            ${tab('theirs', t('fc_theirs_only', { name }), r.theirsOnly.length)}
            ${tab('common', t('fc_common'), r.common.length)}
            ${tab('mine', t('fc_mine_only', { name }), r.mineOnly.length)}
        </div>
        ${addAll}
        ${grid}
        ${pager}`;
}

function switchFriendCompareView(view) {
    fcView = view;
    fcPage = 0;
    renderFriendCompare();
}

function gotoFriendComparePage(page) {
    fcPage = Math.max(0, page);
    renderFriendCompare();
    document.getElementById('friend-compare-result')?.querySelector('.fc-tabs')?.scrollIntoView({ block: 'nearest' });
}

/* Adds the friend's sets (cleaned like any incoming set) to the front of
   their mode lists, so they show first in the collection like a normal add. */
async function fcAddSets(entries) {
    if (!entries.length || !await verifyOsuPassword()) return;
    const col = getOsuCollection();
    const have = new Set(OSU_MODES.flatMap(m => col[m].map(s => s.beatmapset_id)));
    const now = new Date().toISOString();
    let added = 0;
    for (const { set, mode } of [...entries].reverse()) {
        const clean = sanitizeIncomingOsuSet(set);
        if (!clean || have.has(clean.beatmapset_id)) continue;
        clean.addedAt = now;
        col[mode].unshift(clean);
        have.add(clean.beatmapset_id);
        added++;
    }
    saveOsuCollection(col);
    renderOsuCollection();
    renderFriendCompare();
    showShareToast(t('fc_added', { n: added }));
}

function friendCompareAddOne(setId, event) {
    if (event) event.stopPropagation();
    const entry = fcFriend && fcFriend.sets.get(setId);
    if (entry) fcAddSets([entry]);
}

function friendCompareAddAll() {
    if (!fcFriend) return;
    const { theirsOnly } = fcCompute();
    if (!theirsOnly.length || !confirm(t('fc_add_all_confirm', { n: theirsOnly.length }))) return;
    fcAddSets(theirsOnly);
}
