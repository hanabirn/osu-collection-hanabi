/* ===== "Like / share this site" — the small row under the header tagline.

   The like count is cumulative and server-backed
   (netlify/functions/site-likes.js -> Netlify Blobs). A visitor can add one
   like; it's remembered in localStorage so the button stays in its "liked"
   state on return visits and never re-POSTs. Sharing uses the native Web
   Share sheet where available (mobile) and falls back to copying the URL
   (desktop).

   Everything degrades quietly: if the function is unreachable — e.g. a plain
   static server with no Netlify backend, or the Blobs env vars aren't set —
   the count just shows "–" and the like button becomes a no-op. ===== */
(function () {
    'use strict';

    var LIKED_KEY = 'site_liked_v1';
    var ENDPOINT = '/.netlify/functions/site-likes';
    var countEl, likeBtn;

    function hasLiked() {
        try { return localStorage.getItem(LIKED_KEY) === '1'; } catch (e) { return false; }
    }
    function rememberLiked() {
        try { localStorage.setItem(LIKED_KEY, '1'); } catch (e) { /* private mode — fine */ }
    }

    function renderCount(n) {
        if (countEl) countEl.textContent = (typeof n === 'number' && isFinite(n)) ? n.toLocaleString() : '–';
    }
    // Re-trigger the CSS bump animation on the count.
    function bump() {
        if (!countEl) return;
        countEl.classList.remove('bump');
        void countEl.offsetWidth;
        countEl.classList.add('bump');
    }
    function setLikedState(liked) {
        if (!likeBtn) return;
        likeBtn.classList.toggle('liked', !!liked);
        likeBtn.setAttribute('aria-pressed', liked ? 'true' : 'false');
    }

    function loadCount() {
        fetch(ENDPOINT, { method: 'GET' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) { if (d && typeof d.likes === 'number') renderCount(d.likes); })
            .catch(function () { /* offline / no backend */ });
    }

    function likeSite() {
        if (hasLiked()) return;
        // Optimistic + remembered up front so a slow POST can't be double-fired.
        rememberLiked();
        setLikedState(true);
        bump();
        fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) { if (d && typeof d.likes === 'number') { renderCount(d.likes); bump(); } })
            .catch(function () { /* keep the local liked state anyway */ });
    }

    function shareSite() {
        var url = location.origin + location.pathname;
        var msg = (typeof t === 'function' ? t('site_share_text') : document.title);
        if (navigator.share) {
            navigator.share({ title: document.title, text: msg, url: url }).catch(function () { /* user cancelled */ });
            return;
        }
        var toast = function () {
            if (typeof showShareToast === 'function') {
                showShareToast(typeof t === 'function' ? t('site_share_copied') : 'Link copied');
            }
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(toast, toast);
        } else {
            toast();
        }
    }

    // Called from the inline onclick= handlers in index.html.
    window.likeSite = likeSite;
    window.shareSite = shareSite;

    function init() {
        countEl = document.getElementById('site-like-count');
        likeBtn = document.getElementById('site-like-btn');
        if (!likeBtn) return;
        setLikedState(hasLiked());
        loadCount();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
