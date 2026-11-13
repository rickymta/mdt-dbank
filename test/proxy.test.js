import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';

process.env.DB_PATH=':memory:';
process.env.PORT='0';
process.env.TELEGRAM_BOT_TOKEN='123:test';
process.env.TELEGRAM_CHAT_ID='123';
process.env.TRUST_PROXY='1';
process.env.COOKIE_SECURE='true';
const nativeFetch=globalThis.fetch;
let otp;
let sends=0;
globalThis.fetch=async(url,options)=>{
 if(String(url).startsWith('https://api.telegram.org/')){
  sends++;
  otp=JSON.parse(options.body).text.match(/\b\d{6}\b/)[0];
  return new Response(JSON.stringify({ok:true}));
 }
 return nativeFetch(url,options);
};
const {server}=await import('../server.js');
const {db}=await import('../db.js');
if(!server.listening) await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
let cookie='';
async function request(path,body,overrides={}){
 const payload=body===undefined?undefined:JSON.stringify(body);
 return new Promise((resolve,reject)=>{
  const req=httpRequest(base+path,{
   method:payload===undefined?'GET':'POST',
   headers:{'Content-Type':'application/json',host:'dbank.antblog.xyz',
    origin:'https://dbank.antblog.xyz','x-forwarded-proto':'https',
    'x-forwarded-for':'198.51.100.10',cookie,...overrides}
  },response=>{
   let text='';
   response.setEncoding('utf8');
   response.on('data',chunk=>text+=chunk);
   response.on('error',reject);
   response.on('end',()=>{
    try {
     const setCookie=response.headers['set-cookie']?.[0];
     if(setCookie) cookie=setCookie.split(';')[0];
     resolve({status:response.statusCode,data:JSON.parse(text),setCookie});
    } catch(error) {reject(error);}
   });
  });
  req.on('error',reject);
  req.end(payload);
 });
}

test('HTTPS behind Nginx: origin check, Secure session, OTP and per-client rate limits',async()=>{
 try {
  assert.equal((await request('/api/login',{username:'meddental'},{origin:'https://other.example'})).status,403);
  assert.equal((await request('/api/login',{username:'meddental'},{'x-forwarded-proto':'http'})).status,403);
  assert.equal(sends,0);
  const login=await request('/api/login',{username:'meddental'});
  assert.equal(login.status,200);
  assert.match(login.setCookie,/; Secure/);
  assert.match(login.setCookie,/; HttpOnly/);
  assert.match(login.setCookie,/; SameSite=Strict/);
  const oldCookie=cookie;
  const verify=await request('/api/verify',{otp});
  assert.equal(verify.status,200);
  assert.match(verify.setCookie,/; Secure/);
  assert.notEqual(cookie,oldCookie);
  assert.equal((await request('/api/session')).data.authenticated,true);
  assert.equal((await request('/api/settings')).status,200);
  assert.equal((await request('/api/settings',undefined,{cookie:''})).status,401);
  for(let i=0;i<8;i++){
   assert.equal((await request('/api/login',{username:'invalid'},{'x-forwarded-for':'198.51.100.20'})).status,400);
  }
  assert.equal((await request('/api/login',{username:'invalid'},{'x-forwarded-for':'198.51.100.20'})).status,429);
  assert.equal((await request('/api/login',{username:'invalid'},{'x-forwarded-for':'198.51.100.21'})).status,400);
  assert.equal((await request('/api/logout',{})).status,200);
  assert.equal((await request('/api/session')).data.authenticated,false);
 } finally {
  globalThis.fetch=nativeFetch;
  await new Promise(resolve=>server.close(resolve));
  db.close();
 }
});
