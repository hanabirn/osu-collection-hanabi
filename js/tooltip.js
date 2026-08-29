/* ===== Styled tooltips =====
   Swaps the OS-native title="" bubble (unstyleable, white-on-black, off
   theme) for one themed glassmorphism tooltip element parked on <body>.

   - Native `title` attributes are converted to `data-tip` (moved off the
     element so the browser's own bubble never fires) and mirrored into
     `aria-label` when the element has no other accessible name, so
     screen-reader users keep the label.
   - A MutationObserver catches the many tooltips that js/osu.js et al.
     render into cards after load, and re-syncs when applyLang() rewrites a
     title on language change.
   - The tooltip itself is position:fixed with a very high z-index, so —
     unlike an ::after pseudo-element — it's never clipped by a card's
     overflow:hidden.
*/
(function () {
    'use strict';

    var tipEl, textNode, arrowEl;
    var currentTarget = null;   // tooltip is showing for this element
    var pendingTarget = null;   // hover timer is counting down for this one
    var showTimer;

    function build() {
        if (tipEl) return;
        tipEl = document.createElement('div');
        tipEl.className = 'app-tooltip';
        tipEl.setAttribute('role', 'tooltip');
        arrowEl = document.createElement('span');
        arrowEl.className = 'app-tooltip-arrow';
        textNode = document.createTextNode('');
        tipEl.appendChild(arrowEl);
        tipEl.appendChild(textNode);
        document.body.appendChild(tipEl);
        // Paint the resting (opacity:0) state once so the first show still
        // transitions rather than snapping.
        void tipEl.offsetWidth;
    }

    // title -> data-tip (+ aria-label when the element is otherwise unnamed).
    // Always overwrites data-tip so a language switch takes effect.
    function convert(el) {
        var text = el.getAttribute('title');
        if (text == null) return;
        el.removeAttribute('title');
        if (!text) return;
        el.setAttribute('data-tip', text);
        var named = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') ||
            (el.textContent && el.textContent.trim());
        if (!named || el.hasAttribute('data-tip-managed-label')) {
            el.setAttribute('aria-label', text);
            el.setAttribute('data-tip-managed-label', '');
        }
    }
    function convertAll(root) {
        if (!root || root.nodeType !== 1) return;
        if (root.matches('[title]')) convert(root);
        var withTitle = root.querySelectorAll('[title]');
        for (var i = 0; i < withTitle.length; i++) convert(withTitle[i]);
    }

    function tipTarget(node) {
        return node && node.closest ? node.closest('[data-tip], [title]') : null;
    }

    function place(target) {
        var r = target.getBoundingClientRect();
        var box = tipEl.getBoundingClientRect();
        var GAP = 10, EDGE = 6;
        var placement = 'top';
        var top = r.top - box.height - GAP;
        if (top < EDGE) { top = r.bottom + GAP; placement = 'bottom'; }
        var left = r.left + r.width / 2 - box.width / 2;
        left = Math.max(EDGE, Math.min(left, window.innerWidth - box.width - EDGE));
        tipEl.style.top = Math.round(top) + 'px';
        tipEl.style.left = Math.round(left) + 'px';
        tipEl.setAttribute('data-placement', placement);
        // Keep the arrow under the target's centre even if the bubble was
        // clamped against a viewport edge.
        var arrowX = r.left + r.width / 2 - left;
        arrowEl.style.left = Math.max(12, Math.min(arrowX, box.width - 12)) + 'px';
    }

    function show(target) {
        var text = target.getAttribute('data-tip');
        if (!text) return;
        build();
        pendingTarget = null;
        currentTarget = target;
        textNode.nodeValue = text;
        place(target);
        tipEl.classList.add('visible');
    }
    function hide() {
        currentTarget = null;
        pendingTarget = null;
        clearTimeout(showTimer);
        if (tipEl) tipEl.classList.remove('visible');
    }

    function pointerEnter(e) {
        var target = tipTarget(e.target);
        if (!target) return;
        if (target.hasAttribute('title')) convert(target);
        if (target === currentTarget || target === pendingTarget) return;
        pendingTarget = target;
        clearTimeout(showTimer);
        showTimer = setTimeout(function () {
            if (pendingTarget === target) show(target);
        }, 60);
    }
    function pointerLeave(e) {
        var from = tipTarget(e.target);
        if (!from) return;
        var to = tipTarget(e.relatedTarget);
        if (to === from) return;                                  // moved within the same control
        if (from !== currentTarget && from !== pendingTarget) return;
        hide();
    }
    function focusIn(e) {
        var target = tipTarget(e.target);
        if (!target) return;
        if (target.hasAttribute('title')) convert(target);
        show(target);
    }

    function init() {
        convertAll(document.body);
        document.addEventListener('mouseover', pointerEnter, true);
        document.addEventListener('mouseout', pointerLeave, true);
        document.addEventListener('focusin', focusIn, true);
        document.addEventListener('focusout', hide, true);
        document.addEventListener('scroll', hide, true);
        window.addEventListener('resize', hide);

        new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var m = mutations[i];
                if (m.type === 'attributes') {
                    if (m.target.hasAttribute('title')) convert(m.target);
                    continue;
                }
                for (var j = 0; j < m.addedNodes.length; j++) convertAll(m.addedNodes[j]);
            }
        }).observe(document.body, {
            childList: true, subtree: true,
            attributes: true, attributeFilter: ['title']
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
