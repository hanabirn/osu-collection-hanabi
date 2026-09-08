/* ===== 小遊戲區 (games hub) =====
   Two mini-games that run off the site's own data:
     1. 每日猜圖 (osu!dle)  — one ranked set a day, guess it from a cover crop
        + a hint per wrong guess (+ optional preview-clip ladder). Shareable
        emoji grid. Streak tracked server-side for logged-in users.
        Backend: games-daily.js.
     2. Higher or Lower     — two farm maps, pick which scores higher on a
        rotating stat (SR / BPM / length / farm-PP / playcount). Endless,
        streak-based. Backend: games-hilo.js (data feed only, client runs it).

   Finding a map you like in either game -> a "加入收藏" prompt (never auto).
   Reuses osuVolume + applyImportedCollections + the shared toast/icon/t. */

let gamesHubBuilt = false;

function ensureGamesLoaded() {
    if (gamesHubBuilt) return;
    gamesHubBuilt = true;
    renderGamesHub();
}

function renderGamesHub() {
    const el = document.getElementById('games-hub');
    if (!el) return;
    el.innerHTML = `
        <div class="games-card" role="button" tabindex="0" onclick="openDailyGame()" onkeydown="if(event.key==='Enter')openDailyGame()">
            <div class="games-card-glyph">${icon('target', { size: '1.6rem' })}</div>
            <h3>${escHtml(t('games_daily_title'))}</h3>
            <p>${escHtml(t('games_daily_blurb'))}</p>
        </div>
        <div class="games-card" role="button" tabindex="0" onclick="openHiloGame()" onkeydown="if(event.key==='Enter')openHiloGame()">
            <div class="games-card-glyph">${icon('trendingUp', { size: '1.6rem' })}</div>
            <h3>${escHtml(t('games_hilo_title'))}</h3>
            <p>${escHtml(t('games_hilo_blurb'))}</p>
        </div>
        <div class="games-card" role="button" tabindex="0" onclick="openQuizGame()" onkeydown="if(event.key==='Enter')openQuizGame()">
            <div class="games-card-glyph">${icon('tag', { size: '1.6rem' })}</div>
            <h3>${escHtml(t('games_quiz_title'))}</h3>
            <p>${escHtml(t('games_quiz_blurb'))}</p>
        </div>`;
}

function gamesBackToHub() {
    if (gq && gq.timer) { clearInterval(gq.timer); gq.timer = null; }
    if (typeof gdClipAudio !== 'undefined' && gdClipAudio) { gdClipAudio.pause(); gdClipAudio = null; }
    document.getElementById('games-view').hidden = true;
    document.getElementById('games-view').innerHTML = '';
    document.getElementById('games-hub').hidden = false;
}

function gamesOpenView() {
    document.getElementById('games-hub').hidden = true;
    const v = document.getElementById('games-view');
    v.hidden = false;
    return v;
}

/* Save one set to the collection — always via a confirm, never silent. */
async function gamesSaveSet(setId) {
    if (!setId) return;
    if (typeof getLoggedInOsuUser === 'function' && !getLoggedInOsuUser()) {
        showShareToast(t('chat_login_required'));
        return;
    }
    if (!confirm(t('games_save_confirm'))) return;
    try {
        const report = await applyImportedCollections(
            [{ name: t('games_save_category'), entries: [{ setId }] }],
            (msg) => showShareToast(msg),
        );
        showShareToast(t('games_save_done', { n: report.addedSets }));
    } catch (e) {
        console.error('games save failed:', e);
        showShareToast(t('mappools_load_fail'));
    }
}

/* ============================ 每日猜圖 ============================ */

let gd = null;

function gdKey(date) { return `osu_gdle2_${date}`; }
function gdLoadLocal(date) {
    try { return JSON.parse(localStorage.getItem(gdKey(date))) || null; } catch { return null; }
}
function gdSaveLocal() {
    try { localStorage.setItem(gdKey(gd.date), JSON.stringify({ picks: gd.picks, hints: gd.hints, done: gd.done, won: gd.won, answer: gd.answer })); } catch { /* ignore */ }
}

async function openDailyGame() {
    const v = gamesOpenView();
    v.innerHTML = `<p class="osu-empty">${escHtml(t('gallery_loading'))}</p>`;
    let data;
    try {
        const headers = {};
        const tok = typeof getOsuAuthToken === 'function' && getOsuAuthToken();
        if (tok) headers.Authorization = `Bearer ${tok}`;
        const r = await fetch('/.netlify/functions/games-daily', { headers });
        data = await r.json();
        if (!r.ok) throw new Error(data.error || 'load failed');
    } catch (e) {
        v.innerHTML = `<button class="cmpool-back" onclick="gamesBackToHub()">${icon('arrowLeft')} ${escHtml(t('games_back'))}</button>
            <p class="osu-empty">${escHtml(t('games_daily_not_ready'))}</p>`;
        return;
    }

    const local = gdLoadLocal(data.date);
    gd = {
        date: data.date,
        cover: data.coverUrl,
        preview: data.previewUrl,
        maxGuesses: data.maxGuesses || 3,
        options: data.options || [],
        picks: (local && local.picks) || [],       // [{ choiceId, correct }]
        hints: (local && local.hints) || [],        // [{ k, v }]
        done: !!(data.done || (local && local.done)),
        won: !!((data.result && data.result.won) || (local && local.won)),
        answer: (data.answer) || (local && local.answer) || null,
        streak: data.streak,
        clipLen: 2,
        busy: false,
    };
    gd.clipLen = Math.min(10, 2 + gd.picks.filter(p => !p.correct).length * 2);
    gdSaveLocal();
    gdRender();
}

function gdRender() {
    const v = document.getElementById('games-view');
    if (!v || !gd) return;
    const wrongs = gd.picks.filter(p => !p.correct).length;
    const blur = gd.done ? 0 : Math.max(3, 20 - wrongs * 7);
    const scale = gd.done ? 1 : Math.max(1, 1.5 - wrongs * 0.2);
    const tried = new Set(gd.picks.map(p => String(p.choiceId)));

    const opts = gd.options.map(o => {
        const isTried = tried.has(String(o.id));
        const isAnswer = gd.done && gd.answer && String(o.id) === String(gd.answer.setId);
        const cls = ['gd-opt'];
        if (isAnswer) cls.push('is-answer');
        else if (isTried) cls.push('is-wrong');
        const dis = gd.done || isTried || gd.busy;
        return `<button class="${cls.join(' ')}" ${dis ? 'disabled' : ''} onclick="gdPick('${escHtml(String(o.id))}')">${escHtml(o.text)}</button>`;
    }).join('');

    const hintsHtml = gd.hints.map(h =>
        `<div class="gd-hint">${icon('sparkles', { size: '0.85em' })} <b>${escHtml(t('games_hint_' + h.k))}</b> · ${escHtml(h.v)}</div>`,
    ).join('');

    let outcome = '';
    if (gd.done) {
        const a = gd.answer || {};
        outcome = `<div class="gd-outcome ${gd.won ? 'is-win' : 'is-lose'}">
            <p>${escHtml(gd.won ? t('games_daily_win', { n: gd.picks.length }) : t('games_daily_lose'))}</p>
            ${a.title ? `<p class="gd-answer"><a href="${escHtml(a.url)}" target="_blank" rel="noopener">${escHtml(a.artist)} - ${escHtml(a.title)}</a><br><span class="gd-answer-sub">${escHtml(t('mapped_by', { n: a.creator || '—' }))}</span></p>` : ''}
            <div class="gd-outcome-actions">
                <button onclick="gdShare()">${icon('share2', { size: '0.9em' })} ${escHtml(t('games_daily_share'))}</button>
                ${a.setId ? `<button onclick="gamesSaveSet(${a.setId})">${icon('plus', { size: '0.9em' })} ${escHtml(t('games_save_btn'))}</button>` : ''}
            </div>
        </div>`;
    }

    v.innerHTML = `
        <button class="cmpool-back" onclick="gamesBackToHub()">${icon('arrowLeft')} ${escHtml(t('games_back'))}</button>
        <div class="gd-head">
            <h3>${escHtml(t('games_daily_title'))} <span class="gd-date">${escHtml(gd.date)}</span></h3>
            ${gd.streak != null ? `<span class="gd-streak">🔥 ${escHtml(t('games_daily_streak', { n: gd.streak }))}</span>` : ''}
        </div>
        <div class="gd-cover-wrap">
            <img class="gd-cover" src="${escHtml(gd.cover)}" alt="" style="filter:blur(${blur}px);transform:scale(${scale});">
        </div>
        ${gd.preview && !gd.done ? `<div class="gd-clip">
            <button onclick="gdPlayClip()">${icon('play', { size: '0.9em' })} ${escHtml(t('games_daily_clip', { s: gd.clipLen }))}</button>
        </div>` : ''}
        ${!gd.done ? `<p class="gd-prompt">${escHtml(t('games_daily_prompt', { n: gd.maxGuesses - gd.picks.length }))}</p>` : ''}
        <div class="gd-opts">${opts}</div>
        ${hintsHtml ? `<div class="gd-hints">${hintsHtml}</div>` : ''}
        ${outcome}`;
}

async function gdPick(choiceId) {
    if (!gd || gd.done || gd.busy) return;
    if (gd.picks.some(p => String(p.choiceId) === String(choiceId))) return;
    gd.busy = true;
    gdRender();
    try {
        const headers = { 'Content-Type': 'application/json' };
        const tok = typeof getOsuAuthToken === 'function' && getOsuAuthToken();
        if (tok) headers.Authorization = `Bearer ${tok}`;
        const r = await fetch('/.netlify/functions/games-daily', {
            method: 'POST', headers,
            body: JSON.stringify({ date: gd.date, guessNo: gd.picks.length, choiceId }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'pick failed');
        gd.picks.push({ choiceId, correct: !!d.correct });
        if (d.revealHint) gd.hints.push(d.revealHint);
        if (!d.correct) gd.clipLen = Math.min(10, gd.clipLen + 2);
        if (d.done) {
            gd.done = true;
            gd.won = !!d.correct;
            gd.answer = d.answer || gd.answer;
            if (d.streak != null) gd.streak = d.streak;
        }
        gd.busy = false;
        gdSaveLocal();
        gdRender();
    } catch (e) {
        console.error('daily pick failed:', e);
        showShareToast(t('mappools_load_fail'));
        gd.busy = false;
        gdRender();
    }
}

let gdClipAudio = null;
function gdPlayClip() {
    if (!gd || !gd.preview) return;
    if (gdClipAudio) { gdClipAudio.pause(); gdClipAudio = null; }
    const a = new Audio(gd.preview);
    a.volume = (typeof osuVolume === 'number') ? osuVolume : 0.4;
    gdClipAudio = a;
    const limit = gd.clipLen;
    a.play().catch(() => {});
    a.ontimeupdate = () => { if (a.currentTime >= limit) { a.pause(); a.ontimeupdate = null; } };
}

function gdShare() {
    if (!gd) return;
    const squares = [];
    for (let i = 0; i < gd.maxGuesses; i++) {
        const p = gd.picks[i];
        squares.push(!p ? '⬛' : (p.correct ? '🟩' : '🟥'));
    }
    const line = `osu!dle ${gd.date} ${gd.won ? gd.picks.length : 'X'}/${gd.maxGuesses}`;
    const text = `${line}\n${squares.join('')}\n${location.origin}/?game=daily`;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(
            () => showShareToast(t('games_daily_copied')),
            () => showShareToast(text),
        );
    } else {
        showShareToast(text);
    }
}

/* ========================= Higher or Lower ========================= */

let gh = null;
const GH_STATS = ['sr', 'bpm', 'len', 'pp', 'plays'];

function ghBestKey() { return 'osu_hilo_best'; }
function ghBest() { try { return parseInt(localStorage.getItem(ghBestKey()), 10) || 0; } catch { return 0; } }
function ghSetBest(n) { try { localStorage.setItem(ghBestKey(), String(n)); } catch { /* ignore */ } }

function ghStatVal(m, stat) {
    switch (stat) {
        case 'sr': return m.sr;
        case 'bpm': return m.bpm;
        case 'len': return m.len;
        case 'pp': return m.pp;
        case 'plays': return m.plays;
        default: return 0;
    }
}
function ghStatFmt(m, stat) {
    switch (stat) {
        case 'sr': return `${m.sr.toFixed(2)}★`;
        case 'bpm': return `${m.bpm} BPM`;
        case 'len': return `${Math.floor(m.len / 60)}:${String(m.len % 60).padStart(2, '0')}`;
        case 'pp': return `${m.pp.toLocaleString()}pp`;
        case 'plays': return m.plays.toLocaleString();
        default: return '';
    }
}

async function openHiloGame() {
    const v = gamesOpenView();
    v.innerHTML = `<p class="osu-empty">${escHtml(t('gallery_loading'))}</p>`;
    let deck;
    try {
        const r = await fetch('/.netlify/functions/games-hilo');
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'load failed');
        deck = (d.rounds || []).filter(m => m.setId && m.title);
    } catch (e) {
        v.innerHTML = `<button class="cmpool-back" onclick="gamesBackToHub()">${icon('arrowLeft')} ${escHtml(t('games_back'))}</button>
            <p class="osu-empty">${escHtml(t('mappools_load_fail'))}</p>`;
        return;
    }
    if (deck.length < 5) {
        v.innerHTML = `<button class="cmpool-back" onclick="gamesBackToHub()">${icon('arrowLeft')} ${escHtml(t('games_back'))}</button>
            <p class="osu-empty">${escHtml(t('games_hilo_no_data'))}</p>`;
        return;
    }
    gh = { deck, i: 1, streak: 0, best: ghBest(), stat: GH_STATS[Math.floor(Math.random() * GH_STATS.length)], revealed: false, over: false };
    ghRender();
}

function ghRender() {
    const v = document.getElementById('games-view');
    if (!v || !gh) return;
    const left = gh.deck[gh.i - 1];
    const right = gh.deck[gh.i];

    const card = (m, showVal) => `
        <div class="gh-card" style="background-image:linear-gradient(rgba(10,8,14,.55),rgba(10,8,14,.8)),url('https://assets.ppy.sh/beatmaps/${m.setId}/covers/cover@2x.jpg');">
            <div class="gh-card-meta">
                <div class="gh-card-title">${escHtml(m.artist)} - ${escHtml(m.title)}</div>
                <div class="gh-card-sub">${escHtml(m.creator ? t('mapped_by', { n: m.creator }) : '')}</div>
            </div>
            <div class="gh-card-stat">
                ${showVal
                    ? `<span class="gh-val">${escHtml(ghStatFmt(m, gh.stat))}</span>`
                    : `<span class="gh-q">?</span>`}
            </div>
        </div>`;

    let mid;
    if (gh.over) {
        mid = `<div class="gh-mid gh-over">
            <p>${escHtml(t('games_hilo_over', { n: gh.streak }))}</p>
            <p class="gh-best">${escHtml(t('games_hilo_best', { n: gh.best }))}</p>
            <button onclick="openHiloGame()">${icon('rotateCw', { size: '0.9em' })} ${escHtml(t('games_hilo_again'))}</button>
        </div>`;
    } else if (gh.revealed) {
        const lv = ghStatVal(left, gh.stat), rv = ghStatVal(right, gh.stat);
        mid = `<div class="gh-mid">
            <p class="${rv >= lv ? 'gh-ok' : 'gh-no'}">${rv >= lv ? '✅' : '❌'}</p>
            <button onclick="ghNext()">${escHtml(t('games_hilo_next'))}</button>
            <button class="gh-save" onclick="gamesSaveSet(${right.setId})">${icon('plus', { size: '0.85em' })} ${escHtml(t('games_save_btn'))}</button>
        </div>`;
    } else {
        mid = `<div class="gh-mid">
            <p class="gh-ask">${escHtml(t('games_hilo_ask', { stat: t('games_stat_' + gh.stat) }))}</p>
            <button onclick="ghGuess(true)">${icon('trendingUp', { size: '0.9em' })} ${escHtml(t('games_hilo_higher'))}</button>
            <button onclick="ghGuess(false)">${escHtml(t('games_hilo_lower'))}</button>
        </div>`;
    }

    v.innerHTML = `
        <button class="cmpool-back" onclick="gamesBackToHub()">${icon('arrowLeft')} ${escHtml(t('games_back'))}</button>
        <div class="gh-head">
            <h3>${escHtml(t('games_hilo_title'))}</h3>
            <span class="gh-score">${escHtml(t('games_hilo_streak', { n: gh.streak }))} · ${escHtml(t('games_hilo_best', { n: gh.best }))}</span>
        </div>
        <div class="gh-arena">
            ${card(left, true)}
            <div class="gh-vs">${mid}</div>
            ${card(right, gh.revealed || gh.over)}
        </div>`;
}

function ghGuess(higher) {
    if (!gh || gh.revealed || gh.over) return;
    const lv = ghStatVal(gh.deck[gh.i - 1], gh.stat);
    const rv = ghStatVal(gh.deck[gh.i], gh.stat);
    const rightIsHigher = rv >= lv;
    const correct = higher === rightIsHigher;
    gh.revealed = true;
    if (correct) {
        gh.streak++;
        if (gh.streak > gh.best) { gh.best = gh.streak; ghSetBest(gh.best); }
    } else {
        gh.over = true;
    }
    ghRender();
}

function ghNext() {
    if (!gh || gh.over) return;
    gh.i++;
    gh.revealed = false;
    gh.stat = GH_STATS[Math.floor(Math.random() * GH_STATS.length)];
    if (gh.i >= gh.deck.length) { gh.over = true; } // ran out of deck — treat as a clean finish
    ghRender();
}

/* ===================== 分類快問快答 (genre quick-fire) ===================== */

let gq = null;
const GQ_SECONDS = 60;

function gqBest() { try { return parseInt(localStorage.getItem('osu_quiz_best'), 10) || 0; } catch { return 0; } }
function gqSetBest(n) { try { localStorage.setItem('osu_quiz_best', String(n)); } catch { /* ignore */ } }

async function openQuizGame() {
    const v = gamesOpenView();
    v.innerHTML = `<p class="osu-empty">${escHtml(t('gallery_loading'))}</p>`;
    let data;
    try {
        const r = await fetch('/.netlify/functions/games-quiz');
        data = await r.json();
        if (!r.ok) throw new Error(data.error || 'load failed');
    } catch (e) {
        v.innerHTML = `<button class="cmpool-back" onclick="gamesBackToHub()">${icon('arrowLeft')} ${escHtml(t('games_back'))}</button>
            <p class="osu-empty">${escHtml(t('games_quiz_no_data'))}</p>`;
        return;
    }
    const deck = (data.rounds || []).filter(r => r.setId && r.title);
    if (deck.length < 5 || !(data.genres || []).length) {
        v.innerHTML = `<button class="cmpool-back" onclick="gamesBackToHub()">${icon('arrowLeft')} ${escHtml(t('games_back'))}</button>
            <p class="osu-empty">${escHtml(t('games_quiz_no_data'))}</p>`;
        return;
    }
    if (gq && gq.timer) clearInterval(gq.timer);
    gq = {
        deck, i: 0, score: 0, best: gqBest(),
        genres: data.genres, genreName: Object.fromEntries(data.genres.map(g => [g.id, g.name])),
        timeLeft: GQ_SECONDS, timer: null, over: false, feedback: null, locked: false,
    };
    gq.timer = setInterval(() => {
        if (!gq || gq.over) return;
        gq.timeLeft--;
        if (gq.timeLeft <= 0) { gqEnd(); }
        else { const el = document.getElementById('gq-time'); if (el) el.textContent = t('games_quiz_time', { n: gq.timeLeft }); }
    }, 1000);
    gqRender();
}

function gqEnd() {
    if (!gq) return;
    if (gq.timer) { clearInterval(gq.timer); gq.timer = null; }
    gq.over = true;
    if (gq.score > gq.best) { gq.best = gq.score; gqSetBest(gq.best); }
    gqRender();
}

function gqRender() {
    const v = document.getElementById('games-view');
    if (!v || !gq) return;

    if (gq.over) {
        v.innerHTML = `
            <button class="cmpool-back" onclick="gamesBackToHub()">${icon('arrowLeft')} ${escHtml(t('games_back'))}</button>
            <div class="gh-head"><h3>${escHtml(t('games_quiz_title'))}</h3></div>
            <div class="gq-over">
                <p>${escHtml(t('games_quiz_over', { n: gq.score }))}</p>
                <p class="gh-best">${escHtml(t('games_quiz_best', { n: gq.best }))}</p>
                <button onclick="openQuizGame()">${icon('rotateCw', { size: '0.9em' })} ${escHtml(t('games_quiz_again'))}</button>
            </div>`;
        return;
    }

    const m = gq.deck[gq.i % gq.deck.length];
    const btns = gq.genres.map(g =>
        `<button class="gq-opt" ${gq.locked ? 'disabled' : ''} onclick="gqAnswer(${g.id})">${escHtml(g.name)}</button>`,
    ).join('');
    const fb = gq.feedback
        ? `<p class="gq-feedback ${gq.feedback.ok ? 'is-ok' : 'is-no'}">${gq.feedback.ok ? '✅' : `❌ ${escHtml(t('games_quiz_correct_was', { name: gq.genreName[gq.feedback.answer] || '?' }))}`}</p>`
        : '';

    v.innerHTML = `
        <button class="cmpool-back" onclick="gamesBackToHub()">${icon('arrowLeft')} ${escHtml(t('games_back'))}</button>
        <div class="gh-head">
            <h3>${escHtml(t('games_quiz_title'))}</h3>
            <span class="gh-score"><span id="gq-time">${escHtml(t('games_quiz_time', { n: gq.timeLeft }))}</span> · ${escHtml(t('games_quiz_score', { n: gq.score }))}</span>
        </div>
        <div class="gq-card" style="background-image:linear-gradient(rgba(10,8,14,.5),rgba(10,8,14,.82)),url('https://assets.ppy.sh/beatmaps/${m.setId}/covers/cover@2x.jpg');">
            <div class="gq-card-t">${escHtml(m.artist)} - ${escHtml(m.title)}</div>
        </div>
        <p class="gd-prompt">${escHtml(t('games_quiz_prompt'))}</p>
        <div class="gq-opts">${btns}</div>
        ${fb}`;
}

function gqAnswer(genreId) {
    if (!gq || gq.over || gq.locked) return;
    const m = gq.deck[gq.i % gq.deck.length];
    const ok = genreId === m.genreId;
    if (ok) {
        gq.score++;
        gq.i++;
        gq.feedback = null;
        gqRender();
    } else {
        gq.locked = true;
        gq.feedback = { ok: false, answer: m.genreId };
        gqRender();
        setTimeout(() => {
            if (!gq || gq.over) return;
            gq.i++;
            gq.locked = false;
            gq.feedback = null;
            gqRender();
        }, 900);
    }
}

/* language switch */
function refreshGamesLocalized() {
    if (!gamesHubBuilt) return;
    const viewOpen = !document.getElementById('games-view').hidden;
    if (viewOpen && gd && document.querySelector('.gd-opts')) gdRender();
    else if (viewOpen && gh && document.querySelector('.gh-arena')) ghRender();
    else if (viewOpen && gq) gqRender();
    else renderGamesHub();
}

/* deep link: ?game=daily / ?game=hilo / ?game=quiz */
function checkGamesDeepLink() {
    const params = new URLSearchParams(location.search);
    const g = params.get('game');
    if (g !== 'daily' && g !== 'hilo' && g !== 'quiz') return;
    params.delete('game');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
    if (typeof switchTab === 'function') switchTab('games');
    setTimeout(() => {
        if (g === 'daily') openDailyGame();
        else if (g === 'hilo') openHiloGame();
        else openQuizGame();
    }, 200);
}
