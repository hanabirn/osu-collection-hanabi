/* Netlify "ignore" command — decides whether a push actually needs a fresh
   build + deploy. Wired up in netlify.toml as `ignore = "node scripts/should-build.mjs"`.

   Exit 0  => tell Netlify to SKIP the build (no build minutes / credits spent).
   Exit !0 => let the build run.

   We skip whenever the range of commits since the last successful build only
   touched paths that never reach the deployed site — docs/, mp-bot/,
   catch-tracker/, the READMEs, .gitignore, etc. The list below is the inverse: the paths that DO
   feed dist/ (see scripts/build.mjs COPY + MINIFY_DIRS + MINIFY_ROOT_FILES),
   the functions dir, and anything that changes how the build runs. */
import { execFileSync } from 'node:child_process';

const RELEVANT = [
    'css', 'js', 'scripts', 'assets',
    'index.html', 'manifest.json', 'sw.js',
    'netlify', 'netlify.toml', 'package.json', 'package-lock.json',
];

// On a brand-new site's first-ever deploy, Netlify sets CACHED_COMMIT_REF to
// the SAME commit as COMMIT_REF (not empty) — a naive `|| 'HEAD^'` fallback
// never triggers in that case, `git diff SHA..SHA` is trivially empty, and
// the first deploy skips itself (found while setting up catch-tracker/'s
// sibling script). Treat base===head as "no usable cache" too.
const head = process.env.COMMIT_REF || 'HEAD';
const cached = process.env.CACHED_COMMIT_REF;
const base = (cached && cached !== head) ? cached : 'HEAD^';

try {
    // `git diff --quiet` exits 0 when there is NO change in the given paths,
    // and 1 (throws here) when there is. A bad/unknown ref also throws — in
    // that case we fall through to "build", which is the safe default.
    execFileSync('git', ['diff', '--quiet', base, head, '--', ...RELEVANT], { stdio: 'ignore' });
    console.log(`should-build: no deploy-relevant changes in ${base}..${head} — skipping build.`);
    process.exit(0); // skip
} catch {
    console.log(`should-build: deploy-relevant changes in ${base}..${head} — building.`);
    process.exit(1); // build
}
