/* ===== More osu! Resources — data-driven list =====
   Adding a new resource is just appending an entry to OSU_RESOURCES below;
   no HTML or render logic to touch. Descriptions still go through the same
   t()/data-i18n-key convention as everywhere else on the site, so a new
   entry's descKey needs adding to all 8 js/i18n/<lang>.js files. */
/* group: one of 'find' | 'stats' | 'make' — used only to bucket the cards
   under a heading in renderResourcesList(); order within OSU_RESOURCES is
   preserved inside each bucket. */
const OSU_RESOURCES = [
    { url: 'https://osusearch.com', name: 'osu!search', descKey: 'resource_osusearch_desc', group: 'find' },
    { url: 'https://osu-pps.com/#/osu/maps', name: 'osu-pps', descKey: 'resource_osupps_desc', group: 'find' },
    { url: 'https://github.com/Piotrekol/CollectionManager', name: 'CollectionManager', descKey: 'resource_collectionmanager_desc', group: 'find' },
    { url: 'https://ameobea.me/osutrack/', name: 'osu!track', descKey: 'resource_osutrack_desc', group: 'stats' },
    { url: 'https://osudaily.net', name: 'osu!daily', descKey: 'resource_osudaily_desc', group: 'stats' },
    { url: 'https://osustats.ppy.sh', name: 'osu!Stats', descKey: 'resource_osustats_desc', group: 'stats' },
    { url: 'https://osekai.net', name: 'Osekai', descKey: 'resource_osekai_desc', group: 'stats' },
    { url: 'https://mania-tracker.com', name: 'Mania Tracker', descKey: 'resource_maniatracker_desc', group: 'stats' },
    { url: 'https://catch-tracker-hanabi.netlify.app', name: 'Catch Tracker', descKey: 'resource_catchtracker_desc', group: 'stats' },
    { url: 'http://osuskills.com', name: 'osu!Skills', descKey: 'resource_osuskills_desc', group: 'stats' },
    { url: 'https://osuskinner.com', name: 'osuskinner', descKey: 'resource_osuskinner_desc', group: 'make' },
    { url: 'https://mappersguild.com', name: "Mappers' Guild", descKey: 'resource_mappersguild_desc', group: 'make' },
];

const OSU_RESOURCE_GROUPS = ['find', 'stats', 'make'];

function renderResourcesList() {
    const container = document.getElementById('resources-list');
    if (!container) return;
    const cardHtml = r => `<a class="resource-link-card" href="${r.url}" target="_blank" rel="noopener noreferrer">
        <div class="resource-link-title">${escapeHtmlOsu(r.name)} ${icon('externalLink')}</div>
        <div class="resource-link-desc">${escapeHtmlOsu(t(r.descKey))}</div>
    </a>`;
    container.innerHTML = OSU_RESOURCE_GROUPS.map(g => {
        const rows = OSU_RESOURCES.filter(r => r.group === g);
        if (!rows.length) return '';
        return `<div class="resource-group">
            <h3 class="resource-group-title">${escapeHtmlOsu(t('resource_group_' + g))}</h3>
            <div class="resources-grid">${rows.map(cardHtml).join('')}</div>
        </div>`;
    }).join('');
}

renderResourcesList();
