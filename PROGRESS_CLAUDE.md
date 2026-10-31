# PROGRESS_CLAUDE.md — Claude Code 席（後端與基礎建設）

- 更新日期：2026-10-30
- 依據：DEV_SPEC v1.0、DECISIONS.md、BRIEF_CLAUDE_CODE.md、TEAM_PROTOCOL.md
- 動工前 `PROGRESS_CODEX.md` 尚不存在（專案目錄原為空），無需對齊的前端進度；Codex 席請依第 5 節契約接 API。
- 我的範圍：`src/server/`、`src/pages/api/`、`db/`、`tests/`、根目錄設定檔、`package.json`。未動 `src/components/` 與頁面 `.astro`。
- 邊界遵守：未部署、未 push、未建立任何外部帳號、未存任何付款資料；資料庫為本機 PostgreSQL，以 `DATABASE_URL` 連線。

## 1. 已完成（附證據）

| 項目 | 證據 |
|---|---|
| Astro 7（TypeScript strict、SSR、`@astrojs/node`）初始化 | `npm run build` 通過；`npx tsc --noEmit` 0 錯誤 |
| 資料層：規格第 3 章 14 張表 + 支援表 `session`、`shipment_allocation`，migration `db/migrations/001_init.sql` | `npm run db:migrate` 已套用；`npm run db:seed` 成功 |
| 只增不改：`order_item_revision`、`price_check`、`estimate`、`change_log`、`setting` | 應用層角色只授予 SELECT／INSERT；測試以該角色實際 UPDATE／DELETE 5 張表，全數 `permission denied` |
| 同時僅一個開放批次（資料層唯一索引 `batch_single_open_uq`） | 測試：API 重複開批 409；直接 INSERT 第二個 open 被資料庫拒絕 |
| 家人邀請連結：長隨機 token 只存 SHA-256 雜湊、單次兌換、換發 HttpOnly cookie、後台撤銷／重發 | 測試：第二次兌換 401；DB 內無明文；重發後舊連結與舊工作階段立即 401（遠小於 60 秒） |
| 管理員獨立密碼登入（scrypt 雜湊）、MFA 欄位預留、失敗 5 次節流 | 測試：錯密碼 401、家人打管理 API 403 |
| 權限：每次請求都查資料庫驗證 session 與歸屬；非本人資料一律 404；寫入請求檢查 Origin | 測試：B 對 A 的品項 GET／PUT／submit／DELETE／family-confirm 全 404，清單不含他人品項；跨來源 Origin 403 |
| 提交：冪等鍵、必經摘要確認、同一交易建立不可變 Revision＋更新狀態＋ChangeLog | 測試：同一冪等鍵並行送 5 次，資料庫僅 1 筆 Revision（1 次實建、4 次 `replayed:true`） |
| 版本檢查、截止判定（伺服器時間）、截止後只能存草稿 | 測試：舊版本確認 409 `stale_revision`；截止後送出 409 `batch_closed` 但草稿仍可存；重開批次後恢復 |
| 管理端：待確認彙總（依家人／批次／商品視角、小計、已確認未回報區塊）、回填報價、逐件確認／退回（原因必填）、整批確認逐項驗證 | 測試：整批 5 項中 1 項成功，4 項各回正確原因碼（`no_price_check`／`spec_undecided`／`stale_revision`／`restricted_unconfirmed`） |
| 價格上限授權（7.3）與待家人確認 | 測試：上限內維持已確認並記「上限內授權」；超過上限轉 `pending_family`；家人用過期的報價／估算編號確認 409，用最新的才通過 |
| 試算（7.2）：CIF、整磅進位、0.1 磅單件精度、匯率緩衝 1%、三態、雙情境、固定附註、金額守恆分攤函式 | `npm run test:unit` 10／10 通過；API 測試：未知重量 → `pending_check` 且 `total_twd:null`；帶寬內出現雙情境；改匯率後舊估算 `params_snapshot`／`result` 完全不變，重算新增一筆 |
| 精選型錄：匯入（冪等、連結＋規格去重）、白名單／限制類攔截、核准、下架、封鎖、價格逾期標「價格待更新」 | 測試：第三方賣家與命中關鍵字進待核准；重匯入 `updated` 不增筆；封鎖後重匯入 `skipped_blocked` 且不復活、已送出品項不受影響；逾期候選 `can_submit:false`、建草稿 409 `price_stale` |
| LINE 文字：截止通知、確認進度、邀請／重發邀請（含「舊的不能用了」說明） | 測試通過（只產生文字，不自動發送） |
| `/api/health` | 實際執行 `select now()`；DB 不通時回 503（實測：DB 停止時回 `{"ok":false}`） |
| 種子資料：管理員 1、家人 3、精選 5（全為代號／示範資料，第 5 件查價已逾期以供驗證） | `npm run db:seed`，可重複執行 |
| `.env.example` 列出全部環境變數；`.env` 已由 `.gitignore` 排除 | `git check-ignore` 確認 `.env`、`.pgdata/`、`dist/` 皆被忽略 |

整體測試結果：`npm run test:api` **32／32 通過**、`npm run test:unit` **10／10 通過**（2026-10-30 本機實跑）。

## 2. 如何啟動或驗證

```powershell
# 0. 本機資料庫（獨立實例，port 5433，資料在 .pgdata；不動系統既有的 PostgreSQL 服務）
powershell -File db/local-pg.ps1 start     # 也有 stop／status
# 1. 環境變數（已有 .env；新環境：copy .env.example .env）
# 2. 初次建置
npm install
npm run db:migrate       # 建表＋套用權限（用 MIGRATE_DATABASE_URL）
npm run db:seed          # 印出 3 位家人的一次性邀請連結；管理員帳號「管理員」，密碼見 .env 的 SEED_ADMIN_PASSWORD
# 3. 啟動
npm run dev              # http://localhost:4321
npm run build && npm start   # 正式模式（node --env-file=.env dist/server/entry.mjs）
# 4. 驗證（server 需已啟動）
npm run test:unit
npm run test:api         # 會自建唯一名稱的家人；最後會截止並重開一個示範批次（只動本機資料庫）
curl http://localhost:4321/api/health
```

- 本機資料庫帳號（僅本機開發用，無真實資料）：擁有者 `usshop_admin`、應用層 `usshop_app`，連線字串見 `.env.example`。
- 日後換 Neon：只改 `.env` 的兩個連線字串（`MIGRATE_DATABASE_URL` 填 owner、`DATABASE_URL` 填應用層受限角色，需先在 Neon 建好該角色）。程式與 `db/migrate.ts` 不含寫死的角色名，migrate 會依 `DATABASE_URL` 的使用者自動套用只增不改權限。

## 3. 未完成

- 下期邏輯（表已建，無 API）：PurchaseOrder、PurchaseResult、Shipment（含出貨前檢核頁、申報 CSV、切貨件）、Settlement。因此目前 API 無法把品項推進到 `ordered`／`not_bought`；人話狀態函式已預留「部分買到」「運送中」「到貨」訊息。
- 家人端「最終應付」：回傳欄位 `payable.final` 目前恆為 `null`（待結算）。
- 備份匯出（JSON／CSV）、截止時觸發備份、還原演練：未做。
- 批次後續狀態（已下單／運送中／已到貨／已結算）的切換 API：未做（僅開批次、截止）。
- 管理員 MFA：欄位已預留，登入時若 `mfa_enabled=true` 回 501。
- 品項 `arrival_override`、貨件分配檢核（已分配 ≤ 實購）：欄位／表已建，邏輯下期。
- 部署用 adapter：目前用 `@astrojs/node`（本機驗證用）。部署 Vercel 時需換 `@astrojs/vercel`——部署屬第一級禁止，未做，待 Grant 授權。

## 4. 待確認

文件衝突（依「規格 > 工作指示 > 自行判斷」處理，並明列）：
1. DECISIONS.md「時程提前」節寫「Claude Code 席：家人端與型錄；Codex 席：後端 API」，與 BRIEF 分工（我＝後端、Codex＝前端）相反。已依較新的「立即開工」節與 BRIEF 執行，請 PM 確認。

規格未定、我採暫行作法（皆可調整）：
2. **稅費分攤基準**（規格 15.3）未定：本期試算為「單一品項」層級，不做貨件分攤；`allocateConserving()`（尾差進最大品項、金額守恆）已備好待貨件階段使用。
3. **品項估算的代運費**：以「單件重量（0.1 磅進位、最低 0.2）× 數量 × NT$170」估算；貨件階段才做總重整磅進位（`shipmentBilledWeight()` 已備）。若 PM 希望品項估算也以整磅計，請告知。
4. **CIF 的保險費**：規格未給費率，未計入 CIF（回傳 notes 說明），不以 0 假裝。
5. **關稅率**：不寫死。課稅情境下界只含營業稅（關稅以 0 為下界），上界需 Grant 於 Setting `tariff_rate_high` 填入，未填則 `total_twd.high:null` 並在 `unknowns` 註明（規格 15.5）。
6. **試算匯率**：種子裡的 32 是「範例值」（來源欄標明非真實匯率），Grant 須於管理端 `PUT /api/admin/settings` 填真實匯率與來源日期；未設定時試算一律「待查核」。「匯率過久未更新警示」未做（Setting `fx_stale_days` 已預留）。
7. **類別假設重量**（15.9）無資料：`category_weights` 預設空，未核可類別一律待查核。區間寬度取自 Setting 內該類的 min／max。
8. **邀請效期**預設 14 天（`INVITE_TTL_HOURS`）、家人工作階段 180 天、管理員 12 小時，皆為暫定值。
9. **管理員 MFA 形式**（15.8）、**黑五期間起訖**（15.7，`blackfriday_period` 預設空）、**Person 標記欄位是否長期保存**（15.11，先保留 `has_ezway`、`tech_assist_note`）、**PurchaseOrder 獨立成表**（15.10，已獨立）。
10. **Buyandship 費率 170 vs 150**（15.2）：Setting 預設 170，待 Grant 以會員中心確認。
11. 管理員登入失敗節流為單機記憶體；Vercel 多實例下僅輔助，是否改用資料庫計數待確認。
12. 狀態以英文代碼存放（對照見 5.1），中文僅出現在人話訊息；若 PM 要求資料庫存中文請告知。
13. 本機沒有可用的 PostgreSQL 超級使用者密碼（系統 5432 服務我未動），故另開專案內獨立實例（port 5433）。

## 5. 給其他席次的交接資訊（API 契約）

### 5.1 通則
- Base：同源（`/api/...`）。請求／回應皆 JSON（`content-type: application/json`）；回應一律 `cache-control: no-store`。
- 驗證：HttpOnly cookie `usshop_session`（家人與管理員共用，伺服器端每次查表）。前端 fetch 請同源並帶 cookie（同源預設即帶）。
- 錯誤格式：`{ "error": { "code": "...", "message": "給人看的白話", "details"?: {...} } }`。
- 通用錯誤碼：`400 invalid_json｜invalid_field（details.field）｜invalid_id`、`401 unauthorized`（重新進站／登入）、`403 forbidden｜bad_origin`、`404 not_found`、`415 unsupported_media_type`、`500 internal_error`。
- 金額單位：試算結果為新台幣整數；`unit_price` 等外幣為小數。時間皆 ISO 8601。
- 品項狀態碼（`status`）：`draft` 草稿｜`pending_admin` 待 Grant 確認｜`rejected` 退回｜`confirmed` 已確認｜`pending_family` 待家人確認｜`ordered` 已訂購｜`not_bought` 未買到。**家人端畫面請只顯示 `status_message`，不要顯示狀態碼。**
- 批次狀態碼：`open`｜`closed`｜`ordered`｜`shipping`｜`arrived`｜`settled`。

### 5.2 邀請與登入
| 端點 | 說明 |
|---|---|
| `POST /api/auth/redeem` `{token}` | 兌換邀請（單次）。成功 200 `{ok, person}` 並設 cookie；失敗 401 `invalid_invite`。 |
| `GET /api/auth/me` | 目前身分 `{person:{id,display_name,role}}`；未登入 401。 |
| `POST /api/auth/logout` | 登出。 |
| `POST /api/admin/login` `{name,password}` | 管理員登入。401 `bad_credentials`、429 `too_many_attempts`、501 `mfa_not_implemented`。 |

**邀請連結格式：`{PUBLIC_BASE_URL}/invite?t=<token>`。前端需做一個 `/invite` 頁：載入後由 JS 取出 `t`，`POST /api/auth/redeem`，成功後用 `history.replaceState` 清掉網址上的 token 並導向首頁；失敗顯示「連結已失效，請請 Grant 重新傳一條」。必須用 POST（不能做成 GET 自動兌換），否則 LINE 的連結預覽機器人會把單次 token 用掉。**

### 5.3 家人端（需家人 cookie）
| 端點 | 說明 |
|---|---|
| `GET /api/batch` | `{server_time, batch:{id,name,deadline_at,status}\|null, can_submit}`。`can_submit:false` ＝ 無開放批次或已過截止，只能存草稿。 |
| `GET /api/catalog` | 精選型錄 `{price_stale_days, items:[{id,name,merchant,spec_label,sizes_available,image_path,currency,price,list_price,price_label:"AI 候選價",checked_at,promo_conditions,stock_note,ai_pick,notice,price_stale,can_submit,stale_label,tw_ref,restricted_hit}]}`。`tw_ref` 無同規格依據時為 `{price:null,label:"待查"}`。`price_stale:true` 時請顯示「價格待更新」且不可送出。圖片路徑為本站路徑（種子用 `/images/placeholder.svg`）。 |
| `GET /api/items` | 我的清單 `{items:[ItemView]}`。 |
| `POST /api/items` | 建立草稿。精選：`{candidate_id}`（欄位預填）；自填：`{data:{...}}`（可省略）。201 回 ItemView。409 `candidate_unavailable｜price_stale`。 |
| `GET /api/items/:id` | ItemView；非本人 404。 |
| `PUT /api/items/:id` `{data:{...}}` | 存草稿（僅 `draft`／`rejected` 可改，否則 409 `not_editable`）。 |
| `DELETE /api/items/:id` | 刪除未送出草稿。 |
| `POST /api/items/:id/submit` | 送出。**標頭必帶 `Idempotency-Key`（前端每次「按下送出」產生一個 UUID，重試沿用同一個）**；body `{summary_confirmed:true, data?:{...}}`（`data` 會先合併進草稿）。回 `{replayed, item}`。錯誤：400 `idempotency_key_required｜summary_not_confirmed｜invalid_field`、409 `batch_closed｜price_stale｜candidate_unavailable｜not_submittable｜idempotency_conflict`。`batch_closed` 時內容仍保留為草稿。 |
| `POST /api/items/:id/family-confirm` `{price_check_id, estimate_id}` | 家人確認新版本（`pending_family`→`confirmed`）。兩個 id 取自 ItemView 的 `estimate.awaiting_my_confirmation_of`。409 `stale_version`（價格又變了，請重新載入）｜`invalid_state`。 |

`data` 欄位：`name`、`url`、`spec`、`spec_undecided`(bool)、`quantity`(1–999 整數)、`note`、`family_ref_price`、`max_price`、`max_price_currency`（填了 `max_price` 就必填幣別）。送出時必填：品名、數量；規格（或勾「規格未定」）；自填品項需連結。

**ItemView**：
```
{ id, status, status_message, needs_my_action, source:"featured"|"custom",
  batch:{id,name}|null, candidate_id,
  content:{name,url,spec,spec_undecided,quantity,note,family_ref_price,max_price,max_price_currency,version_no,submitted_at}|null,  // 已送出的現行版本
  draft:{...}|null,            // draft／rejected 時的可編輯內容
  reject_reason: string|null,
  estimate:{id,label:"估算",kind:"point"|"range"|"pending_check",calculated_at,
            result:{goods_twd,domestic_shipping_twd,shipping_twd:{low,high}|null,cif_twd:{low,high}|null,
                    level:"green"|"yellow"|"red"|null,total_twd:{low,high|null}|null,known_subtotal_twd,
                    unknowns:[...],notes:[...],weight_basis,disclaimer:"以海關實際認定為準"},
            scenarios:{exempt,taxable}|null,   // 完稅價格落在 1,800–2,200 帶寬時並列「符合免稅條件」「可能課稅」
            awaiting_my_confirmation_of:{estimate_id,price_check_id}|null}|null,
  payable:{estimated:{low,high}|null, actual:null, final:null, note} }
```
顯示規則：`kind:"pending_check"` 或 `total_twd:null` 時顯示「待查價」並可列出 `known_subtotal_twd` 與 `unknowns`，**不要顯示總額、不要當 0**；`total_twd.high:null` 表示上界待確認；`scenarios` 非空時兩種情境並列並附 `disclaimer`；不得出現「免稅」保證文案。

### 5.4 管理端（需管理員 cookie；家人打這些端點一律 403）
| 端點 | 說明 |
|---|---|
| `GET /api/admin/pending?view=person\|batch\|product&batch_id=` | 待確認彙總 `{view, groups:[{key,person_id,person_name,items:[...],subtotal:{count,estimated_total_twd:{low,high\|null},unpriced_count}}], confirmed_awaiting_result:[...]}`。每個 item 帶 `item_id, revision_id, version_no, name, url, spec, quantity, max_price…, price_check, estimate, restricted_hit, restricted_review_status, confirm_blocker`（`null`＝目前可確認；否則 `{code,message}`）。`view=product` 僅在連結＋規格＋品名完全一致時合併並附 `total_quantity`。 |
| `POST /api/admin/items/:id/price-checks` | 回填並核准報價（唯一正式報價入口）。body：`unit_price, currency, weight_source("merchant"\|"measured"\|"category_assumption"\|"none"), weight_lb?, category_key?, domestic_shipping?, promo_condition?, source_url?, checked_at?, stock_note?, candidate_id?`。回 `{price_check, estimate, outcome}`；已確認品項再報價時 `outcome` 為 `unchanged｜within_cap_authorized｜needs_family_confirmation`。 |
| `GET /api/admin/items/:id/price-checks` | 報價歷史。 |
| `POST /api/admin/items/:id/estimates` | 以目前參數重算，新增一筆（舊的保留）。 |
| `POST /api/admin/items/:id/confirm` `{revision_id}` | 單件確認，綁定版本／報價／估算。409 錯誤碼：`stale_revision｜spec_undecided｜no_price_check｜restricted_unconfirmed｜invalid_state`。 |
| `POST /api/admin/items/:id/reject` `{reason}` | 退回（原因必填，家人端會看到）。 |
| `POST /api/admin/items/:id/restricted-review` `{status:"none"\|"reminded"\|"confirmed"}` | 限制品審核狀態（「已提醒」≠「已確認可買」）。 |
| `POST /api/admin/items/confirm-batch` `{items:[{item_id,revision_id}]}` | 整批確認，逐項驗證。回 `{confirmed:[{item_id,revision_id,price_check_id,estimate_id}], failed:[{item_id,code,message}]}`（200，失敗項不影響其他項）。 |
| `GET/POST /api/admin/batches` | 列表／開批次 `{name, deadline_at}`。409 `open_batch_exists`。 |
| `POST /api/admin/batches/:id/close` | 截止。 |
| `GET /api/admin/line-text?type=batch_closed\|confirm_summary&batch_id=` | `{texts:[{person_id,display_name,text}]}`，供 Grant 複製貼 LINE。 |
| `GET/POST /api/admin/people` | 家人列表（含邀請／工作階段狀態）／新增家人 `{display_name, has_ezway?, tech_assist_note?, is_default_recipient?}`，回傳含**一次性** `invite_url` 與 `line_text`。 |
| `POST /api/admin/people/:id/invite` | 重發邀請（舊邀請與舊工作階段立即失效），回 `{invite_url, expires_at, line_text}`。 |
| `DELETE /api/admin/people/:id/invite` | 撤銷邀請與工作階段。 |
| `GET/PUT /api/admin/settings` | 讀取全部參數；`PUT {key, value, source_note}` 新增版本。`fx_rate` 必附 `source_note`。key：`fx_rate, fx_buffer, shipping_rate_per_lb, tax_threshold, warn_line, band, vat_rate, tariff_rate_high, category_weights, price_stale_days, price_stale_days_blackfriday, blackfriday_period, payment_timing, fx_stale_days`。 |
| `GET /api/admin/candidates?status=` | 候選列表。 |
| `POST /api/admin/candidates` `{candidates:[...]}` | 匯入（冪等）。欄位見 `src/pages/api/admin/candidates/index.ts` 註解。回各筆 `result`：`created_listed｜created_pending_approval｜updated｜skipped_blocked｜skipped_delisted`。 |
| `POST /api/admin/candidates/:id` `{action:"approve"\|"delist"\|"block", reason}` | 核准上架／下架／封鎖（下架、封鎖原因必填並永久保留）。 |

### 5.5 公開
`GET /api/health` → 200 `{ok:true, db_time, migrations}`；資料庫不通回 503。

### 5.6 資料庫對照（給需要讀 schema 的人）
schema 全貌見 `db/migrations/001_init.sql`（含各表註解）。表名為小寫底線（`order_item`、`order_item_revision`、`price_check`…）。

## 6. 部署前置：Adapter 換成 Vercel（2026-10-30，僅本機，未 push、未部署）

**改了什麼**
- 本機 git：`git init` 後已做第一次 commit `6ac880c`（訊息「收單核心完成：後端API與前端頁面」）；`git status` 與 commit 內容確認不含 `.env`、`.pgdata/`、`node_modules/`、`dist/`（只含 `.env.example`）。`.gitignore` 原本即已排除，無需修正。
- `npm uninstall @astrojs/node`、`npm install @astrojs/vercel`（現為 `^11.0.17`）；`package.json`／`package-lock.json` 已更新。
- `astro.config.mjs`：`import node from '@astrojs/node'` → `import vercel from '@astrojs/vercel'`；`adapter: node({ mode: 'standalone' })` → `adapter: vercel()`。其餘（`output: 'server'`、載入 `.env` 的段落）未動。
- `.gitignore` 追加 `.vercel/`（Vercel adapter 的建置輸出）。
- 未改 `.env`；未執行任何 vercel 連結／部署指令。

**驗證結果**
- `npm run build`：通過（adapter 顯示 `@astrojs/vercel`，產出 `.vercel/output`，Complete）。
- `astro dev` 重啟後 `curl /api/health` → HTTP 200 `{"ok":true,...,"migrations":1}`；驗畢已 `astro dev stop`。

**注意／待確認**
- `package.json` 的 `npm start`（`node --env-file=.env dist/server/entry.mjs`）是 node adapter 的 standalone 啟動方式，換 Vercel 後已不適用；本機正式模式驗證請改用 `npm run preview` 或 `vercel dev`（後者屬 Vercel 指令，未經授權不執行）。尚未改腳本，待 PM 確認是否移除。
- 上方第 2 節與第 3 節末項提到 `@astrojs/node`／`npm start` 的敘述已過時，以本節為準。
- `.gitignore` 與本節、`package*.json`、`astro.config.mjs` 的變更尚未 commit（任務只要求第一次 commit）。
- 部署時需在 Vercel 設定 `DATABASE_URL` 等環境變數（屬第三級，須 Grant 當次同意）；管理員登入節流在 serverless 多實例下為單機記憶體（見第 4 節第 11 點）。

## Neon 管理員密碼更換
- 已更新：是
- 更新時間：2026-10-30 17:07（+08:00）
- 影響列數：1（更新前 SELECT 確認管理員僅 1 列）
- 驗證方式：以新雜湊格式（scrypt$salt$hash）從資料庫讀回後比對，通過；未實際登入

## 正式資料整備
**授權紀錄**：刪除種子資料一事，Grant 本人已於 2026-10-30 18:15 在與 PM 的聊天中明確同意；方案為「先做可靠備份，確認備份成立後才刪除」，備份首選 Neon branch 快照。連線一律用 `.env` 的 `MIGRATE_DATABASE_URL`。邊界：只動 Neon 資料；不改程式；不動本機資料庫；不 commit、不 push、不部署。

**步驟清單**（前一步未驗證成功不進下一步；任一步失敗即停，不繞過、不重試刪除）
0. 寫入授權紀錄與步驟清單（本節）
1. 備份：優先建 Neon branch `backup-20261030-before-cleanup`；不行則 (a) 全庫匯出檔 `C:\Users\Grant\usshop-meeting\neon-backup-20261030.*` ＋ (b) 同庫 `backup_20261030` schema 複製；擇一驗證可讀才算成立
2. 盤點：person 全部（管理員／3 位種子示範家人）、精選商品件數、示範家人各相依表筆數
3. 刪除 3 位示範家人（子表先刪，管理員不動）
4. 刪除 5 件種子精選商品
5. 建立 7 位正式家人：jessica、louise、peggy、bro、sis、aunt、Cynthia
6. 產生 7 條邀請連結，寫入 `C:\Users\Grant\usshop-meeting\INVITES.txt`（不寫入 PROGRESS／log）
7. 驗證（1 管理員＋7 家人、示範家人 0、精選 0、/api/health ok:true）並補完本節

**執行紀錄**
- **步驟1 備份（完成，2026-10-30）**：Neon branch **無法由本機建立**（無 neonctl、無 NEON_API_KEY、無已登入的 Neon 管道；以瀏覽器 OAuth 登入屬第三級須 Grant 當次同意，故未嘗試），依指示改用雙備份：(a) 全庫 JSON 匯出 `C:\Users\Grant\usshop-meeting\neon-backup-20261030.json`，8,905 bytes，17 張表，已重讀 JSON 逐表比對筆數一致；(b) 同庫 `backup_20261030` schema，17 張表以 CREATE TABLE AS 複製，逐表筆數與原表一致（person 4、product 5、candidate 5、batch 1、session 1、setting 1、schema_migrations 1，其餘 0）。兩者皆驗證可讀。註：備份不含約束／索引，僅供資料還原。
- **步驟2 盤點（完成）**：person 共 4 筆：id1 管理員（admin）；id2 家人甲、id3 家人乙、id4 家人丙（種子示範家人，皆有未用邀請）。精選商品 5 件（id1–5：範例運動長褲、範例保暖外套、範例背包、範例毛帽、範例運動襪三入），各有 1 筆 candidate（product_id 1–5）。3 位示範家人在所有以 person 為外鍵的表筆數皆為 0（session、order_item、order_item_revision、price_check、estimate、shipment、settlement、change_log、setting 皆 0）；商品被 order_item／price_check 引用 0 筆，僅被 candidate 5 筆引用。庫內無 trigger。
- **步驟3＋4 刪除（完成，單一交易、帶筆數斷言，皆提交）**：person 3 筆（家人甲／乙／丙，id 2–4；其相依表原本即 0 筆，故無子表可刪）；candidate 5 筆（精選商品的子表，source_url 皆 example.com/sample）；product 5 筆。管理員（id1）未動，交易內斷言管理員仍為 1。
- **步驟5 建立正式家人（完成）**：7 位 person（jessica、louise、peggy、bro、sis、aunt、Cynthia），role=family，disabled_at 為空（可登入）。
- **步驟6 邀請連結（完成）**：沿用網站 `issueInvite` 同一邏輯（token＝32 bytes base64url、庫內存 sha256、效期 336 小時＝`.env` INVITE_TTL_HOURS，並寫 change_log），以 migrate 連線直接寫庫；因為正式站管理員密碼不經我手，未走 HTTP API。連結已逐行寫入 `C:\Users\Grant\usshop-meeting\INVITES.txt`（7 行，格式「代號 空格 連結」，網址開頭 https://usshop.vercel.app）；連結未寫入 PROGRESS／log。**待確認**：Vercel 正式環境若另設 INVITE_TTL_HOURS，實際效期以庫內 invite_expires_at（現為 14 天）為準。
- **步驟7 驗證（通過）**：person＝1 admin＋7 family；示範家人 0；精選商品 0（product 總數 0）；`GET https://usshop.vercel.app/api/health` → `{"ok":true,"migrations":1}`。
- **其他**：`backup_20261030` schema 與 JSON 備份保留未刪；一次性腳本在 `scripts\`（backup-20261030.ts、inv.ts、cleanup.ts、create-family.ts），未 commit；未改程式、未動本機庫、未 push／部署。目前 git 狀態另有先前未 commit 的 PROGRESS_CLAUDE.md 修改。建議確認家人收到連結、登入正常後，再決定何時刪除 backup schema（刪資料須 Grant 當次同意）。

## 精選型錄匯入
**依據**：`C:\Users\Grant\usshop-meeting\catalog-import.json`（價格為 2026-10-30 查官網定價）。連線一律用 `.env` 的 `MIGRATE_DATABASE_URL`（Neon 正式庫）。邊界：只動 Neon 資料；不改程式；未 commit、未 push、未部署。腳本在 `scripts\import-catalog.ts`、`scripts\verify-catalog.ts`（未 commit）。

- **步驟1 批次改名（完成）**：批次改名沒有專屬 API，直接 `UPDATE batch`（帶 `status='open' and name='示範批次'` 條件，影響 1 列）。SELECT 驗證：id 1「2026 黑五合購」，status `open`（庫內僅此 1 批）。
- **步驟2 匯入（完成，單一交易）**：10 款寫入 `candidate`＋`product`（照 `/api/admin/candidates` 匯入邏輯與 `change_log`）。欄位對應：`name`＝「name_zh（name_en）」、`source_url`＝url、`image_path`＝image_url、`currency`＝USD、`list_price`＝`sale_price`＝price_usd、`sizes_available`＝`[sizes]`、`checked_at`＝2026-10-30（查價日期欄）、`stock_note`＝「簡介｜顏色：…｜2026-10-30 查價」、商家 `lululemon 官網`（`brand_official`，白名單通過）。10 款皆未命中限制類關鍵字，直接 `listed`。
  - candidate id／product id（一一對應）：**6／6、7／7、8／8、9／9、10／10、11／11、12／12、13／13、14／14、15／15**（Align 28吋、Align 口袋 25吋、Wunder Train 25吋、Align 背心、Align V領內衣、Define 外套、Swiftly 短袖、Swiftly 長袖、Align 短褲 6吋、Everywhere 腰包）。
- **步驟3 圖片驗證（外連可用）**：帶 `Referer: https://usshop.vercel.app` 抽測 3 款（Align 28吋、Swiftly 長袖、Everywhere 腰包），皆 HTTP 200、`content-type: image/jpeg`。未被擋，故**不需自架**，未建立 `public\catalog\`。
- **步驟4 驗證（通過）**：`candidate` 共 10 筆、`listed` 10、欄位完整檢查（product 關聯、連結、圖、價格、尺寸、查價註記）10／10；`product` 共 10 筆且皆 `is_featured`。`GET https://usshop.vercel.app/api/health` → `{"ok":true,"migrations":1}`。
- **待辦／待確認**：
  1. 不需為本次匯入部署（資料在庫，網站直接讀）。
  2. 圖片為外連 lululemon CDN；若日後改網址或擋盜連，再改自架（需 commit＋push＋部署）。
  3. 資料表無獨立「顏色」「簡介」欄，已併入 `stock_note`；家人端是否要單獨顯示請 PM／Codex 席確認。
  4. 家人端 `GET /api/catalog` 尚未以家人身分實際打過（正式站邀請連結為單次，未動用）。
  5. `candidate` 的 `spec_label` 留空（顏色屬選擇性資訊），家人建草稿後需自填規格／顏色。

## 邀請重發：Cynthia（2026-10-30）
- 原因：Cynthia 的邀請連結被 Grant 測試點開、已兌換（invite_redeemed_at 有值）。
- 作法：一次性腳本 `scripts/reissue-cynthia.ts`，先把舊邀請標 `invite_revoked_at = now()`，再呼叫專案現成的 `issueInvite()`（同一個 `newToken`／`sha256`、`INVITE_TTL_HOURS=336`），並刪除 Cynthia 名下的 session。只動 Cynthia 一人，未改程式、未 commit／push／部署。
- 驗證（Neon 正式庫 SELECT）：重發前 redeemed 有值、session 1 筆；重發後 `invite_token_hash` 存在（新雜湊）、`invite_redeemed_at` 為空、`invite_revoked_at` 為空（已由新邀請取代）、`invite_expires_at` 為 2026-11-13、session 0 筆。
- 檔案：`usshop-meeting\INVITES.txt` 僅 Cynthia 一行更新（仍 7 行）；新連結另存 `INVITE_CYNTHIA_NEW.txt`（一行，與 INVITES 內容一致）。

## 測試帳號（2026-10-30）
- 已建立：person「test」（id 12，role=family，disabled_at 為空＝可登入），用途是讓 Grant 自己測試家人視角，避免再燒到真家人的單次邀請連結。
- 作法：一次性腳本 `scripts/create-test.ts`，沿用 `create-family.ts` 同一套邀請邏輯（32 bytes base64url token、庫內存 sha256、效期 336 小時、寫 change_log），連 Neon 正式庫（`MIGRATE_DATABASE_URL`），單一交易。
- 驗證：person 由 8 筆（1 admin＋7 family）變 9 筆；test 有邀請雜湊、效期至 2026-11-13；其他 7 位家人與管理員未動。
- 邀請連結單獨存於 `usshop-meeting\INVITE_TEST.txt`（一行）；`INVITES.txt` 未更動。連結未寫入本檔。
- 邊界：只新增 test 一人；未改程式、未 commit、未 push、未部署。

## 精選圖片修復（2026-10-30）
**結論：資料與 API 都正確，根因在前端程式；依邊界停手，等 PM 指示。未改程式、未改任何資料、未 commit／push／部署。**

- **步驟1 比對資料（Neon 正式庫，MIGRATE 連線，SELECT）**：圖片欄位只有 `candidate.image_path` 與 `product.image_path`（庫內無其他 image／img 欄）。candidate id 6–15 共 10 款，兩欄皆與 `catalog-import.json` 的 `image_url` **逐字完全相等**（`===`）；長度一致（174／176／79），無截斷；含 `&` 的 9 款原樣保存，無 `&amp;`、`%26`、反斜線等轉義；未存到別的欄位。故無資料可修，**不需 UPDATE**。
- **步驟2 前端讀法（根因）**：
  - API：`src/pages/api/catalog.ts`（select `c.*`）→ `src/server/items.ts:197` `candidateView` 回傳 `image_path: c.image_path`，原值照傳。
  - 卡片：`public/app/main.js:9`，`<img src="${esc(c.image_path?.startsWith('/')&&!c.image_path.startsWith('//')?c.image_path:'/images/placeholder.svg')}">`。**只有以單一 `/` 開頭的站內相對路徑才採用，`https://` 開頭的外部網址一律改顯示 `/images/placeholder.svg`（內容即「示範圖片」，`public/images/placeholder.svg`）**。10 款 image_path 都是 lululemon CDN 的 https 網址，所以全部落到佔位圖。同檔 `main.js:24` 另有 `/catalog` 用法但不涉圖片。
  - 正式站已部署的 `/app/main.js` 確認含此 `startsWith('/')` 判斷（與本機一致）。
- **步驟3 修復**：資料層無解——要讓圖顯示，只能（a）改 `main.js:9` 的判斷，允許 `https:` 開頭（例如沿用 `shared.js:15` 的 `safeUrl`，僅放行 http／https）；或（b）把圖片下載自架到 `public/catalog/`，並把 image_path 改成 `/catalog/xxx.jpg`（同樣要 commit＋push＋部署，且 hotlink 現況可用、自架非必要）。兩者皆需改程式或部署，**依指示停下**。**需 PM 指示**：建議由改顯示層的那一席在 `main.js:9` 放行 https 外連圖（img 可加 `referrerpolicy` 視需要；目前帶 Referer 與否皆 200）。若採此案，改完部署後我可重跑下方驗證。另注意 `public/app/mock.js:5` 示範資料用 `/images/placeholder.svg`，不受影響。
- **步驟4 真實驗證**：腳本 `scripts/diag-images.ts`（未 commit）。以 `MIGRATE_DATABASE_URL` 為 person「test」（id 12）在 `session` 表新增一筆 family session（比照 `createSession`：32 bytes base64url token、庫存 sha256、kind=family、效期 1 小時），帶 `Cookie: usshop_session=…` 呼叫 **正式站 `GET https://usshop.vercel.app/api/catalog`** → HTTP 200、items 10 筆；10 款回傳的 `image_path` 全部與 `catalog-import.json` 的 `image_url` 逐字相等；再以 `Referer: https://usshop.vercel.app` 逐一抓這 10 個網址，**全部 HTTP 200、`content-type: image/jpeg`**。驗證後該 session 已立即 `revoked_at = now()`（腳本 finally 區塊）。token 未印出、未寫入檔案。
  - 即：API 與圖片來源皆正常，家人端看到佔位圖純粹是 `main.js:9` 的前端判斷所致。**頁面層的最終視覺驗證須待前端修正部署後再做。**
- **給其他席次**：請改顯示層的席次留意 `public/app/main.js:9`（上述）；`session` 表多一筆已撤銷的 test 驗證 session，無影響。

## 台灣參考價匯入（2026-10-30）
- **步驟1 欄位確認**：家人端卡片「台灣參考價」＝ `candidate.tw_ref_price`（`src/server/items.ts` `candidateView` → `tw_ref`）。10 款（candidate／product id 6–15）以品名逐款核對，與指示對應全數相符，匯入前 `tw_ref_price` 皆為 null。
- **步驟2 已寫入**（單一交易，條件含「id＋品名片段相符＋原值為 null」，任一不符即 rollback）：6＝3480、7＝4480、8＝3480、9＝2280、11＝5280、12＝2280、13＝2680、14＝1980、15＝1280（整數 TWD）。
- **步驟3**：id 10（Align V-Neck Bra，$58）`tw_ref_price` 維持 null；`stock_note` 原值完整保留，尾端加上「・台灣官方店面未售」（現為「…｜2026-10-30 查價・台灣官方店面未售」）。
- **步驟4 驗證**：
  - DB 回讀：id 6–15 的 `tw_ref_price` 與上列相符，id 10 為 null，備註尾綴正確。
  - 正式站 API：以 test 帳號（id 12）臨時 family session（1 小時效期，驗後已 `revoked_at`）呼叫 `GET https://usshop.vercel.app/api/catalog` → 200、10 筆；備註尾綴已出現在 id 10。**但 10 款 `tw_ref` 全部仍回 `{price:null,label:"待查"}`，新價格未顯示。**
  - **原因**：`candidateView` 只在 `same_spec_basis` 非空且 `tw_ref_price` 有值時才輸出台灣參考價（`items.ts:189`）；10 款的 `same_spec_basis` 目前皆為 null（schema 註解：空＝無法確認同規格，不顯示價差）。另 `tw_ref_source`、`tw_ref_checked_at` 亦為 null。
- **待確認（需 PM／Grant）**：要讓家人端顯示，需補寫這 9 款的 `same_spec_basis`（同規格依據說明）、並建議補 `tw_ref_source`（例如 lululemon.com.hk zh-tw 店面）與 `tw_ref_checked_at`＝2026-10-30。這些超出本次授權範圍（只動價格與備註尾綴），未動；請指示文字內容與是否同意寫入。同規格是否成立（台灣店面尺寸／色／版本與美國站是否同款）需由查價者確認，我不自行宣稱。
- 未改程式、未 commit、未 push、未部署。

## 台灣參考價把關補寫（2026-10-30）
- **步驟1 語意確認**：`items.ts:189` `showDiff = same_spec_basis && tw_ref_price`，兩者皆非空才輸出 `tw_ref`（含 price／source／checked_at）；否則回 `{price:null,label:'待查'}`。三欄皆為自由文字／時間戳，無格式限制（schema 註解：`same_spec_basis` 空＝無法確認同規格）。
- **步驟2 已寫入**（腳本 `scripts/twref-basis.ts`，未 commit；單一交易，條件含「id＋品名前綴相符＋三欄原值皆 null」，任一不符即 rollback；本次全數通過、無停下）：
  - id 6–9、11–15（9 款）：`same_spec_basis`＝「lululemon 台灣官方店面（lululemon.com.hk zh-tw）同款同規格產品頁對照」，`tw_ref_source`＝指示所列各款 zh-tw 產品頁 URL，`tw_ref_checked_at`＝2026-10-30（+08:00 午夜，庫內為 2026-10-29T16:00Z）。
  - id 10（Align V-Neck Bra）：`same_spec_basis`＝「台灣官方店面查無此商品」，`tw_ref_source` 維持 null，`tw_ref_checked_at`＝2026-10-30，`tw_ref_price` 維持 null。
- **步驟3 驗證**（腳本 `scripts/twref-verify.ts`；test 帳號 id 12 臨時 family session，1 小時效期，驗後已 `revoked_at`）：正式站 `GET /api/catalog` → 200、10 筆。9 款 `tw_ref.price` 正確：6＝3480、7＝4480、8＝3480、9＝2280、11＝5280、12＝2280、13＝2680、14＝1980、15＝1280，且帶出 source、checked_at 與「僅為商品價格比較」備註。id 10 回 `{price:null,label:'待查'}`，無錯誤金額。
- **註明（V-Neck Bra）**：因程式條件需 `tw_ref_price` 有值，id 10 仍顯示「待查」，無法顯示「台灣未售」；依指示未改程式。若要顯示「未售」需改 `candidateView`（PM 決定）；目前備註尾綴「・台灣官方店面未售」仍在 `stock_note`。
- **待確認**：id 11 庫內品名為「Define 修身外套」，但指示給的台灣頁 URL slug 為「寬版剪裁外套」（`define-寬版剪裁外套-luon`），字面不同；價格與頁面由查價者於 10-30 實機核對，我未重新驗證，請 PM 確認該頁確為同款。
- 邊界：只動 candidate 6–15 的三欄；未改程式、未 commit／push／部署。`scripts/` 新增 `twref-list.ts`、`twref-basis.ts`、`twref-verify.ts`（一次性，未 commit）。

## 配對標準修正（2026-10-30）
- **背景**：Grant 定案台灣參考價配對標準為「同設計款即同款，不比對尺寸、碼數、型號，地區規格差異不影響對照」；run13 寫入的 `same_spec_basis`（「…同款同規格產品頁對照」）與標準不符，需修正。
- **步驟1**：candidate id 6–9、11–15（9 款，有 `tw_ref_price`）`same_spec_basis` 改為「台灣官方店面同設計款產品頁對照（不比對尺寸／型號）」。
- **步驟2**：id 10（Align V-Neck Bra）`same_spec_basis` 改為「台灣官方店面查無此設計款商品」。
- **作法**：一次性腳本 `scripts/twref-basis-fix.ts`（未 commit）；單一交易，條件含「id＋原文字完全相符」，筆數須為 9＋1，否則 rollback；本次一次通過。只 UPDATE `same_spec_basis` 一欄（product 表無此欄）。
- **步驟3**：`tw_ref_source`、`tw_ref_checked_at`、`tw_ref_price` 未動（SQL 未觸及；回讀 price 與 checked_at＝2026-10-29T16:00Z 如前）。
- **步驟4 驗證**（`scripts/twref-verify.ts`；test 帳號 id 12 臨時 family session，驗後已 `revoked_at`）：正式站 `GET /api/catalog` → 200、10 筆；9 款 `tw_ref.price` 仍正常輸出：6＝3480、7＝4480、8＝3480、9＝2280、11＝5280、12＝2280、13＝2680、14＝1980、15＝1280；id 10 仍回 `{price:null,label:'待查'}`（程式條件需有價格，與前次相同）。
- **待確認**：id 11 品名「Define 修身外套」與台灣頁 slug「寬版剪裁外套」字面不同；依新標準以「設計款」認定，仍請查價者確認為同設計款。
- 邊界：只動 `same_spec_basis` 一欄；未改程式、未 commit／push／部署。

## 台灣未售標籤（2026-10-30，Grant 已核准併入本次部署）
- **改動檔案**：
  - `src/server/items.ts` `candidateView`：無台灣價時，`tw_ref_price` 為空且 `same_spec_basis` 含「查無」→ `{price:null,label:'台灣未售'}`；其餘不變（有價出價格、未查出「待查」）。
  - `tests/tw-ref.test.ts`（新增）：查無→台灣未售、未查價→待查、有價→出價格，共 2 個測試。
  - `package.json`：`test:unit` 加入 `tests/tw-ref.test.ts`。
- **驗證**：
  - `npm run test:unit` 12 通過／0 失敗；`npx tsc --noEmit` 無錯誤；`npm run build` Complete。
  - 未跑 `tests/api.test.ts`：它會寫入資料，而 `.env` 指向正式庫，故不在正式庫上跑。
  - 本機 dev server（讀正式庫）以 test 帳號臨時 family session（驗後已 `revoked_at`）呼叫 `GET /api/catalog` → 200、10 筆：id 10（Align V-Neck Bra）`tw_ref`＝`{price:null,label:"台灣未售"}`；其餘 9 款價格不變：6＝3480、7＝4480、8＝3480、9＝2280、11＝5280、12＝2280、13＝2680、14＝1980、15＝1280，source／checked_at／note 不變。
- **⚠ 前端寫死標籤（需 PM 指示，我未動）**：`public/app/main.js`（卡片的「台灣參考價」那段，同檔另有多處 `tw_ref`）寫死 `c.tw_ref?.price==null?'待查':…`，**不讀 `tw_ref.label`**。因此只部署後端時，家人端畫面仍顯示「待查」，要前端改成顯示 `c.tw_ref.label` 才會看到「台灣未售」。該檔屬 Codex 席範圍且有未提交修改，依指示不自行改、也不另寫判斷。`public/app/mock.js` 的示範資料也有 `label:'待查'`，不影響正式站。
- 邊界：只動台灣價標籤邏輯；未 commit／push／部署。dev server 已停止；臨時驗證腳本已刪除。

## 部署 2026-10-30 晚

### 1. 已完成（附證據）
- **閘門全過**：`npm run build` 通過；`npx tsc --noEmit` 0 錯誤；`test:unit` 12／12；前端 `src/components/*.test.mjs` 21 通過、1 跳過（需 INVITE_LIVE_TEST 的本機真實 API 項）；`test:api` 32／32（以本機 5433 庫的環境變數執行，未碰正式庫）。
- **納入項目**：run7 台幣換算顯示、run11 精選圖片 https 放行、run15 台灣未售標籤、run16 邀請失效頁友善化（PROGRESS_CODEX 已有該節且驗證通過，故一併納入）。
- **commit**：`2fd227a480479ad1072dde46f1d0face8e719de0`；已 `git push origin master`（7be6bbc..2fd227a）。
- **未納入**：`scripts/`（本機維運腳本）與 `sess-out.txt`（暫存輸出），皆維持未追蹤。
- **上線時間**：push 約 19:50（本機時間）；19:50:38 health 回 200，19:51:00 正式站 `/app/main.js` 已含新版邀請文案「這個連結已經用過了」，確認新版已部署。
- **正式站驗證**：
  - `GET /api/health` → 200（`ok:true, migrations:1`）。
  - test 帳號臨時 session（`scripts/twref-verify.ts`，1 小時效期，驗後已 `revoked_at`）呼叫 `/api/catalog` → 200、10 筆。9 款台灣價：6＝3480、7＝4480、8＝3480、9＝2280、11＝5280、12＝2280、13＝2680、14＝1980、15＝1280，全部正確；id 10 V-Neck 為 `{price:null,label:"台灣未售"}`。
  - 正式站家人端 JS：首頁圖片邏輯已改為接受 https 外連（`/^https:\/\//i` 通過即使用原網址），僅非 https 才換 `/images/placeholder.svg`；新版 JS 已在線上。

### 2. 如何啟動或驗證
- 健康檢查：`https://usshop.vercel.app/api/health`；家人視角用 test 帳號。

### 3. 未完成
- 尚未做手機／LINE 瀏覽器實機視覺驗收（圖片實際顯示、邀請失效頁畫面）。

### 4. 待確認
- 舊規格（DEV_SPEC 3.3／3.4／8.2）「圖片自存、不熱連結」與本次 https 外連放行不一致，待 PM 同步規格。

### 5. 給其他席次的交接資訊
- 本次未改程式內容、未動 Vercel 設定與環境變數；自動部署正常觸發。PROGRESS 本節為 commit 後追加，尚未 commit。

## 型錄第二批：特價款 15 款匯入
（Grant 2026-10-30 21:04 核准全數匯入；純資料匯入，未改程式、未 commit／push／部署。）
- **匯入筆數**：15／15，全部 `listing_status='listed'`（無限制詞命中），各自建立 product 並 `is_featured=true`，change_log 已記「匯入」。**新 candidate id＝16–30**（product id 同為 16–30）。腳本 `scripts/import-catalog2.ts`（單一 transaction、以 source_url 防重；本次無重複、無跳過）。
- **特殊處理**：第 7 筆（id 22）`tw_ref_source` 的佔位字串 `COPY_FROM_CANDIDATE_8` 已改寫為 candidate 8 的原值（`…/wunder-train-…-25%22/prod9750562.html`）。
- **驗證**（test 帳號臨時 session 讀正式站 `GET /api/catalog`，驗後已 `revoked_at`，臨時驗證腳本已刪）：
  - (a) 200、總數 25；16–30 全在清單內。✔
  - (b) 11 筆有台灣價款的 `tw_ref.price` 與 JSON 一致（4480／1980／2280／3480／3480／2680／2680／5280／4780／2680／2680）。✔
  - (c) Fast and Free 保暖褲(17)、BeCalm 百慕達短褲(19)、Define Track 外套(23)、Silky 高領背心(28) 皆為 `{price:null,label:'台灣未售'}`。✔
  - (d) id 22 的 `tw_ref_source` 與 id 8 相同、為正式 URL；DB 內 `COPY%` 佔位字串列數＝0。✔
- **待確認**：JSON 無「定價」欄位，`list_price` 與 `sale_price` 依第一批作法皆寫特價（`price`）；原價（如 US$118）僅在 `promo_conditions` 文字內。若前端需顯示原價／折扣，需 PM 另定欄位來源。merchant 欄依 JSON 寫「lululemon 美國官網」，與第一批的「lululemon 官網」字面不同，product.store 則沿用「lululemon 官網」。

## 台灣未售標籤前端補修（接手）
（Grant 已核准本批部署；接手自 Codex run18 未完成的本機修改。）
- **改動**：僅 `public/app/main.js`，`home()` 精選卡片的「台灣參考價」一處（全檔唯一使用 `tw_ref` 的渲染處；item 頁與其他頁面未使用 tw_ref）。`tw_ref.price` 為 null 時顯示 `esc(tw_ref.label || '待查')`，有價時維持原顯示。未動後端、資料庫與其他檔案。
- **檢查結果**：`node --check main.js` 通過；`npm run build` 通過；`npx tsc --noEmit` 0 錯誤；`test:unit` 12／12；前端 `src/components/*.test.mjs` 21 通過、1 跳過（INVITE_LIVE_TEST 項）；`test:api` 32／32（`.env` 指向 Neon 正式庫，故以 `.env.example` 的本機 5433 庫變數覆蓋執行並起本機 dev server，未碰正式庫）。
- **commit hash／部署驗證**：見下方追加。
- **commit**：`5cead8d`（已 push 到 master）。
- **部署驗證**：輪詢 `https://usshop.vercel.app/app/main.js`，約 30 秒內（第 3 次輪詢）內容已含 `tw_ref?.label`，新邏輯已上線。尚未人工檢視站上「台灣未售」實際畫面（需登入家人帳號），列為待確認。
- **注意**：本節補記 commit hash 與驗證結果的檔案變更尚未 commit（避免再觸發一次部署）；`scripts/`、`sess-out.txt` 為前手遺留的未追蹤檔，未處理。

## 精選分類功能（本地實作・待部署）
（Grant 2026-10-30 21:51 核准分類方案。本節為本機實作與測試，**未 commit、未 push、未部署、未對正式 Neon 執行 migration 或任何寫入**；本機驗證時以環境變數覆蓋 `.env`，連本機 5433 庫。）

### 1. 已完成（附證據）
- **改動檔案**：
  - `db/migrations/002_candidate_category.sql`（新增）：`candidate` 加 `audience`（women／men／accessories）、`category`（9 個代碼）兩欄，皆可 null，並有 check 約束。
  - `src/server/taxonomy.ts`（新增）：代碼清單與值域判斷。
  - `src/server/items.ts`：`candidateView` 輸出 `audience`（null 時 null）、`category`（null 時 `'other'`）。
  - `src/pages/api/admin/candidates/index.ts`：匯入接受 `audience`／`category`。**值域驗證採既有風格（同 merchant_type）：不在清單內回 400 `invalid_field`，不默默歸 other**；未帶＝新增時存 null、更新既有列時沿用原值（`coalesce`）。另因 `category` 先前被當作自由文字餵給限制類關鍵字比對，現已改為代碼，該比對只看 name／spec_label（代碼本身不含限制詞，行為不變）。
  - `public/app/catalog-filter.js`（新增）：篩選純函數（對象、品類、搜尋、件數、有商品的品類）。
  - `public/app/main.js`：首頁精選區加對象 tabs（附件數）、品類 chips（只列目前對象下有商品者）、搜尋框（商品名／spec_label／商家，不分大小寫）、結果件數、空狀態「這個分類目前沒有商品，看看全部吧。」＋清除篩選。卡片內容抽成 `card` 函式，**內容未改**（價格、台灣參考價／label、價格待更新不可送出、挑這件連結皆維持）。tabs／chips 為 `button` 並標 `aria-pressed`；搜尋框有 `<label>`。搜尋框只渲染一次，輸入時不重建，避免打斷中文輸入法組字。
  - `public/app/style.css`：追加 `.chip`／`.filter-*` 樣式。
  - `public/app/mock.js`：示範資料補 audience／category（僅 `?demo=1`）。
  - `src/components/catalog-filter.test.mjs`（新增，6 個單元測試）；`src/components/fx-render.test.mjs`：DOM 替身補 `querySelector`／`querySelectorAll`／`focus`，卡片斷言改讀 `#catalog-results`（因卡片現在渲染在該區塊）。
  - `tests/api.test.ts`：新增 1 個測試（分類輸出、未分類 null／other、未帶沿用、重匯更新、不合法值 400）。
  - `scripts/catalog-category-map.json`、`scripts/backfill-catalog-category.ts`（新增，未追蹤目錄 scripts/ 內）。
- **migration 名稱**：`002_candidate_category.sql`（只在本機 5433 庫套用，本機 `schema_migrations` 現為 2 筆）。
- **檢查結果**（全部通過）：
  - `npx tsc --noEmit`：0 錯誤。
  - `npm run build`：Complete。
  - `npm run test:unit`：12／12。
  - 前端 `node --test src/components/*.test.mjs`：27 通過、0 失敗、1 跳過（INVITE_LIVE_TEST 項；先前為 21＋1，新增 6 個）。
  - `npm run test:api`（本機 5433 庫＋本機 dev server）：33／33（先前 32，新增 1）。
  - backfill script 在本機庫驗證：以 2 筆臨時資料（含 V-Neck Bra 關鍵字比對、Daydrift 寬腿褲）預覽→`--apply`→重跑，結果為 women/bras、women/pants、重跑顯示「已是目標值」；臨時資料已刪除。
  - 瀏覽器驗證：以本機 dev server `/?demo=1`（示範資料 3 件）用 headless Chrome 截圖並以 CDP 實際點擊：tabs 切換、件數、品類 chips 隨對象動態變化（男裝只剩「其他」）、包包品類、搜尋「長襪」→1 件、價格待更新卡仍為停用按鈕「價格待更新，暫時不能選」、搜尋無結果顯示空狀態文字；aria-pressed 正確。**「清除篩選」按鈕未在瀏覽器實際點擊驗證**（只靠程式碼檢視，邏輯為重設篩選、清空搜尋框並聚焦）。未用真實 25 件資料與手機實機看過。

### 2. 如何啟動或驗證
- 本機：`powershell -File db/local-pg.ps1 start`，設定 `.env.example` 的本機 DATABASE_URL／MIGRATE_DATABASE_URL 環境變數後 `npm run db:migrate`、`astro dev --background`；打開 `/?demo=1` 看分類 UI。**注意：本機 `.env` 指向正式庫，務必以環境變數覆蓋，勿直接 `npm run db:migrate`。**
- backfill 預覽：`npx tsx --env-file=.env scripts/backfill-catalog-category.ts`（預設只預覽並回滾，`--apply` 才寫入）。

### 3. 未完成
- 正式庫尚無分類資料，正式站目前不會顯示分類（部署前程式碼對 null 友善：對象只在「全部」出現、品類歸「其他」）。
- 管理端尚無編輯分類的介面（目前只能經匯入 API 或 backfill 設定）；若需要請 PM 另定。

### 4. 待確認
- 值域不合法時採「拒絕 400」而非「歸 other」（見上），若 PM 想改成歸 other 請告知。
- 「男裝」目前 0 件，tab 仍顯示「男裝（0）」，點下去顯示空狀態；是否要在 0 件時隱藏該 tab，待 PM／Grant 決定。
- 首頁卡片資料量大時（目前 25 件）未做分頁／虛擬捲動，維持原樣。

### 5. 給其他席次的交接資訊
- **25 筆對照表**（鍵＝正式庫 `candidate.name`，取自 usshop-meeting 的 import 檔）：
  - 第一批（catalog-import.json，名稱格式為 `name_zh（name_en）`，與 import-catalog.ts 寫入格式一致）：
    1. Align 高腰瑜伽褲 28吋（lululemon Align™ High-Rise Pant 28"）→ women/leggings
    2. Align 口袋款瑜伽褲 25吋（lululemon Align™ High-Rise Pant with Pockets 25"）→ women/leggings
    3. Wunder Train 高腰訓練褲 25吋（Wunder Train High-Rise Tight 25"）→ women/leggings
    4. Align 背心上衣（lululemon Align™ Tank Top *Light Support, A/B Cup）→ women/tops
    5. **Align V領運動內衣（lululemon Align™ V-Neck Bra *Light Support, A/B Cup）→ women/bras**（鍵值如左；完全比對不到時，以 `V-Neck Bra` 關鍵字、不分大小寫、須唯一命中的 `ilike` 比對）
    6. Define 修身外套（Define Jacket *Luon）→ women/jackets
    7. Swiftly Tech 短袖上衣 2.0（Swiftly Tech Short-Sleeve Shirt 2.0 *Hip Length）→ women/tops
    8. Swiftly Tech 長袖上衣 2.0（Swiftly Tech Long-Sleeve Shirt 2.0 *Waist Length）→ women/tops
    9. Align 高腰短褲 6吋（lululemon Align™ High-Rise Short 6"）→ women/shorts
    10. Everywhere Belt Bag 腰包 1L（Everywhere Belt Bag 1L）→ accessories/bags_accessories
  - 第二批（catalog-import2.json，name 欄原樣）：
    11. Ace Advantage 網球裙 → women/skirts_dresses
    12. Fast and Free 保暖緊身褲 28" → women/leggings
    13. Hotty Hot 短褲 2.5" → women/shorts
    14. BeCalm 百慕達短褲 → women/shorts
    15. Shake It Out 跑步短褲 2.5" → women/shorts
    16. Daydrift 打褶短褲 5" → women/shorts
    17. Wunder Train 緊身褲 25"（特價色） → women/leggings
    18. Define Track Jacket 外套 → women/jackets
    19. Groove 迷你裙 → women/skirts_dresses
    20. Court Rival 短褲 3" → women/shorts
    21. Flow Y 連身裙 → women/skirts_dresses
    22. Daydrift 寬腿褲 → women/pants
    23. Silky 高領瑜伽背心 → women/tops
    24. Swiftly Tech 長袖 2.0 齊腰款 → women/tops
    25. Swiftly Tech 長袖 2.0 短版 → women/tops
  - 統計：leggings 5、pants 1、shorts 6、skirts_dresses 3、tops 6、jackets 2、bras 1、bags_accessories 1，合計 25，與指示相符。
  - 第一批 10 筆鍵值是依 import 檔與 import-catalog.ts 的組字規則推得，**未連正式庫核對實際名稱**；上線前 backfill 的預覽模式會列出「找不到」者，不硬改。
- **API 契約**：`GET /api/catalog` 的每個 item 新增 `audience`（`women|men|accessories|null`）、`category`（9 個代碼之一，未分類為 `other`）。`POST /api/admin/candidates` 的每筆可選帶 `audience`／`category`。
- **上線時還需要做的步驟（皆待 Grant 另行核准，我未執行）**：
  1. 對正式 Neon 執行 `002_candidate_category.sql`（`npm run db:migrate`，用 owner 連線）。
  2. 先預覽再 `--apply` 執行 `scripts/backfill-catalog-category.ts`（正式庫連線），確認 25 筆全數命中、無「找不到」。
  3. commit／push（含 scripts 對照檔與 backfill script 是否入版控，請 PM 決定；`scripts/` 目前整個未追蹤）。
  4. 部署後以 test 帳號臨時 session 讀 `/api/catalog` 驗證 25 件皆有 audience／category，並以手機看一次分類 UI。
  - 順序注意：migration 要先於部署新後端（新後端的 `select c.*` 與匯入 SQL 會用到新欄位）。

## 測試連結應急發放（3 帳號）（2026-10-31，Grant 05:10 核准，正式 Neon 已寫入）

### 1. 已完成
- 以 `scripts/create-test3.ts`（比照 `create-test.ts`）在正式庫新增 3 位 family 角色 person：`test-phone`、`test-pc`、`test-school`（代號即 display_name）；同名已存在會跳過（本次皆為新建）。每人各產生一條邀請並寫 change_log（invite／issued）。
- **效期**：沿用家人邀請的固定機制，336 小時（14 天），失效時間 2026-11-13（UTC 21:12）；未另設 60 天（機制固定，依指示用預設）。
- 連結只寫入 `C:\Users\Grant\usshop-meeting\INVITES_TEST3.txt`（3 行，格式「代號 空格 連結」）；腳本未印出連結，本檔與 log 均無連結。
- **DB 實查**：person 總數 9 → 12；3 人皆 role=family、可登入、有邀請雜湊、`invite_redeemed_at` 為空（未兌換）、未撤銷。未動其他正式資料。

### 2. 如何驗證
- 查 `person where display_name in ('test-phone','test-pc','test-school')` 的 invite_redeemed_at 是否仍空；檔案行數 3。

### 3. 未完成／4. 待確認
- 這 3 條在 B 部署前仍是**單次連結**：第一次點開即用掉，其他裝置需另發。B 上線後將此 3 人設 is_test 才可重複使用（見下節）。
- 14 天後過期，過期後即使 is_test 也不能兌換（效期規則未改）。

### 5. 交接
- `scripts/create-test3.ts` 未入版控（`scripts/` 整體仍未追蹤）。

## 測試連結可重複兌換（本地實作・待部署）（2026-10-31）

### 1. 已完成
- `db/migrations/003_person_is_test.sql`：`person.is_test boolean not null default false`。
- `src/server/auth.ts` `redeemInvite`：兌換條件由 `invite_redeemed_at is null` 改為 `(invite_redeemed_at is null or is_test)`；撤銷、停用、過期、role 條件不變。兌換流程（`redeem.ts`）本來就只新增 session、不撤銷既有 session（只有重發／撤銷邀請會撤銷），故無需另改分支。一般家人行為不變。
- `tests/api.test.ts` 新增 1 個測試：is_test 人員連結兌換兩次皆 200、兩個 cookie 不同且皆可呼叫 `/api/items`、DB 中未撤銷 session 恰 2 筆；邀請過期後（is_test）仍 401；一般家人第二次兌換 401。
- **檢查結果（全以本機 5433 庫與本機 dev server，環境變數覆蓋 `.env`，未碰正式庫）**：`tsc --noEmit` 0 錯誤；`npm run build` Complete；`test:unit` 12／12；前端 `node --test src/components/*.test.mjs` 27 通過、0 失敗、1 跳過；`test:api` 34／34（先前 33，新增 1）。

### 2. 如何驗證
- 本機：`db/local-pg.ps1 start`，以環境變數指向 5433 後 `npx tsx db/migrate.ts`、`astro dev --background`、`npx tsx --test tests/api.test.ts`。

### 3. 未完成（皆待 PM 取得 Grant 核准後執行，我未執行）
上線步驟（順序不可顛倒；新後端 SQL 引用 `is_test`，migration 必須先於部署）：
1. 對正式 Neon 跑 003 migration（owner 連線，`npm run db:migrate`；會同時帶上尚未上線的 002）。
2. 正式庫執行：`update person set is_test = true where display_name in ('test','test-phone','test-pc','test-school') and role = 'family';`，並確認影響 4 列。
3. commit／push／部署（工作樹另有未提交的精選分類功能，見上節，commit 範圍請 PM 決定）。
4. 驗證：同一條 test-phone 連結在兩個瀏覽器各兌換一次，兩邊皆維持登入。

### 4. 待確認
- `test` 帳號的連結（INVITE_TEST.txt）若已被兌換過，設 is_test 後該連結可再次兌換，但仍受 14 天效期限制，過期需重發（重發會撤銷該人既有 session）。
- 風險提示：測試連結外流即等同帳號外流（效期內任何人可兌換）；建議僅限測試帳號且不放真實資料。

### 5. 交接
- 資料庫新欄位 `person.is_test`；API 契約無變動（`/api/auth/redeem` 回應格式不變）。

---

## 精選照片放大顯示＋點擊放大（run23，本地實作・待部署）

### 1. 已完成
- **改動檔案**（僅前端，增量修改，未動 run21／run22 既有變更；未 commit／push／部署、未動正式 Neon、未跑 migration）：
  - `public/app/style.css`：`.card img` 改為 `width:100%;aspect-ratio:5/6;height:auto;object-fit:cover;cursor:zoom-in`（保留 background、border-radius）；刪除兩個媒體查詢裡的固定高度（145px／190px）；檔尾新增 `.lightbox` 樣式（fixed inset:0、rgba(0,0,0,.85)、大圖 max 92vw／92vh、object-fit:contain）。
  - `public/app/main.js`：檔尾（`beforeinstallprompt` 之前）新增 lightbox 區塊。事件委派掛在 `window` 的 click（非 `document`，因既有前端測試的 document stub 沒有 addEventListener），目標為 `.card img`；圖片若在 `a`／`button` 內則不攔截。overlay 由 JS 首次點擊時建立一次並重用；點背景、點大圖、Esc 皆關閉；開啟時 `body.style.overflow='hidden'`，關閉還原。大圖 URL：src 含 `images.lululemon.com` 且含 `wid=` 時 wid 改 1600，否則用原 src。
  - 商品詳情／item 頁：查證 main.js 全檔僅有一處 `<img`（首頁卡片），故無其他商品圖需套用。
- **檢查證據**（`.env` 指向正式庫，故以 `.env.example` 本機 5433 庫變數覆蓋，起本機 dev server，未碰正式庫）：
  - `npx tsc --noEmit` 0 錯誤；`npm run build` Complete。
  - `test:unit` 12／12；前端 `node --test src/components/*.test.mjs` 27 通過、0 失敗、1 跳過（INVITE_LIVE_TEST 項）；`test:api` 34／34。
  - 過程中曾因 document stub 造成 8 個前端測試失敗，已改掛 `window` 後全過。
  - 瀏覽器（headless Chrome＋CDP，`/?demo=1`）：卡片圖實測 275.7×330.8（比例 0.833＝5:6，原為高 180px）、object-fit:cover、cursor:zoom-in；點圖→overlay 顯示（position:fixed、body overflow:hidden）；Esc 關閉並還原 overflow；點背景關閉；點大圖關閉；overlay 全程僅 1 個 DOM；切換對象分頁（catalog-filter 重繪）後點圖仍可開啟；lululemon URL `wid=1280` → 大圖 `wid=1600`（其餘參數保留）。
  - 截圖：`C:\Users\Grant\usshop-meeting\run23-evidence\01-home.png`、`02-lightbox.png`（示範資料為 placeholder.svg，非真實商品照）。

### 2. 如何啟動或驗證
- `powershell -File db/local-pg.ps1 start`，以 `.env.example` 變數覆蓋環境後 `astro dev --background`，開 `/?demo=1`，點卡片圖片。

### 3. 未完成
- 無。尚未用真實 lululemon 圖（需登入家人端正式資料）目視；部署後建議 Grant 以手機實看。

### 4. 待確認
- 卡片改 `cover` 會裁切少量上下邊（原圖 5:6，與框同比例，正常情況近乎不裁）；若來源圖比例不同才會裁切，請 PM 確認是否可接受。
- 手機上 lightbox 不含雙指縮放以外的額外功能（瀏覽器原生縮放可用），未加關閉按鈕（點任意處即關）。

### 5. 給 PM 的契約摘要
- 無 API／資料庫變動。前端行為：`.card img` 點擊開全螢幕大圖（lululemon 圖 wid→1600）；Esc／點擊關閉；包在連結或按鈕內的圖不攔截。本包尚未提交，待 PM 指示 commit／部署（第一級，需授權）。

---

## 管理員預覽家人頁面（run24・本機實作）

（DEPLOY_BACKLOG 第 4 項。**僅本機實作：未 commit、未 push、未部署、未碰正式 Neon、未跑任何 migration（無 schema 變動）**；驗證以 `.env.example` 的本機 5433 庫變數覆蓋 `.env`，`/api/health` 回報 `migrations: 3`＝本機庫。）

### 1. 已完成

**機制與理由**
- 採「獨立旗標 cookie」：`usshop_preview=1`（HttpOnly、SameSite=Lax、Path=/、12 小時、https 時加 Secure）。只有管理員可經新端點 `POST /api/admin/preview {on:true|false}` 設定／清除。參考既有 demo 旗標（`?demo=1`）的「前端旗標」思路，但 demo 是純前端假資料，預覽要讀真實資料，故旗標必須由伺服器認得。
- **不建立 session、不改管理員 session 語意**：旗標不是身分，只是「顯示家人視角」的意圖；`/api/auth/me` 仍回 `person.role === 'admin'`，另加欄位 `preview`（僅管理員且帶旗標時為 true）。無 DB 變更、無 migration。
- 為什麼不選「模擬家人 session」：會違反需求 4，且會產生可寫入的家人身分。為什麼不選獨立 `/preview` 路由：需複製頁面與 API，改動大、且與家人頁面可能走樣；現方案家人頁面與 API 原封重用。

**讀取路徑**：預覽中管理員用同一批家人 API（`/api/batch`、`/api/catalog`、`/api/items`、`/api/items/:id`）與同一支前端 `main.js`，資料即真實精選與批次。`/api/items` 以管理員自己的 person_id 查詢，故「我的清單」為空（管理員本身沒有品項；不冒用任何家人的清單，避免洩漏家人個資）。

**寫入阻擋實作位置（伺服器端單一閘門）**：`src/server/http.ts` 的 `api()` 包裝器。role 為 `family` 的路由遇到「管理員身分＋預覽旗標」時：GET／HEAD 放行；其他方法一律 `403 preview_readonly`。所有家人寫入 API（POST/PUT/DELETE `/api/items*`、`submit`、`family-confirm`）都經此包裝，在進入任何 handler／資料庫之前就擋下。沒有旗標的管理員仍是原本的 `403 forbidden`（行為不變）。前端另外鎖定：`/item` 表單與按鈕 disabled、「確認要買」按鈕不顯示（僅輔助，防線在伺服器）。

**前端**
- `Shell.astro`：新增 `#preview-bar` 橫幅（預覽中標示、說明、「退出預覽，回到管理端」按鈕）與導覽列的「預覽家人頁面」按鈕（`#preview-enter`，僅管理員且非預覽、非 demo 時顯示）。
- `main.js`：`/auth/me` 帶 `preview` 時顯示橫幅、不再把管理員導去 `/admin`；進入按鈕→POST on→回 `/`；退出按鈕→POST off→前往 `/admin`；管理員頁（`/admin`、`/admin/batches`）載入時若殘留旗標會自動清除（避免之後開 `/` 意外進入預覽）。
- `style.css`：`.preview-bar`（sticky top、橘色、z-index 60）——捲動時持續可見。
- 登出（`/api/auth/logout`）同時清除預覽旗標。

### 改動檔案清單（僅 run24 增量，保留 run21／22／23 變更）
- 新增：`src/server/preview.ts`（cookie 名稱、`isPreview`、`setPreview`）、`src/pages/api/admin/preview.ts`
- 修改：`src/server/http.ts`、`src/pages/api/auth/me.ts`、`src/pages/api/auth/logout.ts`、`src/layouts/Shell.astro`、`public/app/main.js`、`public/app/style.css`（檔尾追加）、`tests/api.test.ts`（檔尾新增 6 個測試的 describe）、`PROGRESS_CLAUDE.md`

### 檢查結果（本機 5433 庫＋本機 dev server）
- `npx tsc --noEmit`：0 錯誤
- `npm run build`：Complete（Server built）
- `npm run test:unit`：12／12 通過
- 前端 `node --test src/components/*.test.mjs`：28 項，27 通過、0 失敗、1 跳過（INVITE_LIVE_TEST 項，與前幾棒相同）
- `test:api`：40／40 通過（先前 34，新增 6 個預覽測試）

### 實測證據
- **API 層（tests/api.test.ts「管理員預覽家人頁面」6 項）**：未啟用時管理員讀 `/api/catalog` 仍 403；家人與訪客無法呼叫 `/api/admin/preview`（403／401）；啟用後回 Set-Cookie `usshop_preview`（HttpOnly）且**不含** `usshop_session`、`session` 表筆數不變；預覽中 `/api/catalog`、`/api/batch`、`/api/items` 為 200，`me.preview=true` 且 `person.role` 仍為 admin；POST `/api/items`、PUT、DELETE、`submit`、`family-confirm` 全部 `403 preview_readonly`，且 `order_item`、`change_log` 筆數不變；家人帳號讀寫照常，家人自己帶 `usshop_preview=1` 也無效果（且仍不能呼叫管理 API）；退出後旗標清除、家人 API 恢復 403、管理 API 仍可用。
- **headless Chrome（CDP，腳本在 `%TEMP%\run24-cdp.mjs`，不在 repo 內）**，結果記錄 `C:\Users\Grant\usshop-meeting\run24-evidence\cdp-results.json`，截圖同資料夾：
  - (a) 管理員登入→`/admin` 出現「預覽家人頁面」（`01-admin-entry.png`）→點擊進 `/`，橫幅「預覽中」可見、家人首頁標題與 22 張精選卡片（真實本機資料，`02-preview-home.png`）；捲動 1500px 後橫幅 top=0 仍可見（`03-…sticky.png`）；`/list` 同樣有橫幅（`04`）。
  - (b) `/item` 表單鎖定（`05`）；瀏覽器內直打 POST `/api/items`、PUT `/api/items/1`、POST `…/submit` 皆 403 `preview_readonly`；GET `/api/catalog` 200。
  - (c) 點「退出預覽」→導到 `/admin`，橫幅消失、入口按鈕回來（`06`）；退出後 GET `/api/catalog` 403 forbidden；再開 `/` 導回 `/admin`。
  - (d) 新建家人（本機庫）兌換邀請後：首頁無橫幅、無預覽按鈕、22 張卡片，`POST /api/items` 201，`/item` 表單可編輯（`07-family-home-no-bar.png`）；未登入訪客首頁無橫幅、無按鈕、仍顯示歡迎頁。

### 2. 如何啟動或驗證
```
powershell -File db/local-pg.ps1 start
# 以 .env.example 的 5433 變數覆蓋環境後：
astro dev --background
# 管理員登入 /admin/login（帳號「管理員」，密碼見 .env.example 的 SEED_ADMIN_PASSWORD）→ 導覽列「預覽家人頁面」
npx tsx --test tests/api.test.ts
```

### 3. 未完成／已知缺口與風險
- 預覽中管理員的「我的清單」恆為空（見上，刻意不顯示任何家人的清單）；若 Grant 想預覽「某位家人的清單內容」，需另案設計（可能牽涉個資顯示與稽核），本包未做。
- 預覽旗標只擋「家人角色路由」的寫入；管理端 API 在預覽旗標存在時仍可用（旗標不影響管理端）。因管理員頁載入會自動清旗標，且預覽 UI 不提供管理操作，視為可接受；若 PM 要求「預覽期間連管理 API 也禁寫」需另加規則。
- 「管理員頁載入時自動清除殘留旗標」的分支已寫入但**未做瀏覽器實測**（正常退出路徑與 API 測試已涵蓋）。
- 預覽旗標 12 小時自動失效；`usshop_preview` 與 session 分離，管理員 session 過期時旗標單獨存在無作用（`/api/auth/me` 401）。
- 本機測試庫因測試新增了測試家人與草稿（僅本機）。未在正式站驗證；上線後建議 Grant 以真實管理員帳號實看一次。

### 4. 待確認
- 預覽的「離開」鈕（登出）仍顯示於預覽畫面，登出會同時清旗標；是否要在預覽中隱藏，請 PM 決定。

### 5. 給其他席次／PM 的契約摘要
- 新 API：`POST /api/admin/preview {on:boolean}`（admin only，Origin 檢查同其他 POST）→ `{ok, preview}`。
- `GET /api/auth/me` 新增 `preview:boolean`（向下相容）。
- 新錯誤碼：`403 preview_readonly`（管理員預覽中呼叫家人寫入 API）。
- 無資料庫／schema 變動；部署屬第一級／已授權範圍外，等 PM 指示。
