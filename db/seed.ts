// 種子資料（全為代號與示範資料，無任何真實個資／真實商品價格）。可重複執行（已存在者略過）。
// 用法：npm run db:seed
import { randomBytes, createHash, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('缺少 DATABASE_URL');
const base = process.env.PUBLIC_BASE_URL ?? 'http://localhost:4321';
const adminPw = process.env.SEED_ADMIN_PASSWORD ?? 'dev-admin-pass';

const sc = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const hashPassword = async (pw: string) => {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${(await sc(pw, salt, 64)).toString('base64')}`;
};

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('begin');

  // 管理員 1 位（代號「管理員」）
  const admin = await client.query(`select id from person where role = 'admin' limit 1`);
  let adminId: number;
  if (admin.rowCount) adminId = admin.rows[0].id;
  else {
    const r = await client.query(
      `insert into person (display_name, role, password_hash) values ('管理員','admin',$1) returning id`,
      [await hashPassword(adminPw)],
    );
    adminId = r.rows[0].id;
    console.log(`管理員已建立：帳號「管理員」，密碼取自 SEED_ADMIN_PASSWORD（本機預設 ${adminPw}）`);
  }

  // 家人 3 位（代號）；新建時印出一次性邀請連結
  const family = [
    { name: '家人甲', ezway: true, note: null },
    { name: '家人乙', ezway: false, note: '不熟手機操作（示範標記）' },
    { name: '家人丙', ezway: false, note: null },
  ];
  for (const f of family) {
    const exists = await client.query('select id from person where display_name = $1', [f.name]);
    if (exists.rowCount) continue;
    const token = randomBytes(32).toString('base64url');
    await client.query(
      `insert into person (display_name, role, invite_token_hash, invite_expires_at, has_ezway, tech_assist_note)
       values ($1,'family',$2, now() + interval '14 days', $3, $4)`,
      [f.name, createHash('sha256').update(token).digest('hex'), f.ezway, f.note],
    );
    console.log(`邀請連結（${f.name}，僅此一次顯示）：${base}/invite?t=${token}`);
  }

  // 示範參數：匯率為「範例值」，Grant 須於管理端以真實匯率與來源日期覆寫
  const fx = await client.query(`select 1 from setting where key = 'fx_rate'`);
  if (!fx.rowCount)
    await client.query(
      `insert into setting (key, version, value, source_note, created_by) values ('fx_rate',1,'32','範例值（非真實匯率，待 Grant 填寫）',$1)`,
      [adminId],
    );

  // 當期批次（開放中，截止為 7 天後）
  const open = await client.query(`select 1 from batch where status = 'open'`);
  if (!open.rowCount)
    await client.query(`insert into batch (name, deadline_at) values ('示範批次', now() + interval '7 days')`);

  // 精選商品 5 件（示範資料；第 5 件查價已逾期，用來驗證「價格待更新」）
  const samples = [
    { n: '範例運動長褲', spec: '黑色', sizes: ['S', 'M', 'L'], price: 98, days: 1 },
    { n: '範例保暖外套', spec: '深藍', sizes: ['M', 'L'], price: 128, days: 1 },
    { n: '範例背包', spec: '30L', sizes: [], price: 69.5, days: 2 },
    { n: '範例毛帽', spec: '灰色', sizes: ['F'], price: 28, days: 2 },
    { n: '範例運動襪三入', spec: '白色', sizes: ['M', 'L'], price: 24, days: 10 },
  ];
  let sort = 0;
  for (const s of samples) {
    const srcUrl = `https://example.com/sample/${encodeURIComponent(s.n)}`;
    if ((await client.query('select 1 from candidate where source_url = $1 and spec_label = $2', [srcUrl, s.spec])).rowCount) continue;
    const p = await client.query(
      `insert into product (name_zh, url, store, image_path, is_featured, featured_sort, online_at)
       values ($1,$2,'範例品牌官網','/images/placeholder.svg',true,$3,now()) returning id`,
      [s.n, srcUrl, ++sort],
    );
    await client.query(
      `insert into candidate (product_id, merchant, merchant_type, source_url, name, spec_label, sizes_available, image_path,
              currency, list_price, sale_price, promo_conditions, checked_at, whitelist_pass, listing_status)
       values ($1,'範例品牌官網','brand_official',$2,$3,$4,$5,'/images/placeholder.svg','USD',$6,$7,'示範資料',
               now() - make_interval(days => $8), true, 'listed')`,
      [p.rows[0].id, srcUrl, s.n, s.spec, JSON.stringify(s.sizes), s.price * 1.2, s.price, s.days],
    );
  }
  await client.query('commit');
  console.log('種子資料完成');
} catch (e) {
  await client.query('rollback');
  throw e;
} finally {
  await client.end();
}
