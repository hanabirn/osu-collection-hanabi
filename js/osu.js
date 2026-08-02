/* ===== Small helpers ported from the main site's js/quiz.js (osu.js's only
   two external dependencies there) — inlined here since this site doesn't
   load quiz.js. ===== */
function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showShareToast(msg) {
    let toast = document.getElementById('share-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'share-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = 'share-toast show';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function() { toast.className = 'share-toast'; }, 2500);
}

/* ===== osu! Collection ===== */
const OSU_MODES = ['standard', 'taiko', 'catch', 'mania'];
const OSU_MODE_NAMES = { 0: 'standard', 1: 'taiko', 2: 'catch', 3: 'mania' };
let osuCurrentTab = 'standard';
let osuCurrentAudio = null;
let osuVolume = 0.4;
let osuPage = 0;
let osuSortMode = 'default';
let osuSearchQuery = '';
const OSU_PAGE_SIZE = 8;

function osuAvatarUrl(userId) {
    return `/.netlify/functions/osu-avatar?id=${userId}`;
}

function filterOsuCollection(query) {
    osuSearchQuery = query.trim();
    osuPage = 0;
    renderOsuCollection();
}

function switchOsuSort(mode) {
    osuSortMode = mode;
    osuPage = 0;
    renderOsuCollection();
}

function osuSetMaxRating(set) {
    return Math.max(...set.beatmaps.map(b => b.difficulty_rating));
}

function sortOsuSets(sets) {
    if (osuSortMode === 'rating-desc') return [...sets].sort((a, b) => osuSetMaxRating(b) - osuSetMaxRating(a));
    if (osuSortMode === 'rating-asc') return [...sets].sort((a, b) => osuSetMaxRating(a) - osuSetMaxRating(b));
    return sets;
}

async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function getOsuPassword() { return localStorage.getItem('osu_password_hash'); }

async function setOsuPassword(pw) {
    localStorage.setItem('osu_password_hash', await sha256(pw));
}

function hasOsuPassword() { return !!getOsuPassword(); }

let osuPasswordVerifiedThisSession = false;

async function verifyOsuPassword() {
    if (!hasOsuPassword() || osuPasswordVerifiedThisSession) return true;
    const pw = prompt(t('osu_password_prompt'));
    if (pw === null) return false;
    const hash = await sha256(pw);
    if (hash !== getOsuPassword()) {
        alert(t('osu_password_wrong'));
        return false;
    }
    osuPasswordVerifiedThisSession = true;
    return true;
}

async function setupOsuPassword() {
    if (!await verifyOsuPassword()) return;
    const pw = prompt(t('osu_set_password'));
    if (pw === null || pw === '') return;
    const pw2 = prompt(t('osu_confirm_password'));
    if (pw !== pw2) { alert(t('osu_password_mismatch')); return; }
    await setOsuPassword(pw);
    osuPasswordVerifiedThisSession = true;
    alert(t('osu_password_set'));
}

function copyBeatmapId(setId, event) {
    event.stopPropagation();
    navigator.clipboard.writeText(String(setId)).then(() => {
        const btn = event.currentTarget;
        btn.classList.add('copied');
        btn.innerText = '✓';
        setTimeout(() => { btn.classList.remove('copied'); btn.innerText = '📋'; }, 1200);
    });
}

function osuSetVolume(val) {
    osuVolume = parseFloat(val);
    if (osuCurrentAudio && !osuCurrentAudio.ended) osuCurrentAudio.volume = osuVolume;
}

function playOsuPreview(setId, event) {
    event.stopPropagation();
    const previewUrl = `https://b.ppy.sh/preview/${setId}.mp3`;

    if (osuCurrentAudio && !osuCurrentAudio.ended) {
        osuCurrentAudio.pause();
        document.querySelectorAll('.osu-play-btn').forEach(b => b.classList.remove('playing'));
        if (osuCurrentAudio._setId === setId) { osuCurrentAudio = null; return; }
    }

    const audio = new Audio(previewUrl);
    audio._setId = setId;
    audio.volume = osuVolume;
    osuCurrentAudio = audio;

    const btn = event.currentTarget;
    btn.classList.add('playing');
    audio.play().catch(() => {});
    audio.onended = () => {
        btn.classList.remove('playing');
        osuCurrentAudio = null;
    };
    audio.onerror = () => {
        btn.classList.remove('playing');
        osuCurrentAudio = null;
    };
}

function getOsuFavorites() {
    try { return JSON.parse(localStorage.getItem('osu_favorites')) || []; }
    catch { return []; }
}

function saveOsuFavorites(favs) {
    localStorage.setItem('osu_favorites', JSON.stringify(favs));
}

function isOsuFavorited(setId) {
    return getOsuFavorites().includes(setId);
}

async function toggleOsuFavorite(setId, event) {
    event.stopPropagation();
    if (!await verifyOsuPassword()) return;
    const favs = getOsuFavorites();
    const idx = favs.indexOf(setId);
    if (idx >= 0) favs.splice(idx, 1);
    else favs.push(setId);
    saveOsuFavorites(favs);
    renderOsuCollection();
}

function getOsuCollection() {
    try {
        return JSON.parse(localStorage.getItem('osu_collection')) || { standard: [], taiko: [], catch: [], mania: [] };
    } catch { return { standard: [], taiko: [], catch: [], mania: [] }; }
}

function saveOsuCollection(col) {
    localStorage.setItem('osu_collection', JSON.stringify(col));
}

/* ===== Background carousel from the visitor's own collected beatmap covers =====
   osu! has no character roster to draw on (unlike the pjsekai/wuwa sibling
   sites), so this fades between covers of whatever is actually in the
   visitor's collection instead — personalized, no art curation needed. */
function initOsuBgCarousel() {
    const col = getOsuCollection();
    const ids = [...new Set(OSU_MODES.flatMap(mode => col[mode].map(s => s.beatmapset_id)))];
    if (ids.length === 0) return;
    const shuffled = ids.slice().sort(() => Math.random() - 0.5);
    // cover.jpg is only 900x250 — visibly blurry stretched across a full-page
    // background. cover@2x.jpg is the same crop at double resolution.
    const urls = shuffled.map(id => `https://assets.ppy.sh/beatmaps/${id}/covers/cover@2x.jpg`);
    renderOsuBgCarousel(urls);
}

function renderOsuBgCarousel(urls) {
    const container = document.getElementById('bg-carousel');
    if (!container || !urls.length) return;
    container.innerHTML = urls.map(u => `<div class="bg-slide" style="background-image:url('${u}')"></div>`).join('');
    runOsuBgSlideCarousel(7000);
}

function runOsuBgSlideCarousel(intervalMs) {
    const slides = document.querySelectorAll('#bg-carousel .bg-slide');
    if (!slides.length) return;
    let idx = 0;
    slides[0].classList.add('active');
    setInterval(() => {
        slides[idx].classList.remove('active');
        idx = (idx + 1) % slides.length;
        slides[idx].classList.add('active');
    }, intervalMs);
}

function exportOsuCollection() {
    const data = {
        collection: getOsuCollection(),
        favorites: getOsuFavorites(),
        exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `osu-collection-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showShareToast(t('osu_export_done'));
}

async function importOsuCollection(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!await verifyOsuPassword()) { event.target.value = ''; return; }
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.collection || !OSU_MODES.every(m => Array.isArray(data.collection[m]))) {
            throw new Error('invalid format');
        }
        saveOsuCollection(data.collection);
        if (Array.isArray(data.favorites)) saveOsuFavorites(data.favorites);
        renderOsuCollection();
        showShareToast(t('osu_import_done'));
    } catch (e) {
        console.error('Import failed:', e);
        alert(t('osu_import_fail'));
    } finally {
        event.target.value = '';
    }
}

/* ===== Shareable collection link =====
   Encodes the collection as gzip+base64url into a URL hash fragment (never
   sent to any server, so there's no size limit imposed by a backend) —
   anyone who opens the link gets prompted to merge those beatmaps into
   their own collection, skipping ones they already have. */
function base64UrlEncode(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function compressToBase64Url(obj) {
    const stream = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    return base64UrlEncode(new Uint8Array(buf));
}

async function decompressFromBase64Url(encoded) {
    const stream = new Blob([base64UrlDecode(encoded)]).stream().pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(stream).text();
    return JSON.parse(text);
}

async function shareOsuCollectionLink() {
    const col = getOsuCollection();
    const totalSets = OSU_MODES.reduce((sum, m) => sum + col[m].length, 0);
    if (totalSets === 0) {
        showShareToast(t('osu_share_link_empty'));
        return;
    }
    try {
        const encoded = await compressToBase64Url({ collection: col });
        const url = `${location.origin}${location.pathname}#import=${encoded}`;
        await navigator.clipboard.writeText(url);
        showShareToast(t('osu_share_link_done'));
    } catch (e) {
        console.error('Share link generation failed:', e);
        showShareToast(t('osu_share_link_fail'));
    }
}

async function checkImportFromHash() {
    const hash = location.hash;
    if (!hash.startsWith('#import=')) return;
    const encoded = hash.slice('#import='.length);
    history.replaceState(null, '', location.pathname + location.search);

    try {
        const data = await decompressFromBase64Url(encoded);
        if (!data.collection || !OSU_MODES.every(m => Array.isArray(data.collection[m]))) throw new Error('invalid format');

        const incomingCount = OSU_MODES.reduce((sum, m) => sum + data.collection[m].length, 0);
        if (!confirm(t('osu_share_link_import_confirm', { n: incomingCount }))) return;

        const col = getOsuCollection();
        let added = 0;
        for (const mode of OSU_MODES) {
            const existingIds = new Set(col[mode].map(s => s.beatmapset_id));
            for (const set of data.collection[mode]) {
                if (!existingIds.has(set.beatmapset_id)) {
                    col[mode].push(set);
                    existingIds.add(set.beatmapset_id);
                    added++;
                }
            }
        }
        saveOsuCollection(col);
        renderOsuCollection();
        showShareToast(t('osu_share_link_imported', { n: added }));
    } catch (e) {
        console.error('Import from link failed:', e);
        showShareToast(t('osu_share_link_import_fail'));
    }
}

function parseOsuInput(input) {
    const urlMatch = input.match(/osu\.ppy\.sh\/(?:beatmaps?|beatmapsets?)\/(\d+)/);
    if (urlMatch) return { type: 'url', id: urlMatch[1], isSet: input.includes('beatmapsets') };
    if (/^\d+$/.test(input.trim())) return { type: 'id', id: input.trim(), isSet: false };
    return null;
}

async function osuFetch(params, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
        res = await fetch(`/.netlify/functions/osu?${params}`, { signal: controller.signal });
    } catch (e) {
        if (e.name === 'AbortError') throw new Error(`請求逾時（${timeoutMs / 1000}秒）`);
        throw e;
    } finally {
        clearTimeout(timer);
    }
    const text = await res.text();
    try { return JSON.parse(text); }
    catch { throw new Error(`Function 回傳非 JSON (HTTP ${res.status}): ${text.substring(0, 200)}`); }
}

async function addOsuBeatmap() {
    if (!await verifyOsuPassword()) return;
    const input = document.getElementById('osuInput');
    const status = document.getElementById('osu-status');
    const raw = input.value.trim();
    if (!raw) return;

    const parsed = parseOsuInput(raw);
    if (!parsed) {
        status.innerText = t('osu_input_error');
        status.style.color = '#ff5252';
        return;
    }

    status.innerText = t('osu_searching');
    status.style.color = '#c8a2e0';

    try {
        let beatmaps = [];

        if (parsed.isSet || parsed.type === 'url' && input.value.includes('beatmapsets')) {
            beatmaps = await osuFetch(`s=${parsed.id}`);
        }

        if (beatmaps.length === 0) {
            const byMap = await osuFetch(`b=${parsed.id}`);
            if (byMap.length > 0) {
                beatmaps = await osuFetch(`s=${byMap[0].beatmapset_id}`);
            }
        }

        if (beatmaps.length === 0 && !parsed.isSet) {
            beatmaps = await osuFetch(`s=${parsed.id}`);
        }

        if (beatmaps.length === 0) {
            status.innerText = t('osu_not_found');
            status.style.color = '#ff5252';
            return;
        }

        const modeNum = parseInt(beatmaps[0].mode);
        const modeKey = OSU_MODE_NAMES[modeNum];
        const col = getOsuCollection();

        const alreadyExists = col[modeKey].some(s => s.beatmapset_id === parseInt(beatmaps[0].beatmapset_id));
        if (alreadyExists) {
            status.innerText = t('osu_already_exists', { n: `${beatmaps[0].artist} - ${beatmaps[0].title}` });
            status.style.color = '#f59e0b';
            return;
        }

        const setInfo = {
            beatmapset_id: parseInt(beatmaps[0].beatmapset_id),
            title: beatmaps[0].title,
            artist: beatmaps[0].artist,
            creator: beatmaps[0].creator,
            mode: modeNum,
            beatmaps: beatmaps.map(b => ({
                beatmap_id: parseInt(b.beatmap_id),
                version: b.version,
                difficulty_rating: parseFloat(b.difficultyrating),
                hit_length: parseInt(b.hit_length),
                total_length: parseInt(b.total_length),
                bpm: parseFloat(b.bpm)
            })).sort((a, b) => a.difficulty_rating - b.difficulty_rating)
        };

        col[modeKey].unshift(setInfo);
        saveOsuCollection(col);

        const modeNames = { standard: '⭕ Standard', taiko: '🥁 Taiko', catch: '🍎 Catch', mania: '🎹 Mania' };
        status.innerText = t('osu_added', { n: `${setInfo.artist} - ${setInfo.title}`, m: modeNames[modeKey], k: setInfo.beatmaps.length });
        status.style.color = '#34d399';
        input.value = '';

        osuCurrentTab = modeKey;
        document.querySelectorAll('.osu-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.osu-tab')[modeNum + 1].classList.add('active');
        renderOsuCollection();
    } catch (e) {
        console.error('osu! fetch error:', e);
        status.innerText = `連線失敗: ${e.message}`;
        status.style.color = '#ff5252';
    }
}

function switchOsuTab(mode, btn) {
    document.querySelectorAll('.osu-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    osuCurrentTab = mode;
    osuPage = 0;
    renderOsuCollection();
}

async function removeOsuSet(setId) {
    if (!await verifyOsuPassword()) return;
    const col = getOsuCollection();
    col[osuCurrentTab] = col[osuCurrentTab].filter(s => s.beatmapset_id !== setId);
    saveOsuCollection(col);
    renderOsuCollection();
}

async function refreshAllOsuSets() {
    if (!await verifyOsuPassword()) return;
    const btn = document.querySelector('.osu-refresh-all');
    const status = document.getElementById('osu-status');
    btn.classList.add('spinning');
    status.innerText = t('osu_refreshing');
    status.style.color = '#c8a2e0';

    const col = getOsuCollection();
    const allIds = [...new Set(OSU_MODES.flatMap(mode => col[mode].map(s => s.beatmapset_id)))];
    const REFRESH_CONCURRENCY = 6;

    try {
        for (let i = 0; i < allIds.length; i += REFRESH_CONCURRENCY) {
            const batch = allIds.slice(i, i + REFRESH_CONCURRENCY);
            const results = await Promise.all(batch.map(setId =>
                osuFetch(`s=${setId}`)
                    .then(beatmaps => ({ setId, beatmaps }))
                    .catch(() => ({ setId, beatmaps: [] }))
            ));
            for (const { setId, beatmaps } of results) {
                if (beatmaps.length === 0) continue;
                for (const mode of OSU_MODES) {
                    const idx = col[mode].findIndex(s => s.beatmapset_id === setId);
                    if (idx >= 0) {
                        col[mode][idx].beatmaps = beatmaps.map(b => ({
                            beatmap_id: parseInt(b.beatmap_id),
                            version: b.version,
                            difficulty_rating: parseFloat(b.difficultyrating),
                            hit_length: parseInt(b.hit_length),
                            total_length: parseInt(b.total_length),
                            bpm: parseFloat(b.bpm)
                        })).sort((a, b) => a.difficulty_rating - b.difficulty_rating);
                        break;
                    }
                }
            }
        }
        saveOsuCollection(col);
        renderOsuCollection();
        status.innerText = t('osu_refresh_done', { n: allIds.length });
        status.style.color = '#34d399';
    } catch (e) {
        console.error('Refresh all failed:', e);
        status.innerText = t('osu_refresh_fail');
        status.style.color = '#ff5252';
    } finally {
        btn.classList.remove('spinning');
    }
}

/* ===== Collection overview stats (total sets / favorites / star range) —
   purely derived from localStorage, no API calls needed. ===== */
function renderOsuStats() {
    const el = document.getElementById('osu-stats-panel');
    if (!el) return;
    const col = getOsuCollection();
    const seen = new Set();
    const allSets = OSU_MODES.flatMap(m => col[m]).filter(s => {
        if (seen.has(s.beatmapset_id)) return false;
        seen.add(s.beatmapset_id);
        return true;
    });

    if (allSets.length === 0) {
        el.style.display = 'none';
        return;
    }
    el.style.display = '';

    const allRatings = allSets.flatMap(s => s.beatmaps.map(b => b.difficulty_rating)).filter(r => r > 0);
    const avgRating = allRatings.length ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length : 0;
    const maxRating = allRatings.length ? Math.max(...allRatings) : 0;
    const favCount = getOsuFavorites().filter(id => allSets.some(s => s.beatmapset_id === id)).length;

    el.innerHTML = `
        <div class="osu-stat">
            <div class="osu-stat-value">${allSets.length}</div>
            <div class="osu-stat-label">${t('osu_stats_total')}</div>
        </div>
        <div class="osu-stat">
            <div class="osu-stat-value">${favCount}</div>
            <div class="osu-stat-label">${t('osu_fav')}</div>
        </div>
        <div class="osu-stat">
            <div class="osu-stat-value">${avgRating.toFixed(2)}⭐</div>
            <div class="osu-stat-label">${t('osu_stats_avg_rating')}</div>
        </div>
        <div class="osu-stat">
            <div class="osu-stat-value">${maxRating.toFixed(2)}⭐</div>
            <div class="osu-stat-label">${t('osu_stats_max_rating')}</div>
        </div>
    `;
}

/* ===== Today's featured beatmap: a deterministic daily pick from the whole
   collection (all modes combined), so today's pick is the same across tabs/
   reloads but changes once a day — same pattern as the pjsekai/wuwa sibling
   sites' "featured character of the day". ===== */
function renderFeaturedBeatmap() {
    const el = document.getElementById('featured-beatmap-banner');
    if (!el) return;
    const col = getOsuCollection();
    const seen = new Set();
    const allSets = OSU_MODES.flatMap(m => col[m].map(s => ({ ...s, __mode: m }))).filter(s => {
        if (seen.has(s.beatmapset_id)) return false;
        seen.add(s.beatmapset_id);
        return true;
    });

    if (allSets.length === 0) {
        el.style.display = 'none';
        return;
    }

    const modeIcons = { standard: '⭕', taiko: '🥁', catch: '🍎', mania: '🎹' };
    const dayIndex = Math.floor(Date.now() / 86400000) % allSets.length;
    const set = allSets[dayIndex];
    const coverUrl = `https://assets.ppy.sh/beatmaps/${set.beatmapset_id}/covers/cover.jpg`;

    el.style.display = 'flex';
    el.onclick = () => window.open(`https://osu.ppy.sh/beatmapsets/${set.beatmapset_id}`, '_blank');
    el.innerHTML = `
        <div class="featured-beatmap-bg" style="background-image:url('${coverUrl}')"></div>
        <div class="featured-beatmap-overlay"></div>
        <div class="featured-beatmap-info">
            <div class="featured-beatmap-label">${t('featured_beatmap_label')}</div>
            <div class="featured-beatmap-title">${modeIcons[set.__mode]} ${set.title}</div>
            <div class="featured-beatmap-artist">${set.artist} · ${t('mapped_by', { n: set.creator })}</div>
        </div>
    `;
}

function renderOsuCollection() {
    const container = document.getElementById('osu-collection');
    const paginationEl = document.getElementById('osu-pagination');
    if (!container || !paginationEl) return;
    renderOsuStats();
    renderFeaturedBeatmap();
    const col = getOsuCollection();
    let sets;

    if (osuCurrentTab === 'favorites') {
        const favIds = getOsuFavorites();
        const allSets = OSU_MODES.flatMap(m => col[m].map(s => ({ ...s, __mode: m })));
        const seen = new Set();
        sets = allSets.filter(s => {
            if (favIds.includes(s.beatmapset_id) && !seen.has(s.beatmapset_id)) {
                seen.add(s.beatmapset_id);
                return true;
            }
            return false;
        });
    } else {
        const seen = new Set();
        sets = col[osuCurrentTab].filter(s => {
            if (seen.has(s.beatmapset_id)) return false;
            seen.add(s.beatmapset_id);
            return true;
        }).map(s => ({ ...s, __mode: osuCurrentTab }));
    }

    if (osuSearchQuery) {
        const q = osuSearchQuery.toLowerCase();
        sets = sets.filter(s =>
            s.title.toLowerCase().includes(q) ||
            s.artist.toLowerCase().includes(q) ||
            s.creator.toLowerCase().includes(q)
        );
    }

    sets = sortOsuSets(sets);

    if (sets.length === 0) {
        const msg = osuSearchQuery
            ? t('osu_search_empty')
            : osuCurrentTab === 'favorites'
                ? `${t('osu_empty_fav')}<br><span>${t('osu_empty_fav_hint')}</span>`
                : `${t('osu_empty_collection')}<br><span>${t('osu_empty_hint')}</span>`;
        container.innerHTML = `<div class="osu-empty">${msg}</div>`;
        paginationEl.innerHTML = '';
        return;
    }

    const totalPages = Math.ceil(sets.length / OSU_PAGE_SIZE);
    if (osuPage >= totalPages) osuPage = totalPages - 1;
    if (osuPage < 0) osuPage = 0;
    const pageSets = sets.slice(osuPage * OSU_PAGE_SIZE, (osuPage + 1) * OSU_PAGE_SIZE);

    const modeIcons = { standard: '⭕', taiko: '🥁', catch: '🍎', mania: '🎹' };
    container.innerHTML = pageSets.map(set => {
        const coverUrl = `https://assets.ppy.sh/beatmaps/${set.beatmapset_id}/covers/card.jpg`;
        const isFav = isOsuFavorited(set.beatmapset_id);
        const starsMin = Math.min(...set.beatmaps.map(b => b.difficulty_rating));
        const starsMax = Math.max(...set.beatmaps.map(b => b.difficulty_rating));
        const starsText = (starsMin === 0 && starsMax === 0) ? '' : `<div class="osu-card-stars">${starsMin.toFixed(2)}⭐~${starsMax.toFixed(2)}⭐</div>`;
        return `
        <div class="osu-card" onclick="window.open('https://osu.ppy.sh/beatmapsets/${set.beatmapset_id}','_blank')">
            <div class="osu-card-bg" style="background-image:url('${coverUrl}')"></div>
            <div class="osu-card-overlay"></div>
            <button class="osu-copy-btn" onclick="copyBeatmapId(${set.beatmapset_id}, event)" title="複製 ID">📋</button>
            <button class="osu-ppcalc-btn" onclick="openPpCalcModal(${set.beatmapset_id}, event)" title="${t('pp_calc_btn_title')}">📊</button>
            <button class="osu-play-btn" onclick="playOsuPreview(${set.beatmapset_id}, event)" title="播放預覽">&#9654;</button>
            <button class="osu-fav-btn ${isFav ? 'active' : ''}" onclick="toggleOsuFavorite(${set.beatmapset_id}, event)" title="${isFav ? '取消最愛' : '加入最愛'}">♥</button>
            <button class="osu-delete-btn" onclick="event.stopPropagation();removeOsuSet(${set.beatmapset_id})" title="移除">&#x2715;</button>
            <div class="osu-card-info">
                <div class="osu-card-title">${modeIcons[set.__mode] || ''} ${set.title}</div>
                ${starsText}
                <div class="osu-card-artist">${set.artist}</div>
                <div class="osu-card-mapper">${t('mapped_by', { n: set.creator })}</div>
            </div>
        </div>`;
    }).join('');

    if (totalPages <= 1) {
        paginationEl.innerHTML = '';
    } else {
        let pages = '';
        pages += `<button class="osu-page-btn" onclick="osuPage=0;renderOsuCollection()" ${osuPage===0?'disabled':''}>«</button>`;
        pages += `<button class="osu-page-btn" onclick="osuPage=Math.max(0,osuPage-1);renderOsuCollection()" ${osuPage===0?'disabled':''}>‹</button>`;
        for (let i = 0; i < totalPages; i++) {
            pages += `<button class="osu-page-btn ${i===osuPage?'active':''}" onclick="osuPage=${i};renderOsuCollection()">${i+1}</button>`;
        }
        pages += `<button class="osu-page-btn" onclick="osuPage=Math.min(${totalPages-1},osuPage+1);renderOsuCollection()" ${osuPage>=totalPages-1?'disabled':''}>›</button>`;
        pages += `<button class="osu-page-btn" onclick="osuPage=${totalPages-1};renderOsuCollection()" ${osuPage>=totalPages-1?'disabled':''}>»</button>`;
        paginationEl.innerHTML = pages;
    }
}

/* ===== osu! Profile ===== */
const OSU_USER_ID = 26696007;
let osuProfileLoaded = false;
let osuModeData = [];
let osuCurrentMode = 0;

const COUNTRY_NAMES = {
    TW: 'Taiwan', JP: 'Japan', KR: 'South Korea', US: 'United States',
    CN: 'China', HK: 'Hong Kong', RU: 'Russia', FR: 'France',
    DE: 'Germany', GB: 'United Kingdom', BR: 'Brazil', PH: 'Philippines',
    ID: 'Indonesia', TH: 'Thailand', PL: 'Poland', AU: 'Australia',
    CA: 'Canada', MX: 'Mexico', AR: 'Argentina', CL: 'Chile',
};

function renderOsuModeStats(mode) {
    const u = osuModeData[mode];
    if (!u) return;
    document.getElementById('osu-rank').textContent = u.pp_rank != null ? '#' + parseInt(u.pp_rank).toLocaleString() : '#—';
    document.getElementById('osu-pp').textContent = u.pp_raw != null ? Math.round(parseFloat(u.pp_raw)).toLocaleString() : '—';
    document.getElementById('osu-accuracy').textContent = u.accuracy != null ? parseFloat(u.accuracy).toFixed(2) + '%' : '—';
    document.getElementById('osu-playcount').textContent = u.playcount != null ? parseInt(u.playcount).toLocaleString() : '—';
    renderOsuRankBadges(u);
}

/* ===== Rank badge distribution (SS/S/A counts) — the osu! API already
   returns count_rank_ss/ssh/s/sh/a per mode alongside everything else
   fetchOsuProfile() pulls, so this needs no extra requests. ===== */
function renderOsuRankBadges(u) {
    const el = document.getElementById('osu-rank-badges');
    if (!el) return;
    const ss = (parseInt(u.count_rank_ss) || 0) + (parseInt(u.count_rank_ssh) || 0);
    const s = (parseInt(u.count_rank_s) || 0) + (parseInt(u.count_rank_sh) || 0);
    const a = parseInt(u.count_rank_a) || 0;
    const bars = [
        { label: 'SS', count: ss, rankClass: 'ss' },
        { label: 'S', count: s, rankClass: 's' },
        { label: 'A', count: a, rankClass: 'a' },
    ];
    const max = Math.max(1, ...bars.map(b => b.count));

    el.innerHTML = bars.map(b => `
        <div class="rank-badge-row">
            <span class="rank-badge-tag rank-${b.rankClass}">${b.label}</span>
            <div class="rank-badge-bar-track">
                <div class="rank-badge-bar-fill rank-${b.rankClass}" style="width:${(b.count / max) * 100}%"></div>
            </div>
            <span class="rank-badge-count">${b.count.toLocaleString()}</span>
        </div>
    `).join('');
}

function calcOsuAccuracy(r, mode) {
    const c300 = parseInt(r.count300) || 0;
    const c100 = parseInt(r.count100) || 0;
    const c50 = parseInt(r.count50) || 0;
    const cmiss = parseInt(r.countmiss) || 0;
    const cgeki = parseInt(r.countgeki) || 0;
    const ckatu = parseInt(r.countkatu) || 0;
    let acc = 0;
    if (mode === 1) {
        const total = c300 + c100 + cmiss;
        acc = total > 0 ? (c300 + c100 * 0.5) / total : 0;
    } else if (mode === 2) {
        const total = c300 + c100 + c50 + cmiss + ckatu;
        acc = total > 0 ? (c300 + c100 + c50) / total : 0;
    } else if (mode === 3) {
        const total = cgeki + c300 + ckatu + c100 + c50 + cmiss;
        acc = total > 0 ? (cgeki * 300 + c300 * 300 + ckatu * 200 + c100 * 100 + c50 * 50) / (total * 300) : 0;
    } else {
        const total = c300 + c100 + c50 + cmiss;
        acc = total > 0 ? (c300 * 300 + c100 * 100 + c50 * 50) / (total * 300) : 0;
    }
    return (acc * 100).toFixed(2);
}

const OSU_RANK_CLASS = { XH: 'ss', X: 'ss', SH: 's', S: 's', A: 'a', B: 'b', C: 'c', D: 'd', F: 'f' };

function decodeOsuMods(bitmask) {
    bitmask = parseInt(bitmask) || 0;
    if (!bitmask) return [];
    const hasNC = !!(bitmask & 512);
    const hasPF = !!(bitmask & 16384);
    const table = [
        [1, 'NF'], [2, 'EZ'], [8, 'HD'], [16, 'HR'],
        [32, hasPF ? null : 'SD'], [64, hasNC ? null : 'DT'],
        [128, 'RX'], [256, 'HT'], [512, 'NC'], [1024, 'FL'],
        [4096, 'SO'], [8192, 'AP'], [16384, 'PF']
    ];
    return table.filter(([bit, name]) => name && (bitmask & bit)).map(([, name]) => name);
}

async function renderOsuRecentPlays(userId, mode, listId, wrapId) {
    const container = document.getElementById(listId);
    const wrap = document.getElementById(wrapId);
    if (!container || !wrap) return;
    wrap.style.display = 'none';
    try {
        const recent = await osuFetch(`recent=${userId}&limit=5&m=${mode}`);
        if (!recent || recent.length === 0) return;
        const beatmapIds = [...new Set(recent.map(r => r.beatmap_id))];
        const beatmapResults = await Promise.all(beatmapIds.map(id => osuFetch(`b=${id}`)));
        const beatmapMap = {};
        beatmapIds.forEach((id, i) => {
            const bm = beatmapResults[i] && beatmapResults[i][0];
            if (bm) beatmapMap[id] = bm;
        });
        container.innerHTML = recent.map(r => {
            const bm = beatmapMap[r.beatmap_id];
            const title = bm ? `${bm.title} [${bm.version}]` : `Beatmap #${r.beatmap_id}`;
            const coverUrl = bm ? `https://assets.ppy.sh/beatmaps/${bm.beatmapset_id}/covers/card.jpg` : '';
            const acc = calcOsuAccuracy(r, mode);
            const rankClass = OSU_RANK_CLASS[r.rank] || 'f';
            const mods = decodeOsuMods(r.enabled_mods);
            const modsStr = mods.length > 0 ? ' · ' + mods.join(',') : '';
            const d = new Date(String(r.date).replace(' ', 'T') + 'Z');
            const dateStr = isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            return `<a class="osu-recent-item" href="https://osu.ppy.sh/b/${r.beatmap_id}" target="_blank" rel="noopener noreferrer">
                <div class="osu-recent-bg" style="background-image:url('${coverUrl}')"></div>
                <div class="osu-recent-overlay"></div>
                <span class="osu-recent-rank rank-${rankClass}">${r.rank || '—'}</span>
                <div class="osu-recent-info">
                    <div class="osu-recent-song">${escHtml(title)}</div>
                    <div class="osu-recent-meta">${acc}% · ${r.maxcombo}x${modsStr} · ${dateStr}</div>
                </div>
            </a>`;
        }).join('');
        wrap.style.display = 'block';
    } catch (e) {
        console.error('Recent plays fetch failed:', e);
    }
}

/* ===== PP growth trend: daily localStorage snapshots of total PP, rendered
   as a small SVG line chart. There's no historical PP endpoint on the osu!
   v1 API, so this only accumulates data from whenever a visitor first loads
   the site forward — it can't backfill past progress. ===== */
const OSU_PP_HISTORY_KEY = 'osu_pp_history';
const OSU_PP_HISTORY_MAX_DAYS = 90;

function getPpHistory() {
    try { return JSON.parse(localStorage.getItem(OSU_PP_HISTORY_KEY)) || []; }
    catch { return []; }
}

function savePpHistory(history) {
    localStorage.setItem(OSU_PP_HISTORY_KEY, JSON.stringify(history));
}

function recordPpSnapshot(totalPP) {
    const today = new Date().toISOString().slice(0, 10);
    const value = Math.round(totalPP);
    const history = getPpHistory();
    const last = history[history.length - 1];
    if (last && last.date === today && last.pp === value) return;
    if (last && last.date === today) history[history.length - 1] = { date: today, pp: value };
    else history.push({ date: today, pp: value });
    savePpHistory(history.length > OSU_PP_HISTORY_MAX_DAYS ? history.slice(-OSU_PP_HISTORY_MAX_DAYS) : history);
}

function formatPpChartDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

function ppTrendChartSvg(history) {
    const width = 600, height = 150;
    const padL = 40, padR = 14, padT = 14, padB = 20;
    const innerW = width - padL - padR;
    const innerH = height - padT - padB;

    const xs = history.map(p => new Date(p.date + 'T00:00:00').getTime());
    const xMin = xs[0];
    const xSpan = Math.max(1, xs[xs.length - 1] - xMin);

    let yMin = Math.min(...history.map(p => p.pp));
    let yMax = Math.max(...history.map(p => p.pp));
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const yPad = (yMax - yMin) * 0.1;
    yMin = Math.max(0, Math.floor(yMin - yPad));
    yMax = Math.ceil(yMax + yPad);

    const xPos = t => padL + (xs.length === 1 ? innerW / 2 : ((t - xMin) / xSpan) * innerW);
    const yPos = v => padT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

    const baseline = `<line x1="${padL}" y1="${padT + innerH}" x2="${padL + innerW}" y2="${padT + innerH}" class="trend-chart-grid" />`;
    const yLabels = `<text x="${padL - 6}" y="${padT + innerH + 3}" text-anchor="end" class="trend-chart-axis-label">${yMin.toLocaleString()}</text>
        <text x="${padL - 6}" y="${padT + 8}" text-anchor="end" class="trend-chart-axis-label">${yMax.toLocaleString()}</text>`;
    const xLabels = `<text x="${padL}" y="${height - 4}" text-anchor="start" class="trend-chart-axis-label">${formatPpChartDate(history[0].date)}</text>
        <text x="${padL + innerW}" y="${height - 4}" text-anchor="end" class="trend-chart-axis-label">${formatPpChartDate(history[history.length - 1].date)}</text>`;

    const pts = history.map(p => `${xPos(new Date(p.date + 'T00:00:00').getTime())},${yPos(p.pp)}`);
    const line = history.length > 1
        ? `<polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent-pink)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />`
        : '';
    const dots = history.map(p => {
        const cx = xPos(new Date(p.date + 'T00:00:00').getTime());
        const cy = yPos(p.pp);
        return `<circle cx="${cx}" cy="${cy}" r="2.5" fill="var(--accent-pink)"><title>${formatPpChartDate(p.date)}: ${p.pp.toLocaleString()}pp</title></circle>`;
    }).join('');
    const last = history[history.length - 1];
    const lastX = xPos(new Date(last.date + 'T00:00:00').getTime());
    const lastY = yPos(last.pp);
    const valueLabel = `<circle cx="${lastX}" cy="${lastY}" r="4" fill="var(--accent-pink)"><title>${formatPpChartDate(last.date)}: ${last.pp.toLocaleString()}pp</title></circle>
        <text x="${lastX + 6}" y="${lastY - 6}" class="trend-chart-value-label" fill="var(--accent-pink)">${last.pp.toLocaleString()}</text>`;

    return `<svg viewBox="0 0 ${width} ${height}" class="trend-chart-svg" preserveAspectRatio="none">
        ${baseline}${yLabels}${xLabels}${line}${dots}${valueLabel}
    </svg>`;
}

function renderPpHistoryChart() {
    const el = document.getElementById('pp-history-panel');
    if (!el) return;
    const history = getPpHistory();

    if (history.length < 2) {
        el.innerHTML = `
            <div class="trend-chart-label">${t('pp_history_title')}</div>
            <p class="osu-empty">${t('pp_history_empty')}</p>
        `;
        return;
    }

    el.innerHTML = `
        <div class="trend-chart-label">${t('pp_history_title')}</div>
        <div class="trend-chart-wrap">${ppTrendChartSvg(history)}</div>
    `;
}

async function fetchOsuProfile() {
    if (osuProfileLoaded) return;
    try {
        const results = await Promise.all([0,1,2,3].map(m => osuFetch(`u=${OSU_USER_ID}&m=${m}`)));
        osuModeData = results.map(r => (r && r.length > 0) ? r[0] : null);
        const u = osuModeData[0];
        if (!u) return;

        document.getElementById('osu-avatar').src = osuAvatarUrl(u.user_id);
        document.getElementById('osu-profile-name').textContent = u.username;
        document.getElementById('osu-profile-country').textContent = COUNTRY_NAMES[u.country] || u.country;

        renderOsuModeStats(0);

        const totalPP = osuModeData.reduce((sum, m) => sum + (m && m.pp_raw != null ? parseFloat(m.pp_raw) : 0), 0);
        document.getElementById('osu-total-pp-value').textContent = Math.round(totalPP).toLocaleString();
        document.getElementById('osu-total-pp').style.display = totalPP > 0 ? '' : 'none';

        if (totalPP > 0) {
            recordPpSnapshot(totalPP);
            renderPpHistoryChart();
        }

        document.getElementById('osu-profile-card').style.display = 'block';
        osuProfileLoaded = true;
        renderOsuRecentPlays(OSU_USER_ID, 0, 'osu-recent-list', 'osu-recent-plays');

        document.querySelectorAll('.osu-mode-tab').forEach(tab => {
            tab.addEventListener('click', function() {
                document.querySelector('.osu-mode-tab.active').classList.remove('active');
                this.classList.add('active');
                const mode = parseInt(this.dataset.mode);
                osuCurrentMode = mode;
                renderOsuModeStats(mode);
                renderOsuRecentPlays(OSU_USER_ID, mode, 'osu-recent-list', 'osu-recent-plays');
            });
        });
    } catch (e) {
        console.error('Failed to load osu! profile:', e);
    }
}

/* ===== Visitor Profile Lookup ===== */
let visitorLookupUserId = null;
let visitorModeData = [];
let visitorCurrentMode = 0;

function switchVisitorRecentMode(mode, el) {
    document.querySelectorAll('#visitor-recent-mode-tabs .osu-mode-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    visitorCurrentMode = mode;
    if (visitorLookupUserId) renderOsuRecentPlays(visitorLookupUserId, mode, 'visitor-recent-list', 'visitor-recent-plays');
}

async function lookupVisitorProfile() {
    const input = document.getElementById('visitor-lookup-input').value.trim();
    if (!input) return;
    const status = document.getElementById('visitor-lookup-status');
    const result = document.getElementById('visitor-lookup-result');
    status.innerText = t('osu_searching') || 'Searching...';
    status.style.color = '#f9a8d4';
    result.style.display = 'none';

    const isId = /^\d+$/.test(input);
    const param = isId ? `u=${input}` : `u=${encodeURIComponent(input)}&type=string`;

    try {
        const results = await Promise.all([0,1,2,3].map(m => osuFetch(`${param}&m=${m}`)));
        const modeData = results.map(r => (r && r.length > 0) ? r[0] : null);
        visitorModeData = modeData;
        visitorCurrentMode = 0;
        const u = modeData[0];
        if (!u) { status.innerText = t('osu_not_found') || 'Not found'; status.style.color = '#ff5252'; return; }

        status.innerText = '';
        document.getElementById('visitor-avatar').src = osuAvatarUrl(u.user_id);
        document.getElementById('visitor-result-name').textContent = u.username;
        document.getElementById('visitor-result-country').textContent = COUNTRY_NAMES[u.country] || u.country;

        const modeNames = ['⭕ Standard', '🥁 Taiko', '🍎 Catch', '🎹 Mania'];
        const grid = document.getElementById('visitor-modes-grid');
        grid.innerHTML = modeData.map((m, i) => {
            if (!m || m.pp_raw == null) return `<div class="visitor-mode-mini"><div class="visitor-mode-name">${modeNames[i]}</div><div class="visitor-mode-pp">—</div></div>`;
            return `<div class="visitor-mode-mini"><div class="visitor-mode-name">${modeNames[i]}</div><div class="visitor-mode-pp">${Math.round(parseFloat(m.pp_raw)).toLocaleString()}</div></div>`;
        }).join('');

        const totalPP = modeData.reduce((sum, m) => sum + (m && m.pp_raw != null ? parseFloat(m.pp_raw) : 0), 0);
        document.getElementById('visitor-total-pp-value').textContent = Math.round(totalPP).toLocaleString();
        result.style.display = 'block';

        visitorLookupUserId = u.user_id;
        document.querySelectorAll('#visitor-recent-mode-tabs .osu-mode-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('#visitor-recent-mode-tabs .osu-mode-tab[data-mode="0"]').classList.add('active');
        renderOsuRecentPlays(u.user_id, 0, 'visitor-recent-list', 'visitor-recent-plays');
    } catch (e) {
        console.error('Visitor lookup failed:', e);
        status.innerText = 'Error';
        status.style.color = '#ff5252';
    }
}

/* ===== PP calculator + strain graph =====
   Recomputes stars/PP for arbitrary mods/accuracy and renders a difficulty-
   over-time curve, via the osu-pp function (rosu-pp-js parsing the raw .osu
   file server-side — the v1 API used elsewhere in this file has no mod-aware
   recalculation or strain data). */
function findOsuSetById(setId) {
    const col = getOsuCollection();
    for (const mode of OSU_MODES) {
        const found = col[mode].find(s => s.beatmapset_id === setId);
        if (found) return found;
    }
    return null;
}

const PP_MOD_GROUPS = {
    DT: ['DT', 'NC', 'HT'], NC: ['DT', 'NC', 'HT'], HT: ['DT', 'NC', 'HT'],
    EZ: ['EZ', 'HR'], HR: ['EZ', 'HR'],
    SD: ['SD', 'PF'], PF: ['SD', 'PF'],
};
const PP_MOD_LIST = ['EZ', 'HR', 'HD', 'HT', 'DT', 'NC', 'FL', 'SD', 'PF', 'NF'];

let ppCalcState = null;

function openPpCalcModal(setId, event) {
    if (event) event.stopPropagation();
    const set = findOsuSetById(setId);
    if (!set || !set.beatmaps.length) return;

    const hardest = set.beatmaps[set.beatmaps.length - 1];
    ppCalcState = { setId, beatmapId: hardest.beatmap_id, mods: new Set() };

    document.getElementById('pp-calc-title').textContent = `${set.artist} - ${set.title}`;
    document.getElementById('pp-calc-diff-select').innerHTML = set.beatmaps.map(b =>
        `<option value="${b.beatmap_id}" ${b.beatmap_id === hardest.beatmap_id ? 'selected' : ''}>${escHtml(b.version)} (${b.difficulty_rating.toFixed(2)}★)</option>`
    ).join('');

    document.getElementById('pp-calc-acc').value = 100;
    document.getElementById('pp-calc-status').innerText = '';
    document.getElementById('pp-calc-result').style.display = 'none';
    document.getElementById('pp-calc-graph-wrap').style.display = 'none';
    renderPpCalcMods();

    document.getElementById('pp-calc-modal').style.display = 'flex';
}

function closePpCalcModal() {
    document.getElementById('pp-calc-modal').style.display = 'none';
}

function selectPpCalcDiff(beatmapIdStr) {
    if (!ppCalcState) return;
    ppCalcState.beatmapId = parseInt(beatmapIdStr);
    document.getElementById('pp-calc-status').innerText = '';
    document.getElementById('pp-calc-result').style.display = 'none';
    document.getElementById('pp-calc-graph-wrap').style.display = 'none';
}

function togglePpCalcMod(mod) {
    if (!ppCalcState) return;
    const group = PP_MOD_GROUPS[mod];
    if (ppCalcState.mods.has(mod)) {
        ppCalcState.mods.delete(mod);
    } else {
        if (group) group.forEach(m => ppCalcState.mods.delete(m));
        ppCalcState.mods.add(mod);
    }
    renderPpCalcMods();
    document.getElementById('pp-calc-result').style.display = 'none';
    document.getElementById('pp-calc-graph-wrap').style.display = 'none';
}

function renderPpCalcMods() {
    document.getElementById('pp-calc-mods-row').innerHTML = PP_MOD_LIST.map(mod =>
        `<button type="button" class="pp-calc-mod-chip ${ppCalcState.mods.has(mod) ? 'active' : ''}" onclick="togglePpCalcMod('${mod}')">${mod}</button>`
    ).join('');
}

async function osuPpFetch(beatmapId, mods, accList, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const params = new URLSearchParams({ id: beatmapId, mods, acc: accList.join(',') });
    let res;
    try {
        res = await fetch(`/.netlify/functions/osu-pp?${params.toString()}`, { signal: controller.signal });
    } catch (e) {
        if (e.name === 'AbortError') throw new Error(`${timeoutMs / 1000}s timeout`);
        throw e;
    } finally {
        clearTimeout(timer);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    return data;
}

async function runPpCalc() {
    if (!ppCalcState) return;
    const acc = parseFloat(document.getElementById('pp-calc-acc').value);
    const status = document.getElementById('pp-calc-status');
    document.getElementById('pp-calc-result').style.display = 'none';
    document.getElementById('pp-calc-graph-wrap').style.display = 'none';

    if (!Number.isFinite(acc) || acc < 0 || acc > 100) {
        status.innerText = t('pp_calc_acc_invalid');
        status.style.color = '#ff5252';
        return;
    }

    status.innerText = t('pp_calc_calculating');
    status.style.color = '#c8a2e0';

    const accList = [...new Set([acc, 95, 98, 100])].sort((a, b) => a - b);
    const modsStr = [...ppCalcState.mods].join('');

    try {
        const data = await osuPpFetch(ppCalcState.beatmapId, modsStr, accList);
        status.innerText = '';
        renderPpCalcResult(data);
    } catch (e) {
        console.error('PP calc failed:', e);
        status.innerText = `${t('pp_calc_error')}${e.message ? ' (' + e.message + ')' : ''}`;
        status.style.color = '#ff5252';
    }
}

function strainChartSvg(values, sectionLengthMs) {
    const width = 600, height = 140;
    const padL = 6, padR = 6, padT = 10, padB = 20;
    const innerW = width - padL - padR;
    const innerH = height - padT - padB;
    const n = values.length;
    const maxV = Math.max(1, ...values);

    const xPos = i => padL + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
    const yPos = v => padT + innerH - (v / maxV) * innerH;

    const pts = values.map((v, i) => `${xPos(i)},${yPos(v)}`).join(' ');
    const areaPts = `${padL},${padT + innerH} ${pts} ${padL + innerW},${padT + innerH}`;

    const totalSec = Math.round((n * sectionLengthMs) / 1000);
    const fmtTime = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

    const baseline = `<line x1="${padL}" y1="${padT + innerH}" x2="${padL + innerW}" y2="${padT + innerH}" class="trend-chart-grid" />`;
    const xLabels = `<text x="${padL}" y="${height - 4}" text-anchor="start" class="trend-chart-axis-label">0:00</text>
        <text x="${padL + innerW}" y="${height - 4}" text-anchor="end" class="trend-chart-axis-label">${fmtTime(totalSec)}</text>`;

    return `<svg viewBox="0 0 ${width} ${height}" class="strain-chart-svg" preserveAspectRatio="none">
        <polygon points="${areaPts}" class="strain-chart-fill" />
        <polyline points="${pts}" class="strain-chart-line" />
        ${baseline}${xLabels}
    </svg>`;
}

function renderPpCalcResult(data) {
    const resultEl = document.getElementById('pp-calc-result');
    const boxes = [`<div class="osu-stat"><div class="osu-stat-value">${data.stars.toFixed(2)}⭐</div><div class="osu-stat-label">${t('pp_calc_stars_label')}</div></div>`];
    Object.keys(data.pp).map(Number).sort((a, b) => a - b).forEach(acc => {
        boxes.push(`<div class="osu-stat"><div class="osu-stat-value">${Math.round(data.pp[acc])}pp</div><div class="osu-stat-label">${acc}%</div></div>`);
    });
    resultEl.innerHTML = boxes.join('');
    resultEl.style.display = 'grid';

    const graphWrap = document.getElementById('pp-calc-graph-wrap');
    if (data.strains && data.strains.values && data.strains.values.length) {
        graphWrap.innerHTML = `<div class="pp-calc-section-label">${t('pp_calc_strain_title')}</div>
            <div class="trend-chart-wrap">${strainChartSvg(data.strains.values, data.strains.sectionLength)}</div>`;
    } else {
        graphWrap.innerHTML = `<p class="osu-empty">${t('pp_calc_strain_unsupported')}</p>`;
    }
    graphWrap.style.display = 'block';
}

/* ===== Shareable stats card =====
   Draws a downloadable PNG summary (avatar, rank, PP, accuracy, playcount)
   for either the owner's profile or a visitor lookup result, entirely on
   a canvas — the avatar is fetched through the same-origin osu-avatar
   function, so it never taints the canvas. */
function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function loadImageEl(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

const STATS_CARD_MODE_NAMES = ['⭕ Standard', '🥁 Taiko', '🍎 Catch', '🎹 Mania'];

async function generateStatsCard({ avatarUrl, username, country, modeLabel, rank, pp, accuracy, playcount }) {
    const width = 640, height = 320;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, '#1a0b2e');
    bgGrad.addColorStop(1, '#2d1b4e');
    ctx.fillStyle = bgGrad;
    roundRectPath(ctx, 0, 0, width, height, 20);
    ctx.fill();
    ctx.strokeStyle = 'rgba(192,132,252,0.5)';
    ctx.lineWidth = 2;
    roundRectPath(ctx, 1, 1, width - 2, height - 2, 20);
    ctx.stroke();

    try {
        const avatarImg = await loadImageEl(avatarUrl);
        ctx.save();
        ctx.beginPath();
        ctx.arc(80, 80, 44, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatarImg, 36, 36, 88, 88);
        ctx.restore();
    } catch (e) {
        console.error('Avatar load failed for stats card:', e);
    }
    ctx.strokeStyle = 'rgba(244,114,182,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(80, 80, 44, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(username, 144, 68);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '15px sans-serif';
    ctx.fillText(`${country} · ${modeLabel}`, 144, 94);

    const stats = [[t('osu_stat_global'), rank], ['PP', pp], [t('osu_stat_accuracy'), accuracy], [t('osu_stat_playcount'), playcount]];
    const boxGap = 10;
    const boxW = (width - 48 - boxGap * 3) / 4, boxY = 160, boxH = 100;
    stats.forEach(([label, value], i) => {
        const x = 24 + i * (boxW + boxGap);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        roundRectPath(ctx, x, boxY, boxW, boxH, 12);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        roundRectPath(ctx, x, boxY, boxW, boxH, 12);
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.fillStyle = '#f9a8d4';
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText(String(value), x + boxW / 2, boxY + 46);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '12px sans-serif';
        ctx.fillText(label, x + boxW / 2, boxY + 72);
        ctx.textAlign = 'left';
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '12px sans-serif';
    ctx.fillText(location.host, width / 2, height - 16);
    ctx.textAlign = 'left';

    return canvas;
}

async function downloadStatsCardFor(u, mode) {
    if (!u) return;
    try {
        const canvas = await generateStatsCard({
            avatarUrl: osuAvatarUrl(u.user_id),
            username: u.username,
            country: COUNTRY_NAMES[u.country] || u.country,
            modeLabel: STATS_CARD_MODE_NAMES[mode],
            rank: u.pp_rank != null ? '#' + parseInt(u.pp_rank).toLocaleString() : '—',
            pp: u.pp_raw != null ? Math.round(parseFloat(u.pp_raw)).toLocaleString() : '—',
            accuracy: u.accuracy != null ? parseFloat(u.accuracy).toFixed(2) + '%' : '—',
            playcount: u.playcount != null ? parseInt(u.playcount).toLocaleString() : '—',
        });
        canvas.toBlob(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `osu-stats-${u.username}-${STATS_CARD_MODE_NAMES[mode].replace(/[^\w]+/g, '')}.png`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            showShareToast(t('stats_card_done'));
        }, 'image/png');
    } catch (e) {
        console.error('Stats card generation failed:', e);
        showShareToast(t('stats_card_fail'));
    }
}

function downloadOwnStatsCard() {
    downloadStatsCardFor(osuModeData[osuCurrentMode], osuCurrentMode);
}

function downloadVisitorStatsCard() {
    downloadStatsCardFor(visitorModeData[visitorCurrentMode], visitorCurrentMode);
}
