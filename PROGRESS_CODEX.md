# PROGRESS_CODEX.md — Codex 席（前端）

更新日期：2026-10-30
依據：TEAM_PROTOCOL.md、DEV_SPEC v1.0、DECISIONS.md、BRIEF_CODEX.md、PROGRESS_CLAUDE.md 第 5 節。

## 1. 已完成（附證據）

### 頁面與流程
- `/`：手機優先家人首頁，當期批次、台灣時間截止提示、AI 精選卡、本站圖片、尺寸、候選價、查價時間、台灣參考價來源與時間、自填入口；逾期商品不能選購。
- `/invite`：由瀏覽器以 POST 兌換一次性邀請；讀取後立刻清除網址 token，失敗有重發指引；設 no-referrer，不把 token 帶往其他頁面。
- `/item`：精選／自填共用表單、數量加減、規格未定、備註、參考價、單價上限與幣別；本機草稿立即保存，700ms debounce 存網站草稿；資料以身分與示範／正式模式分開。
- 摘要是送出的必經步驟。送出後鎖定內容；冪等鍵與原內容一併保留，網路結果不明時沿用原鍵重試；確定的 4xx 錯誤才重新開放編輯。無開放批次時僅存草稿。
- `/list`：使用後端 `status_message`，列出退回原因與修改入口、家人確認新估算、估算明細、雙情境、實付／最終應付。未知顯示待查核；參考價不進總額；沒有「我已付款」按鈕。
- `/admin/login`：獨立管理員帳密登入，顯示後端錯誤。
- `/admin`：依家人／批次／商品三種視角、已知小計與未查價件數、固定未回報結果區；逐件確認／退回、人工核准報價、重量來源、限制品審核、重新估算、歷次報價、整批逐項成功／失敗原因。
- `/admin/batches`：開新批次、明確確認後截止、產生 LINE 文字並複製；不自動傳送。
- 採購核對 CSV：由目前管理端 API 回傳的清單匯出，含版本、家人、批次、規格、數量、報價與估算。UTF-8 BOM、CSV 引號跳脫與公式注入防護；明標「非申報檔、非完整備份」。
- PWA：manifest、192／512 PNG 圖示、SVG 圖示、apple-touch-icon、standalone、主題色、安裝事件與 iOS／Android 手動加入說明。僅加到主畫面，沒有 service worker、離線快取或背景補送。
- 介面：繁體中文、手機斷點、跳到內容連結、鍵盤焦點、狀態通知、表單標籤；外部字串跳脫 HTML，商品連結只接受 HTTP／HTTPS。

### 已串接與 mock 區分
- 正常網址預設全部使用同源 `/api`，無自動 fallback，API 失敗不會偷偷切換假資料。
- `?demo=1` 才載入 `public/app/mock.js`，資料只存在該分頁 sessionStorage；頂端固定顯示示範標示。涵蓋型錄、草稿／送出、估算範例、整批拒絕、報價、確認／退回、開批／截止、LINE 範例。
- mock 是收單流程示範，不重製完整後端驗證或運費計算；示範報價沿用固定假估算，三種管理視角維持簡化示範分組。正式模式使用後端完整結果。
- 購買結果、貨件、結算、完整備份沒有假成功操作；畫面明示尚未開放。

### 本次驗證證據
- `npm run build`：通過（2026-10-30 14:10，Astro SSR node adapter）。
- `npx tsc --noEmit`：通過，0 錯誤。public 原生 JS 另以 `node --check` 檢查語法。
- `npm run test:unit`：既有試算測試 **10／10 通過**。
- `node --test src/components/frontend.test.mjs src/components/form-flow.test.mjs`：**9／9 通過**。
  - 未知金額、上界未知、雙情境與重量依據、HTML／URL 防護、示範冪等、整批缺價拒絕、離線禁止送出、CSV 跳脫、截止草稿。
  - 使用最小 DOM 替身驗證「填寫 → 摘要 → 送出」，確保 fieldset 鎖定後仍保留名稱、規格、數量與上限，成功後清除該草稿。
- `node --env-file=.env src/components/api-smoke.mjs`：**通過**。
  - 七個頁面、manifest、兩個 PNG、三個 JS 資源均 HTTP 200。
  - `/api/health` 實際 DB 健康正常。
  - 使用既有管理員登入，驗證身分、三種分組、批次 API 結構，最後登出；未新增家人或品項，未修改批次。
- 未重跑會建立家人及截止／重開批次的 `test:api`，避免超出「不建帳號」與本期資料操作邊界；後端原有 32／32 紀錄仍以 Claude 進度檔為準，不算本次驗證。
- 瀏覽器驗證嘗試受阻：內建瀏覽器回報 `The browser access host is unavailable`；Chrome 回報 `Computer Use was not approved to use Google Chrome`。因此沒有宣稱完成瀏覽器端完整實測或視覺驗收。

## 2. 如何啟動或驗證

目前 dev server 已以背景模式啟動：`http://localhost:4321`。

```powershell
npm run dev -- --background
npx astro dev status
npx astro dev logs
# 停止時才執行：npx astro dev stop
npm run build
npx tsc --noEmit
npm run test:unit
node --test src/components/frontend.test.mjs src/components/form-flow.test.mjs
node --env-file=.env src/components/api-smoke.mjs
```

- 家人示範：`http://localhost:4321/?demo=1`；示範我的清單：`/list?demo=1`；示範管理：`/admin?demo=1`；示範批次：`/admin/batches?demo=1`。
- 正式本機管理入口：`http://localhost:4321/admin/login`，帳號與既有密碼依後端設定；不在本文件複製密碼。
- 家人正式流程需 Grant 傳來的有效 `/invite?t=...` 專屬連結。勿把示範模式當作已送到管理員。
- 真機驗收建議順序：以有效邀請進站 → 自填／選精選 → 加減數量與填上限 → 摘要 → 送出 → 我的清單 → 管理員回填報價／退回 → 家人修改重送 → 整批確認結果。
- 另測斷線送出、恢復網路後原鍵重試、過期報價確認、截止後保留草稿、320–430px 手機與桌面版、iOS／Android 加到主畫面。需 HTTPS 或 localhost 的安全環境驗證安裝提示。

## 3. 未完成

- 因工具不可用／未獲 Chrome 操作授權，尚未完成真實瀏覽器點擊流程、手機視覺、螢幕閱讀器與 PWA 真機安裝驗收。DOM 替身測試不能取代這些驗收。
- 全規格的下一期功能：購買結果、採購單／貨件、出貨檢核、申報 CSV、結算、完整備份／還原，仍依 Claude 所列未提供的 API 待後續整合。本期 BRIEF 收單核心已提供相關缺口提示。
- 精選管理、邀請管理、參數設定完整後台不在本期 BRIEF 的頁面清單內，本次未擴作。
- 正式商品圖目前沿用種子 `/images/placeholder.svg`，實際素材待營運提供。
- 型錄含運估算：catalog 契約未回傳估算，故卡片顯示「含運估算：待 Grant 查核」，不從 AI 候選價自行計算正式金額。

## 4. 待確認

- 分工衝突：DECISIONS 早期「時程提前」段與 BRIEF 相反；依最新「立即開工」與 Grant 本次明示，Codex 執行前端，Claude 執行後端。沒有更動後端。
- 逾期精選：規格允許僅存草稿，但後端 `POST /api/items {candidate_id}` 直接回 `price_stale`，所以前端暫禁選過期精選。若需要「過期也先存精選草稿」，需後端調整，前端不以自填繞過。
- 截止備份：規格要求截止觸發完整備份，但後端尚未提供；截止頁已明示此缺口，採購核對 CSV 不等於完整備份。正式開放前由 PM 確認補齊。
- 報價歷史 API 有完整資料；後端無家人可讀 ChangeLog 清單端點，目前家人頁能呈現所屬批次與狀態／原因，尚不能顯示完整改批／拆併異動歷程。
- 精選排序／總開關、真正型錄含運估算、假設重量例外核准、匯率更新過久警示與後端原待確認項目仍須後續決策。
- 前端僅展示後端稅費試算與固定附註，本次沒有新增或查證稅法／運費數值，也不應據此認定稅費規則已完成最終查核。

## 5. 給其他席次的交接資訊

- 修改範圍：`src/pages/` 非 API 的七頁、`src/layouts/Shell.astro`、`src/components/` 三個驗證檔、`public/app/` 四個 JS 與 CSS、`public/icons/`、`public/manifest.webmanifest`，以及本進度檔。未改 `src/server/`、`src/pages/api/`、`db/`、package 或根設定檔；build 產物由工具正常產生。
- 前端入口：`public/app/main.js`；共用 API／金額／安全輸出：`shared.js`；管理流程：`admin.js`；隔離示範：`mock.js`。沒有新增套件依賴。
- 正式寫入依第 5 節契約：家人 submit 使用 `Idempotency-Key` 與 `summary_confirmed:true`；家人再確認使用 `awaiting_my_confirmation_of` 原始兩個編號；管理確認使用原始 `revision_id`。不讓前端自行產生正式價格或估算。
- 讀碼對齊的契約補充：catalog 實際還回傳 `source_url`（用於精選表單預填）；`tw_ref` 來源欄實名為 `source`，不是 `source_url`；報價歷史回傳 `{price_checks:[...]}`；新核准報價 outcome 可為 `recorded`。均已依實作對齊。
- 沒有新增或假設任何正式 API。採購核對 CSV 為前端從 pending API 回傳資料建立；包含目前待核對與已確認未回報品項，不是全批所有狀態的完整匯出。
- 清除 localStorage 僅針對本站草稿：成功送出清除此筆，登出清除 `usshop:` 前綴；未對資料庫呼叫刪除。
- 後續新增 API 時請保留原有金額 null、kind、status_message、版本編號與錯誤結構，避免家人頁顯示假總額或錯誤確認。
- 未部署、未 push、未建立外部或本機新帳號、未傳送 LINE 訊息、未處理付款或真實個資。
