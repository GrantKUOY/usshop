import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEstimate } from '../server/estimate.ts';

globalThis.location={search:'',origin:'http://localhost:4321'};
globalThis.document={body:{dataset:{fxRate:'32',fxBuffer:'0.01'}}};
const {foreignMoney,fxNote,bindMoneyPreview}=await import('../../public/app/shared.js');

test('顯示換算與既有引擎商品款一致，僅最後四捨五入',()=>{
 const params={fx_rate:32,fx_buffer:0.01};
 for(const price of [0,0.01,19.99,98,100.5]){
  const estimate=computeEstimate({quantity:1,unit_price:price,currency:'USD',weight_source:'none'},params);
  assert.ok(foreignMoney(price,'USD').includes('約 NT$'+estimate.result.goods_twd.toLocaleString('zh-TW')));
 }
 assert.match(fxNote(),/1 USD = NT\$32\.32（站內試算匯率，含 1% 緩衝）/);
});

test('設定改變時沿用新緩衝，不重複加成或寫死匯率',()=>{
 document.body.dataset={fxRate:'30',fxBuffer:'0.03'};
 assert.match(foreignMoney(100,'USD'),/約 NT\$3,090/);
 assert.match(fxNote(),/含 3% 緩衝/);
});

test('未知匯率或價格不假裝零元；台幣與其他幣別不重複換算',()=>{
 document.body.dataset={};
 assert.match(foreignMoney(100,'USD'),/台幣換算待查核/);
 assert.doesNotMatch(foreignMoney(null,'USD'),/NT\$/);
 assert.equal(foreignMoney(100,'TWD'),'TWD 100');
 assert.equal(foreignMoney(100,'JPY'),'JPY 100');
 assert.match(fxNote(),/匯率尚未設定或暫時無法讀取/);
});

test('輸入預覽切換幣別，保留原始欄位值',()=>{
 document.body.dataset={fxRate:'32',fxBuffer:'0.01'};
 const fields={amount:{value:'98'},currency:{value:'USD'}},listeners={},target={};
 const form={elements:{namedItem:name=>fields[name]},addEventListener:(name,fn)=>listeners[name]=fn};
 bindMoneyPreview(form,'amount','currency',target);
 assert.match(target.innerHTML,/約 NT\$3,167/);
 assert.equal(fields.amount.value,'98');
 fields.currency.value='TWD';listeners.change();
 assert.equal(target.innerHTML,'TWD 98');
 fields.amount.value='';listeners.input();
 assert.equal(target.innerHTML,'');
});
