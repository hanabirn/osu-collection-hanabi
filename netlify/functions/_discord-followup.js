/* Edit the deferred ("Bot is thinking…") message for an interaction — used by
   discord-work-background.js after it finishes a slow command that
   discord-interactions.js deferred with a type:5 response.

   The interaction token in the URL is the credential (no Authorization
   header); it's valid ~15 minutes after the interaction. `file` is optional:
   { filename, body: Buffer, contentType? }. */
const { buildMultipart } = require('./_discord-attach');

const API = 'https://discord.com/api/v10';

async function sendFollowup(appId, token, { embeds, components, file } = {}) {
    const url = `${API}/webhooks/${appId}/${token}/messages/@original`;
    const msg = { embeds: embeds || [], components: components || [], allowed_mentions: { parse: [] } };

    let res;
    try {
        if (file) {
            const { contentType, body } = buildMultipart({
                jsonPart: { ...msg, attachments: [{ id: 0, filename: file.filename }] },
                files: [file],
            });
            res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': contentType }, body });
        } else {
            res = await fetch(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(msg),
            });
        }
    } catch (err) {
        console.error('discord followup threw', err);
        return { ok: false, status: 0 };
    }

    if (!res.ok) {
        console.error('discord followup failed', res.status, await res.text().catch(() => ''));
    }
    return { ok: res.ok, status: res.status };
}

module.exports = { sendFollowup };
