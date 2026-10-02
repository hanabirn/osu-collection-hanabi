/* 讓函式「打自己」的 fetch 直接在同一個 Worker 裡執行。
 *
 * 有些函式（主要是 Discord bot：discord-interactions.js）會用
 * fetch(`${origin}/.netlify/functions/<name>`) 去讀網站其他端點的資料。
 * 在 Netlify 上那是另一個函式；在 Worker 上 origin 就是自己，走網路等於
 * Worker 打自己——多一趟往返、可能被當成迴圈擋掉，也繞過了同一份 env。
 * 這裡把全域 fetch 再包一層：網址的主機是這個請求自己的主機、路徑是
 * /.netlify/functions/<name>，而且 ROUTES 有這個名字，就直接呼叫那個
 * 函式（同一個 runWithEnv 情境，env/ctx 都還在）；其他一律照舊。
 * 要裝在 osu-relay-fetch 之後，打 osu.ppy.sh 的請求才會繼續走轉送站。
 */
const { getRequestHost } = require('../netlify/functions/_cf-env');

const FN_PREFIX = '/.netlify/functions/';

function install(routes) {
    const outer = globalThis.fetch;
    if (outer.__internalFetch) return;

    async function internalFetch(input, init) {
        const host = getRequestHost();
        if (host) {
            let req;
            try {
                req = new Request(input, init);
            } catch {
                return outer(input, init);
            }
            const url = new URL(req.url);
            if (url.host === host && url.pathname.startsWith(FN_PREFIX)) {
                const name = url.pathname.slice(FN_PREFIX.length).replace(/\/$/, '');
                const fn = routes[name];
                if (fn) return fn(req, url);
            }
        }
        return outer(input, init);
    }

    internalFetch.__internalFetch = true;
    globalThis.fetch = internalFetch;
}

module.exports = { install };
