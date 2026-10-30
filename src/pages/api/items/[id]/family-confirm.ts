import { logChange, one, query, tx } from '../../../../server/db';
import { api, HttpError, idParam, int, readJson } from '../../../../server/http';
import { familyItemView, latestEstimate, latestPriceCheck } from '../../../../server/items';

// 家人確認新版本（待家人確認 → 已確認）；確認綁定當下的報價版本與估算編號，舊的會被拒絕。
export const POST = api('family', async (ctx, auth) => {
  const id = idParam(ctx);
  const body = await readJson(ctx.request);
  const priceCheckId = int(body.price_check_id, 'price_check_id', { min: 1 })!;
  const estimateId = int(body.estimate_id, 'estimate_id', { min: 1 })!;
  await tx(async (c) => {
    const it = await one('select * from order_item where id = $1 and person_id = $2 for update', [id, auth.person.id], c);
    if (!it) throw new HttpError(404, 'not_found', '找不到這個品項');
    if (it.status !== 'pending_family') throw new HttpError(409, 'invalid_state', '這一項現在不需要你確認');
    const pc = await latestPriceCheck(c, id);
    const est = pc ? await latestEstimate(c, it.current_revision_id, pc.id) : null;
    if (!pc || !est || pc.id !== priceCheckId || est.id !== estimateId)
      throw new HttpError(409, 'stale_version', '價格已更新，請重新看一次最新內容再確認');
    await query(
      `update order_item set status = 'confirmed', confirmed_revision_id = $2, confirmed_price_check_id = $3,
              confirmed_estimate_id = $4, family_confirm_needed_reason = null, updated_at = now() where id = $1`,
      [id, it.current_revision_id, pc.id, est.id],
      c,
    );
    await logChange(c, {
      type: 'order_item', id, field: 'status', oldValue: 'pending_family', newValue: 'confirmed',
      reason: `家人確認：報價 ${pc.id}／估算 ${est.id}`, operatorId: auth.person.id,
    });
  });
  return familyItemView(undefined as any, id);
});
