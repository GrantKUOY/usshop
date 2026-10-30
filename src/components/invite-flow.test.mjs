// 執行實際前端入口與 API helper；回應替身不代表真實 cookie／資料庫驗收。
import test from 'node:test';
import assert from 'node:assert/strict';

const realFetch=globalThis.fetch;
async function visit({session=false,token='used-test-token',code='invalid_invite',status=401,transport}={}){
 const elements=new Map();
 let done;
 const ready=new Promise(resolve=>done=resolve),calls=[],redirects=[],historyCalls=[];
 for(const id of ['app','feedback','mode','offline','logout','install','reload'])elements.set('#'+id,{
  innerHTML:'',setAttribute(name,value){if(name==='aria-busy'&&value==='false')done();},scrollIntoView(){},
 });
 globalThis.document={body:{dataset:{page:'invite'}},querySelector:s=>elements.get(s),querySelectorAll:()=>[]};
 globalThis.location={search:token?'?t='+token:'',replace:path=>redirects.push(path)};
 globalThis.history={replaceState:(_state,_title,path)=>historyCalls.push(path)};
 globalThis.window={addEventListener(){}};
 Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
 globalThis.fetch=async(url,options)=>{
  assert.deepEqual(historyCalls,['/invite']);
  assert.equal(options.credentials,'same-origin');
  calls.push({url,...options});
  if(transport)return transport(url,options);
  if(url==='/api/auth/me')return Response.json(session?{person:{id:1,role:'family'}}:{error:{code:'unauthorized'}},{status:session?200:401});
  assert.equal(url,'/api/auth/redeem');
  assert.equal(options.method,'POST');
  assert.deepEqual(JSON.parse(options.body),{token});
  return Response.json(status===200?{ok:true}:{error:{code,message:'private detail must not appear'}},{status});
 };
 await import('../../public/app/main.js?invite-test='+Math.random());
 await ready;
 return {html:elements.get('#app').innerHTML,calls,redirects};
}

test('失效邀請顯示完整指引及首頁按鈕，不顯示身分或伺服器細節',async()=>{
 const r=await visit();
 assert.match(r.html,/<h1>這個連結已經用過了<\/h1>/);
 assert.match(r.html,/邀請連結只能用一次。如果你之前已經在這支手機開通過/);
 assert.match(r.html,/同一個瀏覽器會記得你/);
 assert.match(r.html,/如果換了手機或瀏覽器，請聯絡 Grant 幫你重發一條新連結。/);
 assert.match(r.html,/<a class="button" href="\/">直接進站<\/a>/);
 assert.doesNotMatch(r.html,/used-test-token|private detail/);
 assert.deepEqual(r.redirects,[]);
});
test('已驗證 session 直接進首頁，不再次兌換 token',async()=>{
 const r=await visit({session:true});
 assert.deepEqual(r.redirects,['/']);
 assert.equal(r.calls.length,1);
});
test('未登入且有效邀請維持 POST 兌換後進首頁',async()=>{
 assert.deepEqual((await visit({status:200})).redirects,['/']);
});
test('缺少 token 顯示友善指引，不呼叫兌換',async()=>{
 const r=await visit({token:''});
 assert.match(r.html,/這個連結已經用過了/);
 assert.equal(r.calls.length,1);
});
test('格式錯誤的邀請不洩漏細節',async()=>{
 assert.match((await visit({code:'invalid_field',status:400})).html,/這個連結已經用過了/);
});
test('服務故障不誤報邀請已用過',async()=>{
 const r=await visit({code:'internal_error',status:500});
 assert.match(r.html,/暫時無法載入/);
 assert.doesNotMatch(r.html,/這個連結已經用過了/);
});

test('本機真實 API：已兌換 token 的指引頁及有效 cookie 進站',{skip:process.env.INVITE_LIVE_TEST!=='1'},async()=>{
 const base='http://localhost:4321';
 async function request(path,body,cookie=''){
  return realFetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',cookie},...(body?{body:JSON.stringify(body)}:{})});
 }
 const login=await request('/admin/login',{name:'管理員',password:'dev-admin-pass'});
 assert.equal(login.status,200);
 const adminCookie=login.headers.getSetCookie()[0].split(';')[0];
 const created=await request('/admin/people',{display_name:'邀請頁測試-'+Date.now()},adminCookie);
 assert.equal(created.status,201);
 const token=new URL((await created.json()).invite_url).searchParams.get('t');
 const redeemed=await request('/auth/redeem',{token});
 assert.equal(redeemed.status,200);
 const cookie=redeemed.headers.getSetCookie()[0].split(';')[0];
 const transport=(sessionCookie='')=>(url,options)=>realFetch(base+url,{...options,headers:{...options.headers,cookie:sessionCookie}});
 const anonymous=await visit({token,transport:transport()});
 assert.match(anonymous.html,/這個連結已經用過了/);
 assert.match(anonymous.html,/<a class="button" href="\/">直接進站<\/a>/);
 assert.deepEqual(anonymous.redirects,[]);
 const signedIn=await visit({token,transport:transport(cookie)});
 assert.deepEqual(signedIn.redirects,['/']);
 assert.equal(signedIn.calls.length,1);
 assert.equal((await request('/catalog',undefined,cookie)).status,200);
 assert.equal((await request('/auth/redeem',{token})).status,401);
 await request('/auth/logout',{},cookie);
 await request('/auth/logout',{},adminCookie);
});
