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
const SC_MOD_GROUP = {
    EZ: 'down', NF: 'down', HT: 'down',
    HR: 'up', SD: 'up', PF: 'up', DT: 'up', NC: 'up', HD: 'up', FL: 'up',
    RX: 'auto', AP: 'auto', SO: 'auto',
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

/* The difficulty curve as ~64 bars of an inline SVG. */
function scStrainSvg(values) {
    if (!Array.isArray(values) || values.length < 2) return '';
    const N = Math.min(64, values.length);
    const step = values.length / N;
    const bars = [];
    for (let i = 0; i < N; i++) {
        const slice = values.slice(Math.floor(i * step), Math.max(Math.floor((i + 1) * step), Math.floor(i * step) + 1));
        bars.push(Math.max(...slice));
    }
    const max = Math.max(...bars) || 1;
    const w = 100 / N;
    return `<svg class="sc-strain" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">${bars.map((v, i) => {
        const h = Math.max(1.5, (v / max) * 40);
        return `<rect x="${(i * w + w * 0.15).toFixed(2)}" y="${(40 - h).toFixed(2)}" width="${(w * 0.7).toFixed(2)}" height="${h.toFixed(2)}" rx="0.6"/>`;
    }).join('')}</svg>`;
}

function scStatRow(label, value, base, max, digits = 1, unit = '') {
    const pct = Math.max(2, Math.min(100, (value / max) * 100));
    const changed = base != null && Math.abs(base - value) > 0.05;
    return `<div class="sc-stat">
        <div class="sc-stat-top"><span class="sc-stat-label">${escHtml(label)}</span><b>${typeof value === 'string' ? escHtml(value) : scBigNum(value, digits)}${unit}</b>${changed ? `<span class="sc-stat-base">${typeof base === 'string' ? escHtml(base) : Number(base).toFixed(digits)}</span>` : ''}</div>
        <div class="sc-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
    </div>`;
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
    const cover = `https://assets.ppy.sh/beatmaps/${encodeURIComponent(setId)}/covers/cover@2x.jpg`;
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
                    <h3>${escHtml(t('sc_strain'))}</h3>
                    ${scStrainSvg(ppRes && ppRes.strains && ppRes.strains.values) || '<p class="sc-dim">—</p>'}
                </section>
                <section class="sc-panel sc-stats">
                    <h3>${escHtml(t('sc_stats'))}</h3>
                    <div class="sc-stats-grid">
                        ${scStatRow('BPM', bpmBase * rate, bpmBase, 300, 0)}
                        ${scStatRow(t('drawer_length'), fmtMapLength(lenBase / rate), fmtMapLength(lenBase), 1, 0)}
                        ${scStatRow('CS', attrs.cs != null ? attrs.cs : parseFloat(map.diff_size), parseFloat(map.diff_size), 10)}
                        ${scStatRow('AR', attrs.ar != null ? attrs.ar : parseFloat(map.diff_approach), parseFloat(map.diff_approach), 11)}
                        ${scStatRow('OD', attrs.od != null ? attrs.od : parseFloat(map.diff_overall), parseFloat(map.diff_overall), 11)}
                        ${scStatRow('HP', attrs.hp != null ? attrs.hp : parseFloat(map.diff_drain), parseFloat(map.diff_drain), 10)}
                    </div>
                </section>
            </div>
            <div class="sc-col sc-mid">
                <div class="sc-grade grade-${gradeKey}" aria-label="${escHtml(SC_GRADE_LABEL[grade] || grade)}">${escHtml(SC_GRADE_LABEL[grade] || grade)}</div>
                <div class="sc-mods">${mods.length ? mods.map((m) => `<span class="sc-mod sc-mod-${SC_MOD_GROUP[m] || 'fun'}">${escHtml(m)}</span>`).join('') : ''}${isFc ? '<span class="sc-mod sc-mod-fc">FC</span>' : ''}</div>
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
