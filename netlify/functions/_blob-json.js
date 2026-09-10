/* gzip'd-JSON helpers for the big Netlify Blobs datasets.
 *
 * Why: the Farm Maps `dataset:{mode}` blob (osu ~33 MB uncompressed) can't
 * finish uploading inside a scheduled function's 30 s hard timeout, so the
 * write gets killed and the dataset silently stops persisting — see
 * _farm-crawl-core.js. JSON here compresses ~5-6x, which puts the write
 * comfortably back inside the window. catalog:all gets the same treatment.
 *
 * Format: a raw gzip stream (magic bytes 1f 8b). getJSONGz falls back to
 * plain UTF-8 JSON when the blob isn't gzip, so:
 *   - existing plain blobs keep reading during the transition, and
 *   - a mode whose gzip write still fails stays readable as its last plain
 *     value until a gzip write finally lands.
 *
 * @netlify/blobs v10 set() accepts `string | ArrayBuffer | Blob` — NOT a Node
 * Buffer — so the gzip Buffer is wrapped in a Blob.
 */
const { gzipSync, gunzipSync } = require('node:zlib');

async function setJSONGz(store, key, value) {
    const gz = gzipSync(Buffer.from(JSON.stringify(value)));
    await store.set(key, new Blob([gz]));
}

async function getJSONGz(store, key) {
    const ab = await store.get(key, { type: 'arrayBuffer' });
    if (ab == null) return null;
    const buf = Buffer.from(ab);
    if (buf.length === 0) return null;
    const isGzip = buf[0] === 0x1f && buf[1] === 0x8b;
    const json = isGzip ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
    return JSON.parse(json);
}

module.exports = { setJSONGz, getJSONGz };
