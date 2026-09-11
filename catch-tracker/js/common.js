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

function playerLink(userId, username) {
    return `<a class="player-link" href="player.html?id=${encodeURIComponent(userId)}">${escapeHtml(username || userId)}</a>`;
}

function mapLink(beatmapId, label) {
    return `<a class="map-link" href="map.html?id=${encodeURIComponent(beatmapId)}">${escapeHtml(label)}</a>`;
}
