// DOM 替身＋既有示範 API：確認實際頁面模板接上換算；不等同瀏覽器視覺驗收。
import test from 'node:test';
import assert from 'node:assert/strict';
const elements=new Map(),storage=new Map();
let rendered;
const ready=new Promise(resolve=>rendered=resolve);
class Element {
 set innerHTML(html){this.html=html;for(const m of html.matchAll(/id="([^"]+)"/g))elements.set('#'+m[1],new Element());}
 get innerHTML(){return this.html||'';}
 setAttribute(name,value){if(name==='aria-busy'&&value==='false')rendered();}
 scrollIntoView(){}
}
for(const id of ['app','feedback','identity','mode','offline','logout','install'])elements.set('#'+id,new Element());
globalThis.document={body:{dataset:{page:'home',fxRate:'32',fxBuffer:'0.01'}},querySelector:s=>elements.get(s),querySelectorAll:()=>[]};
globalThis.location={search:'?demo=1',origin:'http://localhost:4321'};
globalThis.window={addEventListener(){}};
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
globalThis.sessionStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)};
await import('../../public/app/main.js');
await ready;

test('精選卡片原價旁有小字換算及完整註腳',()=>{
 const html=elements.get('#app').innerHTML;
 assert.match(html,/USD 29 <small class="twd-equivalent">約 NT\$937<\/small>/);
 assert.match(html,/匯率 1 USD = NT\$32\.32（站內試算匯率，含 1% 緩衝），台幣為參考換算，實際金額以結算為準。/);
});

test('核准報價使用同一顯示元件，保留 USD 原值',async()=>{
 const {api}=await import('../../public/app/shared.js');
 // demo=1：只更新上方記憶體 storage，不連線、不操作正式資料。
 await api('/admin/items/2/price-checks','POST',{unit_price:98,currency:'USD'});
 const {admin}=await import('../../public/app/admin.js');
 await admin();
 const html=elements.get('#app').innerHTML;
 assert.match(html,/核准報價：USD 98 <small class="twd-equivalent">約 NT\$3,167<\/small>/);
 assert.match(html,/含 1% 緩衝/);
 assert.equal((await api('/admin/items/2/price-checks')).price_checks[0].unit_price,98);
});
