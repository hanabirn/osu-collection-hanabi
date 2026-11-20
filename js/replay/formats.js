/* ===== Replay player: file formats =====
   parseOsr()     .osr replay  -> header + input frames
   readZip()      .osz (a zip) -> entries, read with the browser's own
                  DecompressionStream('deflate-raw') (no library)
   parseOsuFile() .osu beatmap -> the parts the player needs
   Formats as documented on the osu! wiki (osu!/File formats). */
(function () {
    /* ---------- .osr ---------- */
    function parseOsr(buffer) {
        const bytes = new Uint8Array(buffer);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let p = 0;
        const u8 = () => bytes[p++];
        const u16 = () => { const v = view.getUint16(p, true); p += 2; return v; };
        const i32 = () => { const v = view.getInt32(p, true); p += 4; return v; };
        const i64 = () => { const v = view.getBigInt64(p, true); p += 8; return v; };
        const uleb = () => { let r = 0, s = 0, b; do { b = u8(); r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return r; };
        const str = () => {
            const flag = u8();
            if (flag === 0x00) return '';
            if (flag !== 0x0b) throw new Error('osr: bad string');
            const n = uleb();
            const s = new TextDecoder().decode(bytes.subarray(p, p + n));
            p += n;
            return s;
        };
        const r = {};
        r.mode = u8();
        r.version = i32();
        r.beatmapMd5 = str();
        r.player = str();
        r.replayMd5 = str();
        r.n300 = u16(); r.n100 = u16(); r.n50 = u16();
        r.nGeki = u16(); r.nKatu = u16(); r.nMiss = u16();
        r.score = i32();
        r.maxCombo = u16();
        r.perfect = u8() === 1;
        r.mods = i32() >>> 0;
        r.lifeBar = str();
        // .NET ticks (100 ns since 0001-01-01) -> JS time
        r.playedAt = new Date(Number((i64() - 621355968000000000n) / 10000n));
        const len = i32();
        const compressed = bytes.subarray(p, p + len);
        p += len;
        try { r.scoreId = p + 8 <= bytes.length ? Number(i64()) : 0; } catch { r.scoreId = 0; }
        r.frames = parseFrames(new TextDecoder().decode(window.lzmaDecode(compressed)));
        return r;
    }

    /* "w|x|y|z," — w: ms since the previous frame, x/y: cursor (in mania x
       is the bitmask of held keys), z: keys. A final w = -12345 frame holds
       the RNG seed and isn't input. Times become absolute. */
    function parseFrames(text) {
        const frames = [];
        let t = 0;
        for (const part of text.split(',')) {
            if (!part) continue;
            const [w, x, y, z] = part.split('|');
            const dw = Number(w);
            if (dw === -12345) continue;
            t += dw;
            // the game's opening frames (y = -500, x = 256) set up the cursor and
            // aren't input; in mania x = 256 would read as "key 9 held"
            if (Number(y) === -500) continue;
            frames.push({ t, x: Number(x), y: Number(y), keys: Number(z) | 0 });
        }
        return frames;
    }

    /* ---------- zip (.osz / .osk) ---------- */
    async function readZip(buffer) {
        const bytes = new Uint8Array(buffer);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let eocd = -1;
        for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
            if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('zip: not a zip file');
        const count = view.getUint16(eocd + 10, true);
        let p = view.getUint32(eocd + 16, true);
        const entries = [];
        for (let i = 0; i < count; i++) {
            if (view.getUint32(p, true) !== 0x02014b50) throw new Error('zip: bad directory');
            const flags = view.getUint16(p + 8, true);
            const method = view.getUint16(p + 10, true);
            const compSize = view.getUint32(p + 20, true);
            const nameLen = view.getUint16(p + 28, true);
            const extraLen = view.getUint16(p + 30, true);
            const commentLen = view.getUint16(p + 32, true);
            const localOffset = view.getUint32(p + 42, true);
            const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
            const name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'utf-8').decode(nameBytes);
            entries.push({ name, method, compSize, localOffset });
            p += 46 + nameLen + extraLen + commentLen;
        }
        const read = async (entry) => {
            const lp = entry.localOffset;
            const start = lp + 30 + view.getUint16(lp + 26, true) + view.getUint16(lp + 28, true);
            const data = bytes.subarray(start, start + entry.compSize);
            if (entry.method === 0) return data;
            if (entry.method !== 8) throw new Error('zip: unsupported compression');
            const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            return new Uint8Array(await new Response(stream).arrayBuffer());
        };
        const find = (pred) => entries.find(pred);
        const byName = (n) => {
            const want = String(n || '').toLowerCase().replace(/\\/g, '/');
            return find((e) => e.name.toLowerCase().replace(/\\/g, '/') === want);
        };
        return { entries, read, byName };
    }

    /* ---------- .osu ---------- */
    function parseOsuFile(text) {
        const m = { general: {}, metadata: {}, difficulty: {}, colours: [], background: '', timing: [], objects: [], version: 14 };
        const ver = /osu file format v(d+)/.exec(text.slice(0, 200));
        if (ver) m.version = Number(ver[1]);
        let section = '';
        for (const raw of text.split(/\r?\n/)) {
            const line = raw.trim();
            if (!line || line.startsWith('//')) continue;
            const sec = /^\[(\w+)\]$/.exec(line);
            if (sec) { section = sec[1]; continue; }
            if (section === 'General' || section === 'Metadata' || section === 'Difficulty') {
                const i = line.indexOf(':');
                if (i < 0) continue;
                const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
                m[section.toLowerCase()][k] = v;
            } else if (section === 'Events') {
                const f = line.split(',');
                if (!m.background && (f[0] === '0' || f[0] === 'Background') && f[2]) m.background = f[2].replace(/^"|"$/g, '');
            } else if (section === 'TimingPoints') {
                const f = line.split(',');
                if (f.length < 2) continue;
                m.timing.push({
                    time: Number(f[0]),
                    beatLength: Number(f[1]),
                    uninherited: f.length > 6 ? f[6] === '1' : true,
                    kiai: f.length > 7 ? (Number(f[7]) & 1) === 1 : false,
                });
            } else if (section === 'Colours') {
                const i = line.indexOf(':');
                const k = line.slice(0, i).trim();
                if (/^Combod+$/.test(k)) m.colours.push(line.slice(i + 1).trim().split(',').map(Number));
            } else if (section === 'HitObjects') {
                const f = line.split(',');
                if (f.length < 4) continue;
                const type = Number(f[3]);
                const o = { x: Number(f[0]), y: Number(f[1]), time: Number(f[2]), type, newCombo: !!(type & 4), comboSkip: (type >> 4) & 7 };
                if (type & 128) o.endTime = Number(String(f[5] || '').split(':')[0]); // mania hold
                if (type & 8) o.endTime = Number(f[5]); // spinner
                if (type & 2) {
                    // slider: curve "B|x:y|x:y", slides (= spans), pixel length
                    const parts = String(f[5] || '').split('|');
                    o.curveType = parts[0];
                    o.points = [{ x: o.x, y: o.y }].concat(parts.slice(1).map((p) => { const [px, py] = p.split(':').map(Number); return { x: px, y: py }; }));
                    o.slides = Math.max(1, Number(f[6]) || 1);
                    o.length = Number(f[7]) || 0;
                }
                m.objects.push(o);
            }
        }
        m.timing.sort((a, b) => a.time - b.time);
        m.objects.sort((a, b) => a.time - b.time);
        m.mode = Number(m.general.Mode || 0);
        m.audio = m.general.AudioFilename || '';
        m.cs = Number(m.difficulty.CircleSize || 4);
        m.od = Number(m.difficulty.OverallDifficulty || 5);
        m.hp = Number(m.difficulty.HPDrainRate || 5);
        m.ar = m.difficulty.ApproachRate != null ? Number(m.difficulty.ApproachRate) : m.od; // old maps: AR = OD
        m.sliderMultiplier = Number(m.difficulty.SliderMultiplier || 1.4);
        m.sliderTickRate = Number(m.difficulty.SliderTickRate || 1);
        return m;
    }

    window.replayFormats = { parseOsr, parseFrames, readZip, parseOsuFile };
})();
