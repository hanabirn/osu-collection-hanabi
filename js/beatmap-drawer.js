/* ===== Beatmap details window =====
   After osu-web's beatmap page: a catalog card (曲庫, the 首頁 new-maps
   row, 依實力推薦) opens this centred window instead of leaving for
   osu.ppy.sh. Everything fits one screen on a computer:

     header      cover, title, artist, mapper, status, BPM, length,
                 favourites, plays, and preview / add / download / osu!
     difficulty  one chip per difficulty, coloured by stars
     left        the picked difficulty: stars, CS / AR / OD / HP, max
                 combo, objects, pass rate, PP 試算 and the difficulty curve
     right       its global top 50 as a table (only the table scrolls);
                 a row opens that score's card (js/score-card.js)

   Data: get_beatmaps (one v1 call for the whole set, which carries every
   difficulty's stats), osu-pp (PP and strain curve, Aim/Speed for std) and
   get_scores (top 50). A real dialog: focus moves to its close button, Esc
   or the backdrop closes it, focus returns to the card that opened it.
   (The element ids keep the old "drawer" names other scripts use.) */

let beatmapDrawerOpener = null;
let beatmapDrawerReq = 0;
let beatmapDrawerMaps = []; // the open set's difficulties (get_beatmaps rows)
let beatmapDrawerSetId = 0;

const BM_STATUS = { '4': 'Loved', '3': 'Qualified', '2': 'Approved', '1': 'Ranked', '0': 'Pending', '-1': 'WIP', '-2': 'Graveyard' };

function fmtMapLength(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const bmNum = (v) => Number(v || 0).toLocaleString();
const bmCover = (id) => `https://assets.ppy.sh/beatmaps/${id}/covers/cover@2x.jpg`;

async function openBeatmapDrawer(setId) {
    const id = Number(setId);
    if (!Number.isInteger(id) || id <= 0) return;
    const drawer = document.getElementById('beatmap-drawer');
    const body = document.getElementById('beatmap-drawer-body');
    if (!drawer || !body) {
        window.open(`https://osu.ppy.sh/beatmapsets/${id}`, '_blank');
        return;
    }
    beatmapDrawerOpener = document.activeElement;
    const req = ++beatmapDrawerReq;
    beatmapDrawerSetId = id;
    document.getElementById('beatmap-drawer-scrim').hidden = false;
    drawer.hidden = false;
    document.documentElement.classList.add('beatmap-modal-open');
    requestAnimationFrame(() => drawer.classList.add('open'));
    drawer.querySelector('.beatmap-drawer-close').focus();
    body.innerHTML = `<header class="bm-head" style="--bm-cover:url('${bmCover(id)}')"><div class="bm-head-text"><h2 class="bm-title" id="beatmap-drawer-title">${escHtml(t('gallery_loading'))}</h2></div></header>`;

    let maps;
    try {
        maps = await osuFetch(`s=${id}`);
    } catch {
        maps = null;
    }
    if (req !== beatmapDrawerReq) return; // another card was opened meanwhile
    if (!Array.isArray(maps) || !maps.length) {
        body.innerHTML = `<header class="bm-head" style="--bm-cover:url('${bmCover(id)}')"><div class="bm-head-text">
                <h2 class="bm-title" id="beatmap-drawer-title">${escHtml(t('updates_load_fail'))}</h2>
                <a class="btn" href="https://osu.ppy.sh/beatmapsets/${id}" target="_blank" rel="noopener noreferrer">${escHtml(t('drawer_open_osu'))}</a>
            </div></header>`;
        return;
    }
    const first = maps[0];
    const diffs = [...maps].sort((a, b) => (Number(a.mode) - Number(b.mode)) || (parseFloat(a.difficultyrating) - parseFloat(b.difficultyrating)));
    beatmapDrawerMaps = diffs;
    const inCollection = OSU_MODES.some((m) => (getOsuCollection()[m] || []).some((s) => s.beatmapset_id === id));
    const modes = new Set(diffs.map((d) => String(d.mode)));
    const status = BM_STATUS[String(first.approved)] || '';
    const plays = diffs.reduce((n, d) => n + (Number(d.playcount) || 0), 0);

    body.innerHTML = `
        <header class="bm-head" style="--bm-cover:url('${bmCover(id)}')">
            <div class="bm-head-text">
                ${status ? `<span class="bm-status bm-status-${status.toLowerCase()}">${status}</span>` : ''}
                <h2 class="bm-title" id="beatmap-drawer-title">${escHtml(first.title || '')}</h2>
                <p class="bm-artist">${escHtml(first.artist || '')}</p>
                <p class="bm-meta">
                    <span>${t('mapped_by', { n: `<b>${escHtml(first.creator || '')}</b>` })}</span>
                    <span><b>${Math.round(parseFloat(first.bpm) || 0)}</b> BPM</span>
                    <span><b>${fmtMapLength(first.total_length)}</b> ${escHtml(t('drawer_length'))}</span>
                    <span>${icon('heart')} <b>${bmNum(first.favourite_count)}</b></span>
                    <span>${icon('play')} <b>${bmNum(plays)}</b> ${escHtml(t('bm_plays'))}</span>
                </p>
            </div>
            <div class="bm-actions">
                <button type="button" class="btn btn-ghost" onclick="playOsuPreview(${id}, event)">${icon('play', { extraClass: 'icon-label-gap' })}${escHtml(t('mappools_preview'))}</button>
                <button type="button" class="btn" ${inCollection ? 'disabled' : `onclick="drawerAddToCollection(${id}, this)"`}>${escHtml(t(inCollection ? 'farm_in_collection' : 'drawer_add'))}</button>
                <button type="button" class="btn btn-ghost" onclick="downloadBeatmapset(${id}, event)" title="${escHtml(t('osu_download_btn_title'))}">${icon('download', { extraClass: 'icon-label-gap' })}${escHtml(t('drawer_download'))}</button>
                <a class="btn btn-ghost" href="https://osu.ppy.sh/beatmapsets/${id}" target="_blank" rel="noopener noreferrer">${icon('externalLink', { extraClass: 'icon-label-gap' })}${escHtml(t('drawer_open_osu'))}</a>
            </div>
        </header>
        <nav class="bm-diffs" aria-label="${escHtml(t('drawer_pick_diff'))}">
            ${diffs.map((d) => {
                const sr = parseFloat(d.difficultyrating) || 0;
                const mode = OSU_MODES[Number(d.mode)] || 'standard';
                const dot = modes.size > 1 ? modeIconSvg(mode, starRatingColor(sr)) : `<i style="background:${starRatingColor(sr)}"></i>`;
                return `<button type="button" class="bm-diff" data-beatmap-id="${Number(d.beatmap_id)}" aria-pressed="false" onclick="selectDrawerDiff(${Number(d.beatmap_id)}, ${Number(d.mode) || 0})">
                    <span class="bm-diff-dot" aria-hidden="true">${dot}</span>
                    <span class="bm-diff-name">${escHtml(d.version || '')}</span>
                    <span class="bm-diff-sr">${sr.toFixed(2)}★</span>
                </button>`;
            }).join('')}
        </nav>
        <div class="bm-main">
            <section class="bm-side" id="bm-side" aria-live="polite"></section>
            <section class="bm-lb" aria-labelledby="bd-lb-h">
                <h3 class="bm-h" id="bd-lb-h">${escHtml(t('drawer_lb_title'))} <small id="bm-lb-count"></small></h3>
                <div class="bm-lb-table">
                    <div class="bm-lb-headrow" aria-hidden="true">${[0, 1].map((i) => `
                        <div class="bm-lb-headcols${i ? ' is-second' : ''}">
                            <span>#</span><span>${escHtml(t('bm_col_player'))}</span><span></span>
                            <span>${escHtml(t('bm_col_acc'))}</span><span class="bm-lb-combo">Combo</span><span class="bm-lb-miss">Miss</span>
                            <span>Mods</span><span class="bm-lb-pp">PP</span><span class="bm-lb-date">${escHtml(t('bm_col_date'))}</span>
                        </div>`).join('')}
                    </div>
                    <ol class="bm-lb-list" id="beatmap-drawer-lb"></ol>
                </div>
            </section>
        </div>`;
    const hardest = diffs.filter((d) => String(d.mode) === String(first.mode)).pop() || diffs[diffs.length - 1];
    selectDrawerDiff(Number(hardest.beatmap_id), Number(hardest.mode) || 0);
}

/* The picked difficulty: its stats at once (they came with the set), then
   PP 試算 + curve (osu-pp) and the top 50 (get_scores) in parallel; a newer
   pick or a closed window drops the older answers. */
let beatmapDrawerDiffReq = 0;
let drawerLbScores = null; // { beatmapId, mode, scores } behind the rows shown
function openDrawerScore(i) {
    if (!drawerLbScores || !drawerLbScores.scores[i]) return;
    openScoreCard({ score: drawerLbScores.scores[i], beatmapId: drawerLbScores.beatmapId, mode: drawerLbScores.mode, lbRank: i + 1 });
}

function bmStatRow(label, value, max, cls) {
    const v = Number(value) || 0;
    return `<div class="bm-stat ${cls}">
        <span class="bm-stat-label">${escHtml(label)}</span>
        <span class="bm-bar"><i style="width:${Math.max(2, Math.min(100, (v / max) * 100)).toFixed(1)}%"></i></span>
        <b>${Number.isInteger(v) ? v : v.toFixed(1)}</b>
    </div>`;
}

function bmSideHtml(d) {
    const mode = Number(d.mode) || 0;
    const sr = parseFloat(d.difficultyrating) || 0;
    const objects = (Number(d.count_normal) || 0) + (Number(d.count_slider) || 0) + (Number(d.count_spinner) || 0);
    const plays = Number(d.playcount) || 0;
    const pass = plays ? `${((Number(d.passcount) || 0) / plays * 100).toFixed(1)}%` : '—';
    const rows = [];
    if (mode === 0 || mode === 2) rows.push(bmStatRow('CS', d.diff_size, 10, 'is-cs'));
    if (mode === 3) rows.push(bmStatRow(t('bm_keys'), d.diff_size, 10, 'is-cs'));
    if (mode === 0 || mode === 2) rows.push(bmStatRow('AR', d.diff_approach, 11, 'is-ar'));
    rows.push(bmStatRow('OD', d.diff_overall, 11, 'is-od'));
    rows.push(bmStatRow('HP', d.diff_drain, 10, 'is-hp'));
    return `
        <div class="bm-star">
            <span class="bm-star-num" style="--sr:${starRatingColor(sr)}">★ ${sr.toFixed(2)}</span>
            <span class="bm-star-diff">${escHtml(d.version || '')}</span>
            <a class="bm-diff-link" href="https://osu.ppy.sh/beatmapsets/${beatmapDrawerSetId}#${OSU_API_MODE[OSU_MODES[mode]] || 'osu'}/${encodeURIComponent(d.beatmap_id)}" target="_blank" rel="noopener noreferrer" aria-label="${escHtml(t('drawer_open_diff', { n: d.version || '' }))}" title="${escHtml(t('drawer_open_diff', { n: d.version || '' }))}">${icon('externalLink')}</a>
        </div>
        <div class="bm-stats">${rows.join('')}</div>
        <dl class="bm-facts">
            <div><dt>${escHtml(t('bm_max_combo'))}</dt><dd>${d.max_combo ? bmNum(d.max_combo) + 'x' : '—'}</dd></div>
            <div><dt>${escHtml(t('bm_objects'))}</dt><dd>${objects ? bmNum(objects) : '—'}</dd></div>
            <div><dt>${escHtml(t('bm_pass_rate'))}</dt><dd>${pass}</dd></div>
        </dl>
        <h3 class="bm-h">${escHtml(t('drawer_pp_title'))} <small>${escHtml(t('drawer_pp_note'))}</small></h3>
        <div class="bm-pp" id="beatmap-drawer-pp">${[95, 98, 99, 100].map((a) => `<div class="bm-pp-cell"><span>${a}%</span><b class="skeleton-text">···</b></div>`).join('')}</div>
        <h3 class="bm-h">${escHtml(t('sc_strain'))}<span class="bm-curve-legend" id="bm-curve-legend" hidden><i class="is-aim"></i>Aim<i class="is-speed"></i>Speed</span></h3>
        <div class="bm-curve" id="bm-curve"><p class="bm-note">${escHtml(t('gallery_loading'))}</p></div>`;
}

async function selectDrawerDiff(beatmapId, mode) {
    const req = ++beatmapDrawerDiffReq;
    const drawerReq = beatmapDrawerReq;
    document.querySelectorAll('#beatmap-drawer .bm-diff').forEach((b) => {
        b.setAttribute('aria-pressed', String(Number(b.dataset.beatmapId) === beatmapId));
    });
    const side = document.getElementById('bm-side');
    const lb = document.getElementById('beatmap-drawer-lb');
    const count = document.getElementById('bm-lb-count');
    const d = beatmapDrawerMaps.find((m) => Number(m.beatmap_id) === beatmapId);
    if (!side || !lb || !d) return;
    side.innerHTML = bmSideHtml(d);
    lb.innerHTML = `<li class="bm-note">${escHtml(t('gallery_loading'))}</li>`;
    count.textContent = '';
    const stale = () => req !== beatmapDrawerDiffReq || drawerReq !== beatmapDrawerReq;
    const accs = [95, 98, 99, 100];

    const ppJob = fetch(`/.netlify/functions/osu-pp?id=${beatmapId}&acc=${accs.join(',')}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((data) => {
            if (stale()) return;
            const ppBox = document.getElementById('beatmap-drawer-pp');
            if (ppBox) {
                ppBox.innerHTML = accs.map((a) => {
                    const v = data && data.pp ? data.pp[a] : null;
                    return `<div class="bm-pp-cell"><span>${a}%</span><b>${v != null ? Math.round(v).toLocaleString() + 'pp' : '—'}</b></div>`;
                }).join('');
            }
            const curve = document.getElementById('bm-curve');
            const st = data && data.strains;
            const lines = st && mode === 0 && st.aim && st.speed ? [{ key: 'aim', values: st.aim }, { key: 'speed', values: st.speed }] : [];
            const svg = st && typeof scStrainSvg === 'function' ? scStrainSvg({ values: st.values, lines }, Number(d.total_length) || 0) : '';
            if (curve) curve.innerHTML = svg || `<p class="bm-note">—</p>`;
            const legend = document.getElementById('bm-curve-legend');
            if (legend) legend.hidden = !lines.length;
        });

    const lbJob = osuFetch(`scoreBeatmap=${beatmapId}&m=${mode}&limit=50`)
        .catch(() => null)
        .then((scores) => {
            if (stale()) return;
            if (!Array.isArray(scores)) {
                lb.innerHTML = `<li class="bm-note">${escHtml(t('updates_load_fail'))}</li>`;
                return;
            }
            if (!scores.length) {
                lb.innerHTML = `<li class="bm-note">${escHtml(t('drawer_lb_empty'))}</li>`;
                return;
            }
            drawerLbScores = { beatmapId, mode, scores };
            count.textContent = `${scores.length}`;
            lb.innerHTML = scores.map((s, i) => drawerScoreRowHtml(s, i + 1, mode)).join('');
        });
    await Promise.all([ppJob, lbJob]);
}

function drawerScoreRowHtml(s, rank, mode) {
    const acc = calcOsuAccuracy(s, mode);
    const mods = decodeOsuMods(s.enabled_mods);
    const grade = s.rank || '';
    const hasPp = s.pp != null && s.pp !== '';
    const value = hasPp ? `${Math.round(parseFloat(s.pp)).toLocaleString()}pp` : Number(s.score || 0).toLocaleString();
    const uid = encodeURIComponent(s.user_id);
    const d = new Date(String(s.date || '').replace(' ', 'T') + 'Z');
    const date = isNaN(d) ? '' : d.toLocaleDateString(siteLang === 'zh' ? 'zh-TW' : (siteLang || undefined), { year: 'numeric', month: 'numeric', day: 'numeric' });
    const miss = Number(s.countmiss) || 0;
    return `<li><button type="button" class="bm-lb-row" onclick="openDrawerScore(${rank - 1})" aria-label="${escHtml(t('sc_open', { n: s.username || '#' + s.user_id, r: rank }))}">
        <span class="bm-lb-rank">#${rank}</span>
        <span class="bm-lb-player"><img src="https://a.ppy.sh/${uid}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><span>${escHtml(s.username || '#' + s.user_id)}</span></span>
        <span class="lb-grade grade-${OSU_RANK_CLASS[grade] || 'f'}${grade === 'XH' || grade === 'SH' ? ' silver' : ''}">${escHtml(SC_GRADE_LABEL[grade] || grade || '—')}</span>
        <span class="bm-lb-acc">${acc}%</span>
        <span class="bm-lb-combo">${bmNum(s.maxcombo)}x</span>
        <span class="bm-lb-miss${miss ? ' has-miss' : ''}">${miss}</span>
        <span class="bm-lb-mods">${mods.map(scModBadge).join('')}</span>
        <span class="bm-lb-pp${hasPp ? '' : ' is-score'}">${value}</span>
        <span class="bm-lb-date">${escHtml(date)}</span>
    </button></li>`;
}

/* Add from the window, then show it as added (the shared card helper would
   re-enable the button when it finishes). */
async function drawerAddToCollection(id, btn) {
    btn.disabled = true;
    await addOsuBeatmap(String(id), { isSet: true });
    btn.textContent = t('farm_in_collection');
    if (typeof renderCatalogList === 'function') renderCatalogList();
}

function closeBeatmapDrawer() {
    const drawer = document.getElementById('beatmap-drawer');
    if (!drawer || drawer.hidden) return;
    beatmapDrawerReq++;
    drawer.classList.remove('open');
    document.getElementById('beatmap-drawer-scrim').hidden = true;
    drawer.hidden = true;
    document.documentElement.classList.remove('beatmap-modal-open');
    if (beatmapDrawerOpener && document.contains(beatmapDrawerOpener)) beatmapDrawerOpener.focus();
    beatmapDrawerOpener = null;
}

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const drawer = document.getElementById('beatmap-drawer');
    if (drawer && !drawer.hidden) { e.stopPropagation(); closeBeatmapDrawer(); }
});
