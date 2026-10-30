import { logChange, one, query, tx } from '../../../../server/db';
import { api, HttpError, idParam, readJson } from '../../../../server/http';
import { familyItemView } from '../../../../server/items';
import { ownItem, sanitizeDraft } from '../../../../server/draft';

export const GET = api('family', async (ctx, auth) => {
  const id = idParam(ctx);
  await ownItem(undefined, id, auth.person.id);
  return familyItemView(undefined as any, id);
});

// 存草稿（草稿與被退回的品項可修改；已送出的內容不可變，要改請退回後以新版本重送）
export const PUT = api('family', async (ctx, auth) => {
  const id = idParam(ctx);
  const patch = sanitizeDraft((await readJson(ctx.request)).data ?? {});
  await tx(async (c) => {
    const it = await one('select * from order_item where id = $1 and person_id = $2 for update', [id, auth.person.id], c);
    if (!it) throw new HttpError(404, 'not_found', '找不到這個品項');
    if (it.status !== 'draft' && it.status !== 'rejected')
      throw new HttpError(409, 'not_editable', '這一項已送出，現在不能直接修改');
    const next = { ...it.draft_data, ...patch };
    await query('update order_item set draft_data = $2, updated_at = now() where id = $1', [id, JSON.stringify(next)], c);
  });
  return familyItemView(undefined as any, id);
});

export const DELETE = api('family', async (ctx, auth) => {
  const id = idParam(ctx);
  await tx(async (c) => {
    const it = await one('select * from order_item where id = $1 and person_id = $2 for update', [id, auth.person.id], c);
    if (!it) throw new HttpError(404, 'not_found', '找不到這個品項');
    if (it.status !== 'draft' || it.current_revision_id)
      throw new HttpError(409, 'not_deletable', '只有還沒送出的草稿可以刪除');
    await logChange(c, { type: 'order_item', id, field: 'deleted', oldValue: it.draft_data, operatorId: auth.person.id });
    await query('delete from order_item where id = $1', [id], c);
  });
  return { ok: true };
});
