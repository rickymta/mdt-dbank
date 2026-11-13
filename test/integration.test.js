import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
process.env.DB_PATH=':memory:';
const {db,transfer,integrationSettings}=await import('../db.js');
const crypto=await import('../integration-crypto.js');
const {saveIntegration,integrationView,generatePartnerKey,deliverCallback,createCallbackWorker,retryCallback}=await import('../integration.js');
const keys=()=>generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const partner=keys(),meddental=keys();
const config={enabled:true,partner:'mdt-d-bank',callbackUrl:'https://payment.example/api/partner/v1/callbacks',apiKey:'a'.repeat(64),secretKey:'b'.repeat(64),tripleDesKey:randomBytes(24).toString('base64'),partnerPrivateKey:partner.privateKey,meddentalPublicKey:meddental.publicKey,signSecret:'shared-secret'};
const tx=()=>transfer({bank:'970436',account:'0123456789',amount:150000,content:'MDT YC0000123'},randomUUID());
function reply(request,transaction,{code='00',status='accepted',tamper=false,requestTime=request.requestTime,transactionId=transaction.id,httpStatus=200,plain=false}={}){
 if(plain)return new Response(JSON.stringify({code,message:'ignored external text'}),{status:httpStatus});
 const data=crypto.encryptData(JSON.stringify({code,message:'Thành công',requestTime,results:[{transactionId,status,referenceId:'payment-ref-123'}]}),config.tripleDesKey);
 const responseTime=crypto.vnTime();
 let sign=crypto.sign(crypto.signatureText(data,config.partner,responseTime,config.signSecret),meddental.privateKey);
 if(tamper)sign=(sign[0]==='A'?'B':'A')+sign.slice(1);
 return new Response(JSON.stringify({data,partner:config.partner,responseTime,sign}),{status:httpStatus});
}
function reset(){db.exec('DELETE FROM callback_jobs; DELETE FROM transactions;');saveIntegration(config);}

test('Partner integration contract and durable callback delivery',async t=>{try{
 await t.test('matches the exact TripleDES vector and Vietnam time from the supplied document',()=>{
  const json='{"transactionId":"FT2631700123","amount":150000,"direction":"in","transactionTime":"20261113094800","accountNumber":"0123456789","content":"MDT YC0000123"}';
  const key='TWVkRGVudGFsVHJpcGxlRGVzS2V5MjRC';
  const expected='AQIDBAUGBwiTWwwQcIfB6izpjUnSJgI/iDj8xfaffLrvF8kb/tL9B/s/9N+r/uQm7HS4qtVk1mLkzMyyHD028x1T90xX85yVJJKLM+mP2mQnwYHZOrgobTshspRqtXAc7ClDY8Yu3nGJp+OxGp9SkoSC43gxOMPvPyCYKZ3DOcAY9d90XaLGHyfQWLv+u8Ova992QwvSOAfKPvoyZfZXoHMgrVW9wqm4';
  assert.equal(crypto.encryptData(json,key,Buffer.from([1,2,3,4,5,6,7,8])),expected);
  assert.equal(crypto.decryptData(expected,key),json);
  assert.equal(crypto.vnTime(new Date('2026-11-13T02:48:52Z')),'20261113094852');
  assert.equal(crypto.validTime('20260230000000'),false);
  assert.throws(()=>crypto.tripleKey('not-base64'));
 });
 await t.test('configuration validates keys, defaults off, protects secrets and exports only the public key',()=>{
  assert.equal(integrationView().enabled,false);
  const generated=generatePartnerKey();assert.match(generated.partnerPublicKey,/BEGIN PUBLIC KEY/);assert.throws(generatePartnerKey);
  saveIntegration(config);
  const view=integrationView();assert.equal(view.enabled,true);assert.equal(view.hasApiKey,true);assert.equal(view.apiKey,undefined);assert.equal(view.partnerPrivateKey,undefined);assert.equal(view.signSecret,undefined);assert.equal(view.meddentalPublicKey,undefined);
  saveIntegration({...config,apiKey:'',secretKey:'',tripleDesKey:'',partnerPrivateKey:'',meddentalPublicKey:'',signSecret:''});assert.equal(integrationSettings().apiKey,config.apiKey);
  assert.throws(()=>saveIntegration({...config,callbackUrl:'http://payment.example'}));
  assert.throws(()=>saveIntegration({...config,apiKey:'bad'}));
  assert.throws(()=>saveIntegration({...config,tripleDesKey:randomBytes(16).toString('base64')}));
  assert.throws(()=>saveIntegration({...config,meddentalPublicKey:meddental.privateKey}));
  assert.equal(integrationSettings().apiKey,config.apiKey);
 });
 await t.test('transfer and queue are atomic and idempotent; callback maps the receiving account and original content',async()=>{
  reset();const transaction=tx();transfer(transaction,transaction.id);
  assert.equal(db.prepare('SELECT count(*) n FROM callback_jobs').get().n,1);
  const seen=[];
  const send=async(url,options)=>{
   assert.equal(url,config.callbackUrl);assert.equal(options.redirect,'error');assert.equal(options.headers.apiKey,config.apiKey);assert.equal(options.headers.secretKey,config.secretKey);
   const request=JSON.parse(options.body);seen.push(request);
   assert.equal(crypto.verify(crypto.signatureText(request.data,request.partner,request.requestTime,config.signSecret),request.sign,partner.publicKey),true);
   const payload=JSON.parse(crypto.decryptData(request.data,config.tripleDesKey));
   assert.deepEqual(payload,{transactionId:transaction.id,amount:150000,direction:'in',transactionTime:crypto.vnTime(new Date(transaction.created_at)),accountNumber:'0123456789',content:'MDT YC0000123',bankRef:transaction.id,bankCode:'970436'});
   return reply(request,transaction);
  };
  await deliverCallback(transaction,config,config.callbackUrl,send);
  await deliverCallback(transaction,config,config.callbackUrl,send);
  assert.notEqual(seen[0].data,seen[1].data);assert.notEqual(seen[0].sign,seen[1].sign);
  const worker=createCallbackWorker({fetcher:send});await Promise.all([worker.tick(),worker.tick()]);
  const job=db.prepare('SELECT * FROM callback_jobs').get();assert.equal(job.state,'delivered');assert.equal(job.attempts,1);assert.equal(job.reference_id,'payment-ref-123');assert.throws(()=>retryCallback(transaction.id));
 });
 await t.test('rolls back the transfer if its outbox entry cannot be persisted',()=>{
  reset();const id=randomUUID();
  db.exec("CREATE TRIGGER simulate_queue_failure BEFORE INSERT ON callback_jobs BEGIN SELECT RAISE(ABORT,'queue failure'); END;");
  try {assert.throws(()=>transfer({bank:'970436',account:'123',amount:1,content:'atomic'},id));}
  finally {db.exec('DROP TRIGGER simulate_queue_failure');}
  assert.equal(db.prepare('SELECT id FROM transactions WHERE id=?').get(id),undefined);
  assert.equal(db.prepare('SELECT count(*) n FROM callback_jobs').get().n,0);
 });
 await t.test('rejects tampered, plain-success, wrong-request and wrong-transaction responses',async()=>{
  reset();const transaction=tx();
  for(const options of [{tamper:true},{requestTime:'20000101000000'},{transactionId:'wrong'},{plain:true}]){
   await assert.rejects(deliverCallback(transaction,config,config.callbackUrl,async(_,o)=>reply(JSON.parse(o.body),transaction,options)));
  }
  const result=await deliverCallback(transaction,config,config.callbackUrl,async(_,o)=>reply(JSON.parse(o.body),transaction,{status:'duplicate'}));assert.equal(result.status,'duplicate');
  const noSecret={...config,signSecret:''};
  await deliverCallback(transaction,noSecret,config.callbackUrl,async(_,o)=>{
   const r=JSON.parse(o.body);assert.equal(crypto.verify(crypto.signatureText(r.data,r.partner,r.requestTime),r.sign,partner.publicKey),true);
   const data=crypto.encryptData(JSON.stringify({code:'00',requestTime:r.requestTime,results:[{transactionId:transaction.id,status:'accepted',referenceId:'ref'}]}),config.tripleDesKey);
   const responseTime=crypto.vnTime();return new Response(JSON.stringify({data,partner:config.partner,responseTime,sign:crypto.sign(crypto.signatureText(data,config.partner,responseTime),meddental.privateKey)}));
  });
 });
 await t.test('network failures retry with a new timestamp, IV/signature and the same transaction ID; duplicate completes',async()=>{
  reset();const transaction=tx();const job=db.prepare('SELECT * FROM callback_jobs').get();let now=job.created_at;const sent=[];
  const worker=createCallbackWorker({clock:()=>now,fetcher:async(_,o)=>{const r=JSON.parse(o.body);sent.push(r);if(sent.length===1)throw new Error('network secret should not be logged');return reply(r,transaction,{status:'duplicate'});}});
  await worker.tick();let pending=db.prepare('SELECT * FROM callback_jobs').get();assert.equal(pending.state,'pending');assert.equal(pending.next_at,now+60000);assert.doesNotMatch(pending.last_error,/secret should/);
  await worker.tick();assert.equal(sent.length,1);
  now+=60000;await worker.tick();const done=db.prepare('SELECT * FROM callback_jobs').get();assert.equal(done.state,'delivered');assert.equal(done.result_status,'duplicate');assert.equal(done.attempts,2);assert.notEqual(sent[0].requestTime,sent[1].requestTime);assert.notEqual(sent[0].data,sent[1].data);
  assert.equal(JSON.parse(crypto.decryptData(sent[1].data,config.tripleDesKey)).transactionId,transaction.id);
 });
 await t.test('handles documented failure codes and untrusted responses without marking a transfer delivered',async()=>{
  for(const [options,expected] of [[{plain:true,code:'04',httpStatus:401},'failed'],[{plain:true,code:'05',httpStatus:401},'failed'],[{code:'01',httpStatus:400},'failed'],[{code:'02',httpStatus:401},'failed'],[{code:'03',httpStatus:401},'pending'],[{code:'99',httpStatus:500},'pending'],[{tamper:true},'pending']]){
   reset();const transaction=tx();await createCallbackWorker({fetcher:async(_,o)=>reply(JSON.parse(o.body),transaction,options)}).tick();
   assert.equal(db.prepare('SELECT state FROM callback_jobs').get().state,expected);
   assert.equal(db.prepare('SELECT count(*) n FROM transactions').get().n,1);
  }
 });
 await t.test('pauses when disabled, persists/recover interrupted jobs and expires after 24h; manual retry keeps ID',async()=>{
  reset();const transaction=tx();saveIntegration({...config,enabled:false});let called=0;
  const send=async(_,o)=>{called++;return reply(JSON.parse(o.body),transaction);};
  const worker=createCallbackWorker({fetcher:send});await worker.tick();assert.equal(called,0);tx();assert.equal(db.prepare('SELECT count(*) n FROM callback_jobs').get().n,1);
  saveIntegration(config);db.exec("UPDATE callback_jobs SET state='processing'");worker.start();worker.stop();assert.equal(db.prepare('SELECT state FROM callback_jobs').get().state,'pending');
  const expired=createCallbackWorker({clock:()=>Date.now()+25*3600000,fetcher:send});await expired.tick();assert.equal(called,0);assert.equal(db.prepare('SELECT state FROM callback_jobs').get().state,'failed');
  retryCallback(transaction.id);await worker.tick();assert.equal(called,1);assert.equal(db.prepare('SELECT state FROM callback_jobs').get().state,'delivered');
 });
}finally{db.close();}});
