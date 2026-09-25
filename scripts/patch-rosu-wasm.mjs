/* 產生 worker/vendor/rosu-pp-js.js：rosu-pp-js 的 Workers 相容版本。
 *
 * 問題：套件原本用
 *     const path = require('path').join(__dirname, 'rosu_pp_js_bg.wasm');
 *     const bytes = require('fs').readFileSync(path);
 *     const wasmModule = new WebAssembly.Module(bytes);
 * 來載入 802 KB 的 WASM。Workers 沒有 __dirname 也沒有檔案系統，
 * 這行會在模組載入階段就炸掉（實測: ReferenceError: __dirname is not defined）。
 *
 * 做法：Workers 支援把 .wasm 當模組 import，拿到的直接就是
 * WebAssembly.Module。worker/index.js 在 ESM import 階段先把它放上
 * globalThis（ESM import 保證先於模組主體執行），這個修補版再從那裡取用。
 * 除了這幾行載入程式碼，95 KB 的膠水碼一個字都沒動。
 *
 * 每次 build 前重新產生，套件升版時不會悄悄用到舊的修補版。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'netlify/functions/node_modules/rosu-pp-js/rosu_pp_js.js');
const OUT_DIR = join(ROOT, 'worker/vendor');
const OUT = join(OUT_DIR, 'rosu-pp-js.js');

const ORIGINAL_LOADER = `const path = require('path').join(__dirname, 'rosu_pp_js_bg.wasm');
const bytes = require('fs').readFileSync(path);

const wasmModule = new WebAssembly.Module(bytes);`;

const WORKERS_LOADER = `/* --- 由 scripts/patch-rosu-wasm.mjs 置換 ---
   原本是 fs.readFileSync(__dirname + '/rosu_pp_js_bg.wasm')，
   Workers 沒有檔案系統。改由 worker/index.js 以 ESM import 取得
   WebAssembly.Module 後掛在 globalThis 上（import 先於模組主體執行）。 */
const wasmModule = globalThis.__ROSU_WASM_MODULE__;
if (!wasmModule) {
    throw new Error(
        'rosu-pp 的 WASM 模組不存在：worker/index.js 應在 require 路由前 import ' +
            'rosu_pp_js_bg.wasm 並指派給 globalThis.__ROSU_WASM_MODULE__',
    );
}`;

/* Netlify 也跑同一個 npm run build，但它的建置環境不一定有
   netlify/functions/node_modules（函式相依由它自己的外掛另外安裝）。
   這份修補只有 Cloudflare 的打包需要，來源不在就跳過，不要讓
   整個建置失敗——否則連舊站的轉址都部署不上去。 */
let src;
try {
    src = await readFile(SRC, 'utf8');
} catch {
    console.log('找不到 rosu-pp-js 來源，略過修補（只有 Cloudflare 打包需要）');
    process.exit(0);
}

if (!src.includes(ORIGINAL_LOADER)) {
    console.error('找不到預期的 WASM 載入片段 —— rosu-pp-js 可能升版了，請重新確認修補內容。');
    process.exit(1);
}

const patched = src.replace(ORIGINAL_LOADER, WORKERS_LOADER);

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT, patched, 'utf8');

console.log(`worker/vendor/rosu-pp-js.js 已產生（置換 WASM 載入方式，其餘原封不動）`);
