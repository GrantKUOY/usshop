import { one, tx } from '../../../../../server/db';
import { api, HttpError, idParam, int, readJson } from '../../../../../server/http';
import { applyConfirm, checkConfirmable } from '../../../../../server/items';

// 單件確認：須帶 revision_id（Grant 看到的版本），版本已更新則 409 stale_revision。
export const POST = api('admin', async (ctx, auth) => {
  const id = idParam(ctx);
  const revisionId = int((await readJson(ctx.request)).revision_id, 'revision_id', { min: 1 })!;
  return tx(async (c) => {
    const it = await one('select * from order_item where id = $1 for update', [id], c);
    if (!it) throw new HttpError(404, 'not_found', '找不到品項');
    const fail = await checkConfirmable(c, it, revisionId);
    if (fail) throw new HttpError(409, fail.code, fail.message);
    return { ok: true, binding: await applyConfirm(c, it, auth.person.id) };
  });
});
