/* ===== LZMA decoder for osu! replays =====
   A replay's input frames are LZMA-compressed in the "LZMA alone" layout:
   1 byte of properties (lc/lp/pb), 4 bytes dictionary size, 8 bytes
   unpacked size (all 0xFF = unknown, stream ends with an end marker), then
   the range-coded stream. Browsers have no built-in LZMA, so this is a
   small decoder written from the algorithm in Igor Pavlov's LZMA SDK
   specification (LzmaSpec.cpp, public domain). Decoding only; plain JS. */
(function () {
    const PROB_INIT = 1024; // kBitModelTotal / 2
    const TOP = 1 << 24;

    function lzmaDecode(input) {
        const src = input instanceof Uint8Array ? input : new Uint8Array(input);
        let ip = 0;

        let d = src[ip++];
        if (d >= 9 * 5 * 5) throw new Error('LZMA: bad properties');
        const lc = d % 9; d = Math.floor(d / 9);
        const lp = d % 5;
        const pb = Math.floor(d / 5);
        ip += 4; // dictionary size: the whole output stays in memory, so unused
        let unknownSize = true;
        let unpackSize = 0;
        for (let i = 0; i < 8; i++) {
            const b = src[ip + i];
            if (b !== 0xff) unknownSize = false;
            if (i < 6) unpackSize += b * 2 ** (8 * i); // < 2^48 is plenty
        }
        ip += 8;

        // output buffer, grown as needed
        let out = new Uint8Array(unknownSize ? Math.max(1 << 16, src.length * 8) : unpackSize);
        let op = 0;
        const put = (b) => {
            if (op >= out.length) { const n = new Uint8Array(out.length * 2); n.set(out); out = n; }
            out[op++] = b;
        };

        // range decoder
        let range = 0xffffffff;
        let code = 0;
        if (src[ip++] !== 0) throw new Error('LZMA: corrupted stream');
        for (let i = 0; i < 4; i++) code = ((code << 8) | src[ip++]) >>> 0;
        const normalize = () => {
            if (range < TOP) {
                range = (range * 256) >>> 0;
                code = ((code * 256) + (src[ip++] | 0)) >>> 0;
            }
        };
        const bit = (probs, i) => {
            const p = probs[i];
            const bound = (range >>> 11) * p;
            let b;
            if (code < bound) {
                range = bound >>> 0;
                probs[i] = p + ((2048 - p) >>> 5);
                b = 0;
            } else {
                range = (range - bound) >>> 0;
                code = (code - bound) >>> 0;
                probs[i] = p - (p >>> 5);
                b = 1;
            }
            normalize();
            return b;
        };
        const directBits = (n) => {
            let res = 0;
            for (let i = 0; i < n; i++) {
                range = range >>> 1;
                let b = 0;
                if (code >= range) { code = (code - range) >>> 0; b = 1; }
                res = res * 2 + b;
                normalize();
            }
            return res;
        };
        const tree = (probs, base, numBits) => {
            let m = 1;
            for (let i = 0; i < numBits; i++) m = (m << 1) + bit(probs, base + m);
            return m - (1 << numBits);
        };
        const reverseTree = (probs, base, numBits) => {
            let m = 1, sym = 0;
            for (let i = 0; i < numBits; i++) {
                const b = bit(probs, base + m);
                m = (m << 1) + b;
                sym |= b << i;
            }
            return sym;
        };
        const probs = (n) => new Uint16Array(n).fill(PROB_INIT);

        const literal = probs(0x300 << (lc + lp));
        const isMatch = probs(12 << 4);
        const isRep = probs(12);
        const isRepG0 = probs(12);
        const isRepG1 = probs(12);
        const isRepG2 = probs(12);
        const isRep0Long = probs(12 << 4);
        const posSlot = [probs(64), probs(64), probs(64), probs(64)];
        const posDecoders = probs(1 + 128 - 14);
        const align = probs(16);
        const lenDecoder = () => ({ choice: probs(2), low: probs(16 << 3), mid: probs(16 << 3), high: probs(256) });
        const decodeLen = (L, posState) => {
            if (bit(L.choice, 0) === 0) return tree(L.low, posState << 3, 3);
            if (bit(L.choice, 1) === 0) return 8 + tree(L.mid, posState << 3, 3);
            return 16 + tree(L.high, 0, 8);
        };
        const matchLen = lenDecoder();
        const repLen = lenDecoder();

        const pbMask = (1 << pb) - 1;
        const lpMask = (1 << lp) - 1;
        let state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0;

        for (;;) {
            if (!unknownSize && op >= unpackSize) break;
            const posState = op & pbMask;
            if (bit(isMatch, (state << 4) + posState) === 0) {
                const prev = op > 0 ? out[op - 1] : 0;
                const base = 0x300 * (((op & lpMask) << lc) + (prev >>> (8 - lc)));
                let sym = 1;
                if (state >= 7) {
                    let matchByte = out[op - rep0 - 1];
                    do {
                        const matchBit = (matchByte >>> 7) & 1;
                        matchByte <<= 1;
                        const b = bit(literal, base + ((1 + matchBit) << 8) + sym);
                        sym = (sym << 1) | b;
                        if (matchBit !== b) break;
                    } while (sym < 0x100);
                }
                while (sym < 0x100) sym = (sym << 1) | bit(literal, base + sym);
                put(sym - 0x100);
                state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
                continue;
            }
            let len;
            if (bit(isRep, state) !== 0) {
                if (op === 0) throw new Error('LZMA: corrupted stream');
                if (bit(isRepG0, state) === 0) {
                    if (bit(isRep0Long, (state << 4) + posState) === 0) {
                        state = state < 7 ? 9 : 11;
                        put(out[op - rep0 - 1]);
                        continue;
                    }
                } else {
                    let dist;
                    if (bit(isRepG1, state) === 0) {
                        dist = rep1;
                    } else {
                        if (bit(isRepG2, state) === 0) {
                            dist = rep2;
                        } else {
                            dist = rep3;
                            rep3 = rep2;
                        }
                        rep2 = rep1;
                    }
                    rep1 = rep0;
                    rep0 = dist;
                }
                len = decodeLen(repLen, posState);
                state = state < 7 ? 8 : 11;
            } else {
                rep3 = rep2; rep2 = rep1; rep1 = rep0;
                len = decodeLen(matchLen, posState);
                state = state < 7 ? 7 : 10;
                const slot = tree(posSlot[Math.min(len, 3)], 0, 6);
                if (slot < 4) {
                    rep0 = slot;
                } else {
                    const numDirect = (slot >>> 1) - 1;
                    let dist = (2 | (slot & 1)) * 2 ** numDirect;
                    if (slot < 14) {
                        dist += reverseTree(posDecoders, dist - slot, numDirect);
                    } else {
                        dist += directBits(numDirect - 4) * 16;
                        dist += reverseTree(align, 0, 4);
                    }
                    if (dist === 0xffffffff) break; // end marker
                    rep0 = dist;
                }
                if (rep0 >= op) throw new Error('LZMA: bad distance');
            }
            len += 2;
            const from = op - rep0 - 1;
            for (let i = 0; i < len; i++) {
                if (!unknownSize && op >= unpackSize) break;
                put(out[from + i]);
            }
        }
        return out.subarray(0, op);
    }

    window.lzmaDecode = lzmaDecode;
})();
