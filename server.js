import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import {randomInt,randomUUID,createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {db,settings,limitValue,transfer,dayKey} from './db.js';
import {parseQR} from './public/qr.js';
const app=express();const port=Number(process.env.PORT||3000);
app.use(helmet({contentSecurityPolicy:{directives:{'script-src':["'self'","'unsafe-inline'"],'img-src':["'self'",'data:','blob:'],'media-src':["'self'",'blob:']}}}));
app.use(express.json({limit:'16kb'}));
app.use(session({secret:process.env.SESSION_SECRET||randomBytes(32).toString('hex'),resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'strict',secure:process.env.COOKIE_SECURE==='true',maxAge:8*60*60*1000}}));
app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store'); if(!['GET','HEAD'].includes(req.method)){const origin=req.get('origin');if(origin&&origin!==`${req.protocol}://${req.get('host')}`)return res.status(403).json({error:'Nguồn yêu cầu không hợp lệ.'});}next();});
const auth=(req,res,next)=>req.session.auth?next():res.status(401).json({error:'Vui lòng đăng nhập.'});
const digest=s=>createHash('sha256').update(s).digest();
const configured=()=>Boolean((settings().token||process.env.TELEGRAM_BOT_TOKEN)&&(settings().chat_id||process.env.TELEGRAM_CHAT_ID));
app.get('/api/session',(req,res)=>res.json({authenticated:!!req.session.auth,configured:configured(),username:'meddental'}));
const loginLimit=rateLimit({windowMs:60000,limit:8,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Thử lại sau một phút.'}});
app.post('/api/login',loginLimit,async(req,res)=>{
 if(req.body.username!=='meddental')return res.status(400).json({error:'Tài khoản duy nhất là meddental.'});
 if(!configured())return res.status(409).json({error:'Cần cấu hình Telegram qua file .env trước lần đăng nhập đầu tiên.'});
 if(req.session.sentAt&&Date.now()-req.session.sentAt<60000)return res.status(429).json({error:'Vui lòng đợi 60 giây trước khi gửi lại OTP.'});
 const otp=String(randomInt(100000,1000000)); const cfg=settings();
 req.session.otp=null;
 try { const response=await fetch(`https://api.telegram.org/bot${cfg.token||process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:cfg.chat_id||process.env.TELEGRAM_CHAT_ID,text:`Ngân hàng số MEDDENTAL (giả lập)\nMã OTP đăng nhập: ${otp}\nCó hiệu lực trong 5 phút.`}),signal:AbortSignal.timeout(10000)});const result=await response.json();if(!response.ok||!result.ok)throw new Error();req.session.otp=digest(otp).toString('hex');req.session.expiry=Date.now()+300000;req.session.attempts=0;req.session.sentAt=Date.now();res.json({ok:true}); }
 catch {res.status(502).json({error:'Không gửi được OTP. Kiểm tra token, chat ID và kết nối Telegram.'});}
});
app.post('/api/verify',loginLimit,(req,res)=>{
 const code=String(req.body.otp||'');
 if(!req.session.otp||Date.now()>req.session.expiry||req.session.attempts>=5)return res.status(400).json({error:'OTP đã hết hạn hoặc hết lượt thử. Hãy gửi lại mã.'});
 req.session.attempts++;
 if(!/^\d{6}$/.test(code)||!timingSafeEqual(digest(code),Buffer.from(req.session.otp,'hex')))return res.status(400).json({error:'Mã OTP không chính xác.'});
 req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Không tạo được phiên đăng nhập.'});req.session.auth=true;res.json({ok:true});});
});
app.post('/api/logout',auth,(req,res)=>req.session.destroy(()=>{res.clearCookie('connect.sid');res.json({ok:true});}));
app.get('/api/settings',auth,(req,res)=>{const c=settings();res.json({chatId:c.chat_id||process.env.TELEGRAM_CHAT_ID||'',dailyLimit:c.daily_limit,callbackUrl:c.callback_url,hasToken:!!(c.token||process.env.TELEGRAM_BOT_TOKEN)});});
app.put('/api/settings',auth,(req,res)=>{try{const {token,chatId,callbackUrl}=req.body;const limit=limitValue(req.body.dailyLimit);if(typeof chatId!=='string'||!chatId.trim()||chatId.length>100||typeof callbackUrl!=='string'||callbackUrl.length>2048||typeof token!=='string'||token.length>200)throw new Error('Cấu hình không hợp lệ.');if(token&&!/^\d+:[\w-]+$/.test(token))throw new Error('Token Telegram không hợp lệ.');if(callbackUrl&&!['http:','https:'].includes(new URL(callbackUrl).protocol))throw new Error('Callback cần là URL HTTP hoặc HTTPS.');db.prepare('UPDATE settings SET token=?,chat_id=?,daily_limit=?,callback_url=? WHERE id=1').run(token||settings().token,chatId.trim(),limit,callbackUrl);res.json({ok:true,dailyLimit:limit});}catch(e){res.status(400).json({error:e.message});}});
app.get('/api/transactions',auth,(req,res)=>{
 const page=Math.max(1,parseInt(req.query.page)||1),size=10;const conditions=[],args=[];
 if(req.query.search){conditions.push("content LIKE ? ESCAPE '\\'");args.push('%'+String(req.query.search).replace(/[\\%_]/g,'\\$&')+'%');}
 for(const [key,op] of [['from','>='],['to','<=']])if(req.query[key]){if(!/^\d{4}-\d{2}-\d{2}$/.test(req.query[key]))return res.status(400).json({error:'Ngày không hợp lệ.'});conditions.push(`day ${op} ?`);args.push(req.query[key]);}
 const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
 const total=db.prepare('SELECT COUNT(*) AS n FROM transactions'+where).get(...args).n;
 const rows=db.prepare('SELECT * FROM transactions'+where+' ORDER BY created_at DESC LIMIT ? OFFSET ?').all(...args,size,(page-1)*size);
 const today=db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(amount),0) AS amount FROM transactions WHERE day=?').get(dayKey());
 res.json({rows,total,page,pages:Math.max(1,Math.ceil(total/size)),today,dailyLimit:settings().daily_limit});
});
app.post('/api/qr',auth,(req,res)=>{try{const parsed=parseQR(req.body.raw);const id=randomUUID();req.session.pending={id,parsed,expires:Date.now()+600000};res.json({...parsed,id});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/transfers',auth,(req,res)=>{try{const p=req.session.pending;if(!p||p.id!==req.body.id||p.expires<Date.now())throw new Error('Thông tin xác nhận đã hết hạn. Hãy quét lại QR.');res.json(transfer(p.parsed,p.id));}catch(e){res.status(400).json({error:e.message});}});
app.use('/vendor',express.static('node_modules/html5-qrcode',{index:false}));app.use(express.static('public'));
app.use((err,req,res,next)=>{res.status(err.status===400?400:500).json({error:err.status===400?'Dữ liệu yêu cầu không hợp lệ.':'Có lỗi xử lý yêu cầu.'});});
export const server=app.listen(port,()=>console.log(`MEDDENTAL: http://localhost:${port}`));

