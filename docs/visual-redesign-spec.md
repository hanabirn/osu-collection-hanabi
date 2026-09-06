# osu! 歌曲收藏 — 視覺改版方向

> 目的：把現在「裝飾多、對比低、東西糊在一起」的外觀，換成「近黑底、大留白、克制的粉、字級有節奏」的方向。
> 參考：`osu-taiwan-hub.com`（朋友的站）。它的氣質不是來自美術素材多（整站幾乎沒有圖），而是**克制**。
> 範圍：這份文件是完整方向規格。實作分階段、一個 commit 一步（見 §10），不一次全站打掉。
> 保留的識別：粉色主調、封面圖（改成「被框住的 hero」而非整頁背景）、站名 `osu! 歌曲收藏`。

---

## 1. 目標 / 非目標

**目標**
- 主內容區直接坐在近黑底上（拿掉毛玻璃雙層面板）→ 視覺更利落、順便省掉 2–3 層 `backdrop-filter`
- 每個區塊有「小 eyebrow 標籤 + 大標題」的節奏
- 粉色回到「點綴」的角色：eyebrow、主要 CTA、一個焦點視覺
- 一個訂製主視覺（logo lockup，CSS/SVG 做）當全站的美術錨點
- 間距整體放大

**非目標**
- 不改資訊架構、不動任何功能邏輯、不改 tab 結構
- 不做全站一次性重寫（漸進落地）
- 不加會拖效能的東西（見 §9）——這次改版要讓效能持平或更好

---

## 2. 診斷

| | 現況（osu! 歌曲收藏） | 參考站 | 改版後 |
|---|---|---|---|
| 底 | 4 段紫色漸層 + 整頁收藏封面圖打模糊 | `#09090e` 平塗近黑 | `#0b0b10` 平塗近黑，封面圖只留在被框住的 hero |
| 面板 | 毛玻璃 `.site-main` tray + 上面再疊 `.site-page` 卡 | 無中央面板，內容直接在黑底上 | 內容直接在黑底上，`.site-main`/`.site-page` 變透明無 blur |
| 對比 | 紫字配紫底，低 | 近白字配近黑，高 | 近白 `#f4f2f7` 配近黑，高 |
| 裝飾 | 粒子 canvas、浮動地球、hit-circle、到處 glow | 一顆發光 orb + 極淡放射光暈 | 一個 logo lockup（唯一允許的 glow）+ 極淡 vignette |
| accent | 粉＋紫＋青，用得滿 | 粉極省、青更省 | 粉極省（eyebrow / CTA / lockup），青極省 |
| 字 | 系統字，字級平、無 eyebrow 節奏 | 82px/900/字距 -4px 標題 + 12px/800/+2.5px 粉色 eyebrow | 見 §4.2 字級系統 |
| 卡片 | 重陰影 `0 8px 30px rgba(0,0,0,.5)` | 5% 白填色 + `rgba(255,255,255,.14)` <1px 邊、無陰影 | 3–5% 白填色 + 1px 髮絲邊、hover 才有淡粉光 |

---

## 3. 設計原則

1. **近黑底、高對比**。所有東西在近黑上都會跳出來，就不需要靠邊框/陰影硬撐層次。
2. **敢空**。區塊之間、卡片之間的間距往上加。留白是設計，不是浪費。
3. **粉是點綴不是背景**。一個畫面裡粉色出現的地方 ≤ 3 處（eyebrow / 主 CTA / 焦點）。
4. **一個主視覺**。logo lockup 是全站唯一的美術錨點，也是唯一允許的 glow。其他地方不放大圖、不加光暈。
5. **字級撐節奏**。每個區塊 = 小 eyebrow（大寫、加寬字距、粉）+ 大標題（粗、負字距）。
6. **動態幾乎不可見**。淡入 / 8px 滑入 / 180–260ms。沒有永動的東西。

---

## 4. Design tokens

新的 `css/theme.css`。深色為主，淺色維持可用但次要。

### 4.1 色彩

```css
:root {
  /* 底 & 面 */
  --bg:            #0b0b10;   /* 平塗，取代現在的 4 段漸層 */
  --bg-modal:      #121218;   /* modal / drawer 實色，不再毛玻璃 */
  --surface-1:     rgba(255,255,255,0.03);  /* 卡片基礎填色 */
  --surface-2:     rgba(255,255,255,0.055); /* hover / 次級面 */
  --border:        rgba(255,255,255,0.08);  /* 髮絲邊 */
  --border-strong: rgba(255,255,255,0.14);  /* modal / 分隔 */

  /* 文字 */
  --text:        #f4f2f7;
  --text-dim:    rgba(244,242,247,0.62);
  --text-faint:  rgba(244,242,247,0.40);

  /* accent（保留現在的粉） */
  --pink:        #f472b6;
  --pink-rgb:    244,114,182;
  --pink-bright: #ff5fa8;   /* 只給 lockup 的光暈用 */
  --cyan:        #22d3ee;   /* 極稀有的第二 accent */
  --cyan-rgb:    34,211,238;

  /* 狀態 */
  --good:  #34d399;
  --warn:  #fbbf24;
  --bad:   #f87171;

  /* 半徑 / 動態 */
  --r-card:  12px;
  --r-modal: 18px;
  --r-pill:  999px;
  --ease:    cubic-bezier(0.16, 1, 0.3, 1);
  --dur:     220ms;
}

:root[data-theme="light"] {
  --bg:            #faf8fc;
  --bg-modal:      #ffffff;
  --surface-1:     rgba(20,16,28,0.03);
  --surface-2:     rgba(20,16,28,0.06);
  --border:        rgba(20,16,28,0.10);
  --border-strong: rgba(20,16,28,0.16);
  --text:        #1a1523;
  --text-dim:    rgba(26,21,35,0.66);
  --text-faint:  rgba(26,21,35,0.45);
  --pink:        #db2777;  /* 淺底上壓深一點的粉 */
  --pink-rgb:    219,39,119;
}
```

規則：
- **陰影預設沒有**。只有 hover、且只有「有意義的互動元件」（卡片、主 CTA）才給一層 `0 0 20px rgba(var(--pink-rgb),0.18)` 之類的淡粉光。
- 青色一個畫面最多一處，且不是必要資訊的載體。
- 現有 `--accent-purple` / `--accent-light-purple` 逐步淘汰；連結色從紫改成 `--text`（底線 hover）或 `--pink`。

### 4.2 字體

現在**沒有載任何 web font**（效能取捨，見 [perf-pass-2026-09]）。兩個方案：

**方案 A（推薦，零 web font，守住效能）**
純靠系統字的字重/字級/字距做出「editorial」感：
```css
--font-display: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; /* 拉丁標題 */
--font-cjk:     "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif; /* 內文/中文，維持現狀 */
--font-mono:    ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace; /* eyebrow 標籤 */
```

**方案 B（質感再上一階，代價 ~20–30KB）**
拉丁標題與 eyebrow 換一支 display 字（`Space Grotesk` 或 `Geist`——朋友用 Geist）。條件：
- 自 host `.woff2`、`font-display: swap`、**只 subset 拉丁 + 數字 + 基本標點**
- `<link rel="preload" as="font" crossorigin>` 非阻塞
- 只有一支檔案，中文/內文一律維持系統字

> 先照方案 A 做第一版，看你覺得夠不夠再決定要不要上 B。

**字級系統**（`clamp(手機, vw, 桌面)`）：

| 用途 | class | size | weight | letter-spacing | 其他 |
|---|---|---|---|---|---|
| Hero 標題 | `.hero-title` | `clamp(2rem, 6vw, 3.4rem)` | 800 | `-0.03em` | line-height 1.05 |
| 區塊標題 | `.section-title` | `clamp(1.35rem, 3vw, 1.9rem)` | 800 | `-0.02em` | |
| eyebrow 標籤 | `.eyebrow` | `0.72rem` (11–12px) | 700 | `0.14em` | `text-transform: uppercase`；色 `--pink`；`--font-mono` |
| 卡片標題 | `.osu-card-title` | `0.85rem` | 700 | 0 | 維持 |
| 內文 | body | `0.9rem` | 400 | 0 | line-height 1.6 |
| 次要/說明 | `.hint` | `0.8rem` | 400 | 0 | 色 `--text-dim` |

---

## 5. 版面骨架（外殼重構）

### 5.1 `body`
```css
body {
  background: var(--bg);              /* 平塗，刪掉 linear-gradient(160deg, …) */
  color: var(--text);
}
```
- **刪掉 `body::before` 的整頁封面圖層**、`.bg-slide` / `.bg-glow`（[mobile-thermal-fix] 桌機其實已經拿掉大部分）。
- 最多留一個**極淡、固定、壓很暗**的 vignette：`radial-gradient(120% 80% at 50% -10%, rgba(var(--pink-rgb),0.05), transparent 60%)` 疊在 `body` 上，不動、不隨收藏變。

### 5.2 Header
- 縮小成一條：左邊 logo lockup（小版，見 §7），右邊控制項（登入/語言/通知/…）。
- **刪掉 `.site-header.has-cover-banner` 的巨型封面 banner 行為**。header 就是平的近黑，底部一條 `1px var(--border)`。
- sticky 時可保留**唯一一處** `backdrop-filter: blur(8px)` + `background: rgba(11,11,16,0.8)`，其他地方全部拿掉。

### 5.3 `.site-main` / `.site-page`
- `.site-main`：只當置中容器 —— `max-width: 1120px; margin-inline: auto; padding-inline: clamp(16px, 4vw, 32px)`。**透明、無 blur、無 border、無負 margin**。
- `.site-page`：**透明、無 blur、無卡片底**。內容直接坐在 `--bg` 上。
- 移除 `.site-main` / `.site-page` / `.site-header` 三層 nested `backdrop-filter`（base.css 目前有）。

### 5.4 區塊節奏
每個主要區塊統一長這樣：
```html
<section class="block">
  <p class="eyebrow">COLLECTION</p>
  <h2 class="section-title">我的收藏</h2>
  <div class="block-body"> … </div>
</section>
```
```css
.block { margin-bottom: clamp(40px, 7vw, 88px); }
.eyebrow { /* §4.2 */ margin-bottom: 8px; }
.section-title { margin-bottom: clamp(16px, 3vw, 28px); }
```

---

## 6. 元件處理

### 6.1 卡片（`.osu-card`、gallery、catalog、farm…）
- 保留封面圖（收藏站的封面就是重點）。
- `border-radius: var(--r-card)`；`border: 1px solid var(--border)`；**刪掉 `--osu-card-shadow`**。
- overlay 漸層維持（讓標題可讀）。
- hover：`transform: translateY(-2px)` + `border-color: rgba(var(--pink-rgb),0.35)` + `box-shadow: 0 0 20px rgba(var(--pink-rgb),0.16)`。
- `transition: transform var(--dur) var(--ease), border-color var(--dur), box-shadow var(--dur)`。

### 6.2 按鈕
| | 樣式 |
|---|---|
| primary（`.btn`） | `background: var(--pink)`；`color: #14101c`；`border: none`；`border-radius: 10px`；`font-weight: 700` |
| secondary | `background: transparent`；`border: 1px solid var(--border)`；`color: var(--text-dim)`；hover → `border-color: var(--pink)`、`color: var(--text)` |
| pill（`.lang-pill` 等） | `background: var(--surface-1)`；`border: 1px solid var(--border)`；active → `background: rgba(var(--pink-rgb),0.14)`、`border-color: rgba(var(--pink-rgb),0.5)`、`color: var(--text)` |

一個畫面裡 primary 按鈕原則上只有一顆。

### 6.3 Modal（`.pp-calc-modal-overlay` / `.pp-calc-modal` 及所有共用它的 modal）
- overlay：`background: rgba(0,0,0,0.62)`；**無 blur**。
- panel：`background: var(--bg-modal)`（實色 `#121218`）；`border: 1px solid var(--border-strong)`；`border-radius: var(--r-modal)`；`box-shadow: 0 24px 80px rgba(0,0,0,0.5)`（modal 是唯一保留大陰影的地方，用來跟 overlay 拉開）。
- 移除 modal 的 `backdrop-filter`。

### 6.4 Nav drawer
- `background: #0f0f14` 實色；項目之間 `1px var(--border)` 分隔；**無 blur**。
- group label 用 `.eyebrow` 樣式。

### 6.5 粒子 / 地球 / hit-circle
- 預設**不載**。[mobile-thermal-fix] 手機已經 `display:none`；這次桌機也拿掉（或收進「設定」裡的 opt-in 開關）。
- `css/particles.css` + `js/particles.js`：改成 gated（預設關）或直接刪。

---

## 7. 主視覺：logo lockup（CSS / SVG）

全站唯一的美術錨點。兩個尺寸：**header 小版** + **收藏首頁 hero 大版**。

### 7.1 構成
```
[ ◯ osu! ]  歌曲收藏
  ↑ 粉色細環 + 內部 osu! 標記      ↑ CJK 粗體
```
- `osu!` 標記：可用一個 inline SVG（粉色圓 + 白字 `osu!`，比照 osu! 官方 logo 的縮小版），或純文字 `osu!` 配 `--font-display` 800。
- **粉色細環**：SVG `<circle>`，`stroke: var(--pink)`、`stroke-width: 1.5`、`fill: none`，外圍加 `filter: drop-shadow(0 0 12px rgba(var(--pink-rgb),0.55))`。**這是全站唯一允許的 glow。**
- `歌曲收藏`：`--font-cjk`、`font-weight: 800`、`letter-spacing: 0.02em`。

### 7.2 SVG（環的部分，可直接用）
```html
<span class="logo-lockup">
  <svg class="logo-mark" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
    <circle cx="24" cy="24" r="21" fill="none"
            stroke="var(--pink)" stroke-width="1.5"
            style="filter: drop-shadow(0 0 10px rgba(var(--pink-rgb),0.55))"/>
    <text x="24" y="30" text-anchor="middle"
          font-size="16" font-weight="800" fill="var(--text)"
          font-family="var(--font-display)">osu!</text>
  </svg>
  <span class="logo-word">歌曲收藏</span>
</span>
```

### 7.3 尺寸
| | mark viewBox 顯示 | 環 stroke | `歌曲收藏` | 用在 |
|---|---|---|---|---|
| 小版 | 28px | 1.25 | 15px / 700 | header 左上 |
| Hero 大版 | 60px | 1.75 | `clamp(1.6rem, 4vw, 2.2rem)` / 800 | `#page-collection` 頂端 |

### 7.4 收藏首頁 hero（保留封面圖的地方）
一個**被框住**的 hero 容器（不是整頁背景）：
```css
.collection-hero-v2 {
  position: relative;
  border-radius: 20px;
  overflow: hidden;
  border: 1px solid var(--border);
  padding: clamp(28px, 6vw, 56px);
  min-height: 240px;
  display: flex; flex-direction: column; justify-content: flex-end; gap: 14px;
}
.collection-hero-v2::before {                 /* 封面圖層 */
  content: ""; position: absolute; inset: 0;
  background: var(--hero-cover, none) center/cover;
  /* --hero-cover 由 JS 設成當前 featured / 收藏第一張的 cover url */
}
.collection-hero-v2::after {                   /* 壓暗漸層，讓 lockup 讀得到 */
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(11,11,16,0.35) 0%, rgba(11,11,16,0.86) 70%, var(--bg) 100%);
}
.collection-hero-v2 > * { position: relative; z-index: 1; }
```
- 內容：hero 大版 lockup + 一行 tagline（`--text-dim`）+（收藏非空時）一句「N 張圖 · M 個分類」的 `.eyebrow` 統計。
- 收藏是空的 → 封面圖層改成純 `--bg` + 一個 CTA。
- 這是全站**唯一**還會出現大封面圖的地方。

---

## 8. 保留的識別（明確清單）

- **粉色 `#f472b6`**：留，但降級成點綴（§3 原則 3）。
- **封面圖**：留，但只在 §7.4 的框住 hero 裡，不再當整頁背景。
- **站名 `osu! 歌曲收藏`**：留（rebrand 已經試過又退掉，見 [osu-collection-site-owner]）。
- **osu! 官方視覺語彙**（粉色圓、mode 圖示、mod hexagon…）：留，這些是社群慣例。
- **淺色主題**：留（維持可切換），但深色近黑是主方向；淺色做到不破就好。

不保留：紫色主調、整頁封面背景、毛玻璃雙層面板、粒子/地球/hit-circle 裝飾、到處的 glow。

---

## 9. 效能守則（不可違反）

參考 [perf-pass-2026-08]、[perf-pass-2026-09]、[mobile-thermal-fix]。這次改版**必須讓效能持平或更好**：

- **不新增任何 render-blocking `<link>`**。若走字體方案 B：自 host、`font-display: swap`、拉丁 subset、`preload` 非阻塞、單一檔案 <30KB。
- **主內容路徑上的 `backdrop-filter` 目標歸零**（現在 `.site-main`/`.site-page`/`.site-header`/modal 各一層）。最多保留 sticky header 一處。
- 平塗底色取代「漸層 + 整頁封面圖」→ 更少 paint、更少 layer。
- 粒子預設關（見 §6.5）。
- **零永動 CSS 動畫**（現在的殘留也一併清）。
- 目標：行動版 Lighthouse 效能 ≥ 目前（91）、實際 CLS 0、hero 用 `min-height` 佔位不位移。

---

## 10. 落地順序（每步一個 commit）

1. **`css/theme.css`** — 換成 §4 的 token 組（深＋淺）。此時全站會先「變色」但版面還沒動。
2. **`css/base.css` 外殼** — `body` 平塗、`.site-main`/`.site-page`/`.site-header` 去玻璃去卡、新增 `.block`/`.eyebrow`/`.section-title`/`.logo-lockup`、拿掉 cover-banner 行為。
3. **收藏首頁**（`#page-collection`）— 框住 hero（§7.4）、每個區塊套 eyebrow + section-title。這步做完先給你看、收斂 3–4 輪。
4. **`css/osu.css` 元件 pass** — 卡片、按鈕、pill、modal 外殼（§6）。
5. **其他 tab** — 大多吃到外殼就對了；逐一巡視、個別微調。
6. **淺色主題** parity 檢查。
7. **粒子/地球** gated 或刪（§6.5）；清永動動畫殘留。
8. 正式站效能 + 視覺 QA（行動版 Lighthouse、CLS、各 tab 掃一遍）。

---

## 11. 檔案影響清單

| 檔 | 動作 |
|---|---|
| `css/theme.css` | 重寫 token 值（§4） |
| `css/base.css` | `body` 底、`.site-main`/`.site-page`/`.site-header` 去玻璃、`body::before` 封面層刪、新 `.block`/`.eyebrow`/`.section-title`/`.logo-lockup`/`.collection-hero-v2`、cover-banner 行為刪 |
| `css/osu.css` | `.osu-card` 去重陰影+新 hover、`.btn`/`.lang-pill`、`.pp-calc-modal*` 去 blur 換實色、`--osu-card-shadow` 用處清掉、連結色 |
| `css/particles.css` | gated 或刪 |
| `index.html` | header + 收藏首頁加 logo lockup markup、各 section 加 `.eyebrow`/`.section-title`、移除 `body::before` / 粒子 canvas 掛點、`has-cover-banner` 相關 class |
| `js/particles.js` | gated（預設關）或刪 |
| `js/osu.js` | `renderFeaturedBeatmap` / 現有 hero 封面邏輯 → 改成餵 `.collection-hero-v2` 的 `--hero-cover`，而非設整頁背景 |
| `js/theme.js` | 確認深/淺切換仍正常（token 名有變的話對齊） |
| `js/i18n/*.js` | 新增 eyebrow 標籤字串（`COLLECTION` / `TOOLS` / `GALLERY` …，8 語系）、tagline |

---

## 12. 決定（2026-09）

- 字體：**方案 A（零 web font）**。第一版看完再議 B。
- eyebrow 標籤：**英文大寫**（`COLLECTION` / `TOOLS` / `GALLERY` …）。
- 淺色主題：**做到位**。
- 開工：照 §10 落地順序，先做到第 3 步給第一版看。

## 13. 進度

- [x] 步驟 1 — `theme.css` token 換色（`a60eb54`）
- [x] 步驟 2 — `base.css` 外殼：header 縮成一條、去封面輪播+毛玻璃雙層+彗星邊框、標題緊湊化、logo 環無限動畫拿掉、`.eyebrow`/`.section-title`/`.block` utility、`.osu-page-title` 換新樣（`491911c` + `86e70dd` 標題/音符比例微調）
- [x] 步驟 3 — 收藏首頁 `#collection-hero-v2` 框住封面 hero（每日一張、eyebrow + 大標題 + mono 統計；空收藏 → 平面卡）（`0e61e1f`）
- [ ] 步驟 4 — `osu.css` 元件 pass（`.osu-card` hover、`.btn`、`.lang-pill`、modal 去 blur）
- [ ] 步驟 5–8 — 見 §10。另：`!important` 過渡標記待步驟 8 清；空收藏時 v2 hero 與舊 `.collection-hero` pitch 疊兩塊，之後合併。
