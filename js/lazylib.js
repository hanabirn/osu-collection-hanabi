/* ===== Lazy CDN-library loader =====
   chart.js / html-to-image / fflate / canvas-confetti were ~70 KB gz of
   deferred script downloaded on every visit, but none is needed for the
   collection tab's first view — they only matter once you open the stats
   dashboard, export an .osdb, download a share card, or a celebration
   fires. Each ensureX() injects its script on first call and resolves when
   it's ready; the Promise is cached so concurrent/repeat callers share one
   load. async=false keeps a UMD lib's own internal ordering intact. ===== */
const _scriptOnce = {};
function loadScriptOnce(src) {
    return _scriptOnce[src] || (_scriptOnce[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = false;
        s.onload = () => resolve();
        s.onerror = () => { delete _scriptOnce[src]; reject(new Error('failed to load ' + src)); };
        document.head.appendChild(s);
    }));
}

const CDN_LIBS = {
    chart: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js',
    htmlToImage: 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.min.js',
    fflate: 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js',
    confetti: 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js',
};

const ensureCharts = () => loadScriptOnce(CDN_LIBS.chart);
const ensureHtmlToImage = () => loadScriptOnce(CDN_LIBS.htmlToImage);
const ensureFflate = () => loadScriptOnce(CDN_LIBS.fflate);
const ensureConfetti = () => loadScriptOnce(CDN_LIBS.confetti);
