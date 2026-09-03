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
import { transform } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'dist');

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

async function minifyFile(absSrc, relPath) {
    const ext = extname(absSrc);
    const loader = ext === '.css' ? 'css' : 'js';
    const src = await readFile(absSrc, 'utf8');
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
        const r = await minifyFile(abs, rel);
        totalBefore += r.before;
        totalAfter += r.after;
    }

    const pct = ((1 - totalAfter / totalBefore) * 100).toFixed(1);
    console.log(`minified ${targets.length} files: ${(totalBefore / 1024).toFixed(0)} KiB -> ${(totalAfter / 1024).toFixed(0)} KiB (-${pct}%)`);
    console.log(`dist/ ready`);
}

main().catch(e => { console.error(e); process.exit(1); });
