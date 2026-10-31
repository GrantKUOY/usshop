import { logChange, one, query, type Db } from './db';
import { computeEstimate, FORMULA_VERSION } from './estimate';
import { estimateParams } from './settings';
export { currentSettings, staleDays } from './settings';
import { humanStatus } from './messages';

// 限制類關鍵字：命中僅觸發提醒／進待核准區，不阻擋（D5）
const RESTRICTED = [
  '藥', '保健', '維他命', '益生菌', '魚油', '液體', '電池', '噴霧',
  'vitamin', 'supplement', 'probiotic', 'medicine', 'pill', 'battery', 'spray', 'liquid', 'serum', 'perfume',
];
export const restrictedHits = (...texts: (string | null | undefined)[]) => {
  const t = texts.filter(Boolean).join(' ').toLowerCase();
  return RESTRICTED.filter((k) => t.includes(k));
};

export async function openBatch(db?: Db) {
  return one(`select * from batch where status = 'open'`, [], db);
}

/** 以伺服器時間判定：開放中且未過截止 */
export const batchAcceptsSubmit = (b: { status: string; deadline_at: string | Date } | undefined) =>
  !!b && b.status === 'open' && new Date(b.deadline_at).getTime() > Date.now();

export function candidatePriceStale(
  c: { checked_at: string | Date; expires_at: string | Date | null },
  days: number,
): boolean {
  const checked = new Date(c.checked_at).getTime();
  if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) return true;
  return Date.now() - checked > days * 86400_000;
}

export async function latestPriceCheck(db: Db, itemId: number) {
  return one('select * from price_check where order_item_id = $1 order by id desc limit 1', [itemId], db);
}

export async function latestEstimate(db: Db, revisionId: number, priceCheckId?: number) {
  return one(
    `select * from estimate where revision_id = $1 ${priceCheckId ? 'and price_check_id = $2' : ''} order by id desc limit 1`,
    priceCheckId ? [revisionId, priceCheckId] : [revisionId],
    db,
  );
}

/** 計算並新增一筆 Estimate（舊的不覆蓋）；參數快照含匯率、緩衝、代運單價、門檻、公式版本 */
export async function createEstimate(db: Db, revisionId: number, pc: any, operatorId: number | null) {
  const rev = await one('select * from order_item_revision where id = $1', [revisionId], db);
  const params = await estimateParams(db);
  const input = {
    quantity: rev.quantity,
    unit_price: pc.unit_price,
    currency: pc.currency,
    domestic_shipping: pc.domestic_shipping,
    weight_lb: pc.weight_lb,
    weight_source: pc.weight_source,
    category_key: pc.category_key,
  };
  const out = computeEstimate(input, params);
  return one(
    `insert into estimate (revision_id, price_check_id, input, params_snapshot, formula_version, result_kind, result, scenarios, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [
      revisionId,
      pc.id,
      JSON.stringify(input),
      JSON.stringify({ ...params, fx_rate_effective: params.fx_rate ? params.fx_rate * (1 + params.fx_buffer) : null }),
      FORMULA_VERSION,
      out.kind,
      JSON.stringify(out.result),
      out.scenarios ? JSON.stringify(out.scenarios) : null,
      operatorId,
    ],
    db,
  );
}

export type ConfirmFailure = { code: string; message: string };

/** 確認前的逐項驗證（單件與整批共用）。回傳失敗原因或 null */
export async function checkConfirmable(db: Db, item: any, revisionId: number): Promise<ConfirmFailure | null> {
  if (item.status !== 'pending_admin')
    return { code: 'invalid_state', message: '這一項目前不在待確認狀態' };
  if (item.current_revision_id !== revisionId)
    return { code: 'stale_revision', message: '版本已更新，請重新檢視最新內容' };
  const rev = await one('select spec_undecided from order_item_revision where id = $1', [revisionId], db);
  if (rev.spec_undecided) return { code: 'spec_undecided', message: '規格未定，請先請家人補充規格' };
  const pc = await latestPriceCheck(db, item.id);
  if (!pc) return { code: 'no_price_check', message: '尚未查價，請先回填並核准報價' };
  if (item.restricted_hit && item.restricted_review_status !== 'confirmed')
    return { code: 'restricted_unconfirmed', message: '限制類品項尚未標記「Grant 已確認可買」' };
  return null;
}

/** 通過驗證後確認：綁定提交版本、報價版本、估算編號（呼叫端須已在交易內並鎖定該 item） */
export async function applyConfirm(db: Db, item: any, adminId: number) {
  const pc = await latestPriceCheck(db, item.id);
  const est = (await latestEstimate(db, item.current_revision_id, pc.id)) ?? (await createEstimate(db, item.current_revision_id, pc, adminId));
  await query(
    `update order_item set status = 'confirmed', confirmed_revision_id = $2, confirmed_price_check_id = $3,
            confirmed_estimate_id = $4, reject_reason = null, family_confirm_needed_reason = null, updated_at = now()
      where id = $1`,
    [item.id, item.current_revision_id, pc.id, est.id],
    db,
  );
  await logChange(db, {
    type: 'order_item', id: item.id, field: 'status', oldValue: item.status, newValue: 'confirmed',
    reason: `綁定版本 ${item.current_revision_id}／報價 ${pc.id}／估算 ${est.id}`, operatorId: adminId,
  });
  return { revision_id: item.current_revision_id, price_check_id: pc.id, estimate_id: est.id };
}

/** 家人端一件品項的完整檢視（含人話狀態與估算；不含內部參數快照） */
export async function familyItemView(db: Db, itemId: number) {
  const row = await one(
    `select i.id, i.status, i.source, i.batch_id, i.candidate_id, i.draft_data, i.reject_reason,
            i.family_confirm_needed_reason, i.arrival_override, i.current_revision_id, i.confirmed_estimate_id,
            b.status as batch_status, b.name as batch_name,
            r.version_no, r.name, r.url, r.spec, r.spec_undecided, r.quantity, r.note, r.family_ref_price,
            r.max_price, r.max_price_currency, r.submitted_at
       from order_item i
       left join batch b on b.id = i.batch_id
       left join order_item_revision r on r.id = i.current_revision_id
      where i.id = $1`,
    [itemId],
    db,
  );
  if (!row) return null;
  const pr = await one(
    `select result, scenarios, result_kind, id, calculated_at, price_check_id from estimate
      where revision_id = $1 order by id desc limit 1`,
    [row.current_revision_id ?? 0],
    db,
  );
  const pur = await one(
    `select result, qty_bought, reason from purchase_result where order_item_id = $1 order by id desc limit 1`,
    [itemId],
    db,
  );
  const content = row.current_revision_id
    ? {
        name: row.name, url: row.url, spec: row.spec, spec_undecided: row.spec_undecided, quantity: row.quantity,
        note: row.note, family_ref_price: row.family_ref_price, max_price: row.max_price,
        max_price_currency: row.max_price_currency, version_no: row.version_no, submitted_at: row.submitted_at,
      }
    : null;
  return {
    id: row.id,
    status: row.status,
    status_message: humanStatus({
      status: row.status,
      batch_status: row.batch_status,
      reject_reason: row.reject_reason,
      family_confirm_needed_reason: row.family_confirm_needed_reason,
      quantity: row.quantity,
      qty_bought: pur?.qty_bought ?? null,
      purchase_result: pur?.result ?? null,
      purchase_reason: pur?.reason ?? null,
    }),
    needs_my_action: row.status === 'pending_family' || row.status === 'rejected' || row.status === 'draft',
    source: row.source,
    batch: row.batch_id ? { id: row.batch_id, name: row.batch_name } : null,
    candidate_id: row.candidate_id,
    content,
    draft: row.status === 'draft' || row.status === 'rejected' ? row.draft_data : null,
    reject_reason: row.status === 'rejected' ? row.reject_reason : null,
    estimate: pr
      ? {
          id: pr.id,
          label: '估算',
          kind: pr.result_kind,
          calculated_at: pr.calculated_at,
          result: pr.result,
          scenarios: pr.scenarios,
          awaiting_my_confirmation_of: row.status === 'pending_family' ? { estimate_id: pr.id, price_check_id: pr.price_check_id } : null,
        }
      : null,
    payable: {
      estimated: pr?.result?.total_twd ?? null,
      actual: null,
      final: null,
      note: '最終應付於出貨、結算後才會顯示（本期尚未開放）',
    },
  };
}

export async function candidateView(db: Db, c: any, stale: boolean) {
  const price = c.sale_price ?? c.list_price;
  const showDiff = c.same_spec_basis && c.tw_ref_price;
  return {
    id: c.id,
    name: c.name,
    merchant: c.merchant,
    source_url: c.source_url,
    spec_label: c.spec_label,
    audience: c.audience ?? null,
    category: c.category ?? 'other',
    sizes_available: c.sizes_available,
    image_path: c.image_path,
    currency: c.currency,
    price,
    list_price: c.list_price,
    price_label: 'AI 候選價',
    checked_at: c.checked_at,
    promo_conditions: c.promo_conditions,
    stock_note: c.stock_note,
    ai_pick: true,
    notice: 'AI 整理的建議，價格為查價日參考，Grant 下單前會再核對。',
    price_stale: stale,
    can_submit: !stale,
    stale_label: stale ? '價格待更新' : null,
    tw_ref: showDiff
      ? {
          price: c.tw_ref_price, source: c.tw_ref_source, checked_at: c.tw_ref_checked_at,
          note: '僅為商品價格比較，不代表到手總成本差異',
        }
      : { price: null, label: !c.tw_ref_price && c.same_spec_basis?.includes('查無') ? '台灣未售' : '待查' },
    restricted_hit: c.restricted_hit,
  };
}

