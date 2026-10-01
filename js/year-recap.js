/* ===== 收藏年度回顧 — a Wrapped-style summary of one year of collecting =====
   Everything comes from the local collection's addedAt dates (plus the
   private ratings from 筆記與評分), so it needs no network. The card shown
   in the modal is exactly what 下載圖卡 rasterises (html-to-image, like the
   other share cards); it holds no cross-origin images so the capture can't
   be tainted. Sets imported from a backup keep their original addedAt, so a
   big import day shows up as a big day. */

function recapLocale() {
    if (siteLang === 'zh') return 'zh-TW';
    if (siteLang === 'zh-Hans') return 'zh-CN';
    return siteLang;
}

/* Every set once (a set lives in one mode list), with its mode and a valid date. */
function recapAllSets() {
    const col = getOsuCollection();
    const seen = new Set();
    const out = [];
    for (const mode of OSU_MODES) {
        for (const s of col[mode]) {
            const when = new Date(s.addedAt);
            if (seen.has(s.beatmapset_id) || isNaN(when)) continue;
            seen.add(s.beatmapset_id);
            out.push({ set: s, mode, when });
        }
    }
    return out;
}

function recapCount(map, key, label) {
    const e = map.get(key) || { key, label, n: 0 };
    e.n++;
    map.set(key, e);
}

function recapTop(map, limit) {
    return [...map.values()].sort((a, b) => (b.n - a.n) || a.label.localeCompare(b.label)).slice(0, limit);
}

function recapStats(all, year) {
    const items = all.filter(e => e.when.getFullYear() === year).sort((a, b) => a.when - b.when);
    const prev = all.filter(e => e.when.getFullYear() === year - 1).length;
    const months = new Array(12).fill(0);
    const days = new Map(), artists = new Map(), langs = new Map(), modes = new Map();
    const stars = [];
    for (const { set, mode, when } of items) {
        months[when.getMonth()]++;
        const dayKey = `${when.getFullYear()}-${when.getMonth()}-${when.getDate()}`;
        const d = days.get(dayKey) || { when, n: 0 };
        d.n++;
        days.set(dayKey, d);
        const lead = primaryArtist(set.artist);
        if (lead) recapCount(artists, lead.toLowerCase(), lead);
        // osu!'s own "Other" language (14) is folded into the legend's 其他.
        const langId = set.language && set.language.id;
        if (langId === 14) recapCount(langs, 'other', t('recap_other'));
        else {
            const lang = osuLangName(set) || t('lang_unknown');
            recapCount(langs, lang, lang);
        }
        recapCount(modes, mode, OSU_MODE_LABELS[OSU_MODES.indexOf(mode)]);
        // Same 平均星數 definition as the collection's stat tile: every difficulty.
        for (const b of set.beatmaps || []) if (b.difficulty_rating > 0) stars.push(b.difficulty_rating);
    }
    const notes = typeof getOsuSetNotes === 'function' ? getOsuSetNotes() : {};
    let topRated = null;
    for (const e of items) {
        const r = notes[e.set.beatmapset_id] ? notes[e.set.beatmapset_id].rating : 0;
        // >= : among equal ratings the later-collected song wins.
        if (r && (!topRated || r >= topRated.rating)) topRated = { ...e, rating: r };
    }
    const busiestMonth = months.reduce((best, n, i) => (n > months[best] ? i : best), 0);
    const busiestDay = [...days.values()].sort((a, b) => (b.n - a.n) || (a.when - b.when))[0] || null;
    return {
        year, items, prev, months, busiestMonth, busiestDay, topRated,
        // Only artists with two or more songs: a list of one-song artists
        // would just be alphabetical.
        artists: recapTop(artists, 5).filter(a => a.n >= 2),
        langs: recapTop(langs, 99),
        topMode: recapTop(modes, 1)[0] || null,
        avgStars: stars.length ? stars.reduce((a, b) => a + b, 0) / stars.length : 0,
    };
}

function openYearRecapModal() {
    const modal = document.getElementById('year-recap-modal');
    const sel = document.getElementById('year-recap-year');
    if (!modal || !sel) return;
    const years = [...new Set(recapAllSets().map(e => e.when.getFullYear()))].sort((a, b) => b - a);
    sel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
    sel.style.display = years.length ? '' : 'none';
    document.getElementById('year-recap-download').style.display = years.length ? '' : 'none';
    modal.style.display = 'flex';
    if (!years.length) {
        document.getElementById('year-recap-body').innerHTML = `<p class="osu-empty">${escHtml(t('osu_empty_collection'))}</p>`;
        return;
    }
    const thisYear = new Date().getFullYear();
    const pick = years.includes(thisYear) ? thisYear : years[0];
    sel.value = String(pick);
    renderYearRecap(pick);
}

function closeYearRecapModal() {
    const modal = document.getElementById('year-recap-modal');
    if (modal) modal.style.display = 'none';
}

function recapSongLine(label, e, extra) {
    if (!e) return '';
    return `<div class="recap-song"><div class="recap-song-label">${escHtml(label)}</div><div class="recap-song-name">${escHtml(`${e.set.artist} - ${e.set.title}`)}${extra || ''}</div></div>`;
}

function renderYearRecap(yearValue) {
    const body = document.getElementById('year-recap-body');
    if (!body) return;
    const year = Number(yearValue);
    const s = recapStats(recapAllSets(), year);
    const download = document.getElementById('year-recap-download');
    if (!s.items.length) {
        body.innerHTML = `<p class="osu-empty">${escHtml(t('recap_empty'))}</p>`;
        if (download) download.style.display = 'none';
        return;
    }
    if (download) download.style.display = '';

    const locale = recapLocale();
    const monthName = i => new Date(year, i, 1).toLocaleDateString(locale, { month: 'short' });
    const songs = n => escHtml(t('recap_songs', { n: n.toLocaleString(locale) }));
    const total = s.items.length;

    let delta = '';
    if (s.prev > 0) {
        const pct = Math.round(((total - s.prev) / s.prev) * 100);
        delta = `<div class="recap-delta ${pct >= 0 ? 'up' : 'down'}">${escHtml(t('recap_vs_last', { sign: pct >= 0 ? '+' : '', n: pct }))}</div>`;
    }
    const user = typeof getLoggedInOsuUser === 'function' ? getLoggedInOsuUser() : null;
    const tile = (label, value) => `<div class="recap-tile"><div class="recap-tile-value">${value}</div><div class="recap-tile-label">${escHtml(label)}</div></div>`;
    const maxMonth = Math.max(...s.months);
    const monthBars = s.months.map((n, i) => `
        <div class="recap-month${i === s.busiestMonth ? ' top' : ''}">
            <div class="recap-month-count">${n || ''}</div>
            <div class="recap-month-track"><div class="recap-month-bar" style="height:${maxMonth ? Math.max(n ? 4 : 0, Math.round((n / maxMonth) * 100)) : 0}%"></div></div>
            <div class="recap-month-label">${escHtml(monthName(i))}</div>
        </div>`).join('');
    const maxArtist = s.artists.length ? s.artists[0].n : 1;
    const artists = s.artists.map((a, i) => `
        <div class="recap-artist">
            <span class="recap-rank">${i + 1}</span>
            <span class="recap-artist-name">${escHtml(a.label)}</span>
            <span class="recap-artist-count">${a.n}</span>
            <div class="recap-artist-bar" style="width:${Math.round((a.n / maxArtist) * 100)}%"></div>
        </div>`).join('');
    // Top four languages; the rest and osu!'s own "Other" share one 其他.
    const named = s.langs.filter(l => l.key !== 'other');
    const langTop = named.slice(0, 4);
    const langRest = named.slice(4).reduce((n, l) => n + l.n, 0)
        + s.langs.filter(l => l.key === 'other').reduce((n, l) => n + l.n, 0);
    if (langRest) langTop.push({ label: t('recap_other'), n: langRest });
    const langColors = ['#f472b6', '#c084fc', '#60a5fa', '#34d399', '#9ca3af'];
    const langBar = langTop.map((l, i) => `<span style="width:${(l.n / total) * 100}%;background:${langColors[i]}"></span>`).join('');
    const langLegend = langTop.map((l, i) => `<div class="recap-lang"><i style="background:${langColors[i]}"></i>${escHtml(l.label)} <b>${Math.round((l.n / total) * 100)}%</b></div>`).join('');

    body.innerHTML = `
        <div class="recap-card" id="year-recap-card">
            <div class="recap-head">
                <div class="recap-kicker">${escHtml(t('site_title'))}</div>
                <div class="recap-title">${escHtml(t('recap_title', { year }))}</div>
                ${user && user.username ? `<div class="recap-user">${escHtml(user.username)}</div>` : ''}
            </div>
            <div class="recap-hero">
                <div class="recap-big">${total.toLocaleString(locale)}</div>
                <div class="recap-big-label">${escHtml(t('recap_total_label'))}</div>
                ${delta}
            </div>
            <div class="recap-tiles">
                ${tile(t('recap_top_month'), `${escHtml(monthName(s.busiestMonth))} · ${songs(s.months[s.busiestMonth])}`)}
                ${s.busiestDay ? tile(t('recap_top_day'), `${escHtml(s.busiestDay.when.toLocaleDateString(locale, { month: 'short', day: 'numeric' }))} · ${songs(s.busiestDay.n)}`) : ''}
                ${tile(t('recap_avg_stars'), `${s.avgStars.toFixed(2)}★`)}
                ${s.topMode ? tile(t('recap_top_mode'), `${escHtml(s.topMode.label)} · ${Math.round((s.topMode.n / total) * 100)}%`) : ''}
            </div>
            <div class="recap-section">
                <div class="recap-section-title">${escHtml(t('recap_by_month'))}</div>
                <div class="recap-months">${monthBars}</div>
            </div>
            <div class="recap-cols">
                ${artists ? `<div class="recap-section"><div class="recap-section-title">${escHtml(t('recap_top_artists'))}</div>${artists}</div>` : ''}
                <div class="recap-section">
                    <div class="recap-section-title">${escHtml(t('recap_languages'))}</div>
                    <div class="recap-lang-bar">${langBar}</div>
                    <div class="recap-lang-legend">${langLegend}</div>
                </div>
            </div>
            <div class="recap-songs">
                ${recapSongLine(t('recap_first_song'), s.items[0])}
                ${total > 1 ? recapSongLine(t('recap_latest_song'), s.items[total - 1]) : ''}
                ${s.topRated ? recapSongLine(t('recap_top_rated'), s.topRated, ` <span class="recap-stars">${'★'.repeat(s.topRated.rating)}</span>`) : ''}
            </div>
            <div class="recap-footer">${escHtml(location.host)}</div>
        </div>`;
}

/* Rasterises a copy of the card at a fixed width, so the image looks the
   same whatever size the modal is (see .recap-card--export). */
async function downloadYearRecapCard() {
    const card = document.getElementById('year-recap-card');
    if (!card) return;
    const copy = card.cloneNode(true);
    copy.removeAttribute('id');
    copy.classList.add('recap-card--export');
    const year = document.getElementById('year-recap-year').value;
    await downloadShareCardPng(copy, `osu-collection-${year}-recap.png`, t('recap_download_done'), t('recap_download_fail'));
}
