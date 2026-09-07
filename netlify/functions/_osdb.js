/* Server-side .osdb builder — a port of buildOsdb() in js/osu.js (Piotrekol's
   Collection Manager "o!dm8" format) for the Discord bot's export commands.
   Uses Node's zlib instead of the browser's fflate; byte layout is identical
   so files round-trip through Collection Manager the same as the site's own
   export. See js/osu.js ~L1443 for the format notes. */
const zlib = require('zlib');

const OSDB_WRITE_VERSION = 'o!dm8';
const MODE_INT = { osu: 0, standard: 0, taiko: 1, catch: 2, fruits: 2, mania: 3 };

function u8(arr) { return Uint8Array.from(arr); }

function writeUleb128(bytes, value) {
    do {
        let byte = value & 0x7f;
        value >>>= 7;
        if (value !== 0) byte |= 0x80;
        bytes.push(byte);
    } while (value !== 0);
}
function writeInt32LE(bytes, value) {
    bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff);
}
function writeNetString(bytes, str) {
    const utf8 = str ? Buffer.from(String(str), 'utf8') : Buffer.alloc(0);
    writeUleb128(bytes, utf8.length);
    for (let i = 0; i < utf8.length; i++) bytes.push(utf8[i]);
}
function writeFloat64LE(bytes, value) {
    const b = Buffer.alloc(8);
    b.writeDoubleLE(Number(value) || 0, 0);
    for (let i = 0; i < 8; i++) bytes.push(b[i]);
}

/* collections: [{ name, onlineId?, beatmaps: [{ mapId, mapSetId, artist,
   title, diff, md5, mode, stars }] }] -> Uint8Array (gzip payload with an
   uncompressed leading version string). */
function buildOsdb(collections, editor) {
    const p = [];
    writeNetString(p, OSDB_WRITE_VERSION);
    writeFloat64LE(p, Date.now() / 86400000 + 25569); // OLE Automation date
    writeNetString(p, editor || 'osu! Collection');
    writeInt32LE(p, collections.length);
    for (const c of collections) {
        writeNetString(p, c.name || '');
        writeInt32LE(p, Number.isInteger(c.onlineId) ? c.onlineId : -1);
        const maps = c.beatmaps || [];
        writeInt32LE(p, maps.length);
        for (const m of maps) {
            writeInt32LE(p, m.mapId || 0);
            writeInt32LE(p, m.mapSetId || 0);
            writeNetString(p, m.artist || '');
            writeNetString(p, m.title || '');
            writeNetString(p, m.diff || '');
            writeNetString(p, m.md5 || '');
            writeNetString(p, '');                       // user comment
            const mode = typeof m.mode === 'number' ? m.mode : (MODE_INT[m.mode] || 0);
            p.push(mode & 0xff);
            writeFloat64LE(p, m.stars || 0);
        }
        writeInt32LE(p, 0);                              // hash-only beatmap count
    }
    writeNetString(p, 'By Piotrekol');

    const gz = zlib.gzipSync(Buffer.from(u8(p)));
    const head = [];
    writeNetString(head, OSDB_WRITE_VERSION);
    return Buffer.concat([Buffer.from(u8(head)), gz]);
}

module.exports = { buildOsdb, MODE_INT };
