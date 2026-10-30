import { logChange, one, query, tx } from '../../../../server/db';
import { api, HttpError, idParam, readJson } from '../../../../server/http';
import { ownItem, sanitizeDraft } from '../../../../server/draft';
import {
  batchAcceptsSubmit, candidatePriceStale, currentSettings, familyItemView, restrictedHits, staleDays,
} from '../../../../server/items';

// 送出品項：冪等鍵（Idempotency-Key 標頭）＋摘要確認＋同一交易建立不可變 Revision 並更新狀態。
export const POST = api('family', async (ctx, auth) => {
  const id = idParam(ctx);
  const key = ctx.request.headers.get('idempotency-key')?.trim();
  if (!key || key.length > 100) throw new HttpError(400, 'idempotency_key_required', '缺少防重送識別碼（Idempotency-Key）');
  const body = await readJson(ctx.request);
  if (body.summary_confirmed !== true)
    throw new HttpError(400, 'summary_not_confirmed', '請先確認摘要內容再送出');
  const patch = body.data ? sanitizeDraft(body.data) : {};
  await ownItem(undefined, id, auth.person.id);
  const settings = await currentSettings();

  const replayed = await tx(async (c) => {
    const it = await one('select * from order_item where id = $1 and person_id = $2 for update', [id, auth.person.id], c);
    if (!it) throw new HttpError(404, 'not_found', '找不到這個品項');

    // 冪等：同一鍵重送只回傳第一次的結果（item 已鎖，並行請求會依序進來）
    const prev = await one(
      'select id, order_item_id, version_no from order_item_revision where submitted_by = $1 and idempotency_key = $2',
      [auth.person.id, key],
      c,
    );
    if (prev) {
      if (prev.order_item_id !== id) throw new HttpError(409, 'idempotency_conflict', '這個識別碼已用在別的品項');
      return true;
    }

    if (it.status !== 'draft' && it.status !== 'rejected')
      throw new HttpError(409, 'not_submittable', '這一項已送出，不能重複送出');

    // 截止判定以伺服器時間為準；截止後只能存草稿
    const b = await one(`select * from batch where status = 'open' for share`, [], c);
    if (!batchAcceptsSubmit(b))
      throw new HttpError(409, 'batch_closed', '這一期已截止或尚未開放，內容已幫你存成草稿，不會進當期清單');

    const d: any = { ...it.draft_data, ...patch };
    if (!d.name) throw new HttpError(400, 'invalid_field', '請填品名', { field: 'name' });
    if (!Number.isInteger(d.quantity) || d.quantity < 1) throw new HttpError(400, 'invalid_field', '請填數量', { field: 'quantity' });
    if (!d.spec_undecided && !d.spec) throw new HttpError(400, 'invalid_field', '請填規格，或勾選「規格未定」', { field: 'spec' });
    if (it.source === 'custom' && !d.url) throw new HttpError(400, 'invalid_field', '請貼商品連結', { field: 'url' });
    if (d.max_price && !d.max_price_currency)
      throw new HttpError(400, 'invalid_field', '請選擇上限金額的幣別', { field: 'max_price_currency' });

    // 精選：價格逾期或已下架不可送出
    if (it.candidate_id) {
      const cand = await one('select * from candidate where id = $1', [it.candidate_id], c);
      if (!cand || cand.listing_status !== 'listed')
        throw new HttpError(409, 'candidate_unavailable', '這件精選商品已下架，只能存草稿');
      if (candidatePriceStale(cand, staleDays(settings)))
        throw new HttpError(409, 'price_stale', '價格待更新，暫時只能存草稿');
    }

    const hits = restrictedHits(d.name, d.url, d.spec);
    const restricted = it.restricted_hit || hits.length > 0;
    const { v } = (await one('select coalesce(max(version_no),0) + 1 as v from order_item_revision where order_item_id = $1', [id], c))!;
    const rev = await one(
      `insert into order_item_revision (order_item_id, version_no, name, url, spec, spec_undecided, quantity, note,
              family_ref_price, max_price, max_price_currency, submitted_by, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [id, v, d.name, d.url ?? null, d.spec ?? null, !!d.spec_undecided, d.quantity, d.note ?? null,
       d.family_ref_price ?? null, d.max_price ?? null, d.max_price ? d.max_price_currency : null,
       auth.person.id, key],
      c,
    );
    await query(
      `update order_item set status = 'pending_admin', batch_id = $2, current_revision_id = $3, draft_data = $4,
              reject_reason = null, restricted_hit = $5,
              restricted_review_status = case when $5 and restricted_review_status = 'none' then 'reminded' else restricted_review_status end,
              updated_at = now()
        where id = $1`,
      [id, b!.id, rev!.id, JSON.stringify(d), restricted],
      c,
    );
    await logChange(c, {
      type: 'order_item', id, field: 'status', oldValue: it.status, newValue: 'pending_admin',
      reason: `送出版本 ${v}`, operatorId: auth.person.id,
    });
    return false;
  });
  return { replayed, item: await familyItemView(undefined as any, id) };
});
