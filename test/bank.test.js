import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
process.env.DB_PATH=':memory:';process.env.PORT='0';process.env.TELEGRAM_BOT_TOKEN='123:test';process.env.TELEGRAM_CHAT_ID='123';
const nativeFetch=globalThis.fetch;let otp;
globalThis.fetch=async(url,options)=>{if(String(url).startsWith('https://api.telegram.org/')){otp=JSON.parse(options.body).text.match(/\b\d{6}\b/)[0];return new Response(JSON.stringify({ok:true}));}return nativeFetch(url,options);};
const {server}=await import('../server.js');const {db,dayKey,limitValue}=await import('../db.js');const {crc16,parseQR}=await import('../public/qr.js');
if(!server.listening)await once(server,'listening');const base=`http://localhost:${server.address().port}`;let cookie='';
async function request(path,body,method='POST'){const response=await nativeFetch(base+path,{method:body===undefined?'GET':method,headers:{'Content-Type':'application/json',cookie},body:body===undefined?undefined:JSON.stringify(body)});const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return {status:response.status,data:await response.json()};}
const field=(id,s)=>id+String(s.length).padStart(2,'0')+s;
function qr(amount=250000,content='MEDDENTAL TEST'){let raw=field('00','01')+field('01','12')+field('38',field('00','A000000727')+field('01',field('00','970436')+field('01','123456789'))+field('02','QRIBFTTA'))+field('53','704')+field('54',String(amount))+field('58','VN')+field('62',field('08',content))+'6304';return raw+crc16(raw);}
test('VietQR, OTP, authenticated transfer, limits, filters and logout',async()=>{try{
 assert.equal(parseQR(qr()).amount,250000);assert.throws(()=>parseQR(qr().slice(0,-4)+'0000'));assert.throws(()=>parseQR(qr(0)));assert.equal(limitValue(-10),0);assert.equal(dayKey(new Date('2026-11-13T18:00:00Z')),'2026-11-14');
 assert.equal((await request('/api/transactions')).status,401);
 assert.equal((await request('/api/integration')).status,401);
 assert.equal((await request('/api/integration/keypair',{})).status,401);
 assert.equal((await request('/api/transactions/unknown/callback',{})).status,401);
 assert.equal((await request('/api/login',{username:'other'})).status,400);
 assert.equal((await request('/api/login',{username:'meddental'})).status,200);
 assert.equal((await request('/api/verify',{otp:'invalid'})).status,400);
 assert.equal((await request('/api/verify',{otp})).status,200);
 assert.equal((await request('/api/verify',{otp})).status,400);
 assert.equal((await request('/api/integration')).data.enabled,false);
 assert.equal((await request('/api/integration/keypair',{})).data.partnerPublicKey.includes('BEGIN PUBLIC KEY'),true);
 const integration=await request('/api/integration');assert.equal(integration.data.hasPartnerPrivateKey,true);assert.equal(integration.data.partnerPrivateKey,undefined);
 assert.equal((await request('/api/integration',{enabled:true,partner:'mdt-d-bank',callbackUrl:''},'PUT')).status,400);
 const config={token:'',chatId:'123',dailyLimit:300000,callbackUrl:''};
 assert.equal((await request('/api/settings',config,'PUT')).status,200);
 let parsed=await request('/api/qr',{raw:qr()});assert.equal(parsed.status,200);
 let result=await request('/api/transfers',{id:parsed.data.id,amount:1});assert.equal(result.status,200);assert.equal(result.data.amount,250000);
 assert.equal((await request('/api/transfers',{id:parsed.data.id})).status,200);
 assert.equal(db.prepare('SELECT count(*) n FROM transactions').get().n,1);
 parsed=await request('/api/qr',{raw:qr(100000)});assert.equal((await request('/api/transfers',{id:parsed.data.id})).status,400);
 assert.equal((await request('/api/transactions?search=DDENT')).data.total,1);
 assert.equal((await request('/api/transactions?search=%25')).data.total,0);
 assert.equal((await request('/api/settings',{...config,dailyLimit:-100},'PUT')).data.dailyLimit,0);
 assert.equal((await request('/api/transfers',{id:parsed.data.id})).status,200);
 for(let i=0;i<10;i++){parsed=await request('/api/qr',{raw:qr(1)});assert.equal((await request('/api/transfers',{id:parsed.data.id})).status,200);}
 const list=await request('/api/transactions?page=2');assert.equal(list.data.total,12);assert.equal(list.data.rows.length,2);
 assert.equal((await request('/api/settings')).data.hasToken,true);assert.equal((await request('/api/settings')).data.token,undefined);
 assert.equal((await request('/api/logout',{})).status,200);assert.equal((await request('/api/settings')).status,401);
 const html=await nativeFetch(base);assert.equal(html.status,200);assert.match(await html.text(),/MEDDENTAL/);
 assert.equal((await nativeFetch(base+'/vendor/html5-qrcode.min.js')).status,200);
}finally{globalThis.fetch=nativeFetch;await new Promise(resolve=>server.close(resolve));db.close();}});
