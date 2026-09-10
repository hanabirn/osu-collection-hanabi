/* Ambient declarations for checkJs (see jsconfig.json).
 *
 * The js/*.js files are global-scope scripts, not ES modules, so TypeScript
 * already resolves top-level `function foo(){}` across files on its own — most
 * cross-file calls need nothing here. This file only covers what TS genuinely
 * cannot see:
 *   - non-standard browser APIs the code feature-detects
 *   - the `window.__LANG` hook set by the inline bootstrap in index.html
 *
 * Phase 3 (ES modules) removes the need for most of this.
 */

interface Window {
    /** File System Access API — Chromium only, feature-detected in js/main.js */
    showDirectoryPicker?: (options?: {
        id?: string;
        mode?: 'read' | 'readwrite';
        startIn?: string;
    }) => Promise<FileSystemDirectoryHandle>;

    /** Optional locale override injected by the pre-paint script in index.html */
    __LANG?: string;

    /** A couple of handlers are deliberately published on window (site-likes.js) */
    shareSite?: (...args: unknown[]) => unknown;
    toggleSiteLike?: (...args: unknown[]) => unknown;
}

/** Set in index.html before any js/ script runs. */
declare var __LANG: string | undefined;
