/* 從 dataset:<mode> 衍生出來的精簡切片，給 games-hilo 用。
 *
 * 為什麼需要：games-hilo 原本讀整包 dataset:osu（14.2 MiB gzip →
 * 46.8 MiB JSON、45,553 筆），解壓 + 解析 + 對全部資料洗牌，只為了回傳
 * 60 筆。在 Netlify 上還撐得住，但 Cloudflare Workers 免費版每個請求
 * 只有 10ms CPU，實測 8 次有 7 次回 error 1102（超過資源上限）。
 *
 * 做法：爬蟲寫完 dataset 後，額外寫出「只含 games-hilo 需要的 11 個欄位」
 * 的切片。單筆從約 1,030 bytes 降到約 185 bytes（省 83%），再依
 * SHARD_SIZE 切開，每片約 92 KB。games-hilo 只讀其中一片，解析成本
 * 從 46.8 MB 降到 0.09 MB。
 *
 * 切片不壓縮：92 KB 的 gzip 解壓雖然便宜，但在 10ms 的預算下能省則省，
 * 而 R2 有 10 GB 免費空間，四個模式全部切片也才約 34 MB。
 */

/* 每片筆數。500 × 約 185 bytes ≈ 92 KB，解析約 1ms；
   而 games-hilo 一次只需要 60 筆，單片的樣本數綽綽有餘。 */
const SHARD_SIZE = 500;

const hiloMetaKey = (mode) => `hilo:${mode}:meta`;
const hiloShardKey = (mode, index) => `hilo:${mode}:${index}`;

/* 與 games-hilo 原本的篩選與欄位投影完全一致，
   差別只在於這裡是預先算好，而不是每次請求現算。 */
function toHiloRecord(r) {
    const sr = r.stars && Number.isFinite(r.stars.NM) ? r.stars.NM : null;
    const pp = r.pp && Number.isFinite(r.pp.NM) ? r.pp.NM : null;
    const plays = (r.farmSignal && r.farmSignal.playcount) || 0;
    if (!r.beatmapset_id || !r.title || !r.bpm || !r.total_length || sr == null || pp == null || plays <= 0) {
        return null;
    }
    return {
        setId: r.beatmapset_id,
        bid: r.beatmap_id || null,
        artist: r.artist || '',
        title: r.title || '',
        creator: r.creator || '',
        version: r.version || '',
        sr: Math.round(sr * 100) / 100,
        bpm: Math.round(r.bpm),
        len: r.total_length,
        pp: Math.round(pp),
        plays,
    };
}

function buildHiloShards(dataset) {
    const pool = [];
    for (const r of dataset) {
        const rec = toHiloRecord(r);
        if (rec) pool.push(rec);
    }

    /* 先整體洗一次牌再切片：否則每一片都會是原本資料集的順序
       （大致按星數/上架時間聚集），同一片裡的曲目會過於相似。
       洗過之後任一片都是全域的隨機樣本。 */
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const shards = [];
    for (let i = 0; i < pool.length; i += SHARD_SIZE) {
        shards.push(pool.slice(i, i + SHARD_SIZE));
    }
    return { shards, poolSize: pool.length };
}

/* 寫出一個模式的全部切片與 meta。呼叫端負責提供 store。 */
async function writeHiloShards(store, mode, dataset) {
    const { shards, poolSize } = buildHiloShards(dataset);

    for (let i = 0; i < shards.length; i++) {
        await store.setJSON(hiloShardKey(mode, i), shards[i]);
    }

    await store.setJSON(hiloMetaKey(mode), {
        shardCount: shards.length,
        shardSize: SHARD_SIZE,
        poolSize,
        builtAt: new Date().toISOString(),
    });

    return { shardCount: shards.length, poolSize };
}

module.exports = { SHARD_SIZE, hiloMetaKey, hiloShardKey, buildHiloShards, writeHiloShards, toHiloRecord };
