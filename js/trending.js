/* ===== 熱門新曲: site-wide discovery widget on the collection page.
   Complements the personal 今日推薦 banner (renderFeaturedBeatmap() in
   js/osu.js, which only ever picks from sets already in the visitor's own
   collection) — this surfaces well-favourited songs ranked in roughly the
   last month from the WHOLE catalog, so it's for finding things a visitor
   hasn't collected yet. Backend: netlify/functions/trending-songs.js
   (daily-cached; catalog:all has no favourite_count, so it resolves a
   handful of live osu! API lookups once per day, same shortcut
   games-daily.js's buildPuzzle() takes). ===== */
let trendingLoaded = false;
let trendingItems = [];

async function loadTrendingSongs() {
    if (trendingLoaded) return;
    trendingLoaded = true;
    try {
        const r = await fetch('/.netlify/functions/trending-songs');
        if (!r.ok) throw new Error('bad response');
        const data = await r.json();
        trendingItems = data.items || [];
        renderTrendingSongs();
    } catch (e) {
        console.error('trending songs load failed:', e);
        // Stays hidden — this is a discovery nice-to-have, not core function.
    }
}

function renderTrendingSongs() {
    const section = document.getElementById('trending-row');
    const grid = document.getElementById('trending-grid');
    if (!section || !grid || !trendingItems.length) return;

    const collectionSet = new Set(
        OSU_MODES.flatMap(m => (getOsuCollection()[m] || []).map(s => s.beatmapset_id)),
    );
    grid.innerHTML = trendingItems.map(it => {
        const inCollection = collectionSet.has(it.setId);
        // Reuses .osu-card's own look (cover bg/overlay/info block/farm-add-btn
        // "+" — same building blocks catalog.js's cards are made of) rather
        // than inventing a parallel card style.
        return `
        <div class="osu-card trending-card" onclick="window.open('https://osu.ppy.sh/beatmapsets/${it.setId}','_blank')">
            <div class="osu-card-bg" style="background-image:url('${it.coverUrl}')"></div>
            <div class="osu-card-overlay"></div>
            <button class="farm-add-btn${inCollection ? ' in-collection' : ''}" ${inCollection ? 'disabled' : `onclick="addTrendingToCollection(${it.setId}, event)"`} title="${inCollection ? t('farm_in_collection') : t('farm_add_btn_title')}">${icon(inCollection ? 'check' : 'plus')}</button>
            <div class="osu-card-info">
                <div class="osu-card-title">${escHtml(it.title)}</div>
                <div class="osu-card-artist">${escHtml(it.artist)}</div>
                <div class="trending-card-meta">${it.starMax ? Number(it.starMax).toFixed(2) + '★ · ' : ''}♥ ${Number(it.favouriteCount || 0).toLocaleString()}</div>
            </div>
        </div>`;
    }).join('');
    section.style.display = '';
}

async function addTrendingToCollection(setId, event) {
    if (event) event.stopPropagation();
    await addOsuBeatmap(String(setId));
    renderTrendingSongs(); // flips the just-added card to its "in collection" state
}

/* Called from refreshDynamicContent() on a language switch, and from
   main.js's own re-render pass after adding/removing a set elsewhere. */
function refreshTrendingLocalized() {
    if (trendingLoaded) renderTrendingSongs();
}
