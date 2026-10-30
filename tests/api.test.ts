// API 整合測試：需先 `npm run db:migrate && npm run db:seed` 並啟動 server（npm run dev 或 npm start）。
// 每次執行會自行建立唯一名稱的家人；最後一個測試會截止並重開一個示範批次（只動本機測試資料庫）。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';

const BASE = process.env.BASE_URL ?? 'http://localhost:4321';
const ADMIN_PW = process.env.SEED_ADMIN_PASSWORD ?? 'dev-admin-pass';
const run = Date.now().toString(36);

class Client {
  cookie = '';
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.getSetCookie().find((c) => c.startsWith('usshop_session='));
    if (sc) this.cookie = sc.split(';')[0];
    const text = await res.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* non-json */ }
    return { status: res.status, data, setCookie: sc };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b: unknown = {}, h?: Record<string, string>) => this.req('POST', p, b, h);
  put = (p: string, b: unknown) => this.req('PUT', p, b);
  del = (p: string) => this.req('DELETE', p);
}

const tokenOf = (url: string) => new URL(url).searchParams.get('t')!;
const admin = new Client();
let db: pg.Client; // 擁有者連線僅用於驗證資料庫內容
let appDb: pg.Client; // 應用層角色（驗證只增不改）
let A: { id: number; c: Client; invite: string };
let B: { id: number; c: Client; invite: string };

async function newFamily(name: string) {
  const r = await admin.post('/api/admin/people', { display_name: name });
  assert.equal(r.status, 201);
  const c = new Client();
  const rd = await c.post('/api/auth/redeem', { token: tokenOf(r.data.invite_url) });
  assert.equal(rd.status, 200);
  return { id: r.data.id as number, c, invite: r.data.invite_url as string };
}

const draft = (over: Record<string, unknown> = {}) => ({
  data: { name: '範例測試商品', url: 'https://example.com/p/1', spec: 'M', quantity: 2, max_price: 60, max_price_currency: 'USD', ...over },
});
const submit = (c: Client, id: number, key: string, extra: Record<string, unknown> = {}) =>
  c.post(`/api/items/${id}/submit`, { summary_confirmed: true, ...extra }, { 'idempotency-key': key });
async function makeSubmitted(who: typeof A, over: Record<string, unknown> = {}) {
  const d = await who.c.post('/api/items', draft(over));
  assert.equal(d.status, 201);
  const s = await submit(who.c, d.data.id, `k-${run}-${Math.random()}`);
  assert.equal(s.status, 200, JSON.stringify(s.data));
  return d.data.id as number;
}
const priceCheck = (id: number, over: Record<string, unknown> = {}) =>
  admin.post(`/api/admin/items/${id}/price-checks`, { unit_price: 50, currency: 'USD', weight_lb: 1, weight_source: 'merchant', ...over });
const revOf = async (id: number) => (await db.query('select current_revision_id r from order_item where id=$1', [id])).rows[0].r as number;

before(async () => {
  db = new pg.Client({ connectionString: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL });
  appDb = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await appDb.connect();
  const r = await admin.post('/api/admin/login', { name: '管理員', password: ADMIN_PW });
  assert.equal(r.status, 200, '管理員登入失敗；請確認已 db:seed 且 SEED_ADMIN_PASSWORD 一致');
  // 確保有開放批次
  const b = await admin.get('/api/admin/batches');
  if (!b.data.batches.some((x: any) => x.status === 'open'))
    await admin.post('/api/admin/batches', { name: `測試批次 ${run}`, deadline_at: new Date(Date.now() + 86400_000).toISOString() });
  A = await newFamily(`測試甲-${run}`);
  B = await newFamily(`測試乙-${run}`);
});
after(async () => { await db.end(); await appDb.end(); });

describe('健康檢查與基本驗證', () => {
  test('/api/health 實際查詢資料庫後回 200', async () => {
    const r = await new Client().get('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
    assert.ok(r.data.db_time);
  });
  test('未登入呼叫受保護 API 一律 401', async () => {
    const c = new Client();
    for (const p of ['/api/items', '/api/batch', '/api/catalog', '/api/admin/pending', '/api/admin/settings'])
      assert.equal((await c.get(p)).status, 401, p);
  });
  test('管理員密碼錯誤 401；家人 cookie 打管理 API 403', async () => {
    assert.equal((await new Client().post('/api/admin/login', { name: '管理員', password: 'wrong' })).status, 401);
    assert.equal((await A.c.get('/api/admin/pending')).status, 403);
  });
  test('跨來源 Origin 的寫入請求被拒絕', async () => {
    const r = await A.c.post('/api/items', draft(), { origin: 'https://evil.example' });
    assert.equal(r.status, 403);
  });
});

describe('邀請連結與權限隔離（驗收 1）', () => {
  test('邀請 token 單次兌換：第二次 401', async () => {
    const again = await new Client().post('/api/auth/redeem', { token: tokenOf(A.invite) });
    assert.equal(again.status, 401);
    assert.equal(again.data.error.code, 'invalid_invite');
  });
  test('資料庫只存 token 雜湊，不存明文', async () => {
    const row = (await db.query('select invite_token_hash from person where id=$1', [A.id])).rows[0];
    assert.notEqual(row.invite_token_hash, tokenOf(A.invite));
    assert.match(row.invite_token_hash, /^[0-9a-f]{64}$/);
  });
  test('家人看不到也動不了別人的品項（一律 404）', async () => {
    const id = await makeSubmitted(A);
    assert.equal((await B.c.get(`/api/items/${id}`)).status, 404);
    assert.equal((await B.c.put(`/api/items/${id}`, { data: { name: 'x' } })).status, 404);
    assert.equal((await submit(B.c, id, `k-${run}-b`)).status, 404);
    assert.equal((await B.c.del(`/api/items/${id}`)).status, 404);
    assert.equal((await B.c.post(`/api/items/${id}/family-confirm`, { price_check_id: 1, estimate_id: 1 })).status, 404);
    const list = await B.c.get('/api/items');
    assert.ok(!list.data.items.some((i: any) => i.id === id));
  });
  test('撤銷（重發）後舊連結與舊工作階段立即 401', async () => {
    const C = await newFamily(`測試丙-${run}`);
    assert.equal((await C.c.get('/api/items')).status, 200);
    const t0 = Date.now();
    const re = await admin.post(`/api/admin/people/${C.id}/invite`);
    assert.equal(re.status, 200);
    assert.match(re.data.line_text, /舊的不能用了/);
    assert.equal((await C.c.get('/api/items')).status, 401); // 舊工作階段
    assert.equal((await new Client().post('/api/auth/redeem', { token: tokenOf(C.invite) })).status, 401); // 舊連結
    assert.ok(Date.now() - t0 < 60_000);
    const fresh = new Client();
    assert.equal((await fresh.post('/api/auth/redeem', { token: tokenOf(re.data.invite_url) })).status, 200);
    assert.equal((await fresh.get('/api/items')).status, 200);
    // 單純撤銷
    assert.equal((await admin.del(`/api/admin/people/${C.id}/invite`)).status, 200);
    assert.equal((await fresh.get('/api/items')).status, 401);
  });
});

describe('提交、冪等與草稿（驗收 2）', () => {
  test('缺 Idempotency-Key 或未確認摘要 → 400', async () => {
    const d = await A.c.post('/api/items', draft());
    assert.equal((await A.c.post(`/api/items/${d.data.id}/submit`, { summary_confirmed: true })).status, 400);
    const r = await A.c.post(`/api/items/${d.data.id}/submit`, {}, { 'idempotency-key': `x-${run}` });
    assert.equal(r.status, 400);
    assert.equal(r.data.error.code, 'summary_not_confirmed');
  });
  test('同一冪等鍵連送 5 次（並行）→ 資料庫只有 1 筆提交版本', async () => {
    const d = await A.c.post('/api/items', draft());
    const id = d.data.id;
    const key = `idem-${run}`;
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => submit(A.c, id, key)));
    for (const r of rs) assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(rs.filter((r) => !r.data.replayed).length, 1);
    const n = (await db.query('select count(*)::int n from order_item_revision where order_item_id=$1', [id])).rows[0].n;
    assert.equal(n, 1);
    const view = await A.c.get(`/api/items/${id}`);
    assert.equal(view.data.status, 'pending_admin');
    assert.equal(view.data.status_message, '等 Grant 核對中');
  });
  test('已送出的內容不可直接修改', async () => {
    const id = await makeSubmitted(A);
    assert.equal((await A.c.put(`/api/items/${id}`, { data: { name: '改' } })).status, 409);
  });
  test('欄位驗證：數量、規格、上限幣別', async () => {
    const bad = await A.c.post('/api/items', draft({ quantity: 0 }));
    assert.equal(bad.status, 400);
    const d = await A.c.post('/api/items', draft({ spec: undefined }));
    assert.equal((await submit(A.c, d.data.id, `v-${run}-1`)).status, 400); // 無規格也沒勾規格未定
    const d2 = await A.c.post('/api/items', draft({ max_price_currency: undefined }));
    assert.equal((await submit(A.c, d2.data.id, `v-${run}-2`)).status, 400);
  });
  test('草稿可存取與刪除', async () => {
    const d = await A.c.post('/api/items', draft());
    const u = await A.c.put(`/api/items/${d.data.id}`, { data: { quantity: 5 } });
    assert.equal(u.data.draft.quantity, 5);
    assert.equal((await A.c.del(`/api/items/${d.data.id}`)).status, 200);
    assert.equal((await A.c.get(`/api/items/${d.data.id}`)).status, 404);
  });
  test('/api/batch 回當期批次', async () => {
    const r = await A.c.get('/api/batch');
    assert.equal(r.status, 200);
    assert.ok(r.data.batch.deadline_at);
    assert.equal(r.data.can_submit, true);
  });
});

describe('版本、只增不改（驗收 3）', () => {
  test('應用層角色對只增不改的表 UPDATE／DELETE 一律被拒絕', async () => {
    const cols: Record<string, string> = { order_item_revision: 'note', price_check: 'stock_note', estimate: 'formula_version', change_log: 'reason', setting: 'source_note' };
    for (const [t, col] of Object.entries(cols)) {
      await assert.rejects(appDb.query(`update ${t} set ${col} = ${col}`), /permission denied/, `update ${t}`);
      await assert.rejects(appDb.query(`delete from ${t}`), /permission denied/, `delete ${t}`);
    }
    // 對照：可變表仍可更新
    await appDb.query('update batch set name = name');
  });
  test('以舊版本確認被拒絕並提示版本已更新', async () => {
    const id = await makeSubmitted(A);
    const oldRev = await revOf(id);
    await priceCheck(id);
    assert.equal((await admin.post(`/api/admin/items/${id}/reject`, { reason: '請補規格' })).status, 200);
    await A.c.put(`/api/items/${id}`, { data: { spec: 'L' } });
    assert.equal((await submit(A.c, id, `r2-${run}-${id}`)).status, 200); // 新版本 v2
    assert.notEqual(await revOf(id), oldRev);
    const r = await admin.post(`/api/admin/items/${id}/confirm`, { revision_id: oldRev });
    assert.equal(r.status, 409);
    assert.equal(r.data.error.code, 'stale_revision');
    assert.match(r.data.error.message, /版本已更新/);
    const versions = (await db.query('select version_no from order_item_revision where order_item_id=$1 order by 1', [id])).rows;
    assert.deepEqual(versions.map((v) => v.version_no), [1, 2]); // 舊版保留
  });
});

describe('管理流程（驗收 4）', () => {
  test('退回必填原因；人話狀態指明原因', async () => {
    const id = await makeSubmitted(B);
    assert.equal((await admin.post(`/api/admin/items/${id}/reject`, {})).status, 400);
    assert.equal((await admin.post(`/api/admin/items/${id}/reject`, { reason: '連結打不開' })).status, 200);
    const v = await B.c.get(`/api/items/${id}`);
    assert.equal(v.data.status, 'rejected');
    assert.match(v.data.status_message, /連結打不開/);
  });
  test('整批確認逐項驗證：未查價、規格未定、版本過期、限制品未確認被拒並列出原因', async () => {
    const ok = await makeSubmitted(A);
    await priceCheck(ok);
    const noPrice = await makeSubmitted(A);
    const undecided = await makeSubmitted(A, { spec: undefined, spec_undecided: true });
    await priceCheck(undecided);
    const stale = await makeSubmitted(A);
    await priceCheck(stale);
    const staleRev = await revOf(stale);
    await admin.post(`/api/admin/items/${stale}/reject`, { reason: 'x' });
    await A.c.put(`/api/items/${stale}`, { data: { note: '更新' } });
    assert.equal((await submit(A.c, stale, `s2-${run}-${stale}`)).status, 200);
    const restricted = await makeSubmitted(A, { name: 'Vitamin C 維他命' });
    await priceCheck(restricted);

    const items = await Promise.all(
      [ok, noPrice, undecided, stale, restricted].map(async (id) => ({ item_id: id, revision_id: id === stale ? staleRev : await revOf(id) })),
    );
    const r = await admin.post('/api/admin/items/confirm-batch', { items });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.confirmed.map((x: any) => x.item_id), [ok]);
    const reasons = Object.fromEntries(r.data.failed.map((f: any) => [f.item_id, f.code]));
    assert.deepEqual(reasons, {
      [noPrice]: 'no_price_check',
      [undecided]: 'spec_undecided',
      [stale]: 'stale_revision',
      [restricted]: 'restricted_unconfirmed',
    });
    // 限制品標「已確認可買」後可確認；「已提醒」不夠
    assert.equal((await A.c.get(`/api/items/${restricted}`)).data.status, 'pending_admin');
    const row = (await db.query('select restricted_review_status s from order_item where id=$1', [restricted])).rows[0];
    assert.equal(row.s, 'reminded');
    await admin.post(`/api/admin/items/${restricted}/restricted-review`, { status: 'confirmed' });
    assert.equal((await admin.post(`/api/admin/items/${restricted}/confirm`, { revision_id: await revOf(restricted) })).status, 200);
  });
  test('確認綁定提交版本、報價版本與估算編號；家人看到估算與人話狀態', async () => {
    const id = await makeSubmitted(A);
    const pc = await priceCheck(id);
    assert.equal(pc.status, 200);
    const c = await admin.post(`/api/admin/items/${id}/confirm`, { revision_id: await revOf(id) });
    assert.equal(c.status, 200);
    assert.equal(c.data.binding.price_check_id, pc.data.price_check.id);
    const v = await A.c.get(`/api/items/${id}`);
    assert.equal(v.data.status_message, 'Grant 已確認，等待下單');
    assert.equal(v.data.estimate.label, '估算');
    assert.equal(v.data.estimate.result.disclaimer, '以海關實際認定為準');
    assert.equal(v.data.payable.final, null);
    assert.equal(v.data.estimate.params_snapshot, undefined); // 內部參數不外露
  });
  test('彙總：依家人分組含小計；可切換視角；列出已確認未回報結果', async () => {
    const r = await admin.get('/api/admin/pending');
    assert.equal(r.status, 200);
    assert.ok(r.data.groups.every((g: any) => g.person_name && g.subtotal && Array.isArray(g.items)));
    assert.ok(r.data.confirmed_awaiting_result.length >= 1);
    assert.equal((await admin.get('/api/admin/pending?view=product')).status, 200);
    assert.equal((await admin.get('/api/admin/pending?view=batch')).status, 200);
  });
  test('LINE 通知文字可產生', async () => {
    const b = (await admin.get('/api/admin/batches')).data.batches.find((x: any) => x.status === 'open');
    const r = await admin.get(`/api/admin/line-text?type=batch_closed&batch_id=${b.id}`);
    assert.equal(r.status, 200);
    assert.ok(r.data.texts.some((t: any) => /截止了，你送了 \d+ 項，等 Grant 核對/.test(t.text)));
    assert.equal((await admin.get(`/api/admin/line-text?type=confirm_summary&batch_id=${b.id}`)).status, 200);
  });
});

describe('價格上限授權與待家人確認（7.3）', () => {
  test('價格在上限內：維持已確認；超過上限：轉待家人確認，家人以最新版本確認', async () => {
    const id = await makeSubmitted(A, { max_price: 60 });
    await priceCheck(id, { unit_price: 50 });
    await admin.post(`/api/admin/items/${id}/confirm`, { revision_id: await revOf(id) });
    const within = await priceCheck(id, { unit_price: 58 });
    assert.equal(within.data.outcome, 'within_cap_authorized');
    assert.equal((await A.c.get(`/api/items/${id}`)).data.status, 'confirmed');

    const over = await priceCheck(id, { unit_price: 75 });
    assert.equal(over.data.outcome, 'needs_family_confirmation');
    const v = await A.c.get(`/api/items/${id}`);
    assert.equal(v.data.status, 'pending_family');
    assert.match(v.data.status_message, /超過你設定的上限/);

    const stale = await A.c.post(`/api/items/${id}/family-confirm`, { price_check_id: within.data.price_check.id, estimate_id: within.data.estimate.id });
    assert.equal(stale.status, 409);
    const ok = await A.c.post(`/api/items/${id}/family-confirm`, { price_check_id: over.data.price_check.id, estimate_id: over.data.estimate.id });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.status, 'confirmed');
  });
});

describe('試算與參數版本（驗收 5）', () => {
  test('未知重量 → 待查核且不給總額；已知重量 → 點估', async () => {
    const id = await makeSubmitted(A);
    const unk = await priceCheck(id, { weight_source: 'none', weight_lb: undefined });
    assert.equal(unk.data.estimate.result_kind, 'pending_check');
    assert.equal(unk.data.estimate.result.total_twd, null);
    const known = await priceCheck(id, { weight_lb: 1.2, weight_source: 'measured' });
    assert.equal(known.data.estimate.result_kind, 'point');
  });
  test('後台改匯率只影響新估算，舊估算不變；重算新增紀錄', async () => {
    const id = await makeSubmitted(A);
    const first = await priceCheck(id);
    const before = (await db.query('select params_snapshot, result from estimate where id=$1', [first.data.estimate.id])).rows[0];
    const s = await admin.put('/api/admin/settings', { key: 'fx_rate', value: 33.5, source_note: `測試用 ${run}` });
    assert.equal(s.status, 200);
    const re = await admin.post(`/api/admin/items/${id}/estimates`);
    assert.ok(re.data.estimate.id > first.data.estimate.id);
    assert.notDeepEqual(re.data.estimate.result, before.result);
    const after = (await db.query('select params_snapshot, result from estimate where id=$1', [first.data.estimate.id])).rows[0];
    assert.deepEqual(after, before);
    const hist = await db.query(`select version from setting where key='fx_rate' order by version`);
    assert.ok(hist.rowCount! >= 2); // 參數更動留版本
    await admin.put('/api/admin/settings', { key: 'fx_rate', value: 32, source_note: '範例值（測試還原）' });
  });
  test('匯率缺來源說明被拒絕', async () => {
    assert.equal((await admin.put('/api/admin/settings', { key: 'fx_rate', value: 31 })).status, 400);
  });
  test('完稅價格落在 1,800–2,200 帶寬時出現雙情境與固定附註', async () => {
    const id = await makeSubmitted(A, { quantity: 1 });
    // 單價 USD 55 × 32.32 ≈ 1778 + 運費 170 → CIF ≈ 1948
    const r = await priceCheck(id, { unit_price: 55 });
    assert.ok(r.data.estimate.scenarios?.exempt && r.data.estimate.scenarios?.taxable, JSON.stringify(r.data.estimate));
    assert.equal(r.data.estimate.result.disclaimer, '以海關實際認定為準');
  });
});

describe('AI 精選（驗收 8）', () => {
  const mk = (over: Record<string, unknown>) => ({
    merchant: '範例商家', merchant_type: 'brand_official', source_url: `https://example.com/t/${run}/${over.k ?? 'a'}`,
    name: `範例精選 ${run}`, spec_label: '黑', checked_at: new Date().toISOString(), sale_price: 40, list_price: 50, ...over,
  });
  test('非白名單商家與限制類關鍵字不自動上架；白名單乾淨者自動上架', async () => {
    const r = await admin.post('/api/admin/candidates', {
      candidates: [
        mk({ k: 'ok' }),
        mk({ k: 'third', merchant_type: 'amazon_third_party' }),
        mk({ k: 'vit', name: 'Vitamin D3 spray' }),
      ],
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.results.map((x: any) => x.result), ['created_listed', 'created_pending_approval', 'created_pending_approval']);
    const cat = await A.c.get('/api/catalog');
    const names = cat.data.items.map((i: any) => i.source_url);
    assert.ok(names.includes(mk({ k: 'ok' }).source_url));
    assert.ok(!names.includes(mk({ k: 'third' }).source_url));
    assert.ok(!names.includes(mk({ k: 'vit' }).source_url));
  });
  test('匯入冪等：重複匯入不產生重複資料', async () => {
    const before = (await db.query('select count(*)::int n from candidate where source_url like $1', [`%/t/${run}/%`])).rows[0].n;
    const r = await admin.post('/api/admin/candidates', { candidates: [mk({ k: 'ok' })] });
    assert.equal(r.data.results[0].result, 'updated');
    const after = (await db.query('select count(*)::int n from candidate where source_url like $1', [`%/t/${run}/%`])).rows[0].n;
    assert.equal(after, before);
  });
  test('下架（含封鎖）後下次匯入不復活，且已送出品項不受影響', async () => {
    const cat = await A.c.get('/api/catalog');
    const target = cat.data.items.find((i: any) => i.source_url === mk({ k: 'ok' }).source_url);
    assert.equal(target.price_label, 'AI 候選價');
    assert.match(target.notice, /AI 整理的建議/);
    const d = await A.c.post('/api/items', { candidate_id: target.id });
    assert.equal(d.status, 201);
    const sub = await submit(A.c, d.data.id, `cat-${run}`, { data: { spec: 'M' } });
    assert.equal(sub.status, 200);
    assert.equal((await admin.post(`/api/admin/candidates/${target.id}`, { action: 'block' })).status, 400); // 必填原因
    assert.equal((await admin.post(`/api/admin/candidates/${target.id}`, { action: 'block', reason: '測試封鎖' })).status, 200);
    const re = await admin.post('/api/admin/candidates', { candidates: [mk({ k: 'ok' })] });
    assert.equal(re.data.results[0].result, 'skipped_blocked');
    const after = await A.c.get('/api/catalog');
    assert.ok(!after.data.items.some((i: any) => i.id === target.id));
    assert.equal((await A.c.get(`/api/items/${d.data.id}`)).data.status, 'pending_admin');
    const row = (await db.query('select delist_reason from candidate where id=$1', [target.id])).rows[0];
    assert.equal(row.delist_reason, '測試封鎖');
  });
  test('查價逾期的精選標「價格待更新」且不可送出', async () => {
    const cat = await A.c.get('/api/catalog');
    const stale = cat.data.items.find((i: any) => i.price_stale);
    assert.ok(stale, '種子資料應含一件查價逾期的精選');
    assert.equal(stale.stale_label, '價格待更新');
    assert.equal(stale.can_submit, false);
    const d = await A.c.post('/api/items', { candidate_id: stale.id });
    assert.equal(d.status, 409);
    assert.equal(d.data.error.code, 'price_stale');
  });
});

describe('截止（驗收 3：以伺服器時間；截止後只能存草稿）', () => {
  test('截止批次後送出 409，但草稿仍可存；重開批次後恢復', async () => {
    const id = await makeSubmitted(A);
    void id;
    const d = await A.c.post('/api/items', draft());
    const open = (await admin.get('/api/admin/batches')).data.batches.find((x: any) => x.status === 'open');
    const dup = await admin.post('/api/admin/batches', { name: '重複', deadline_at: new Date(Date.now() + 3600_000).toISOString() });
    assert.equal(dup.status, 409); // 同時僅一個開放批次
    const closed = await admin.post(`/api/admin/batches/${open.id}/close`);
    assert.equal(closed.status, 200);
    const r = await submit(A.c, d.data.id, `late-${run}`);
    assert.equal(r.status, 409);
    assert.equal(r.data.error.code, 'batch_closed');
    assert.equal((await A.c.put(`/api/items/${d.data.id}`, { data: { quantity: 3 } })).status, 200); // 仍可存草稿
    assert.equal((await A.c.get('/api/batch')).data.can_submit, false);
    // 資料層：不可同時有兩個開放批次
    await admin.post('/api/admin/batches', { name: `測試批次 ${run} 重開`, deadline_at: new Date(Date.now() + 7 * 86400_000).toISOString() });
    await assert.rejects(db.query(`insert into batch (name, deadline_at, status) values ('x', now(), 'open')`), /batch_single_open_uq/);
    assert.equal((await submit(A.c, d.data.id, `late2-${run}`)).status, 200);
  });
  test('變更紀錄完整：狀態轉換皆留 ChangeLog', async () => {
    const n = (await db.query(`select count(*)::int n from change_log where target_type='order_item' and field='status'`)).rows[0].n;
    assert.ok(n > 10);
  });
});
