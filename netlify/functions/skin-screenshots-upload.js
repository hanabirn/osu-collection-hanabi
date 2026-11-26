/* Publishes a skin to the public skin gallery (皮膚廣場) — see
   js/skin-screenshots.js. A user can publish many skins, so this always
   creates a new entry. Requires a verified osu! login (_auth-token.js) as an
   accountability check: entries go live at once (no review queue), and the
   site owner can remove them.

   Two kinds of request, so up to 8 screenshots never have to fit in one
   request body:
     POST ?part=image  { dataBase64 }            one screenshot (JPEG or WebP,
                                                 ≤ 1.5 MB) → { key }; kept as
                                                 image:{key} and listed under
                                                 staged:{userId} until used
     POST              { skinName, author, version, description, modes[],
                         aspect, images:[{key,w,h}], links[], oskDataBase64?,
                         oskFilename? }          the entry itself, built from
                                                 1–8 staged screenshots
   A skin needs a way to get it: one or more download links (Google Drive,
   MEGA, MediaFire…: any https link) and/or the .osk itself if it is small
   (≤ 2.5 MB; hosting files carries redistribution exposure a link doesn't,
   so real-sized skins are expected to use a link). */
const crypto = require('crypto');
const { getSkinScreenshotsStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');

const OSU_MODES = ['standard', 'taiko', 'catch', 'mania'];
const ASPECTS = ['16:9', '4:3', '16:10', '21:9'];
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const MAX_OSK_BYTES = 2.5 * 1024 * 1024;
const MAX_BODY_BYTES = 5.5 * 1024 * 1024;
const MAX_SKINS_PER_USER = 20;
const MAX_IMAGES = 8;
const MAX_STAGED = 24;
const MAX_LINKS = 5;
const MAX_NAME_LEN = 100;
const MAX_URL_LEN = 500;
const MAX_DESC_LEN = 1000;
const MAX_FILENAME_LEN = 150;

const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isWebp = (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

exports.handler = async (event) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
    if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const user = verifyAuthToken(token);
    if (!user) return reply(401, { error: 'Invalid or expired login, please log in again' });

    if (!event.body || Buffer.byteLength(event.body) > MAX_BODY_BYTES) return reply(413, { error: 'Request too large' });
    let body;
    try { body = JSON.parse(event.body); } catch { return reply(400, { error: 'Invalid JSON' }); }

    const store = getSkinScreenshotsStore();
    const qs = event.queryStringParameters || {};

    try {
        // ---- one screenshot ----
        if (qs.part === 'image') {
            let buffer;
            try { buffer = Buffer.from(typeof body.dataBase64 === 'string' ? body.dataBase64 : '', 'base64'); } catch { return reply(400, { error: 'Invalid image data' }); }
            if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return reply(413, { error: `Screenshot exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit` });
            if (!isJpeg(buffer) && !isWebp(buffer)) return reply(422, { error: 'Screenshot must be a JPEG or WebP image' });
            const key = crypto.randomUUID();
            await store.set(`image:${key}`, buffer);
            let staged = (await store.get(`staged:${user.id}`, { type: 'json' })) || [];
            staged.push(key);
            // an abandoned form's screenshots: the oldest go once there are too many
            while (staged.length > MAX_STAGED) { const old = staged.shift(); await store.delete(`image:${old}`); }
            await store.setJSON(`staged:${user.id}`, staged);
            return reply(200, { key });
        }

        // ---- the entry ----
        const skinName = str(body.skinName, MAX_NAME_LEN);
        const author = str(body.author, MAX_NAME_LEN);
        const version = str(body.version, 40);
        const description = str(body.description, MAX_DESC_LEN);
        const modes = [...new Set((Array.isArray(body.modes) ? body.modes : []).filter((m) => OSU_MODES.includes(m)))];
        const aspect = ASPECTS.includes(body.aspect) ? body.aspect : '';
        const links = [...new Set((Array.isArray(body.links) ? body.links : []).map((l) => str(l, MAX_URL_LEN)).filter(Boolean))].slice(0, MAX_LINKS);
        const oskDataBase64 = typeof body.oskDataBase64 === 'string' ? body.oskDataBase64 : '';
        const oskFilename = str(body.oskFilename, MAX_FILENAME_LEN);

        if (!skinName) return reply(422, { error: 'Missing skin name' });
        if (links.some((l) => !/^https:\/\//i.test(l) && !/^http:\/\//i.test(l))) return reply(422, { error: 'Download links must start with http:// or https://' });
        if (!links.length && !oskDataBase64) return reply(422, { error: 'Provide a download link or upload the .osk file' });

        const staged = (await store.get(`staged:${user.id}`, { type: 'json' })) || [];
        const images = (Array.isArray(body.images) ? body.images : []).slice(0, MAX_IMAGES)
            .filter((im) => im && typeof im.key === 'string' && staged.includes(im.key))
            .map((im) => ({ key: im.key, w: Number.isFinite(im.w) ? Math.round(im.w) : null, h: Number.isFinite(im.h) ? Math.round(im.h) : null }));
        if (!images.length) return reply(422, { error: 'Add at least one screenshot' });

        let oskBuffer = null;
        if (oskDataBase64) {
            if (!oskFilename) return reply(422, { error: 'Missing .osk filename' });
            try { oskBuffer = Buffer.from(oskDataBase64, 'base64'); } catch { return reply(400, { error: 'Invalid .osk file data' }); }
            if (!oskBuffer.length || oskBuffer.length > MAX_OSK_BYTES) return reply(413, { error: `.osk file exceeds the ${MAX_OSK_BYTES / 1024 / 1024}MB limit — use a download link instead for larger skins` });
            // .osk is a zip: "PK" is every zip's first two bytes
            if (oskBuffer[0] !== 0x50 || oskBuffer[1] !== 0x4b) return reply(422, { error: 'File must be a valid .osk (zip) skin file' });
        }

        const owned = (await store.get(`owner:${user.id}`, { type: 'json' })) || [];
        if (owned.length >= MAX_SKINS_PER_USER) return reply(413, { error: `Exceeds the ${MAX_SKINS_PER_USER}-skin limit` });

        const id = crypto.randomUUID();
        if (oskBuffer) await store.set(`osk:${id}`, oskBuffer);
        const entry = {
            id, v: 2, skinName, author, version, description,
            modes: modes.length ? modes : ['standard'], mode: modes[0] || 'standard', aspect,
            images, links, oskFilename: oskBuffer ? oskFilename : null,
            userId: user.id, username: user.username,
            uploadedAt: new Date().toISOString(), likeCount: 0, downloads: 0,
        };
        const index = (await store.get('index', { type: 'json' })) || [];
        index.push(entry);
        await store.setJSON('index', index);
        owned.push(id);
        await store.setJSON(`owner:${user.id}`, owned);
        const used = new Set(images.map((im) => im.key));
        await store.setJSON(`staged:${user.id}`, staged.filter((k) => !used.has(k)));

        return reply(200, { ok: true, item: entry });
    } catch (err) {
        return reply(500, { error: err.message });
    }
};
