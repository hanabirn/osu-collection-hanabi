/* On-demand translation for one chat message (js/chat.js's "🌐 翻譯"
   button) — opt-in per message rather than translating everything
   automatically, since most messages need no translation and this keeps
   API usage to only what a visitor actually asks for. No auth required:
   translating a message that's already public to every visitor needs no
   extra permission.

   Uses MyMemory (api.mymemory.translated.net) — free, no API key/signup,
   and (confirmed by hand) its `langpair=autodetect|<target>` form actually
   auto-detects the source language, so this never needs to guess what a
   message is written in. Free tier is rate-limited per caller IP (~5000
   words/day anonymously) — fine at this site's scale; swap in a paid
   provider (DeepL/Google) here later if that ever becomes the bottleneck,
   the request/response shape below is the only thing that would change. */
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const MAX_TEXT_LENGTH = 300; // matches chat-send.js's own message length cap

// This site's own i18n locale codes (js/i18n.js) -> MyMemory target codes.
// Traditional/Simplified Chinese need the region suffix or MyMemory can't
// tell which script to translate into; everything else passes straight
// through as a plain ISO 639-1 code MyMemory already understands.
const TARGET_LANG_MAP = {
    zh: 'zh-TW', 'zh-Hans': 'zh-CN',
    en: 'en', ja: 'ja', ko: 'ko', ru: 'ru', fr: 'fr', es: 'es', de: 'de',
};

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
        return { statusCode: 422, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing text' }) };
    }
    if (text.length > MAX_TEXT_LENGTH) {
        return { statusCode: 422, headers: CORS_HEADERS, body: JSON.stringify({ error: `Text exceeds ${MAX_TEXT_LENGTH} characters` }) };
    }
    const target = TARGET_LANG_MAP[body.targetLang];
    if (!target) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unsupported targetLang' }) };
    }

    try {
        const params = new URLSearchParams({ q: text, langpair: `autodetect|${target}` });
        const res = await fetch(`https://api.mymemory.translated.net/get?${params.toString()}`);
        const data = await res.json();
        const translatedText = data && data.responseData && data.responseData.translatedText;
        if (!res.ok || !translatedText) {
            return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Translation failed' }) };
        }

        return {
            statusCode: 200,
            // Same text+target will always translate the same way — cheap to
            // cache at the edge and saves hitting MyMemory's own rate limit
            // again for a popular message everyone clicks translate on.
            headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=86400' },
            body: JSON.stringify({ translatedText, detectedLanguage: data.responseData.detectedLanguage || null }),
        };
    } catch (err) {
        return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
    }
};
