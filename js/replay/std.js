/* ===== Replay player: osu! (standard) =====
   prepareStd(map, replay) builds what the game shows and judges the replay,
   after osu!lazer's OsuBeatmapProcessor (stacking), Slider / SliderEventGenerator
   and the stable-era rules (MIT):
   - circles, sliders (head, ticks, repeats, the legacy last tick 36 ms
     before the end, tail) and spinners; HR flips the field upside down;
   - a press (M1/M2/K1/K2) hits the earliest object still waiting, if the
     cursor is on it and it is within its windows; a later object can't be
     hit before it (note lock); too early (but within 400 ms) is a miss;
   - sliders track while a key is held and the cursor is on the ball (2.4×
     the radius once tracking); the slider's result is from how many of its
     parts were hit (all 300, half 100, any 50); missing the head, a tick or
     a repeat breaks the combo;
   - spinners count turns of the cursor around the centre while a key is held.
   drawStd(ctx, view, prep, t) draws one frame. */
(function () {
    const MOD = { EZ: 2, HD: 8, HR: 16, DT: 64, HT: 256, NC: 512, FL: 1024 };
    const JUDGE = ['300', '100', '50', 'MISS'];
    const JUDGE_COLOR = { 300: '#8bd5ff', 100: '#7ee787', 50: '#ffd166', MISS: '#ff6b6b' };
    const W = 512, H = 384;
    const range = (d, lo, mid, hi) => (d > 5 ? mid + ((hi - mid) * (d - 5)) / 5 : d < 5 ? mid - ((mid - lo) * (5 - d)) / 5 : mid);

    function difficulty(map, mods) {
        let cs = map.cs, ar = map.ar, od = map.od, hp = map.hp;
        if (mods & MOD.HR) { cs = Math.min(10, cs * 1.3); ar = Math.min(10, ar * 1.4); od = Math.min(10, od * 1.4); hp = Math.min(10, hp * 1.4); }
        if (mods & MOD.EZ) { cs *= 0.5; ar *= 0.5; od *= 0.5; hp *= 0.5; }
        return { cs, ar, od, hp };
    }
    // osu!stable compares whole ms (as in taiko): a window of 49.6 lets in 49
    const win = (x) => Math.floor(x) - 0.5;
    function windows(od) { return { 300: win(range(od, 80, 50, 20)), 100: win(range(od, 140, 100, 60)), 50: win(range(od, 200, 150, 100)), miss: 400 }; }

    function timingAt(map, time) {
        let beat = 500, inherited = null;
        for (const tp of map.timing) {
            if (tp.time > time + 1) break;
            if (tp.uninherited) { beat = tp.beatLength; inherited = null; } else inherited = tp.beatLength;
        }
        return { beat, inherited };
    }

    // osu!lazer SliderEventGenerator (as in catch.js)
    function sliderEvents(start, spanDuration, velocity, tickDistance, distance, spans) {
        const out = [];
        const length = Math.min(100000, distance);
        tickDistance = Math.min(Math.max(tickDistance, 0), length);
        const minFromEnd = velocity * 10;
        out.push({ type: 'head', time: start, progress: 0 });
        if (tickDistance !== 0) {
            for (let span = 0; span < spans; span++) {
                const spanStart = start + span * spanDuration;
                const reversed = span % 2 === 1;
                const ticks = [];
                for (let d = tickDistance; d <= length; d += tickDistance) {
                    if (d >= length - minFromEnd) break;
                    const p = d / length;
                    ticks.push({ type: 'tick', time: spanStart + (reversed ? 1 - p : p) * spanDuration, progress: p, span });
                }
                if (reversed) ticks.reverse();
                out.push(...ticks);
                if (span < spans - 1) out.push({ type: 'repeat', time: spanStart + spanDuration, progress: (span + 1) % 2, span });
            }
        }
        const totalDuration = spans * spanDuration;
        const finalSpanStart = start + (spans - 1) * spanDuration;
        const finalSpanEnd = Math.max(start + totalDuration / 2, finalSpanStart + spanDuration - 36);
        let finalProgress = (finalSpanEnd - finalSpanStart) / spanDuration;
        if (spans % 2 === 0) finalProgress = 1 - finalProgress;
        out.push({ type: 'legacylast', time: finalSpanEnd, progress: finalProgress });
        out.push({ type: 'tail', time: start + totalDuration, progress: spans % 2 });
        return out;
    }

    function convert(map, mods, diff) {
        const flip = !!(mods & MOD.HR);
        const fy = (y) => (flip ? H - y : y);
        const scale = (1 - (0.7 * (diff.cs - 5)) / 5) / 2;
        const radius = 64 * scale;
        const preempt = range(diff.ar, 1800, 1200, 450);
        const objs = [];
        let combo = -1, number = 0;
        map.objects.forEach((o, index) => {
            if (o.newCombo || combo < 0 || (o.type & 8)) { if (o.newCombo || combo < 0) { combo += 1 + (o.newCombo ? o.comboSkip : 0); number = 0; } }
            const base = { index, time: o.time, x: o.x, y: fy(o.y), combo: Math.max(0, combo), stack: 0 };
            if (o.type & 8) {
                objs.push({ ...base, kind: 'spinner', x: W / 2, y: H / 2, end: o.endTime || o.time });
                number = 0; // a spinner starts the numbers again
                return;
            }
            number++;
            base.number = number;
            if (o.type & 2) {
                const pts = o.points.map((p) => ({ x: p.x, y: fy(p.y) }));
                const path = window.replayCurves.buildSliderPath({ ...o, points: pts });
                const { beat, inherited } = timingAt(map, o.time);
                const bpmMultiplier = inherited != null && inherited < 0 ? Math.min(1000, Math.max(10, Math.fround(-inherited))) / 100 : 1;
                const velocity = (100 * map.sliderMultiplier) / (beat * bpmMultiplier);
                const tickDistance = (velocity * beat) / map.sliderTickRate * (map.version < 8 ? bpmMultiplier : 1);
                const spanDuration = path.distance / velocity;
                const spans = o.slides || 1;
                const events = sliderEvents(o.time, spanDuration, velocity, tickDistance, path.distance, spans);
                const endPos = path.positionAt(spans % 2);
                objs.push({ ...base, kind: 'slider', path, spans, spanDuration, end: o.time + spans * spanDuration, events, endX: endPos.x, endY: endPos.y });
            } else {
                objs.push({ ...base, kind: 'circle' });
            }
        });
        return { objs, radius, scale, preempt };
    }

    // osu!lazer OsuBeatmapProcessor.applyStacking (beatmap version 6+), and the old one
    function applyStacking(objs, preempt, leniency, version) {
        const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
        const endTime = (o) => (o.kind === 'circle' ? o.time : o.end);
        const endX = (o) => (o.kind === 'slider' ? o.endX : o.x), endY = (o) => (o.kind === 'slider' ? o.endY : o.y);
        const STACK = 3;
        if (version >= 6) {
            let extendedStart = 0;
            for (let i = objs.length - 1; i > 0; i--) {
                let n = i;
                let oi = objs[i];
                if (oi.stack !== 0 || oi.kind === 'spinner') continue;
                const threshold = preempt * leniency;
                if (oi.kind === 'circle') {
                    while (--n >= 0) {
                        const on = objs[n];
                        if (on.kind === 'spinner') continue;
                        if (oi.time - endTime(on) > threshold) break;
                        if (n < extendedStart) { on.stack = 0; extendedStart = n; }
                        if (on.kind === 'slider' && dist(endX(on), endY(on), oi.x, oi.y) < STACK) {
                            const offset = oi.stack - on.stack + 1;
                            for (let j = n + 1; j <= i; j++) {
                                const oj = objs[j];
                                if (dist(endX(on), endY(on), oj.x, oj.y) < STACK) oj.stack -= offset;
                            }
                            break;
                        }
                        if (dist(on.x, on.y, oi.x, oi.y) < STACK) { on.stack = oi.stack + 1; oi = on; }
                    }
                } else if (oi.kind === 'slider') {
                    while (--n >= 0) {
                        const on = objs[n];
                        if (on.kind === 'spinner') continue;
                        if (oi.time - on.time > threshold) break;
                        if (dist(endX(on), endY(on), oi.x, oi.y) < STACK) { on.stack = oi.stack + 1; oi = on; }
                    }
                }
            }
        } else {
            for (let i = 0; i < objs.length; i++) {
                const cur = objs[i];
                if (cur.stack !== 0 && cur.kind !== 'slider') continue;
                let start = endTime(cur);
                let sliderStack = 0;
                for (let j = i + 1; j < objs.length; j++) {
                    if (objs[j].time - preempt * leniency > start) break;
                    if (dist(objs[j].x, objs[j].y, cur.x, cur.y) < STACK) { cur.stack++; start = endTime(objs[j]); }
                    else if (dist(objs[j].x, objs[j].y, endX(cur), endY(cur)) < STACK) { sliderStack++; objs[j].stack -= sliderStack; start = endTime(objs[j]); }
                }
            }
        }
    }

    function prepareStd(map, replay) {
        const mods = replay.mods >>> 0;
        const diff = difficulty(map, mods);
        const { objs, radius, scale, preempt } = convert(map, mods, diff);
        const leniency = Number(map.general && map.general.StackLeniency) || 0.7;
        applyStacking(objs, preempt, leniency, map.version || 14);
        for (const o of objs) {
            const off = o.stack * scale * -6.4;
            o.sx = o.x + off; o.sy = o.y + off; // where it is drawn and hit
            o.off = off;
        }
        const w = windows(diff.od);
        const frames = replay.frames;
        // a lazer score without CL: its accuracy counts slider ticks and ends (formats.js)
        const lazerAcc = replay.lazerAcc != null;
        // the cursor between frames, and the key state of the frame before
        const posAt = (t) => {
            if (!frames.length) return { x: W / 2, y: H / 2, keys: 0 };
            if (t <= frames[0].t) return { x: frames[0].x, y: frames[0].y, keys: frames[0].keys };
            let lo = 0, hi = frames.length - 1;
            while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (frames[mid].t <= t) lo = mid; else hi = mid - 1; }
            const a = frames[lo], b = frames[Math.min(lo + 1, frames.length - 1)];
            const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
            return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, keys: a.keys };
        };
        const flip = !!(mods & MOD.HR);
        const cy = (y) => (flip ? H - y : y); // replay cursor is in unflipped space? (stable records what the player saw)

        // presses: a new M1 / M2 (K1 sets M1, K2 sets M2)
        const presses = [];
        let prev = 0;
        for (const f of frames) {
            const k = f.keys & 3;
            const now = k & ~prev;
            if (now & 1) presses.push({ t: f.t, x: f.x, y: f.y });
            if (now & 2) presses.push({ t: f.t, x: f.x, y: f.y });
            prev = k;
        }

        // each key on its own, for the key overlay: K1 (4), K2 (8), M1 (1 without K1), M2 (2 without K2)
        const keyPress = { K1: [], K2: [], M1: [], M2: [] };
        // osu!lazer's replays record only a left and a right button (lazer doesn't tell keys
        // from mouse buttons): shown as K1 / K2, as most players use the keyboard
        const lazerButtons = replay.version >= 30000000 && !frames.some((f) => f.keys & 12);
        const keyDown = lazerButtons
            ? (keys) => ({ K1: !!(keys & 1), K2: !!(keys & 2), M1: false, M2: false })
            : (keys) => ({ K1: !!(keys & 4), K2: !!(keys & 8), M1: !!(keys & 1) && !(keys & 4), M2: !!(keys & 2) && !(keys & 8) });
        const keyList = lazerButtons ? ['K1', 'K2'] : ['K1', 'K2', 'M1', 'M2'];
        // Counted only from when the first object appears: the frames before it hold
        // whatever the keys did while the game loaded or the intro was skipped (a lone
        // M1, all four at once...), which made keyboard players look like mouse players.
        const countFrom = objs.length ? objs[0].time - preempt : 0;
        let was = keyDown(0);
        for (const f of frames) {
            const now = keyDown(f.keys);
            if (f.t >= countFrom) for (const key of keyList) if (now[key] && !was[key]) keyPress[key].push(f.t);
            was = now;
        }

        // 1) heads: circles and slider heads, in order, with note lock
        const heads = objs.filter((o) => o.kind !== 'spinner');
        let hi = 0;
        const missHead = (o) => { o.headResult = 'MISS'; o.headAt = o.time + w[50]; };
        for (const p of presses) {
            while (hi < heads.length && p.t - heads[hi].time > w[50]) { missHead(heads[hi]); hi++; }
            if (hi >= heads.length) break;
            const o = heads[hi];
            const off = p.t - o.time;
            if (off < -w.miss) continue; // too early to count
            if (Math.hypot(p.x - o.sx, p.y - o.sy) > radius) continue; // not on it (and later ones are locked)
            const a = Math.abs(off);
            o.headResult = a <= w[300] ? '300' : a <= w[100] ? '100' : a <= w[50] ? '50' : 'MISS';
            o.headAt = p.t;
            o.offset = off;
            hi++;
        }
        for (; hi < heads.length; hi++) missHead(heads[hi]);

        // 2) sliders: tracking frame by frame over each slider
        for (const s of objs) {
            if (s.kind !== 'slider') continue;
            const ballAt = (t) => {
                const local = Math.max(0, Math.min(s.spans, (t - s.time) / s.spanDuration));
                const span = Math.min(s.spans - 1, Math.floor(local));
                let p = local - span;
                if (span % 2 === 1) p = 1 - p;
                const pos = s.path.positionAt(p);
                return { x: pos.x + s.off, y: pos.y + s.off };
            };
            s.ballAt = ballAt;
            // frames in the slider (and the one just before)
            let lo = 0, hi2 = frames.length - 1;
            while (lo < hi2) { const mid = (lo + hi2 + 1) >> 1; if (frames[mid].t <= s.time) lo = mid; else hi2 = mid - 1; }
            let tracking = false;
            const track = []; // [{t, on}]
            for (let i = lo; i < frames.length && frames[i].t <= s.end + 20; i++) {
                const f = frames[i];
                const t = Math.max(f.t, s.time);
                const b = ballAt(t);
                const held = (f.keys & 3) !== 0;
                const reach = tracking ? radius * 2.4 : radius;
                tracking = held && Math.hypot(f.x - b.x, f.y - b.y) <= reach && f.t >= s.time - 0.5;
                track.push({ t: f.t, on: tracking });
            }
            const trackingAt = (t) => { let on = false; for (const e of track) { if (e.t > t) break; on = e.on; } return on; };
            s.track = track;
            let got = s.headResult !== 'MISS' ? 1 : 0, total = 1;
            s.parts = [{ type: 'head', time: s.time, hit: got === 1, at: s.headAt }];
            for (const e of s.events) {
                if (e.type === 'head' || e.type === 'tail') continue;
                const hit = trackingAt(e.time);
                total++; if (hit) got++;
                s.parts.push({ type: e.type, time: e.time, hit, progress: e.progress });
            }
            s.result = got === total ? '300' : got * 2 >= total ? '100' : got > 0 ? '50' : 'MISS';
        }

        // 3) spinners: turns of the cursor while a key is held
        for (const sp of objs) {
            if (sp.kind !== 'spinner') continue;
            const dur = sp.end - sp.time;
            sp.required = Math.max(0, Math.trunc((dur / 1000) * range(diff.od, 1.5, 2.5, 3.75)));
            let total = 0, last = null;
            sp.turns = []; // [{t, total}] for drawing
            for (const f of frames) {
                if (f.t < sp.time) continue;
                if (f.t > sp.end) break;
                const ang = Math.atan2(f.y - H / 2, f.x - W / 2);
                if (last && (f.keys & 3)) {
                    let d = ang - last.ang;
                    while (d > Math.PI) d -= 2 * Math.PI;
                    while (d < -Math.PI) d += 2 * Math.PI;
                    const cap = 0.05 * Math.max(1, f.t - last.t); // stable's top speed (~477 rpm)
                    total += Math.max(-cap, Math.min(cap, d));
                }
                last = { ang, t: f.t };
                sp.turns.push({ t: f.t, total });
            }
            const spins = Math.abs(total) / (2 * Math.PI);
            const prog = sp.required ? spins / sp.required : 1;
            sp.spins = spins;
            sp.result = prog >= 1 ? '300' : prog > 0.9 ? '100' : prog > 0.75 ? '50' : 'MISS';
        }

        // 4) judgement events in time order, with combo, accuracy, UR
        const events = [];
        for (const o of objs) {
            if (o.kind === 'circle') events.push({ o, jt: o.headAt, result: o.headResult, combo: o.headResult !== 'MISS' ? 1 : 'break', count: true });
            else if (o.kind === 'slider') {
                for (const p of o.parts) {
                    if (p.type === 'head') events.push({ o, jt: p.hit ? p.at : o.time + w[50], combo: p.hit ? 1 : 'break' });
                    else if (p.type === 'legacylast') events.push({ o, jt: p.time, combo: p.hit ? 1 : 0, part: 'end', hit: p.hit });
                    else events.push({ o, jt: p.time, combo: p.hit ? 1 : 'break', part: 'tick', hit: p.hit });
                }
                // lazer (no CL) judges a slider by its head's timing; stable by all its parts
                events.push({ o, jt: o.end, result: lazerAcc ? o.headResult : o.result, combo: 0, count: true });
            } else events.push({ o, jt: o.end, result: o.result, combo: o.result !== 'MISS' ? 1 : 0, count: true });
        }
        events.sort((a, b) => a.jt - b.jt);
        const counts = { 300: 0, 100: 0, 50: 0, MISS: 0 };
        let combo = 0, best = 0, offN = 0, offSum = 0, offSq = 0;
        let lzGot = 0, lzMax = 0; // lazer accuracy: objects, slider ticks (30) and ends (150)
        let ltHit = 0, seHit = 0; // slider ticks / repeats hit, slider ends hit (lazer pp)
        const rate = mods & (MOD.DT | MOD.NC) ? 1.5 : mods & MOD.HT ? 0.75 : 1;
        for (const e of events) {
            if (e.combo === 'break') combo = 0; else combo += e.combo;
            if (e.count) {
                counts[e.result]++;
                if (e.result === 'MISS' && e.o.kind === 'circle') combo = 0;
                if (e.o.kind !== 'spinner' && e.o.headResult && e.o.headResult !== 'MISS' && e.o.offset != null) {
                    const off = e.o.offset / rate;
                    offN++; offSum += off; offSq += off * off;
                }
            }
            best = Math.max(best, combo);
            e.bestAfter = best;
            const n = counts[300] + counts[100] + counts[50] + counts.MISS;
            e.comboAfter = combo;
            if (lazerAcc) {
                if (e.count) { lzMax += 300; lzGot += { 300: 300, 100: 100, 50: 50 }[e.result] || 0; }
                else if (e.part === 'tick') { lzMax += 30; if (e.hit) { lzGot += 30; ltHit++; } }
                else if (e.part === 'end') { lzMax += 150; if (e.hit) { lzGot += 150; seHit++; } }
                e.ltAfter = ltHit; e.seAfter = seHit;
                e.accAfter = lzMax ? lzGot / lzMax : 1;
            } else e.accAfter = n ? (300 * counts[300] + 100 * counts[100] + 50 * counts[50]) / (300 * n) : 1;
            e.countsAfter = { ...counts };
            e.urAfter = offN > 1 ? 10 * Math.sqrt(Math.max(0, offSq / offN - (offSum / offN) ** 2)) : 0;
        }

        // hits with their timing, for the error bar
        const hitOffsets = heads.filter((o) => o.headResult && o.headResult !== 'MISS' && o.offset != null).map((o) => ({ t: o.headAt, off: o.offset, r: o.headResult })).sort((a, b) => a.t - b.t);
        const last = objs[objs.length - 1];
        const lastTime = last ? (last.kind === 'circle' ? last.time : last.end) : 0;
        const kiai = map.timing.map((tp) => ({ time: tp.time, kiai: !!tp.kiai }));
        // the map's own combo colours come first, as in osu! (unless a player turns them off)
        const mapColours = (map.colours || []).filter((c) => c.length >= 3 && c.every(Number.isFinite)).map((c) => `rgba(${c[0]},${c[1]},${c[2]},1)`);
        return { mode: 0, mapColours, keyPress, keyDown, keyList, hitOffsets, objs, notes: objs, events, counts, bestCombo: best, posAt, presses, radius, scale, preempt, fadeIn: 400 * Math.min(1, preempt / 450), windows: w, diff, rate, lastTime, kiai, hidden: !!(mods & MOD.HD), flashlight: !!(mods & MOD.FL), flip, cy };
    }


    const FADE_OUT = 240; // a hit circle's burst / a slider's fade after its end
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
    const lighten = (rgba, f) => rgba.replace(/rgba?\(([^)]+)\)/, (m, inner) => {
        const [r, g, b, a] = inner.split(',').map(Number);
        return `rgba(${Math.round(r + (255 - r) * f)},${Math.round(g + (255 - g) * f)},${Math.round(b + (255 - b) * f)},${a == null ? 1 : a})`;
    });
    const darken = (rgba, f) => rgba.replace(/rgba?\(([^)]+)\)/, (m, inner) => {
        const [r, g, b, a] = inner.split(',').map(Number);
        return `rgba(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)},${a == null ? 1 : a})`;
    });

    function eventBefore(list, t) {
        let lo = 0, hi = list.length - 1, ans = -1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid].jt <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
        return ans;
    }

    /* a slider's body, drawn once per size into its own canvas: the border,
       the track (the skin's override or the combo colour, darker at the edges) */
    const bodyCache = new WeakMap();
    function sliderBody(s, k, r, skin, colour) {
        const key = `${k.toFixed(3)}|${colour}`;
        const hit = bodyCache.get(s);
        if (hit && hit.key === key) return hit;
        const pts = s.path.path.map((p) => ({ x: (p.x + s.off) * k, y: (p.y + s.off) * k }));
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
        const R = r * k, pad = R + 4;
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.ceil(x1 - x0 + pad * 2));
        c.height = Math.max(1, Math.ceil(y1 - y0 + pad * 2));
        const g = c.getContext('2d');
        g.translate(pad - x0, pad - y0);
        g.lineCap = 'round'; g.lineJoin = 'round';
        const line = (width, style) => {
            g.beginPath();
            pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
            if (pts.length === 1) g.lineTo(pts[0].x + 0.01, pts[0].y);
            g.lineWidth = width; g.strokeStyle = style; g.stroke();
        };
        const track = skin.sliderTrack || darken(colour, 0.7);
        line(R * 2, skin.sliderBorder);
        line(R * 2 * 0.84, darken(track, 0.72));
        // the track is lighter towards its middle, as osu! shades it
        for (let i = 1; i <= 5; i++) line(R * 2 * 0.84 * (1 - i * 0.15), lighten(track, i * 0.05));
        const out = { key, c, x: x0 - pad, y: y0 - pad };
        bodyCache.set(s, out);
        return out;
    }

    /* One frame at song time t, as osu! draws it (checked against
       replayviewer.com): the 512×384 field in the middle of the view,
       circles with their numbers and approach circles, sliders with ball,
       follow circle, ticks and reverse arrows, spinners, judgements, the
       cursor and its trail, the combo at the bottom left.
       view: { w, h, bg, bgDim, skin (standard skin config), judgeScale, comboScale } */
    function drawStd(ctx, view, prep, t) {
        const { w, h } = view;
        const skin = view.skin || prep.defaultSkin || { img: {}, combo: ['rgba(255,192,0,1)'], sliderBorder: 'rgba(255,255,255,1)', sliderb: [] };
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
        // view.fieldW: the share of the width the field may take (narrower in a half screen,
        // where objects at the edge would otherwise be cut off)
        const k = Math.min((h * 0.8) / H, (w * (view.fieldW || 0.92)) / W);
        const ox = (w - W * k) / 2, oy = (h - H * k) / 2 + 8 * k * 0.5;
        const X = (x) => ox + x * k, Y = (y) => oy + y * k;
        const r = prep.radius, R = r * k;
        const u = h / 768; // skin pixels (judgements, cursor) scale with the screen
        const palette = prep.mapColours && prep.mapColours.length ? prep.mapColours : skin.combo;
        const colourOf = (o) => palette[o.combo % palette.length];
        const { preempt, fadeIn } = prep;
        const hd = prep.hidden;

        // a circle (or slider head) with its number
        function circle(o, x, y, alpha, scale, start) {
            const base = I[start ? 'sliderstartcircle' : 'hitcircle'] || I.hitcircle;
            const over = I[start ? 'sliderstartcircleoverlay' : 'hitcircleoverlay'] || I.hitcircleoverlay;
            const d = R * 2 * scale * (base ? (base.bmp.width * base.s) / 128 : 1);
            ctx.globalAlpha = alpha;
            if (base) drawTinted(ctx, base, x - d / 2, y - d / 2, d, d, colourOf(o));
            else { ctx.beginPath(); ctx.arc(x, y, R * scale, 0, Math.PI * 2); ctx.fillStyle = colourOf(o); ctx.fill(); }
            const number = () => {
                if (!o.number || scale > 1.01) return;
                if (skin.digits) {
                    // osu!: digits at 0.8× the circle's scale, each next one overlapping by HitCircleOverlap
                    const kk = (R / 64) * 0.8;
                    const ds = String(o.number).split('').map((c) => skin.digits[Number(c)]);
                    const widths = ds.map((g) => g.bmp.width * g.s * kk);
                    const step = (i) => widths[i] - (skin.overlap || 0) * kk;
                    const total = widths.reduce((s2, wd, i) => s2 + (i < widths.length - 1 ? step(i) : wd), 0);
                    let dx = x - total / 2;
                    ds.forEach((g, i) => { const dh = g.bmp.height * g.s * kk; ctx.drawImage(g.bmp, dx, y - dh / 2, widths[i], dh); dx += step(i); });
                } else {
                    ctx.fillStyle = '#fff';
                    ctx.font = `700 ${Math.round(R * 0.8)}px system-ui, sans-serif`;
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillText(String(o.number), x, y);
                }
            };
            if (!skin.overlayAbove) number();
            if (over) { const od = R * 2 * scale * ((over.bmp.width * over.s) / 128); ctx.drawImage(over.bmp, x - od / 2, y - od / 2, od, od); }
            if (skin.overlayAbove) number();
            ctx.globalAlpha = 1;
        }
        function approach(o, x, y, alpha) {
            const p = (o.time - t) / preempt;
            if (p < 0 || p > 1) return;
            if (hd && o !== prep.objs[0]) return;
            const sc = 1 + 3 * p;
            const a = I.approachcircle;
            const d = R * 2 * sc * (a ? (a.bmp.width * a.s) / 128 : 1);
            ctx.globalAlpha = alpha * 0.9;
            if (a) drawTinted(ctx, a, x - d / 2, y - d / 2, d, d, colourOf(o));
            else { ctx.beginPath(); ctx.arc(x, y, R * sc, 0, Math.PI * 2); ctx.lineWidth = Math.max(2, R * 0.08); ctx.strokeStyle = colourOf(o); ctx.stroke(); }
            ctx.globalAlpha = 1;
        }
        // how visible an object is before its time (fade-in, or HD's in-and-out)
        const appear = (o) => {
            const since = t - (o.time - preempt);
            if (since < 0) return 0;
            if (hd) {
                const inD = preempt * 0.4;
                if (since < inD) return since / inD;
                return Math.max(0, 1 - (since - inD) / (preempt * 0.3));
            }
            return Math.min(1, since / fadeIn);
        };

        // follow points between objects of one combo
        const fp = I.followpoint;
        for (let i = 0; i < prep.objs.length - 1; i++) {
            const a = prep.objs[i], b = prep.objs[i + 1];
            if (b.time - preempt > t) break;
            if (b.kind === 'spinner' || a.kind === 'spinner' || b.combo !== a.combo) continue;
            const aEnd = a.kind === 'slider' ? a.end : a.time;
            if (t > b.time) continue;
            const ax = a.kind === 'slider' ? a.endX + a.off : a.sx, ay = a.kind === 'slider' ? a.endY + a.off : a.sy;
            const dx = b.sx - ax, dy = b.sy - ay, dist = Math.hypot(dx, dy);
            if (dist < r * 2.5) continue;
            const ang = Math.atan2(dy, dx);
            for (let d = r * 1.5; d < dist - r * 1.5; d += 32) {
                const f = d / dist;
                const appearAt = aEnd - preempt + (b.time - aEnd) * f * 0.5;
                const goneAt = aEnd + (b.time - aEnd) * f;
                if (t < appearAt || t > goneAt + 200) continue;
                const al = Math.min(1, (t - appearAt) / 200) * (t > goneAt ? 1 - (t - goneAt) / 200 : 1);
                const px = X(ax + dx * f), py = Y(ay + dy * f);
                ctx.globalAlpha = al * 0.8;
                if (fp) { const fw = fp.bmp.width * fp.s * u, fh = fp.bmp.height * fp.s * u; ctx.save(); ctx.translate(px, py); ctx.rotate(ang); ctx.drawImage(fp.bmp, -fw / 2, -fh / 2, fw, fh); ctx.restore(); }
                else { ctx.fillStyle = '#fff'; ctx.fillRect(px - 2, py - 1, 4, 2); }
            }
        }
        ctx.globalAlpha = 1;

        // objects, later ones underneath
        for (let i = prep.objs.length - 1; i >= 0; i--) {
            const o = prep.objs[i];
            if (o.time - preempt > t) continue;
            const end = o.kind === 'circle' ? o.time : o.end;
            if (t > end + FADE_OUT + 400) continue;
            const x = X(o.sx), y = Y(o.sy);
            if (o.kind === 'circle') {
                const a = appear(o);
                if (o.headAt != null && t >= o.headAt) {
                    const p = (t - o.headAt) / FADE_OUT;
                    if (p >= 1) continue;
                    if (o.headResult === 'MISS') circle(o, x, y, (hd ? 0 : 1) * (1 - p), 1);
                    else if (!hd) circle(o, x, y, 1 - p, 1 + 0.4 * p);
                    continue;
                }
                circle(o, x, y, a, 1);
                approach(o, x, y, hd ? appear(o) : Math.min(1, (t - (o.time - preempt)) / fadeIn));
            } else if (o.kind === 'slider') {
                const col = colourOf(o);
                const since = t - (o.time - preempt);
                let bodyA = Math.min(1, since / fadeIn);
                if (hd) bodyA = t < o.time ? Math.min(1, since / (preempt * 0.4)) * 1 : Math.max(0, 1 - (t - o.time) / Math.max(1, o.end - o.time));
                if (t > o.end) bodyA *= Math.max(0, 1 - (t - o.end) / FADE_OUT);
                if (bodyA > 0) {
                    const body = sliderBody(o, k, r, skin, col);
                    ctx.globalAlpha = bodyA * 0.85;
                    ctx.drawImage(body.c, ox + body.x, oy + body.y);
                    ctx.globalAlpha = 1;
                }
                const active = t >= o.time && t <= o.end;
                const local = Math.max(0, Math.min(o.spans, (t - o.time) / o.spanDuration));
                const span = Math.min(o.spans - 1, Math.floor(local));
                // ticks still to come in this span
                const tp = I.sliderscorepoint;
                if (bodyA > 0 && t <= o.end) {
                    for (const e of o.events) {
                        if (e.type !== 'tick' || e.time <= t) continue;
                        if (t >= o.time ? e.span !== span : e.span !== 0) continue;
                        const pos = o.path.positionAt(e.progress);
                        const px = X(pos.x + o.off), py = Y(pos.y + o.off);
                        ctx.globalAlpha = bodyA;
                        if (tp) { const tw = tp.bmp.width * tp.s * (R / 64), th = tp.bmp.height * tp.s * (R / 64); ctx.drawImage(tp.bmp, px - tw / 2, py - th / 2, tw, th); }
                        else { ctx.beginPath(); ctx.arc(px, py, R * 0.12, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); }
                    }
                    ctx.globalAlpha = 1;
                }
                // a reverse arrow at the end the ball is heading to, while repeats remain
                const ra = I.reversearrow;
                if (bodyA > 0 && o.spans > 1 && span < o.spans - 1) {
                    const towardEnd = span % 2 === 0;
                    const pEnd = towardEnd ? 1 : 0, pIn = towardEnd ? 0.98 : 0.02;
                    const a1 = o.path.positionAt(pEnd), a2 = o.path.positionAt(pIn);
                    const px = X(a1.x + o.off), py = Y(a1.y + o.off);
                    const ang = Math.atan2(a2.y - a1.y, a2.x - a1.x);
                    const pulse = 1 + 0.15 * (1 - ((t % 300) / 300));
                    ctx.globalAlpha = bodyA;
                    ctx.save(); ctx.translate(px, py); ctx.rotate(ang); ctx.scale(pulse, pulse);
                    if (ra) { const d = R * 2 * ((ra.bmp.width * ra.s) / 128); ctx.drawImage(ra.bmp, -d / 2, -d / 2, d, d); }
                    else { ctx.beginPath(); ctx.moveTo(R * 0.5, 0); ctx.lineTo(-R * 0.3, -R * 0.4); ctx.lineTo(-R * 0.3, R * 0.4); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill(); }
                    ctx.restore();
                    ctx.globalAlpha = 1;
                }
                // the end circle (skins that draw one)
                if (I.sliderendcircle && bodyA > 0 && t <= o.end) {
                    const ex = X(o.path.positionAt(1).x + o.off), ey = Y(o.path.positionAt(1).y + o.off);
                    const d = R * 2;
                    ctx.globalAlpha = bodyA;
                    drawTinted(ctx, I.sliderendcircle, ex - d / 2, ey - d / 2, d, d, col);
                    if (I.sliderendcircleoverlay) ctx.drawImage(I.sliderendcircleoverlay.bmp, ex - d / 2, ey - d / 2, d, d);
                    ctx.globalAlpha = 1;
                }
                // the head until it is hit (then it bursts)
                if (o.headAt == null || t < o.headAt) {
                    circle(o, x, y, appear(o), 1, true);
                    approach(o, x, y, hd ? appear(o) : Math.min(1, since / fadeIn));
                } else if (t - o.headAt < FADE_OUT && o.headResult !== 'MISS' && !hd) {
                    const p = (t - o.headAt) / FADE_OUT;
                    circle({ ...o, number: 0 }, x, y, 1 - p, 1 + 0.4 * p, true);
                }
                // the ball and, while tracking, the follow circle
                if (active) {
                    const b = o.ballAt(t);
                    const bx = X(b.x), by = Y(b.y);
                    let tracking = false;
                    let since2 = 0;
                    for (const e of o.track) { if (e.t > t) break; if (e.on !== tracking) since2 = e.t; tracking = e.on; }
                    const fc = I.sliderfollowcircle;
                    if (tracking) {
                        const grow = Math.min(1, (t - since2) / 150);
                        const d = R * 2 * (fc ? (fc.bmp.width * fc.s) / 128 : 2.4) * (0.5 + 0.5 * grow);
                        ctx.globalAlpha = grow;
                        if (fc) ctx.drawImage(fc.bmp, bx - d / 2, by - d / 2, d, d);
                        else { ctx.beginPath(); ctx.arc(bx, by, d / 2, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.stroke(); }
                        ctx.globalAlpha = 1;
                    }
                    const frames = skin.sliderb;
                    if (frames && frames.length) {
                        const dist = (t - o.time) / o.spanDuration * o.path.distance;
                        const f = frames[Math.floor(dist / 8) % frames.length];
                        const d = R * 2 * ((f.bmp.width * f.s) / 128);
                        const p2 = o.path.positionAt(Math.min(1, Math.max(0, (local - span) * (span % 2 ? -1 : 1) + (span % 2 ? 1 : 0)) + 0.01));
                        const ang = Math.atan2(Y(p2.y + o.off) - by, X(p2.x + o.off) - bx) + (span % 2 ? Math.PI : 0);
                        ctx.save(); ctx.translate(bx, by); ctx.rotate(ang);
                        drawTinted(ctx, f, -d / 2, -d / 2, d, d, skin.allowBallTint ? col : null);
                        ctx.restore();
                    } else { ctx.beginPath(); ctx.arc(bx, by, R * 0.9, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); }
                }
            } else {
                // spinner
                const fadeStart = o.time - 400;
                if (t < fadeStart) continue;
                let a = Math.min(1, (t - fadeStart) / 400);
                if (t > o.end) a *= Math.max(0, 1 - (t - o.end) / FADE_OUT);
                if (a <= 0) continue;
                let turn = 0;
                for (const e of o.turns) { if (e.t > t) break; turn = e.total; }
                const done = o.required ? Math.abs(turn) / (2 * Math.PI) / o.required : 1;
                const cx = X(W / 2), cy = Y(H / 2);
                ctx.globalAlpha = a;
                if (skin.spinnerOld) {
                    const bgI = I['spinner-background'], ci = I['spinner-circle'], ap = I['spinner-approachcircle'];
                    if (bgI) { const bw = bgI.bmp.width * bgI.s * u, bh = bgI.bmp.height * bgI.s * u; ctx.drawImage(bgI.bmp, cx - bw / 2, cy - bh / 2, bw, bh); }
                    // the meter fills from the bottom as the spinner is turned
                    const me = I['spinner-metre'];
                    if (me) {
                        const mw = me.bmp.width * me.s * u, mh = me.bmp.height * me.s * u;
                        const fill = Math.min(1, done);
                        const shown = Math.round(fill * 10) / 10; // osu! fills it in ten steps
                        if (shown > 0) {
                            const sy = me.bmp.height * (1 - shown);
                            ctx.drawImage(me.bmp, 0, sy, me.bmp.width, me.bmp.height - sy, cx - mw / 2, cy - mh / 2 + mh * (1 - shown), mw, mh * shown);
                        }
                    }
                    if (ci) { const d = ci.bmp.width * ci.s * u; ctx.save(); ctx.translate(cx, cy); ctx.rotate(turn); ctx.drawImage(ci.bmp, -d / 2, -d / 2, d, d); ctx.restore(); }
                    if (ap && t < o.end) { const p = Math.max(0, (o.end - t) / Math.max(1, o.end - o.time)); const d = ap.bmp.width * ap.s * u * Math.max(0.02, p); ctx.drawImage(ap.bmp, cx - d / 2, cy - d / 2, d, d); }
                } else {
                    const part = (name, rot, tint, sc) => {
                        const im = I[name];
                        if (!im) return;
                        const d = im.bmp.width * im.s * u * 0.8 * (sc || 1), dh = im.bmp.height * im.s * u * 0.8 * (sc || 1);
                        ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot || 0);
                        drawTinted(ctx, im, -d / 2, -dh / 2, d, dh, tint || null);
                        ctx.restore();
                    };
                    ctx.globalAlpha = a * Math.min(1, done);
                    part('spinner-glow', 0, 'rgba(3,151,255,1)');
                    ctx.globalAlpha = a;
                    part('spinner-bottom', turn / 5);
                    part('spinner-top', turn / 2);
                    part('spinner-middle2', 0, null);
                    part('spinner-middle', 0, done >= 1 ? null : `rgba(255,${Math.round(255 * Math.min(1, done))},${Math.round(255 * Math.min(1, done))},1)`);
                    if (!I['spinner-top']) {
                        ctx.beginPath(); ctx.arc(cx, cy, R * 3, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.stroke();
                        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(turn) * R * 3, cy + Math.sin(turn) * R * 3); ctx.stroke();
                    }
                }
                // turns beyond the ones needed score a bonus, counted up under the centre
                const extra = Math.floor(Math.abs(turn) / (2 * Math.PI) - o.required);
                if (extra >= 1 && t <= o.end + 200) {
                    const bonus = String(extra * 1000);
                    const cf = skin.comboFont;
                    const bh = h * 0.07;
                    const by = cy + h * 0.2;
                    if (cf) {
                        const gs = bonus.split('').map((d) => cf.digits[Number(d)]);
                        const kk = bh / (gs[0].bmp.height * gs[0].s);
                        const total = gs.reduce((a2, g) => a2 + g.bmp.width * g.s * kk, 0);
                        let bx = cx - total / 2;
                        for (const g of gs) { const gw = g.bmp.width * g.s * kk; ctx.drawImage(g.bmp, bx, by - bh / 2, gw, bh); bx += gw; }
                    } else {
                        ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(bh)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                        ctx.fillText(bonus, cx, by);
                    }
                }
                if (done >= 1 && I['spinner-clear'] && t <= o.end) {
                    const sc = I['spinner-clear'];
                    const cw = sc.bmp.width * sc.s * u, ch = sc.bmp.height * sc.s * u;
                    ctx.drawImage(sc.bmp, cx - cw / 2, cy - h * 0.18 - ch / 2, cw, ch);
                }
                ctx.globalAlpha = 1;
            }
        }

        // judgements where they happened
        const ev = prep.events;
        const ei = eventBefore(ev, t);
        const js = (view.judgeScale || 0.6) / 0.6;
        for (let j = ei; j >= 0 && t - ev[j].jt < 800; j--) {
            const e = ev[j];
            if (!e.count) continue;
            const p = (t - e.jt) / 800;
            const name = e.result === 'MISS' ? 'hit0' : `hit${e.result}`;
            const img = I[name];
            const o = e.o;
            const px = X(o.kind === 'slider' ? o.endX + o.off : o.sx), py = Y(o.kind === 'slider' ? o.endY + o.off : o.sy);
            ctx.globalAlpha = p < 0.7 ? 1 : (1 - p) / 0.3;
            const pop = p < 0.1 ? 0.8 + 2 * p * 1.5 : 1.1;
            const drop = e.result === 'MISS' ? p * R * 0.8 : 0;
            if (img) { const iw = img.bmp.width * img.s * u * pop * js, ih = img.bmp.height * img.s * u * pop * js; ctx.drawImage(img.bmp, px - iw / 2, py - ih / 2 + drop, iw, ih); }
            else if (e.result !== '300') {
                ctx.fillStyle = JUDGE_COLOR[e.result];
                ctx.font = `800 ${Math.round(R * 0.7 * js)}px system-ui, sans-serif`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(e.result === 'MISS' ? '×' : e.result, px, py + drop);
            }
        }
        ctx.globalAlpha = 1;

        // FL: dark but for a circle around the cursor, smaller with combo
        if (prep.flashlight) {
            const flScale = (combo) => (combo >= 200 ? 0.75 : combo >= 100 ? 0.875 : 1);
            const cp = prep.posAt(t);
            const eFl = eventBefore(ev, t);
            const R = 130 * k * flScale(eFl >= 0 ? ev[eFl].comboAfter || 0 : 0);
            const fx = X(cp.x), fy = Y(cp.y);
            const g = ctx.createRadialGradient(fx, fy, R * 0.65, fx, fy, R);
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(1, 'rgba(0,0,0,1)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#000';
            ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.arc(fx, fy, R, 0, Math.PI * 2, true); ctx.fill();
        }

        // the cursor and its trail
        const cur = prep.posAt(t);
        const trail = I.cursortrail;
        if (trail) {
            const tw = trail.bmp.width * trail.s * u * (view.cursorScale || 1), th = trail.bmp.height * trail.s * u * (view.cursorScale || 1);
            const steps = I.cursormiddle ? 24 : 8;
            for (let n = steps; n >= 1; n--) {
                const p = prep.posAt(t - n * (I.cursormiddle ? 4 : 16));
                ctx.globalAlpha = (1 - n / (steps + 1)) * 0.8;
                ctx.drawImage(trail.bmp, X(p.x) - tw / 2, Y(p.y) - th / 2, tw, th);
            }
            ctx.globalAlpha = 1;
        }
        const ci = I.cursor;
        const pressed = (cur.keys & 3) !== 0;
        if (ci) {
            const sc = skin.cursorExpand && pressed ? 1.2 : 1;
            const cz = view.cursorScale || 1;
            const cw = ci.bmp.width * ci.s * u * sc * cz, ch = ci.bmp.height * ci.s * u * sc * cz;
            ctx.save(); ctx.translate(X(cur.x), Y(cur.y));
            if (skin.cursorRotate) ctx.rotate((t / 10000) * Math.PI * 2);
            if (skin.cursorCentre) ctx.drawImage(ci.bmp, -cw / 2, -ch / 2, cw, ch); else ctx.drawImage(ci.bmp, 0, 0, cw, ch);
            ctx.restore();
        } else { ctx.beginPath(); ctx.arc(X(cur.x), Y(cur.y), 8 * u, 0, Math.PI * 2); ctx.fillStyle = '#ffd166'; ctx.fill(); }
        if (I.cursormiddle) { const m = I.cursormiddle; const mw = m.bmp.width * m.s * u * (view.cursorScale || 1), mh = m.bmp.height * m.s * u * (view.cursorScale || 1); ctx.drawImage(m.bmp, X(cur.x) - mw / 2, Y(cur.y) - mh / 2, mw, mh); }

        // (the combo at the bottom left is drawn by the player for every mode)
        const last = ei >= 0 ? ev[ei] : null;
        const combo = last ? last.comboAfter : 0;

        // the key overlay on the right: K1 K2 M1 M2, lit while held, with their press counts
        {
            const down = prep.keyDown(cur.keys);
            const keyI = I['inputoverlay-key'];
            const size = h * 0.062;
            // below the right-hand column (accuracy, pp, mods, counts)
            const x0 = w - size * 0.5 - 10, yMid = h * 0.72;
            const keys = prep.keyList || ['K1', 'K2', 'M1', 'M2'];
            keys.forEach((key, i) => {
                const list = prep.keyPress[key];
                let lo = 0, hi = list.length - 1, n = 0;
                while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid] <= t) { n = mid + 1; lo = mid + 1; } else hi = mid - 1; }
                const y = yMid + (i - (keys.length - 1) / 2) * size * 1.12;
                const on = down[key];
                const sc = on ? 0.92 : 1;
                const col = on ? (key[0] === 'K' ? 'rgba(255,222,0,1)' : 'rgba(248,0,158,1)') : null;
                if (keyI) {
                    drawTinted(ctx, keyI, x0 - (size * sc) / 2, y - (size * sc) / 2, size * sc, size * sc, col);
                    // dark keys don't show a tint, so a held key also gets a coloured wash
                    if (on) { ctx.globalAlpha = 0.55; ctx.fillStyle = col; ctx.fillRect(x0 - (size * sc) / 2, y - (size * sc) / 2, size * sc, size * sc); ctx.globalAlpha = 1; }
                }
                else { ctx.fillStyle = on ? (key[0] === 'K' ? 'rgba(255,222,0,0.9)' : 'rgba(248,0,158,0.9)') : 'rgba(20,20,24,0.75)'; ctx.fillRect(x0 - (size * sc) / 2, y - (size * sc) / 2, size * sc, size * sc); }
                ctx.fillStyle = '#fff';
                ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 3;
                ctx.font = `700 ${Math.round(size * (n > 999 ? 0.3 : 0.38))}px system-ui, sans-serif`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(n ? String(n) : key, x0, y + 1);
                ctx.shadowBlur = 0;
            });
        }

        // the hit error bar, bottom centre: the windows as colour bands, a tick per hit, an arrow at the average
        {
            const wnd = prep.windows;
            const es = view.errorScale || 1;
            const half = Math.min(150, w * 0.14) * es;
            const scaleX = half / wnd[50];
            const bx = w / 2, by = h - 12 * es; // at the very bottom, as in mania
            ctx.globalAlpha = 0.85;
            const band = (win, col, hh) => { ctx.fillStyle = col; ctx.fillRect(bx - win * scaleX, by - (hh * es) / 2, win * 2 * scaleX, hh * es); };
            band(wnd[50], 'rgba(218,174,70,1)', 4);
            band(wnd[100], 'rgba(87,227,19,1)', 4);
            band(wnd[300], 'rgba(50,188,231,1)', 4);
            ctx.fillStyle = '#fff'; ctx.fillRect(bx - es, by - 9 * es, 2 * es, 18 * es);
            const list = prep.hitOffsets;
            let lo = 0, hi = list.length - 1, upto = -1;
            while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid].t <= t) { upto = mid; lo = mid + 1; } else hi = mid - 1; }
            let avg = 0, nAvg = 0;
            for (let j = upto; j >= 0 && t - list[j].t < 4000; j--) {
                const e = list[j];
                const age = (t - e.t) / 4000;
                ctx.globalAlpha = 0.9 * (1 - age);
                ctx.fillStyle = e.r === '300' ? 'rgba(50,188,231,1)' : e.r === '100' ? 'rgba(87,227,19,1)' : 'rgba(218,174,70,1)';
                ctx.fillRect(bx + e.off * scaleX - es, by - 8 * es, 2 * es, 16 * es);
                if (nAvg < 20) { avg += e.off; nAvg++; }
            }
            if (nAvg) {
                const ax = bx + (avg / nAvg) * scaleX;
                ctx.globalAlpha = 0.95; ctx.fillStyle = '#fff';
                ctx.beginPath(); ctx.moveTo(ax, by - 11 * es); ctx.lineTo(ax - 5 * es, by - 18 * es); ctx.lineTo(ax + 5 * es, by - 18 * es); ctx.closePath(); ctx.fill();
            }
            ctx.globalAlpha = 1;
        }
        ctx.restore();
        return {
            combo,
            best: last ? last.bestAfter || 0 : 0,
            acc: last ? last.accAfter : 1,
            counts: last ? last.countsAfter : { 300: 0, 100: 0, 50: 0, MISS: 0 },
            ur: last ? last.urAfter : 0,
            lMiss: 0,
            rMiss: 0,
        };
    }

    window.replayStd = { prepareStd, drawStd, JUDGE, JUDGE_COLOR, MOD, windows };
})();
