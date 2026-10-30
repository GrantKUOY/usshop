import { logChange, one, query, tx } from '../../../../../server/db';
import { api, HttpError, idParam, num, readJson, str } from '../../../../../server/http';
import { createEstimate } from '../../../../../server/items';

export const GET = api('admin', async (ctx) => ({
  price_checks: await query('select * from price_check where order_item_id = $1 order by id desc', [idParam(ctx)]),
}));

// 回填並核准報價：人工核准是唯一正式報價入口；PriceCheck 只增不改。
// 新增後自動產生一筆新 Estimate（舊的保留）。已確認品項若價格變動，依 7.3 判斷上限內授權或轉待家人確認。
export const POST = api('admin', async (ctx, auth) => {
  const id = idParam(ctx);
  const b = await readJson(ctx.request);
  const unitPrice = num(b.unit_price, 'unit_price', { positive: true })!;
  const currency = str(b.currency, 'currency', { max: 3 })!.toUpperCase();
  const weightSource = b.weight_source ?? 'none';
  if (!['merchant', 'measured', 'category_assumption', 'none'].includes(weightSource))
    throw new HttpError(400, 'invalid_field', 'weight_source 不正確', { field: 'weight_source' });
  const weight = num(b.weight_lb, 'weight_lb', { required: false, positive: true });
  if ((weightSource === 'merchant' || weightSource === 'measured') && weight === null)
    throw new HttpError(400, 'invalid_field', '商家標示／實測需填重量', { field: 'weight_lb' });
  const checkedAt = b.checked_at ? new Date(b.checked_at) : new Date();
  if (Number.isNaN(checkedAt.getTime())) throw new HttpError(400, 'invalid_field', '查價時間不正確', { field: 'checked_at' });

  return tx(async (c) => {
    const it = await one('select * from order_item where id = $1 for update', [id], c);
    if (!it) throw new HttpError(404, 'not_found', '找不到品項');
    if (!['pending_admin', 'pending_family', 'confirmed'].includes(it.status) || !it.current_revision_id)
      throw new HttpError(409, 'invalid_state', '這一項目前不能回填報價');
    if (b.candidate_id) {
      const cand = await one('select id from candidate where id = $1', [Number(b.candidate_id)], c);
      if (!cand) throw new HttpError(400, 'invalid_field', '找不到候選商品', { field: 'candidate_id' });
    }
    const prev = it.confirmed_price_check_id
      ? await one('select * from price_check where id = $1', [it.confirmed_price_check_id], c)
      : null;
    const pc = await one(
      `insert into price_check (order_item_id, unit_price, currency, promo_condition, source_url, checked_at, operator_id,
              weight_lb, weight_source, category_key, domestic_shipping, stock_note, source_candidate_id, approved_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$7) returning *`,
      [
        id, unitPrice, currency, str(b.promo_condition, 'promo_condition', { required: false }),
        str(b.source_url, 'source_url', { required: false, max: 1000 }), checkedAt.toISOString(), auth.person.id,
        weight, weightSource, str(b.category_key, 'category_key', { required: false, max: 50 }),
        num(b.domestic_shipping, 'domestic_shipping', { required: false }),
        str(b.stock_note, 'stock_note', { required: false }), b.candidate_id ? Number(b.candidate_id) : null,
      ],
      c,
    );
    await logChange(c, {
      type: 'price_check', id: pc!.id, field: 'approved', newValue: { unit_price: unitPrice, currency },
      reason: `品項 ${id}`, operatorId: auth.person.id,
    });
    const est = await createEstimate(c, it.current_revision_id, pc, auth.person.id);

    let outcome = 'recorded';
    if (it.status === 'confirmed' && prev) {
      const rev = await one('select max_price, max_price_currency from order_item_revision where id = $1', [it.current_revision_id], c);
      const same = prev.unit_price === unitPrice && prev.currency === currency;
      const withinCap = rev.max_price !== null && rev.max_price_currency === currency && unitPrice <= rev.max_price;
      if (same || withinCap) {
        await query(
          'update order_item set confirmed_price_check_id = $2, confirmed_estimate_id = $3, updated_at = now() where id = $1',
          [id, pc!.id, est!.id],
          c,
        );
        outcome = same ? 'unchanged' : 'within_cap_authorized';
        if (!same)
          await logChange(c, {
            type: 'order_item', id, field: 'price_authorization', newValue: '上限內授權',
            reason: `新價 ${unitPrice} ${currency} ≤ 上限 ${rev.max_price}`, operatorId: auth.person.id,
          });
      } else {
        const reason =
          rev.max_price === null
            ? `價格由 ${prev.unit_price} ${prev.currency} 變為 ${unitPrice} ${currency}，你沒有設定上限`
            : `價格變為 ${unitPrice} ${currency}，超過你設定的上限 ${rev.max_price} ${rev.max_price_currency}`;
        await query(
          `update order_item set status = 'pending_family', family_confirm_needed_reason = $2, updated_at = now() where id = $1`,
          [id, reason],
          c,
        );
        await logChange(c, {
          type: 'order_item', id, field: 'status', oldValue: 'confirmed', newValue: 'pending_family', reason,
          operatorId: auth.person.id,
        });
        outcome = 'needs_family_confirmation';
      }
    }
    return { price_check: pc, estimate: est, outcome };
  });
});
