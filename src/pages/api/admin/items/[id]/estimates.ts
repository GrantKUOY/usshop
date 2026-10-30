import { one, tx } from '../../../../../server/db';
import { api, HttpError, idParam } from '../../../../../server/http';
import { createEstimate, latestPriceCheck } from '../../../../../server/items';

// 以目前參數重算：一律新增 Estimate，不覆蓋舊的（舊估算與已綁定的確認不受影響）
export const POST = api('admin', async (ctx, auth) => {
  const id = idParam(ctx);
  return tx(async (c) => {
    const it = await one('select * from order_item where id = $1 for update', [id], c);
    if (!it?.current_revision_id) throw new HttpError(404, 'not_found', '找不到已送出的品項');
    const pc = await latestPriceCheck(c, id);
    if (!pc) throw new HttpError(409, 'no_price_check', '尚未查價，無法試算');
    return { estimate: await createEstimate(c, it.current_revision_id, pc, auth.person.id) };
  });
});
