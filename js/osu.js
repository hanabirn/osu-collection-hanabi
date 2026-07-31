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

function renderOsuCollection() {
    const container = document.getElementById('osu-collection');
    const paginationEl = document.getElementById('osu-pagination');
    if (!container || !paginationEl) return;
    const col = getOsuCollection();
    let sets;

    if (osuCurrentTab === 'favorites') {
        const favIds = getOsuFavorites();
        const allSets = [...col.standard, ...col.taiko, ...col.catch, ...col.mania];
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
        });
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
            <button class="osu-play-btn" onclick="playOsuPreview(${set.beatmapset_id}, event)" title="播放預覽">&#9654;</button>
            <button class="osu-fav-btn ${isFav ? 'active' : ''}" onclick="toggleOsuFavorite(${set.beatmapset_id}, event)" title="${isFav ? '取消最愛' : '加入最愛'}">♥</button>
            <button class="osu-delete-btn" onclick="event.stopPropagation();removeOsuSet(${set.beatmapset_id})" title="移除">&#x2715;</button>
            <div class="osu-card-info">
                <div class="osu-card-title">${set.title}</div>
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

function switchVisitorRecentMode(mode, el) {
    document.querySelectorAll('#visitor-recent-mode-tabs .osu-mode-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
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
