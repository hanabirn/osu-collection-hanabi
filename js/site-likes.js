/* ===== "Like / share this site" — the small row under the header tagline.

   The like count is cumulative and server-backed
   (netlify/functions/site-likes.js -> Netlify Blobs). A visitor can like or
   un-like; the current choice is remembered in localStorage so the button
   keeps its state on return visits, and toggling off decrements the total.
   Sharing uses the native Web Share sheet where available (mobile) and
   falls back to copying the URL (desktop).

   Everything degrades quietly: if the function is unreachable — e.g. a plain
   static server with no Netlify backend, or the Blobs env vars aren't set —
   the count just shows "–" and toggling only flips the local button state. */
(function () {
    'use strict';

    var LIKED_KEY = 'site_liked_v1';
    var ENDPOINT = '/.netlify/functions/site-likes';
    var countEl, likeBtn;
    var currentCount = null;   // last known server total, or null if unknown

    function hasLiked() {
        try { return localStorage.getItem(LIKED_KEY) === '1'; } catch (e) { return false; }
    }
    function rememberLiked(liked) {
        try {
            if (liked) localStorage.setItem(LIKED_KEY, '1');
            else localStorage.removeItem(LIKED_KEY);
        } catch (e) { /* private mode — fine */ }
    }

    function renderCount(n) {
        if (typeof n === 'number' && isFinite(n)) {
            currentCount = Math.max(0, Math.round(n));
            if (countEl) countEl.textContent = currentCount.toLocaleString();
        } else if (countEl) {
            countEl.textContent = '–';
        }
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

    function toggleLike() {
        var nextLiked = !hasLiked();
        rememberLiked(nextLiked);
        setLikedState(nextLiked);
        // Optimistic count nudge (only when we actually have a number to nudge).
        if (currentCount != null) renderCount(currentCount + (nextLiked ? 1 : -1));
        bump();
        fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ liked: nextLiked })
        })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) { if (d && typeof d.likes === 'number') { renderCount(d.likes); bump(); } })
            .catch(function () { /* keep the local toggle state anyway */ });
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
    window.toggleSiteLike = toggleLike;
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
