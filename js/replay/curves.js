/* ===== Replay player: slider paths =====
   buildSliderPath(obj) -> { distance, positionAt(progress) } for a slider
   from the .osu (curve type, control points, pixel length), the way osu!
   computes it, after osu!lazer's PathApproximator and SliderPath (MIT):
   - B: Bézier, a new segment wherever a control point repeats ("red
     anchor"), each flattened by adaptive subdivision (tolerance 0.25);
   - P: a perfect circle through three points (Bézier if they're in line or
     there aren't exactly three);
   - C: Catmull-Rom, 50 steps per segment;  - L: straight lines.
   The path is then cut or lengthened to the slider's stated length along
   its last segment (unless its last two control points are the same and
   it is too short, as in osu!stable). positionAt(p) walks that distance. */
(function () {
    const TOLERANCE = 0.25;
    const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
    const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
    const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
    const len = (a) => Math.hypot(a.x, a.y);
    const same = (a, b) => a.x === b.x && a.y === b.y;

    /* ---- Bézier: adaptive subdivision ---- */
    function bezierIsFlatEnough(cp) {
        for (let i = 1; i < cp.length - 1; i++) {
            const dx = cp[i - 1].x - 2 * cp[i].x + cp[i + 1].x;
            const dy = cp[i - 1].y - 2 * cp[i].y + cp[i + 1].y;
            if (dx * dx + dy * dy > TOLERANCE * TOLERANCE * 4) return false;
        }
        return true;
    }
    function bezierSubdivide(cp, l, r, count) {
        const mid = cp.map((p) => ({ x: p.x, y: p.y }));
        for (let i = 0; i < count; i++) {
            l[i] = mid[0];
            r[count - i - 1] = mid[count - i - 1];
            for (let j = 0; j < count - i - 1; j++) mid[j] = mul(add(mid[j], mid[j + 1]), 0.5);
        }
    }
    function bezierApproximate(cp, out, count) {
        const l = new Array(count * 2 - 1), r = new Array(count);
        bezierSubdivide(cp, l, r, count);
        for (let i = 0; i < count - 1; i++) l[count + i] = r[i + 1];
        out.push(cp[0]);
        for (let i = 1; i < count - 1; i++) {
            const k = 2 * i;
            out.push(mul(add(add(l[k - 1], mul(l[k], 2)), l[k + 1]), 0.25));
        }
    }
    function bezier(cp) {
        const out = [];
        const count = cp.length;
        if (count === 0) return out;
        const stack = [cp.map((p) => ({ x: p.x, y: p.y }))];
        while (stack.length) {
            const parent = stack.pop();
            if (bezierIsFlatEnough(parent)) { bezierApproximate(parent, out, count); continue; }
            const l = new Array(count), r = new Array(count);
            bezierSubdivide(parent, l, r, count);
            stack.push(r);
            stack.push(l);
        }
        out.push(cp[count - 1]);
        return out;
    }

    /* ---- perfect circle ---- */
    function circularArc(cp) {
        const [a, b, c] = cp;
        if (Math.abs((b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y)) < 1e-3) return null; // in a line
        const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
        const aSq = a.x * a.x + a.y * a.y, bSq = b.x * b.x + b.y * b.y, cSq = c.x * c.x + c.y * c.y;
        const centre = {
            x: (aSq * (b.y - c.y) + bSq * (c.y - a.y) + cSq * (a.y - b.y)) / d,
            y: (aSq * (c.x - b.x) + bSq * (a.x - c.x) + cSq * (b.x - a.x)) / d,
        };
        const dA = sub(a, centre), dC = sub(c, centre);
        const radius = len(dA);
        const thetaStart = Math.atan2(dA.y, dA.x);
        let thetaEnd = Math.atan2(dC.y, dC.x);
        while (thetaEnd < thetaStart) thetaEnd += 2 * Math.PI;
        let dir = 1, range = thetaEnd - thetaStart;
        const ortho = { x: c.y - a.y, y: -(c.x - a.x) };
        if (ortho.x * (b.x - a.x) + ortho.y * (b.y - a.y) < 0) { dir = -1; range = 2 * Math.PI - range; }
        const n = 2 * radius <= TOLERANCE ? 2 : Math.max(2, Math.ceil(range / (2 * Math.acos(1 - TOLERANCE / radius))));
        const out = [];
        for (let i = 0; i < n; i++) {
            const th = thetaStart + (dir * i * range) / (n - 1);
            out.push({ x: centre.x + Math.cos(th) * radius, y: centre.y + Math.sin(th) * radius });
        }
        return out;
    }

    /* ---- Catmull-Rom ---- */
    function catmullPoint(v1, v2, v3, v4, t) {
        const t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        return { x: f(v1.x, v2.x, v3.x, v4.x), y: f(v1.y, v2.y, v3.y, v4.y) };
    }
    function catmull(cp) {
        const out = [];
        const n = cp.length;
        for (let i = 0; i < n - 1; i++) {
            const v1 = i > 0 ? cp[i - 1] : cp[i];
            const v2 = cp[i];
            const v3 = i < n - 1 ? cp[i + 1] : sub(mul(v2, 2), v1);
            const v4 = i < n - 2 ? cp[i + 2] : sub(mul(v3, 2), v2);
            for (let c = 0; c < 50; c++) {
                out.push(catmullPoint(v1, v2, v3, v4, c / 50));
                out.push(catmullPoint(v1, v2, v3, v4, (c + 1) / 50));
            }
        }
        return out;
    }

    function segmentPoints(type, cp) {
        if (cp.length < 2) return cp.slice();
        if (type === 'L') return cp.slice();
        if (type === 'P' && cp.length === 3) { const arc = circularArc(cp); if (arc) return arc; }
        if (type === 'C') return catmull(cp);
        return bezier(cp);
    }

    function buildSliderPath(obj) {
        const cp = obj.points;
        const type = obj.curveType || 'B';
        // split into segments: Bézier at repeated points; others are one segment
        const segments = [];
        if (type === 'B' || (type === 'P' && cp.length !== 3)) {
            let start = 0;
            for (let i = 1; i < cp.length; i++) {
                if (i < cp.length - 1 && same(cp[i], cp[i + 1])) {
                    segments.push(cp.slice(start, i + 1));
                    start = i + 1;
                }
            }
            segments.push(cp.slice(start));
        } else {
            segments.push(cp);
        }
        const path = [];
        for (const seg of segments) {
            const pts = segmentPoints(type === 'P' && cp.length !== 3 ? 'B' : type, seg);
            for (const p of pts) if (!path.length || !same(path[path.length - 1], p)) path.push(p);
        }
        if (!path.length) path.push({ x: obj.x, y: obj.y });

        // cumulative lengths, then fit to the stated length
        const cum = [0];
        let total = 0;
        for (let i = 1; i < path.length; i++) { total += len(sub(path[i], path[i - 1])); cum.push(total); }
        const expected = obj.length;
        if (expected != null && expected !== total) {
            const lastTwoSame = cp.length >= 2 && same(cp[cp.length - 1], cp[cp.length - 2]);
            if (!(lastTwoSame && expected > total)) {
                cum.pop();
                let end = path.length - 1;
                if (total > expected) {
                    while (cum.length && cum[cum.length - 1] >= expected) { cum.pop(); path.splice(end, 1); end--; }
                }
                if (end <= 0) { cum.length = 0; cum.push(0); path.length = 1; total = 0; }
                else {
                    const d = sub(path[end], path[end - 1]);
                    const l = len(d) || 1;
                    path[end] = add(path[end - 1], mul(d, (expected - cum[cum.length - 1]) / l));
                    cum.push(expected);
                    total = expected;
                }
            }
        }
        const distance = cum[cum.length - 1];
        function positionAt(progress) {
            const d = Math.min(1, Math.max(0, progress)) * distance;
            // first index with cum[i] >= d
            let lo = 0, hi = cum.length - 1;
            while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < d) lo = mid + 1; else hi = mid; }
            const i = lo;
            if (i <= 0) return path[0];
            if (i >= path.length) return path[path.length - 1];
            const d0 = cum[i - 1], d1 = cum[i];
            if (Math.abs(d1 - d0) < 1e-6) return path[i - 1];
            const w = (d - d0) / (d1 - d0);
            return add(path[i - 1], mul(sub(path[i], path[i - 1]), w));
        }
        return { distance, positionAt, path };
    }

    window.replayCurves = { buildSliderPath };
})();
