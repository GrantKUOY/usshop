// 最小 DOM 替身：驗證摘要鎖定表單後仍送出原內容，不操作任何瀏覽器。
import assert from 'node:assert/strict';
import test from 'node:test';
const elements=new Map(),values=new Map(),local=new Map(),session=new Map();
class Element{
 constructor(id){this.id=id;this.disabled=false;this.isConnected=true;this.listeners={};this.dataset={};}
 set innerHTML(html){this.html=html;for(const m of html.matchAll(/id="([^"]+)"/g))elements.set('#'+m[1],new Element(m[1]));for(const m of html.matchAll(/<input name="([^"]+)"[^>]*value="([^"]*)"/g))values.set(m[1],m[2]);}
 get innerHTML(){return this.html||'';} setAttribute(){} scrollIntoView(){} focus(){}
 addEventListener(name,handler){this.listeners[name]=handler;}dispatchEvent(event){this.listeners[event.type]?.(event);}
 querySelector(){return new Element('button');}
}
for(const id of ['app','feedback','identity','mode','offline','logout','install'])elements.set('#'+id,new Element(id));
globalThis.document={body:{dataset:{page:'item'}},querySelector:s=>elements.get(s),querySelectorAll:()=>[]};
globalThis.window={addEventListener(){}};
globalThis.location={search:'?demo=1',origin:'http://localhost:4321',assign(url){this.destination=url;},replace(url){this.destination=url;}};
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
globalThis.localStorage={getItem:k=>local.get(k),setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)};
globalThis.sessionStorage={getItem:k=>session.get(k),setItem:(k,v)=>session.set(k,v)};
globalThis.FormData=class{constructor(){this.disabled=elements.get('#editor')?.disabled;}get(k){return this.disabled?null:values.get(k)??'';}has(k){return !this.disabled&&values.get(k)===true;}};
await import('../../public/app/main.js');
for(let n=0;n<100&&!elements.has('#item-form');n++)await new Promise(r=>setTimeout(r,5));
test('家人填寫→必經摘要→送出：fieldset 鎖定不遺失內容',async()=>{
 const form=elements.get('#item-form');assert.ok(form);
 for(const [k,v] of Object.entries({name:'測試上衣',url:'https://example.com/shirt',spec:'深藍 / M',note:'假資料',family_ref_price:'',max_price:'45',max_price_currency:'USD'}))values.set(k,v);
 await form.onsubmit({preventDefault(){}});
 assert.equal(elements.get('#editor').disabled,true);
 assert.ok(elements.get('#summary').innerHTML.includes('深藍 / M'));
 const send=elements.get('#send');await send.onclick({currentTarget:send});
 assert.equal(location.destination,'/list?demo=1');
 const {api}=await import('../../public/app/shared.js');const {items}=await api('/items');
 const item=items.find(i=>i.content?.name==='測試上衣');assert.ok(item);assert.equal(item.content.spec,'深藍 / M');assert.equal(item.content.max_price,45);assert.equal(item.status,'pending_admin');assert.equal(local.size,0);
});
