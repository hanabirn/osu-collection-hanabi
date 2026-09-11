/* Resolves a usable osu! bearer token for a logged-in user, refreshing it
   from the stored (encrypted) refresh_token if the access_token is near
   expiry. Used only by replay-download.js — this is the one place that
   needs to act as the user against osu!'s API, rather than as the site's
   own client_credentials app (_osu-auth.js). */
const { getAuthStore } = require('./_blobs-store');
const { encrypt, decrypt } = require('./_token-crypto');

class ReplayAuthError extends Error {
    constructor(code, message) {
        super(message || code);
        this.code = code; // 'not_logged_in' | 'revoked'
    }
}

async function getValidUserAccessToken(userId) {
    const store = getAuthStore();
    const key = `user-token:${userId}`;
    const record = await store.get(key, { type: 'json' });
    if (!record) throw new ReplayAuthError('not_logged_in', 'No stored osu! token for this user');

    if (Date.now() < record.expires_at) {
        return decrypt(record.access_token);
    }

    // Access token expired — refresh it.
    let refreshed;
    try {
        const form = new URLSearchParams({
            client_id: process.env.OSU_REPLAY_CLIENT_ID,
            client_secret: process.env.OSU_REPLAY_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: decrypt(record.refresh_token),
        });
        const res = await fetch('https://osu.ppy.sh/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: form.toString(),
        });
        if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
        refreshed = await res.json();
    } catch (err) {
        // Refresh token itself may have been revoked (user disconnected the
        // app on osu!'s end) — clear the stale record so we don't keep
        // retrying a dead token, and ask for a fresh login.
        await store.delete(key).catch(() => {});
        throw new ReplayAuthError('revoked', err.message);
    }

    await store.setJSON(key, {
        access_token: encrypt(refreshed.access_token),
        refresh_token: encrypt(refreshed.refresh_token),
        expires_at: Date.now() + (refreshed.expires_in - 60) * 1000,
        updatedAt: new Date().toISOString(),
    });
    return refreshed.access_token;
}

module.exports = { getValidUserAccessToken, ReplayAuthError };
