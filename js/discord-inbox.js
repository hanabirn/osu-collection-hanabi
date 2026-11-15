/* ===== 收藏收件匣 (Discord ➕ 加入收藏) =====
   Maps someone queued from the Discord bot for this osu! account wait in
   netlify/functions/discord-inbox.js; on sign-in the site adds them to the
   collection and clears them. With a collection password the adds would
   each ask for it, so then a small notice offers the button instead of
   doing it unprompted. */

let discordInboxChecked = false;

async function checkDiscordInbox() {
    if (discordInboxChecked) return;
    const token = typeof getOsuAuthToken === 'function' ? getOsuAuthToken() : null;
    if (!token) return;
    discordInboxChecked = true;
    let items = [];
    try {
        const res = await fetch('/.netlify/functions/discord-inbox', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        items = (await res.json()).items || [];
    } catch {
        return;
    }
    if (!items.length) return;
    const locked = typeof hasOsuPassword === 'function' && hasOsuPassword() && !osuPasswordVerifiedThisSession;
    if (locked) showDiscordInboxNote(items);
    else addDiscordInboxItems(items);
}

async function addDiscordInboxItems(items) {
    const token = getOsuAuthToken();
    const have = new Set(OSU_MODES.flatMap((m) => (getOsuCollection()[m] || []).map((s) => s.beatmapset_id)));
    const done = [];
    let added = 0;
    for (const id of items) {
        if (!have.has(id)) {
            await addOsuBeatmap(String(id), { isSet: true });
            const now = new Set(OSU_MODES.flatMap((m) => (getOsuCollection()[m] || []).map((s) => s.beatmapset_id)));
            if (!now.has(id)) continue; // not added (cancelled password, API error): keep it for next time
            added++;
        }
        done.push(id);
    }
    if (done.length) {
        try {
            await fetch('/.netlify/functions/discord-inbox', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ done }),
            });
        } catch { /* the next sign-in retries */ }
    }
    if (added) showShareToast(t('inbox_added', { n: added }));
    document.getElementById('discord-inbox-note')?.remove();
}

function showDiscordInboxNote(items) {
    if (document.getElementById('discord-inbox-note')) return;
    const note = document.createElement('div');
    note.id = 'discord-inbox-note';
    note.className = 'discord-inbox-note';
    note.setAttribute('role', 'status');
    note.innerHTML = `<span>${escHtml(t('inbox_pending', { n: items.length }))}</span>
        <button type="button" class="btn">${escHtml(t('inbox_add_btn'))}</button>
        <button type="button" class="discord-inbox-close" aria-label="${escHtml(t('close_label'))}">${icon('x')}</button>`;
    note.querySelector('.btn').addEventListener('click', () => addDiscordInboxItems(items));
    note.querySelector('.discord-inbox-close').addEventListener('click', () => note.remove());
    document.body.appendChild(note);
}
