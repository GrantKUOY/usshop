-- 002：精選型錄分類（對象 audience、品類 category），存代碼；既有列為 null，由 scripts/backfill-catalog-category.ts 回填。
-- API 輸出時 null 的 audience 維持 null、null 的 category 以 'other' 輸出。
alter table candidate
  add column audience text check (audience in ('women', 'men', 'accessories')),
  add column category text check (category in ('leggings', 'pants', 'shorts', 'skirts_dresses', 'tops',
                                                'jackets', 'bras', 'bags_accessories', 'other'));
