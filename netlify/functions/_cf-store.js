/* Netlify Blobs 的 API 替身，底層換成 Cloudflare KV 與 R2。
 *
 * 目的是讓那 75 個函式一行都不用改：它們拿到的物件方法名稱、參數、
 * 回傳值都與 @netlify/blobs 的 store 相同。實際盤點過整個 codebase，
 * 只用到這 6 個方法：
 *   get(key, {type:'json'|'text'|'arrayBuffer'})  94 處
 *   setJSON(key, value)                           61 處
 *   set(key, value, {metadata})                   15 處
 *   delete(key)                                   10 處
 *   list()                                         1 處（push-cron.js）
 *   getWithMetadata(key, {type})                   1 處（chat-media.js）
 * 沒用到的（getMetadata、list 的分頁選項、條件寫入等）就不實作，
 * 免得寫出沒被驗證過的程式碼。
 *
 * KV vs R2 的分法：小型 JSON 走 KV（讀取快、免費額度大），大型資料集與
 * 二進位走 R2（KV 單值上限 25 MiB，dataset:osu 已經 14.2 MiB 且會長大）。
 *
 * ⚠️ 位元組正確性：dataset:* 與 catalog:all 存的是 raw gzip 串流
 * （見 _blob-json.js）。任何經過字串的路徑都會被 UTF-8 解碼破壞——
 * 備份時實測過，53 MiB 的壞資料 vs 32 MiB 的正確資料。所以
 * arrayBuffer 一律走原始位元組，set() 直接把 ArrayBuffer/Buffer 交給底層。
 */
const { getEnv } = require('./_cf-env');

/* Netlify 的 get() 預設是 'text'，這裡保持一致。 */
const DEFAULT_TYPE = 'text';

function decodeKvType(type) {
    if (type === 'json') return 'json';
    if (type === 'arrayBuffer') return 'arrayBuffer';
    return 'text';
}

/* ---------- KV 後端 ---------- */
function kvStore(ns) {
    return {
        async get(key, opts) {
            const type = decodeKvType(opts?.type ?? DEFAULT_TYPE);
            return await ns.get(key, type);
        },

        async getWithMetadata(key, opts) {
            const type = decodeKvType(opts?.type ?? DEFAULT_TYPE);
            const res = await ns.getWithMetadata(key, type);
            if (res?.value == null) return null;
            /* Netlify 回的是 { data, metadata, etag }，欄位名是 data 不是 value */
            return { data: res.value, metadata: res.metadata ?? {}, etag: undefined };
        },

        async set(key, value, opts) {
            const metadata = opts?.metadata;
            await ns.put(key, await toKvValue(value), metadata ? { metadata } : undefined);
        },

        async setJSON(key, value) {
            await ns.put(key, JSON.stringify(value));
        },

        async delete(key) {
            await ns.delete(key);
        },

        async list() {
            /* KV 的 list 一頁最多 1000 筆，要自己翻頁翻完，
               否則訂閱者一多 push-cron 就會漏發。 */
            const blobs = [];
            let cursor;
            for (;;) {
                const page = await ns.list(cursor ? { cursor } : undefined);
                for (const k of page.keys) blobs.push({ key: k.name, etag: undefined });
                if (page.list_complete) break;
                cursor = page.cursor;
                if (!cursor) break;
            }
            return { blobs, directories: [] };
        },
    };
}

/* KV 的 put 接受 string / ArrayBuffer / ReadableStream，不吃 Node Buffer
   與 Blob，所以先正規化。 */
async function toKvValue(value) {
    if (typeof value === 'string') return value;
    if (value instanceof ArrayBuffer) return value;
    if (typeof Blob !== 'undefined' && value instanceof Blob) return await value.arrayBuffer();
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
        return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    }
    if (ArrayBuffer.isView(value)) {
        return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    }
    return String(value);
}

/* ---------- R2 後端 ---------- */
function r2Store(bucket) {
    return {
        async get(key, opts) {
            const obj = await bucket.get(key);
            if (obj == null) return null;
            const type = opts?.type ?? DEFAULT_TYPE;
            if (type === 'json') return await obj.json();
            if (type === 'arrayBuffer') return await obj.arrayBuffer();
            return await obj.text();
        },

        async getWithMetadata(key, opts) {
            const obj = await bucket.get(key);
            if (obj == null) return null;
            const type = opts?.type ?? DEFAULT_TYPE;
            const data =
                type === 'json'
                    ? await obj.json()
                    : type === 'arrayBuffer'
                      ? await obj.arrayBuffer()
                      : await obj.text();
            return { data, metadata: obj.customMetadata ?? {}, etag: obj.etag };
        },

        async set(key, value, opts) {
            const metadata = opts?.metadata;
            await bucket.put(key, await toR2Value(value), {
                customMetadata: metadata ? stringifyMetadata(metadata) : undefined,
            });
        },

        async setJSON(key, value) {
            await bucket.put(key, JSON.stringify(value));
        },

        async delete(key) {
            await bucket.delete(key);
        },

        async list() {
            const blobs = [];
            let cursor;
            for (;;) {
                const page = await bucket.list(cursor ? { cursor } : undefined);
                for (const o of page.objects) blobs.push({ key: o.key, etag: o.etag });
                if (!page.truncated) break;
                cursor = page.cursor;
                if (!cursor) break;
            }
            return { blobs, directories: [] };
        },
    };
}

async function toR2Value(value) {
    if (typeof value === 'string') return value;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
        return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    }
    return value; // ArrayBuffer / Blob / TypedArray，R2 都直接吃
}

/* R2 的 customMetadata 只收字串值，Netlify 的 metadata 可以放任意 JSON 值，
   所以非字串一律轉成字串（目前唯一用到的是 chat-upload 的
   { mime, authorId, createdAt }，本來就都是字串）。 */
function stringifyMetadata(metadata) {
    const out = {};
    for (const [k, v] of Object.entries(metadata)) {
        out[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    return out;
}

/* ---------- store 名稱 -> 繫結 ---------- */
const KV_BINDINGS = {
    'osu-public-collections': 'KV_COLLECTIONS',
    'osu-chat': 'KV_CHAT',
    'osu-dm': 'KV_DM',
    'osu-gallery-comments': 'KV_GALLERY_COMMENTS',
    'osu-community-mappools': 'KV_COMMUNITY_MAPPOOLS',
    'osu-wc-mappools': 'KV_WC_MAPPOOLS',
    'osu-games': 'KV_GAMES',
    'osu-discord-bot': 'KV_DISCORD_BOT',
    'osu-site-stats': 'KV_SITE_STATS',
    'osu-push-subs': 'KV_PUSH_SUBS',
};

const R2_BINDINGS = {
    'osu-catalog': 'R2_CATALOG',
    'osu-farm-maps': 'R2_FARM_MAPS',
    'osu-chat-media': 'R2_CHAT_MEDIA',
    'osu-skin-backups': 'R2_SKIN_BACKUPS',
    'osu-skin-screenshots': 'R2_SKIN_SCREENSHOTS',
};

/* 給 _blobs-store.js / _push-store.js 呼叫：回傳與 Netlify store 同介面的物件。 */
function getCloudflareStore(name) {
    const env = getEnv();
    if (!env) return null;

    const kvBinding = KV_BINDINGS[name];
    if (kvBinding) {
        const ns = env[kvBinding];
        if (!ns) throw new Error(`缺少 KV 繫結 ${kvBinding}（store: ${name}）`);
        return kvStore(ns);
    }

    const r2Binding = R2_BINDINGS[name];
    if (r2Binding) {
        const bucket = env[r2Binding];
        if (!bucket) throw new Error(`缺少 R2 繫結 ${r2Binding}（store: ${name}）`);
        return r2Store(bucket);
    }

    throw new Error(`未知的 store 名稱: ${name}`);
}

module.exports = { getCloudflareStore, KV_BINDINGS, R2_BINDINGS };
