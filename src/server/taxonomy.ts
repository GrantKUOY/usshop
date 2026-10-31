// 精選型錄分類代碼（前端顯示中文的對照在 public/app/catalog-filter.js，兩邊需同步）
export const AUDIENCES = ['women', 'men', 'accessories'] as const;
export const CATEGORIES = [
  'leggings', 'pants', 'shorts', 'skirts_dresses', 'tops', 'jackets', 'bras', 'bags_accessories', 'other',
] as const;
export const isAudience = (v: unknown): v is (typeof AUDIENCES)[number] => (AUDIENCES as readonly unknown[]).includes(v);
export const isCategory = (v: unknown): v is (typeof CATEGORIES)[number] => (CATEGORIES as readonly unknown[]).includes(v);
