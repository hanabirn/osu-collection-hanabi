/* Netlify Lambda 風格的 handler -> Cloudflare Workers 的 Request/Response。
 *
 * 那 67 個端點都是 exports.handler = async (event) => ({statusCode, headers, body})。
 * 實際盤點過整個 codebase 用到的欄位，只有這些：
 *   event: httpMethod(109) headers(78) body(35) queryStringParameters(34)
 *          path(2) rawUrl(1) isBase64Encoded(1)
 *   回傳: statusCode(426) body(441) headers(308) isBase64Encoded(8)
 * 沒用到的（multiValueHeaders、context、callback 等）就不做，
 * 免得寫出沒被驗證過的轉換。
 */

/* Netlify 的 queryStringParameters 是扁平物件，同名參數取最後一個。
   前端沒有用到重複參數，這裡與 Netlify 行為對齊即可。 */
function toQueryStringParameters(url) {
    const out = {};
    for (const [k, v] of url.searchParams) out[k] = v;
    return Object.keys(out).length ? out : {};
}

/* Netlify 的 event.headers 是全小寫鍵的普通物件。 */
function toHeaders(request) {
    const out = {};
    for (const [k, v] of request.headers) out[k.toLowerCase()] = v;
    return out;
}

/* 二進位請求（chat-upload 的圖片）必須走 base64，
   直接 text() 會把位元組用 UTF-8 解碼弄壞。 */
const BINARY_CONTENT = /^(image|audio|video|application\/octet-stream|multipart\/form-data)/i;

async function toEvent(request, url) {
    const method = request.method.toUpperCase();
    let body = null;
    let isBase64Encoded = false;

    if (method !== 'GET' && method !== 'HEAD') {
        const contentType = request.headers.get('content-type') ?? '';
        if (BINARY_CONTENT.test(contentType)) {
            const buf = new Uint8Array(await request.arrayBuffer());
            let bin = '';
            for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
            body = btoa(bin);
            isBase64Encoded = true;
        } else {
            body = await request.text();
        }
    }

    return {
        httpMethod: method,
        headers: toHeaders(request),
        queryStringParameters: toQueryStringParameters(url),
        body,
        isBase64Encoded,
        path: url.pathname,
        rawUrl: url.toString(),
    };
}

function toResponse(result) {
    if (!result || typeof result !== 'object') {
        return new Response('handler 沒有回傳結果', { status: 500 });
    }

    const status = result.statusCode ?? 200;
    const headers = new Headers(result.headers ?? {});

    let body = result.body ?? null;
    if (body != null && result.isBase64Encoded) {
        const bin = atob(body);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        body = bytes;
    }

    /* 204/304 不能帶 body，否則 Workers 會丟錯。 */
    if (status === 204 || status === 304) body = null;

    return new Response(body, { status, headers });
}

/* 把一個 Lambda handler 包成 (request, url) => Response。 */
function adapt(handler) {
    return async (request, url) => {
        const event = await toEvent(request, url);
        const result = await handler(event);
        return toResponse(result);
    };
}

module.exports = { adapt, toEvent, toResponse };
