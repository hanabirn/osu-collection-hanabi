/* Category ids end up inside HTML attributes on other visitors' screens
   (js/public-collections.js's gallery detail tabs), so only a plain token
   is allowed. The site itself always mints crypto.randomUUID()s, which
   pass; anything else (an old hand-edited backup, or a crafted publish
   request) is replaced with a fresh id. Members are carried over to the
   new id, so the category keeps its contents. */
const SAFE_CATEGORY_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isSafeCategoryId(id) {
    return typeof id === 'string' && SAFE_CATEGORY_ID.test(id);
}

/* categories: [{id, name}], categoryMembers: {id: [...]}.
   Returns new objects; the inputs are not modified. */
function normalizeCategoryIds(categories, categoryMembers) {
    const members = categoryMembers && typeof categoryMembers === 'object' ? categoryMembers : {};
    const used = new Set();
    const seenOriginal = new Set();
    const outCategories = [];
    const outMembers = {};
    let n = 0;
    for (const cat of Array.isArray(categories) ? categories : []) {
        if (!cat || typeof cat !== 'object') continue;
        // A repeated id would share the first one's members; keep the first
        // only, like js/osu.js sanitizeImportedCategoryData() does.
        if (seenOriginal.has(cat.id)) continue;
        seenOriginal.add(cat.id);
        let id = cat.id;
        if (!isSafeCategoryId(id) || used.has(id)) {
            do { id = `cat-${n++}`; } while (used.has(id));
        }
        used.add(id);
        outCategories.push({ ...cat, id });
        if (Array.isArray(members[cat.id])) outMembers[id] = members[cat.id];
    }
    return { categories: outCategories, categoryMembers: outMembers };
}

module.exports = { isSafeCategoryId, normalizeCategoryIds };
