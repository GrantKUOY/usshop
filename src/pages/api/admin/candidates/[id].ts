import { logChange, one, query, tx } from '../../../../server/db';
import { api, HttpError, idParam, readJson, str } from '../../../../server/http';
import { listCandidate } from '../../../../server/candidates';

// body: { action: 'approve' | 'delist' | 'block', reason? }（下架、封鎖必填原因，原因永久保留）
export const POST = api('admin', async (ctx, auth) => {
  const id = idParam(ctx);
  const b = await readJson(ctx.request);
  const action = b.action;
  if (!['approve', 'delist', 'block'].includes(action)) throw new HttpError(400, 'invalid_field', 'action 不正確', { field: 'action' });
  const reason = str(b.reason, 'reason', { required: action !== 'approve' });
  return tx(async (c) => {
    const cand = await one('select * from candidate where id = $1 for update', [id], c);
    if (!cand) throw new HttpError(404, 'not_found', '找不到候選商品');
    if (action === 'approve') {
      if (cand.listing_status === 'blocked') throw new HttpError(409, 'blocked', '已封鎖的候選不能直接核准，請先確認原因');
      await listCandidate(c, cand);
    } else {
      const status = action === 'block' ? 'blocked' : 'delisted';
      await query(`update candidate set listing_status = $2, delist_reason = $3, updated_at = now() where id = $1`, [id, status, reason], c);
      if (cand.product_id) await query('update product set offline_at = now() where id = $1', [cand.product_id], c);
    }
    const next = await one('select listing_status, delist_reason from candidate where id = $1', [id], c);
    await logChange(c, { type: 'candidate', id, field: 'listing_status', oldValue: cand.listing_status, newValue: next!.listing_status, reason, operatorId: auth.person.id });
    return { ok: true, ...next };
  });
});
