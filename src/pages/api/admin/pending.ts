import { query } from '../../../server/db';
import { api } from '../../../server/http';
import { checkConfirmable } from '../../../server/items';

type Row = Record<string, any>;

// 待確認彙總：預設依家人分組並含小計；view=batch|product 切換視角；另附「已確認但尚未回報結果」固定區塊
export const GET = api('admin', async (ctx) => {
  const view = ctx.url.searchParams.get('view') ?? 'person';
  const batchId = ctx.url.searchParams.get('batch_id');
  const rows: Row[] = await query(
    `select i.id, i.person_id, p.display_name as person_name, i.batch_id, b.name as batch_name, i.status, i.source,
            i.restricted_hit, i.restricted_review_status, i.current_revision_id,
            r.version_no, r.name, r.url, r.spec, r.spec_undecided, r.quantity, r.note, r.family_ref_price,
            r.max_price, r.max_price_currency, r.submitted_at,
            pc.id as price_check_id, pc.unit_price, pc.currency as pc_currency, pc.checked_at as pc_checked_at,
            e.id as estimate_id, e.result_kind, e.result as estimate_result, e.scenarios as estimate_scenarios
       from order_item i
       join person p on p.id = i.person_id
       left join batch b on b.id = i.batch_id
       left join order_item_revision r on r.id = i.current_revision_id
       left join lateral (select * from price_check x where x.order_item_id = i.id order by x.id desc limit 1) pc on true
       left join lateral (select * from estimate x where x.revision_id = i.current_revision_id order by x.id desc limit 1) e on true
      where i.status in ('pending_admin', 'pending_family', 'confirmed') ${batchId ? 'and i.batch_id = $1' : ''}
      order by i.id`,
    batchId ? [Number(batchId)] : [],
  );

  const shape = async (r: Row) => {
    const blockers = r.status === 'pending_admin' ? await checkConfirmable(undefined as any, { ...r, id: r.id }, r.current_revision_id) : null;
    return {
      item_id: r.id, status: r.status, source: r.source, person_id: r.person_id, person_name: r.person_name,
      batch_id: r.batch_id, revision_id: r.current_revision_id, version_no: r.version_no,
      name: r.name, url: r.url, spec: r.spec, spec_undecided: r.spec_undecided, quantity: r.quantity, note: r.note,
      family_ref_price: r.family_ref_price, max_price: r.max_price, max_price_currency: r.max_price_currency,
      restricted_hit: r.restricted_hit, restricted_review_status: r.restricted_review_status,
      price_check: r.price_check_id ? { id: r.price_check_id, unit_price: r.unit_price, currency: r.pc_currency, checked_at: r.pc_checked_at } : null,
      estimate: r.estimate_id ? { id: r.estimate_id, kind: r.result_kind, result: r.estimate_result, scenarios: r.estimate_scenarios } : null,
      confirm_blocker: blockers, // null＝目前可確認
    };
  };

  const pendingRows = rows.filter((r) => r.status !== 'confirmed');
  const items = await Promise.all(pendingRows.map(shape));
  const subtotal = (list: any[]) => ({
    count: list.length,
    estimated_total_twd: {
      // 只加總有估算者；沒有的列入 unpriced_count，不給假總額
      low: list.reduce((a, i) => a + (i.estimate?.result?.total_twd?.low ?? 0), 0),
      high: list.some((i) => i.estimate?.result?.total_twd?.high == null) ? null : list.reduce((a, i) => a + i.estimate.result.total_twd.high, 0),
    },
    unpriced_count: list.filter((i) => !i.estimate || i.estimate.kind === 'pending_check').length,
  });
  const group = (key: (i: any) => string, label: (i: any) => any) => {
    const m = new Map<string, any[]>();
    for (const i of items) m.set(key(i), [...(m.get(key(i)) ?? []), i]);
    return [...m.entries()].map(([k, list]) => ({ key: k, ...label(list[0]), items: list, subtotal: subtotal(list) }));
  };

  const groups =
    view === 'batch'
      ? group((i) => String(i.batch_id), (i) => ({ batch_id: i.batch_id }))
      : view === 'product'
        ? group(
            // 連結與規格完全一致才合併數量
            (i) => `${i.url ?? ''}||${i.spec ?? ''}||${i.name}`,
            (i) => ({ name: i.name, url: i.url, spec: i.spec }),
          ).map((g) => ({ ...g, total_quantity: g.items.reduce((a: number, i: any) => a + i.quantity, 0) }))
        : group((i) => String(i.person_id), (i) => ({ person_id: i.person_id, person_name: i.person_name }));

  const awaiting = await Promise.all(
    rows.filter((r) => r.status === 'confirmed' && !r.arrival_override).map(shape),
  );
  // 已確認但尚未回報購買結果（防遺漏固定區塊；PurchaseResult 回填於下期，屆時自動排除已回報者）
  const withResult = new Set((await query('select distinct order_item_id from purchase_result')).map((r) => r.order_item_id));
  return {
    view,
    groups,
    confirmed_awaiting_result: awaiting.filter((i) => !withResult.has(i.item_id)),
  };
});
