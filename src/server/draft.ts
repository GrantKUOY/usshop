import { one } from './db';
import { HttpError, str } from './http';

export function sanitizeDraft(d: any) {
  if (!d || typeof d !== 'object') throw new HttpError(400, 'invalid_field', '內容格式不正確');
  const out: Record<string, unknown> = {};
  const text = (k: string, max = 500) => {
    if (d[k] !== undefined) out[k] = d[k] === null ? null : str(d[k], k, { max, required: false });
  };
  text('name', 200); text('url', 1000); text('spec', 200); text('note', 1000); text('max_price_currency', 3);
  if (d.quantity !== undefined) {
    const q = Number(d.quantity);
    if (!Number.isInteger(q) || q < 1 || q > 999) throw new HttpError(400, 'invalid_field', '數量需為 1 以上的整數', { field: 'quantity' });
    out.quantity = q;
  }
  for (const k of ['family_ref_price', 'max_price']) {
    if (d[k] !== undefined) {
      if (d[k] === null || d[k] === '') out[k] = null;
      else {
        const n = Number(d[k]);
        if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, 'invalid_field', '金額不正確', { field: k });
        out[k] = n;
      }
    }
  }
  if (d.spec_undecided !== undefined) out.spec_undecided = !!d.spec_undecided;
  return out;
}

/** 取自己的品項；不是自己的一律回 404（不洩漏存在與否） */
export async function ownItem(db: any, id: number, personId: number) {
  const it = await one('select * from order_item where id = $1 and person_id = $2', [id, personId], db);
  if (!it) throw new HttpError(404, 'not_found', '找不到這個品項');
  return it;
}
