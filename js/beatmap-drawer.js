/* ===== Beatmap details drawer =====
   After osu-web's beatmap page and osu!Collector: a catalog card (曲庫, the
   首頁 new-maps row, 依實力推薦) opens this panel on the right instead of
   leaving for osu.ppy.sh. It shows the set's difficulties, BPM and length
   (one get_beatmaps call through the existing v1 proxy) with preview, add,
   download and "open on osu!".

   A real dialog: focus moves to its close button, Esc or the backdrop
   closes it, and focus goes back to the card that opened it. */

let beatmapDrawerOpener = null;
let beatmapDrawerReq = 0;

function fmtMapLength(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

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
    document.getElementById('beatmap-drawer-scrim').hidden = false;
    drawer.hidden = false;
    requestAnimationFrame(() => drawer.classList.add('open'));
    drawer.querySelector('.beatmap-drawer-close').focus();
    body.innerHTML = `<div class="beatmap-drawer-cover" style="background-image:url('https://assets.ppy.sh/beatmaps/${id}/covers/cover.jpg')"></div>
        <p class="beatmap-drawer-note">${escHtml(t('gallery_loading'))}</p>`;

    let maps;
    try {
        maps = await osuFetch(`s=${id}`);
    } catch {
        maps = null;
    }
    if (req !== beatmapDrawerReq) return; // another card was opened meanwhile
    if (!Array.isArray(maps) || !maps.length) {
        body.innerHTML = `<div class="beatmap-drawer-cover" style="background-image:url('https://assets.ppy.sh/beatmaps/${id}/covers/cover.jpg')"></div>
            <p class="beatmap-drawer-note">${escHtml(t('updates_load_fail'))}</p>
            <a class="btn" href="https://osu.ppy.sh/beatmapsets/${id}" target="_blank" rel="noopener noreferrer">${escHtml(t('drawer_open_osu'))}</a>`;
        return;
    }
    const first = maps[0];
    const diffs = [...maps].sort((a, b) => parseFloat(a.difficultyrating) - parseFloat(b.difficultyrating));
    const inCollection = OSU_MODES.some((m) => (getOsuCollection()[m] || []).some((s) => s.beatmapset_id === id));
    const modes = new Set(diffs.map((d) => String(d.mode)));
    document.getElementById('beatmap-drawer-title').textContent = first.title || '';

    body.innerHTML = `
        <div class="beatmap-drawer-cover" style="background-image:url('https://assets.ppy.sh/beatmaps/${id}/covers/cover.jpg')"></div>
        <div class="beatmap-drawer-head">
            <p class="beatmap-drawer-artist">${escHtml(first.artist || '')}</p>
            <p class="beatmap-drawer-mapper">${t('mapped_by', { n: escHtml(first.creator || '') })}</p>
        </div>
        <div class="beatmap-drawer-stats">
            <span><b>${Math.round(parseFloat(first.bpm) || 0)}</b> BPM</span>
            <span><b>${fmtMapLength(first.total_length)}</b> ${escHtml(t('drawer_length'))}</span>
            <span><b>${diffs.length}</b> ${escHtml(t('drawer_diffs'))}</span>
        </div>
        <ul class="beatmap-drawer-diffs" aria-label="${escHtml(t('drawer_pick_diff'))}">
            ${diffs.map((d) => {
                const sr = parseFloat(d.difficultyrating) || 0;
                const mode = OSU_MODES[Number(d.mode)] || 'standard';
                return `<li>
                    <button type="button" class="beatmap-drawer-diff" data-beatmap-id="${Number(d.beatmap_id)}" aria-pressed="false" onclick="selectDrawerDiff(${Number(d.beatmap_id)}, ${Number(d.mode) || 0})">
                        <span class="beatmap-drawer-dot" aria-hidden="true">${modes.size > 1 ? modeIconSvg(mode, starRatingColor(sr)) : `<i style="background:${starRatingColor(sr)}"></i>`}</span>
                        <span class="beatmap-drawer-diff-name">${escHtml(d.version || '')}</span>
                        <span class="beatmap-drawer-sr">${sr.toFixed(2)}★</span>
                    </button>
                    <a class="beatmap-drawer-diff-link" href="https://osu.ppy.sh/beatmapsets/${id}#${OSU_API_MODE[mode] || 'osu'}/${encodeURIComponent(d.beatmap_id)}" target="_blank" rel="noopener noreferrer" aria-label="${escHtml(t('drawer_open_diff', { n: d.version || '' }))}" title="${escHtml(t('drawer_open_diff', { n: d.version || '' }))}">${icon('externalLink')}</a>
                </li>`;
            }).join('')}
        </ul>
        <section class="beatmap-drawer-section" aria-labelledby="bd-pp-h">
            <h3 class="beatmap-drawer-h" id="bd-pp-h">${escHtml(t('drawer_pp_title'))} <small>${escHtml(t('drawer_pp_note'))}</small></h3>
            <div class="beatmap-drawer-pp" id="beatmap-drawer-pp"></div>
        </section>
        <section class="beatmap-drawer-section" aria-labelledby="bd-lb-h">
            <h3 class="beatmap-drawer-h" id="bd-lb-h">${escHtml(t('drawer_lb_title'))}</h3>
            <ol class="beatmap-drawer-lb" id="beatmap-drawer-lb"></ol>
            <button type="button" class="btn btn-ghost beatmap-drawer-lb-more" id="beatmap-drawer-lb-more" hidden onclick="this.hidden = true; document.getElementById('beatmap-drawer-lb').classList.add('show-all')"></button>
        </section>
        <div class="beatmap-drawer-actions">
            <button type="button" class="btn btn-ghost" onclick="playOsuPreview(${id}, event)">${icon('play', { extraClass: 'icon-label-gap' })}${escHtml(t('mappools_preview'))}</button>
            <button type="button" class="btn" ${inCollection ? 'disabled' : `onclick="drawerAddToCollection(${id}, this)"`}>${escHtml(t(inCollection ? 'farm_in_collection' : 'drawer_add'))}</button>
            <button type="button" class="btn btn-ghost" onclick="downloadBeatmapset(${id}, event)" title="${escHtml(t('osu_download_btn_title'))}">${icon('download', { extraClass: 'icon-label-gap' })}${escHtml(t('drawer_download'))}</button>
            <a class="btn btn-ghost" href="https://osu.ppy.sh/beatmapsets/${id}" target="_blank" rel="noopener noreferrer">${escHtml(t('drawer_open_osu'))}</a>
        </div>`;
    const hardest = diffs[diffs.length - 1];
    selectDrawerDiff(Number(hardest.beatmap_id), Number(hardest.mode) || 0);
}

/* One difficulty's PP 試算 (osu-pp: rosu-pp on the .osu file, no mods, full
   combo) and its global top 50 (the osu proxy's get_scores). Both load in
   parallel; a newer pick or a closed drawer drops the older answers. */
let beatmapDrawerDiffReq = 0;
let drawerLbScores = null; // { beatmapId, mode, scores } behind the rows shown
function openDrawerScore(i) {
    if (!drawerLbScores || !drawerLbScores.scores[i]) return;
    openScoreCard({ score: drawerLbScores.scores[i], beatmapId: drawerLbScores.beatmapId, mode: drawerLbScores.mode, lbRank: i + 1 });
}
const DRAWER_LB_SHOWN = 10;
async function selectDrawerDiff(beatmapId, mode) {
    const req = ++beatmapDrawerDiffReq;
    const drawerReq = beatmapDrawerReq;
    document.querySelectorAll('#beatmap-drawer .beatmap-drawer-diff').forEach((b) => {
        b.setAttribute('aria-pressed', String(Number(b.dataset.beatmapId) === beatmapId));
    });
    const ppBox = document.getElementById('beatmap-drawer-pp');
    const lb = document.getElementById('beatmap-drawer-lb');
    const more = document.getElementById('beatmap-drawer-lb-more');
    if (!ppBox || !lb) return;
    const stale = () => req !== beatmapDrawerDiffReq || drawerReq !== beatmapDrawerReq;
    const accs = [95, 98, 99, 100];
    ppBox.innerHTML = accs.map((a) => `<div class="beatmap-drawer-pp-cell"><span>${a}%</span><b class="skeleton-text">···</b></div>`).join('');
    lb.classList.remove('show-all');
    lb.innerHTML = `<li class="beatmap-drawer-lb-note">${escHtml(t('gallery_loading'))}</li>`;
    more.hidden = true;

    const ppJob = fetch(`/.netlify/functions/osu-pp?id=${beatmapId}&acc=${accs.join(',')}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((data) => {
            if (stale()) return;
            ppBox.innerHTML = accs.map((a) => {
                const v = data && data.pp ? data.pp[a] : null;
                return `<div class="beatmap-drawer-pp-cell"><span>${a}%</span><b>${v != null ? Math.round(v).toLocaleString() + 'pp' : '—'}</b></div>`;
            }).join('');
        });

    const lbJob = osuFetch(`scoreBeatmap=${beatmapId}&m=${mode}&limit=50`)
        .catch(() => null)
        .then((scores) => {
            if (stale()) return;
            if (!Array.isArray(scores)) {
                lb.innerHTML = `<li class="beatmap-drawer-lb-note">${escHtml(t('updates_load_fail'))}</li>`;
                return;
            }
            if (!scores.length) {
                lb.innerHTML = `<li class="beatmap-drawer-lb-note">${escHtml(t('drawer_lb_empty'))}</li>`;
                return;
            }
            drawerLbScores = { beatmapId, mode, scores };
            lb.innerHTML = scores.map((s, i) => drawerScoreRowHtml(s, i + 1, mode)).join('');
            if (scores.length > DRAWER_LB_SHOWN) {
                more.textContent = t('drawer_lb_more', { n: scores.length });
                more.hidden = false;
            }
        });
    await Promise.all([ppJob, lbJob]);
}

function drawerScoreRowHtml(s, rank, mode) {
    const acc = calcOsuAccuracy(s, mode);
    const mods = decodeOsuMods(s.enabled_mods);
    const grade = s.rank || '';
    const pp = s.pp != null && s.pp !== '' ? Math.round(parseFloat(s.pp)).toLocaleString() + 'pp' : Number(s.score || 0).toLocaleString();
    const uid = encodeURIComponent(s.user_id);
    return `<li class="beatmap-drawer-lb-item${rank > DRAWER_LB_SHOWN ? ' is-extra' : ''}"><button type="button" class="beatmap-drawer-lb-row" onclick="openDrawerScore(${rank - 1})" aria-label="${escHtml(t('sc_open', { n: s.username || '#' + s.user_id, r: rank }))}">
        <span class="beatmap-drawer-lb-rank">#${rank}</span>
        <img class="beatmap-drawer-lb-avatar" src="https://a.ppy.sh/${uid}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <span class="beatmap-drawer-lb-who">
            <span class="beatmap-drawer-lb-name">${escHtml(s.username || '#' + s.user_id)}</span>
            <small>${acc}% · ${escHtml(String(s.maxcombo || 0))}x${Number(s.countmiss) ? ' · ' + escHtml(String(s.countmiss)) + '❌' : ''}</small>
        </span>
        <span class="beatmap-drawer-lb-mods">${mods.map(scModBadge).join('')}</span>
        <span class="lb-grade grade-${OSU_RANK_CLASS[grade] || 'f'}${grade === 'XH' || grade === 'SH' ? ' silver' : ''}">${escHtml(SC_GRADE_LABEL[grade] || grade || '—')}</span>
        <span class="beatmap-drawer-lb-pp">${pp}</span>
    </button></li>`;
}

/* Add from the drawer, then show it as added (the shared card helper would
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
    if (beatmapDrawerOpener && document.contains(beatmapDrawerOpener)) beatmapDrawerOpener.focus();
    beatmapDrawerOpener = null;
}

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const drawer = document.getElementById('beatmap-drawer');
    if (drawer && !drawer.hidden) { e.stopPropagation(); closeBeatmapDrawer(); }
});
