/* ===== Replay player: osu!taiko =====
   prepareTaiko(map, replay) turns the beatmap into what scrolls, the way
   osu! does (after osu!lazer's TaikoBeatmapConverter, DrumRoll, Swell and
   TaikoHitWindows, MIT), then judges the replay:
   - circle -> don (red), or kat (blue) when it has a whistle or clap;
     a finish makes it big; slider -> drum roll (or, in a converted
     map, a run of hits when it is short); spinner -> swell;
   - a replay frame's keys: 1 and 4 are the two centre (don) keys, 2 and 8
     the two rim (kat) keys; each new press goes to the earliest object
     that will take it: a hit within its window (the wrong colour is a
     miss), a drum roll tick within half a tick, an open swell;
   - a big note's second key within 30 ms is its bonus, not another hit.
   drawTaiko(ctx, view, prep, t) draws one frame. */
(function () {
    const MOD = { EZ: 2, HD: 8, HR: 16, DT: 64, HT: 256, NC: 512 };
    const JUDGE = ['300', '100', 'MISS'];
    const JUDGE_COLOR = { 300: '#8bd5ff', 100: '#7ee787', MISS: '#ff6b6b' };
    const DON = 1 | 4, KAT = 2 | 8;
    const HR_SV = (1.4 * 4) / 3; // HR scrolls faster (osu!lazer TaikoModHardRock)

    const range = (d, lo, mid, hi) => (d > 5 ? mid + ((hi - mid) * (d - 5)) / 5 : d < 5 ? mid - ((mid - lo) * (5 - d)) / 5 : mid);

    function difficulty(map, mods) {
        let od = map.od, hp = map.hp, sm = map.sliderMultiplier || 1.4;
        if (mods & MOD.HR) { od = Math.min(10, od * 1.4); hp = Math.min(10, hp * 1.4); sm *= HR_SV; }
        if (mods & MOD.EZ) { od *= 0.5; hp *= 0.5; sm *= 0.8; }
        return { od, hp, sm, tickRate: map.sliderTickRate || 1 };
    }

    // hit windows (ms either side) at an OD; osu!stable compares whole ms, so
    // a window of 30.5 lets in offsets up to 30 (checked against real replays)
    function windows(od) {
        const g = (x) => Math.floor(x) - 0.5;
        return { great: g(range(od, 50, 35, 20)), ok: g(range(od, 120, 80, 50)), miss: g(range(od, 135, 95, 70)) };
    }

    function timingTools(map) {
        const red = map.timing.filter((tp) => tp.uninherited && tp.beatLength > 0);
        const all = map.timing;
        const redAt = (t) => { let r = red[0] || { time: 0, beatLength: 500, meter: 4 }; for (const tp of red) { if (tp.time > t + 1) break; r = tp; } return r; };
        // slider velocity at t: the last green line since the last red one
        const svAt = (t) => {
            let sv = 1;
            for (const tp of all) {
                if (tp.time > t + 1) break;
                if (tp.uninherited) sv = 1;
                else if (tp.beatLength < 0) sv = Math.min(10, Math.max(0.1, -100 / tp.beatLength));
            }
            return sv;
        };
        return { red, redAt, svAt };
    }

    /* Beatmap -> taiko objects, sorted by time:
       { kind: 'hit', time, kat, big } | { kind: 'roll', time, end, big, ticks:[{time}] , spacing }
       | { kind: 'swell', time, end, required } */
    function convert(map, diff) {
        const { redAt, svAt } = timingTools(map);
        const native = map.mode === 1;
        const out = [];
        const sampleOf = (hs) => ({ kat: !!(hs & (2 | 8)), big: !!(hs & 4) });
        for (const o of map.objects) {
            const s = sampleOf(o.hitSound || 0);
            if (o.type & 2) {
                const red = redAt(o.time);
                const sv = svAt(o.time);
                const beat = red.beatLength / sv;
                const spans = o.slides || 1;
                const duration = Math.trunc(((o.length * spans) / (100 * diff.sm)) * beat);
                if (!native) {
                    // a converted slider that is short and slow becomes a run of hits
                    const osuVelocity = (100 * diff.sm * 1000) / beat;
                    const beatForTicks = map.version >= 8 ? red.beatLength : beat;
                    const spacing = Math.min(beatForTicks / diff.tickRate, duration / spans);
                    if (spacing > 0 && ((o.length * spans) / osuVelocity) * 1000 < 2 * beatForTicks) {
                        for (let t = o.time; t <= o.time + duration + spacing / 8; t += spacing) out.push({ kind: 'hit', time: Math.round(t), kat: s.kat, big: s.big });
                        continue;
                    }
                }
                const tickRate = diff.tickRate === 3 ? 3 : 4;
                const spacing = red.beatLength / tickRate;
                const ticks = [];
                if (spacing > 0) for (let t = o.time; t < o.time + duration + spacing / 2; t += spacing) ticks.push({ time: t, hit: false });
                out.push({ kind: 'roll', time: o.time, end: o.time + duration, big: s.big, ticks, spacing });
            } else if (o.type & 8) {
                const duration = Math.max(0, (o.endTime || o.time) - o.time);
                const required = Math.trunc(Math.max(1, (duration / 1000) * range(diff.od, 3, 5, 7.5) * 1.65));
                out.push({ kind: 'swell', time: o.time, end: o.time + duration, required });
            } else {
                out.push({ kind: 'hit', time: o.time, kat: s.kat, big: s.big });
            }
        }
        out.sort((a, b) => a.time - b.time);
        return out;
    }

    function prepareTaiko(map, replay) {
        const mods = replay.mods >>> 0;
        const diff = difficulty(map, mods);
        const win = windows(diff.od);
        const objects = convert(map, diff);
        const hits = objects.filter((o) => o.kind === 'hit');
        const rolls = objects.filter((o) => o.kind === 'roll');
        const swells = objects.filter((o) => o.kind === 'swell');
        for (const s of swells) { s.count = 0; s.lastCentre = null; s.done = false; s.hits = []; }

        // presses from the frames
        const presses = [];
        let prev = 0;
        for (const f of replay.frames) {
            const k = f.keys & 15;
            const now = k & ~prev;
            for (const bit of [1, 4, 2, 8]) if (now & bit) presses.push({ t: f.t, bit, centre: !!(bit & DON) });
            prev = k;
        }

        let hi = 0; // earliest hit not judged
        const judgeMiss = (h) => { h.result = 'MISS'; h.jt = h.time + win.miss; };
        let lastStrong = null;
        for (const p of presses) {
            while (hi < hits.length && p.t - hits[hi].time > win.miss) { judgeMiss(hits[hi]); hi++; }
            // a big note's second key
            if (lastStrong && p.t - lastStrong.hitAt <= 30 && p.centre === !lastStrong.kat && !lastStrong.bonusAt) { lastStrong.bonusAt = p.t; continue; }
            // the candidates, earliest first: the next hit, an open drum roll, an open swell
            const cands = [];
            if (hi < hits.length) cands.push(hits[hi]);
            for (const r of rolls) if (r.time - r.spacing / 2 <= p.t && p.t <= r.end + r.spacing / 2) cands.push(r);
            for (const s of swells) if (!s.done && s.time <= p.t && p.t <= s.end) cands.push(s);
            cands.sort((a, b) => a.time - b.time);
            for (const c of cands) {
                if (c.kind === 'hit') {
                    const off = p.t - c.time;
                    const a = Math.abs(off);
                    if (a > win.miss) continue; // too early: not this one
                    const right = p.centre === !c.kat;
                    c.result = !right ? 'MISS' : a <= win.great ? '300' : a <= win.ok ? '100' : 'MISS';
                    c.jt = p.t;
                    c.offset = off;
                    c.hitAt = p.t;
                    c.bit = p.bit;
                    hi++;
                    if (c.big && c.result !== 'MISS') lastStrong = c;
                    break;
                }
                if (c.kind === 'roll') {
                    const tick = c.ticks.find((k) => !k.hit && Math.abs(k.time - p.t) <= c.spacing / 2);
                    if (!tick) continue;
                    tick.hit = true; tick.hitAt = p.t; tick.centre = p.centre;
                    break;
                }
                if (c.kind === 'swell') {
                    if (c.lastCentre === p.centre) break; // must alternate; the press is used up
                    c.lastCentre = p.centre;
                    c.count++;
                    c.hits.push(p.t);
                    if (c.count >= c.required) { c.done = true; c.doneAt = p.t; }
                    break;
                }
            }
        }
        for (; hi < hits.length; hi++) judgeMiss(hits[hi]);

        // judgements in the order they happened, with running totals
        const events = hits.slice().sort((a, b) => a.jt - b.jt);
        const counts = { 300: 0, 100: 0, MISS: 0 };
        let combo = 0, best = 0, offSum = 0, offSq = 0, offN = 0;
        for (const e of events) {
            counts[e.result]++;
            if (e.result === 'MISS') combo = 0;
            else { combo++; offSum += e.offset; offSq += e.offset * e.offset; offN++; }
            best = Math.max(best, combo);
            const n = counts[300] + counts[100] + counts.MISS;
            e.comboAfter = combo;
            e.accAfter = n ? (counts[300] + 0.5 * counts[100]) / n : 1;
            e.countsAfter = { ...counts };
            e.urAfter = offN > 1 ? 10 * Math.sqrt(Math.max(0, offSq / offN - (offSum / offN) ** 2)) : 0;
        }

        const tt = timingTools(map);
        // bar lines: every measure of each red line
        const barlines = [];
        tt.red.forEach((tp, i) => {
            const next = tt.red[i + 1] ? tt.red[i + 1].time : (objects.length ? objects[objects.length - 1].end || objects[objects.length - 1].time : tp.time) + 1;
            const step = tp.beatLength * (tp.meter || 4);
            if (!(step > 0)) return;
            let first = true;
            for (let t = tp.time; t < next - 1; t += step) {
                if (!(first && tp.omitBarline)) barlines.push({ time: t, major: true });
                first = false;
                if (barlines.length > 20000) break;
            }
        });
        // scroll speed of an object: osu!px per ms, at its own time (as in the game)
        // (taiko scrolls 1.4× faster than an osu! slider at the same velocity)
        const speedAt = (t) => (1.4 * 100 * diff.sm * tt.svAt(t)) / tt.redAt(t).beatLength;
        for (const o of objects) o.speed = speedAt(o.time);
        for (const b of barlines) b.speed = speedAt(b.time);

        const rate = mods & (MOD.DT | MOD.NC) ? 1.5 : mods & MOD.HT ? 0.75 : 1;
        const last = objects.length ? objects[objects.length - 1] : null;
        const lastTime = last ? last.end || last.time : 0;
        const kiai = map.timing.map((tp) => ({ time: tp.time, kiai: !!tp.kiai }));
        const beatAt = (t) => tt.redAt(t);
        // the player's generic code reads .notes for the first object time
        return { mode: 1, objects, hits, rolls, swells, events, notes: objects, counts, bestCombo: best, presses, windows: win, diff, rate, lastTime, kiai, beatAt, barlines, hidden: !!(mods & MOD.HD), flash: false };
    }


    const DON_COLOUR = 'rgb(235,69,44)', KAT_COLOUR = 'rgb(67,142,172)', ROLL_COLOUR = 'rgb(252,184,6)', SWELL_COLOUR = 'rgb(240,140,40)';
    const FLY_MS = 350;

    function eventBefore(list, t) {
        let lo = 0, hi = list.length - 1, ans = -1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid].jt <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
        return ans;
    }
    function kiaiAt(prep, t) {
        let on = false;
        for (const k of prep.kiai) { if (k.time > t) break; on = k.kiai; }
        return on;
    }

    const tintCache = new WeakMap();
    function drawTinted(ctx, img, x, y, w, h, colour) {
        if (!colour) { ctx.drawImage(img.bmp, x, y, w, h); return; }
        let byColour = tintCache.get(img.bmp);
        if (!byColour) { byColour = new Map(); tintCache.set(img.bmp, byColour); }
        let c = byColour.get(colour);
        if (!c) {
            c = document.createElement('canvas');
            c.width = img.bmp.width; c.height = img.bmp.height;
            const g = c.getContext('2d');
            g.drawImage(img.bmp, 0, 0);
            g.globalCompositeOperation = 'multiply';
            g.fillStyle = colour;
            g.fillRect(0, 0, c.width, c.height);
            g.globalCompositeOperation = 'destination-in';
            g.drawImage(img.bmp, 0, 0);
            byColour.set(colour, c);
        }
        ctx.drawImage(c, x, y, w, h);
    }

    /* One frame at song time t, laid out as osu!stable draws taiko (checked
       against in-game screenshots): the lane across the upper part of the
       screen, the drum on its left with the combo in it, the mascot above,
       notes scrolling left to the hit target, each at its own speed; a hit
       note flies up towards the mascot; drum halves light up on each key.
       view: { w, h, bg, bgDim, skin (taiko skin config), judgeScale, comboScale } */
    function drawTaiko(ctx, view, prep, t) {
        const { w, h } = view;
        const skin = view.skin || prep.defaultSkin || { img: {}, mascot: {} };
        const I = skin.img || {};
        ctx.save();
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        if (view.bg) {
            const s = Math.max(w / view.bg.width, h / view.bg.height);
            ctx.globalAlpha = 1 - view.bgDim;
            ctx.drawImage(view.bg, (w - view.bg.width * s) / 2, (h - view.bg.height * s) / 2, view.bg.width * s, view.bg.height * s);
            ctx.globalAlpha = 1;
        }
        const bandH = h * 0.225, bandTop = h * 0.3, cy = bandTop + bandH / 2;
        const u = bandH / 200; // screen px per skin pixel (the drum is 200 tall)
        const size = (img) => [img.bmp.width * img.s * u, img.bmp.height * img.s * u];
        const barLeft = I['taiko-bar-left'];
        const drumW = barLeft ? size(barLeft)[0] : bandH * 0.9;
        const drumCx = drumW * 0.48;
        const hitX = drumW + bandH * 0.44;
        const k = h / 480; // screen px per osu! pixel
        const smallD = bandH * 0.475, bigD = smallD * 1.525;
        const xOf = (time, speed) => hitX + (time - t) * speed * k;
        const kiai = kiaiAt(prep, t);
        const hideAlpha = (x) => { if (!prep.hidden) return 1; const rel = (x - hitX) / Math.max(1, w - hitX); return Math.max(0, Math.min(1, (rel - 0.22) / 0.2)); };

        function drawNote(x, y, d, colour, big, alpha) {
            const base = I[big ? 'taikobigcircle' : 'taikohitcircle'];
            const over = I[big ? 'taikobigcircleoverlay' : 'taikohitcircleoverlay'];
            ctx.globalAlpha = alpha;
            if (base) {
                drawTinted(ctx, base, x - d / 2, y - d / 2, d, d, colour);
                if (over) ctx.drawImage(over.bmp, x - d / 2, y - d / 2, d, d);
            } else {
                ctx.beginPath(); ctx.arc(x, y, d / 2, 0, Math.PI * 2); ctx.fillStyle = colour; ctx.fill();
                ctx.lineWidth = d * 0.08; ctx.strokeStyle = '#fff'; ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }

        // the lane
        const barRight = I['taiko-bar-right'];
        if (barRight) ctx.drawImage(barRight.bmp, drumW * 0.5, bandTop, w - drumW * 0.5, bandH);
        else { ctx.fillStyle = 'rgba(0,0,0,0.82)'; ctx.fillRect(0, bandTop, w, bandH); }
        if (kiai && I['taiko-bar-right-glow']) {
            ctx.globalAlpha = 0.35 + 0.25 * Math.abs(Math.sin((t / prep.beatAt(t).beatLength) * Math.PI));
            ctx.drawImage(I['taiko-bar-right-glow'].bmp, drumW * 0.5, bandTop, w - drumW * 0.5, bandH);
            ctx.globalAlpha = 1;
        }
        // bar lines
        const bl = I['taiko-barline'];
        for (const b of prep.barlines) {
            const x = xOf(b.time, b.speed);
            if (x < hitX - 2 || x > w + 4) continue;
            if (bl) ctx.drawImage(bl.bmp, x - Math.max(1, size(bl)[0]) / 2, bandTop, Math.max(1, size(bl)[0]), bandH);
            else { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x - 1, bandTop, 2, bandH); }
        }
        // the hit target
        const target = I.taikobigcircle;
        ctx.globalAlpha = 0.45;
        if (target) drawTinted(ctx, target, hitX - bigD / 2, cy - bigD / 2, bigD, bigD, 'rgb(90,90,90)');
        else { ctx.beginPath(); ctx.arc(hitX, cy, bigD / 2, 0, Math.PI * 2); ctx.fillStyle = '#555'; ctx.fill(); }
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(hitX, cy, smallD / 2, 0, Math.PI * 2); ctx.lineWidth = Math.max(1.5, smallD * 0.05); ctx.strokeStyle = 'rgba(200,200,200,0.75)'; ctx.stroke();
        ctx.globalAlpha = 1;

        // objects, far ones first so near ones sit on top
        const objs = prep.objects;
        for (let i = objs.length - 1; i >= 0; i--) {
            const o = objs[i];
            if (o.kind === 'hit') {
                if (o.result && o.result !== 'MISS' && o.hitAt <= t) continue; // flying away (drawn below)
                const x = xOf(o.time, o.speed);
                if (x < -bigD || x > w + bigD) continue;
                let a = hideAlpha(x);
                if (o.time < t && x < hitX) a *= Math.max(0, Math.min(1, (x - drumW * 0.6) / (hitX - drumW * 0.6)));
                if (a <= 0) continue;
                drawNote(x, cy, o.big ? bigD : smallD, o.kat ? KAT_COLOUR : DON_COLOUR, o.big, a);
            } else if (o.kind === 'roll') {
                const x0 = xOf(o.time, o.speed), x1 = xOf(o.end, o.speed);
                if (x1 < -bigD || x0 > w + bigD) continue;
                const d = o.big ? bigD : smallD;
                const mid = I['taiko-roll-middle'], end = I['taiko-roll-end'];
                const a = hideAlpha(x0);
                ctx.globalAlpha = a;
                if (mid) {
                    const bh = d * (mid.bmp.height * mid.s) / 128 / (I.taikohitcircle ? (I.taikohitcircle.bmp.height * I.taikohitcircle.s) / 128 : 1);
                    drawTinted(ctx, mid, x0, cy - bh / 2, Math.max(0, x1 - x0), bh, ROLL_COLOUR);
                    if (end) { const ew = (end.bmp.width / end.bmp.height) * bh; drawTinted(ctx, end, x1, cy - bh / 2, ew, bh, ROLL_COLOUR); }
                } else {
                    ctx.fillStyle = ROLL_COLOUR;
                    ctx.fillRect(x0, cy - d * 0.4, Math.max(0, x1 - x0), d * 0.8);
                }
                ctx.globalAlpha = 1;
                drawNote(x0, cy, d, ROLL_COLOUR, o.big, a);
            } else if (o.kind === 'swell') {
                const open = t >= o.time && t <= o.end && !(o.done && o.doneAt <= t);
                const finished = (o.done && o.doneAt <= t) || t > o.end;
                if (finished) continue;
                const x = open ? hitX : xOf(o.time, o.speed);
                if (x > w + bigD) continue;
                // the swell note comes in like any note and is gone once it reaches the target;
                // then the swell itself shows
                if (!open) {
                    const warn = I['spinner-warning'];
                    if (warn) ctx.drawImage(warn.bmp, x - bigD / 2, cy - bigD / 2, bigD, bigD);
                    else drawNote(x, cy, bigD, SWELL_COLOUR, true, 1);
                }
                if (open) {
                    // the swell: a big circle with the hits still needed, its ring closing in
                    const left = o.required - o.hits.filter((ht) => ht <= t).length;
                    const p = (t - o.time) / Math.max(1, o.end - o.time);
                    const R = bandH * 1.1, sx = hitX + bandH * 1.6, sy = cy;
                    const circ = I['spinner-circle'], appr = I['spinner-approachcircle'];
                    ctx.globalAlpha = 0.92;
                    // the hand turns with the hits: each one swings it on by an eighth of a turn,
                    // eased over 150 ms, so faster drumming spins it faster
                    let turn = 0;
                    for (const ht of o.hits) { if (ht > t) break; const q = Math.min(1, (t - ht) / 150); turn += (Math.PI / 4) * (1 - (1 - q) * (1 - q)); }
                    if (circ) { ctx.save(); ctx.translate(sx, sy); ctx.rotate(turn); ctx.drawImage(circ.bmp, -R, -R, R * 2, R * 2); ctx.restore(); }
                    else { ctx.beginPath(); ctx.arc(sx, sy, R, 0, Math.PI * 2); ctx.fillStyle = 'rgba(30,30,30,0.85)'; ctx.fill(); }
                    const ar = R * (1 - p * 0.75);
                    if (appr) ctx.drawImage(appr.bmp, sx - ar, sy - ar, ar * 2, ar * 2);
                    else { ctx.beginPath(); ctx.arc(sx, sy, ar, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = '#ffd166'; ctx.stroke(); }
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = '#fff';
                    ctx.font = `800 ${Math.round(bandH * 0.42)}px system-ui, sans-serif`;
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 6;
                    ctx.fillText(String(Math.max(0, left)), sx, sy);
                    ctx.shadowBlur = 0;
                }
            }
        }

        // judgements over the hit target
        const ev = prep.events;
        const ei = eventBefore(ev, t);
        const js = view.judgeScale || 0.6;
        for (let j = ei; j >= 0 && t - ev[j].jt < 380; j--) {
            const e = ev[j];
            const p = (t - e.jt) / 380;
            const name = e.result === 'MISS' ? 'taiko-hit0' : e.result === '100' ? (e.big ? 'taiko-hit100k' : 'taiko-hit100') : (e.big ? 'taiko-hit300k' : 'taiko-hit300');
            const img = I[name] || I[name.replace('k', '')];
            ctx.globalAlpha = Math.max(0, 1 - p * p);
            const y = cy - bandH * (0.05 + 0.25 * p);
            if (img) { const [iw, ih] = size(img); ctx.drawImage(img.bmp, hitX - (iw * js) / 2, y - (ih * js) / 2, iw * js, ih * js); }
            else {
                ctx.fillStyle = e.result === 'MISS' ? '#ff6b6b' : e.result === '100' ? '#7ee787' : '#8bd5ff';
                ctx.font = `800 ${Math.round(bandH * 0.3 * js)}px system-ui, sans-serif`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(e.result === 'MISS' ? '×' : e.result, hitX, y - bandH * 0.4);
            }
            if (j === ei && e.result !== 'MISS' && I['taiko-glow'] && kiai) {
                const [gw, gh] = size(I['taiko-glow']);
                ctx.globalAlpha = 0.6 * (1 - p);
                ctx.drawImage(I['taiko-glow'].bmp, hitX - gw / 2, cy - gh / 2, gw, gh);
            }
            if (j === 0 || ev[j - 1].jt < e.jt - 380) break;
        }
        ctx.globalAlpha = 1;

        // the drum, its halves lighting up for each key
        if (barLeft) ctx.drawImage(barLeft.bmp, 0, bandTop, drumW, bandH);
        else { ctx.fillStyle = '#1b1b1f'; ctx.fillRect(0, bandTop, drumW, bandH); ctx.beginPath(); ctx.arc(drumCx, cy, bandH * 0.36, 0, Math.PI * 2); ctx.fillStyle = '#e9e2cf'; ctx.fill(); }
        const pr = prep.presses;
        let lo = 0, hiI = pr.length - 1, pi = -1;
        while (lo <= hiI) { const mid = (lo + hiI) >> 1; if (pr[mid].t <= t) { pi = mid; lo = mid + 1; } else hiI = mid - 1; }
        const lit = {};
        for (let j = pi; j >= 0 && t - pr[j].t < 140; j--) if (!(pr[j].bit in lit)) lit[pr[j].bit] = 1 - (t - pr[j].t) / 140;
        for (const [bitS, a] of Object.entries(lit)) {
            const bit = Number(bitS);
            const img = I[bit & DON ? 'taiko-drum-inner' : 'taiko-drum-outer'];
            const right = bit === 4 || bit === 8;
            ctx.globalAlpha = a;
            if (img) {
                const [iw, ih] = size(img);
                // the centre image is the drum's left half; the rim image is drawn
                // the other way round (bulging right), as in osu!'s own skins
                const outer = !(bit & DON);
                ctx.save();
                ctx.translate(drumCx, cy);
                if (outer ? !right : right) ctx.scale(-1, 1);
                if (outer) ctx.drawImage(img.bmp, 0, -ih / 2, iw, ih);
                else ctx.drawImage(img.bmp, -iw, -ih / 2, iw, ih);
                ctx.restore();
            } else {
                ctx.beginPath();
                const r = bandH * (bit & DON ? 0.3 : 0.42);
                ctx.arc(drumCx, cy, r, right ? -Math.PI / 2 : Math.PI / 2, right ? Math.PI / 2 : Math.PI * 1.5);
                ctx.fillStyle = bit & DON ? 'rgba(235,69,44,0.8)' : 'rgba(67,142,172,0.8)';
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;

        // combo in the drum
        const last = ei >= 0 ? ev[ei] : null;
        const combo = last ? last.comboAfter : 0;
        if (combo > 0) {
            const cs = view.comboScale || 1;
            const th = bandH * 0.34 * cs;
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4;
            if (skin.comboDigits) {
                const ds = String(combo).split('').map((d) => skin.comboDigits[Number(d)]);
                const sc = th / (ds[0].bmp.height * ds[0].s);
                const widths = ds.map((d) => d.bmp.width * d.s * sc);
                const gap = -(skin.comboOverlap || 0) * sc;
                const total = widths.reduce((a, b) => a + b, 0) + gap * (ds.length - 1);
                let dx = drumCx - total / 2;
                ds.forEach((d, n) => { ctx.drawImage(d.bmp, dx, cy - th / 2, widths[n], th); dx += widths[n] + gap; });
            } else {
                ctx.fillStyle = '#fff';
                ctx.font = `800 ${Math.round(th)}px system-ui, sans-serif`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(String(combo), drumCx, cy);
            }
            ctx.restore();
        }

        // the combo again at the bottom left, as osu! shows it, swelling on each hit
        if (combo > 0) {
            const cs = (view.comboScale || 0.6) / 0.6;
            const bump = last && t - last.jt < 120 ? 1 + 0.12 * (1 - (t - last.jt) / 120) : 1;
            const ch = h * 0.065 * cs * bump;
            let dx = 14;
            const base = h - 14;
            if (skin.comboDigits) {
                const ds = String(combo).split('').map((d) => skin.comboDigits[Number(d)]);
                const kk = ch / (ds[0].bmp.height * ds[0].s);
                for (const g of ds) { const gw = g.bmp.width * g.s * kk, gh = g.bmp.height * g.s * kk; ctx.drawImage(g.bmp, dx, base - gh, gw, gh); dx += gw - (skin.comboOverlap || 0) * kk; }
                ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(ch * 0.7)}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
                ctx.fillText('x', dx + 2, base);
            } else {
                ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(ch)}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
                ctx.fillText(`${combo}x`, dx, base);
            }
        }

        // hit notes (and roll ticks) flying up towards the mascot
        const flyTo = { x: drumW * 0.7, y: bandTop - bandH * 1.25 };
        const fly = (time, d, colour, big) => {
            const p = (t - time) / FLY_MS;
            if (p < 0 || p > 1) return;
            const x = hitX + (flyTo.x - hitX) * p;
            const y = cy + (flyTo.y - cy) * (1 - (1 - p) * (1 - p));
            drawNote(x, y, d, colour, big, p > 0.75 ? (1 - p) / 0.25 : 1);
        };
        const hits = prep.hits;
        for (let j = 0; j < hits.length; j++) {
            const o = hits[j];
            if (o.time > t + 200) break;
            if (o.result && o.result !== 'MISS' && o.hitAt <= t && t - o.hitAt < FLY_MS) fly(o.hitAt, o.big ? bigD : smallD, o.kat ? KAT_COLOUR : DON_COLOUR, o.big);
        }
        for (const r of prep.rolls) {
            if (r.time > t || r.end + r.spacing + FLY_MS < t) continue;
            for (const tk of r.ticks) if (tk.hit && tk.hitAt <= t && t - tk.hitAt < FLY_MS) fly(tk.hitAt, smallD * 0.55, ROLL_COLOUR, false);
        }

        // the mascot
        const M = skin.mascot || {};
        let state = kiai ? 'kiai' : 'idle';
        let frameP = null;
        if (last && last.result === 'MISS') state = 'fail';
        else if (last && last.comboAfter > 0 && last.comboAfter % 50 === 0 && t - last.jt < 700) { state = 'clear'; frameP = (t - last.jt) / 700; }
        let frames = M[state] && M[state].length ? M[state] : M.idle;
        if (frames && frames.length) {
            const beat = prep.beatAt(t);
            const idx = frameP != null ? Math.min(frames.length - 1, Math.floor(frameP * frames.length))
                : state === 'fail' ? Math.floor(t / 150) % frames.length
                : ((Math.floor((t - beat.time) / Math.max(50, beat.beatLength)) % frames.length) + frames.length) % frames.length;
            const f = frames[idx];
            const mw = f.bmp.width * f.s * u * 0.6, mh = f.bmp.height * f.s * u * 0.6;
            ctx.drawImage(f.bmp, drumW * 0.04, bandTop + bandH * 0.09 - mh, mw, mh);
        }
        ctx.restore();
        return {
            combo,
            acc: last ? last.accAfter : 1,
            counts: last ? last.countsAfter : { 300: 0, 100: 0, MISS: 0 },
            ur: last ? last.urAfter : 0,
            lMiss: 0,
            rMiss: 0,
        };
    }

    window.replayTaiko = { prepareTaiko, drawTaiko, JUDGE, JUDGE_COLOR, MOD, convert, windows };
})();
