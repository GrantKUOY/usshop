// 精選型錄分類／搜尋的純函數（不碰 DOM，方便單元測試）。代碼需與 src/server/taxonomy.ts 同步。
export const AUDIENCE_TABS=[['all','全部'],['women','女裝'],['men','男裝'],['accessories','包包・配件']];
export const CATEGORY_LABELS={leggings:'緊身褲',pants:'長褲',shorts:'短褲',skirts_dresses:'裙子・洋裝',tops:'上衣',jackets:'外套',bras:'運動內衣',bags_accessories:'包包・配件',other:'其他'};
export const initialFilter=()=>({audience:'all',category:'all',q:''});
const inAudience=(c,audience)=>audience==='all'||c.audience===audience;
const catOf=c=>c.category||'other';
export function matchesQuery(c,q){
 const needle=String(q||'').trim().toLowerCase();
 if(!needle)return true;
 return [c.name,c.spec_label,c.merchant].some(t=>String(t??'').toLowerCase().includes(needle));
}
export function filterItems(items,f){
 return items.filter(c=>inAudience(c,f.audience)&&(f.category==='all'||catOf(c)===f.category)&&matchesQuery(c,f.q));
}
/** 各 audience 分頁的件數（不受品類與搜尋影響，與分頁標籤並列顯示） */
export function audienceCounts(items){
 const n={all:items.length,women:0,men:0,accessories:0};
 for(const c of items)if(c.audience in n&&c.audience!=='all')n[c.audience]++;
 return n;
}
/** 目前對象下有商品的品類（依 CATEGORY_LABELS 的固定順序），避免空 chips */
export function visibleCategories(items,audience){
 const have=new Set(items.filter(c=>inAudience(c,audience)).map(catOf));
 return Object.keys(CATEGORY_LABELS).filter(k=>have.has(k));
}
/** 切換對象後，若原品類已不存在就退回全部 */
export function normalizeFilter(items,f){
 return f.category!=='all'&&!visibleCategories(items,f.audience).includes(f.category)?{...f,category:'all'}:f;
}
export const isFiltered=f=>f.audience!=='all'||f.category!=='all'||f.q.trim()!=='';
