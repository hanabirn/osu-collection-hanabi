# 練習收藏產生器 — 細部規格

> 目的：把既有的 PP / RP 分析從「拿來看的數字」變成「能匯進遊戲去打的收藏」。
> 這是本站相對 osu!Collector / CollectionManager 的核心差異點——他們沒有「你的成績」這個概念。

---

## 1. 定位

在「收藏工具」Modal（✨ 工具列按鈕）裡新增一組**成績驅動**的產生器，和現有的
`從最愛 / 最常玩 / top plays / recent / by-mapper` 並列。產物直接進現有的收藏 +
分類管線，因此也自動支援 `.db` / `.osdb` 匯出回遊戲。

---

## 2. 使用者流程

1. 使用者已用 osu! 登入（`getLoggedInOsuUser()` 有值）。
2. 開「收藏工具」Modal → 「練習收藏」分頁。
3. 選一個類型（見 §3），必要時設參數（目標總 PP、mods、張數）。
4. 按產生 → status 區（沿用 `#ctools-gen-status`）顯示進度。
5. 完成後跳出一個新分類「🎯 <類型名>」，回報「新增 N 張 set / 觸及 M 個分類 / 未解析 K」。
6.（Phase 2）之後掃 PP 時，該分類旁顯示「自建立以來 +X pp，其中 Y 分來自這個收藏」。

**未登入 / top plays < 10**：整個分頁停用，顯示「需要 osu! 登入且有足夠的 top plays」。

---

## 3. 產生器類型

所有類型的共同輸出格式：

```js
{ name: <分類名>, entries: [{ setId: <beatmapset_id> }, ...] }   // 交給 applyImportedCollections
```

共同的排除規則（挑完候選後一律套用）：

- **已在收藏**：`getOsuCollection()` 裡已有的 `beatmapset_id`。
- **已有好成績**：候選的 `beatmap_id` 出現在使用者 top-100 且 acc ≥ 95%。
  （MVP 只比對 top-100 就足以避免推「你早就 farm 過的圖」。）

共同上限：預設每個練習收藏 **40–60 張 set**（下限 `N_MIN = 40`，上限 `N_MAX = 60`）。

**mods**（MVP 就開放）：每個依賴 farm 圖池的類型（1、3、4、5）都有一個 mods 選擇：
`NM / HD / HR / DT`（單選，MVP 不做組合）。選定後：

- `farm-maps-list` 查詢帶 `mods=<選定>`，其回傳的 `pp` / `star` 就是該 mod 組合的值。
- `p100` pp 門檻**與 mod 無關**（重點是「這個分數能不能進我的 top-100 總表」）。
- 星數帶：若使用者該 mod 的 top plays ≥ 10 筆，用那些的星數中位數；否則用 NM 星數
  中位數 × mod 星數係數（`DT ≈ ×1.4`、`HR ≈ ×1.05`、`HD ≈ ×1.0`）。

---

### 類型 1 — 突破分（Push）★ MVP

**定義**：FC 之後能實際擠進 top-100 並加總分的圖。

**輸入**
- top-100：`osuFetch(`best=${uid}&limit=100&m=${mode}`)`
- farm 資料：`/.netlify/functions/farm-maps-list`

**演算法**
1. 取 top-100 的 pp 陣列 `P`（降冪）。`p100 = P[99]`（不足 100 筆時取最後一筆）。
   一張新成績 pp 值 `x` 只要 `x > p100` 就會進榜；加權後的邊際加分 ≈ `(x − p100) × 0.95^99`
   之類的尾端權重，MVP 直接用「`x > p100`」當門檻即可。
2. 估使用者的可打星數帶（**保守：用中位數，不用 P90**）：
   `starMid = median(top-100 每筆的 stars)`，`band = [starMid − 0.7, starMid + 0.7]`。
   （mods 非 NM 時，星數帶依 §3 mods 規則調整。）
3. 覆蓋檢查（見 §9）：先送一次 `farm-maps-list` 帶下述 filter + `page=0`，
   讀 `total` 與 `coverage`。若 `total < N_MIN` 或
   `coverage.computedCount / max(coverage.totalKnown,1) < 0.15` → **擋下**，
   顯示「farm 資料庫在這個難度 / pp 區間的覆蓋還不夠，無法產生可靠的練習收藏」。
4. 從 `farm-maps-list` 分頁抓：
   `ppMin = p100`、`ppMax = p100 × 1.3`、`starMin/starMax = band`、
   `mods = <選定>`、`sort = pp_desc`、`farmOnly = 1`。
   一頁 20 筆，翻到湊滿 `N_MAX` 或 `total` 用盡。
5. 套 §3 共同排除規則，取前 `N_MAX`（若不足 `N_MIN` 見 §9 擋下）。
6.（選配、可延後）對前 N 候選逐一 `osu-pp?id=<bid>&acc=95,98,100&mods=<選定>`
   取實際 FC pp，依「邊際加分」重新排序。MVP 可先信 farm dataset 的 `pp`。

**輸出**：`name = t('practice_cat_push')`，`entries` 取前 N。

**邊界**
- farm dataset 是**漸進式、部分**資料（回應裡有 `coverage`）→ UI 要標示「來源為
  farm 資料庫，非完整 ranked pool」。
- 候選不足 N：照樣產出，status 註明實際張數。
- 全部候選都被排除（使用者已 farm 滿）：產出空，提示換類型。

---

### 類型 2 — 低準度重練（Accuracy grind）— v1.1

**定義**：你打過、但準度低於你平均水準的圖，抓回來磨 acc。

**輸入**：top-100 + `osuFetch(`recent=${uid}&limit=50&m=${mode}`)`

**演算法**
1. `avgAcc` = top-100 pass 成績的加權平均 acc（權重同 pp 權重）。
2. 候選 `beatmap_id`：
   - top-100 裡 acc < `avgAcc − 1.5%` 的；
   - recent 裡 pass 且 acc < 96% 的。
3. 去重、映射到 `beatmapset_id`（recent/best 回傳有 `beatmap_id`；用現有的
   `b=<id>` chunk 查 set，pattern 見 `generateCollectionFor('best')`）。
4. 套共同排除規則裡的「已在收藏」（這裡**不**套「已有好成績」，因為重點就是回去重打）。

**輸出**：`name = t('practice_cat_acc')`。

**邊界**：資料少 → 放寬到絕對門檻 < 97%。全高 acc → 空產出，提示「你 acc 很穩，換類型」。

---

### 類型 3 — 目標圖池（Goal pool）★ MVP

**定義**：沿用現有「還差 X 分達標」的計算，給一池「FC 後 ≥ X 分」的真實圖。

**輸入**
- 目標總 PP：**讀 PP 面板現有的 `#pp-goal-target` 輸入框**（不在練習分頁另開輸入）。
  若該框為空 → 提示「請先在 PP 面板設定你的目標總 PP」，並（可選）提供一個跳到該面板的連結。
- `needed`：直接呼叫現有 `ppNeededForTarget(ppList, bonusPp, target)`（osu.js ~3223）。
- farm 資料：`farm-maps-list`。

**演算法**
1. 若 `actualTotal ≥ target` → 「已達成」，不產出。
2. `ppMin = needed × 0.9`（留一點 FC-偏差空間）、`ppMax = needed × 1.6`。
3. 星數帶：`starMax = P90(top-100 stars) + 0.3`（能穩定打的上緣），`starMin = starMax − 1.5`。
   （這裡用 P90 是刻意的——目標圖池本來就是要往上搆；「保守用中位數」那條只套在類型 1 突破分。）
4. 覆蓋檢查（見 §9），同類型 1。
5. `farm-maps-list` 抓：上述 pp / star 範圍、`mods = <選定>`、`sort = star_asc`
   （先給相對好上手的）、`farmOnly = 1`。
6. 套共同排除規則。取 `N_MAX`（不足 `N_MIN` → 擋下）。

**輸出**：`name = t('practice_cat_goal', { target })`，例如「🎯 目標 12,000pp」。

**邊界**
- `needed` 高於使用者星數帶能產出的 pp → 候選會很少或很難，提示
  「這個目標需要的單圖分數超過你目前能穩定 FC 的範圍，考慮設近一點的目標」。

---

### 類型 4 — 弱項（Weakness bucket）— v1.2

**定義**：把你的 top plays 依某個維度分桶，從你**最弱的桶**生一個練習收藏。

**輸入**：top-100（每筆需星數、長度、BPM；長度/BPM 在 recent/best 回傳沒有，
需 `b=<id>` 補，或用 set 資料）。

**演算法（v1 只做「長度」與「BPM」兩個維度，因為 farm API 直接支援）**
- 長度桶：`<90s` / `90–150s` / `>150s`
- BPM 桶：`<160` / `160–200` / `>200`
1. 對選定維度，算每桶的「圖數佔比」與「平均 pp 名次」。
2. 最弱桶 = 圖數佔比明顯低於均勻分佈（例如 < 期望的 60%），或平均 pp 名次最差者。
3. 從 `farm-maps-list` 用該桶的 `lengthMin/Max` 或 `bpmMin/Max` + 使用者星數帶拉圖。
4. 套共同排除規則。

**輸出**：`name = t('practice_cat_weak', { dim })`，例如「🎯 弱項：長串（BPM>200）」。

**邊界**：AR / CS / 跳圖 vs 串圖 這類需要額外難度分析，列 Phase 2。

---

### 類型 5 — 沒打過的相似圖（Discover by taste）— v1.1

**定義**：跟你 top plays 同 mapper / 同星數帶 / 同曲風，但你**沒有任何成績**的圖。

**輸入**：top-100 + 最愛（v2 `fetchOsuProfileBeatmapsets(uid, 'favourite', 300)`）。

**演算法**
1. `mappers` = top-100 的 `creator` 集合（取出現 ≥ 2 次的，避免雜訊）。
2. 星數帶 = top-100 stars 的 IQR（P25–P75）。
3. 候選來源（擇一或合併）：
   - 現有 `generateCollectionFromMapper` 的路子：v1 `u=<creator>&type=string`
     取該 mapper 的 ranked/approved/loved sets；
   - `farm-maps-list?q=<creator>`。
4. 過濾：星數落在 IQR 內、`beatmap_id` 不在使用者任何成績裡（MVP：不在 top-100 即可）。
5.（選配）用 set meta 的 `genre` / `language` 再收斂。

**輸出**：`name = t('practice_cat_taste')`。

**邊界**：mapper 太集中（< 3 個）→ 退回「純星數帶 + genre」。

---

## 4. 共用管線

新增函式（放在 `js/osu.js`，靠近 `generateCollectionFor`）：

```js
async function generatePracticeCollection(kind, opts = {}) {
    if (!await verifyOsuPassword()) return;
    const user = getLoggedInOsuUser();
    const setS = (m, c) => { /* 沿用 #ctools-gen-status 的寫法 */ };
    if (!user?.id) { setS(t('osu_profile_need_login'), '#ff5252'); return; }

    // 1. 抓資料（top-100 / recent / favourite / farm-maps-list）依 kind 而定
    // 2. 各 kind 的挑圖邏輯 → setIds（已套 §3 共同排除規則、已套 N 上限）
    // 3. 落地
    const name = practiceCatName(kind, opts);          // 帶 🎯 前綴
    const report = await applyImportedCollections(
        [{ name, entries: setIds.map(id => ({ setId: id })) }],
        m => setS(m)
    );
    setS(t('collection_io_import_done', {
        sets: report.addedSets, cats: report.touchedCats, missed: report.unresolved
    }), '#34d399');

    // 4.（Phase 2）記 practice_sets[catId] = { kind, createdAt, ppAtCreation, memberSetIds }
}
```

`applyImportedCollections`（osu.js:1214）已經處理：setId 去重、跳過已收藏、
用 v1 `s=<id>` 解析 set + 難度、建立/更新同名分類、進度回呼、`saveOsuCollection`。
**產生器只需要吐出 `{ name, entries:[{setId}] }`。**

---

## 5. 資料來源與 API（都已存在）

| 需求 | 端點 | 備註 |
|---|---|---|
| top plays | `osuFetch('best=<uid>&limit=100&m=<mode>')` | v1 proxy，回傳含 `beatmap_id`, `pp`, `enabled_mods`, acc 相關計數 |
| 最近成績 | `osuFetch('recent=<uid>&limit=50&m=<mode>')` | v1；含 `rank`（判 pass/fail） |
| 逐圖難度 | `osuFetch('b=<bid>')` / `osuFetch('s=<sid>')` | 需 chunk，pattern 見 `generateCollectionFor('best')` |
| 最愛 / 最常玩 | `fetchOsuProfileBeatmapsets(uid, 'favourite'|'most_played', n)` | v2 proxy |
| farm 圖池（依 pp/star/bpm/length 篩） | `/.netlify/functions/farm-maps-list` | 參數：`mode, mods, page, q, farmOnly, ppMin/Max, starMin/Max, bpmMin/Max, lengthMin/Max, sort=(pp|star|bpm|length|new)_(asc|desc)`；20/頁；回應含 `coverage` |
| 單圖 FC pp（精算） | `/.netlify/functions/osu-pp?id=<bid>&mods=<M>&acc=95,98,100` | rosu-pp-js wasm；選配，用於重排序 |

---

## 6. 資料模型注意

- 本站分類成員是 **per-set**（`beatmapset_id`）；遊戲內 collection 是 **per-diff（md5）**。
- 練習挑圖本質是針對特定難度，但 v1 落地只能整個 set 進收藏 → 匯出 `.db` / `.osdb`
  時該 set 的所有難度都會被寫進去。
- **v1 接受此限制**。Phase 2 可在分類成員存一份 `beatmap_id` 白名單，匯出時只寫對應 md5。

---

## 7. 回饋閉環（Phase 2）

1. 建練習分類時記：`practice_sets[catId] = { kind, createdAt, ppAtCreation, memberSetIds }`（localStorage）。
2. 每次 `recordPpSnapshot(totalPP, key)` 後：
   - `Δp = totalPP − ppAtCreation`；
   - 掃目前 top-100，找 `beatmap_id` 屬於該分類任一 set 的新成績，估其貢獻 pp 加總。
3. 在 PP 面板或分類 chip 旁顯示徽章：「🎯 突破分 · +142pp（其中 ~95 來自這個收藏）」。

---

## 8. 分期

| 階段 | 內容 | 理由 |
|---|---|---|
| **MVP** | 類型 1 突破分 + 類型 3 目標圖池 + 共用管線 | 兩者共用「farm-maps-list 依 pp/star 帶拉圖 → 排除已有 → 成分類」骨架；「為什麼要用你的網站」訊息最強 |
| v1.1 | 類型 2 低準度、類型 5 相似圖 | 需要多打 recent / mapper 查詢，但不需新後端 |
| v1.2 | 類型 4 弱項、回饋閉環 | 需要 top-100 逐圖屬性 + snapshot 比對 |
| Phase 2 | per-diff 分類成員、AR/CS/串圖弱項維度、`osu-pp` 精算重排序 | 需要更細的難度資料或資料模型改動 |

---

## 9. 風險 / 取捨

- **farm dataset 不完整**：`farm-maps-list` 是漸進式爬蟲產物，不是完整 ranked pool。
  **決策：覆蓋不足時擋下產出**（不做「照樣產出並標示」）。擋下條件（任一成立）：
  - 帶好 pp/star/mods filter 的查詢 `total < N_MIN`（連一個最小練習收藏都湊不滿）；
  - `coverage.computedCount / max(coverage.totalKnown, 1) < 0.15`。

  擋下時 status 顯示：「farm 資料庫在這個難度 / pp 區間的覆蓋還不夠，無法產生可靠的
  練習收藏，晚點再試」。之後可擴 crawler，或補用 osu! API v2 `/beatmaps` 搜尋
  （有 star / status，但**沒有 pp**）。
- **v1 API rate limit**：top-100 + recent 各一次 OK；逐圖 `b=<id>` 一定要 chunk（現有 pattern）。
- **pp 可信度**：farm dataset 的 pp 是預算的 FC / 95–100 acc 估計值，非官方 → 標為「估計」。
- **「已有好成績」判定**：MVP 只用 top-100 的 `beatmap_id`，會漏掉「不在 top-100 但其實
  打過」的圖 → 可能推到已打過的。可接受；Phase 2 再納入 recent / user-best。
- **mods**：MVP 只做 NM。farm API 支援 `mods` 參數，之後可讓使用者選 HD/HR/DT。

---

## 10. 已定案（2026-08-30）

1. **練習分類前綴用「🎯」**。
2. **每個練習收藏 40–60 張**（`N_MIN = 40`、`N_MAX = 60`）。
3. **突破分星數帶用中位數（保守）**；P90 只用在「目標圖池」（那個本來就要往上搆）。
4. **farm 覆蓋不足就擋下**（條件見 §9），不做「照樣產出並標示」。
5. **MVP 就開放 mods 選擇**：NM / HD / HR / DT 單選（不做組合），規則見 §3。
6. **目標總 PP 讀 PP 面板現有的 `#pp-goal-target`**，練習分頁不另開輸入框；框為空就提示去設定。
