/* osu! 歌曲收藏 — multiplayer host bot.

   Long-running process. Every POLL_MS it reads the `mp-requests` queue from
   Netlify Blobs; for each new request it opens an osu! multi lobby, invites
   the requester, and cycles through the maps the website resolved from that
   person's collection / favourites. Players drive it with chat commands
   (!skip !next !shuffle !info !close). Empty lobbies auto-close.

   Deploy: a small always-on box (see SETUP.md). Not on Netlify — this needs
   a persistent IRC connection, which Functions can't hold.

   bancho.js docs: https://bancho.js.org  /  https://github.com/cyperdark/bancho.js
*/
require('dotenv').config();
const Banchojs = require('bancho.js');
const { readRequests, patchRequest, setStatus } = require('./store');

const {
    BANCHO_USERNAME,
    BANCHO_PASSWORD,
    BANCHO_BOT_ACCOUNT = '0',
    OSU_API_KEY,
    POLL_MS = '5000',
    LOBBY_IDLE_CLOSE_MS = '300000',
    MAP_TIMEOUT_MS = '420000',
} = process.env;

if (!BANCHO_USERNAME || !BANCHO_PASSWORD) {
    console.error('Missing BANCHO_USERNAME / BANCHO_PASSWORD — copy .env.example to .env and fill it in.');
    process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (s, n) => String(s || '').slice(0, n);

const clientOpts = {
    username: BANCHO_USERNAME,
    password: BANCHO_PASSWORD,
    apiKey: OSU_API_KEY || undefined,
};
// A ppy-flagged "bot" account may send far more messages per window.
if (BANCHO_BOT_ACCOUNT === '1') {
    clientOpts.limiterTimespan = 60_000;
    clientOpts.limiterPrivateMessages = 270;
    clientOpts.limiterPublicMessages = 270;
}
const client = new Banchojs.BanchoClient(clientOpts);

const running = new Set(); // request ids currently being handled

/* ---------- connection ---------- */

async function connectWithRetry(attempt = 0) {
    try {
        await client.connect();
        console.log(`[bot] connected to Bancho as ${BANCHO_USERNAME}`);
    } catch (e) {
        const wait = Math.min(60_000, 2000 * 2 ** attempt);
        console.error(`[bot] connect failed: ${e.message} — retrying in ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        return connectWithRetry(attempt + 1);
    }
}

client.on('disconnected', async (err) => {
    console.error('[bot] disconnected from Bancho:', err ? err.message : '(no error)');
    await sleep(3000);
    connectWithRetry();
});
client.on('error', (err) => console.error('[bot] client error:', err && err.message));

/* ---------- queue poll ---------- */

async function pollForever() {
    for (;;) {
        try {
            await tick();
        } catch (e) {
            console.error('[poll] tick error:', e.message);
        }
        await sleep(Number(POLL_MS));
    }
}

async function tick() {
    if (!client.isConnected()) return;
    const list = await readRequests();
    for (const req of list) {
        if (req.status !== 'pending' || running.has(req.id)) continue;
        if (!req.osuUsername || !Array.isArray(req.maps) || !req.maps.length) {
            await patchRequest(req.id, { status: 'error', error: 'bad request payload' });
            continue;
        }
        running.add(req.id);
        await patchRequest(req.id, { status: 'running' });
        runLobby(req)
            .catch(async (e) => {
                console.error(`[lobby ${req.id}] error:`, e.stack || e.message);
                await patchRequest(req.id, { status: 'error', error: clamp(e.message, 300) });
                await setStatus(req.id, { state: 'error', error: clamp(e.message, 300) });
            })
            .finally(() => running.delete(req.id));
    }
}

/* ---------- one lobby ---------- */

function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function applyFilters(maps, filters) {
    if (!filters) return maps;
    return maps.filter((m) => {
        if (filters.maxStars && m.stars && m.stars > filters.maxStars) return false;
        if (filters.minStars && m.stars && m.stars < filters.minStars) return false;
        if (filters.maxLenSec && m.lenSec && m.lenSec > filters.maxLenSec) return false;
        return true;
    });
}

async function runLobby(req) {
    const label = clamp(req.name || `${req.osuUsername}'s collection`, 50);
    let maps = applyFilters(req.maps, req.filters).filter((m) => m.beatmapId);
    if (!maps.length) throw new Error('no maps left after filters');

    console.log(`[lobby ${req.id}] creating "${label}" for ${req.osuUsername} — ${maps.length} maps`);
    await setStatus(req.id, { state: 'creating', name: label });

    const channel = await client.createLobby(label);
    const lobby = channel.lobby;

    await setStatus(req.id, {
        state: 'open',
        lobbyId: lobby.id,
        mpLink: `osu://mp/${lobby.id}`,
        name: label,
    });
    await patchRequest(req.id, { status: 'open', lobbyId: lobby.id });
    console.log(`[lobby ${req.id}] mp #${lobby.id}`);

    try {
        await lobby.setSettings(
            Banchojs.BanchoLobbyTeamModes.HeadToHead,
            Banchojs.BanchoLobbyWinConditions.ScoreV2,
        );
    } catch (e) {
        console.warn(`[lobby ${req.id}] setSettings: ${e.message}`);
    }
    try {
        await lobby.invitePlayer(req.osuUsername);
    } catch (e) {
        console.warn(`[lobby ${req.id}] invite ${req.osuUsername}: ${e.message}`);
    }

    /* -- state -- */
    const st = {
        queue: maps,                 // {beatmapId, title, stars, lenSec}
        cursor: 0,
        skips: new Set(),            // usernames who typed !skip for the current map
        advancing: false,
        closed: false,
        mapTimer: null,
        idleTimer: null,
    };

    const say = (m) => channel.sendMessage(clamp(m, 400)).catch(() => {});

    const humanCount = () =>
        (lobby.slots || []).filter((s) => s && s.user && s.user.username !== BANCHO_USERNAME).length;

    const clearTimers = () => {
        if (st.mapTimer) { clearTimeout(st.mapTimer); st.mapTimer = null; }
        if (st.idleTimer) { clearTimeout(st.idleTimer); st.idleTimer = null; }
    };

    async function closeLobby(reason) {
        if (st.closed) return;
        st.closed = true;
        clearTimers();
        console.log(`[lobby ${req.id}] closing (${reason})`);
        try { await say(`Closing the lobby — ${reason}. Thanks for playing!`); } catch { /* ignore */ }
        try { await lobby.closeLobby(); } catch (e) { console.warn(`[lobby ${req.id}] closeLobby: ${e.message}`); }
        await patchRequest(req.id, { status: 'done' });
        await setStatus(req.id, { state: 'closed', reason });
    }

    function armIdleClose() {
        if (st.idleTimer) return;
        st.idleTimer = setTimeout(() => {
            if (humanCount() === 0) closeLobby('empty');
        }, Number(LOBBY_IDLE_CLOSE_MS));
    }

    async function setCurrentMap() {
        if (st.closed) return;
        st.skips.clear();
        st.advancing = false;
        const m = st.queue[st.cursor % st.queue.length];
        const pos = (st.cursor % st.queue.length) + 1;
        try {
            await lobby.setMap(m.beatmapId);
        } catch (e) {
            console.warn(`[lobby ${req.id}] setMap ${m.beatmapId}: ${e.message} — skipping`);
            return advance('unplayable');
        }
        const bits = [`(${pos}/${st.queue.length})`, m.title || `#${m.beatmapId}`];
        if (m.stars) bits.push(`${Number(m.stars).toFixed(2)}★`);
        say(bits.join('  '));
        await setStatus(req.id, { state: 'playing', currentMap: m.title || `#${m.beatmapId}`, mapIndex: pos });

        if (st.mapTimer) clearTimeout(st.mapTimer);
        st.mapTimer = setTimeout(() => advance('timeout'), Number(MAP_TIMEOUT_MS));
    }

    async function advance(why) {
        if (st.closed || st.advancing) return;
        st.advancing = true;
        if (st.mapTimer) { clearTimeout(st.mapTimer); st.mapTimer = null; }
        st.cursor += 1;
        if (why && why !== 'finished') console.log(`[lobby ${req.id}] advance (${why})`);
        await setCurrentMap();
    }

    /* -- lobby events -- */
    lobby.on('playerJoined', (p) => {
        if (st.idleTimer) { clearTimeout(st.idleTimer); st.idleTimer = null; }
        const u = p && p.player && p.player.user && p.player.user.username;
        if (u && u !== BANCHO_USERNAME) console.log(`[lobby ${req.id}] + ${u} (${humanCount()} in)`);
    });
    lobby.on('playerLeft', () => {
        if (humanCount() === 0) armIdleClose();
    });
    lobby.on('allPlayersReady', () => {
        if (!st.closed && humanCount() > 0) {
            lobby.startMatch(5).catch((e) => console.warn(`[lobby ${req.id}] startMatch: ${e.message}`));
        }
    });
    lobby.on('matchFinished', () => advance('finished'));
    lobby.on('matchAborted', () => { /* host can retry — leave the map as is */ });

    /* -- chat commands -- */
    channel.on('message', async (msg) => {
        if (!msg || msg.self) return;
        const from = msg.user && msg.user.username;
        if (!from || from === BANCHO_USERNAME || from === 'BanchoBot') return;
        const text = String(msg.message || '').trim();
        if (!text.startsWith('!')) return;
        const [cmd, arg] = text.slice(1).split(/\s+/, 2);

        switch (cmd.toLowerCase()) {
            case 'skip': {
                st.skips.add(from);
                const need = Math.max(1, Math.ceil(humanCount() / 2));
                if (from === req.osuUsername || st.skips.size >= need) {
                    say('Skipping.');
                    advance('skip');
                } else {
                    say(`Skip: ${st.skips.size}/${need}`);
                }
                break;
            }
            case 'next':
                if (from === req.osuUsername) { say('Next map.'); advance('host-next'); }
                break;
            case 'shuffle':
                if (from === req.osuUsername) {
                    st.queue = shuffled(st.queue);
                    st.cursor = 0;
                    say('Shuffled the queue.');
                    setCurrentMap();
                }
                break;
            case 'info': {
                const m = st.queue[st.cursor % st.queue.length];
                say(`Now: ${m.title || `#${m.beatmapId}`}${m.stars ? `  ${Number(m.stars).toFixed(2)}★` : ''}  ·  ${st.queue.length} maps  ·  https://osu.ppy.sh/b/${m.beatmapId}`);
                break;
            }
            case 'queue':
            case 'list': {
                const start = st.cursor % st.queue.length;
                const upcoming = [];
                for (let k = 1; k <= 3; k++) upcoming.push(st.queue[(start + k) % st.queue.length].title || `#${st.queue[(start + k) % st.queue.length].beatmapId}`);
                say(`Next: ${upcoming.join('  |  ')}`);
                break;
            }
            case 'close':
                if (from === req.osuUsername) closeLobby('host closed');
                break;
            default:
                break;
        }
    });

    lobby.channel.on('PART', (member) => {
        // the bot itself was removed / lobby died
        if (member && member.user && member.user.username === BANCHO_USERNAME) {
            clearTimers();
            if (!st.closed) {
                st.closed = true;
                patchRequest(req.id, { status: 'done' });
                setStatus(req.id, { state: 'closed', reason: 'lobby ended' });
            }
        }
    });

    /* -- go -- */
    await say(`Welcome ${req.osuUsername}! ${st.queue.length} maps queued from your collection.  !skip · !next (host) · !shuffle (host) · !info · !close (host)`);
    armIdleClose();          // in case nobody ever joins
    await setCurrentMap();
}

/* ---------- boot ---------- */
(async () => {
    await connectWithRetry();
    pollForever();
})();

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e && (e.stack || e.message)));
process.on('SIGINT', () => { console.log('bye'); process.exit(0); });
process.on('SIGTERM', () => process.exit(0));
