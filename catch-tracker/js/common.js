/* Small shared helpers: grade badge rendering, mod formatting, relative
   time, HTML escaping, and a tiny two-language (zh-Hant / en) i18n layer.
   This is a plain-HTML companion site (see the implementation plan for why
   it doesn't reuse the main site's full 8-locale i18n machinery) — just a
   flat string table, since the tracked audience is Taiwan-only. Default
   language is zh (Traditional Chinese) for that reason; en is the fallback
   for anyone else who lands here. */

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

/* ---------- i18n ---------- */

const LANG_STRINGS = {
    zh: {
        nav_rankings: '排行榜', nav_feed: '即時動態',
        loading: '載入中…',
        title_rankings: 'Catch Tracker — 台灣 osu!catch 排名',
        title_feed: 'Catch Tracker — 即時動態',
        h1_rankings: 'osu!catch 排名',
        th_rank: '#', th_player: '玩家', th_pp: 'PP', th_accuracy: '準度', th_playcount: '遊玩次數',
        coverage_rankings: '追蹤 {n} 位台灣 catch 玩家 — 上次更新 {time}',
        coverage_rankings_pending: '追蹤 {n} 位台灣 catch 玩家 — 尚未更新',
        empty_rankings: '目前還沒有已追蹤的台灣 catch 玩家 — 可能第一次排名掃描尚未完成。',
        failed_rankings: '排行榜載入失敗。',
        prev: '← 上一頁', next: '下一頁 →', page_label: '第 {n} 頁',

        h1_feed: '即時分數動態',
        filter_any_grade: '任何評級', filter_fc_only: '僅 FC', filter_choke_only: '僅撞/失敗',
        grade_f_fail: 'F（失敗）',
        th_map: '圖譜', th_mods: 'Mods', th_grade: '評級', th_acc: '準度', th_pp: 'PP', th_when: '時間',
        coverage_feed: '追蹤 {n} 位玩家 — 上次輪詢 {time}（本輪 {done}/{total}）',
        coverage_feed_pending: '追蹤 {n} 位玩家 — 尚未輪詢',
        empty_feed: '目前還沒有任何成績 — 每 5 分鐘會自動輪詢一次。',
        failed_feed: '動態載入失敗。',
        footer_feed: '每 45 秒自動更新一次。Catch Tracker — osu-collection-hanabi 的姊妹站。',

        player_no_id: '未提供玩家 ID。',
        player_not_found: '找不到這位玩家。',
        best_plays: '最佳成績',
        recent_plays: '近期成績（本站已觀測到的）',
        no_best_plays: '尚無可顯示的最佳成績。',
        no_recent_plays: '本站尚未觀測到這位玩家的近期成績。',
        stat_tw: '台灣 #{n}', stat_global: '全球 #{n}', stat_acc: '準度 {acc}', stat_plays: '{n} 次遊玩',

        map_no_id: '未提供圖譜 ID。',
        map_no_scores: '本站尚未在追蹤玩家中觀測到這張圖譜的成績。',
        map_failed: '圖譜統計載入失敗。',
        mapped_by: '圖作者 {creator}',
        grade_distribution: '評級分布',
        mod_usage: 'Mod 使用率',
        tracked_scores: '已追蹤的成績',
        no_data: '尚無資料',
        map_coverage: '僅統計本站在追蹤台灣玩家中觀測到的成績，非完整資料。樣本數 {n}，FC 率 {fc}%。',
        no_scores_short: '無成績資料',

        footer_main: 'Catch Tracker — osu-collection-hanabi 的姊妹站。資料來自官方 osu! API。',

        rel_sec: '{n} 秒前', rel_min: '{n} 分鐘前', rel_hr: '{n} 小時前', rel_day: '{n} 天前',

        search_placeholder: '搜尋玩家…',
        search_no_results: '沒有符合的玩家',
        highlight_best_plays: '近期最佳成績',
        stat_joined: '註冊於 {date}',
        stat_playtime: '遊玩時長 {h} 小時',
        grade_tally: '評級累計',
        most_used_mod: '常用 Mod',
        newest_best: '最新的最佳成績',
        oldest_best: '最舊的最佳成績',
        view_all: '查看全部 →',

        nav_maps: '圖譜庫',
        h1_maps: 'osu!catch 圖譜庫',
        maps_search_placeholder: '搜尋標題、藝術家、作者…',
        status_any: '全部狀態', status_ranked: 'Ranked', status_loved: 'Loved',
        sort_star_desc: '星數 高→低', sort_star_asc: '星數 低→高',
        sort_bpm_desc: 'BPM 高→低', sort_length_desc: '長度 長→短', sort_newest: '最新上榜',
        coverage_maps: '已收錄 {n} 張圖譜（Ranked {ranked}／Loved {loved}）',
        empty_maps: '沒有符合條件的圖譜。',
        failed_maps: '圖譜庫載入失敗。',
        diff_count_suffix: '譜',
    },
    en: {
        nav_rankings: 'Rankings', nav_feed: 'Live Feed',
        loading: 'Loading…',
        title_rankings: 'Catch Tracker — TW osu!catch Rankings',
        title_feed: 'Catch Tracker — Live Feed',
        h1_rankings: 'osu!catch Rankings',
        th_rank: '#', th_player: 'Player', th_pp: 'pp', th_accuracy: 'Accuracy', th_playcount: 'Play Count',
        coverage_rankings: 'Tracking {n} TW catch players — last refreshed {time}',
        coverage_rankings_pending: 'Tracking {n} TW catch players — not yet refreshed',
        empty_rankings: 'No ranked TW catch players tracked yet — the first rankings sweep may not have run.',
        failed_rankings: 'Failed to load rankings.',
        prev: '← Prev', next: 'Next →', page_label: 'Page {n}',

        h1_feed: 'Live Score Feed',
        filter_any_grade: 'Any grade', filter_fc_only: 'FC only', filter_choke_only: 'Choke/fail only',
        grade_f_fail: 'F (fail)',
        th_map: 'Map', th_mods: 'Mods', th_grade: 'Grade', th_acc: 'Acc', th_pp: 'pp', th_when: 'When',
        coverage_feed: 'Tracking {n} players — last poll {time} ({done}/{total} this sweep)',
        coverage_feed_pending: 'Tracking {n} players — not yet polled',
        empty_feed: 'No scores in the feed yet — the score-poll cron runs every 5 minutes.',
        failed_feed: 'Failed to load feed.',
        footer_feed: 'Auto-refreshes every 45s. Catch Tracker — a companion site for osu-collection-hanabi.',

        player_no_id: 'No player id given.',
        player_not_found: 'Player not found.',
        best_plays: 'Best Plays',
        recent_plays: 'Recent Plays (seen by this tracker)',
        no_best_plays: 'No best plays available.',
        no_recent_plays: 'No recent plays observed yet by this tracker.',
        stat_tw: '#{n} TW', stat_global: '#{n} global', stat_acc: '{acc} acc', stat_plays: '{n} plays',

        map_no_id: 'No map id given.',
        map_no_scores: 'No scores observed yet for this map among tracked TW players.',
        map_failed: 'Failed to load map stats.',
        mapped_by: 'mapped by {creator}',
        grade_distribution: 'Grade distribution',
        mod_usage: 'Mod usage',
        tracked_scores: 'Tracked scores',
        no_data: 'No data',
        map_coverage: 'Aggregated only from scores observed among tracked TW players — not exhaustive. Sample size {n}, FC rate {fc}%.',
        no_scores_short: 'No scores',

        footer_main: 'Catch Tracker — a companion site for osu-collection-hanabi. Data via the official osu! API.',

        rel_sec: '{n}s ago', rel_min: '{n}m ago', rel_hr: '{n}h ago', rel_day: '{n}d ago',

        search_placeholder: 'Search players…',
        search_no_results: 'No matching players',
        highlight_best_plays: 'Recent Best Plays',
        stat_joined: 'Joined {date}',
        stat_playtime: '{h}h play time',
        grade_tally: 'Grade Tally',
        most_used_mod: 'Most-used Mod',
        newest_best: 'Newest Best Play',
        oldest_best: 'Oldest Best Play',
        view_all: 'View all →',

        nav_maps: 'Maps',
        h1_maps: 'osu!catch Map Catalog',
        maps_search_placeholder: 'Search title, artist, creator…',
        status_any: 'Any status', status_ranked: 'Ranked', status_loved: 'Loved',
        sort_star_desc: 'Stars high→low', sort_star_asc: 'Stars low→high',
        sort_bpm_desc: 'BPM high→low', sort_length_desc: 'Length long→short', sort_newest: 'Newest',
        coverage_maps: '{n} maps indexed (Ranked {ranked} / Loved {loved})',
        empty_maps: 'No maps match these filters.',
        failed_maps: 'Failed to load the map catalog.',
        diff_count_suffix: ' diffs',
    },
};

function getLang() {
    try {
        const saved = localStorage.getItem('ct_lang');
        if (saved === 'zh' || saved === 'en') return saved;
    } catch { /* ignore */ }
    return 'zh';
}

function setLang(lang) {
    try { localStorage.setItem('ct_lang', lang); } catch { /* ignore */ }
    location.reload();
}

function t(key, vars) {
    const lang = getLang();
    let str = (LANG_STRINGS[lang] && LANG_STRINGS[lang][key]) ?? LANG_STRINGS.en[key] ?? key;
    if (vars) for (const k in vars) str = str.replace(`{${k}}`, vars[k]);
    return str;
}

/* Applies every [data-i18n] element's textContent from the string table —
   called once on page load after common.js/api.js are loaded but before
   the page's own render-*.js populates dynamic content. */
function applyStaticI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    const toggle = document.getElementById('lang-toggle');
    if (toggle) {
        const lang = getLang();
        toggle.textContent = lang === 'zh' ? 'EN' : '中文';
        toggle.addEventListener('click', () => setLang(lang === 'zh' ? 'en' : 'zh'));
    }
    document.documentElement.lang = getLang() === 'zh' ? 'zh-Hant' : 'en';
}
applyStaticI18n();

/* ---------- grade badges / mods / relative time ---------- */

/* A small hue ladder built from the site's own palette (violet primary,
   rose accent) rather than osu!'s literal rank colors — keeps every grade
   badge visually part of the same system instead of an arbitrary rainbow. */
const GRADE_COLORS = {
    XH: '#e2e2f0', X: '#facc15', SH: '#e2e2f0', S: '#facc15',
    A: '#34d399', B: '#38bdf8', C: '#fb923c', D: '#fb5a8c', F: '#f6584f',
};

function gradeBadge(grade) {
    const g = grade || '?';
    const color = GRADE_COLORS[g] || '#9691b8';
    return `<span class="grade-badge" style="--grade-color:${color}">${escapeHtml(g)}</span>`;
}

function fcTag(isFc) {
    return isFc ? '<span class="fc-tag">FC</span>' : '';
}

function formatMods(mods) {
    if (!mods || mods.length === 0) return 'NM';
    return mods.join(',');
}

function modsTag(mods) {
    return `<span class="mods-tag">${escapeHtml(formatMods(mods))}</span>`;
}

function relTime(iso) {
    if (!iso) return '—';
    const diffMs = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diffMs)) return '—';
    const sec = Math.max(0, Math.floor(diffMs / 1000));
    if (sec < 60) return t('rel_sec', { n: sec });
    const min = Math.floor(sec / 60);
    if (min < 60) return t('rel_min', { n: min });
    const hr = Math.floor(min / 60);
    if (hr < 24) return t('rel_hr', { n: hr });
    const day = Math.floor(hr / 24);
    return t('rel_day', { n: day });
}

function fmtPP(pp) {
    return pp != null ? `${Math.round(pp)}pp` : '—';
}

function fmtAccuracy(acc) {
    return acc != null ? `${(acc * 100).toFixed(2)}%` : '—';
}

function fmtLength(seconds) {
    if (seconds == null) return '—';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

function playerLink(userId, username) {
    return `<a class="player-link" href="player.html?id=${encodeURIComponent(userId)}">${escapeHtml(username || userId)}</a>`;
}

function mapLink(beatmapId, label) {
    return `<a class="map-link" href="map.html?id=${encodeURIComponent(beatmapId)}">${escapeHtml(label)}</a>`;
}

// osu!'s stable beatmapset-cover CDN pattern — no extra API call needed,
// every feed/score record already carries beatmapset_id.
function coverArtUrl(beatmapsetId) {
    return beatmapsetId ? `https://assets.ppy.sh/beatmaps/${beatmapsetId}/covers/cover.jpg` : '';
}

// osu!'s "card" cover variant — purpose-cropped to a ~2.8:1 banner (279x100
// measured live off mania-tracker.com/maps, which uses this exact variant
// for its catalog grid), rather than forcing the wider `cover.jpg` hero
// crop into a narrow box via background-size:cover and losing more of the
// image than necessary.
function coverArtUrlCard(beatmapsetId) {
    return beatmapsetId ? `https://assets.ppy.sh/beatmaps/${beatmapsetId}/covers/card.jpg` : '';
}

/* ---------- audio preview button (play icon <-> animated equalizer) ----------
   Plain <audio> playback needs no CORS at all (that's only a Web Audio
   API/AnalyserNode requirement) — the main site's preview waveform feature
   needed a CORS proxy specifically because it reads real frequency data;
   here the bars are a decorative simulated equalizer (per request), not
   driven by actual audio analysis, so this stays a plain <audio> element
   with zero backend involvement. Only one preview plays at a time —
   starting a new one stops whichever card was already playing. */
let _previewAudio = null;
let _previewBtn = null;

function stopPreview() {
    if (_previewAudio) _previewAudio.pause();
    if (_previewBtn) _previewBtn.classList.remove('playing');
    _previewAudio = null;
    _previewBtn = null;
}

function togglePreview(beatmapsetId, btn) {
    const wasThisBtn = _previewBtn === btn;
    stopPreview();
    if (wasThisBtn) return; // clicking the currently-playing card's button just stops it

    const audio = new Audio(`https://b.ppy.sh/preview/${beatmapsetId}.mp3`);
    audio.volume = 0.6;
    audio.addEventListener('ended', stopPreview);
    audio.addEventListener('error', stopPreview);
    audio.play().catch(stopPreview);
    btn.classList.add('playing');
    _previewAudio = audio;
    _previewBtn = btn;
}

function previewButton(beatmapsetId) {
    if (!beatmapsetId) return '';
    return `<button type="button" class="preview-btn" onclick="event.stopPropagation();togglePreview(${beatmapsetId},this)" title="Preview">
        <svg class="icon-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        <span class="icon-eq"><span></span><span></span><span></span><span></span><span></span></span>
    </button>`;
}

// Small inline-SVG status badges matching osu!'s own iconography (blue
// double-chevron for ranked, pink heart for loved) instead of a plain
// text pill — see the reference screenshot in conversation.
const STATUS_ICONS = {
    ranked: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 14 12 8 18 14"></polyline><polyline points="6 20 12 14 18 20"></polyline></svg>',
    loved: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-6.716-4.35-9.428-8.014C.29 9.86 1.1 6.2 4.2 4.9c2.1-.88 4.42-.1 5.8 1.62C11.38 4.8 13.7 4.02 15.8 4.9c3.1 1.3 3.91 4.96 1.63 8.086C18.716 16.65 12 21 12 21z"/></svg>',
};
function statusIcon(status) {
    const svg = STATUS_ICONS[status];
    return svg ? `<span class="status-icon ${status}" title="${escapeHtml(status)}">${svg}</span>` : '';
}

// Label text + icon to its right, e.g. "RANKED [chevrons]" / "LOVED [heart]".
/* Star-rating colour scale + catch-mode icon shape, ported verbatim from
   the main osu-collection site's js/osu.js (same STAR_COLOR_STOPS table,
   same liftForContrast() dark-card-background fix, same catch glyph) so
   Catch Tracker's difficulty icons read as visually "the same language"
   as the main site's own beatmap cards, per request. */
const CATCH_ICON_PATH = '<circle cx="50" cy="50" r="41"/><circle cx="50" cy="38" r="7" fill="currentColor" stroke="none"/><circle cx="38" cy="60" r="5.5" fill="currentColor" stroke="none"/><circle cx="62" cy="60" r="5.5" fill="currentColor" stroke="none"/>';
const STAR_COLOR_STOPS = [
    [0.1, [79, 192, 255]],
    [1.25, [79, 192, 255]],
    [2.0, [79, 255, 213]],
    [2.5, [124, 255, 79]],
    [3.3, [246, 240, 92]],
    [4.2, [255, 128, 104]],
    [4.9, [255, 78, 111]],
    [5.8, [198, 69, 184]],
    [6.7, [101, 99, 222]],
    [7.7, [24, 21, 142]],
    [9.0, [0, 0, 0]],
];
function liftForContrast(rgb, minLum = 92) {
    const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    if (lum >= minLum) return rgb;
    const r = (minLum - lum) / (255 - lum);
    return rgb.map(v => v + (255 - v) * r);
}
function rgbHex(rgb) {
    return '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function starRatingColor(stars) {
    stars = Number(stars) || 0;
    const stops = STAR_COLOR_STOPS;
    if (stars <= 0) return '#888';
    if (stars <= stops[0][0]) return rgbHex(liftForContrast(stops[0][1]));
    for (let i = 1; i < stops.length; i++) {
        if (stars <= stops[i][0]) {
            const [s0, c0] = stops[i - 1];
            const [s1, c1] = stops[i];
            const t = (stars - s0) / (s1 - s0);
            return rgbHex(liftForContrast(c0.map((v, idx) => v + (c1[idx] - v) * t)));
        }
    }
    return rgbHex(liftForContrast(stops[stops.length - 1][1]));
}
function diffIcon(beatmapId, stars, label) {
    const color = starRatingColor(stars);
    const starsStr = (Number(stars) || 0).toFixed(2);
    const title = label ? `${label} ${starsStr} ★` : `${starsStr} ★`;
    return `<a class="diff-icon" href="map.html?id=${encodeURIComponent(beatmapId)}" title="${escapeHtml(title)}" onclick="event.stopPropagation()" style="color:${color}">
        <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="6">${CATCH_ICON_PATH}</svg>
    </a>`;
}

function statusBadge(status) {
    if (!STATUS_ICONS[status]) return '';
    const label = status === 'ranked' ? t('status_ranked') : t('status_loved');
    return `<span class="map-status-badge ${status}">${escapeHtml(label)}${statusIcon(status)}</span>`;
}

function highlightCard(s) {
    const cover = coverArtUrl(s.beatmapset_id);
    const style = cover ? ` style="background-image:url('${cover.replace(/'/g, '%27')}')"` : '';
    return `<a class="highlight-card" href="map.html?id=${encodeURIComponent(s.beatmap_id)}"${style}>
        <div class="highlight-pp">${fmtPP(s.pp)}</div>
        <div class="highlight-player">${escapeHtml(s.username || '')}</div>
        <div class="highlight-map">${escapeHtml(s.title || '')} [${escapeHtml(s.version || '')}]</div>
        <div class="highlight-when">${relTime(s.created_at)}</div>
    </a>`;
}

/* ---------- header player search (every page) ---------- */

/* Injected into the header rather than hand-added to all 4 HTML files —
   searches the already-cached rankings:TW dataset server-side
   (rankings-list.js's `q` param), so this needs no new dataset of its own. */
function initPlayerSearch() {
    const toggle = document.getElementById('lang-toggle');
    if (!toggle || !toggle.parentElement) return;

    const wrap = document.createElement('div');
    wrap.className = 'search-wrap';
    wrap.innerHTML = `
        <input type="text" id="player-search-input" class="search-input" placeholder="${escapeHtml(t('search_placeholder'))}" autocomplete="off">
        <div class="search-results" id="player-search-results" hidden></div>
    `;
    toggle.parentElement.insertBefore(wrap, toggle);

    const input = wrap.querySelector('#player-search-input');
    const results = wrap.querySelector('#player-search-results');
    let debounceTimer = null;

    async function runSearch(q) {
        try {
            const data = await apiGet('rankings-list', { q, limit: 8 });
            if (!data.items.length) {
                results.innerHTML = `<div class="search-empty">${escapeHtml(t('search_no_results'))}</div>`;
            } else {
                results.innerHTML = data.items.map(r => `
                    <a class="search-result-row" href="player.html?id=${encodeURIComponent(r.user_id)}">
                        <img class="avatar" src="${escapeHtml(r.avatar_url || '')}" alt="">
                        <span>${escapeHtml(r.username)}</span>
                        <span class="search-result-pp">${fmtPP(r.pp)}</span>
                    </a>`).join('');
            }
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
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) results.hidden = true; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { results.hidden = true; input.blur(); } });
}

/* ---------- decorative background: falling bananas ----------
   osu!catch's default skin uses a banana for the spinner — a light,
   purely decorative nod to that. Desktop-only and skipped under
   prefers-reduced-motion, matching the main site's own restraint around
   background animation (it stripped a heavier particle effect for mobile
   thermal reasons — see project memory). transform-only keyframe (no
   layout properties), a handful of elements, no blur/shadow. */
function initBananaRain() {
    if (window.matchMedia('(max-width: 700px)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const container = document.createElement('div');
    container.className = 'banana-rain';
    container.setAttribute('aria-hidden', 'true');
    const COUNT = 7;
    for (let i = 0; i < COUNT; i++) {
        const span = document.createElement('span');
        span.textContent = '🍌';
        span.style.left = `${(i / COUNT) * 100 + Math.random() * (100 / COUNT) * 0.6}%`;
        span.style.fontSize = `${16 + Math.random() * 14}px`;
        span.style.opacity = (0.14 + Math.random() * 0.18).toFixed(2);
        span.style.animationDuration = `${16 + Math.random() * 12}s`;
        span.style.animationDelay = `${-Math.random() * 25}s`;
        container.appendChild(span);
    }
    document.body.prepend(container);
}
initBananaRain();
// common.js is loaded at the end of <body>, after the header markup, so the
// DOM is already parsed — no need to wait for DOMContentLoaded here.
initPlayerSearch();
