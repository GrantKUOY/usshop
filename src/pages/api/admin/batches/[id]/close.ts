import { logChange, one, query, tx } from '../../../../../server/db';
import { api, HttpError, idParam } from '../../../../../server/http';

// 截止批次：凍結已提交版本（Revision 本就不可變），之後家人送出一律 409 batch_closed 只能存草稿。
// 備份匯出為下期項目（見 PROGRESS_CLAUDE.md 未完成）。
export const POST = api('admin', async (ctx, auth) => {
  const id = idParam(ctx);
  return tx(async (c) => {
    const b = await one('select * from batch where id = $1 for update', [id], c);
    if (!b) throw new HttpError(404, 'not_found', '找不到批次');
    if (b.status !== 'open') throw new HttpError(409, 'invalid_state', '這個批次已不是開放中');
    await query(`update batch set status = 'closed', closed_at = now() where id = $1`, [id], c);
    await logChange(c, { type: 'batch', id, field: 'status', oldValue: 'open', newValue: 'closed', operatorId: auth.person.id });
    const counts = await query(
      `select status, count(*) as n from order_item where batch_id = $1 group by status`, [id], c);
    return { ok: true, batch_id: id, items_by_status: counts };
  });
});
