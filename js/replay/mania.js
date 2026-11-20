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
        let combo = 0, best = 0, got = 0, max = 0;
        const counts = { MAX: 0, 300: 0, 200: 0, 100: 0, 50: 0, MISS: 0 };
        for (const n of events) {
            counts[n.judge]++;
            combo = n.judge === 'MISS' ? 0 : combo + (n.end != null ? 2 : 1);
            best = Math.max(best, combo);
            got += JUDGE_VALUE[n.judge];
            max += 300;
            n.comboAfter = combo;
            n.accAfter = max ? got / max : 1;
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

    /* view: { w, h, dpr, speed (px per ms of scroll), bg (image|null), bgDim } */
    function drawMania(ctx, view, prep, t) {
        const { w, h } = view;
        ctx.save();
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#0b0a0d';
        ctx.fillRect(0, 0, w, h);
        if (view.bg) {
            const s = Math.max(w / view.bg.width, h / view.bg.height);
            ctx.globalAlpha = 1 - view.bgDim;
            ctx.drawImage(view.bg, (w - view.bg.width * s) / 2, (h - view.bg.height * s) / 2, view.bg.width * s, view.bg.height * s);
            ctx.globalAlpha = 1;
        }

        const keys = prep.keys;
        const colW = Math.min(64, Math.floor((Math.min(w, 560) - 40) / keys));
        const fieldW = colW * keys;
        const x0 = Math.round((w - fieldW) / 2);
        const judgeY = h - Math.max(70, h * 0.13);
        ctx.fillStyle = 'rgba(8, 7, 10, 0.82)';
        ctx.fillRect(x0 - 2, 0, fieldW + 4, h);

        // column lights for held keys
        const held = heldAt(prep, t);
        for (let c = 0; c < keys; c++) {
            const x = x0 + c * colW;
            ctx.fillStyle = c % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.045)';
            ctx.fillRect(x, 0, colW, judgeY);
            if (held & (1 << c)) {
                const g = ctx.createLinearGradient(0, judgeY - 220, 0, judgeY);
                g.addColorStop(0, 'rgba(244,114,182,0)');
                g.addColorStop(1, 'rgba(244,114,182,0.32)');
                ctx.fillStyle = g;
                ctx.fillRect(x, judgeY - 220, colW, 220);
            }
        }

        // notes
        const now = scrollPos(prep, t);
        const yOf = (time) => judgeY - (scrollPos(prep, time) - now) * view.speed;
        const noteH = Math.max(10, Math.round(colW * 0.28));
        const colColor = (c) => {
            const mid = (keys - 1) / 2;
            if (keys % 2 === 1 && c === mid) return '#ffd166';
            return (c < mid ? c : keys - 1 - c) % 2 === 0 ? '#e8e6ee' : '#f472b6';
        };
        for (let c = 0; c < keys; c++) {
            const x = x0 + c * colW + 2;
            const nw = colW - 4;
            for (const n of prep.cols[c]) {
                const endT = n.end ?? n.time;
                if (endT < t - 400) continue;
                const yHead = yOf(n.time);
                if (yHead < -noteH - 4000 && n.end == null) break;
                const hitDone = n.judge !== 'MISS' && n.hitAt != null && n.hitAt <= t;
                const missed = n.judge === 'MISS' && t > n.time;
                if (n.end != null) {
                    const yTail = yOf(n.end);
                    if (yTail > h + noteH) continue;
                    const released = n.releaseAt != null && n.releaseAt <= t;
                    if (released && n.judge !== 'MISS' && t >= n.releaseAt) continue;
                    const top = Math.max(yTail, -noteH);
                    const bottom = hitDone && !released ? judgeY : yHead;
                    if (bottom < -noteH) break;
                    ctx.globalAlpha = missed ? 0.35 : 0.85;
                    ctx.fillStyle = colColor(c);
                    ctx.fillRect(x + nw * 0.18, top, nw * 0.64, Math.max(0, bottom - top));
                    ctx.globalAlpha = missed ? 0.4 : 1;
                    ctx.fillRect(x, bottom - noteH / 2, nw, noteH);
                    ctx.globalAlpha = 1;
                } else {
                    if (hitDone) continue;
                    if (yHead < -noteH) break;
                    if (yHead > h + noteH) continue;
                    ctx.globalAlpha = missed ? 0.35 : 1;
                    ctx.fillStyle = colColor(c);
                    ctx.fillRect(x, yHead - noteH / 2, nw, noteH);
                    ctx.globalAlpha = 1;
                }
            }
        }

        // judgement line + keys
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillRect(x0, judgeY - 1, fieldW, 2);
        for (let c = 0; c < keys; c++) {
            const on = held & (1 << c);
            ctx.fillStyle = on ? '#f472b6' : 'rgba(255,255,255,0.12)';
            ctx.fillRect(x0 + c * colW + 3, judgeY + 10, colW - 6, Math.max(18, h - judgeY - 24));
        }

        // judgement, combo, hit error
        const ei = lastEventBefore(prep, t);
        const last = ei >= 0 ? prep.events[ei] : null;
        const cx = x0 + fieldW / 2;
        if (last && t - last.judgedAt < 350) {
            const a = 1 - (t - last.judgedAt) / 350;
            ctx.globalAlpha = Math.max(0, a);
            ctx.fillStyle = JUDGE_COLOR[last.judge];
            ctx.font = `800 ${Math.round(colW * 0.5)}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(last.judge, cx, judgeY * 0.42);
            ctx.globalAlpha = 1;
        }
        const combo = last ? last.comboAfter : 0;
        if (combo > 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.font = `800 ${Math.round(colW * 0.62)}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(String(combo), cx, judgeY * 0.3);
        }
        // hit error bar: the last 2 s of hits
        const barW = Math.min(fieldW, 240), barY = judgeY - 20;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(cx - barW / 2, barY - 4, barW, 8);
        const span = prep.w[50];
        for (let i = ei; i >= 0 && t - prep.events[i].judgedAt < 2000; i--) {
            const e = prep.events[i];
            if (e.judge === 'MISS' || e.hitAt == null) continue;
            const off = e.hitAt - e.time;
            ctx.globalAlpha = 1 - (t - e.judgedAt) / 2000;
            ctx.fillStyle = JUDGE_COLOR[e.judge];
            ctx.fillRect(cx + (off / span) * (barW / 2) - 1, barY - 7, 2, 14);
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff';
        ctx.fillRect(cx - 1, barY - 9, 2, 18);
        ctx.restore();
        return { combo, acc: last ? last.accAfter : 1, held };
    }

    window.replayMania = { prepareMania, drawMania, JUDGE, JUDGE_COLOR, MOD };
})();
