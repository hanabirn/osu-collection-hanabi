/* Publishes one screenshot to the public skin screenshot plaza — see
   js/skin-screenshots.js. Unlike collections-publish.js (one entry per
   user, overwritten on republish), a user can publish many screenshots, so
   this always creates a new entry rather than updating one. Requires a
   verified osu! login (_auth-token.js) purely as an accountability check —
   this site has no moderation/admin panel, so "who uploaded this" being
   traceable to a real osu! account (rather than fully anonymous) is the
   only abuse deterrent in place.

   A screenshot must come with a way to actually get the skin — either an
   external downloadUrl the publisher provides, or the .osk file itself
   uploaded straight to this store (see skin-screenshots-download.js).
   Hosting the file ourselves does carry redistribution/copyright exposure
   an external link doesn't (this is publishing whatever the uploader
   handed us, not just linking to where they got it), which is why it's
   capped hard at MAX_OSK_BYTES rather than sized for real skins (which
   commonly run 10-200+ MB, same caveat as skins-upload.js) — a skin that
   doesn't fit is expected to use a downloadUrl instead. Both the
   screenshot image and the .osk (when present) travel in the same
   request, so their two size caps are kept low enough that even both at
   once, base64-inflated, stay under Netlify Functions' ~6MB body ceiling. */
const crypto = require('crypto');
const { getSkinScreenshotsStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');

const OSU_MODES = ['standard', 'taiko', 'catch', 'mania'];
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const MAX_OSK_BYTES = 2.5 * 1024 * 1024;
const MAX_BODY_BYTES = 5.5 * 1024 * 1024;
const MAX_SCREENSHOTS_PER_USER = 20;
const MAX_NAME_LEN = 100;
const MAX_URL_LEN = 300;
const MAX_FILENAME_LEN = 150;

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const user = verifyAuthToken(token);
    if (!user) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired login, please log in again' }) };
    }

    if (!event.body || Buffer.byteLength(event.body) > MAX_BODY_BYTES) {
        return { statusCode: 413, headers, body: JSON.stringify({ error: 'Request too large' }) };
    }

    let body;
    try {
        body = JSON.parse(event.body);
    } catch {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const skinName = typeof body.skinName === 'string' ? body.skinName.trim().slice(0, MAX_NAME_LEN) : '';
    const author = typeof body.author === 'string' ? body.author.trim().slice(0, MAX_NAME_LEN) : '';
    const downloadUrl = typeof body.downloadUrl === 'string' ? body.downloadUrl.trim().slice(0, MAX_URL_LEN) : '';
    const mode = OSU_MODES.includes(body.mode) ? body.mode : 'standard';
    const dataBase64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : '';
    const width = Number.isFinite(body.width) && body.width > 0 ? Math.round(body.width) : null;
    const height = Number.isFinite(body.height) && body.height > 0 ? Math.round(body.height) : null;
    const oskDataBase64 = typeof body.oskDataBase64 === 'string' ? body.oskDataBase64 : '';
    const oskFilename = typeof body.oskFilename === 'string' ? body.oskFilename.trim().slice(0, MAX_FILENAME_LEN) : '';

    if (!skinName || !dataBase64) {
        return { statusCode: 422, headers, body: JSON.stringify({ error: 'Missing skin name or screenshot data' }) };
    }
    if (!downloadUrl && !oskDataBase64) {
        return { statusCode: 422, headers, body: JSON.stringify({ error: 'Provide a download link or upload the .osk file' }) };
    }
    if (downloadUrl && !/^https?:\/\//i.test(downloadUrl)) {
        return { statusCode: 422, headers, body: JSON.stringify({ error: 'Download link must start with http:// or https://' }) };
    }

    let buffer;
    try {
        buffer = Buffer.from(dataBase64, 'base64');
    } catch {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid image data' }) };
    }
    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
        return { statusCode: 413, headers, body: JSON.stringify({ error: `Screenshot exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit` }) };
    }
    // JPEG magic bytes (FF D8 FF) — the client always re-encodes to JPEG
    // before sending (see js/skin-screenshots.js), so this is a cheap sanity
    // check that the bytes are actually what they claim to be, not a real
    // content-sniffing/validation layer.
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
        return { statusCode: 422, headers, body: JSON.stringify({ error: 'Screenshot must be a JPEG image' }) };
    }

    let oskBuffer = null;
    if (oskDataBase64) {
        if (!oskFilename) {
            return { statusCode: 422, headers, body: JSON.stringify({ error: 'Missing .osk filename' }) };
        }
        try {
            oskBuffer = Buffer.from(oskDataBase64, 'base64');
        } catch {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid .osk file data' }) };
        }
        if (oskBuffer.length === 0 || oskBuffer.length > MAX_OSK_BYTES) {
            return { statusCode: 413, headers, body: JSON.stringify({ error: `.osk file exceeds the ${MAX_OSK_BYTES / 1024 / 1024}MB limit — use a download link instead for larger skins` }) };
        }
        // .osk is a plain zip archive — "PK" is the local-file-header magic
        // every zip (empty or not) starts with, same cheap-sanity-check
        // philosophy as the JPEG check above.
        if (oskBuffer[0] !== 0x50 || oskBuffer[1] !== 0x4b) {
            return { statusCode: 422, headers, body: JSON.stringify({ error: 'File must be a valid .osk (zip) skin file' }) };
        }
    }

    try {
        const store = getSkinScreenshotsStore();
        const owned = (await store.get(`owner:${user.id}`, { type: 'json' })) || [];
        if (owned.length >= MAX_SCREENSHOTS_PER_USER) {
            return { statusCode: 413, headers, body: JSON.stringify({ error: `Exceeds the ${MAX_SCREENSHOTS_PER_USER}-screenshot limit` }) };
        }

        const id = crypto.randomUUID();
        const uploadedAt = new Date().toISOString();
        await store.set(`image:${id}`, buffer);
        if (oskBuffer) await store.set(`osk:${id}`, oskBuffer);

        const entry = {
            id, skinName, author, downloadUrl, mode,
            userId: user.id, username: user.username,
            uploadedAt, likeCount: 0, width, height,
            oskFilename: oskBuffer ? oskFilename : null,
        };

        const index = (await store.get('index', { type: 'json' })) || [];
        index.push(entry);
        await store.setJSON('index', index);

        owned.push(id);
        await store.setJSON(`owner:${user.id}`, owned);

        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, item: entry }) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
