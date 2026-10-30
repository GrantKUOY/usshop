import { query } from '../../../server/db';
import { api, HttpError } from '../../../server/http';
import { batchClosedText, confirmSummaryText } from '../../../server/messages';

// 產生可複製的 LINE 文字（Grant 手動貼上；系統不自動發送）。
// type=batch_closed｜confirm_summary（皆需 batch_id）。邀請文字隨建立／重發邀請一併回傳。
export const GET = api('admin', async (ctx) => {
  const type = ctx.url.searchParams.get('type');
  const batchId = Number(ctx.url.searchParams.get('batch_id'));
  if (!Number.isInteger(batchId) || batchId <= 0)
    throw new HttpError(400, 'invalid_field', '需要 batch_id', { field: 'batch_id' });
  const batch = (await query('select name from batch where id = $1', [batchId]))[0];
  if (!batch) throw new HttpError(404, 'not_found', '找不到批次');
  const rows = await query(
    `select p.id as person_id, p.display_name,
            count(*) filter (where i.status <> 'draft') as submitted,
            count(*) filter (where i.status in ('confirmed','ordered')) as confirmed,
            count(*) filter (where i.status = 'pending_family') as need_family,
            count(*) filter (where i.status = 'rejected') as rejected
       from order_item i join person p on p.id = i.person_id
      where i.batch_id = $1 group by p.id, p.display_name order by p.id`,
    [batchId],
  );
  const mk = (f: (r: any) => string) => ({
    texts: rows.map((r) => ({ person_id: r.person_id, display_name: r.display_name, text: f(r) })),
  });
  if (type === 'batch_closed') return mk((r) => batchClosedText(batch.name, r.display_name, r.submitted));
  if (type === 'confirm_summary')
    return mk((r) => confirmSummaryText(r.display_name, r.confirmed, r.need_family, r.rejected));
  throw new HttpError(400, 'invalid_field', 'type 需為 batch_closed 或 confirm_summary', { field: 'type' });
});
