import { one, query, tx, logChange } from '../../../server/db';
import { api, HttpError, readJson, str } from '../../../server/http';
import { sanitizeDraft } from '../../../server/draft';
import { candidatePriceStale, currentSettings, familyItemView, staleDays } from '../../../server/items';

// 我的清單（只回傳自己的品項）
export const GET = api('family', async (_ctx, auth) => {
  const ids = await query('select id from order_item where person_id = $1 order by id desc', [auth.person.id]);
  const items = (await Promise.all(ids.map((r) => familyItemView(undefined as any, r.id)))).filter(Boolean);
  return { items };
});

// 建立草稿：精選（帶 candidate_id，欄位預填）或自填
export const POST = api('family', async (ctx, auth) => {
  const body = await readJson(ctx.request);
  const candidateId = body.candidate_id ?? null;
  let source: 'featured' | 'custom' = 'custom';
  let draft: Record<string, unknown> = { quantity: 1 };
  let restricted = false;
  let productId: number | null = null;
  if (candidateId !== null) {
    const c = await one('select * from candidate where id = $1', [Number(candidateId)]);
    if (!c || c.listing_status !== 'listed') throw new HttpError(409, 'candidate_unavailable', '這件精選商品目前已下架');
    if (candidatePriceStale(c, staleDays(await currentSettings())))
      throw new HttpError(409, 'price_stale', '價格待更新，暫時只能先存草稿');
    source = 'featured';
    productId = c.product_id;
    restricted = c.restricted_hit;
    draft = { name: c.name, url: c.source_url, spec: '', quantity: 1, family_ref_price: null };
  } else if (body.data) draft = { quantity: 1, ...sanitizeDraft(body.data) };
  const id = await tx(async (c) => {
    const row = await one(
      `insert into order_item (person_id, source, candidate_id, product_id, draft_data, restricted_hit)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [auth.person.id, source, candidateId, productId, JSON.stringify(draft), restricted],
      c,
    );
    await logChange(c, { type: 'order_item', id: row!.id, field: 'status', newValue: 'draft', operatorId: auth.person.id });
    return row!.id;
  });
  return new Response(JSON.stringify(await familyItemView(undefined as any, id)), {
    status: 201,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
});
