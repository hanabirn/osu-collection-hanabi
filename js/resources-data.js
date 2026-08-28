/* ===== More osu! Resources — data-driven list =====
   Adding a new resource is just appending an entry to OSU_RESOURCES below;
   no HTML or render logic to touch. Descriptions still go through the same
   t()/data-i18n-key convention as everywhere else on the site, so a new
   entry's descKey needs adding to all 8 js/i18n/<lang>.js files. */
const OSU_RESOURCES = [
    { url: 'https://osusearch.com', name: 'osu!search', descKey: 'resource_osusearch_desc' },
    { url: 'https://osu-pps.com/#/osu/maps', name: 'osu-pps', descKey: 'resource_osupps_desc' },
    { url: 'https://github.com/Piotrekol/CollectionManager', name: 'CollectionManager', descKey: 'resource_collectionmanager_desc' },
    { url: 'https://osuskinner.com', name: 'osuskinner', descKey: 'resource_osuskinner_desc' },
    { url: 'https://mappersguild.com', name: "Mappers' Guild", descKey: 'resource_mappersguild_desc' },
    { url: 'http://osuskills.com', name: 'osu!Skills', descKey: 'resource_osuskills_desc' },
];

function renderResourcesList() {
    const container = document.getElementById('resources-list');
    if (!container) return;
    container.innerHTML = OSU_RESOURCES.map(r => `<a class="resource-link-card" href="${r.url}" target="_blank" rel="noopener noreferrer">
        <div class="resource-link-title">${escapeHtmlOsu(r.name)} ${icon('externalLink')}</div>
        <div class="resource-link-desc">${escapeHtmlOsu(t(r.descKey))}</div>
    </a>`).join('');
}

renderResourcesList();
