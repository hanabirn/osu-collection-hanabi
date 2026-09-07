/* Build a Discord interaction response that carries a file attachment.
   Discord's interaction-callback endpoint accepts multipart/form-data with a
   `payload_json` part and `files[n]` parts (same as the create-message
   endpoint). Netlify's classic function runtime can return that as a
   base64 body with isBase64Encoded:true. */

function multipartInteraction({ type, data }, files) {
    const boundary = '----osudiscord' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const CRLF = '\r\n';
    const parts = [];

    const payload = { type, data: { ...data } };
    payload.data.attachments = files.map((f, i) => ({ id: i, filename: f.filename }));

    parts.push(Buffer.from(
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="payload_json"${CRLF}` +
        `Content-Type: application/json${CRLF}${CRLF}` +
        JSON.stringify(payload) + CRLF,
        'utf8',
    ));
    files.forEach((f, i) => {
        parts.push(Buffer.from(
            `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="files[${i}]"; filename="${f.filename}"${CRLF}` +
            `Content-Type: ${f.contentType || 'application/octet-stream'}${CRLF}${CRLF}`,
            'utf8',
        ));
        parts.push(Buffer.isBuffer(f.body) ? f.body : Buffer.from(f.body));
        parts.push(Buffer.from(CRLF, 'utf8'));
    });
    parts.push(Buffer.from(`--${boundary}--${CRLF}`, 'utf8'));

    return {
        statusCode: 200,
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: Buffer.concat(parts).toString('base64'),
        isBase64Encoded: true,
    };
}

// A CHANNEL_MESSAGE_WITH_SOURCE (type 4) response with one embed + one file.
const messageWithFile = (embed, file, components) => multipartInteraction(
    { type: 4, data: { embeds: [].concat(embed), components: components || [], allowed_mentions: { parse: [] } } },
    [file],
);

module.exports = { messageWithFile, multipartInteraction };
