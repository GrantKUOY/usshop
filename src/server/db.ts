import pg from 'pg';

// bigint → number（ID 與筆數遠小於 2^53）；numeric → number（金額於試算層自行取整）
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL 未設定');
    pool = new pg.Pool({ connectionString, max: 10 });
  }
  return pool;
}

export type Db = pg.Pool | pg.PoolClient;

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params: unknown[] = [],
  db: Db = getPool(),
): Promise<T[]> {
  return (await db.query<T>(text, params)).rows;
}

export async function one<T extends pg.QueryResultRow = any>(
  text: string,
  params: unknown[] = [],
  db: Db = getPool(),
): Promise<T | undefined> {
  return (await query<T>(text, params, db))[0];
}

/** 同一資料庫交易內執行；拋錯即 rollback */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function logChange(
  db: Db,
  e: {
    type: string;
    id: number;
    field?: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string | null;
    operatorId?: number | null;
  },
) {
  await query(
    `insert into change_log (target_type, target_id, field, old_value, new_value, reason, operator_id)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      e.type,
      e.id,
      e.field ?? null,
      e.oldValue === undefined ? null : JSON.stringify(e.oldValue),
      e.newValue === undefined ? null : JSON.stringify(e.newValue),
      e.reason ?? null,
      e.operatorId ?? null,
    ],
    db,
  );
}
