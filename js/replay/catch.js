/* ===== Replay player: osu!catch =====
   prepareCatch(map, replay) turns the beatmap into what falls, the way
   osu! does (after osu!lazer's CatchBeatmapConverter / JuiceStream /
   BananaShower / CatchBeatmapProcessor, MIT), then judges the replay:
   - circle -> fruit; slider -> fruit at its head, repeats and tail,
     droplets on its ticks, tiny droplets in between; spinner -> bananas;
   - x offsets from osu!stable's random generator (seed 1337): tiny
     droplets ±20, bananas anywhere; with HR the fruit shuffle as in stable;
   - hyperdash marks where walking + dashing can't make it;
   - a frame's x is the catcher's centre, its key 1 is dash; positions in
     between frames are interpolated; an object is caught when it lands
     within half the catcher's catch width.
   drawCatch(ctx, view, prep, t) draws one frame. */
(function () {
    const MOD = { EZ: 2, HR: 16, DT: 64, HT: 256, NC: 512 };
    const WIDTH = 512, HEIGHT = 384;
    const BASE_SIZE = 106.75, CATCH_RANGE = 0.8, BASE_DASH_SPEED = 1, BASE_WALK_SPEED = 0.5;
    const JUDGE = ['FRUIT', 'DROP', 'TINY', 'TINYMISS', 'MISS'];
    const JUDGE_COLOR = { FRUIT: '#ffd166', DROP: '#7ee787', TINY: '#8bd5ff', TINYMISS: '#b392f0', MISS: '#ff6b6b' };

    /* osu!stable's random generator (xorshift), as osu!lazer's LegacyRandom */
    class LegacyRandom {
        constructor(seed) { this.x = seed >>> 0; this.y = 842502087; this.z = 3579807591; this.w = 273326509; this.bitIndex = 32; this.bitBuffer = 0; }
        nextUInt() {
            const t = (this.x ^ (this.x << 11)) >>> 0;
            this.x = this.y; this.y = this.z; this.z = this.w;
            this.w = (this.w ^ (this.w >>> 19) ^ t ^ (t >>> 8)) >>> 0;
            return this.w;
        }
        next() { return this.nextUInt() & 0x7fffffff; }
        nextDouble() { return this.next() * (1 / 2147483648); }
        nextRange(lo, hi) { return Math.trunc(lo + this.nextDouble() * (hi - lo)); }
        nextBool() {
            if (this.bitIndex === 32) { this.bitBuffer = this.nextUInt(); this.bitIndex = 1; return (this.bitBuffer & 1) === 1; }
            this.bitIndex++;
            this.bitBuffer = this.bitBuffer >>> 1;
            return (this.bitBuffer & 1) === 1;
        }
    }

    function difficulty(map, mods) {
        let cs = map.cs, ar = map.ar, od = map.od, hp = map.hp;
        if (mods & MOD.HR) { cs = Math.min(10, cs * 1.3); ar = Math.min(10, ar * 1.4); od = Math.min(10, od * 1.4); hp = Math.min(10, hp * 1.4); }
        if (mods & MOD.EZ) { cs *= 0.5; ar *= 0.5; od *= 0.5; hp *= 0.5; }
        return { cs, ar, od, hp };
    }
    const catcherScale = (cs) => 1 - (0.7 * (cs - 5)) / 5;
    const preemptFor = (ar) => (ar < 5 ? 1200 + (600 * (5 - ar)) / 5 : 1200 - (750 * (ar - 5)) / 5);

    /* At a time: the uninherited beat length, and the inherited point's raw
       beat length (negative; null when an uninherited point is the latest,
       which resets the velocity), as osu!'s legacy decoder sets them up. */
    function timingAt(map, time) {
        let beat = null, inherited = null;
        for (const tp of map.timing) {
            if (tp.time > time) break;
            if (tp.uninherited) { beat = tp.beatLength; inherited = null; }
            else inherited = tp.beatLength;
        }
        if (beat == null) { const first = map.timing.find((tp) => tp.uninherited); beat = first ? first.beatLength : 500; }
        return { beat, inherited };
    }

    /* osu!'s slider events: head, ticks, repeats, the "legacy last tick", tail */
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
                    const tp = reversed ? 1 - p : p;
                    ticks.push({ type: 'tick', time: spanStart + tp * spanDuration, progress: p });
                }
                if (reversed) ticks.reverse();
                out.push(...ticks);
                if (span < spans - 1) out.push({ type: 'repeat', time: spanStart + spanDuration, progress: (span + 1) % 2 });
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

    function convert(map, mods) {
        const objects = []; // { kind: fruit|droplet|tiny|banana, time, x, xOffset, index, combo }
        let comboIndex = -1, index = 0;
        for (const o of map.objects) {
            if (o.newCombo || comboIndex < 0) comboIndex += 1 + (o.newCombo ? o.comboSkip : 0);
            const base = { index, combo: comboIndex, parent: index };
            if (o.type & 2) {
                const path = window.replayCurves.buildSliderPath(o);
                // osu!lazer JuiceStream: velocity from the "precision adjusted" beat
                // length (float, clamped 10-1000 as stable did), tick distance from
                // velocity × beat length (floating-point errors kept on purpose)
                const { beat, inherited } = timingAt(map, o.time);
                const bpmMultiplier = inherited != null && inherited < 0 ? Math.min(1000, Math.max(10, Math.fround(-inherited))) / 100 : 1;
                const velocity = (100 * map.sliderMultiplier) / (beat * bpmMultiplier);
                const tickDistance = (velocity * beat) / map.sliderTickRate;
                const spanDuration = path.distance / velocity;
                const xAt = (p) => path.positionAt(p).x;
                const stream = { kind: 'stream', time: o.time, lastControlX: o.points[o.points.length - 1].x, nested: [] };
                let last = null;
                for (const e of sliderEvents(o.time, spanDuration, velocity, tickDistance, path.distance, o.slides)) {
                    if (last) {
                        const since = e.time - last.time;
                        if (since > 80) {
                            let step = since;
                            while (step > 100) step /= 2;
                            for (let t = step; t < since; t += step) {
                                stream.nested.push({ ...base, kind: 'tiny', time: t + last.time, x: xAt(last.progress + (t / since) * (e.progress - last.progress)), xOffset: 0 });
                            }
                        }
                    }
                    last = e;
                    if (e.type === 'tick') stream.nested.push({ ...base, kind: 'droplet', time: e.time, x: xAt(e.progress), xOffset: 0 });
                    else if (e.type === 'head' || e.type === 'repeat' || e.type === 'tail') stream.nested.push({ ...base, kind: 'fruit', time: e.time, x: xAt(e.progress), xOffset: 0 });
                }
                objects.push(stream);
            } else if (o.type & 8) {
                const shower = { kind: 'shower', time: o.time, nested: [] };
                const duration = o.endTime - o.time;
                let spacing = duration;
                while (spacing > 100) spacing /= 2;
                if (spacing > 0) {
                    for (let t = o.time; t <= o.endTime; t += spacing) shower.nested.push({ ...base, kind: 'banana', time: t, x: 0, xOffset: 0 });
                }
                objects.push(shower);
            } else {
                objects.push({ ...base, kind: 'fruit', time: o.time, x: o.x, xOffset: 0, top: true });
            }
            index++;
        }
        applyOffsets(objects, mods);
        const flat = [];
        for (const o of objects) {
            if (o.nested) flat.push(...o.nested);
            else flat.push(o);
        }
        flat.sort((a, b) => a.time - b.time);
        for (const f of flat) f.ex = Math.min(WIDTH, Math.max(0, f.x + f.xOffset));
        return flat;
    }

    function applyOffsets(objects, mods) {
        const rng = new LegacyRandom(1337);
        const hr = !!(mods & MOD.HR);
        let lastPosition = null, lastStartTime = 0;
        for (const o of objects) {
            if (o.kind === 'fruit') {
                if (hr) {
                    const r = hardRockOffset(o, lastPosition, lastStartTime, rng);
                    lastPosition = r.lastPosition; lastStartTime = r.lastStartTime;
                }
            } else if (o.kind === 'shower') {
                for (const b of o.nested) {
                    b.xOffset = rng.nextDouble() * WIDTH;
                    rng.next(); rng.next(); rng.next(); // stable drew a banana type, rotation, colour
                }
            } else if (o.kind === 'stream') {
                lastPosition = o.lastControlX; // stable used the last control point
                lastStartTime = o.time; // and the stream's start time
                for (const n of o.nested) {
                    if (n.kind === 'tiny') n.xOffset = Math.min(WIDTH - n.x, Math.max(-n.x, rng.nextRange(-20, 20)));
                    else if (n.kind === 'droplet') rng.next(); // stable drew a droplet rotation
                }
            }
        }
    }

    function hardRockOffset(o, lastPosition, lastStartTime, rng) {
        let pos = o.x;
        const start = o.time;
        if (lastPosition == null) return { lastPosition: pos, lastStartTime: start };
        const diff = pos - lastPosition;
        const timeDiff = Math.trunc(start - lastStartTime);
        if (timeDiff > 1000) return { lastPosition: pos, lastStartTime: start };
        if (diff === 0) {
            const right = rng.nextBool();
            const rand = Math.min(20, rng.nextRange(0, Math.max(0, timeDiff / 4)));
            if (right) pos = pos + rand <= WIDTH ? pos + rand : pos - rand;
            else pos = pos - rand >= 0 ? pos - rand : pos + rand;
            o.xOffset = pos - o.x;
            return { lastPosition, lastStartTime };
        }
        if (Math.abs(diff) < timeDiff / 3) {
            if (diff > 0) { if (pos + diff < WIDTH) pos += diff; } else if (pos + diff > 0) pos += diff;
        }
        o.xOffset = pos - o.x;
        return { lastPosition: pos, lastStartTime: start };
    }

    function markHyperdash(flat, cs) {
        const palpable = flat.filter((h) => h.kind === 'fruit' || h.kind === 'droplet');
        const half = (BASE_SIZE * Math.abs(catcherScale(cs)) * CATCH_RANGE) / 2 / CATCH_RANGE;
        let lastDirection = 0, lastExcess = half;
        for (let i = 0; i < palpable.length - 1; i++) {
            const cur = palpable[i], next = palpable[i + 1];
            cur.hyper = false;
            const dir = next.ex > cur.ex ? 1 : -1;
            const timeToNext = Math.trunc(next.time) - Math.trunc(cur.time) - 1000 / 60 / 4;
            const distToNext = Math.abs(next.ex - cur.ex) - (lastDirection === dir ? lastExcess : half);
            const toHyper = timeToNext * BASE_DASH_SPEED - distToNext;
            if (toHyper < 0) { cur.hyper = true; lastExcess = half; }
            else lastExcess = Math.min(half, Math.max(0, toHyper));
            lastDirection = dir;
        }
    }

    function prepareCatch(map, replay) {
        const mods = replay.mods >>> 0;
        const diff = difficulty(map, mods);
        const flat = convert(map, mods);
        markHyperdash(flat, diff.cs);
        const scale = catcherScale(diff.cs);
        const catchWidth = BASE_SIZE * Math.abs(scale) * CATCH_RANGE;
        const frames = replay.frames;
        const catcherAt = (t) => {
            if (!frames.length) return { x: WIDTH / 2, dash: false };
            let lo = 0, hi = frames.length - 1;
            if (frames[0].t >= t) return { x: frames[0].x, dash: !!(frames[0].keys & 1) };
            while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (frames[mid].t <= t) lo = mid; else hi = mid - 1; }
            const a = frames[lo], b = frames[Math.min(lo + 1, frames.length - 1)];
            const x = b.t > a.t ? a.x + ((b.x - a.x) * (t - a.t)) / (b.t - a.t) : a.x;
            return { x: Math.min(WIDTH, Math.max(0, x)), dash: !!(a.keys & 1) };
        };
        // judgements, combo, accuracy over time
        const counts = { FRUIT: 0, DROP: 0, TINY: 0, TINYMISS: 0, MISS: 0, BANANA: 0 };
        let combo = 0, best = 0, hit = 0, total = 0, lMiss = 0, rMiss = 0;
        for (const o of flat) {
            const c = catcherAt(o.time);
            o.caught = Math.abs(o.ex - c.x) <= catchWidth / 2;
            if (o.kind === 'banana') { if (o.caught) counts.BANANA++; }
            else if (o.kind === 'tiny') { counts[o.caught ? 'TINY' : 'TINYMISS']++; total++; if (o.caught) hit++; }
            else {
                if (o.caught) { counts[o.kind === 'fruit' ? 'FRUIT' : 'DROP']++; combo++; hit++; }
                else { counts.MISS++; combo = 0; if (o.ex < WIDTH / 2) lMiss++; else rMiss++; }
                total++;
            }
            best = Math.max(best, combo);
            o.comboAfter = combo;
            o.accAfter = total ? hit / total : 1;
            o.countsAfter = { ...counts };
            o.lMissAfter = lMiss;
            o.rMissAfter = rMiss;
        }
        const rate = mods & (MOD.DT | MOD.NC) ? 1.5 : mods & MOD.HT ? 0.75 : 1;
        const lastTime = flat.length ? flat[flat.length - 1].time : 0;
        const kiai = map.timing.filter((tp) => tp.uninherited || true).map((tp) => ({ time: tp.time, kiai: !!tp.kiai }));
        const notes = flat; // the player's generic code reads .notes for the first object time
        return { mode: 2, flat, notes, counts, bestCombo: best, catcherAt, catchWidth, scale, diff, preempt: preemptFor(diff.ar), rate, lastTime, kiai, hidden: !!(mods & 8) };
    }

    function eventBefore(prep, t) {
        const f = prep.flat;
        let lo = 0, hi = f.length - 1, ans = -1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (f[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
        return ans;
    }

    function kiaiAt(prep, t) {
        let on = false;
        for (const k of prep.kiai) { if (k.time > t) break; on = k.kiai; }
        return on;
    }

    const DEFAULT_COMBO = ['#ffc04d', '#80d4ff', '#c38cff', '#ff7aa8'];
    const FRUIT_NAMES = ['pear', 'grapes', 'apple', 'orange'];

    /* view: { w, h, bg, bgDim, skin (catch skin config | null), comboScale } */
    function drawCatch(ctx, view, prep, t) {
        const { w, h } = view;
        const skin = view.skin;
        ctx.save();
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        if (view.bg) {
            const s = Math.max(w / view.bg.width, h / view.bg.height);
            ctx.globalAlpha = 1 - view.bgDim;
            ctx.drawImage(view.bg, (w - view.bg.width * s) / 2, (h - view.bg.height * s) / 2, view.bg.width * s, view.bg.height * s);
            ctx.globalAlpha = 1;
        }
        // playfield: 512 × 384 osu! pixels, centred, as big as fits
        const k = Math.min((w * 0.94) / WIDTH, (h * 0.86) / HEIGHT);
        const ox = (w - WIDTH * k) / 2, oy = (h - HEIGHT * k) / 2 + h * 0.03;
        const catcherY = oy + 340 * k; // where things are caught (the plate)
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(ox, 0, WIDTH * k, h);

        const fruitR = (BASE_SIZE / 2) * Math.abs(prep.scale) * 0.6 * k; // a fruit's radius on screen
        const colours = (skin && skin.combo && skin.combo.length ? skin.combo : DEFAULT_COMBO);
        const hyperColour = (skin && skin.hyperFruit) || 'rgba(255,40,40,0.9)';
        const yOf = (time) => catcherY - ((time - t) / prep.preempt) * 340 * k;

        // falling objects (later ones underneath)
        const f = prep.flat;
        let i = eventBefore(prep, t - 300) + 1;
        const visible = [];
        for (; i < f.length && f[i].time <= t + prep.preempt; i++) visible.push(f[i]);
        for (let j = visible.length - 1; j >= 0; j--) {
            const o = visible[j];
            if (o.caught && o.time <= t) continue;
            const y = yOf(o.time);
            if (y > h + 40) continue;
            const x = ox + o.ex * k;
            let alpha = 1;
            if (prep.hidden) { const left = (o.time - t) / prep.preempt; alpha = left < 0.4 ? Math.max(0, (left - 0.1) / 0.3) : 1; }
            if (!o.caught && o.time < t) alpha *= 0.5;
            ctx.globalAlpha = alpha;
            const colour = colours[o.combo % colours.length];
            let r = fruitR;
            if (o.kind === 'droplet') r *= 0.8;
            if (o.kind === 'tiny') r *= 0.4;
            if (o.kind === 'banana') r *= 1;
            if (o.hyper) {
                ctx.beginPath();
                ctx.arc(x, y, r * 1.35, 0, Math.PI * 2);
                ctx.fillStyle = hyperColour;
                ctx.globalAlpha = alpha * 0.55;
                ctx.fill();
                ctx.globalAlpha = alpha;
            }
            const img = skin && pickImage(skin, o);
            if (img) {
                const size = r * 2;
                if (img.base) drawTinted(ctx, img.base, x - size / 2, y - size / 2, size, size, o.kind === 'banana' ? null : colour);
                if (img.overlay) ctx.drawImage(img.overlay.bmp, x - size / 2, y - size / 2, size, size);
            } else {
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fillStyle = o.kind === 'banana' ? '#ffe066' : colour;
                ctx.fill();
                if (o.kind === 'fruit') { ctx.lineWidth = Math.max(1.5, r * 0.12); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke(); }
            }
            ctx.globalAlpha = 1;
        }

        // catcher
        const c = prep.catcherAt(t);
        const cx = ox + c.x * k;
        const ei = eventBefore(prep, t);
        const last = ei >= 0 ? f[ei] : null;
        const recentMiss = last && !last.caught && last.kind !== 'tiny' && last.kind !== 'banana' && t - last.time < 500;
        const hyperNow = last && last.caught && last.hyper && t - last.time < 600;
        const catchW = prep.catchWidth * k;
        const img = skin && (recentMiss ? skin.catcherFail : kiaiAt(prep, t) ? skin.catcherKiai : skin.catcherIdle);
        if (img) {
            const iw = img.bmp.width * img.s * 0.5 * Math.abs(prep.scale) * k;
            const ih = img.bmp.height * img.s * 0.5 * Math.abs(prep.scale) * k;
            if (hyperNow) { ctx.save(); ctx.filter = 'drop-shadow(0 0 10px rgba(255,40,40,0.9))'; }
            ctx.drawImage(img.bmp, cx - iw / 2, catcherY, iw, ih);
            if (hyperNow) ctx.restore();
        } else {
            ctx.fillStyle = hyperNow ? '#ff5050' : c.dash ? '#ffd166' : '#f472b6';
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(cx - catchW / 2, catcherY, catchW, Math.max(10, 14 * k), 6 * k); else ctx.rect(cx - catchW / 2, catcherY, catchW, 14 * k);
            ctx.fill();
        }
        if (c.dash) { // dash: a faint trail
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            ctx.fillRect(cx - catchW / 2, catcherY + 18 * k, catchW, 3 * k);
        }

        // combo, bottom-left of the field
        const combo = last ? last.comboAfter : 0;
        if (combo > 0) {
            const cs = view.comboScale || 1;
            ctx.fillStyle = 'rgba(255,255,255,0.92)';
            ctx.font = `800 ${Math.round(40 * k * cs)}px system-ui, sans-serif`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(`${combo}x`, ox + 8 * k, catcherY - 10 * k);
        }
        ctx.restore();
        return {
            combo,
            acc: last ? last.accAfter : 1,
            counts: last ? last.countsAfter : { FRUIT: 0, DROP: 0, TINY: 0, TINYMISS: 0, MISS: 0 },
            ur: 0,
            lMiss: last ? last.lMissAfter : 0,
            rMiss: last ? last.rMissAfter : 0,
        };
    }

    // the skin's image for an object; null (our own drawing, as osu! falls back
    // to its default) when the skin has no base image for it
    function pickImage(skin, o) {
        const img = o.kind === 'banana' ? skin.banana : o.kind === 'droplet' || o.kind === 'tiny' ? skin.drop : skin.fruits[o.parent % 4];
        return img && img.base ? img : null;
    }

    // the fruit image tinted with its combo colour (the overlay stays as is)
    const tintCache = new Map();
    function drawTinted(ctx, img, x, y, w, h, colour) {
        if (!colour) { ctx.drawImage(img.bmp, x, y, w, h); return; }
        const key = img.bmp;
        let byColour = tintCache.get(key);
        if (!byColour) { byColour = new Map(); tintCache.set(key, byColour); }
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

    window.replayCatch = { prepareCatch, drawCatch, convert, JUDGE, JUDGE_COLOR, LegacyRandom, MOD };
})();
