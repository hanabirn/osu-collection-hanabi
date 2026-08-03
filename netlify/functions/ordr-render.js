/* Proxies a replay-render submission to o!rdr (apis.issou.best/ordr/renders,
   github.com/MasterIO02/ordr-server). The client posts multipart/form-data
   (the .osr file + render options) here; this rebuilds the same multipart
   body server-side and forwards it, since apis.issou.best sends no
   Access-Control-Allow-Origin header and would otherwise be blocked by the
   browser. Node's built-in Request/FormData (undici) parses and rebuilds
   the multipart body without any extra dependency. */
exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
    }

    try {
        const contentType = event.headers['content-type'] || event.headers['Content-Type'];
        if (!contentType || !contentType.includes('multipart/form-data')) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'multipart/form-data required' }) };
        }

        const bodyBuffer = event.isBase64Encoded
            ? Buffer.from(event.body, 'base64')
            : Buffer.from(event.body || '', 'utf8');

        const incomingForm = await new Request('http://internal/', {
            method: 'POST',
            headers: { 'content-type': contentType },
            body: bodyBuffer,
        }).formData();

        const outgoingForm = new FormData();
        for (const [key, value] of incomingForm.entries()) outgoingForm.append(key, value);

        const res = await fetch('https://apis.issou.best/ordr/renders', { method: 'POST', body: outgoingForm });
        const data = await res.json();
        return { statusCode: res.status, headers, body: JSON.stringify(data) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
