import type { APIRoute } from 'astro';
import { one } from '../../server/db';
import { json } from '../../server/http';

// 保活用：必須實際查詢資料庫才回 200（規格第 11 章）
export const GET: APIRoute = async () => {
  try {
    const r = await one('select now() as db_time, (select count(*) from schema_migrations) as migrations');
    return json({ ok: true, db_time: r!.db_time, migrations: r!.migrations });
  } catch (e) {
    console.error('health check failed', e);
    return json({ ok: false }, 503);
  }
};
