import { query } from '../../server/db';
import { api } from '../../server/http';
import { candidateView, candidatePriceStale, currentSettings, staleDays } from '../../server/items';

// AI 精選型錄：只列已上架候選；價格逾期者標「價格待更新」且不可送出
export const GET = api('family', async () => {
  const s = await currentSettings();
  const days = staleDays(s);
  const rows = await query(
    `select c.*, p.featured_sort from candidate c left join product p on p.id = c.product_id
      where c.listing_status = 'listed' and (p.offline_at is null or p.offline_at > now())
      order by coalesce(p.featured_sort, 0), c.id`,
  );
  const items = await Promise.all(rows.map((c) => candidateView(undefined as any, c, candidatePriceStale(c, days))));
  return { featured_enabled: true, price_stale_days: days, items };
});
