/* ===== Replay player: hit sounds =====
   soundEvents(mode, map, prep) -> [{ t, names: ['normal-hitnormal', ...], vol }]
   what osu! would play during the replay, in time order:
   - the sample set of an object comes from its own hit sample, else the
     timing section it's in (1 normal, 2 soft, 3 drum), its additions
     (whistle 2, finish 4, clap 8) from its hit sound, the volume likewise;
   - standard: a circle or slider head when hit, slider repeats and ends
     with their own node sounds, ticks, a spinner at its end;
   - taiko: every key press (centre: hitnormal, rim: hitclap), a finish
     for big notes; catch: caught fruit and droplets (as ticks);
   - mania: each note when hit.
   createMixer(skin) plays them with Web Audio: the visitor's skin's own
   samples first, osu!'s defaults (ppy/osu-resources, CC BY-NC 4.0) else. */
(function () {
    const SETS = { 1: 'normal', 2: 'soft', 3: 'drum' };

    function timingAt(map, t) {
        let tp = null;
        for (const p of map.timing) { if (p.time > t + 5) break; tp = p; }
        return tp || { sampleSet: 1, volume: 100 };
    }
    // the samples for one sound: base set, addition set, hit sound bits, volume
    function resolve(map, t, hitSound, normalSet, additionSet, vol) {
        const tp = timingAt(map, t);
        const base = SETS[normalSet] || SETS[tp.sampleSet] || 'normal';
        const add = SETS[additionSet] || base;
        const names = [`${base}-hitnormal`];
        if (hitSound & 2) names.push(`${add}-hitwhistle`);
        if (hitSound & 4) names.push(`${add}-hitfinish`);
        if (hitSound & 8) names.push(`${add}-hitclap`);
        return { names, vol: (vol || tp.volume || 100) / 100, set: base };
    }

    function soundEvents(mode, map, prep) {
        const out = [];
        const push = (t, s) => { if (Number.isFinite(t)) out.push({ t, names: s.names, vol: s.vol }); };
        if (mode === 0) {
            for (const o of prep.objs) {
                const src = map.objects[o.index] || {};
                if (o.kind === 'circle') {
                    if (o.headResult && o.headResult !== 'MISS') push(o.headAt, resolve(map, o.time, src.hitSound, src.normalSet, src.additionSet, src.sampleVolume));
                } else if (o.kind === 'slider') {
                    const node = (i, t) => {
                        const hs = src.edgeSounds ? src.edgeSounds[i] ?? src.hitSound : src.hitSound;
                        const es = src.edgeSets && src.edgeSets[i] ? src.edgeSets[i] : [src.normalSet, src.additionSet];
                        return resolve(map, t, hs, es[0], es[1], src.sampleVolume);
                    };
                    if (o.headResult && o.headResult !== 'MISS') push(o.headAt, node(0, o.time));
                    let repeat = 0;
                    for (const part of o.parts || []) {
                        if (!part.hit) continue;
                        if (part.type === 'repeat') push(part.time, node(++repeat, part.time));
                        else if (part.type === 'tick') { const s = resolve(map, part.time, 0, src.normalSet, 0, src.sampleVolume); push(part.time, { names: [`${s.set}-slidertick`], vol: s.vol }); }
                    }
                    if (o.result !== 'MISS') push(o.end, node(o.spans, o.end));
                } else if (o.kind === 'spinner') {
                    if (o.result !== 'MISS') push(o.end, resolve(map, o.end, src.hitSound, src.normalSet, src.additionSet, src.sampleVolume));
                }
            }
        } else if (mode === 1) {
            for (const p of prep.presses) {
                const s = resolve(map, p.t, 0, 0, 0, 0);
                out.push({ t: p.t, names: [`taiko-${s.set}-${p.centre ? 'hitnormal' : 'hitclap'}`], vol: s.vol });
            }
            for (const h of prep.hits) {
                if (h.big && h.result && h.result !== 'MISS') { const s = resolve(map, h.time, 0, 0, 0, 0); out.push({ t: h.hitAt, names: [`taiko-${s.set}-hitfinish`], vol: s.vol }); }
            }
        } else if (mode === 2) {
            for (const o of prep.flat) {
                if (!o.caught) continue;
                const src = map.objects[o.parent] || {};
                if (o.kind === 'fruit') push(o.time, resolve(map, o.time, src.hitSound, src.normalSet, src.additionSet, src.sampleVolume));
                else if (o.kind === 'droplet') { const s = resolve(map, o.time, 0, src.normalSet, 0, src.sampleVolume); push(o.time, { names: [`${s.set}-slidertick`], vol: s.vol }); }
            }
        } else if (mode === 3) {
            for (const n of prep.notes) {
                if (!n.judge || n.judge === 'MISS' || n.hitAt == null) continue;
                const src = map.objects[n.i] || {};
                push(n.hitAt, resolve(map, n.time, src.hitSound, src.normalSet, src.additionSet, src.sampleVolume));
            }
        }
        out.sort((a, b) => a.t - b.t);
        return out;
    }

    /* Web Audio: one context, a gain for all effects, buffers by name */
    function createMixer(skin) {
        let ctx = null, gain = null;
        const buffers = new Map();
        const ensure = () => {
            if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            ctx = new AC();
            gain = ctx.createGain();
            gain.connect(ctx.destination);
            gain.gain.value = mixer.volume;
            return ctx;
        };
        const load = (name) => {
            if (buffers.has(name)) return buffers.get(name);
            const p = (async () => {
                if (!ensure()) return null;
                let data = skin && skin.sample ? await skin.sample(name).catch(() => null) : null;
                if (!data) {
                    try { const res = await fetch(`assets/osu-resources/samples/${name}.wav`); if (res.ok) data = await res.arrayBuffer(); } catch { /* none */ }
                }
                if (!data || data.byteLength < 64) return null; // a blank sample plays nothing
                try { return await ctx.decodeAudioData(data); } catch { return null; }
            })();
            buffers.set(name, p);
            return p;
        };
        const mixer = {
            volume: 1,
            setVolume(v) { mixer.volume = v; if (gain) gain.gain.value = v; },
            warm(names) { ensure(); for (const n of names) load(n); },
            play(names, vol) {
                if (!ensure() || mixer.volume <= 0) return;
                for (const n of names) {
                    load(n).then((buf) => {
                        if (!buf) return;
                        const src = ctx.createBufferSource();
                        src.buffer = buf;
                        const g = ctx.createGain();
                        g.gain.value = Math.max(0, Math.min(1, vol));
                        src.connect(g); g.connect(gain);
                        src.start();
                    });
                }
            },
            close() { if (ctx) ctx.close().catch(() => {}); ctx = null; },
        };
        return mixer;
    }

    window.replaySounds = { soundEvents, createMixer };
})();
