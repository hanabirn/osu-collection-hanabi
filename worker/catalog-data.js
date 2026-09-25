/* /.netlify/functions/catalog-data —— 把爬蟲產生的精簡曲庫（R2 的
 * catalog:lean，格式見 netlify/functions/_catalog-lean.js）原封不動交給瀏覽器，
 * 篩選、排序與分類計數都在 js/catalog.js 裡做。
 *
 * 為什麼不走一般的函式路徑：catalog-list 每次請求都要解壓並 JSON.parse 整份
 * 26 MB 的 catalog:all，約 150–230 ms CPU，而免費方案每個請求只給 10 ms，
 * 結果大多數請求都是 Error 1102（前端顯示「載入曲庫失敗」）。這裡只把 R2 的
 * 資料流直接接到回應上，不解壓、不解析，CPU 幾乎為零。也因此不能經過
 * adapter：adapter 會把 body 讀成字串，等於又把整份檔案過一遍。
 *
 * R2 裡存的已經是 gzip，所以回應標 Content-Encoding: gzip 並用
 * encodeBody: 'manual'，讓 Cloudflare 直接轉送、由瀏覽器自己解壓，不會被
 * 再壓一次。ETag 來自 R2，瀏覽器帶 If-None-Match 回來時 R2 的 onlyIf 會判斷，
 * 沒變就回 304，不重傳。
 *
 * ?meta=1 只回總數與爬蟲狀態（首頁 hero 的數字用），讀的是另一個很小的
 * catalog:meta，不碰那份 2.7 MB 的索引。 */
const LEAN_KEY = 'catalog:lean';
const META_KEY = 'catalog:meta';
const CACHE_CONTROL = 'public, max-age=300';

function json(body, status, extraHeaders) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
    });
}

async function serveCatalogData(request, env, url) {
    const bucket = env.R2_CATALOG;
    if (!bucket) return json({ error: 'missing R2_CATALOG binding' }, 500);

    if (url.searchParams.get('meta') === '1') {
        /* 幾百 bytes 的 JSON，原樣轉送，同樣不解析。 */
        const meta = await bucket.get(META_KEY);
        if (!meta) return json({ error: 'catalog not built yet' }, 404);
        return new Response(meta.body, {
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': CACHE_CONTROL },
        });
    }

    const obj = await bucket.get(LEAN_KEY, { onlyIf: request.headers });
    if (!obj) return json({ error: 'catalog not built yet' }, 404);

    const headers = new Headers({
        'Cache-Control': CACHE_CONTROL,
        ETag: obj.httpEtag,
        Vary: 'Accept-Encoding',
    });
    /* onlyIf 條件不成立時，R2 回的是沒有 body 的 R2Object：代表瀏覽器手上那份還是最新的。 */
    if (!('body' in obj) || !obj.body) return new Response(null, { status: 304, headers });

    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Content-Encoding', 'gzip');
    return new Response(obj.body, { headers, encodeBody: 'manual' });
}

module.exports = { serveCatalogData };
