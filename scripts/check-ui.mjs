import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import * as protocol from '../integration-crypto.js';
const paymentKeys=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const tripleDesKey=randomBytes(24).toString('base64');let callbacks=0;
process.env.PORT='0';process.env.DB_PATH=':memory:';process.env.TELEGRAM_BOT_TOKEN='123:test';process.env.TELEGRAM_CHAT_ID='123';
let otp;const fetchOriginal=globalThis.fetch;globalThis.fetch=async(url,options)=>{if(String(url).startsWith('https://api.telegram.org/')){otp=JSON.parse(options.body).text.match(/\b\d{6}\b/)[0];return new Response('{"ok":true}');}if(String(url).startsWith('https://payment.example/')){
 const request=JSON.parse(options.body);callbacks++;
 const payload=JSON.parse(protocol.decryptData(request.data,tripleDesKey));
 const data=protocol.encryptData(JSON.stringify({code:'00',requestTime:request.requestTime,results:[{transactionId:payload.transactionId,status:'accepted',referenceId:'ui-test-reference'}]}),tripleDesKey);
 const responseTime=protocol.vnTime();
 return new Response(JSON.stringify({data,partner:request.partner,responseTime,sign:protocol.sign(protocol.signatureText(data,request.partner,responseTime),paymentKeys.privateKey)}));
}return fetchOriginal(url,options);};
const {server}=await import('../server.js');const {db}=await import('../db.js');const {crc16}=await import('../public/qr.js');if(!server.listening)await once(server,'listening');
const browser=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
async function fit(label){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,label+' horizontal overflow');}
try{
 await page.setViewportSize({width:390,height:844});await page.goto(`http://localhost:${server.address().port}`);await page.getByRole('button',{name:/Nhận mã OTP/}).waitFor();await fit('mobile login');
 await page.getByRole('button',{name:/Nhận mã OTP/}).click();await page.getByLabel('Mã xác thực OTP').fill(otp);await page.getByRole('button',{name:'Xác thực & đăng nhập'}).click();await page.getByRole('heading',{name:'Lịch sử giao dịch'}).waitFor();
 await fit('mobile transactions');await page.screenshot({path:'artifacts/mobile-transactions.png',fullPage:true});
 await page.locator('nav').getByRole('button',{name:'Quét QR'}).click();for (const [width,height] of [[320,568],[360,640],[390,844]]) {
   await page.setViewportSize({width,height});
   await fit('QR '+width);
   await page.locator('#camera').click();
   await page.waitForFunction(()=>document.querySelector('#reader video')?.currentTime>0.2);
   assert.ok(await page.locator('.qr-panel').evaluate(panel=>panel.getBoundingClientRect().bottom<=document.querySelector('aside').getBoundingClientRect().top),'Active camera fits at '+width);
   await page.locator('nav [data-view=qr]').click();
   await page.waitForFunction(()=>!document.querySelector('#scan-placeholder').hidden);
   assert.ok(await page.locator('.qr-panel').evaluate(panel=>panel.getBoundingClientRect().bottom<=document.querySelector('aside').getBoundingClientRect().top),'Scanner fits above navigation at '+width);
 }
 await page.getByText('Nhập chuỗi QR thủ công').click();
 const f=(id,s)=>id+String(s.length).padStart(2,'0')+s;let raw=f('00','01')+f('38',f('00','A000000727')+f('01',f('00','970436')+f('01','123456789'))+f('02','QRIBFTTA'))+f('53','704')+f('54','150000')+f('58','VN')+f('62',f('08','MEDDENTAL TEST'))+'6304';raw+=crc16(raw);
 await page.locator('#raw').fill(raw);await page.getByRole('button',{name:'Đọc mã QR'}).click();await page.getByRole('button',{name:'Xác nhận chuyển tiền'}).waitFor();await fit('mobile confirmation');await page.getByRole('button',{name:'Xác nhận chuyển tiền'}).click();await page.getByRole('heading',{name:'Chuyển tiền thành công'}).waitFor();
 await page.getByRole('button',{name:'Xem lịch sử giao dịch'}).click();await page.getByText('MEDDENTAL TEST',{exact:true}).waitFor();await fit('mobile transaction card');await page.screenshot({path:'artifacts/mobile-transactions.png',fullPage:true});
 await page.locator('nav').getByRole('button',{name:'Cài đặt'}).click();await page.getByLabel('Hạn mức chuyển tiền mỗi ngày (VND)').fill('-20');await page.getByRole('button',{name:'Lưu cài đặt'}).click();await page.waitForFunction(()=>document.querySelector('[name=dailyLimit]')?.value==='0');await fit('mobile settings');
 // Configure the partner integration through the real settings UI, then send an existing transaction.
 await page.getByRole('button',{name:'Tạo cặp khóa RSA 2048 bit'}).click();
 await page.getByRole('button',{name:'Tải partner-public.pem'}).waitFor();
 await page.getByLabel('URL callback').fill('https://payment.example/api/partner/v1/callbacks');
 await page.getByLabel('apiKey (64 ký tự hex)',{exact:true}).fill('a'.repeat(64));
 await page.getByLabel('secretKey (64 ký tự hex)',{exact:true}).fill('b'.repeat(64));
 await page.getByLabel('Khóa TripleDES (base64, 24 byte)',{exact:true}).fill(tripleDesKey);
 await page.getByLabel('Nhập khóa công khai MedDental (.pem)').setInputFiles({name:'meddental-public.pem',mimeType:'text/plain',buffer:Buffer.from(paymentKeys.publicKey)});
 await page.getByLabel('Bật tự động gửi callback',{exact:true}).check();
 await page.getByRole('button',{name:'Lưu tích hợp',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#integration .count')?.textContent==='Đang bật');
 await fit('mobile integration settings');await page.screenshot({path:'artifacts/integration-settings-mobile.png',fullPage:true});
 const integrationView=await page.evaluate(()=>fetch('/api/integration').then(r=>r.json()));
 assert.equal(integrationView.hasApiKey,true);assert.equal(integrationView.apiKey,undefined);assert.equal(integrationView.partnerPrivateKey,undefined);
 await page.locator('nav').getByRole('button',{name:'Giao dịch'}).click();
 await page.getByRole('button',{name:'Gửi callback',exact:true}).click();
 await expect.poll(()=>page.evaluate(async()=>{const list=await fetch('/api/transactions').then(r=>r.json());return list.rows[0]?.callback_state;}),{timeout:10000}).toBe('delivered');
 await page.getByRole('button',{name:'Làm mới giao dịch'}).click();
 await page.getByText('Đã xác nhận',{exact:true}).waitFor({timeout:5000});assert.equal(callbacks,1);await fit('mobile callback result');
 for(const width of [360,768,1024,1440]){await page.setViewportSize({width,height:900});for(const [nav,title] of [['Giao dịch','Lịch sử giao dịch'],['Quét QR','Quét mã QR'],['Cài đặt','Cài đặt']]){await page.locator('nav').getByRole('button',{name:nav}).click();await page.getByRole('heading',{name:title,exact:true}).waitFor();await fit(width+' '+nav);if(width===1440&&nav==='Cài đặt')await page.screenshot({path:'artifacts/integration-settings-desktop.png',fullPage:true});}}
 await page.locator('nav').getByRole('button',{name:'Giao dịch'}).click();await page.getByText('MEDDENTAL TEST',{exact:true}).waitFor();await page.screenshot({path:'artifacts/desktop-transactions.png',fullPage:true});assert.deepEqual(errors,[]);console.log('UI passed: OTP login, QR confirmation, saved settings, configured integration + callback acknowledgment, responsive 360/390/768/1024/1440px, no browser errors.');
}catch(error){console.error('UI diagnostic:',await page.locator('#content').innerText());console.error('Browser errors:',errors);await page.screenshot({path:'artifacts/ui-failure.png',fullPage:true});throw error;}finally{await browser.close();await new Promise(resolve=>server.close(resolve));db.close();}

