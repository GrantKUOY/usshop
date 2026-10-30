import { logChange, one, query, tx } from '../../../../../server/db';
import { api, HttpError, idParam, readJson, str } from '../../../../../server/http';

// 退回：必填原因；家人修改後以新 Revision 重送，回到待確認
export const POST = api('admin', async (ctx, auth) => {
  const id = idParam(ctx);
  const reason = str((await readJson(ctx.request)).reason, 'reason', { max: 500 })!;
  return tx(async (c) => {
    const it = await one('select * from order_item where id = $1 for update', [id], c);
    if (!it) throw new HttpError(404, 'not_found', '找不到品項');
    if (it.status !== 'pending_admin') throw new HttpError(409, 'invalid_state', '這一項目前不在待確認狀態');
    await query(`update order_item set status = 'rejected', reject_reason = $2, updated_at = now() where id = $1`, [id, reason], c);
    await logChange(c, {
      type: 'order_item', id, field: 'status', oldValue: 'pending_admin', newValue: 'rejected', reason,
      operatorId: auth.person.id,
    });
    return { ok: true };
  });
});
