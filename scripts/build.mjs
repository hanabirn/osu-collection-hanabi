/* Deploy-time build: copy the static site into dist/, minifying every CSS
   and JS file in place. Netlify runs `npm run build` then publishes dist/
   (see netlify.toml). Local dev still serves the unminified source
   directly — this only runs on deploy.

   Minify only: no bundling, no filename hashing, no tree-shaking. Every
   file keeps its path and its global identifiers (the site wires onclick=""
   handlers to global function names, so renaming them would break it —
   esbuild leaves top-level names alone when not bundling). --charset=utf8
   keeps the CJK content readable and gzip-friendly instead of \uXXXX. */
import { rm, mkdir, cp, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { transform } from 'esbuild';
import * as OpenCC from 'opencc-js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'dist');

/* Generate js/i18n/zh-Hans.js (Simplified) from js/i18n/zh.js (Traditional,
   the hand-edited source of truth) via OpenCC's Taiwan-idiom -> Mainland
   conversion, which handles vocab (記憶體->内存, 螢幕->屏幕, 影片->视频) not
   just characters. Written into the source tree (gitignored) so both a
   repo-root dev server and the dist/ build pick it up. */
async function genSimplifiedLocale() {
    const src = await readFile(join(ROOT, 'js/i18n/zh.js'), 'utf8');
    const sandbox = { I18N: {} };
    vm.runInNewContext(src, sandbox, { filename: 'zh.js' });
    const zh = sandbox.I18N.zh;
    const conv = OpenCC.Converter({ from: 'twp', to: 'cn' });
    const hans = {};
    for (const [k, v] of Object.entries(zh)) hans[k] = typeof v === 'string' ? conv(v) : v;
    const out = 'I18N["zh-Hans"] = ' + JSON.stringify(hans) + ';\n';
    await writeFile(join(ROOT, 'js/i18n/zh-Hans.js'), out);
    return Object.keys(hans).length;
}

// Copied verbatim.
const COPY = ['index.html', 'manifest.json', 'assets'];
// Directories whose .css / .js files are minified into dist/, plus loose
// root files.
const MINIFY_DIRS = ['css', 'js'];
const MINIFY_ROOT_FILES = ['sw.js'];

async function walk(dir) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...await walk(p));
        else out.push(p);
    }
    return out;
}

async function minifyFile(absSrc, relPath, srcOverride) {
    const ext = extname(absSrc);
    const loader = ext === '.css' ? 'css' : 'js';
    const src = srcOverride !== undefined ? srcOverride : await readFile(absSrc, 'utf8');
    const { code, warnings } = await transform(src, {
        loader,
        minify: true,
        charset: 'utf8',
        legalComments: 'none',
    });
    for (const w of warnings) console.warn(`  ! ${relPath}: ${w.text}`);
    const dest = join(OUT, relPath);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, code);
    return { relPath, before: Buffer.byteLength(src), after: Buffer.byteLength(code) };
}

async function cleanOut() {
    // rm -rf, but tolerate a transient lock on the dir itself (OneDrive /
    // AV on Windows can hold the handle briefly) — clearing the contents is
    // enough for a correct rebuild.
    for (let attempt = 0; ; attempt++) {
        try { await rm(OUT, { recursive: true, force: true }); return; }
        catch (e) {
            if (attempt >= 5) {
                try {
                    for (const entry of await readdir(OUT)) {
                        await rm(join(OUT, entry), { recursive: true, force: true });
                    }
                    return;
                } catch { throw e; }
            }
            await new Promise(r => setTimeout(r, 400));
        }
    }
}

async function main() {
    const hansKeys = await genSimplifiedLocale();
    console.log(`generated js/i18n/zh-Hans.js (${hansKeys} keys)`);

    await cleanOut();
    await mkdir(OUT, { recursive: true });

    for (const item of COPY) {
        await cp(join(ROOT, item), join(OUT, item), { recursive: true });
    }

    const targets = [];
    for (const d of MINIFY_DIRS) {
        for (const f of await walk(join(ROOT, d))) {
            if (['.css', '.js'].includes(extname(f))) targets.push(f);
        }
    }
    for (const f of MINIFY_ROOT_FILES) targets.push(join(ROOT, f));

    let totalBefore = 0, totalAfter = 0;
    for (const abs of targets) {
        const rel = abs.slice(ROOT.length).replace(/^[/\\]/, '');
        if (rel === 'sw.js') continue; // last, once the site's id is known
        const r = await minifyFile(abs, rel);
        totalBefore += r.before;
        totalAfter += r.after;
    }

    // The update notes as JSON, for the worker's Discord announcer
    // (worker/changelog-announce.js), which can't run the browser file itself.
    const clSrc = await readFile(join(ROOT, 'js/site-changelog-data.js'), 'utf8');
    const clBox = {};
    vm.runInNewContext(`${clSrc}\n;this.out = SITE_CHANGELOG;`, clBox, { filename: 'site-changelog-data.js' });
    await writeFile(join(OUT, 'changelog.json'), JSON.stringify(clBox.out));

    // sw.js's BUILD_ID: a hash of the site's own files, so the "site updated"
    // prompt (see sw.js) comes only when something visitors load changed, not on
    // a deploy that only touched the Discord bot or the server functions. The
    // update notes are left out: a bot-only entry there isn't a site change.
    const hash = createHash('sha256');
    for (const abs of (await walk(OUT)).sort()) {
        const rel = abs.slice(OUT.length).replace(/^[/\\]/, '').replace(/\\/g, '/');
        if (rel === 'sw.js' || rel === 'changelog.json' || rel === 'js/site-changelog-data.js') continue;
        hash.update(rel);
        hash.update(await readFile(abs));
    }
    const buildId = hash.digest('hex').slice(0, 12);
    const swAbs = join(ROOT, 'sw.js');
    const swSrc = (await readFile(swAbs, 'utf8')).replace("const BUILD_ID = 'dev';", `const BUILD_ID = '${buildId}';`);
    const sw = await minifyFile(swAbs, 'sw.js', swSrc);
    totalBefore += sw.before;
    totalAfter += sw.after;
    console.log(`site id ${buildId}`);

    const pct = ((1 - totalAfter / totalBefore) * 100).toFixed(1);
    console.log(`minified ${targets.length} files: ${(totalBefore / 1024).toFixed(0)} KiB -> ${(totalAfter / 1024).toFixed(0)} KiB (-${pct}%)`);
    console.log(`dist/ ready`);
}

main().catch(e => { console.error(e); process.exit(1); });
