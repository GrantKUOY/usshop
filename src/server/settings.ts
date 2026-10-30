import { logChange, one, query, tx, type Db } from './db';
import type { EstimateParams } from './estimate';

/** 預設值（規格 3.14）。fx_rate 無預設：未設定時試算標「待查核」，不編造匯率 */
export const DEFAULTS: Record<string, unknown> = {
  fx_rate: null,
  fx_buffer: 0.01,
  shipping_rate_per_lb: 170,
  tax_threshold: 2000,
  warn_line: 1800,
  band: [1800, 2200],
  vat_rate: 0.05,
  tariff_rate_high: null,
  category_weights: [],
  price_stale_days: 7,
  price_stale_days_blackfriday: 3,
  blackfriday_period: null, // 待 Grant 指定起訖
  payment_timing: 'after_distribution',
  fx_stale_days: 7,
};

export async function currentSettings(db?: Db): Promise<Record<string, { value: any; version: number; source_note: string | null; created_at?: string }>> {
  const rows = await query(
    `select distinct on (key) key, version, value, source_note, created_at
       from setting order by key, version desc`,
    [],
    db,
  );
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(DEFAULTS)) out[k] = { value: v, version: 0, source_note: '預設值' };
  for (const r of rows) out[r.key] = { value: r.value, version: r.version, source_note: r.source_note, created_at: r.created_at };
  return out;
}

export async function estimateParams(db?: Db): Promise<EstimateParams> {
  const s = await currentSettings(db);
  const v = (k: string) => s[k].value;
  return {
    fx_rate: v('fx_rate'),
    fx_buffer: v('fx_buffer'),
    shipping_rate_per_lb: v('shipping_rate_per_lb'),
    tax_threshold: v('tax_threshold'),
    warn_line: v('warn_line'),
    band: v('band'),
    vat_rate: v('vat_rate'),
    tariff_rate_high: v('tariff_rate_high'),
    category_weights: v('category_weights'),
  };
}

/** 更動留版本（只增不改） */
export async function setSetting(key: string, value: unknown, note: string | null, operatorId: number) {
  if (!(key in DEFAULTS)) return null;
  return tx(async (c) => {
    const prev = await one('select coalesce(max(version),0) as v from setting where key = $1', [key], c);
    const version = (prev?.v ?? 0) + 1;
    await query(
      'insert into setting (key, version, value, source_note, created_by) values ($1,$2,$3,$4,$5)',
      [key, version, JSON.stringify(value), note, operatorId],
      c,
    );
    await logChange(c, { type: 'setting', id: version, field: key, newValue: value, reason: note, operatorId });
    return version;
  });
}

/** 精選價格失效天數（黑五期間若 Grant 已設定起訖則用較短者） */
export function staleDays(s: Awaited<ReturnType<typeof currentSettings>>, now = new Date()): number {
  const p = s.blackfriday_period.value as { from: string; to: string } | null;
  if (p && now >= new Date(p.from) && now <= new Date(p.to)) return s.price_stale_days_blackfriday.value;
  return s.price_stale_days.value;
}
