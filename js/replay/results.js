/* ===== Replay player: results screen =====
   osu!stable's ranking screen, drawn on the player's canvas with the
   visitor's skin (ranking-panel, ranking-title, the rank letter, the
   judgement images, the score font), each image falling back to osu!'s
   default (ppy/osu-resources, CC BY-NC 4.0). Positions are in stable's
   1024×768 space, measured from the game and scaled to the view's height.
   drawResults(ctx, view, data) -> { actions: {x, y, w, h} } (screen px) */
(function () {
    const PAD = 8; // the game shows the score in 8 digits (03314562)

    // the judgement rows: [left, right] per row, each { key, img, value }
    function rowsFor(mode, rec, replay) {
        if (mode === 0) {
            return [
                [{ img: 'hit300', v: rec[300] }, { img: 'hit300g', v: replay.nGeki }],
                [{ img: 'hit100', v: rec[100] }, { img: 'hit100k', v: replay.nKatu }],
                [{ img: 'hit50', v: rec[50] }, { img: 'hit0', v: rec.MISS }],
            ];
        }
        if (mode === 3) {
            return [
                [{ img: 'mania-hit300', v: rec[300] }, { img: 'mania-hit300g', v: rec.MAX }],
                [{ img: 'mania-hit200', v: rec[200] }, { img: 'mania-hit100', v: rec[100] }],
                [{ img: 'mania-hit50', v: rec[50] }, { img: 'mania-hit0', v: rec.MISS }],
            ];
        }
        if (mode === 1) {
            return [
                [{ img: 'taiko-hit300', v: rec[300] }, { img: 'taiko-hit300g', v: replay.nGeki }],
                [{ img: 'taiko-hit100', v: rec[100] }, { img: 'taiko-hit100k', v: replay.nKatu }],
                [{ img: 'taiko-hit0', v: rec.MISS }, null],
            ];
        }
        return [
            [{ img: 'fruit', v: rec.FRUIT }, { img: 'fruit-drop', v: rec.TINYMISS, dim: true }],
            [{ img: 'fruit-drop', v: rec.DROP }, { img: 'hit0', v: rec.MISS }],
            [{ img: 'fruit-drop', v: rec.TINY, small: true }, null],
        ];
    }

    // a number in the skin's score font ("0956534", "710x", "99.07%")
    function drawNumber(ctx, I, text, x, y, height) {
        const glyph = (ch) => (ch >= '0' && ch <= '9' ? I[`score-${ch}`] : ch === 'x' ? I['score-x'] : ch === '.' ? I['score-dot'] : ch === '%' ? I['score-percent'] : ch === ',' ? I['score-comma'] : null);
        const gs = [...text].map(glyph);
        if (gs.some((g) => !g)) {
            ctx.fillStyle = '#fff';
            ctx.font = `600 ${Math.round(height * 0.92)}px system-ui, sans-serif`;
            ctx.textAlign = 'left'; ctx.textBaseline = 'top';
            ctx.fillText(text, x, y);
            return;
        }
        const base = I['score-0'].bmp.height * I['score-0'].s;
        const k = height / base;
        const overlap = (I.scoreOverlap || 0) * k;
        let cx = x;
        for (const g of gs) {
            const gw = g.bmp.width * g.s * k, gh = g.bmp.height * g.s * k;
            ctx.drawImage(g.bmp, cx, y + (height - gh), gw, gh);
            cx += gw - overlap;
        }
    }

    // an image fitted into a box, centred
    function fit(ctx, img, cx, cy, maxW, maxH, alpha) {
        if (!img) return;
        const iw = img.bmp.width * img.s, ih = img.bmp.height * img.s;
        const k = Math.min(maxW / iw, maxH / ih, 1.4);
        ctx.globalAlpha = alpha == null ? 1 : alpha;
        ctx.drawImage(img.bmp, cx - (iw * k) / 2, cy - (ih * k) / 2, iw * k, ih * k);
        ctx.globalAlpha = 1;
    }

    /* data: { mode, record, replay, rank (X/XH/S/SH/A..D), acc, title, line2, line3, bg, bgDim, lifeBar:[{t,hp}] } */
    function drawResults(ctx, view, data) {
        const { w, h } = view;
        const I = view.rankSkin || {};
        const u = Math.min(h / 768, w / 1024);
        const W = w / u; // the view's width in stable units
        ctx.save();
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        if (data.bg) {
            const s = Math.max(w / data.bg.width, h / data.bg.height);
            ctx.globalAlpha = 0.75;
            ctx.drawImage(data.bg, (w - data.bg.width * s) / 2, (h - data.bg.height * s) / 2, data.bg.width * s, data.bg.height * s);
            ctx.globalAlpha = 1;
        }
        ctx.scale(u, u);
        const oy = (h / u - 768) / 2; // centre vertically when the view is wider than 4:3... and taller
        ctx.translate(0, Math.max(0, oy));

        // the top bar with the map and the player
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(0, -Math.max(0, oy), W, 96 + Math.max(0, oy));
        // the text stops short of the Ranking title on the right
        const titleImg = I['ranking-title'];
        const textMax = W - (titleImg ? titleImg.bmp.width * titleImg.s + 70 : 120) - 24;
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.font = '400 30px system-ui, sans-serif';
        ctx.fillText(data.title, 6, 4, textMax);
        ctx.font = '400 22px system-ui, sans-serif';
        ctx.fillText(data.line2, 6, 40, textMax);
        ctx.fillText(data.line3, 6, 64, textMax);

        // the panel, the score, the judgements
        const panel = I['ranking-panel'];
        if (panel) ctx.drawImage(panel.bmp, 0, 102, panel.bmp.width * panel.s, panel.bmp.height * panel.s);
        else { ctx.fillStyle = 'rgba(40,100,200,0.8)'; ctx.fillRect(10, 110, 600, 485); }
        const score = String(Math.max(0, Math.round(data.replay.score || 0))).padStart(PAD, '0');
        drawNumber(ctx, I, score, 200, 120, 60);
        const rows = rowsFor(data.mode, data.record, data.replay);
        const rowY = [255, 353, 452];
        const colIcon = [64, 388], colVal = [128, 452];
        rows.forEach((row, ri) => row.forEach((cell, ci) => {
            if (!cell) return;
            let img = I[cell.img];
            if (cell.img === 'fruit') {
                img = I['fruit-pear'];
                if (img) {
                    fit(ctx, img, colIcon[ci], rowY[ri], 70, 70);
                    if (I['fruit-pear-overlay']) fit(ctx, I['fruit-pear-overlay'], colIcon[ci], rowY[ri], 70, 70);
                }
            } else {
                const box = cell.small ? 34 : 64;
                fit(ctx, img, colIcon[ci], rowY[ri], cell.small ? box : 110, box, cell.dim ? 0.45 : 1);
            }
            drawNumber(ctx, I, `${cell.v}x`, colVal[ci], rowY[ri] - 30, 56);
        }));
        if (I['ranking-maxcombo']) ctx.drawImage(I['ranking-maxcombo'].bmp, 8, 482, I['ranking-maxcombo'].bmp.width * I['ranking-maxcombo'].s, I['ranking-maxcombo'].bmp.height * I['ranking-maxcombo'].s);
        if (I['ranking-accuracy']) ctx.drawImage(I['ranking-accuracy'].bmp, 291, 482, I['ranking-accuracy'].bmp.width * I['ranking-accuracy'].s, I['ranking-accuracy'].bmp.height * I['ranking-accuracy'].s);
        drawNumber(ctx, I, `${data.replay.maxCombo}x`, 22, 530, 56);
        drawNumber(ctx, I, `${(data.acc * 100).toFixed(2)}%`, 314, 530, 56);
        if (data.replay.perfect && I['ranking-perfect']) fit(ctx, I['ranking-perfect'], 330, 690, 320, 110);

        // the performance graph: the life bar over the play, green above half, red below
        const graph = I['ranking-graph'];
        const gx = 256, gy = 608, gw = graph ? graph.bmp.width * graph.s : 317, gh = graph ? graph.bmp.height * graph.s : 152;
        if (graph) ctx.drawImage(graph.bmp, gx, gy, gw, gh);
        const lb = data.lifeBar;
        if (lb && lb.length > 1) {
            const t0 = lb[0].t, t1 = lb[lb.length - 1].t || 1;
            const ix = gx + gw * 0.05, iw = gw * 0.9, iy = gy + gh * 0.15, ih = gh * 0.7;
            ctx.lineWidth = 3;
            for (let i = 1; i < lb.length; i++) {
                const a = lb[i - 1], b = lb[i];
                ctx.strokeStyle = b.hp >= 0.5 ? '#8cff4a' : '#ff4a4a';
                ctx.beginPath();
                ctx.moveTo(ix + ((a.t - t0) / (t1 - t0)) * iw, iy + (1 - a.hp) * ih);
                ctx.lineTo(ix + ((b.t - t0) / (t1 - t0)) * iw, iy + (1 - b.hp) * ih);
                ctx.stroke();
            }
        }

        // the right side: "Ranking" and the rank letter
        const title = I['ranking-title'];
        if (title) { const tw = title.bmp.width * title.s, th = title.bmp.height * title.s; ctx.drawImage(title.bmp, W - tw - 70, 0, tw, th); } // clear of the close button
        const letter = I[`ranking-${data.rank}`] || I[`ranking-${data.rank.replace('H', '')}`];
        if (letter) fit(ctx, letter, W - 195, 313, 330, 400);
        ctx.restore();
        // where the buttons go (below the letter, right-aligned), in screen px
        const top = (Math.max(0, oy) + 540) * u;
        return { actions: { right: 24 * u, top } };
    }

    window.replayResults = { drawResults };
})();
