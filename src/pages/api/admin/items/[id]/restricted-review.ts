import { logChange, one, query, tx } from '../../../../../server/db';
import { api, HttpError, idParam, readJson } from '../../../../../server/http';

// 限制品審核狀態：「已提醒」不等於「Grant 已確認可買」，獨立欄位、分開記錄
export const POST = api('admin', async (ctx, auth) => {
  const id = idParam(ctx);
  const status = (await readJson(ctx.request)).status;
  if (!['none', 'reminded', 'confirmed'].includes(status))
    throw new HttpError(400, 'invalid_field', 'status 不正確', { field: 'status' });
  return tx(async (c) => {
    const it = await one('select restricted_review_status from order_item where id = $1 for update', [id], c);
    if (!it) throw new HttpError(404, 'not_found', '找不到品項');
    await query('update order_item set restricted_review_status = $2, updated_at = now() where id = $1', [id, status], c);
    await logChange(c, {
      type: 'order_item', id, field: 'restricted_review_status', oldValue: it.restricted_review_status,
      newValue: status, operatorId: auth.person.id,
    });
    return { ok: true, restricted_review_status: status };
  });
});
