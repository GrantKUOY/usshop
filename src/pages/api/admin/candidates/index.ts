import { one, query, tx, logChange } from '../../../../server/db';
import { api, HttpError, num, readJson, str } from '../../../../server/http';
import { listCandidate } from '../../../../server/candidates';
import { restrictedHits } from '../../../../server/items';

const WHITELIST = ['brand_official', 'costco', 'amazon_first_party', 'brand_flagship'];

export const GET = api('admin', async (ctx) => {
  const status = ctx.url.searchParams.get('status');
  return {
    candidates: await query(
      `select * from candidate ${status ? 'where listing_status = $1' : ''} order by id desc`,
      status ? [status] : [],
    ),
  };
});

// 匯入（Muse 於站外整理後匯入；冪等：以 連結＋規格 去重；已下架／封鎖者不會復活）
// body: { candidates: [{ merchant, merchant_type, source_url, name, spec_label?, sizes_available?, image_path?, currency?,
//   list_price?, sale_price?, promo_conditions?, stock_note?, checked_at, tw_ref_price?, tw_ref_source?, tw_ref_checked_at?, same_spec_basis? }] }
export const POST = api('admin', async (ctx, auth) => {
  const body = await readJson(ctx.request);
  if (!Array.isArray(body.candidates) || !body.candidates.length || body.candidates.length > 200)
    throw new HttpError(400, 'invalid_field', 'candidates 需為 1–200 筆', { field: 'candidates' });
  const results: unknown[] = [];
  for (const e of body.candidates) {
    const merchantType = str(e.merchant_type, 'merchant_type', { max: 30 })!;
    if (!['brand_official', 'costco', 'amazon_first_party', 'brand_flagship', 'amazon_third_party', 'other'].includes(merchantType))
      throw new HttpError(400, 'invalid_field', 'merchant_type 不正確', { field: 'merchant_type' });
    const url = str(e.source_url, 'source_url', { max: 1000 })!;
    const spec = str(e.spec_label, 'spec_label', { required: false, max: 200 }) ?? '';
    const name = str(e.name, 'name', { max: 200 })!;
    const checkedAt = new Date(e.checked_at);
    if (Number.isNaN(checkedAt.getTime())) throw new HttpError(400, 'invalid_field', 'checked_at 不正確', { field: 'checked_at' });
    const hits = restrictedHits(name, spec, str(e.category, 'category', { required: false }));
    const pass = WHITELIST.includes(merchantType);
    const r = await tx(async (c) => {
      const prev = await one('select * from candidate where source_url = $1 and spec_label = $2 for update', [url, spec], c);
      if (prev) {
        if (prev.listing_status === 'blocked' || prev.listing_status === 'delisted')
          return { source_url: url, spec_label: spec, id: prev.id, result: 'skipped_' + prev.listing_status };
        await query(
          `update candidate set list_price = $2, sale_price = $3, promo_conditions = $4, stock_note = $5, checked_at = $6,
                  sizes_available = $7, tw_ref_price = $8, tw_ref_source = $9, tw_ref_checked_at = $10, same_spec_basis = $11,
                  updated_at = now() where id = $1`,
          [prev.id, num(e.list_price, 'list_price', { required: false }), num(e.sale_price, 'sale_price', { required: false }),
           e.promo_conditions ?? null, e.stock_note ?? null, checkedAt.toISOString(), JSON.stringify(e.sizes_available ?? prev.sizes_available),
           num(e.tw_ref_price, 'tw_ref_price', { required: false }), e.tw_ref_source ?? null,
           e.tw_ref_checked_at ? new Date(e.tw_ref_checked_at).toISOString() : null, e.same_spec_basis ?? null],
          c,
        );
        return { source_url: url, spec_label: spec, id: prev.id, result: 'updated' };
      }
      const status = pass && hits.length === 0 ? 'listed' : 'pending_approval';
      const cand = await one(
        `insert into candidate (merchant, merchant_type, source_url, name, spec_label, sizes_available, image_path, currency,
                list_price, sale_price, promo_conditions, stock_note, checked_at, expires_at, tw_ref_price, tw_ref_source,
                tw_ref_checked_at, same_spec_basis, whitelist_pass, restricted_hit, restricted_keywords, listing_status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'pending_approval') returning *`,
        [str(e.merchant, 'merchant', { max: 100 }), merchantType, url, name, spec, JSON.stringify(e.sizes_available ?? []),
         e.image_path ?? null, e.currency ?? 'USD', num(e.list_price, 'list_price', { required: false }),
         num(e.sale_price, 'sale_price', { required: false }), e.promo_conditions ?? null, e.stock_note ?? null,
         checkedAt.toISOString(), e.expires_at ? new Date(e.expires_at).toISOString() : null,
         num(e.tw_ref_price, 'tw_ref_price', { required: false }), e.tw_ref_source ?? null,
         e.tw_ref_checked_at ? new Date(e.tw_ref_checked_at).toISOString() : null, e.same_spec_basis ?? null,
         pass, hits.length > 0, JSON.stringify(hits)],
        c,
      );
      if (status === 'listed') await listCandidate(c, cand);
      await logChange(c, { type: 'candidate', id: cand!.id, field: 'listing_status', newValue: status, reason: '匯入', operatorId: auth.person.id });
      return { source_url: url, spec_label: spec, id: cand!.id, result: status === 'listed' ? 'created_listed' : 'created_pending_approval' };
    });
    results.push(r);
  }
  return { results };
});
