/* Watch Replay — parse-only smoke test (step 3 of the implementation plan).
   No canvas playback yet; this verifies the full data pipeline works
   end-to-end against a REAL score before the renderer is built on top of
   it: login gate -> beatmap-file.js + replay-download.js -> osu-parsers'
   BeatmapDecoder/ScoreDecoder -> osu-catch-stable's CatchRuleset.

   Loaded as a <script type="module">, so it can `import` esm.sh packages
   directly — this site has no CSP (unlike the main site, whose CSP blocks
   CDN libs), so this stays a build-step-free static site. common.js/api.js
   are loaded first as classic scripts and expose their top-level functions
   as globals, which this module can reach the same as any other script.

   API shapes below (decodeFromBuffer returning {info, replay},
   CatchReplayConverter's convertReplay/createReplay/convertFrames methods)
   were confirmed against real packages+a real ranked beatmap file this
   session, but NOT yet against a real .osr — no fixture was obtainable
   without a live OAuth login. First real click-through after deploy is
   the actual verification; errors here are logged in full so that pass
   can fix field-name mismatches quickly instead of guessing blind. */

const PARSERS_URL = 'https://esm.sh/osu-parsers@4.1.7';
const CATCH_STABLE_URL = 'https://esm.sh/osu-catch-stable@4.0.1';

const main = document.getElementById('replay-main');

function setStatus(html) {
    main.innerHTML = html;
}

function loginGateHtml() {
    return `
        <div class="card" style="max-width:480px;margin:60px auto;text-align:center;padding:32px">
            <p style="margin-top:0">${escapeHtml(t('replay_login_prompt'))}</p>
            <a class="ct-login-btn" href="${ctLoginUrl()}" style="display:inline-flex">${escapeHtml(t('login_with_osu'))}</a>
        </div>
    `;
}

function errorHtml(msg) {
    return `<p class="coverage-note">${escapeHtml(msg)}</p>`;
}

async function fetchBeatmapFile(beatmapId) {
    const res = await fetch(`${API_BASE}/beatmap-file?beatmap_id=${encodeURIComponent(beatmapId)}`);
    if (!res.ok) throw new Error(`beatmap-file: ${res.status}`);
    const { content } = await res.json();
    return content;
}

async function fetchReplayBytes(scoreId) {
    const res = await fetch(`${API_BASE}/replay-download?score_id=${encodeURIComponent(scoreId)}`, {
        headers: { Authorization: `Bearer ${getCtAuthToken()}` },
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 403) throw new Error(t('replay_owner_only'));
        if (res.status === 404) throw new Error(t('replay_not_found'));
        if (res.status === 401) throw new Error(t('replay_login_prompt'));
        throw new Error(t('replay_fetch_failed', { msg: body.error || res.status }));
    }
    return res.arrayBuffer();
}

async function run() {
    const params = new URLSearchParams(location.search);
    const scoreId = params.get('score_id');
    const beatmapId = params.get('beatmap_id');
    // Comma-separated mod acronyms, e.g. "HR,DT" — passed straight through
    // from the score row that linked here (player.html/map.html already
    // hold the full score record client-side, so no extra lookup endpoint
    // is needed just to recover this).
    const mods = (params.get('mods') || '').split(',').filter(Boolean);

    if (!scoreId || !beatmapId) {
        setStatus(errorHtml(t('replay_not_found')));
        return;
    }

    if (!getCtLoggedInUser()) {
        setStatus(loginGateHtml());
        return;
    }

    setStatus(errorHtml(t('replay_loading')));

    try {
        const [osuText, replayBuffer] = await Promise.all([
            fetchBeatmapFile(beatmapId),
            fetchReplayBytes(scoreId),
        ]);

        const { BeatmapDecoder, ScoreDecoder } = await import(PARSERS_URL);
        const { CatchRuleset, CatchReplayConverter } = await import(CATCH_STABLE_URL);

        const ruleset = new CatchRuleset();
        const parsedBeatmap = new BeatmapDecoder().decodeFromString(osuText);
        // TODO (canvas-renderer step): apply `mods` to the beatmap here —
        // exact API (createModCombination / applyToBeatmapWithMods or
        // similar) not yet confirmed against real usage; unmodded hit
        // objects are enough to verify the pipeline for this smoke test.
        const catchBeatmap = ruleset.applyToBeatmap(parsedBeatmap);

        const parsedScore = await new ScoreDecoder().decodeFromBuffer(new Uint8Array(replayBuffer));
        console.log('[replay] parsed score:', parsedScore);

        let frameCount = 'n/a';
        try {
            const converter = new CatchReplayConverter(catchBeatmap);
            const convertedReplay = converter.convertReplay(parsedScore.replay, { mods });
            console.log('[replay] converted replay:', convertedReplay);
            frameCount = (convertedReplay.frames || convertedReplay).length ?? 'n/a';
        } catch (convErr) {
            console.warn('[replay] replay frame conversion failed (expected until verified against a real .osr):', convErr);
        }

        setStatus(`
            <div class="card" style="max-width:560px;margin:40px auto;padding:24px">
                <h2 style="margin-top:0">Watch Replay — parse smoke test</h2>
                <p>beatmap hit objects: <strong>${catchBeatmap.hitObjects.length}</strong></p>
                <p>replay frames: <strong>${(parsedScore.replay && parsedScore.replay.frames || []).length}</strong></p>
                <p>catch-converted frames: <strong>${frameCount}</strong></p>
                <p style="color:var(--text-dim);font-size:0.82rem">
                    Canvas playback isn't built yet — this page only proves the
                    data pipeline (login → download → parse) works. Open the
                    console for full parsed objects.
                </p>
            </div>
        `);
    } catch (err) {
        console.error('[replay] failed:', err);
        setStatus(errorHtml(err.message));
    }
}

run();
