import { one, query } from './db';

/** 候選上架：建立（或沿用）Product 並標精選 */
export async function listCandidate(c: any, cand: any) {
  let productId = cand.product_id;
  if (!productId) {
    const p = await one(
      `insert into product (name_zh, url, store, image_path, is_featured, online_at)
       values ($1,$2,$3,$4,true,now()) returning id`,
      [cand.name, cand.source_url, cand.merchant, cand.image_path],
      c,
    );
    productId = p!.id;
  } else await query('update product set is_featured = true, online_at = now(), offline_at = null where id = $1', [productId], c);
  await query(`update candidate set product_id = $2, listing_status = 'listed', delist_reason = null, updated_at = now() where id = $1`, [cand.id, productId], c);
}
