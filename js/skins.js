/* ===== osu! Skin locker — stored entirely in the visitor's own browser =====
   No backend exists on this site (the beatmap collection is the same:
   localStorage-only), and skin files (.osk) commonly run 10-200+ MB, far
   past what localStorage can hold. IndexedDB has no such practical size
   limit, so skin *files* (as Blobs) live there, keyed per-browser — this
   is a personal locker, not a shared upload visible to other visitors. */
const SKIN_DB_NAME = 'osu_skins_db';
const SKIN_STORE = 'skins';

function openSkinDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(SKIN_DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(SKIN_STORE)) {
                db.createObjectStore(SKIN_STORE, { keyPath: 'id', autoIncrement: true });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function addSkinFile(file) {
    return openSkinDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(SKIN_STORE, 'readwrite');
        tx.objectStore(SKIN_STORE).add({ name: file.name, size: file.size, addedAt: Date.now(), file });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    }));
}

function getAllSkins() {
    return openSkinDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(SKIN_STORE, 'readonly');
        const req = tx.objectStore(SKIN_STORE).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }));
}

function deleteSkinFile(id) {
    return openSkinDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(SKIN_STORE, 'readwrite');
        tx.objectStore(SKIN_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    }));
}

async function handleSkinUpload(event) {
    const input = event.target;
    const files = [...(input.files || [])];
    if (!files.length) return;
    const status = document.getElementById('skin-upload-status');

    for (const file of files) {
        try {
            await addSkinFile(file);
        } catch (e) {
            console.error('Skin upload failed:', e);
            if (status) status.textContent = t('skins_upload_fail', { n: file.name });
        }
    }
    input.value = '';
    if (status && !status.textContent) status.textContent = t('skins_upload_done', { n: files.length });
    setTimeout(() => { if (status) status.textContent = ''; }, 3000);
    renderSkinsList();
}

async function downloadSkinFile(id) {
    const skins = await getAllSkins();
    const skin = skins.find(s => s.id === id);
    if (!skin) return;
    const url = URL.createObjectURL(skin.file);
    const a = document.createElement('a');
    a.href = url;
    a.download = skin.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function confirmDeleteSkin(id) {
    if (!confirm(t('skins_delete_confirm'))) return;
    await deleteSkinFile(id);
    renderSkinsList();
}

/* ===== Skin thumbnail + skin.ini info preview =====
   .osk files are plain zip archives. Instead of unzipping the whole thing
   (files run 10-200+ MB), fflate's filter option skips decompressing every
   entry except the one candidate image and skin.ini itself, so this stays
   fast even for large skins — both come out of the same unzip() pass rather
   than two. Only matches files sitting at the zip root (same as real .osk
   layout), not inside a subfolder. Extracted results are cached per skin id
   for the session so re-renders (after upload/delete) don't redo the work. */
const SKIN_THUMB_CANDIDATES = ['cursor.png', 'cursor@2x.png', 'menu-background.png', 'menu-background@2x.png', 'hitcircle.png', 'hitcircle@2x.png'];
const skinAssetCache = new Map();

/* skin.ini is a plain key:value INI file; only the [General] section's
   Name/Author/Version are worth surfacing here. */
function parseSkinIni(text) {
    const generalMatch = text.match(/\[General\]([\s\S]*?)(?:\r?\n\[|$)/i);
    if (!generalMatch) return null;
    const section = generalMatch[1];
    const grab = (key) => {
        const m = section.match(new RegExp(`^[ \\t]*${key}[ \\t]*:[ \\t]*(.+?)[ \\t]*$`, 'im'));
        return m ? m[1].trim() : '';
    };
    const info = { name: grab('Name'), author: grab('Author'), version: grab('Version') };
    return (info.name || info.author || info.version) ? info : null;
}

function extractSkinAssets(file) {
    if (typeof fflate === 'undefined') return Promise.resolve({ thumbUrl: null, info: null });
    return file.arrayBuffer().then(buf => new Promise(resolve => {
        try {
            fflate.unzip(new Uint8Array(buf), {
                filter: entry => SKIN_THUMB_CANDIDATES.includes(entry.name.toLowerCase()) || entry.name.toLowerCase() === 'skin.ini',
            }, (err, unzipped) => {
                if (err) { resolve({ thumbUrl: null, info: null }); return; }

                let thumbUrl = null;
                for (const name of SKIN_THUMB_CANDIDATES) {
                    const key = Object.keys(unzipped).find(k => k.toLowerCase() === name);
                    if (key) { thumbUrl = URL.createObjectURL(new Blob([unzipped[key]], { type: 'image/png' })); break; }
                }

                let info = null;
                const iniKey = Object.keys(unzipped).find(k => k.toLowerCase() === 'skin.ini');
                if (iniKey) {
                    try { info = parseSkinIni(new TextDecoder('utf-8').decode(unzipped[iniKey])); }
                    catch { info = null; }
                }

                resolve({ thumbUrl, info });
            });
        } catch {
            resolve({ thumbUrl: null, info: null });
        }
    })).catch(() => ({ thumbUrl: null, info: null }));
}

function formatSkinIniInfo(info) {
    const parts = [];
    if (info.name) parts.push(escapeSkinName(info.name));
    if (info.author) parts.push(t('skins_by_author', { author: escapeSkinName(info.author) }));
    if (info.version) parts.push(`v${escapeSkinName(info.version)}`);
    return parts.join(' &middot; ');
}

function loadSkinThumbnails(skins) {
    for (const skin of skins) {
        if (skinAssetCache.has(skin.id)) continue;
        skinAssetCache.set(skin.id, null);
        extractSkinAssets(skin.file).then(assets => {
            skinAssetCache.set(skin.id, assets);
            const thumbEl = document.getElementById(`skin-thumb-${skin.id}`);
            if (thumbEl && assets.thumbUrl) thumbEl.innerHTML = `<img src="${assets.thumbUrl}" alt="">`;
            const infoEl = document.getElementById(`skin-ini-info-${skin.id}`);
            if (infoEl && assets.info) infoEl.innerHTML = formatSkinIniInfo(assets.info);
        });
    }
}

function formatSkinSize(bytes) {
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function escapeSkinName(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

async function renderSkinsList() {
    const container = document.getElementById('skins-list');
    if (!container) return;
    let skins;
    try {
        skins = await getAllSkins();
    } catch (e) {
        container.innerHTML = `<p class="skins-empty">${t('skins_load_fail')}</p>`;
        return;
    }
    skins.sort((a, b) => b.addedAt - a.addedAt);
    if (skins.length === 0) {
        container.innerHTML = `<p class="skins-empty">${t('skins_empty')}</p>`;
        return;
    }
    container.innerHTML = skins.map(s => {
        const cached = skinAssetCache.get(s.id);
        return `
        <div class="skin-item">
            <div class="skin-item-thumb" id="skin-thumb-${s.id}">${cached && cached.thumbUrl ? `<img src="${cached.thumbUrl}" alt="">` : '🎵'}</div>
            <div class="skin-item-info">
                <div class="skin-item-name">${escapeSkinName(s.name)}</div>
                <div class="skin-item-meta">${formatSkinSize(s.size)} &middot; ${new Date(s.addedAt).toLocaleDateString()}</div>
                <div class="skin-item-ini-info" id="skin-ini-info-${s.id}">${cached && cached.info ? formatSkinIniInfo(cached.info) : ''}</div>
            </div>
            <div class="skin-item-actions">
                <button class="skin-backup-btn" onclick="openSkinPreviewModal(${s.id})" title="${t('skins_preview_btn')}">${icon('palette')}</button>
                <button class="skin-backup-btn" onclick="backupSkinToCloud(${s.id})" title="${t('skins_backup_btn')}">${icon('cloudUpload')}</button>
                <button class="skin-download-btn" onclick="downloadSkinFile(${s.id})">${icon('download', { extraClass: 'icon-label-gap' })}${t('skins_download')}</button>
                <button class="skin-delete-btn" onclick="confirmDeleteSkin(${s.id})">${icon('trash2', { extraClass: 'icon-label-gap' })}${t('skins_delete')}</button>
            </div>
        </div>
    `;
    }).join('');
    loadSkinThumbnails(skins);
}

/* ===== Optional cloud backup =====
   Strictly opt-in and size-capped — see netlify/functions/skins-upload.js
   for exactly why (Netlify Functions' ~6MB request body ceiling vs. real
   skins commonly running 10-200+ MB). Lives as its own list rather than a
   per-item "synced" toggle on the local list above: a cloud backup is a
   snapshot copy, not a live mirror, so keeping the two lists independent
   avoids having to reconcile local-vs-cloud identity for files that have no
   stable id of their own (only a name + size, both mutable). ===== */
const SKIN_BACKUP_MAX_BYTES = 4 * 1024 * 1024;

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function backupSkinToCloud(localId) {
    const token = getOsuAuthToken();
    if (!token) { showShareToast(t('skins_backup_login_required')); return; }

    const skins = await getAllSkins();
    const skin = skins.find(s => s.id === localId);
    if (!skin) return;
    if (skin.size > SKIN_BACKUP_MAX_BYTES) {
        showShareToast(t('skins_backup_too_large', { limit: SKIN_BACKUP_MAX_BYTES / 1024 / 1024 }));
        return;
    }

    try {
        const dataBase64 = await blobToBase64(skin.file);
        const res = await fetch('/.netlify/functions/skins-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ name: skin.name, dataBase64 }),
        });
        if (res.status === 401) { showShareToast(t('skins_backup_login_required')); return; }
        if (!res.ok) throw new Error('upload failed');
        showShareToast(t('skins_backup_done'));
        renderCloudSkinsList();
    } catch (e) {
        console.error('Skin cloud backup failed:', e);
        showShareToast(t('skins_backup_fail'));
    }
}

async function renderCloudSkinsList() {
    const section = document.getElementById('cloud-skins-section');
    const container = document.getElementById('cloud-skins-list');
    if (!section || !container) return;

    const token = getOsuAuthToken();
    if (!token) { section.style.display = 'none'; return; }
    section.style.display = '';

    try {
        const res = await fetch('/.netlify/functions/skins-list', { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 401) { section.style.display = 'none'; return; }
        if (!res.ok) throw new Error('list failed');
        const data = await res.json();
        const items = data.items || [];

        if (items.length === 0) {
            container.innerHTML = `<p class="skins-empty">${t('skins_backup_empty')}</p>`;
            return;
        }
        container.innerHTML = items.map(it => `
            <div class="skin-item cloud-skin-item">
                <div class="skin-item-thumb">☁️</div>
                <div class="skin-item-info">
                    <div class="skin-item-name">${escapeSkinName(it.name)}</div>
                    <div class="skin-item-meta">${formatSkinSize(it.size)} &middot; ${new Date(it.uploadedAt).toLocaleDateString()}</div>
                </div>
                <div class="skin-item-actions">
                    <button class="skin-download-btn" onclick="restoreCloudSkinToLocal('${it.id}', decodeURIComponent('${encodeURIComponent(it.name)}'))">${icon('download', { extraClass: 'icon-label-gap' })}${t('skins_backup_restore')}</button>
                    <button class="skin-delete-btn" onclick="confirmDeleteCloudSkin('${it.id}')">${icon('trash2', { extraClass: 'icon-label-gap' })}${t('skins_delete')}</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Cloud skins list failed:', e);
        container.innerHTML = `<p class="skins-empty">${t('skins_load_fail')}</p>`;
    }
}

async function restoreCloudSkinToLocal(id, name) {
    const token = getOsuAuthToken();
    if (!token) { showShareToast(t('skins_backup_login_required')); return; }
    try {
        const res = await fetch(`/.netlify/functions/skins-download?id=${id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error('download failed');
        const blob = await res.blob();
        await addSkinFile(new File([blob], name, { type: 'application/octet-stream' }));
        showShareToast(t('skins_backup_restored'));
        renderSkinsList();
    } catch (e) {
        console.error('Cloud skin restore failed:', e);
        showShareToast(t('skins_backup_fail'));
    }
}

/* ===== Skin online preview =====
   A canvas animation loop showing off a skin's element set for all four
   rulesets without ever downloading it in-game — the .osk is already
   sitting in IndexedDB (see the locker above), so this just unzips a few
   more root-level PNGs than the list thumbnail does (extractSkinAssets
   above only grabs one candidate image) plus skin.ini's [General] cursor
   behavior flags, [Colours] combo/slider palette, and [CatchTheBeat]
   HyperDash color, via the same fflate filtered-unzip approach so large
   skins still unzip fast. Each mode's animation is a fixed, made-up demo,
   not a recreation of real gameplay — just enough motion to see the
   skin's shapes and colors in action:
   - osu!: alternates a hit circle (approach circle shrinking on, cursor
     swooping in to click and swinging back out) with a slider (body drawn
     from skin.ini's SliderBody/SliderBorder colors, ball riding back and
     forth along it, cursor following the ball).
   - taiko: a note scrolls in along the (deliberately wide/short) lane to
     the hit position, cycling through don/katsu/big-don/big-katsu. Stable
     has no per-skin don/katsu circle art — it tints taikohitcircle.png
     red/blue at fixed engine colors at runtime, which this reproduces via
     a `source-atop` color fill over the drawn image (constrained to the
     image's own alpha shape, so it can't bleed outside it) rather than
     the riskier `multiply` approach.
   - catch (fruits): the catcher sliding under a fruit that drops from the
     top and gets "caught", alternating a normal fruit with a hyperdash
     one (tinted with skin.ini's HyperDash color the same source-atop way).
   - mania: a 4K or 7K lane (toggle shown only in this tab) of notes
     falling onto their keys, which light up briefly on "press". Real
     mania skins configure art per key-count via repeated [Mania] sections
     in skin.ini, each disambiguated by its own `Keys: N` line and
     NoteImage{i}/KeyImage{i}/KeyImage{i}D column overrides — see
     getSkinIniSections()/parseSkinIniManiaAssets() below, which read
     skin.ini in an extra unzip pass up front specifically to resolve
     those before falling back to generic mania-note{i+1}/mania-key{i+1}
     names for any column a skin doesn't customize. */
const SKIN_PREVIEW_BASE_NAMES = [
    'cursor', 'cursormiddle', 'hitcircle', 'hitcircleoverlay', 'approachcircle',
    'sliderb0', 'sliderfollowcircle',
    'default-0', 'default-1', 'default-2', 'default-3', 'default-4',
    'default-5', 'default-6', 'default-7', 'default-8', 'default-9',
    'taikohitcircle', 'taikohitcircleoverlay', 'taikobigcircle', 'taikobigcircleoverlay',
    'fruit-catcher-idle', 'fruit-pear',
    ...Array.from({ length: 7 }, (_, i) => `mania-note${i + 1}`),
    ...Array.from({ length: 7 }, (_, i) => `mania-key${i + 1}`),
    ...Array.from({ length: 7 }, (_, i) => `mania-key${i + 1}d`),
];
// extraNames covers per-skin custom mania filenames discovered by reading
// skin.ini first — see extractSkinPreviewAssets' two-pass unzip below.
function skinPreviewFilterName(name, extraNames) {
    const lower = name.toLowerCase();
    if (lower === 'skin.ini') return true;
    if (SKIN_PREVIEW_BASE_NAMES.some(base => lower === `${base}.png` || lower === `${base}@2x.png`)) return true;
    return !!extraNames && extraNames.some(base => {
        const b = base.toLowerCase();
        return lower === `${b}.png` || lower === `${b}@2x.png`;
    });
}

function parseSkinIniColours(text) {
    const section = text.match(/\[Colours\]([\s\S]*?)(?:\r?\n\[|$)/i);
    if (!section) return [];
    const colours = [];
    const re = /^[ \t]*Combo\d+[ \t]*:[ \t]*(\d+)[ \t]*,[ \t]*(\d+)[ \t]*,[ \t]*(\d+)/gim;
    let m;
    while ((m = re.exec(section[1]))) colours.push(`rgb(${m[1]},${m[2]},${m[3]})`);
    return colours;
}
function parseSkinIniGeneralBool(text, key, fallback) {
    const m = text.match(new RegExp(`^[ \\t]*${key}[ \\t]*:[ \\t]*(.+?)[ \\t]*$`, 'im'));
    return m ? m[1].trim() === '1' : fallback;
}
// Single "R,G,B" value nested under a given [Section] — used for
// SliderBody/SliderBorder (under [Colours]) and HyperDash (under
// [CatchTheBeat]), all three of which are one-off colors rather than the
// numbered ComboN list parseSkinIniColours handles above.
function parseSkinIniRgb(text, section, key) {
    const sectionMatch = text.match(new RegExp(`\\[${section}\\]([\\s\\S]*?)(?:\\r?\\n\\[|$)`, 'i'));
    if (!sectionMatch) return null;
    const m = sectionMatch[1].match(new RegExp(`^[ \\t]*${key}[ \\t]*:[ \\t]*(\\d+)[ \\t]*,[ \\t]*(\\d+)[ \\t]*,[ \\t]*(\\d+)`, 'im'));
    return m ? `rgb(${m[1]},${m[2]},${m[3]})` : null;
}
function skinPreviewWithAlpha(rgbStr, alpha) {
    const m = rgbStr && rgbStr.match(/rgb\((\d+),(\d+),(\d+)\)/);
    return m ? `rgba(${m[1]},${m[2]},${m[3]},${alpha})` : rgbStr;
}

/* skin.ini can repeat the *same* header — [Mania] appears once per key
   count a skin customizes, each disambiguated by its own `Keys:` line
   inside — so a single-section regex (like parseSkinIniColours' above)
   can't isolate "the" [Mania] block. This splits the whole file into every
   top-level [Header] block instead, in order, so callers can filter down
   to the ones they actually want. */
function getSkinIniSections(text) {
    const headerRe = /^\[([^\]]+)\][ \t]*$/gim;
    const matches = [...text.matchAll(headerRe)];
    const sections = [];
    for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index + matches[i][0].length;
        const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
        sections.push({ name: matches[i][1].trim(), body: text.slice(start, end) });
    }
    return sections;
}

/* Finds the [Mania] section whose `Keys:` line matches keyCount and pulls
   out its NoteImage{i}/KeyImage{i}/KeyImage{i}D overrides (0-indexed per
   column) — real mania skins configure art this way rather than shipping
   generically-named mania-note1.png/mania-key1.png files, so relying only
   on those generic names (as the rest of this feature does) silently
   fails to find a 4K- or 7K-specific skin's actual art. Returns null if
   this skin has no [Mania] section for that key count at all, in which
   case the caller falls back to the generic names. */
function parseSkinIniManiaAssets(text, keyCount) {
    const section = getSkinIniSections(text).find(s => {
        if (s.name.toLowerCase() !== 'mania') return false;
        const m = s.body.match(/^[ \t]*Keys[ \t]*:[ \t]*(\d+)/im);
        return m && parseInt(m[1], 10) === keyCount;
    });
    if (!section) return null;
    const grab = (key) => {
        const m = section.body.match(new RegExp(`^[ \\t]*${key}[ \\t]*:[ \\t]*(.+?)[ \\t]*$`, 'im'));
        return m ? m[1].trim().replace(/\.png$/i, '') : null;
    };
    const noteImages = [], keyImages = [], keyImagesPressed = [];
    for (let i = 0; i < keyCount; i++) {
        noteImages.push(grab(`NoteImage${i}`));
        keyImages.push(grab(`KeyImage${i}`));
        keyImagesPressed.push(grab(`KeyImage${i}D`));
    }
    return { noteImages, keyImages, keyImagesPressed };
}

// Keyed by skin id, caches the *promise* (not just the resolved value) so
// concurrent preview-opens for the same skin id share one unzip pass
// instead of racing two.
const skinPreviewCache = new Map();

// Column-index arrays for a resolved 4K/7K mania asset set — `override[i]`
// (from skin.ini's NoteImage{i}/KeyImage{i}, when that skin actually
// customizes this key count) wins over the generic mania-note{i+1}/
// mania-key{i+1}[d] fallback name. `genericName(i)` supplies that fallback
// so pressed vs unpressed keys can each use their own naming.
function skinPreviewManiaPick(pick, override, genericName, keyCount) {
    return Array.from({ length: keyCount }, (_, i) => pick((override && override[i]) || genericName(i)));
}

function extractSkinPreviewAssets(skinId, file) {
    if (skinPreviewCache.has(skinId)) return skinPreviewCache.get(skinId);
    const promise = (typeof fflate === 'undefined' ? Promise.resolve(null) : file.arrayBuffer().then(async buf => {
        const bytes = new Uint8Array(buf);

        // Pass 1: skin.ini only. Mania's real per-keycount art is named
        // via that file's [Mania] Keys:4/Keys:7 sections (see
        // parseSkinIniManiaAssets), which has to be read before knowing
        // which *other* filenames pass 2 needs to look for.
        const iniText = await new Promise(resolve => {
            try {
                fflate.unzip(bytes, { filter: entry => entry.name.toLowerCase() === 'skin.ini' }, (err, unzipped) => {
                    if (err) { resolve(''); return; }
                    const key = Object.keys(unzipped)[0];
                    if (!key) { resolve(''); return; }
                    try { resolve(new TextDecoder('utf-8').decode(unzipped[key])); }
                    catch { resolve(''); }
                });
            } catch { resolve(''); }
        });

        const mania4 = iniText ? parseSkinIniManiaAssets(iniText, 4) : null;
        const mania7 = iniText ? parseSkinIniManiaAssets(iniText, 7) : null;
        const customNames = [mania4, mania7]
            .filter(Boolean)
            .flatMap(m => [...m.noteImages, ...m.keyImages, ...m.keyImagesPressed])
            .filter(Boolean);

        return new Promise(resolve => {
            try {
                fflate.unzip(bytes, { filter: entry => skinPreviewFilterName(entry.name, customNames) }, (err, unzipped) => {
                    if (err) { resolve(null); return; }
                    const pick = (base) => {
                        if (!base) return null;
                        const lower = base.toLowerCase();
                        const key2x = Object.keys(unzipped).find(k => k.toLowerCase() === `${lower}@2x.png`);
                        const key1x = Object.keys(unzipped).find(k => k.toLowerCase() === `${lower}.png`);
                        const key = key2x || key1x;
                        return key ? URL.createObjectURL(new Blob([unzipped[key]], { type: 'image/png' })) : null;
                    };
                    resolve({
                        cursor: pick('cursor'),
                        cursorMiddle: pick('cursormiddle'),
                        hitcircle: pick('hitcircle'),
                        hitcircleOverlay: pick('hitcircleoverlay'),
                        approachCircle: pick('approachcircle'),
                        sliderBall: pick('sliderb0'),
                        sliderFollowCircle: pick('sliderfollowcircle'),
                        numbers: Array.from({ length: 10 }, (_, i) => pick(`default-${i}`)),
                        taikoHitcircle: pick('taikohitcircle'),
                        taikoHitcircleOverlay: pick('taikohitcircleoverlay'),
                        taikoBigCircle: pick('taikobigcircle'),
                        taikoBigCircleOverlay: pick('taikobigcircleoverlay'),
                        fruitCatcher: pick('fruit-catcher-idle'),
                        fruit: pick('fruit-pear'),
                        mania4: {
                            notes: skinPreviewManiaPick(pick, mania4 && mania4.noteImages, i => `mania-note${i + 1}`, 4),
                            keys: skinPreviewManiaPick(pick, mania4 && mania4.keyImages, i => `mania-key${i + 1}`, 4),
                            keysPressed: skinPreviewManiaPick(pick, mania4 && mania4.keyImagesPressed, i => `mania-key${i + 1}d`, 4),
                        },
                        mania7: {
                            notes: skinPreviewManiaPick(pick, mania7 && mania7.noteImages, i => `mania-note${i + 1}`, 7),
                            keys: skinPreviewManiaPick(pick, mania7 && mania7.keyImages, i => `mania-key${i + 1}`, 7),
                            keysPressed: skinPreviewManiaPick(pick, mania7 && mania7.keyImagesPressed, i => `mania-key${i + 1}d`, 7),
                        },
                        cursorRotate: iniText ? parseSkinIniGeneralBool(iniText, 'CursorRotate', true) : true,
                        cursorExpand: iniText ? parseSkinIniGeneralBool(iniText, 'CursorExpand', true) : true,
                        colours: iniText ? parseSkinIniColours(iniText) : [],
                        sliderBodyColor: iniText ? parseSkinIniRgb(iniText, 'Colours', 'SliderBody') : null,
                        sliderBorderColor: iniText ? parseSkinIniRgb(iniText, 'Colours', 'SliderBorder') : null,
                        hyperDashColor: iniText ? parseSkinIniRgb(iniText, 'CatchTheBeat', 'HyperDash') : null,
                    });
                });
            } catch { resolve(null); }
        });
    }).catch(() => null));
    skinPreviewCache.set(skinId, promise);
    return promise;
}

const SKIN_PREVIEW_CIRCLE_LOOP_MS = 1400;
const SKIN_PREVIEW_HIT_MS = 1000; // when the hit-circle "pop" and cursor "click" happen
const SKIN_PREVIEW_SLIDER_LOOP_MS = 2200;
const SKIN_PREVIEW_STD_TOTAL_MS = SKIN_PREVIEW_CIRCLE_LOOP_MS + SKIN_PREVIEW_SLIDER_LOOP_MS;
const SKIN_PREVIEW_SLIDER_APPROACH_MS = 500;
const SKIN_PREVIEW_SLIDER_TRAVEL_MS = 1400;
const SKIN_PREVIEW_SLIDER_FADE_MS = 200;
function easeInOutSkinPreview(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }

/* Fills `x,y,w,h` of `img` with `color` without disturbing its alpha shape
   (source-atop only paints where the destination — the image just drawn —
   already has coverage), then falls back to a plain filled circle when
   there's no image at all. Used for taiko don/katsu/big-note tinting and
   catch's hyperdash fruit, both of which need a runtime color the actual
   skin image doesn't encode. */
function drawSkinPreviewTinted(ctx, img, x, y, w, h, tintColor, fallbackColor) {
    if (img) {
        ctx.save();
        ctx.drawImage(img, x, y, w, h);
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = tintColor;
        ctx.fillRect(x, y, w, h);
        ctx.restore();
    } else {
        ctx.fillStyle = fallbackColor;
        ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2); ctx.fill();
    }
}

/* Dispatches to the current mode's draw function — see openSkinPreviewModal
   for how skinPreviewMode gets set from the tab row. Shared background fill
   lives here so every mode's draw function only has to worry about its own
   shapes. */
function drawSkinPreviewFrame(ctx, canvas, images, assets, elapsed, mode) {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#150c22';
    ctx.fillRect(0, 0, w, h);

    if (mode === 'taiko') drawSkinPreviewTaiko(ctx, w, h, images, elapsed);
    else if (mode === 'catch') drawSkinPreviewCatch(ctx, w, h, images, assets, elapsed);
    else if (mode === 'mania') drawSkinPreviewMania(ctx, w, h, images, elapsed);
    else drawSkinPreviewStandard(ctx, w, h, images, assets, elapsed);
}

/* osu! standard alternates a hit circle and a slider each cycle — see the
   two sub-functions below. */
function drawSkinPreviewStandard(ctx, w, h, images, assets, elapsed) {
    const cycleT = elapsed % SKIN_PREVIEW_STD_TOTAL_MS;
    if (cycleT < SKIN_PREVIEW_CIRCLE_LOOP_MS) drawSkinPreviewStdCircle(ctx, w, h, images, assets, cycleT);
    else drawSkinPreviewStdSlider(ctx, w, h, images, assets, cycleT - SKIN_PREVIEW_CIRCLE_LOOP_MS);
}

function drawSkinPreviewStdCircle(ctx, w, h, images, assets, t) {
    const cx = w / 2, cy = h / 2;
    const baseR = w * 0.16;

    let circleScale = 1, circleAlpha = 1, approachScale = null;
    if (t < SKIN_PREVIEW_HIT_MS) {
        approachScale = 3 - (t / SKIN_PREVIEW_HIT_MS) * 2; // shrinks 3x -> 1x onto the circle
    } else {
        const p = (t - SKIN_PREVIEW_HIT_MS) / (SKIN_PREVIEW_CIRCLE_LOOP_MS - SKIN_PREVIEW_HIT_MS);
        circleScale = 1 + p * 0.4;
        circleAlpha = Math.max(0, 1 - p * 1.4);
    }

    if (circleAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = circleAlpha;
        const r = baseR * circleScale;
        if (images.hitcircle) ctx.drawImage(images.hitcircle, cx - r, cy - r, r * 2, r * 2);
        else { ctx.fillStyle = '#f06292'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); }
        if (images.hitcircleOverlay) ctx.drawImage(images.hitcircleOverlay, cx - r, cy - r, r * 2, r * 2);
        const numImg = images.numbers && images.numbers[1];
        if (numImg) {
            const nw = r * 0.5, nh = nw * (numImg.height / numImg.width);
            ctx.drawImage(numImg, cx - nw / 2, cy - nh / 2, nw, nh);
        }
        ctx.restore();
    }
    if (approachScale !== null) {
        const ar = baseR * approachScale;
        ctx.save();
        ctx.globalAlpha = Math.min(1, (SKIN_PREVIEW_HIT_MS - t) / 200 + 0.3);
        if (images.approachCircle) ctx.drawImage(images.approachCircle, cx - ar, cy - ar, ar * 2, ar * 2);
        else { ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, ar, 0, Math.PI * 2); ctx.stroke(); }
        ctx.restore();
    }

    // Cursor swoops in to "click" the circle at the hit moment, then swings
    // back out along a different angle to set up the next loop's approach —
    // continuous motion rather than resetting instantly, so it reads as one
    // gesture repeating rather than a cursor teleporting each loop.
    const outerR = w * 0.375;
    let cxu, cyu, angle, clickPulse = 0;
    if (t <= SKIN_PREVIEW_HIT_MS) {
        const p = easeInOutSkinPreview(t / SKIN_PREVIEW_HIT_MS);
        angle = -Math.PI / 2 + p * 0.7;
        const r = outerR * (1 - p);
        cxu = cx + Math.cos(angle) * r;
        cyu = cy + Math.sin(angle) * r;
        if (t > SKIN_PREVIEW_HIT_MS - 120) clickPulse = 1 - (SKIN_PREVIEW_HIT_MS - t) / 120;
    } else {
        const p = easeInOutSkinPreview((t - SKIN_PREVIEW_HIT_MS) / (SKIN_PREVIEW_CIRCLE_LOOP_MS - SKIN_PREVIEW_HIT_MS));
        angle = -Math.PI / 2 + 0.7 + p * (Math.PI * 2 - 0.7);
        const r = outerR * p;
        cxu = cx + Math.cos(angle) * r;
        cyu = cy + Math.sin(angle) * r;
        if (p < 0.15) clickPulse = 1 - p / 0.15;
    }

    const cursorScale = assets.cursorExpand ? 1 + clickPulse * 0.3 : 1;
    const cursorSize = w * 0.11 * cursorScale;
    ctx.save();
    ctx.translate(cxu, cyu);
    if (images.cursor) {
        if (assets.cursorRotate) ctx.rotate(angle + Math.PI / 2);
        ctx.drawImage(images.cursor, -cursorSize / 2, -cursorSize / 2, cursorSize, cursorSize);
    } else {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(-2, -2); ctx.lineTo(14, 4); ctx.lineTo(2, 8); ctx.lineTo(-2, 16); ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
    // cursormiddle intentionally drawn unrotated on top, same as real osu!.
    if (images.cursorMiddle) {
        const ms = cursorSize * 0.5;
        ctx.drawImage(images.cursorMiddle, cxu - ms / 2, cyu - ms / 2, ms, ms);
    }
}

/* A straight-line slider (a real curved path would need bezier math this
   demo doesn't need) drawn as a thick round-capped stroke — body visible
   for the whole approach+travel+fade window, head circle+approach circle
   during approach, then a ball riding back and forth along it (so it
   reads as a slider with a repeat, not a one-way drag) with the cursor
   tracking the ball 1:1 rather than its own swoop while it's moving. */
function drawSkinPreviewStdSlider(ctx, w, h, images, assets, t) {
    const startX = w * 0.28, startY = h * 0.32;
    const endX = w * 0.72, endY = h * 0.68;
    const baseR = w * 0.13;
    const APPROACH = SKIN_PREVIEW_SLIDER_APPROACH_MS, TRAVEL = SKIN_PREVIEW_SLIDER_TRAVEL_MS, FADE = SKIN_PREVIEW_SLIDER_FADE_MS;

    if (t < APPROACH + TRAVEL + FADE) {
        const bodyAlpha = t > APPROACH + TRAVEL ? Math.max(0, 1 - (t - APPROACH - TRAVEL) / FADE) : 1;
        ctx.save();
        ctx.globalAlpha = bodyAlpha;
        ctx.lineCap = 'round';
        ctx.strokeStyle = assets.sliderBorderColor || '#ffffff';
        ctx.lineWidth = baseR * 2;
        ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(endX, endY); ctx.stroke();
        ctx.strokeStyle = assets.sliderBodyColor ? skinPreviewWithAlpha(assets.sliderBodyColor, 0.85) : 'rgba(20,20,30,0.75)';
        ctx.lineWidth = baseR * 1.6;
        ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(endX, endY); ctx.stroke();
        ctx.restore();
    }

    if (t < APPROACH) {
        const p = t / APPROACH;
        const r = baseR;
        ctx.save();
        if (images.hitcircle) ctx.drawImage(images.hitcircle, startX - r, startY - r, r * 2, r * 2);
        else { ctx.fillStyle = '#f06292'; ctx.beginPath(); ctx.arc(startX, startY, r, 0, Math.PI * 2); ctx.fill(); }
        if (images.hitcircleOverlay) ctx.drawImage(images.hitcircleOverlay, startX - r, startY - r, r * 2, r * 2);
        ctx.restore();
        const ar = baseR * (3 - p * 2);
        ctx.save();
        if (images.approachCircle) ctx.drawImage(images.approachCircle, startX - ar, startY - ar, ar * 2, ar * 2);
        else { ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(startX, startY, ar, 0, Math.PI * 2); ctx.stroke(); }
        ctx.restore();
    }

    let ballX = startX, ballY = startY, ballVisible = false;
    if (t >= APPROACH && t < APPROACH + TRAVEL) {
        const p = (t - APPROACH) / TRAVEL;
        const back = p < 0.5 ? p * 2 : 2 - p * 2; // there and back = one repeat
        ballX = startX + (endX - startX) * back;
        ballY = startY + (endY - startY) * back;
        ballVisible = true;
        const br = baseR * 0.9;
        ctx.save();
        if (images.sliderFollowCircle) ctx.drawImage(images.sliderFollowCircle, ballX - br * 1.6, ballY - br * 1.6, br * 3.2, br * 3.2);
        else { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ballX, ballY, br * 1.5, 0, Math.PI * 2); ctx.stroke(); }
        if (images.sliderBall) ctx.drawImage(images.sliderBall, ballX - br, ballY - br, br * 2, br * 2);
        else { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ballX, ballY, br * 0.6, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
    }

    const outerR = w * 0.375;
    let cx, cy, angle = -Math.PI / 2 + 0.9;
    if (t < APPROACH) {
        const p = easeInOutSkinPreview(t / APPROACH);
        cx = startX + Math.cos(angle) * outerR * (1 - p);
        cy = startY + Math.sin(angle) * outerR * (1 - p);
    } else if (ballVisible) {
        cx = ballX; cy = ballY;
    } else {
        const p = easeInOutSkinPreview(Math.min(1, (t - APPROACH - TRAVEL) / FADE));
        const outAngle = angle + 1.2;
        cx = endX + Math.cos(outAngle) * outerR * p;
        cy = endY + Math.sin(outAngle) * outerR * p;
    }

    ctx.save();
    ctx.translate(cx, cy);
    const cursorSize = w * 0.11;
    if (images.cursor) {
        if (assets.cursorRotate) ctx.rotate(angle + Math.PI / 2);
        ctx.drawImage(images.cursor, -cursorSize / 2, -cursorSize / 2, cursorSize, cursorSize);
    } else {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(-2, -2); ctx.lineTo(14, 4); ctx.lineTo(2, 8); ctx.lineTo(-2, 16); ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
    if (images.cursorMiddle) {
        const ms = cursorSize * 0.5;
        ctx.drawImage(images.cursorMiddle, cx - ms / 2, cy - ms / 2, ms, ms);
    }
}

const SKIN_PREVIEW_TAIKO_LOOP_MS = 1200;
// Stable's actual fixed don/katsu tint colors — used only for the
// no-image fallback circle (see the file-header comment above for why the
// real taikohitcircle.png is never tinted here).
// Alpha kept well under 1 so drawSkinPreviewTinted's source-atop fill still
// lets the real image's own shading/texture show through underneath it.
const TAIKO_DON_COLOR = 'rgba(224,71,63,0.8)', TAIKO_KATSU_COLOR = 'rgba(65,152,209,0.8)';

/* A note scrolls in from the right along the (wide, short — see
   SKIN_PREVIEW_CANVAS_SIZES) lane and pops on arrival at the fixed hit
   position, cycling through don/katsu/big-don/big-katsu each note — taiko
   has no approach circle, so the scroll itself is what reads as "timing". */
function drawSkinPreviewTaiko(ctx, w, h, images, elapsed) {
    const laneY = h / 2;
    const hitX = w * 0.1;
    const r = h * 0.3;

    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, laneY + r * 1.6); ctx.lineTo(w, laneY + r * 1.6); ctx.stroke();
    ctx.beginPath(); ctx.arc(hitX, laneY, r * 1.15, 0, Math.PI * 2); ctx.stroke();

    const cycle = Math.floor(elapsed / SKIN_PREVIEW_TAIKO_LOOP_MS);
    const t = elapsed % SKIN_PREVIEW_TAIKO_LOOP_MS;
    const state = cycle % 4; // 0=don 1=katsu 2=big-don 3=big-katsu
    const isDon = state === 0 || state === 2;
    const isBig = state >= 2;
    const p = t / SKIN_PREVIEW_TAIKO_LOOP_MS;
    const startX = w * 1.05;
    const noteX = startX - p * (startX - hitX);
    const atHit = p > 0.92;
    const alpha = atHit ? Math.max(0, 1 - (p - 0.92) / 0.08) : 1;
    const scale = (isBig ? 1.5 : 1) * (atHit ? 1 + (p - 0.92) / 0.08 * 0.3 : 1);
    const rr = r * scale;

    const circleImg = isBig ? images.taikoBigCircle : images.taikoHitcircle;
    const overlayImg = isBig ? images.taikoBigCircleOverlay : images.taikoHitcircleOverlay;
    const tint = isDon ? TAIKO_DON_COLOR : TAIKO_KATSU_COLOR;

    ctx.save();
    ctx.globalAlpha = alpha;
    drawSkinPreviewTinted(ctx, circleImg, noteX - rr, laneY - rr, rr * 2, rr * 2, tint, tint);
    if (overlayImg) ctx.drawImage(overlayImg, noteX - rr, laneY - rr, rr * 2, rr * 2);
    ctx.restore();
}

const SKIN_PREVIEW_CATCH_LOOP_MS = 1300;
const CATCH_DEFAULT_HYPERDASH_COLOR = 'rgba(255,32,32,0.92)';

/* A fruit drops straight down while the catcher slides underneath to be in
   place exactly when it lands — real catch has the catcher tracking the
   fruit's actual (randomized) x position, simplified here to one fixed
   drop column and a catcher that arrives just in time. Alternates a
   normal fruit with a hyperdash one (tinted with skin.ini's HyperDash
   color, or a default red, the same source-atop way taiko's don/katsu
   tint works) every other drop. */
function drawSkinPreviewCatch(ctx, w, h, images, assets, elapsed) {
    const dropX = w / 2;
    const floorY = h * 0.82;
    const cycle = Math.floor(elapsed / SKIN_PREVIEW_CATCH_LOOP_MS);
    const isHyper = cycle % 2 === 1;
    const t = elapsed % SKIN_PREVIEW_CATCH_LOOP_MS;
    const p = t / SKIN_PREVIEW_CATCH_LOOP_MS;

    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, floorY + h * 0.06); ctx.lineTo(w, floorY + h * 0.06); ctx.stroke();

    const caught = p > 0.85;
    const fruitY = caught ? floorY : h * 0.08 + p / 0.85 * (floorY - h * 0.08);
    const fruitAlpha = caught ? Math.max(0, 1 - (p - 0.85) / 0.15) : 1;
    const fruitR = w * 0.07;
    if (fruitAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = fruitAlpha;
        if (isHyper) {
            const tint = assets.hyperDashColor ? skinPreviewWithAlpha(assets.hyperDashColor, 0.92) : CATCH_DEFAULT_HYPERDASH_COLOR;
            // A glow ring behind the fruit itself, since real hyperdash's
            // main visual cue is the bright trail/glow around it, not just
            // a tinted fruit — makes the state readable even for skins
            // whose fruit-pear.png is already so colorful the tint alone
            // barely shows up against it.
            ctx.save();
            ctx.globalAlpha *= 0.5;
            ctx.fillStyle = tint;
            ctx.beginPath(); ctx.arc(dropX, fruitY, fruitR * 1.6, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            drawSkinPreviewTinted(ctx, images.fruit, dropX - fruitR, fruitY - fruitR, fruitR * 2, fruitR * 2, tint, tint);
        } else if (images.fruit) {
            ctx.drawImage(images.fruit, dropX - fruitR, fruitY - fruitR, fruitR * 2, fruitR * 2);
        } else {
            ctx.fillStyle = '#ff8a3d'; ctx.beginPath(); ctx.arc(dropX, fruitY, fruitR, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }

    const catcherW = w * 0.26;
    const catcherSquash = caught ? 1 - Math.min(1, (p - 0.85) / 0.15 * 4) * 0.15 : 1;
    ctx.save();
    ctx.translate(dropX, floorY);
    ctx.scale(1, catcherSquash);
    if (images.fruitCatcher) {
        ctx.drawImage(images.fruitCatcher, -catcherW / 2, -catcherW * 0.35, catcherW, catcherW * 0.7);
    } else {
        ctx.fillStyle = '#e0d0ff';
        ctx.beginPath();
        ctx.moveTo(-catcherW / 2, catcherW * 0.35); ctx.lineTo(catcherW / 2, catcherW * 0.35);
        ctx.lineTo(catcherW * 0.32, -catcherW * 0.35); ctx.lineTo(-catcherW * 0.32, -catcherW * 0.35);
        ctx.closePath(); ctx.fill();
    }
    ctx.restore();
}

const SKIN_PREVIEW_MANIA_LOOP_MS = 1200;

/* One lane's note falls to the key row and the key lights up (swaps to its
   pressed-state image, or a fallback color change) for a short window on
   arrival, staggered per column so notes cascade across the lane rather
   than falling in lockstep — real mania has each key on its own
   independent chart, this is just enough offset to read as N separate
   lanes rather than one lane repeated. Column count (4K/7K) comes from
   skinPreviewManiaKeys, set by the sub-tabs shown only in this mode (see
   switchSkinPreviewManiaKeys). */
const MANIA_FALLBACK_COLORS = ['#66d9ef', '#a6e22e', '#fd971f', '#f92672', '#ae81ff', '#e6db74', '#75715e'];

function drawSkinPreviewMania(ctx, w, h, images, elapsed) {
    const keyCount = skinPreviewManiaKeys;
    const set = keyCount === 7 ? images.mania7 : images.mania4;
    const totalW = w * 0.9;
    const laneW = totalW / keyCount;
    const startX = (w - totalW) / 2;
    const topY = h * 0.04;
    const keyY = h * 0.82;
    const keyH = h * 0.1;

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.strokeRect(startX, topY, totalW, keyY - topY);
    for (let i = 1; i < keyCount; i++) {
        const x = startX + i * laneW;
        ctx.beginPath(); ctx.moveTo(x, topY); ctx.lineTo(x, keyY); ctx.stroke();
    }

    for (let col = 0; col < keyCount; col++) {
        const offset = (col / keyCount) * SKIN_PREVIEW_MANIA_LOOP_MS;
        const t = (elapsed + offset) % SKIN_PREVIEW_MANIA_LOOP_MS;
        const p = t / SKIN_PREVIEW_MANIA_LOOP_MS;
        const laneX = startX + col * laneW;
        const noteW = laneW * 0.72;
        const noteX = laneX + (laneW - noteW) / 2;

        const pressed = p > 0.88 && p < 0.98;
        const keyImg = pressed ? set.keysPressed[col] : set.keys[col];
        if (keyImg) {
            ctx.drawImage(keyImg, noteX, keyY, noteW, keyH);
        } else {
            ctx.fillStyle = pressed ? 'rgba(244,114,182,0.9)' : 'rgba(255,255,255,0.15)';
            ctx.fillRect(noteX, keyY, noteW, keyH);
        }

        if (p < 0.9) {
            const noteH = h * 0.08;
            const noteY = topY + (p / 0.9) * (keyY - noteH - topY);
            const noteImg = set.notes[col];
            if (noteImg) {
                ctx.drawImage(noteImg, noteX, noteY, noteW, noteH);
            } else {
                ctx.fillStyle = MANIA_FALLBACK_COLORS[col % MANIA_FALLBACK_COLORS.length];
                ctx.fillRect(noteX, noteY, noteW, noteH);
            }
        }
    }
}

let skinPreviewRAF = null;
let skinPreviewStartTime = 0;
let skinPreviewMode = 'standard';
let skinPreviewManiaKeys = 4;

function stopSkinPreviewLoop() {
    if (skinPreviewRAF) { cancelAnimationFrame(skinPreviewRAF); skinPreviewRAF = null; }
}

/* One tab per ruleset, same osu-mode-tabs/osu-tab styling and mode icons
   (modeIconSvg, from js/osu.js) used everywhere else on the site a mode
   needs picking. Switching tabs is a pure state flip — drawSkinPreviewFrame
   reads skinPreviewMode fresh every animation frame, so there's no need to
   re-unzip or restart the loop. */
function renderSkinPreviewModeTabs() {
    const el = document.getElementById('skin-preview-mode-tabs');
    if (!el) return;
    el.innerHTML = OSU_MODES.map(mode => `
        <button class="osu-tab ${mode === skinPreviewMode ? 'active' : ''}" onclick="switchSkinPreviewMode('${mode}', this)">
            ${modeIconSvg(mode)} ${OSU_MODE_LABELS[OSU_MODES.indexOf(mode)]}
        </button>`).join('');
}
function switchSkinPreviewMode(mode, el) {
    skinPreviewMode = mode;
    document.querySelectorAll('#skin-preview-mode-tabs .osu-tab').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    const keysRow = document.getElementById('skin-preview-mania-keys');
    if (keysRow) keysRow.style.display = mode === 'mania' ? 'flex' : 'none';
    resizeSkinPreviewCanvas();
}
function switchSkinPreviewManiaKeys(n, el) {
    skinPreviewManiaKeys = n;
    document.querySelectorAll('#skin-preview-mania-keys .skin-preview-key-btn').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
}

// osu!/catch stay square; taiko goes wide-and-short so its lane has real
// room to scroll across instead of being squeezed into a square box.
const SKIN_PREVIEW_CANVAS_SIZES = { standard: [320, 320], taiko: [320, 130], catch: [320, 320], mania: [320, 320] };
function resizeSkinPreviewCanvas() {
    const canvas = document.getElementById('skin-preview-canvas');
    if (!canvas) return;
    const [w, h] = SKIN_PREVIEW_CANVAS_SIZES[skinPreviewMode] || [320, 320];
    canvas.width = w;
    canvas.height = h;
    canvas.style.aspectRatio = `${w} / ${h}`;
}

async function openSkinPreviewModal(skinId) {
    const modal = document.getElementById('skin-preview-modal');
    const status = document.getElementById('skin-preview-status');
    const coloursEl = document.getElementById('skin-preview-colours');
    const canvas = document.getElementById('skin-preview-canvas');
    if (!modal || !canvas) return;

    stopSkinPreviewLoop();
    skinPreviewMode = 'standard';
    skinPreviewManiaKeys = 4;
    renderSkinPreviewModeTabs();
    resizeSkinPreviewCanvas();
    const keysRow = document.getElementById('skin-preview-mania-keys');
    if (keysRow) {
        keysRow.style.display = 'none';
        keysRow.querySelectorAll('.skin-preview-key-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
    }
    modal.style.display = 'flex';
    document.getElementById('skin-preview-title').textContent = '';
    status.textContent = t('skins_preview_loading');
    coloursEl.innerHTML = '';
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const skins = await getAllSkins();
    const skin = skins.find(s => s.id === skinId);
    if (!skin) { status.textContent = t('skins_preview_fail'); return; }
    document.getElementById('skin-preview-title').textContent = skin.name;

    const assets = await extractSkinPreviewAssets(skinId, skin.file);
    // The modal may have been closed (or reopened for a different skin)
    // while the unzip above was in flight — bail rather than animate into
    // a canvas nobody's looking at, or the wrong skin's canvas.
    if (!assets || document.getElementById('skin-preview-modal').style.display === 'none') {
        if (assets === null) status.textContent = t('skins_preview_fail');
        return;
    }

    const images = {};
    const imageKeys = [
        'cursor', 'cursorMiddle', 'hitcircle', 'hitcircleOverlay', 'approachCircle',
        'sliderBall', 'sliderFollowCircle',
        'taikoHitcircle', 'taikoHitcircleOverlay', 'taikoBigCircle', 'taikoBigCircleOverlay',
        'fruitCatcher', 'fruit',
    ];
    await Promise.all(imageKeys.map(async key => {
        if (assets[key]) images[key] = await loadImageQuiet(assets[key]);
    }));
    const loadUrlList = (list) => Promise.all(list.map(url => url ? loadImageQuiet(url) : Promise.resolve(null)));
    images.numbers = await loadUrlList(assets.numbers);
    images.mania4 = {
        notes: await loadUrlList(assets.mania4.notes),
        keys: await loadUrlList(assets.mania4.keys),
        keysPressed: await loadUrlList(assets.mania4.keysPressed),
    };
    images.mania7 = {
        notes: await loadUrlList(assets.mania7.notes),
        keys: await loadUrlList(assets.mania7.keys),
        keysPressed: await loadUrlList(assets.mania7.keysPressed),
    };

    if (document.getElementById('skin-preview-modal').style.display === 'none') return;
    status.textContent = '';
    if (assets.colours.length) {
        coloursEl.innerHTML = assets.colours.map(c => `<span class="skin-preview-colour-dot" style="background:${c}"></span>`).join('');
    }

    skinPreviewStartTime = performance.now();
    const loop = (now) => {
        drawSkinPreviewFrame(ctx, canvas, images, assets, now - skinPreviewStartTime, skinPreviewMode);
        skinPreviewRAF = requestAnimationFrame(loop);
    };
    skinPreviewRAF = requestAnimationFrame(loop);
}

function closeSkinPreviewModal() {
    const modal = document.getElementById('skin-preview-modal');
    if (modal) modal.style.display = 'none';
    stopSkinPreviewLoop();
}

async function confirmDeleteCloudSkin(id) {
    if (!confirm(t('skins_delete_confirm'))) return;
    const token = getOsuAuthToken();
    if (!token) { showShareToast(t('skins_backup_login_required')); return; }
    try {
        const res = await fetch('/.netlify/functions/skins-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ id }),
        });
        if (!res.ok) throw new Error('delete failed');
        renderCloudSkinsList();
    } catch (e) {
        console.error('Cloud skin delete failed:', e);
        showShareToast(t('skins_backup_fail'));
    }
}
