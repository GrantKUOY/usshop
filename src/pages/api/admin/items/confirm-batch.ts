import { one, tx } from '../../../../server/db';
import { api, HttpError, int, readJson } from '../../../../server/http';
import { applyConfirm, checkConfirmable } from '../../../../server/items';

// 整批確認：逐項驗證，不整批放行。每項各自一個交易，失敗項不影響其他項，並明列原因。
// body: { items: [{ item_id, revision_id }] }
export const POST = api('admin', async (ctx, auth) => {
  const body = await readJson(ctx.request);
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 200)
    throw new HttpError(400, 'invalid_field', 'items 需為 1–200 筆', { field: 'items' });
  const confirmed: unknown[] = [];
  const failed: unknown[] = [];
  for (const entry of body.items) {
    const itemId = int(entry?.item_id, 'item_id', { min: 1 })!;
    const revisionId = int(entry?.revision_id, 'revision_id', { min: 1 })!;
    const r = await tx(async (c) => {
      const it = await one('select * from order_item where id = $1 for update', [itemId], c);
      if (!it) return { fail: { code: 'not_found', message: '找不到品項' } };
      const fail = await checkConfirmable(c, it, revisionId);
      if (fail) return { fail };
      return { binding: await applyConfirm(c, it, auth.person.id) };
    });
    if ('fail' in r && r.fail) failed.push({ item_id: itemId, ...r.fail });
    else confirmed.push({ item_id: itemId, ...(r as any).binding });
  }
  return { confirmed, failed };
});
