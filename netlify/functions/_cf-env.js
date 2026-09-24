/* Cloudflare Workers 的 env 傳遞。
 *
 * Netlify 的 Lambda 函式從 process.env 拿所有東西，但 Workers 的
 * KV/R2 繫結只存在於 fetch(request, env, ctx) 的 env 參數裡，拿不到全域。
 * 這 75 個函式的簽名是 exports.handler = async (event)，沒有第二個參數，
 * 所以 env 必須另外傳進去。
 *
 * 用 AsyncLocalStorage 而不是模組層變數：同一個 isolate 可能同時處理多個
 * 請求，模組層變數會互相蓋掉。ALS 讓每個請求看到自己的 env。
 *
 * 在 Netlify 上這個模組不會被呼叫（getEnv() 回 null），_blobs-store.js
 * 就走原本的 Netlify Blobs 路徑，舊站因此仍可正常部署，是遷移期的退路。
 */
let als = null;
try {
    // eslint-disable-next-line n/no-unsupported-features/node-builtins
    const { AsyncLocalStorage } = require('node:async_hooks');
    als = new AsyncLocalStorage();
} catch {
    als = null;
}

/* Workers 上呼叫；handler 在這個 callback 裡跑，期間 getEnv() 拿得到 env。 */
function runWithEnv(env, ctx, fn) {
    if (!als) return fn();
    return als.run({ env, ctx }, fn);
}

function getEnv() {
    return als?.getStore()?.env ?? null;
}

/* ctx.waitUntil：Workers 用來在回應送出後繼續跑背景工作。
   Netlify 上沒有，回 null，呼叫端需自行判斷。 */
function getCtx() {
    return als?.getStore()?.ctx ?? null;
}

const onCloudflare = () => getEnv() != null;

module.exports = { runWithEnv, getEnv, getCtx, onCloudflare };
