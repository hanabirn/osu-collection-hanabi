# osu! 歌曲收藏 · osu! Collection (Hanabi)

[English](README.md) · **繁體中文**

一個以 **歌曲收藏（song collection）** 為核心、玩家自製的 [osu!](https://osu.ppy.sh)
輔助網站 —— 瀏覽與組合 `.db` / `.osdb` 收藏、查 pp、用自己的成績產生練習圖池、
瀏覽整個 ranked 曲庫與所有世界盃圖池，還能跟其他玩家聊天。

**線上網站：** <https://osu-collection-hanabi.netlify.app>

這是 [HANABI_RN](https://osu.ppy.sh/users/26696007) 的個人專案，與 ppy 無任何
關聯、也未經其背書。「osu!」是 ppy Pty Ltd 的商標。

---

## 有哪些功能

- **收藏** —— 在瀏覽器裡組收藏、匯入／匯出 `collection.db` 與 Collection
  Manager 的 `.osdb`，發佈到公開的收藏廣場（含留言、RSS、可分享的
  `/c/<id>` 頁面）。
- **PP 工具** —— pp 查詢、成績歷史、推薦星數的「突破分」目標、replay 分析。
- **Farm 圖** —— 本站自算的 pp 資料庫（rosu-pp），加上每個模式各自的
  「這是不是真的水圖」判定，可依 pp／星數／BPM／mod 篩選。
- **練習收藏** —— 把你的 top plays 變成可直接遊玩的收藏（弱項／目標圖池／
  低準度／相似圖 幾種）。
- **曲庫分類與世界盃圖池** —— 整個 ranked 曲庫依 作者／語言／曲風／來源 建索引；
  每屆官方 OWC/TWC/MWC/CWC 圖池都從 osu-wiki 解析而來。
- **聊天室與私訊**、Mapper 追蹤（含 Web Push）、站內使用手冊、8 種介面語言。
- **Discord bot** —— HTTP interactions endpoint
  （`netlify/functions/discord-interactions.js`），約 17 個斜線指令，
  共用同一套後端；可匯出 `.osdb`。

## 技術

純靜態 HTML/CSS/JS —— **沒有框架、沒有前端打包器**。`index.html` 搭配
`js/*.js`（約 26 個檔）與 `css/*.css`，全部以一般的 `<script>` / `<link>`
標籤載入。狀態存在 `localStorage`；任何共享或伺服器端的邏輯都是一支
**Netlify Function**（`netlify/functions/*.js`，約 15 個功能 + 共用的 `_*.js`
helper），背後接 **Netlify Blobs**。pp／星數的計算在 function 裡用
`rosu-pp-js`（WASM）。i18n 是每個語系一個字典檔；簡體中文在 build 時由繁體
來源自動產生（OpenCC）。

唯一的 build 步驟（`npm run build` → `scripts/build.mjs`）會把整站複製到
`dist/` 並用 esbuild 壓縮 —— **不打包、不加 hash**，每個檔案都保留原路徑與
全域名稱。本機開發直接讀原始碼。

## 本機執行

```bash
npm install
npm run build          # 選用 —— 會產生 js/i18n/zh-Hans.js 與 dist/
npx netlify dev        # 在 localhost 同時起網站與 functions
```

純靜態瀏覽用任何檔案伺服器都行（`python -m http.server` 等）；需要 function
的功能（登入、收藏廣場、聊天室、farm 資料庫、Discord bot）要用
`netlify dev`，並設定下面的環境變數。

## 環境變數

設定在 Netlify 專案裡（或本機的 `.env`，已 git-ignore）。缺變數時對應功能會
自動降級、不會壞掉。

| 用途 | 變數 |
| --- | --- |
| osu! OAuth + API | `OSU_CLIENT_ID`、`OSU_CLIENT_SECRET`、`OSU_REDIRECT_URI`、`OSU_API_KEY`、`OSU_AUTH_SECRET` |
| Netlify Blobs（未自動注入時） | `NETLIFY_BLOBS_SITE_ID`、`NETLIFY_BLOBS_TOKEN` |
| Web Push | `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT` |
| Discord bot | `DISCORD_PUBLIC_KEY`、`DISCORD_BOT_TOKEN`、`DISCORD_GALLERY_CHANNEL_ID`、`DISCORD_ANNOUNCE_LOCALE` |
| 聊天室管理 | `CHAT_OWNER_OSU_ID` |
| 爬蟲觸發密鑰 | `FARM_CRAWL_SECRET`、`CATALOG_CRAWL_SECRET`、`WC_MAPPOOL_CRAWL_SECRET` |

排程爬蟲（farm 資料庫、ranked 曲庫、世界盃圖池）與 Web Push 檢查都是 Netlify
的 cron function —— 見 `netlify.toml`。

## 部署

push 到 `main`；Netlify 會跑 `npm run build` 並發佈 `dist/`。每次部署 `sw.js`
會拿到新的 build id，讓 PWA 提示更新。

## 狀態與貢獻

持續開發中，單一維護者，以小 commit 推進。歡迎開 issue 或 PR，但不保證會很快
回覆。目前 **沒有授權條款（LICENSE）** —— 程式碼公開可閱讀，但要拿其中一段
去用之前請先問過。
