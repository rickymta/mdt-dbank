import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
process.env.PORT='0';process.env.DB_PATH=':memory:';process.env.TELEGRAM_BOT_TOKEN='123:test';process.env.TELEGRAM_CHAT_ID='123';
let otp;const fetchOriginal=globalThis.fetch;globalThis.fetch=async(url,options)=>{if(String(url).startsWith('https://api.telegram.org/')){otp=JSON.parse(options.body).text.match(/\b\d{6}\b/)[0];return new Response('{"ok":true}');}return fetchOriginal(url,options);};
const {server}=await import('../server.js');const {db}=await import('../db.js');const {crc16}=await import('../public/qr.js');if(!server.listening)await once(server,'listening');
const browser=await chromium.launch();const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
async function fit(label){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,label+' horizontal overflow');}
try{
 await page.setViewportSize({width:390,height:844});await page.goto(`http://localhost:${server.address().port}`);await page.getByRole('button',{name:/Nhận mã OTP/}).waitFor();await fit('mobile login');
 await page.getByRole('button',{name:/Nhận mã OTP/}).click();await page.getByLabel('Mã xác thực OTP').fill(otp);await page.getByRole('button',{name:'Xác thực & đăng nhập'}).click();await page.getByRole('heading',{name:'Lịch sử giao dịch'}).waitFor();
 await fit('mobile transactions');await page.screenshot({path:'artifacts/mobile-transactions.png',fullPage:true});
 await page.locator('nav').getByRole('button',{name:'Quét QR'}).click();await page.getByText('Nhập chuỗi QR thủ công').click();
 const f=(id,s)=>id+String(s.length).padStart(2,'0')+s;let raw=f('00','01')+f('38',f('00','A000000727')+f('01',f('00','970436')+f('01','123456789'))+f('02','QRIBFTTA'))+f('53','704')+f('54','150000')+f('58','VN')+f('62',f('08','MEDDENTAL TEST'))+'6304';raw+=crc16(raw);
 await page.locator('#raw').fill(raw);await page.getByRole('button',{name:'Đọc mã QR'}).click();await page.getByRole('button',{name:'Xác nhận chuyển tiền'}).waitFor();await fit('mobile confirmation');await page.getByRole('button',{name:'Xác nhận chuyển tiền'}).click();await page.getByRole('heading',{name:'Chuyển tiền thành công'}).waitFor();
 await page.getByRole('button',{name:'Xem lịch sử giao dịch'}).click();await page.getByText('MEDDENTAL TEST',{exact:true}).waitFor();await fit('mobile transaction card');await page.screenshot({path:'artifacts/mobile-transactions.png',fullPage:true});
 await page.locator('nav').getByRole('button',{name:'Cài đặt'}).click();await page.getByLabel('Hạn mức chuyển tiền mỗi ngày (VND)').fill('-20');await page.getByRole('button',{name:'Lưu cài đặt'}).click();await page.waitForFunction(()=>document.querySelector('[name=dailyLimit]')?.value==='0');await fit('mobile settings');
 for(const width of [360,768,1024,1440]){await page.setViewportSize({width,height:900});for(const [nav,title] of [['Giao dịch','Lịch sử giao dịch'],['Quét QR','Quét mã QR'],['Cài đặt','Cài đặt']]){await page.locator('nav').getByRole('button',{name:nav}).click();await page.getByRole('heading',{name:title,exact:true}).waitFor();await fit(width+' '+nav);}}
 await page.locator('nav').getByRole('button',{name:'Giao dịch'}).click();await page.getByText('MEDDENTAL TEST',{exact:true}).waitFor();await page.screenshot({path:'artifacts/desktop-transactions.png',fullPage:true});assert.deepEqual(errors,[]);console.log('UI passed: OTP login, QR confirmation, saved settings, responsive 360/390/768/1024/1440px, no browser errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));db.close();}

