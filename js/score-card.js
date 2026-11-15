/* ===== 成績卡 (score card) =====
   One score shown as a full card, laid out after the score panels osu!
   bots post in chat: the player along the top over the map's cover, the
   map's difficulty, curve and stats on the left, a large grade in the
   middle, and PP, score, accuracy, combo and judgements on the right.
   Built from what the site already fetches: the v1 score itself, the
   player (get_user), the difficulty (get_beatmaps) and osu-pp (rosu-pp on
   the .osu file) for mod-adjusted stars/AR/OD/CS/HP, the FC and SS PP and
   the difficulty curve. "下載圖片" renders it to a PNG (html-to-image, the
   same path as the stats share card).

   openScoreCard({ score, beatmapId, mode, lbRank }) — score is a v1
   get_scores / get_user_best row. */

let scoreCardOpener = null;
let scoreCardReq = 0;

const SC_GRADE_LABEL = { XH: 'SS', X: 'SS', SH: 'S', S: 'S', A: 'A', B: 'B', C: 'C', D: 'D', F: 'F' };
const SC_GRADE_ACCENT = { ss: '#ffcf4d', s: '#ffc23d', silver: '#cfe0f5', a: '#3ee6a8', b: '#4ea3ff', c: '#c77dff', d: '#ff6b6b', f: '#9aa4b2' };
const SC_MOD_GROUP = {
    EZ: 'down', NF: 'down', HT: 'down',
    HR: 'up', SD: 'up', PF: 'up', DT: 'up', NC: 'up', HD: 'up', FL: 'up',
    RX: 'auto', AP: 'auto', SO: 'auto',
    TD: 'system', V2: 'system',
};

/* "6.23" -> 6<small>.23</small>, the way score panels set big numbers. */
function scBigNum(value, digits) {
    const [i, d] = Number(value).toFixed(digits).split('.');
    return `${Number(i).toLocaleString()}${d ? `<small>.${d}</small>` : ''}`;
}

function scModRate(mods) {
    if (mods.includes('DT') || mods.includes('NC')) return 1.5;
    if (mods.includes('HT')) return 0.75;
    return 1;
}

/* Judgement rows per ruleset, in the order the game shows them. */
function scJudgements(s, mode) {
    const n = (k) => parseInt(s[k], 10) || 0;
    if (mode === 3) return [['MAX', n('countgeki'), 'max'], ['300', n('count300'), 'great'], ['200', n('countkatu'), 'good'], ['100', n('count100'), 'ok'], ['50', n('count50'), 'meh'], ['MISS', n('countmiss'), 'miss']];
    if (mode === 1) return [['GREAT', n('count300'), 'great'], ['OK', n('count100'), 'ok'], ['MISS', n('countmiss'), 'miss']];
    if (mode === 2) return [['FRUIT', n('count300'), 'great'], ['DROP', n('count100'), 'ok'], ['DROPLET', n('count50'), 'meh'], ['MISS', n('countmiss') + n('countkatu'), 'miss']];
    return [['300', n('count300'), 'great'], ['100', n('count100'), 'ok'], ['50', n('count50'), 'meh'], ['MISS', n('countmiss'), 'miss']];
}

/* The difficulty curve the way stream overlays (tosu / gosumemory) draw
   strain: a smoothed, filled area with a bright edge, the peak marked and a
   time axis under it. values are rosu-pp strain sections (sectionLength ms
   each); the curve is downsampled to ~120 points and smoothed with a short
   moving average, then drawn as a Catmull-Rom spline. */
function scSmooth(values, points = 120) {
    const N = Math.min(points, values.length);
    const step = values.length / N;
    const raw = [];
    for (let i = 0; i < N; i++) {
        const a = Math.floor(i * step);
        const slice = values.slice(a, Math.max(Math.floor((i + 1) * step), a + 1));
        raw.push(Math.max(...slice));
    }
    return raw.map((_, i) => {
        const win = raw.slice(Math.max(0, i - 2), i + 3);
        return win.reduce((s, v) => s + v, 0) / win.length;
    });
}
function scSplinePath(pts) {
    let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        d += ` C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
    }
    return d;
}
function scStrainSvg(strains, lengthSec) {
    const values = strains && strains.values;
    if (!Array.isArray(values) || values.length < 4) return '';
    const W = 360, H = 120, PAD = 6;
    const sm = scSmooth(values);
    const max = Math.max(...sm) || 1;
    const pts = sm.map((v, i) => [(i / (sm.length - 1)) * W, H - PAD - (v / max) * (H - PAD * 2)]);
    const line = scSplinePath(pts);
    const peakI = sm.indexOf(Math.max(...sm));
    const [px, py] = pts[peakI];
    const peakSec = lengthSec ? Math.round((peakI / (sm.length - 1)) * lengthSec) : null;
    const grid = [0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${W}" y1="${(H * f).toFixed(1)}" y2="${(H * f).toFixed(1)}"/>`).join('');
    const extra = (strains.lines || []).map((l) => {
        const s2 = scSmooth(l.values);
        const p2 = s2.map((v, i) => [(i / (s2.length - 1)) * W, H - PAD - (v / max) * (H - PAD * 2)]);
        return `<path class="sc-curve-sub sc-curve-${l.key}" d="${scSplinePath(p2)}"/>`;
    }).join('');
    return `<div class="sc-curve-wrap">
        <svg class="sc-strain" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
            <defs>
                <linearGradient id="sc-curve-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--sc-accent)" stop-opacity="0.55"/><stop offset="1" stop-color="var(--sc-accent)" stop-opacity="0"/></linearGradient>
                <linearGradient id="sc-curve-line" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7cc7ff"/><stop offset="0.5" stop-color="var(--sc-accent)"/><stop offset="1" stop-color="#ff7ab8"/></linearGradient>
            </defs>
            <g class="sc-curve-grid">${grid}</g>
            <path class="sc-curve-area" d="${line} L${W},${H} L0,${H} Z" fill="url(#sc-curve-fill)"/>
            ${extra}
            <path class="sc-curve-line" d="${line}" stroke="url(#sc-curve-line)"/>
            <line class="sc-curve-peak-line" x1="${px.toFixed(1)}" x2="${px.toFixed(1)}" y1="${py.toFixed(1)}" y2="${H}"/>
        </svg>
        <span class="sc-curve-peak" style="left:${((px / W) * 100).toFixed(1)}%;top:${((py / H) * 100).toFixed(1)}%"></span>
        ${peakSec != null ? `<span class="sc-curve-peak-label" style="left:${((px / W) * 100).toFixed(1)}%">${escHtml(t('sc_peak'))} ${fmtMapLength(peakSec)}</span>` : ''}
        <div class="sc-curve-axis"><span>0:00</span><span>${lengthSec ? fmtMapLength(lengthSec / 2) : ''}</span><span>${lengthSec ? fmtMapLength(lengthSec) : ''}</span></div>
    </div>`;
}

/* Stat and mod icons are osu!lazer's own, from ppy/osu-resources
   (CC BY-NC 4.0, © ppy Pty Ltd; credited on the 資源 page and in
   assets/osu-resources/README.md): white glyphs the game tints. */
const SC_STAT_ICON = { bpm: 'bpm', length: 'length', cs: 'size', ar: 'approach-rate', od: 'overall-difficulty', hp: 'hp-drain' };
function scStatIcon(key) {
    return `<img class="sc-stat-icon" src="assets/osu-resources/stats/${SC_STAT_ICON[key]}.png" alt="">`;
}

function scStatRow(key, label, value, base, max, digits = 1, unit = '') {
    const pct = Math.max(2, Math.min(100, typeof value === 'string' ? max : (value / max) * 100)); // a string value (length) passes its own percent
    const changed = base != null && (typeof base === 'string' ? base !== value : Math.abs(base - value) > 0.05);
    const up = typeof base !== 'string' && changed && value > base;
    return `<div class="sc-stat sc-stat-${key}">
        <span class="sc-stat-badge">${scStatIcon(key)}</span>
        <div class="sc-stat-main">
            <div class="sc-stat-top"><span class="sc-stat-label">${escHtml(label)}</span>${changed ? `<span class="sc-stat-base ${up ? 'is-up' : 'is-down'}">${up ? '▲' : '▼'} <s>${typeof base === 'string' ? escHtml(base) : Number(base).toFixed(digits)}</s></span>` : ''}</div>
            <b>${typeof value === 'string' ? escHtml(value) : scBigNum(value, digits)}${unit}</b>
            <div class="sc-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
        </div>
    </div>`;
}

/* Mod badges as lazer draws them: a rounded hexagon in the mod type's
   colour with the mod's glyph in a dark tone on top. */
const SC_MOD_FILE = {
    NF: 'no-fail', EZ: 'easy', HD: 'hidden', HR: 'hard-rock', SD: 'sudden-death', PF: 'perfect',
    DT: 'double-time', NC: 'nightcore', HT: 'half-time', FL: 'flashlight', RX: 'relax', AP: 'autopilot',
    SO: 'spun-out', TD: 'touch-device', V2: 'score-v2',
};
function scModBadge(m) {
    const file = SC_MOD_FILE[m];
    const glyph = file ? `<img src="assets/osu-resources/mods/mod-${file}.png" alt="${escHtml(m)}">` : `<b>${escHtml(m)}</b>`;
    return `<span class="sc-mod sc-mod-${SC_MOD_GROUP[m] || 'fun'}" title="${escHtml(m)}"><svg viewBox="0 0 135 100" aria-hidden="true"><path d="M36 6h63a10 10 0 0 1 8.6 5l20 34a10 10 0 0 1 0 10l-20 34a10 10 0 0 1-8.6 5H36a10 10 0 0 1-8.6-5l-20-34a10 10 0 0 1 0-10l20-34A10 10 0 0 1 36 6z"/></svg>${glyph}</span>`;
}

async function openScoreCard({ score, beatmapId, mode = 0, lbRank = null }) {
    const overlay = document.getElementById('score-card');
    const card = document.getElementById('score-card-body');
    if (!overlay || !card || !score) return;
    const req = ++scoreCardReq;
    scoreCardOpener = document.activeElement;
    overlay.hidden = false;
    document.documentElement.classList.add('score-card-open');
    fitScoreCard();
    overlay.querySelector('.score-card-close').focus();
    card.innerHTML = `<p class="sc-loading">${escHtml(t('gallery_loading'))}</p>`;

    const mods = decodeOsuMods(score.enabled_mods);
    const calcMods = mods.filter((m) => m !== 'NF' && m !== 'SO').join('');
    const acc = parseFloat(calcOsuAccuracy(score, mode));
    const needScorePp = score.pp == null || score.pp === '';
    const ppParams = new URLSearchParams({ id: String(beatmapId), mods: calcMods, acc: `${acc},100` });
    const [mapRes, userRes, ppRes, scorePpRes] = await Promise.all([
        osuFetch(`b=${beatmapId}`).catch(() => null),
        osuFetch(`u=${encodeURIComponent(score.user_id)}&m=${mode}`).catch(() => null),
        fetch(`/.netlify/functions/osu-pp?${ppParams}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        needScorePp
            ? fetch(`/.netlify/functions/osu-pp?${new URLSearchParams({ id: String(beatmapId), mods: calcMods, acc: String(acc), combo: String(score.maxcombo || 0), misses: String(score.countmiss || 0) })}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
            : Promise.resolve(null),
    ]);
    if (req !== scoreCardReq || overlay.hidden) return;
    const map = Array.isArray(mapRes) ? mapRes[0] : null;
    const user = Array.isArray(userRes) ? userRes[0] : null;
    if (!map) {
        card.innerHTML = `<p class="sc-loading">${escHtml(t('updates_load_fail'))}</p>`;
        return;
    }

    const setId = map.beatmapset_id;
    // Through this site's own proxy: assets.ppy.sh has no CORS headers, so
    // "下載圖片" couldn't draw a cover loaded straight from there.
    const cover = `/.netlify/functions/osu-cover?id=${encodeURIComponent(setId)}`;
    const rate = scModRate(mods);
    const baseStars = parseFloat(map.difficultyrating) || 0;
    const stars = ppRes && ppRes.stars != null ? ppRes.stars : baseStars;
    const attrs = (ppRes && ppRes.attrs) || {};
    const bpmBase = parseFloat(map.bpm) || 0;
    const lenBase = parseInt(map.total_length, 10) || 0;
    const maxCombo = (ppRes && ppRes.maxCombo) || parseInt(map.max_combo, 10) || 0;
    const scorePp = needScorePp
        ? (scorePpRes && scorePpRes.pp ? scorePpRes.pp[acc] : null)
        : parseFloat(score.pp);
    const fcPp = ppRes && ppRes.pp ? ppRes.pp[acc] : null;
    const ssPp = ppRes && ppRes.pp ? ppRes.pp[100] : null;
    const starPct = Math.max(2, Math.min(100, (stars / 10) * 100));
    const grade = score.rank || 'F';
    const gradeKey = (OSU_RANK_CLASS[grade] || 'f') + (grade === 'XH' || grade === 'SH' ? ' silver' : '');
    const judges = scJudgements(score, mode);
    const judgeMax = Math.max(1, ...judges.map((j) => j[1]));
    const combo = parseInt(score.maxcombo, 10) || 0;
    const isFc = String(score.perfect) === '1';
    const d = new Date(String(score.date || '').replace(' ', 'T') + 'Z');
    const when = isNaN(d) ? '' : d.toLocaleString(siteLang === 'zh' ? 'zh-TW' : undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const modeName = OSU_MODES[mode] || 'standard';
    const uid = encodeURIComponent(score.user_id);

    card.style.setProperty('--sc-cover', `url("${cover}")`);
    card.style.setProperty('--sc-star', starRatingColor(stars));
    // The grade's colour runs through the card: curve, panel edges, glows.
    card.style.setProperty('--sc-accent', SC_GRADE_ACCENT[gradeKey.split(' ').pop() === 'silver' ? 'silver' : (OSU_RANK_CLASS[grade] || 'f')]);
    const strainLines = ppRes && ppRes.strains && mode === 0 && ppRes.strains.aim ? [{ key: 'aim', values: ppRes.strains.aim }, { key: 'speed', values: ppRes.strains.speed || [] }].filter((l) => l.values.length > 3) : [];
    card.innerHTML = `
        <header class="sc-top">
            <a class="sc-player" href="https://osu.ppy.sh/users/${uid}" target="_blank" rel="noopener noreferrer">
                <img class="sc-avatar" src="${osuAvatarUrl(score.user_id)}" alt="" onerror="this.style.visibility='hidden'">
                <span class="sc-player-text">
                    <span class="sc-player-name">${escHtml(score.username || (user && user.username) || '#' + score.user_id)}${user && user.country ? `<img class="sc-flag" src="${flagUrl(user.country)}" alt="${escHtml(user.country)}">` : ''}</span>
                    <span class="sc-player-rank">${user && user.pp_rank ? '#' + Number(user.pp_rank).toLocaleString() : ''}${user && user.pp_country_rank ? ` · ${escHtml(user.country || '')}#${Number(user.pp_country_rank).toLocaleString()}` : ''}</span>
                    <span class="sc-player-sub">${user && user.accuracy ? parseFloat(user.accuracy).toFixed(2) + '%' : ''}${user && user.level ? ` · Lv.${Math.floor(parseFloat(user.level))}` : ''}</span>
                </span>
                <span class="sc-player-pp">${user && user.pp_raw ? Math.round(parseFloat(user.pp_raw)).toLocaleString() : '—'}<small>PP</small></span>
            </a>
            <div class="sc-top-right">
                ${lbRank ? `<span class="sc-chip">${escHtml(t('sc_lb_rank', { n: lbRank }))}</span>` : ''}
                ${when ? `<span class="sc-when">${escHtml(t('sc_played_at', { d: when }))}</span>` : ''}
            </div>
        </header>
        <div class="sc-body">
            <div class="sc-col">
                <section class="sc-panel sc-stars">
                    <div class="sc-stars-row">
                        <span class="sc-mode" aria-hidden="true">${modeIconSvg(modeName, starRatingColor(stars))}</span>
                        <b class="sc-stars-num">${scBigNum(stars, 2)}</b>
                        <span class="sc-stars-diff">${escHtml(map.version || '')}</span>
                        ${Math.abs(stars - baseStars) > 0.005 ? `<span class="sc-stars-base">(${baseStars.toFixed(2)})</span>` : ''}
                    </div>
                    <div class="sc-bar sc-bar-stars"><i style="width:${starPct.toFixed(1)}%;background-size:${(10000 / starPct).toFixed(0)}% 100%"></i></div>
                </section>
                <section class="sc-panel sc-curve">
                    <h3>${escHtml(t('sc_strain'))}${strainLines.length ? '<span class="sc-curve-legend"><i class="is-aim"></i>Aim<i class="is-speed"></i>Speed</span>' : ''}</h3>
                    ${scStrainSvg(ppRes && ppRes.strains ? { values: ppRes.strains.values, lines: strainLines } : null, lenBase / rate) || '<p class="sc-dim">—</p>'}
                </section>
                <section class="sc-panel sc-stats">
                    <h3>${escHtml(t('sc_stats'))}</h3>
                    <div class="sc-stats-grid">
                        ${scStatRow('bpm', 'BPM', bpmBase * rate, bpmBase, 300, 0)}
                        ${scStatRow('length', t('drawer_length'), fmtMapLength(lenBase / rate), fmtMapLength(lenBase), ((lenBase / rate) / 600) * 100, 0)}
                        ${scStatRow('cs', 'CS', attrs.cs != null ? attrs.cs : parseFloat(map.diff_size), parseFloat(map.diff_size), 10)}
                        ${scStatRow('ar', 'AR', attrs.ar != null ? attrs.ar : parseFloat(map.diff_approach), parseFloat(map.diff_approach), 11)}
                        ${scStatRow('od', 'OD', attrs.od != null ? attrs.od : parseFloat(map.diff_overall), parseFloat(map.diff_overall), 11)}
                        ${scStatRow('hp', 'HP', attrs.hp != null ? attrs.hp : parseFloat(map.diff_drain), parseFloat(map.diff_drain), 10)}
                    </div>
                </section>
            </div>
            <div class="sc-col sc-mid">
                <div class="sc-grade-wrap"><span class="sc-grade-rays" aria-hidden="true"></span><span class="sc-grade-ring" aria-hidden="true"></span><div class="sc-grade grade-${gradeKey}" aria-label="${escHtml(SC_GRADE_LABEL[grade] || grade)}">${escHtml(SC_GRADE_LABEL[grade] || grade)}</div></div>
                <div class="sc-mods">${mods.map(scModBadge).join('')}${isFc ? '<span class="sc-fc-tag">FULL COMBO</span>' : ''}</div>
                <section class="sc-panel sc-song">
                    <p class="sc-song-title">${escHtml(map.title || '')}</p>
                    <p class="sc-song-artist">${escHtml(map.artist || '')}</p>
                    <p class="sc-song-foot"><span>${escHtml(map.creator || '')}</span><span>b${escHtml(String(beatmapId))}</span></p>
                </section>
            </div>
            <div class="sc-col">
                <section class="sc-panel sc-pp">
                    <div class="sc-pp-row"><b class="sc-pp-num">${scorePp != null ? Math.round(scorePp).toLocaleString() : '—'}<small>PP</small></b>${fcPp != null && !isFc ? `<span class="sc-pp-fc">/ ${escHtml(t('sc_fc', { n: Math.round(fcPp).toLocaleString() }))}</span>` : ''}</div>
                    <div class="sc-bar sc-bar-pp"><i style="width:${scorePp != null && ssPp ? Math.min(100, (scorePp / ssPp) * 100).toFixed(1) : 0}%"></i></div>
                    <p class="sc-pp-ss">${ssPp != null ? escHtml(t('sc_ss', { n: Math.round(ssPp).toLocaleString() })) : ''}</p>
                </section>
                <section class="sc-panel sc-score-panel">
                    <span class="sc-label">${escHtml(t('sc_score'))}</span>
                    <b class="sc-score-num">${Number(score.score || 0).toLocaleString()}</b>
                </section>
                <section class="sc-panel sc-acc">
                    <div><span class="sc-label">${escHtml(t('osu_stat_accuracy'))}</span><b>${scBigNum(acc, 2)}<small>%</small></b></div>
                    <div><span class="sc-label">Combo</span><b>${combo.toLocaleString()}<small> / ${maxCombo ? maxCombo.toLocaleString() : '—'}</small></b></div>
                </section>
                <section class="sc-panel sc-judge">
                    <h3>${escHtml(t('sc_judgment'))}</h3>
                    ${judges.map(([label, n, cls]) => `<div class="sc-judge-row sc-j-${cls}"><span>${label}</span><div class="sc-bar"><i style="width:${n ? Math.max(2, (n / judgeMax) * 100).toFixed(1) : 0}%"></i></div><b>${n.toLocaleString()}</b></div>`).join('')}
                </section>
            </div>
        </div>`;
    const osuLink = document.getElementById('score-card-osu');
    if (osuLink) osuLink.href = `https://osu.ppy.sh/beatmapsets/${encodeURIComponent(setId)}#${OSU_API_MODE[modeName] || 'osu'}/${encodeURIComponent(beatmapId)}`;
    overlay.dataset.filename = `osu-score-${(score.username || score.user_id)}-${beatmapId}.png`.replace(/[^\w.-]+/g, '_');
}

/* Scale the 1280x720 card to the space the window leaves (computers only;
   phones get the one-column layout from css/osu.css). */
function fitScoreCard() {
    const overlay = document.getElementById('score-card');
    const fit = document.getElementById('score-card-fit');
    if (!overlay || overlay.hidden || !fit) return;
    const frame = fit.parentElement;
    const k = Math.min(1, frame.clientWidth / 1280, (window.innerHeight - 90) / 720);
    fit.style.setProperty('--sc-k', String(Math.max(0.3, k)));
}
window.addEventListener('resize', fitScoreCard);

function closeScoreCard() {
    const overlay = document.getElementById('score-card');
    if (!overlay || overlay.hidden) return;
    scoreCardReq++;
    overlay.hidden = true;
    document.documentElement.classList.remove('score-card-open');
    if (scoreCardOpener && document.contains(scoreCardOpener)) scoreCardOpener.focus();
    scoreCardOpener = null;
}

/* The card as a 1280px-wide PNG, whatever the screen size. */
async function downloadScoreCard(btn) {
    const overlay = document.getElementById('score-card');
    const card = document.getElementById('score-card-body');
    if (!card || !card.querySelector('.sc-body')) return;
    btn.disabled = true;
    card.classList.add('sc-export');
    try {
        if (typeof htmlToImage === 'undefined') await ensureHtmlToImage();
        const dataUrl = await htmlToImage.toPng(card, { pixelRatio: 1.5, cacheBust: true, width: 1280, height: 720 });
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = overlay.dataset.filename || 'osu-score.png';
        a.click();
        showShareToast(t('stats_card_done'));
    } catch (e) {
        console.error('Score card export failed:', e);
        showShareToast(t('stats_card_fail'));
    } finally {
        card.classList.remove('sc-export');
        btn.disabled = false;
    }
}

// Capture phase, so Esc closes the card before the beatmap drawer under it.
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const overlay = document.getElementById('score-card');
    if (overlay && !overlay.hidden) { e.stopPropagation(); closeScoreCard(); }
}, true);
