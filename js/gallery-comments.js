/* ===== Comments on a published gallery collection =====
   Attached to the gallery detail modal (js/public-collections.js's
   openGalleryDetailModal/closeGalleryDetailModal call into this file) —
   loaded once per modal open rather than polled, since a comment thread on
   someone's collection isn't the kind of live conversation chat/DM are.
   Reuses chat's own login-gating convention: the composer is always
   visible, sending just checks getOsuAuthToken() and toasts if logged out,
   rather than hiding the input entirely. See netlify/functions/
   gallery-comments-{list,post,delete}.js for the backend. */
let galleryCommentsOwnerId = null;
let galleryCommentsItems = [];

async function loadGalleryComments(ownerId) {
    galleryCommentsOwnerId = String(ownerId);
    const listEl = document.getElementById('gallery-comments-list');
    if (!listEl) return;
    listEl.innerHTML = `<p class="osu-empty">${t('gallery_comments_loading')}</p>`;
    renderGalleryCommentsComposer();

    try {
        const res = await fetch(`/.netlify/functions/gallery-comments-list?ownerId=${galleryCommentsOwnerId}`);
        if (!res.ok) throw new Error('fetch failed');
        const data = await res.json();
        galleryCommentsItems = data.comments || [];
        renderGalleryCommentsList();
    } catch (e) {
        console.error('Gallery comments load failed:', e);
        listEl.innerHTML = `<p class="osu-empty">${t('gallery_comments_load_fail')}</p>`;
    }
}

function renderGalleryCommentsList() {
    const listEl = document.getElementById('gallery-comments-list');
    if (!listEl) return;
    if (!galleryCommentsItems.length) {
        listEl.innerHTML = `<p class="osu-empty">${t('gallery_comments_empty')}</p>`;
        return;
    }
    listEl.innerHTML = galleryCommentsItems.map(galleryCommentHtml).join('');
}

function galleryCommentFormatTime(iso) {
    try {
        return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
}

function galleryCommentHtml(c) {
    const loggedInUser = typeof getLoggedInOsuUser === 'function' && getLoggedInOsuUser();
    const canDelete = loggedInUser && (
        String(loggedInUser.id) === String(c.authorId) ||
        String(loggedInUser.id) === String(galleryCommentsOwnerId)
    );
    const profileUrl = `https://osu.ppy.sh/users/${c.authorId}`;
    return `
    <div class="chat-message gallery-comment" id="gallery-comment-${c.id}">
        <a class="chat-message-author" href="${profileUrl}" target="_blank" rel="noopener noreferrer">
            <div class="avatar-with-flag">
                <img class="tracked-player-avatar" src="${osuAvatarUrl(c.authorId)}" alt="" onerror="this.style.visibility='hidden';">
                ${c.authorCountry ? `<img class="avatar-flag-badge" src="${flagUrl(c.authorCountry)}" alt="" onerror="this.style.display='none';">` : ''}
            </div>
        </a>
        <div class="chat-message-body">
            <div class="chat-message-header">
                <a class="chat-message-name" href="${profileUrl}" target="_blank" rel="noopener noreferrer">${escapeHtmlOsu(c.authorUsername)}</a>
                <span class="chat-message-time">${galleryCommentFormatTime(c.createdAt)}</span>
                ${canDelete ? `<button class="chat-delete-btn" onclick="deleteGalleryComment(${c.id})" title="${t('chat_delete_btn_title')}">${icon('x')}</button>` : ''}
            </div>
            <div class="chat-message-content">${escapeHtmlOsu(c.content)}</div>
        </div>
    </div>`;
}

function renderGalleryCommentsComposer() {
    const el = document.getElementById('gallery-comments-composer');
    if (!el) return;
    el.innerHTML = `
        <input type="text" id="gallery-comment-input" maxlength="300"
            data-i18n-placeholder="gallery_comments_placeholder" placeholder="${t('gallery_comments_placeholder')}"
            onkeydown="if(event.key==='Enter') sendGalleryComment()">
        <button class="btn" onclick="sendGalleryComment()">${t('gallery_comments_send')}</button>`;
}

async function sendGalleryComment() {
    const input = document.getElementById('gallery-comment-input');
    if (!input || !galleryCommentsOwnerId) return;
    const content = input.value.trim();
    if (!content) return;
    const token = getOsuAuthToken();
    if (!token) { showShareToast(t('chat_login_required')); return; }

    input.disabled = true;
    try {
        const res = await fetch('/.netlify/functions/gallery-comments-post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ ownerId: galleryCommentsOwnerId, content }),
        });
        if (res.status === 401) { showShareToast(t('osu_login_fail')); return; }
        if (res.status === 429) { showShareToast(t('chat_rate_limited')); return; }
        if (!res.ok) throw new Error('send failed');
        const data = await res.json();

        galleryCommentsItems.push(data.comment);
        renderGalleryCommentsList();
        input.value = '';
    } catch (e) {
        console.error('Send gallery comment failed:', e);
        showShareToast(t('gallery_comments_send_fail'));
    } finally {
        input.disabled = false;
        input.focus();
    }
}

async function deleteGalleryComment(id) {
    const token = getOsuAuthToken();
    if (!token || !galleryCommentsOwnerId) return;
    if (!confirm(t('chat_delete_confirm'))) return;
    try {
        const res = await fetch('/.netlify/functions/gallery-comments-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ ownerId: galleryCommentsOwnerId, commentId: id }),
        });
        if (!res.ok) throw new Error('delete failed');
        galleryCommentsItems = galleryCommentsItems.filter(c => c.id !== id);
        document.getElementById(`gallery-comment-${id}`)?.remove();
    } catch (e) {
        console.error('Delete gallery comment failed:', e);
        showShareToast(t('chat_delete_fail'));
    }
}

function resetGalleryComments() {
    galleryCommentsOwnerId = null;
    galleryCommentsItems = [];
    const listEl = document.getElementById('gallery-comments-list');
    if (listEl) listEl.innerHTML = '';
    const composerEl = document.getElementById('gallery-comments-composer');
    if (composerEl) composerEl.innerHTML = '';
}
