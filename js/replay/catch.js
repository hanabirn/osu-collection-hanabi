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
        // the last fruit/droplet of each combo: the plate's pile explodes when it's caught
        for (let i = 0; i < objects.length; i++) {
            const nextNew = i === objects.length - 1 || map.objects[i + 1].newCombo;
            if (!nextNew) continue;
            const o = objects[i];
            const list = o.nested ? o.nested.filter((n) => n.kind === 'fruit' || n.kind === 'droplet') : [o];
            if (list.length) list[list.length - 1].lastInCombo = true;
        }
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

    /* One frame at song time t. Everything here is worked out from t, so
       seeking anywhere draws the same picture:
       - objects fall from the top of the view to the plate over the
         approach time (AR), across the whole width (no frame to spill out of);
       - caught fruit and droplets pile up on the plate and ride with it,
         explode when the last object of the combo is caught, and fall off
         when one is missed;
       - a catch throws a short beam of light in the object's colour;
       - while hyperdashing the catcher leaves red after-images;
       - the combo rides above the catcher.
       view: { w, h, bg, bgDim, skin (catch skin config | null), comboScale } */
    function drawCatch(ctx, view, prep, t) {
        const { w, h } = view;
        const skin = view.skin || prep.defaultSkin || null; // no visitor skin: osu!'s default
        ctx.save();
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        if (view.bg) {
            const s = Math.max(w / view.bg.width, h / view.bg.height);
            ctx.globalAlpha = 1 - view.bgDim;
            ctx.drawImage(view.bg, (w - view.bg.width * s) / 2, (h - view.bg.height * s) / 2, view.bg.width * s, view.bg.height * s);
            ctx.globalAlpha = 1;
        }
        // osu!'s scale: the screen is 480 osu! pixels tall (as in osu!stable),
        // the 512-wide field centred, the plate low in the view
        const k = Math.min(h / 480, (w * 0.96) / (WIDTH + 80));
        const ox = (w - WIDTH * k) / 2;
        const plateY = h * 0.86;
        const fruitR = 32 * Math.abs(prep.scale) * k;
        const colours = skin && skin.combo && skin.combo.length ? skin.combo : DEFAULT_COMBO;
        const hyperColour = (skin && skin.hyperFruit) || 'rgba(255,40,40,0.9)';
        const yOf = (time) => plateY - ((time - t) / prep.preempt) * plateY;
        const radiusOf = (o) => fruitR * (o.kind === 'droplet' ? 0.8 : o.kind === 'tiny' ? 0.4 : 1);
        const colourOf = (o) => colours[o.combo % colours.length];
        const f = prep.flat;
        const ei = eventBefore(prep, t);
        const c = prep.catcherAt(t);
        const cx = ox + c.x * k;
        const plateHalf = (prep.catchWidth / 2) * k;

        function drawObject(o, x, y, alpha, rot, scale) {
            const r = radiusOf(o) * (scale || 1);
            ctx.globalAlpha = alpha;
            const img = skin && pickImage(skin, o);
            if (o.kind === 'banana' && !img) { drawBanana(ctx, x, y, r * 1.1, rot); ctx.globalAlpha = 1; return; }
            // hyperdash: the object's own shape, a size bigger, in the hyperdash colour, behind it
            if (o.hyper && o.kind !== 'tiny') {
                if (img) {
                    const big = r * 2 * 1.2;
                    ctx.save();
                    ctx.translate(x, y);
                    if (rot) ctx.rotate(rot);
                    drawTinted(ctx, img.base, -big / 2, -big / 2, big, big, hyperColour, true);
                    ctx.restore();
                } else {
                    ctx.beginPath();
                    ctx.arc(x, y, r * 1.2, 0, Math.PI * 2);
                    ctx.fillStyle = hyperColour;
                    ctx.fill();
                }
            }
            if (img) {
                const size = r * 2;
                ctx.save();
                ctx.translate(x, y);
                if (rot) ctx.rotate(rot);
                drawTinted(ctx, img.base, -size / 2, -size / 2, size, size, o.kind === 'banana' ? BANANA_COLOURS[Math.abs(Math.round(o.time)) % 3] : colourOf(o));
                if (img.overlay) ctx.drawImage(img.overlay.bmp, -size / 2, -size / 2, size, size);
                ctx.restore();
            } else {
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fillStyle = colourOf(o);
                ctx.fill();
                if (o.kind === 'fruit') { ctx.lineWidth = Math.max(1.5, r * 0.14); ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.stroke(); }
            }
            ctx.globalAlpha = 1;
        }

        // falling objects: later ones underneath
        let i = eventBefore(prep, t - 400) + 1;
        const visible = [];
        for (; i < f.length && f[i].time <= t + prep.preempt; i++) visible.push(f[i]);
        for (let j = visible.length - 1; j >= 0; j--) {
            const o = visible[j];
            if (o.caught && o.time <= t) continue;
            const y = yOf(o.time);
            if (y > h + 60) continue;
            let alpha = 1;
            if (prep.hidden) { const left = (o.time - t) / prep.preempt; alpha = left < 0.4 ? Math.max(0, (left - 0.1) / 0.3) : 1; }
            if (o.time < t) alpha *= Math.max(0, 1 - (t - o.time) / 400); // a miss keeps falling, fading
            const spin = o.kind === 'droplet' || o.kind === 'tiny' ? (o.time - t) / 300 : o.kind === 'banana' ? (o.time - t) / 500 : tiltOf(o);
            drawObject(o, ox + o.ex * k, y, alpha, spin);
        }

        // what is on the plate now, and what is exploding / falling off
        const pile = [];
        let gone = null; // { kind: 'explode' | 'drop', at, items }
        for (let j = ei; j >= 0 && pile.length < 40; j--) {
            const o = f[j];
            if (o.kind === 'tiny' || o.kind === 'banana') continue;
            if (!o.caught) { // a miss: what was on the plate fell off
                if (t - o.time < 600) { gone = { kind: 'drop', at: o.time, items: collectBefore(f, j) }; }
                break;
            }
            if (o.lastInCombo) { // the combo ended here: the pile exploded at that moment
                if (pile.length === 0 && t - o.time < 600) gone = { kind: 'explode', at: o.time, items: collectBefore(f, j + 1) };
                break;
            }
            pile.push(o);
        }
        // light beams for fresh catches
        ctx.globalCompositeOperation = 'lighter';
        for (let j = ei; j >= 0 && t - f[j].time < 260; j--) {
            const o = f[j];
            if (!o.caught || o.kind === 'banana') continue;
            const a = 1 - (t - o.time) / 260;
            const x = ox + o.ex * k;
            const bw = radiusOf(o) * (o.kind === 'tiny' ? 1.6 : 1.2);
            const g = ctx.createLinearGradient(0, plateY - h * 0.35, 0, plateY);
            g.addColorStop(0, 'rgba(255,255,255,0)');
            g.addColorStop(1, colourOf(o));
            ctx.globalAlpha = a * (o.kind === 'tiny' ? 0.35 : 0.6);
            ctx.fillStyle = g;
            ctx.fillRect(x - bw / 2, plateY - h * 0.35, bw, h * 0.35);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';

        // hyperdash after-images behind the catcher
        let lastPalpable = null;
        for (let j = ei; j >= 0; j--) { const o = f[j]; if (o.kind === 'fruit' || o.kind === 'droplet') { lastPalpable = o; break; } }
        const hyperActive = lastPalpable && lastPalpable.caught && lastPalpable.hyper;
        const catcherImg = skin && (lastPalpable && !lastPalpable.caught && t - lastPalpable.time < 600 ? skin.catcherFail : kiaiAt(prep, t) ? skin.catcherKiai : skin.catcherIdle);
        // the catcher sprite is as wide as the catcher (106.75 × its scale), height in proportion
        const catcherSize = (img) => { const iw = BASE_SIZE * Math.abs(prep.scale) * k; return [iw, (iw * img.bmp.height) / img.bmp.width]; };
        // red after-images while dash is held, and while hyperdashing
        if (hyperActive || c.dash) {
            for (let n = 6; n >= 1; n--) {
                const p = prep.catcherAt(t - n * 22);
                if (!hyperActive && !p.dash) continue;
                const gx = ox + p.x * k;
                ctx.globalAlpha = 0.45 * (1 - n / 7);
                if (catcherImg) { const [iw, ih] = catcherSize(catcherImg); ctx.save(); ctx.translate(gx, plateY); ctx.scale(facingAt(prep, t - n * 22), 1); drawTinted(ctx, catcherImg, -iw / 2, 0, iw, ih, 'rgb(255,40,40)'); ctx.restore(); }
                else { ctx.fillStyle = '#ff3b3b'; ctx.fillRect(gx - plateHalf, plateY, plateHalf * 2, 14 * k); }
            }
            ctx.globalAlpha = 1;
        }

        // the catcher
        if (catcherImg) {
            const [iw, ih] = catcherSize(catcherImg);
            if (hyperActive) { ctx.save(); ctx.filter = 'drop-shadow(0 0 8px rgba(255,40,40,0.95))'; }
            ctx.save();
            ctx.translate(cx, plateY);
            ctx.scale(facingAt(prep, t), 1);
            ctx.drawImage(catcherImg.bmp, -iw / 2, 0, iw, ih);
            ctx.restore();
            if (hyperActive) ctx.restore();
        } else {
            ctx.fillStyle = hyperActive ? '#ff5050' : c.dash ? '#ffd166' : '#f472b6';
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(cx - plateHalf, plateY, plateHalf * 2, Math.max(10, 14 * k), 6 * k); else ctx.rect(cx - plateHalf, plateY, plateHalf * 2, 14 * k);
            ctx.fill();
        }

        // the pile, riding with the plate
        // caught objects sit on the plate at half size, where they landed on it
        const place = (o, idx, catcherX) => {
            const off = Math.max(-plateHalf, Math.min(plateHalf, (o.ex - prep.catcherAt(o.time).x) * k));
            const r = radiusOf(o) * 0.5;
            const lift = ((idx * 37) % 7) / 7;
            return { x: catcherX + off, y: plateY - r * (0.9 + lift * 0.6) };
        };
        for (let n = pile.length - 1; n >= 0; n--) {
            const p = place(pile[n], n, cx);
            drawObject(pile[n], p.x, p.y, 1, tiltOf(pile[n]), 0.5);
        }
        if (gone) {
            const p = Math.min(1, (t - gone.at) / 600);
            const atX = ox + prep.catcherAt(gone.at).x * k;
            gone.items.forEach((o, n) => {
                const base = place(o, n, atX);
                let x = base.x, y = base.y;
                if (gone.kind === 'explode') {
                    const dir = ((n * 53) % 13) / 13 - 0.5;
                    x += dir * 260 * k * p;
                    y -= (220 * p - 260 * p * p) * k;
                } else {
                    y += 300 * k * p * p;
                }
                drawObject(o, x, y, 1 - p, tiltOf(o) + (gone.kind === 'explode' ? p * 6 * (n % 2 ? 1 : -1) : 0), 0.5);
            });
        }

        // combo above the catcher
        const last = ei >= 0 ? f[ei] : null;
        const combo = last ? last.comboAfter : 0;
        if (combo > 0) {
            const cs = view.comboScale || 1;
            const cy = plateY - h * 0.38;
            if (skin && skin.comboDigits) {
                const ds = String(combo).split('').map((d) => skin.comboDigits[Number(d)]);
                const dk = (h / 480) * cs * 0.8;
                const widths = ds.map((d) => d.bmp.width * d.s * dk);
                const gap = -(skin.comboOverlap || 0) * dk;
                const total = widths.reduce((a, b) => a + b, 0) + gap * (ds.length - 1);
                let dx = cx - total / 2;
                ds.forEach((d, n) => { const dh = d.bmp.height * d.s * dk; ctx.drawImage(d.bmp, dx, cy - dh / 2, widths[n], dh); dx += widths[n] + gap; });
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.font = `800 ${Math.round(h * 0.045 * cs)}px system-ui, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(combo), cx, cy);
            }
        }
        ctx.restore();
        return {
            combo,
            acc: last ? last.accAfter : 1,
            counts: last ? last.countsAfter : { FRUIT: 0, DROP: 0, TINY: 0, TINYMISS: 0, MISS: 0 },
            ur: 0,
            lMiss: 0,
            rMiss: 0,
        };
    }

    // banana yellows, as in osu!lazer (one of three per banana)
    const BANANA_COLOURS = ['rgb(255,240,0)', 'rgb(255,192,0)', 'rgb(214,221,28)'];

    /* Which way the catcher faces at time t: the way it last moved (as in the
       game, the sprite is mirrored when moving left and stays that way until
       it moves right again). Looks back at most 8 s. */
    function facingAt(prep, t) {
        let x = prep.catcherAt(t).x;
        for (let back = 16; back <= 8000; back += 16) {
            const px = prep.catcherAt(t - back).x;
            if (Math.abs(px - x) > 0.5) return px > x ? -1 : 1;
        }
        return 1;
    }

    // a fruit's fixed tilt, ±12°, the same every time it is drawn
    function tiltOf(o) {
        const x = Math.sin(o.time * 12.9898 + o.ex * 78.233) * 43758.5453;
        return ((x - Math.floor(x)) - 0.5) * 0.42;
    }

    // the caught fruit/droplets of the combo that ends at index end-1
    function collectBefore(f, end) {
        const out = [];
        for (let j = end - 1; j >= 0 && out.length < 40; j--) {
            const o = f[j];
            if (o.kind === 'tiny' || o.kind === 'banana') continue;
            if (!o.caught) break;
            if (o.lastInCombo && j !== end - 1) break;
            out.push(o);
        }
        return out;
    }

    // a banana, drawn (skins without a banana image)
    function drawBanana(ctx, x, y, r, rot) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot || 0);
        ctx.beginPath();
        ctx.moveTo(-r, -r * 0.2);
        ctx.quadraticCurveTo(0, r * 1.05, r, -r * 0.2);
        ctx.quadraticCurveTo(0, r * 0.45, -r, -r * 0.2);
        ctx.closePath();
        ctx.fillStyle = '#ffd84d';
        ctx.fill();
        ctx.lineWidth = Math.max(1, r * 0.08);
        ctx.strokeStyle = '#b8860b';
        ctx.stroke();
        ctx.fillStyle = '#5a3d0a';
        ctx.beginPath(); ctx.arc(-r * 0.98, -r * 0.2, r * 0.09, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(r * 0.98, -r * 0.2, r * 0.09, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
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
