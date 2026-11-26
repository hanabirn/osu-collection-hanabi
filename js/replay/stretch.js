/* ===== Speeding music up or down without changing its pitch (WSOLA) =====
   For the replay videos: an OfflineAudioContext can only change a buffer's
   playbackRate, which raises the pitch with the speed (right for NC, wrong for
   DT / HT, which osu! plays at the song's own pitch). The live player doesn't
   need this: an <audio> element keeps the pitch by itself.

   WSOLA (waveform-similarity overlap-add): the output is built from short
   Hann-windowed pieces of the input, 50% overlapped; each piece is taken near
   where the speed says it should come from, at the offset whose waveform best
   continues the previous piece, so the joins don't crackle.

   replayStretch(channels, rate, sampleRate, onYield?) → Promise<Float32Array[]>
   channels: one Float32Array per channel; rate > 1 is faster (DT 1.5). */
(function (root) {
    async function stretch(channels, rate, sampleRate, onYield) {
        if (!channels.length || !(rate > 0) || rate === 1) return channels;
        const N = Math.max(256, Math.round((sampleRate * 0.046) / 2) * 2); // ~46 ms pieces
        const Hs = N / 2;                         // output hop (50% overlap)
        const Ha = Hs * rate;                     // input hop
        const tol = Math.round(sampleRate * 0.012); // look ±12 ms around the ideal place
        const inLen = channels[0].length;
        const outLen = Math.floor(inLen / rate);
        const win = new Float32Array(N);
        for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

        // the waveform search runs on the channels' average
        const mono = new Float32Array(inLen);
        for (const ch of channels) for (let i = 0; i < inLen; i++) mono[i] += ch[i] / channels.length;

        const out = channels.map(() => new Float32Array(outLen + N));
        const norm = new Float32Array(outLen + N);
        const L = Hs; // compared stretch: the overlapping half
        const score = (cand, ref, step) => {
            let xy = 0, yy = 0;
            for (let i = 0; i < L; i += step) {
                const a = mono[ref + i] || 0, b = mono[cand + i] || 0;
                xy += a * b; yy += b * b;
            }
            return yy > 1e-9 ? xy / Math.sqrt(yy) : -Infinity;
        };

        let prev = 0;
        const frames = Math.ceil(outLen / Hs);
        for (let k = 0; k < frames; k++) {
            const ideal = Math.round(k * Ha);
            let pos = ideal;
            if (k > 0) {
                // what would naturally follow the previous piece
                const ref = prev + Hs;
                const lo = Math.max(0, ideal - tol), hi = Math.min(inLen - N, ideal + tol);
                if (hi > lo) {
                    let best = ideal, bestS = -Infinity;
                    for (let c = lo; c <= hi; c += 4) { const s = score(c, ref, 8); if (s > bestS) { bestS = s; best = c; } }
                    // then the exact sample near the coarse best
                    const c0 = Math.max(lo, best - 4), c1 = Math.min(hi, best + 4);
                    for (let c = c0; c <= c1; c++) { const s = score(c, ref, 2); if (s > bestS) { bestS = s; best = c; } }
                    pos = best;
                }
            }
            pos = Math.max(0, Math.min(pos, Math.max(0, inLen - 1)));
            const o = k * Hs;
            // the first piece starts at full volume and the last one ends at it (no other
            // piece overlaps those halves, so there is nothing to fade into)
            const wk = (i) => ((k === 0 && i < Hs) || (k === frames - 1 && i >= Hs) ? 1 : win[i]);
            for (let ci = 0; ci < channels.length; ci++) {
                const src = channels[ci], dst = out[ci];
                for (let i = 0; i < N; i++) dst[o + i] += (src[pos + i] || 0) * wk(i);
            }
            for (let i = 0; i < N; i++) norm[o + i] += wk(i);
            prev = pos;
            if (onYield && k % 600 === 599) await onYield();
        }
        return out.map((d) => {
            const r = new Float32Array(outLen);
            for (let i = 0; i < outLen; i++) r[i] = norm[i] > 1e-3 ? d[i] / norm[i] : d[i];
            return r;
        });
    }
    root.replayStretch = stretch;
    if (typeof module !== 'undefined' && module.exports) module.exports = stretch;
})(typeof window !== 'undefined' ? window : globalThis);
