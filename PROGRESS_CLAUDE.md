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
