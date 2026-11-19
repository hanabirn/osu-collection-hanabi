/* ===== 技能雷達 (skill radar) =====
   After osu!Skills: what a player is good at, read from their 50 best
   scores in one mode, weighted like pp (0.95^i, so the top plays count
   most), with mods applied (DT/HT change BPM, length, AR and OD; HR/EZ
   change AR and OD; HD/FL add to reading).

   osu!:   Aim, Speed (the map's own aim/speed stars), Accuracy (acc and
           OD), Reading (effective AR, HD/FL), Stamina (drain length and
           combo), BPM.
   others: Stars, Density (objects per second), Accuracy, OD, Stamina, BPM.

   Each axis is scaled 0-100 against fixed ranges, so two players compare
   directly (PP 查詢's 雙人對比 draws both). An estimate, not osu!'s own
   skill model; the raw values are listed under the chart. Data: get_user_best
   (50) and get_beatmaps per map (both through the existing v1 proxy). */

const skillRadarCache = new Map(); // `${userId}:${mode}` -> profile | null
const skillMapCache = new Map();   // beatmap id -> get_beatmaps row

const clamp01 = (x) => Math.max(0, Math.min(1, x));

function srRate(mods) {
    if (mods.includes('DT') || mods.includes('NC')) return 1.5;
    if (mods.includes('HT')) return 0.75;
    return 1;
}
/* AR after HR/EZ and a clock rate (preempt time scales with the rate). */
function srEffAr(ar, mods, rate) {
    let a = ar;
    if (mods.includes('HR')) a = Math.min(10, a * 1.4);
    if (mods.includes('EZ')) a *= 0.5;
    let ms = a < 5 ? 1800 - 120 * a : 1950 - 150 * a;
    ms /= rate;
    return ms > 1200 ? (1800 - ms) / 120 : (1950 - ms) / 150;
}
/* OD after HR/EZ and a clock rate (300 window = 80 - 6·OD ms). */
function srEffOd(od, mods, rate) {
    let o = od;
    if (mods.includes('HR')) o = Math.min(10, o * 1.4);
    if (mods.includes('EZ')) o *= 0.5;
    return (80 - (80 - 6 * o) / rate) / 6;
}

async function srFetchMaps(ids) {
    const todo = ids.filter((id) => !skillMapCache.has(id));
    let i = 0;
    const worker = async () => {
        while (i < todo.length) {
            const id = todo[i++];
            try {
                const r = await osuFetch(`b=${id}`);
                skillMapCache.set(id, Array.isArray(r) ? r[0] || null : null);
            } catch {
                skillMapCache.set(id, null);
            }
        }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
}

/* Official difficulty attributes for each play's map with its own mods
   (netlify/functions/osu-attrs.js -> osu! API v2), 8 at a time. */
const skillAttrCache = new Map(); // `${beatmapId}:${mods}:${mode}` -> attributes | null
const SR_RULESET = ['osu', 'taiko', 'fruits', 'mania'];
async function srFetchAttrs(plays, mode) {
    const keys = [...new Set(plays.map((p) => `${p.beatmap_id}:${decodeOsuMods(p.enabled_mods).join('')}:${mode}`))]
        .filter((k) => !skillAttrCache.has(k));
    let i = 0;
    const worker = async () => {
        while (i < keys.length) {
            const k = keys[i++];
            const [id, mods] = k.split(':');
            try {
                const r = await fetch(`/.netlify/functions/osu-attrs?id=${id}&mods=${mods}&m=${SR_RULESET[mode]}`);
                skillAttrCache.set(k, r.ok ? await r.json() : null);
            } catch {
                skillAttrCache.set(k, null);
            }
        }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
}

async function computeSkillProfile(userId, mode) {
    const key = `${userId}:${mode}`;
    if (skillRadarCache.has(key)) return skillRadarCache.get(key);
    const plays = await osuFetch(`best=${encodeURIComponent(userId)}&limit=50&m=${mode}`).catch(() => null);
    if (!Array.isArray(plays) || !plays.length) { skillRadarCache.set(key, null); return null; }
    await Promise.all([srFetchMaps([...new Set(plays.map((p) => String(p.beatmap_id)))]), srFetchAttrs(plays, mode)]);

    let wSum = 0;
    let official = 0;
    const acc = { aim: 0, speed: 0, stars: 0, acc: 0, od: 0, ar: 0, len: 0, combo: 0, bpm: 0, density: 0, hd: 0, fl: 0, fld: 0 };
    plays.forEach((p, idx) => {
        const m = skillMapCache.get(String(p.beatmap_id));
        if (!m) return;
        const w = Math.pow(0.95, idx);
        const mods = decodeOsuMods(p.enabled_mods);
        const rate = srRate(mods);
        const hit = (Number(m.hit_length) || Number(m.total_length) || 1) / rate;
        const objects = (Number(m.count_normal) || 0) + (Number(m.count_slider) || 0) + (Number(m.count_spinner) || 0);
        // osu!'s own numbers for this map with these mods; the old estimate
        // (nomod v1 values scaled by the clock rate) only if they're missing.
        const a = skillAttrCache.get(`${p.beatmap_id}:${mods.join('')}:${mode}`);
        if (a) official++;
        const rateStar = Math.pow(rate, 0.9);
        const hrBoost = mods.includes('HR') ? 1.06 : 1;
        const num = (x, fallback) => (Number.isFinite(Number(x)) && x !== null ? Number(x) : fallback);
        acc.aim += w * num(a && a.aim_difficulty, (parseFloat(m.diff_aim) || 0) * rateStar * hrBoost);
        acc.speed += w * num(a && a.speed_difficulty, (parseFloat(m.diff_speed) || 0) * rateStar);
        acc.stars += w * num(a && a.star_rating, (parseFloat(m.difficultyrating) || 0) * rateStar * hrBoost);
        acc.fld += w * num(a && a.flashlight_difficulty, 0);
        acc.acc += w * parseFloat(calcOsuAccuracy(p, mode));
        acc.od += w * num(a && a.overall_difficulty, srEffOd(parseFloat(m.diff_overall) || 0, mods, rate));
        acc.ar += w * num(a && a.approach_rate, srEffAr(parseFloat(m.diff_approach) || 0, mods, rate));
        acc.len += w * hit;
        acc.combo += w * (Number(p.maxcombo) || 0);
        acc.bpm += w * (parseFloat(m.bpm) || 0) * rate;
        acc.density += w * (objects / Math.max(1, hit));
        acc.hd += w * (mods.includes('HD') ? 1 : 0);
        acc.fl += w * (mods.includes('FL') ? 1 : 0);
        wSum += w;
    });
    if (!wSum) { skillRadarCache.set(key, null); return null; }
    const v = Object.fromEntries(Object.entries(acc).map(([k, x]) => [k, x / wSum]));

    const stamina = 0.5 * clamp01((v.len - 60) / 240) + 0.5 * clamp01((v.combo - 300) / 2200);
    const accScore = 0.7 * clamp01((v.acc - 88) / 12) + 0.3 * clamp01((v.od - 7) / 4);
    const axes = mode === 0
        ? [
            // aim / speed difficulty are parts of the star rating, always well
            // below it, so they get no ★; the average stars sit beside them.
            ['aim', clamp01(v.aim / 5.5), `${v.aim.toFixed(2)} · ${t('sr_avg_stars', { n: v.stars.toFixed(2) })}`],
            ['speed', clamp01(v.speed / 4.5), v.speed.toFixed(2)],
            ['acc', accScore, `${v.acc.toFixed(2)}% · OD ${v.od.toFixed(1)}`],
            ['read', clamp01((v.ar - 8) / 3 + 0.15 * v.hd + 0.25 * v.fl), `AR ${v.ar.toFixed(1)}${v.hd > 0.05 ? ` · HD ${Math.round(v.hd * 100)}%` : ''}${v.fl > 0.05 ? ` · FL ${Math.round(v.fl * 100)}%` : ''}`],
            ['stamina', stamina, `${fmtMapLength(v.len)} · ${Math.round(v.combo).toLocaleString()}x`],
            ['bpm', clamp01((v.bpm - 140) / 160), `${Math.round(v.bpm)} BPM`],
        ]
        : [
            ['stars', clamp01(v.stars / 8), `${v.stars.toFixed(2)}★`],
            ['density', mode === 3 ? clamp01((v.density - 5) / 20) : clamp01((v.density - 2) / 10), `${v.density.toFixed(1)}/s`],
            ['acc', clamp01((v.acc - 90) / 10), `${v.acc.toFixed(2)}%`],
            ['od', clamp01((v.od - 5) / 6), `OD ${v.od.toFixed(1)}`],
            ['stamina', stamina, `${fmtMapLength(v.len)} · ${Math.round(v.combo).toLocaleString()}x`],
            ['bpm', clamp01((v.bpm - 120) / 180), `${Math.round(v.bpm)} BPM`],
        ];
    const profile = { mode, plays: plays.length, axes, official };
    skillRadarCache.set(key, profile);
    return profile;
}

/* The radar as inline SVG: one polygon per profile (A pink, B blue). */
function skillRadarSvg(profiles) {
    const axes = profiles[0].axes;
    const n = axes.length;
    const R = 100;
    const pt = (i, r) => {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        return [Math.cos(a) * r, Math.sin(a) * r];
    };
    const ring = (f) => axes.map((_, i) => pt(i, R * f).map((x) => x.toFixed(1)).join(',')).join(' ');
    const colors = ['var(--pink)', '#4ea3ff'];
    const polys = profiles.map((p, k) => {
        const pts = p.axes.map((ax, i) => pt(i, R * Math.max(0.04, ax[1])).map((x) => x.toFixed(1)).join(',')).join(' ');
        return `<polygon class="sr-poly" points="${pts}" style="--c:${colors[k]}"/>`
            + p.axes.map((ax, i) => { const [x, y] = pt(i, R * Math.max(0.04, ax[1])); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" style="fill:${colors[k]}"/>`; }).join('');
    }).join('');
    const labels = axes.map((ax, i) => {
        const [x, y] = pt(i, R + 22);
        const vals = profiles.map((p, k) => `<tspan class="sr-val" style="fill:${colors[k]}" x="${x.toFixed(1)}" dy="${k ? 14 : 15}">${Math.round(p.axes[i][1] * 100)}</tspan>`).join('');
        return `<text class="sr-label" x="${x.toFixed(1)}" y="${(y - (profiles.length > 1 ? 10 : 4)).toFixed(1)}" text-anchor="middle">${escHtml(t(`sr_${ax[0]}`))}${vals}</text>`;
    }).join('');
    return `<svg class="sr-svg" viewBox="-150 -140 300 290" role="img" aria-label="${escHtml(t('sr_title'))}">
        ${[0.25, 0.5, 0.75, 1].map((f) => `<polygon class="sr-ring" points="${ring(f)}"/>`).join('')}
        ${axes.map((_, i) => { const [x, y] = pt(i, R); return `<line class="sr-axis" x1="0" y1="0" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('')}
        ${polys}${labels}
    </svg>`;
}

function skillRadarDetails(profiles, names) {
    const axes = profiles[0].axes;
    return `<dl class="sr-details">${axes.map((ax, i) => `<div><dt>${escHtml(t(`sr_${ax[0]}`))}</dt>${profiles.map((p, k) => `<dd class="${k ? 'is-b' : 'is-a'}">${names && names[k] ? `<small>${escHtml(names[k])}</small>` : ''}${escHtml(p.axes[i][2])}</dd>`).join('')}</div>`).join('')}</dl>`;
}

/* 雙人對比: A | axis | B per row, the higher side lit, the score bar
   between the value and the axis name. */
function skillRadarHeadToHead(pa, pb, nameA, nameB) {
    const rows = pa.axes.map((ax, i) => {
        const sa = ax[1];
        const sb = pb.axes[i][1];
        return `<div class="sr-h2h-row">
            <span class="sr-h2h-val is-a${sa > sb + 0.005 ? ' is-win' : ''}"><b>${Math.round(sa * 100)}</b><small>${escHtml(ax[2])}</small></span>
            <span class="sr-h2h-bar is-a"><i style="width:${(sa * 100).toFixed(1)}%"></i></span>
            <span class="sr-h2h-axis">${escHtml(t(`sr_${ax[0]}`))}</span>
            <span class="sr-h2h-bar is-b"><i style="width:${(sb * 100).toFixed(1)}%"></i></span>
            <span class="sr-h2h-val is-b${sb > sa + 0.005 ? ' is-win' : ''}"><b>${Math.round(sb * 100)}</b><small>${escHtml(pb.axes[i][2])}</small></span>
        </div>`;
    }).join('');
    return `<div class="sr-h2h" aria-label="${escHtml(`${nameA} / ${nameB}`)}">${rows}</div>`;
}

/* PP 查詢, one player: the card above 依實力推薦, following the mode tabs. */
let skillRadarReq = 0;
async function loadSkillRadar(userId, mode) {
    const box = document.getElementById('lookup-radar');
    if (!box) return;
    const req = ++skillRadarReq;
    box.hidden = false;
    box.innerHTML = `<h3 class="home-h">${escHtml(t('sr_title'))}</h3><p class="home-sub">${escHtml(t('sr_loading'))}</p>`;
    const p = await computeSkillProfile(userId, mode);
    if (req !== skillRadarReq) return;
    box.innerHTML = p
        ? `<h3 class="home-h" title="${escHtml(t('sr_sub', { n: p.plays }))}">${escHtml(t('sr_title'))} <span class="sr-info" aria-hidden="true">ⓘ</span></h3><p class="home-sub">${escHtml(t('sr_sub', { n: p.plays }))}</p>
           <div class="sr-wrap">${skillRadarSvg([p])}${skillRadarDetails([p])}</div>`
        : `<h3 class="home-h">${escHtml(t('sr_title'))}</h3><p class="home-sub">${escHtml(t('recs_none_plays'))}</p>`;
}

/* PP 查詢, 雙人對比: both players on one radar, with its own mode tabs. */
let skillRadarCompare = null; // { a, b, mode }
async function loadCompareRadar(a, b, mode = 0) {
    const box = document.getElementById('pp-compare-radar');
    if (!box) return;
    skillRadarCompare = { a, b, mode };
    const tabs = OSU_MODE_LABELS.map((label, i) => `<button type="button" class="osu-mode-tab${i === mode ? ' active' : ''}" onclick="loadCompareRadar(skillRadarCompare.a, skillRadarCompare.b, ${i})">${escHtml(label)}</button>`).join('');
    box.hidden = false;
    box.innerHTML = `<h4 class="pp-compare-topplays-title">${escHtml(t('sr_title'))}</h4><div class="osu-mode-tabs">${tabs}</div><p class="home-sub">${escHtml(t('sr_loading'))}</p>`;
    const [pa, pb] = await Promise.all([computeSkillProfile(a.id, mode), computeSkillProfile(b.id, mode)]);
    if (!skillRadarCompare || skillRadarCompare.mode !== mode || skillRadarCompare.a !== a) return;
    const both = [pa, pb].filter(Boolean);
    const names = [pa && a.username, pb && b.username].filter(Boolean);
    box.innerHTML = `<h4 class="pp-compare-topplays-title">${escHtml(t('sr_title'))}</h4><div class="osu-mode-tabs">${tabs}</div>`
        + (both.length
            ? `<p class="sr-legend">${pa ? `<span class="is-a">${escHtml(a.username)}</span>` : ''}${pb ? `<span class="is-b">${escHtml(b.username)}</span>` : ''}</p>
               <div class="sr-wrap">${skillRadarSvg(both)}${pa && pb ? skillRadarHeadToHead(pa, pb, a.username, b.username) : skillRadarDetails(both, names)}</div>`
            : `<p class="home-sub">${escHtml(t('recs_none_plays'))}</p>`);
}
