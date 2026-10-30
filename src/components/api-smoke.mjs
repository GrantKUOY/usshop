import assert from 'node:assert/strict';
const base='http://localhost:4321';
for(const path of ['/','/list','/item','/invite','/admin','/admin/login','/admin/batches','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/app/main.js','/app/admin.js','/app/mock.js']){
 const res=await fetch(base+path);assert.equal(res.status,200,path);console.log('200 '+path);
}
const health=await (await fetch(base+'/api/health')).json();assert.equal(health.ok,true);console.log('資料庫健康檢查通過');
const login=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({name:'管理員',password:process.env.SEED_ADMIN_PASSWORD})});assert.equal(login.status,200);
const cookie=login.headers.getSetCookie().find(v=>v.startsWith('usshop_session=')).split(';')[0];
for(const path of ['/api/auth/me','/api/admin/pending?view=person','/api/admin/pending?view=batch','/api/admin/pending?view=product','/api/admin/batches']){const res=await fetch(base+path,{headers:{cookie}});assert.equal(res.status,200,path);const data=await res.json();if(path.includes('pending'))assert.ok(Array.isArray(data.groups)&&Array.isArray(data.confirmed_awaiting_result));console.log('API 結構檢查通過 '+path);}
await fetch(base+'/api/auth/logout',{method:'POST',headers:{cookie,Origin:base,'Content-Type':'application/json'},body:'{}'});
console.log('只讀 API 煙霧檢查通過；未新增家人、品項或改動批次。');
