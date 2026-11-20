/* ===== Replay player: osu!mania =====
   prepareMania(map, replay) works everything out once:
     - notes per column (column = floor(x * keys / 512); Mirror flips),
     - the key presses/releases from the replay frames (in mania a frame's
       x is the bitmask of held keys),
     - every note's judgement with osu!stable's mania hit windows (OD based;
       HR /1.4, EZ ×1.4) and its long-note rule (head + release together),
     - the scroll position over time from the map's slider velocity.
   drawMania(ctx, view, prep, t) draws one frame at song time t (ms).
   Judgements are this player's reading of the inputs: close to the game's,
   not guaranteed identical, so the replay's own counts are shown beside. */
(function () {
    const MOD = { EZ: 2, HR: 16, DT: 64, HT: 256, NC: 512, MR: 1 << 30 };
    const JUDGE = ['MAX', '300', '200', '100', '50', 'MISS'];
    const JUDGE_VALUE = { MAX: 300, 300: 300, 200: 200, 100: 100, 50: 50, MISS: 0 };
    const JUDGE_COLOR = { MAX: '#e8f6ff', 300: '#ffd166', 200: '#7ee787', 100: '#58a6ff', 50: '#b392f0', MISS: '#ff6b6b' };

    function windowsFor(od, mods) {
        const base = { MAX: 16, 300: 64 - 3 * od, 200: 97 - 3 * od, 100: 127 - 3 * od, 50: 151 - 3 * od, MISS: 188 - 3 * od };
        const k = mods & MOD.HR ? 1 / 1.4 : mods & MOD.EZ ? 1.4 : 1;
        const w = {};
        for (const [j, v] of Object.entries(base)) w[j] = v * k;
        return w;
    }

    function judgeOffset(off, w) {
        const a = Math.abs(off);
        for (const j of ['MAX', '300', '200', '100', '50']) if (a <= w[j]) return j;
        return 'MISS';
    }

    // osu!stable's long note: head offset and head+tail offsets together
    function judgeHold(head, tail, w) {
        const h = Math.abs(head), sum = h + Math.abs(tail);
        if (h <= w.MAX * 1.2 && sum <= w.MAX * 2.4) return 'MAX';
        if (h <= w[300] * 1.1 && sum <= w[300] * 2.2) return '300';
        if (h <= w[200] && sum <= w[200] * 2) return '200';
        if (h <= w[100] && sum <= w[100] * 2) return '100';
        return '50';
    }

    function prepareMania(map, replay) {
        const keys = Math.max(1, Math.min(18, Math.round(map.cs)));
        const mods = replay.mods >>> 0;
        const mirror = !!(mods & MOD.MR);
        const w = windowsFor(map.od, mods);

        // notes
        const cols = Array.from({ length: keys }, () => []);
        const notes = map.objects.map((o, i) => {
            let c = Math.max(0, Math.min(keys - 1, Math.floor((o.x * keys) / 512)));
            if (mirror) c = keys - 1 - c;
            const n = { i, col: c, time: o.time, end: o.type & 128 ? o.endTime : null, judge: null, hitAt: null, releaseAt: null };
            cols[c].push(n);
            return n;
        });

        // presses / releases per column
        const presses = Array.from({ length: keys }, () => []);
        const releases = Array.from({ length: keys }, () => []);
        let prev = 0;
        for (const f of replay.frames) {
            const now = Math.round(f.x) | 0;
            const changed = now ^ prev;
            if (changed) {
                for (let c = 0; c < keys; c++) {
                    if (!(changed & (1 << c))) continue;
                    (now & (1 << c) ? presses : releases)[c].push(f.t);
                }
            }
            prev = now;
        }

        // judgements
        for (let c = 0; c < keys; c++) {
            const ps = presses[c], rs = releases[c];
            let pi = 0;
            for (const n of cols[c]) {
                while (pi < ps.length && ps[pi] < n.time - w.MISS) pi++;
                if (pi < ps.length && ps[pi] <= n.time + w[50]) {
                    const at = ps[pi++];
                    n.hitAt = at;
                    const head = at - n.time;
                    if (n.end == null) {
                        n.judge = judgeOffset(head, w);
                    } else {
                        const rel = rs.find((r) => r > at);
                        n.releaseAt = rel == null ? n.end + w.MISS : rel;
                        // held past the end: the game settles the note once the late (50)
                        // window has passed, so a long hold isn't a very late release
                        const tail = Math.min(n.releaseAt - n.end, w[50]);
                        n.judge = judgeOffset(head, w) === 'MISS' ? 'MISS' : judgeHold(head, tail, w);
                    }
                } else {
                    n.judge = 'MISS';
                }
                // where the judgement shows: on the hit, or once the note is gone
                n.judgedAt = n.judge === 'MISS' ? n.time + w[50] : n.end != null ? Math.max(n.releaseAt, n.hitAt) : n.hitAt;
            }
        }

        // running combo / accuracy, in the order things were judged
        const events = notes.slice().sort((a, b) => a.judgedAt - b.judgedAt);
        // combo as osu!lazer counts it: a long note's head and tail are one each
        // each event keeps the running totals up to and including it, so a
        // frame only looks them up: counts, UR (10 × the standard deviation
        // of hit offsets in real time), and misses per hand
        let combo = 0, best = 0, got = 0, max = 0;
        let offN = 0, offSum = 0, offSq = 0, lMiss = 0, rMiss = 0;
        const rateNow = mods & (MOD.DT | MOD.NC) ? 1.5 : mods & MOD.HT ? 0.75 : 1;
        const counts = { MAX: 0, 300: 0, 200: 0, 100: 0, 50: 0, MISS: 0 };
        const mid = (keys - 1) / 2;
        for (const n of events) {
            counts[n.judge]++;
            combo = n.judge === 'MISS' ? 0 : combo + (n.end != null ? 2 : 1);
            best = Math.max(best, combo);
            got += JUDGE_VALUE[n.judge];
            max += 300;
            if (n.judge === 'MISS') {
                if (n.col < mid) lMiss++; else if (n.col > mid) rMiss++;
            } else if (n.hitAt != null) {
                const o = (n.hitAt - n.time) / rateNow;
                offN++; offSum += o; offSq += o * o;
            }
            n.comboAfter = combo;
            n.accAfter = max ? got / max : 1;
            n.countsAfter = { ...counts };
            n.urAfter = offN > 1 ? 10 * Math.sqrt(Math.max(0, offSq / offN - (offSum / offN) ** 2)) : 0;
            n.lMissAfter = lMiss;
            n.rMissAfter = rMiss;
        }

        // scroll position from slider velocity (inherited timing points)
        // sv[i] holds from sv[i].time until sv[i+1].time; pos is the scroll
        // distance at sv[i].time. Before the first point: speed 1.
        const sv = [{ time: -100000, sv: 1 }];
        for (const tp of map.timing) {
            const v = tp.uninherited ? 1 : Math.min(10, Math.max(0.1, -100 / tp.beatLength));
            const t0 = Math.max(tp.time, -100000);
            if (sv[sv.length - 1].time === t0) sv[sv.length - 1].sv = v;
            else sv.push({ time: t0, sv: v });
        }
        sv[0].pos = 0;
        for (let i = 1; i < sv.length; i++) sv[i].pos = sv[i - 1].pos + (sv[i].time - sv[i - 1].time) * sv[i - 1].sv;

        const rate = mods & (MOD.DT | MOD.NC) ? 1.5 : mods & MOD.HT ? 0.75 : 1;
        const lastTime = notes.reduce((m, n) => Math.max(m, n.end ?? n.time), 0);
        return { keys, notes, cols, presses, releases, frames: replay.frames, w, counts, bestCombo: best, events, sv, rate, lastTime };
    }

    function scrollPos(prep, t) {
        const sv = prep.sv;
        let lo = 0, hi = sv.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (sv[mid].time <= t) lo = mid; else hi = mid - 1; }
        const s = sv[lo];
        return s.pos + (t - s.time) * s.sv;
    }

    function heldAt(prep, t) {
        const f = prep.frames;
        let lo = 0, hi = f.length - 1;
        if (!f.length || f[0].t > t) return 0;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (f[mid].t <= t) lo = mid; else hi = mid - 1; }
        return Math.round(f[lo].x) | 0;
    }

    function lastEventBefore(prep, t) {
        const e = prep.events;
        let lo = 0, hi = e.length - 1, ans = -1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (e[mid].judgedAt <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
        return ans;
    }

    /* One frame at song time t (ms).
       view: { w, h, speed (scroll px per ms at 1080 px height), bg, bgDim, skin (forKeys() result | null) }
       Returns the live numbers for the page around the canvas. */
    function drawMania(ctx, view, prep, t) {
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

        // stage geometry: the skin's (in osu!'s 480-high space) or ours
        const keys = prep.keys;
        let colW, gaps, hitY;
        if (skin) {
            const k = h / 480;
            colW = skin.columnWidth.map((x) => x * k);
            gaps = skin.columnSpacing.map((x) => x * k);
            hitY = skin.hitPosition * k;
        } else {
            const each = Math.min(h * 0.13, (w * 0.62) / keys, 120);
            colW = Array(keys).fill(each);
            gaps = Array(Math.max(1, keys - 1)).fill(0);
            hitY = h - Math.max(90, h * 0.16);
        }
        const fieldW = colW.reduce((a, b) => a + b, 0) + gaps.slice(0, keys - 1).reduce((a, b) => a + b, 0);
        const x0 = Math.round((w - fieldW) / 2);
        const colX = [];
        for (let c = 0, x = x0; c < keys; c++) { colX.push(x); x += colW[c] + (gaps[c] || 0); }
        // osu! scroll speed (1-40): a note takes 11485 / speed ms to fall to
        // the hit line (osu!lazer's mania time range), whatever the screen size
        const speed = hitY / (11485 / Math.max(1, view.scroll || 24));

        // stage
        ctx.fillStyle = 'rgba(0,0,0,0.88)';
        ctx.fillRect(x0, 0, fieldW, h);
        for (let c = 0; c < keys; c++) {
            const col = skin && skin.colours[c];
            if (col) { ctx.fillStyle = col; ctx.fillRect(colX[c], 0, colW[c], h); }
        }
        const drawImg = (img, x, y, wd, ht) => { if (img) ctx.drawImage(img.bmp, x, y, wd, ht); };
        const heightFor = (img, wd) => (img ? img.bmp.height * (wd / img.bmp.width) : 0);
        if (skin) {
            // as tall as the stage, width in proportion (art on the edges keeps its shape)
            if (skin.stageLeft) { const sw = skin.stageLeft.bmp.width * (h / skin.stageLeft.bmp.height); drawImg(skin.stageLeft, x0 - sw, 0, sw, h); }
            if (skin.stageRight) { const sw = skin.stageRight.bmp.width * (h / skin.stageRight.bmp.height); drawImg(skin.stageRight, x0 + fieldW, 0, sw, h); }
        } else {
            ctx.fillStyle = 'rgba(255,255,255,0.14)';
            ctx.fillRect(x0 - 2, 0, 2, h);
            ctx.fillRect(x0 + fieldW, 0, 2, h);
            for (let c = 1; c < keys; c++) { ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(colX[c] - 0.5, 0, 1, hitY); }
        }

        // held keys: lane glow
        const held = heldAt(prep, t);
        if (!skin) {
            for (let c = 0; c < keys; c++) {
                if (!(held & (1 << c))) continue;
                const g = ctx.createLinearGradient(0, hitY - h * 0.35, 0, hitY);
                g.addColorStop(0, 'rgba(244,114,182,0)');
                g.addColorStop(1, 'rgba(244,114,182,0.28)');
                ctx.fillStyle = g;
                ctx.fillRect(colX[c], hitY - h * 0.35, colW[c], h * 0.35);
            }
        }

        const drawSkinKeys = () => {
            for (let c = 0; c < keys; c++) {
                const img = held & (1 << c) ? skin.keysDown[c] : skin.keys[c];
                if (!img) continue;
                const kh = heightFor(img, colW[c]);
                drawImg(img, colX[c], h - kh, colW[c], kh);
            }
        };
        if (skin && skin.keysUnderNotes) drawSkinKeys();

        // notes
        const now = scrollPos(prep, t);
        const yOf = (time) => hitY - (scrollPos(prep, time) - now) * speed;
        const defColor = (c) => {
            const ty = window.replaySkin ? window.replaySkin.columnType(keys, c) : '1';
            return ty === 'S' ? '#ffd166' : ty === '1' ? '#eceaf2' : '#f472b6';
        };
        for (let c = 0; c < keys; c++) {
            const x = colX[c], cw = colW[c];
            const noteImg = skin && skin.notes[c], headImg = skin && skin.heads[c], bodyImg = skin && skin.bodies[c], tailImg = skin && skin.tails[c];
            const nhW = skin && skin.noteHeightWidth ? skin.noteHeightWidth * (h / 480) : cw;
            const nh = skin && noteImg ? noteImg.bmp.height * (nhW / noteImg.bmp.width) : Math.max(12, cw * 0.32);
            for (const n of prep.cols[c]) {
                const endT = n.end ?? n.time;
                if (endT < t - 400) continue;
                const yHead = yOf(n.time);
                if (yHead < -h) break;
                const hit = n.judge !== 'MISS' && n.hitAt != null && n.hitAt <= t;
                const missed = n.judge === 'MISS' && t > n.time + prep.w[50];
                ctx.globalAlpha = missed ? 0.35 : 1;
                if (n.end != null) {
                    const released = n.releaseAt != null && n.releaseAt <= t;
                    if (released && !missed) { ctx.globalAlpha = 1; continue; }
                    const yTail = yOf(n.end);
                    if (yTail > h + nh) { ctx.globalAlpha = 1; continue; }
                    const bottom = hit ? hitY : yHead;
                    const top = Math.max(-nh, yTail);
                    if (skin && (bodyImg || headImg)) {
                        if (bodyImg) drawBody(ctx, bodyImg, x, cw, yTail, bottom, skin.bodyStyle[c]);
                        if (tailImg) {
                            const th = tailImg.bmp.height * (nhW / tailImg.bmp.width);
                            if (skin.flipTail[c]) {
                                ctx.save();
                                ctx.translate(0, yTail);
                                ctx.scale(1, -1);
                                drawImg(tailImg, x, -th, cw, th);
                                ctx.restore();
                            } else {
                                drawImg(tailImg, x, yTail - th, cw, th);
                            }
                        }
                        const hh = headImg ? headImg.bmp.height * (nhW / headImg.bmp.width) : 0;
                        drawImg(headImg, x, bottom - hh, cw, hh);
                    } else {
                        ctx.fillStyle = defColor(c);
                        ctx.globalAlpha *= 0.55;
                        ctx.fillRect(x + cw * 0.14, top, cw * 0.72, Math.max(0, bottom - top));
                        ctx.globalAlpha = missed ? 0.35 : 1;
                        roundRect(ctx, x + 2, bottom - nh, cw - 4, nh, nh * 0.35);
                    }
                } else {
                    if (hit) { ctx.globalAlpha = 1; continue; }
                    if (yHead > h + nh) { ctx.globalAlpha = 1; continue; }
                    if (skin && noteImg) drawImg(noteImg, x, yHead - nh, cw, nh);
                    else { ctx.fillStyle = defColor(c); roundRect(ctx, x + 2, yHead - nh, cw - 4, nh, nh * 0.35); }
                }
                ctx.globalAlpha = 1;
            }
        }

        // judgement line / stage hint, then keys
        if (skin) {
            if (skin.stageHint) { const hh = heightFor(skin.stageHint, fieldW); drawImg(skin.stageHint, x0, hitY - hh / 2, fieldW, hh); }
            else if (skin.judgementLine) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(x0, hitY - 1, fieldW, 2); }
            if (!skin.keysUnderNotes) drawSkinKeys();
        } else {
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.fillRect(x0, hitY - 1, fieldW, 2);
            for (let c = 0; c < keys; c++) {
                const on = held & (1 << c);
                const r = Math.min(colW[c] * 0.4, (h - hitY) * 0.38);
                ctx.beginPath();
                ctx.arc(colX[c] + colW[c] / 2, hitY + (h - hitY) / 2, r, 0, Math.PI * 2);
                ctx.lineWidth = Math.max(3, r * 0.12);
                ctx.strokeStyle = on ? '#fff' : 'rgba(255,255,255,0.4)';
                ctx.fillStyle = on ? defColor(c) : 'transparent';
                if (on) ctx.fill();
                ctx.stroke();
            }
        }

        // judgement + combo
        const ei = lastEventBefore(prep, t);
        const last = ei >= 0 ? prep.events[ei] : null;
        const cx = x0 + fieldW / 2;
        const judgeY = skin ? skin.scorePosition * (h / 480) : h * 0.42;
        if (last && t - last.judgedAt < 400) {
            const a = Math.max(0, 1 - (t - last.judgedAt) / 400);
            const grow = (1 + 0.12 * (1 - a)) * (view.judgeScale || 1);
            ctx.globalAlpha = a;
            const img = skin && skin.hits[last.judge];
            if (img) {
                const iw = img.bmp.width * img.s * (h / 480) * grow, ih = img.bmp.height * img.s * (h / 480) * grow;
                ctx.drawImage(img.bmp, cx - iw / 2, judgeY - ih / 2, iw, ih);
            } else {
                ctx.fillStyle = JUDGE_COLOR[last.judge];
                ctx.font = `800 ${Math.round(h * 0.045 * grow)}px system-ui, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(last.judge === 'MAX' ? 'MAX' : last.judge, cx, judgeY);
            }
            ctx.globalAlpha = 1;
        }
        const combo = last ? last.comboAfter : 0;
        if (combo > 0 && skin && skin.comboDigits) {
            const k = h / 480;
            const ds = String(combo).split('').map((d) => skin.comboDigits[Number(d)]);
            const cs = view.comboScale || 1;
            const widths = ds.map((d) => d.bmp.width * d.s * k * cs);
            const gap = -skin.comboOverlap * k * cs;
            const total = widths.reduce((a, b) => a + b, 0) + gap * (ds.length - 1);
            let dx = cx - total / 2;
            const cy = skin.comboPosition * k;
            ds.forEach((d, i) => { const dh = d.bmp.height * d.s * k * cs; ctx.drawImage(d.bmp, dx, cy - dh / 2, widths[i], dh); dx += widths[i] + gap; });
        } else if (combo > 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.92)';
            ctx.font = `800 ${Math.round(h * 0.055 * (view.comboScale || 1))}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(combo), cx, judgeY - h * 0.075);
        }

        // hit error bar under the stage: coloured windows, recent hits as ticks
        const span = prep.w[50];
        const barW = Math.min(fieldW * 0.9, 300), barY = h - 12;
        const scale = barW / 2 / span;
        for (const j of ['50', '100', '200', '300', 'MAX']) {
            ctx.fillStyle = JUDGE_COLOR[j];
            ctx.globalAlpha = 0.85;
            ctx.fillRect(cx - prep.w[j] * scale, barY - 2, prep.w[j] * scale * 2, 4);
        }
        ctx.globalAlpha = 1;
        for (let i = ei; i >= 0 && t - prep.events[i].judgedAt < 3000; i--) {
            const e = prep.events[i];
            if (e.judge === 'MISS' || e.hitAt == null) continue;
            ctx.globalAlpha = 1 - (t - e.judgedAt) / 3000;
            ctx.fillStyle = '#fff';
            ctx.fillRect(cx + (e.hitAt - e.time) * scale - 1, barY - 9, 2, 18);
        }
        ctx.globalAlpha = 1;
        ctx.restore();
        return {
            combo,
            acc: last ? last.accAfter : 1,
            counts: last ? last.countsAfter : { MAX: 0, 300: 0, 200: 0, 100: 0, 50: 0, MISS: 0 },
            ur: last ? last.urAfter : 0,
            lMiss: last ? last.lMissAfter : 0,
            rMiss: last ? last.rMissAfter : 0,
        };
    }

    /* A long note's body between its tail (top, yTail) and head (bottom).
       style 0: the image stretched over the whole length.
       style 1: laid from the tail down at its own scale, repeated, cut at
                the head (osu! skin 2.5+ default; a "percy" skin puts a
                rounded cap and some empty space at the top of a very tall
                body image, so the end is round and drawn a little short).
       style 2: the same, laid from the head up. */
    function drawBody(ctx, img, x, cw, yTail, yBottom, style) {
        const top = Math.max(yTail, -10), height = yBottom - top;
        if (height <= 0) return;
        if (!style) { ctx.drawImage(img.bmp, x, top, cw, height); return; }
        const texH = img.bmp.height * (cw / img.bmp.width);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, top, cw, height);
        ctx.clip();
        if (style === 2) {
            for (let y = yBottom - texH; y + texH > top; y -= texH) ctx.drawImage(img.bmp, x, y, cw, texH);
        } else {
            let y = yTail;
            if (y < top - texH) y += Math.floor((top - y) / texH) * texH;
            for (; y < yBottom; y += texH) ctx.drawImage(img.bmp, x, y, cw, texH);
        }
        ctx.restore();
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
        else ctx.rect(x, y, w, h);
        ctx.fill();
    }

    window.replayMania = { prepareMania, drawMania, JUDGE, JUDGE_COLOR, MOD };
})();
