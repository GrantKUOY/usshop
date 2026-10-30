export const demo = new URLSearchParams(location.search).get('demo') === '1';
export const href = path => path + (demo ? (path.includes('?') ? '&' : '?') + 'demo=1' : '');
export class ApiError extends Error { constructor(message,code,status){super(message);this.code=code;this.status=status;} }
export async function api(path,method='GET',body, key){
  if(!navigator.onLine) throw new ApiError('目前沒有網路，尚未送出成功。內容仍保留，連線後請再試一次。','offline',0);
  if(demo){const {mock}=await import('./mock.js');return mock(path,method,body,key);}
  let response;
  try{response=await fetch('/api'+path,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
  catch{throw new ApiError('連線中斷，尚未確認送出成功。請保留本頁並重試，系統會避免重複送出。','network',0);}
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new ApiError(data.error?.message||'目前無法完成，請稍後再試。',data.error?.code,response.status);
  return data;
}
export const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeUrl(value){try{const u=new URL(value,location.origin);return ['https:','http:'].includes(u.protocol)?u.href:'#';}catch{return '#';}}
export const date = value => value ? new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}) : '待查核';
export const money = value => value==null ? '待查核' : 'NT$ '+Number(value).toLocaleString('zh-TW');
export const range = value => !value || value.low==null ? '待查核' : value.high==null ? `${money(value.low)} 起（上界待確認）` : value.low===value.high ? money(value.low) : `${money(value.low)} – ${money(value.high)}`;
export function estimate(e){
 if(!e)return '<div class="estimate">待 Grant 查價 · 含運估算待查核</div>';
 const r=e.result;
 return `<div class="estimate"><strong>估算應付：${e.kind==='pending_check'||!r.total_twd?'待查價':range(r.total_twd)}</strong><details><summary>查看金額明細與估算依據</summary><dl><dt>商品款</dt><dd>${money(r.goods_twd)}</dd><dt>境內運費</dt><dd>${money(r.domestic_shipping_twd)}</dd><dt>代運費</dt><dd>${range(r.shipping_twd)}</dd><dt>完稅價格估算</dt><dd>${range(r.cif_twd)}</dd></dl>${e.kind==='pending_check'?`<p>已知小計（非總額）：${money(r.known_subtotal_twd)}</p>`:''}<p>${esc(r.weight_basis)}</p>${e.scenarios?`<div class="fields">${e.scenarios.exempt?`<p>符合免稅條件<br><strong>${range(e.scenarios.exempt.total_twd)}</strong></p>`:''}${e.scenarios.taxable?`<p>可能課稅<br><strong>${range(e.scenarios.taxable.total_twd)}</strong></p>`:''}</div>`:''}${[...(r.unknowns||[]),...(r.notes||[])].map(n=>`<p>${esc(n)}</p>`).join('')}<p>估算編號 ${esc(e.id)} · ${date(e.calculated_at)}</p></details><small>以海關實際認定為準</small></div>`;
}
export function downloadCsv(rows){
 const cell=v=>'"'+String(v??'待查核').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
 const blob=new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob), a=document.createElement('a');a.href=url;a.download='採購核對清單-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
