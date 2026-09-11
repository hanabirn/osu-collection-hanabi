/* Publishes one skin to the public catalog — anyone can upload, anyone can
   download (see skins-list.js / skins-download.js), matching
   mania-tracker.com's own skins page. This is deliberately NOT the same
   shape as the main osu-collection site's skins-upload.js (a private,
   login-gated per-user cloud *backup* nobody else can see) — this is a
   public community catalog, closer in spirit to that site's
   skin-screenshots-upload.js (a public plaza), except that one requires a
   verified osu! login for accountability and this one doesn't.

   No login gate here: building osu! OAuth into this site just for upload
   accountability was judged not worth it for a small companion site (see
   conversation) — uploads are anonymous aside from a free-text display
   name the uploader provides. That's a real, accepted trade-off (weaker
   abuse deterrence than the main site's login-gated equivalents), offset
   by: a hard per-file size cap, a cheap zip-magic-byte sanity check, and a
   global catalog-size ceiling so an anonymous flood can't run away with
   this site's Blobs storage. There's no moderation panel — if abuse
   becomes a real problem, revisit this rather than patch around it. */
const crypto = require('crypto');
const { getSkinsStore } = require('./_blobs-store');

const MAX_OSK_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const MAX_NAME_LEN = 100;
const MAX_UPLOADER_LEN = 60;
const MAX_TOTAL_SKINS = 500;

exports.handler = async (event) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
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

    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME_LEN) : '';
    const uploaderName = typeof body.uploaderName === 'string' ? body.uploaderName.trim().slice(0, MAX_UPLOADER_LEN) : '';
    const oskBase64 = typeof body.oskBase64 === 'string' ? body.oskBase64 : '';
    const previewBase64 = typeof body.previewBase64 === 'string' ? body.previewBase64 : '';

    if (!name || !oskBase64) {
        return { statusCode: 422, headers, body: JSON.stringify({ error: 'Missing skin name or .osk file' }) };
    }

    let oskBuffer;
    try {
        oskBuffer = Buffer.from(oskBase64, 'base64');
    } catch {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid file data' }) };
    }
    if (oskBuffer.length === 0 || oskBuffer.length > MAX_OSK_BYTES) {
        return { statusCode: 413, headers, body: JSON.stringify({ error: `.osk file exceeds the ${MAX_OSK_BYTES / 1024 / 1024}MB limit` }) };
    }
    // .osk is a plain zip archive — "PK" is the local-file-header magic
    // every zip starts with. A cheap sanity check, not real validation.
    if (oskBuffer[0] !== 0x50 || oskBuffer[1] !== 0x4b) {
        return { statusCode: 422, headers, body: JSON.stringify({ error: 'File must be a valid .osk (zip) skin file' }) };
    }

    let previewBuffer = null;
    if (previewBase64) {
        try {
            previewBuffer = Buffer.from(previewBase64, 'base64');
        } catch {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid preview image data' }) };
        }
        if (previewBuffer.length === 0 || previewBuffer.length > MAX_IMAGE_BYTES) {
            return { statusCode: 413, headers, body: JSON.stringify({ error: `Preview image exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit` }) };
        }
        // JPEG (FF D8 FF) or PNG (89 50 4E 47) — client is expected to send
        // one of these two; anything else is rejected rather than guessed at.
        const isJpeg = previewBuffer[0] === 0xff && previewBuffer[1] === 0xd8 && previewBuffer[2] === 0xff;
        const isPng = previewBuffer[0] === 0x89 && previewBuffer[1] === 0x50 && previewBuffer[2] === 0x4e && previewBuffer[3] === 0x47;
        if (!isJpeg && !isPng) {
            return { statusCode: 422, headers, body: JSON.stringify({ error: 'Preview image must be JPEG or PNG' }) };
        }
        previewBuffer._isPng = isPng; // stash for the content-type choice below
    }

    try {
        const store = getSkinsStore();
        const index = (await store.get('index', { type: 'json' })) || [];
        if (index.length >= MAX_TOTAL_SKINS) {
            return { statusCode: 413, headers, body: JSON.stringify({ error: 'The skin catalog is full — contact the site owner' }) };
        }

        const id = crypto.randomUUID();
        await store.set(`file:${id}`, oskBuffer);
        let previewType = null;
        if (previewBuffer) {
            previewType = previewBuffer._isPng ? 'image/png' : 'image/jpeg';
            await store.set(`preview:${id}`, previewBuffer);
        }

        const entry = {
            id, name, uploaderName: uploaderName || 'Anonymous',
            fileSize: oskBuffer.length,
            hasPreview: !!previewBuffer,
            previewType,
            downloadCount: 0,
            uploadedAt: new Date().toISOString(),
        };
        index.push(entry);
        await store.setJSON('index', index);

        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, item: entry }) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
