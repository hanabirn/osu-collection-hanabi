/* Web Push（VAPID + aes128gcm）的 Web Crypto 實作，取代 web-push 套件。
 *
 * 為什麼要自己寫：web-push 依賴 Node 的 crypto 模組（createECDH、
 * createCipheriv 等），在 Cloudflare Workers 上連打包都過不了。
 * 這裡只用 Web Crypto，Workers 與 Node 18+ 都有。
 *
 * 只實作 push-cron.js 真正用到的兩件事：組 VAPID 授權標頭、送出一則
 * 帶酬載的通知。沒有用到的（訂閱管理、GCM 舊協定、無酬載推播）就不做。
 *
 * 規格：
 *   RFC 8291  Message Encryption for Web Push
 *   RFC 8188  Encrypted Content-Encoding（aes128gcm 的外層格式）
 *   RFC 8292  VAPID
 */

const AES128GCM_RS = 4096; // 紀錄大小；酬載遠小於此，固定單一紀錄即可
const DEFAULT_TTL = 24 * 60 * 60;

/* ---------- base64url ---------- */
function b64urlToBytes(s) {
    const pad = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function bytesToB64url(bytes) {
    let bin = '';
    const b = new Uint8Array(bytes);
    for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...arrays) {
    const total = arrays.reduce((n, a) => n + a.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) {
        out.set(a, off);
        off += a.length;
    }
    return out;
}

const utf8 = (s) => new TextEncoder().encode(s);

/* ---------- HKDF（RFC 5869，這裡固定 SHA-256） ---------- */
async function hmacSha256(keyBytes, data) {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

/* 長度一律 <= 32，所以 Expand 只需要跑一輪 T(1)。 */
async function hkdf(salt, ikm, info, length) {
    const prk = await hmacSha256(salt, ikm);
    const t1 = await hmacSha256(prk, concat(info, new Uint8Array([1])));
    return t1.slice(0, length);
}

/* ---------- VAPID 授權標頭（RFC 8292） ---------- */

/* Web Crypto 不接受裸的私鑰純量，只能走 JWK。VAPID 的私鑰是 32 bytes 的
   d，公鑰是未壓縮點 0x04||x||y，兩者湊得出完整的 JWK。 */
async function importVapidPrivateKey(publicKeyB64, privateKeyB64) {
    const pub = b64urlToBytes(publicKeyB64);
    if (pub.length !== 65 || pub[0] !== 0x04) {
        throw new Error(`VAPID 公鑰格式不對：預期 65 bytes 的未壓縮點，實際 ${pub.length}`);
    }
    const d = b64urlToBytes(privateKeyB64);
    if (d.length !== 32) {
        throw new Error(`VAPID 私鑰格式不對：預期 32 bytes，實際 ${d.length}`);
    }
    return await crypto.subtle.importKey(
        'jwk',
        {
            kty: 'EC',
            crv: 'P-256',
            x: bytesToB64url(pub.slice(1, 33)),
            y: bytesToB64url(pub.slice(33, 65)),
            d: bytesToB64url(d),
            ext: true,
        },
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign'],
    );
}

async function buildVapidHeader({ endpoint, subject, publicKey, privateKey }) {
    const aud = new URL(endpoint).origin;
    const header = bytesToB64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const payload = bytesToB64url(
        utf8(
            JSON.stringify({
                aud,
                exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
                sub: subject,
            }),
        ),
    );
    const signingInput = utf8(`${header}.${payload}`);

    const key = await importVapidPrivateKey(publicKey, privateKey);
    /* Web Crypto 的 ECDSA 產出的就是 JWS 要的 r||s 原始格式，
       不是 DER —— 不需要再轉換。 */
    const sig = new Uint8Array(
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signingInput),
    );

    return `vapid t=${header}.${payload}.${bytesToB64url(sig)}, k=${publicKey}`;
}

/* ---------- 酬載加密（RFC 8291 + RFC 8188） ---------- */
async function encryptPayload(plaintext, p256dhB64, authB64) {
    const uaPublic = b64urlToBytes(p256dhB64);
    const authSecret = b64urlToBytes(authB64);
    if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
        throw new Error(`訂閱的 p256dh 格式不對：預期 65 bytes 的未壓縮點，實際 ${uaPublic.length}`);
    }

    /* 每則訊息一組臨時金鑰（as = application server） */
    const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
        'deriveBits',
    ]);
    const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));

    const uaKey = await crypto.subtle.importKey(
        'raw',
        uaPublic,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        [],
    );
    const ecdhSecret = new Uint8Array(
        await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256),
    );

    /* RFC 8291 §3.3：先用 auth_secret 把 ECDH 結果與雙方公鑰綁在一起 */
    const keyInfo = concat(utf8('WebPush: info\0'), uaPublic, asPublic);
    const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

    /* RFC 8188 §2：明文尾端補一個 0x02 當最後一筆紀錄的分隔符 */
    const padded = concat(utf8(plaintext), new Uint8Array([0x02]));

    const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
    const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, padded),
    );

    /* RFC 8188 §2.1 的標頭：salt(16) || rs(4, big-endian) || idlen(1) || keyid */
    const rs = new Uint8Array(4);
    new DataView(rs.buffer).setUint32(0, AES128GCM_RS, false);
    return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

/* ---------- 對外介面 ---------- */

/* 與 web-push 的 sendNotification 行為對齊：失敗時丟出帶 statusCode 的
   錯誤，push-cron.js 靠它判斷 404/410 來刪掉過期訂閱。 */
async function sendNotification(subscription, payload, vapid) {
    const { endpoint, keys } = subscription || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
        const err = new Error('訂閱缺少 endpoint 或金鑰');
        err.statusCode = 400;
        throw err;
    }

    const body = await encryptPayload(payload, keys.p256dh, keys.auth);
    const authorization = await buildVapidHeader({ endpoint, ...vapid });

    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            Authorization: authorization,
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            TTL: String(DEFAULT_TTL),
        },
        body,
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`push failed: ${res.status} ${text.slice(0, 200)}`);
        err.statusCode = res.status;
        throw err;
    }
    return res.status;
}

module.exports = { sendNotification, buildVapidHeader, encryptPayload, b64urlToBytes, bytesToB64url, hkdf };
