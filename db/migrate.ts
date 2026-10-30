// 執行 db/migrations/*.sql，並依 DATABASE_URL 的使用者套用資料表權限。
// 用法：npm run db:migrate（使用 MIGRATE_DATABASE_URL，未設定時退回 DATABASE_URL）
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const migrateUrl = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_URL;
if (!migrateUrl || !appUrl) {
  console.error('缺少 DATABASE_URL（或 MIGRATE_DATABASE_URL）');
  process.exit(1);
}
const appRole = decodeURIComponent(new URL(appUrl).username);

// 只增不改的表：應用層角色只給 SELECT／INSERT（規格第 3 章通則）
const APPEND_ONLY = ['order_item_revision', 'price_check', 'estimate', 'change_log', 'setting'];
// 本期應用層需完整讀寫的表
const MUTABLE = [
  'person', 'session', 'batch', 'product', 'candidate', 'order_item',
  'purchase_order', 'purchase_result', 'shipment', 'shipment_allocation', 'settlement',
];

const client = new pg.Client({ connectionString: migrateUrl });
await client.connect();
try {
  await client.query(
    'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
  );
  const dir = join(import.meta.dirname, 'migrations');
  const applied = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    await client.query('begin');
    try {
      await client.query(readFileSync(join(dir, file), 'utf8'));
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
      console.log('已套用', file);
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  }

  const q = (s: string) => '"' + s.replaceAll('"', '""') + '"';
  const role = q(appRole);
  if (appRole !== decodeURIComponent(new URL(migrateUrl).username)) {
    await client.query(`grant usage on schema public to ${role}`);
    await client.query(`revoke all on all tables in schema public from ${role}`);
    for (const t of MUTABLE) await client.query(`grant select, insert, update on ${t} to ${role}`);
    await client.query(`grant delete on order_item to ${role}`);
    for (const t of APPEND_ONLY) await client.query(`grant select, insert on ${t} to ${role}`);
    await client.query(`grant select on schema_migrations to ${role}`);
    await client.query(`grant usage, select on all sequences in schema public to ${role}`);
    console.log(`已套用權限：${appRole}（只增不改表：${APPEND_ONLY.join(', ')}）`);
  } else {
    console.warn('警告：DATABASE_URL 與 MIGRATE_DATABASE_URL 為同一使用者，無法限制只增不改（本機請用不同角色）。');
  }
} finally {
  await client.end();
}
