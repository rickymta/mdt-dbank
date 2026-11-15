const iconPaths = {
 history: 'M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2',
 qr: 'M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M7 7h3v3H7z M14 7h3v3h-3z M7 14h3v3H7z M14 14h3v3h-3z',
 settings: 'M3 6h7m4 0h7 M3 12h2m4 0h12 M3 18h10m4 0h4 M14 6a2 2 0 1 1-4 0 2 2 0 1 1 4 0 M9 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0 M17 18a2 2 0 1 1-4 0 2 2 0 1 1 4 0',
 logout: 'M10 3H4v18h6 M9 12h12m-5-5 5 5-5 5',
 send: 'M5 19 19 5 M7 5h12v12',
 transfers: 'M3 7h17l-4-4 M21 17H4l4 4',
 limit: 'M3 18a10 10 0 1 1 18 0 M12 14l5-6'
};
const icon = name => `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${iconPaths[name]}"/></svg>`;
const root=document.querySelector('#app');let page=1,view='transactions',reader=null,pending=null,filters={search:'',from:'',to:''};
const money=n=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND'}).format(n);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,body,method='POST'){const r=await fetch('/api/'+url,{method:body===undefined?'GET':method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok){if(r.status===401)login();throw new Error(data.error||'Yêu cầu không thành công.');}return data;}
function toast(s){const el=document.querySelector('#toast');el.textContent=s;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),4500);}
async function task(button,fn){button.disabled=true;try{await fn();}catch(e){toast(e.message);}finally{button.disabled=false;}}
const brand=`<div class="brand"><span class="brandmark">M<span>+</span></span><div>MEDDENTAL<small>NGÂN HÀNG SỐ</small></div></div>`;
function login(otp=false,configured=true){root.innerHTML=`<main class="auth"><section class="auth-story">${brand}<div><span class="eyebrow">ĐƠN GIẢN · NHANH CHÓNG · TIỆN LỢI</span><h1>Giao dịch gọn nhẹ.<br>Kết nối dễ dàng.</h1><p>Không gian ngân hàng số dành cho MEDDENTAL.</p><div class="illustration"><div class="bankcard"><span>MEDDENTAL ✦</span><b>Digital Banking</b><p>•••• &nbsp; •••• &nbsp; •••• &nbsp; 2026</p><small>MEDDENTAL</small></div><span class="orb"></span></div></div><small>Ứng dụng giả lập · Không giao dịch tiền thật</small></section><section class="auth-form"><div class="auth-box"><span class="badge">MÔI TRƯỜNG THỬ NGHIỆM</span><h2>${otp?'Xác thực đăng nhập':'Chào mừng trở lại'}</h2><p class="muted">${otp?'Nhập mã gồm 6 chữ số được gửi đến Telegram của bạn.':'Đăng nhập để quản lý và thực hiện giao dịch giả lập.'}</p><form id="authform"><label>${otp?'Mã xác thực OTP':'Tên tài khoản'}<input id="credential" ${otp?'inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"':'autocomplete="username" value="meddental"'} required autofocus></label><button class="primary wide">${otp?'Xác thực & đăng nhập':'Nhận mã OTP qua Telegram'} <span>→</span></button></form>${otp?'<button id="resend" class="text-button">Gửi lại mã OTP</button><button id="back" class="text-button">Quay lại đăng nhập</button>':'<div class="info">✧ &nbsp;Đăng nhập bằng OTP qua Telegram, không cần mật khẩu.</div>'}${configured?'':'<div class="info">Cấu hình TELEGRAM_BOT_TOKEN và TELEGRAM_CHAT_ID trong file .env, khởi động lại ứng dụng để đăng nhập lần đầu.</div>'}<p class="fine">Ngân hàng số MEDDENTAL · Chỉ dành cho kiểm thử</p></div></section></main>`;
 document.querySelector('#authform').onsubmit=e=>{e.preventDefault();task(e.submitter,async()=>{const value=document.querySelector('#credential').value;if(otp){await api('verify',{otp:value});await shell();}else{await api('login',{username:value});login(true);}});};
 if(otp){document.querySelector('#resend').onclick=e=>task(e.target,async()=>{await api('login',{username:'meddental'});toast('Đã gửi mã OTP mới qua Telegram.');});document.querySelector('#back').onclick=()=>login();}}
async function stopCamera(){
 const camera=document.querySelector('#camera');
 if(camera)camera.textContent='Mở camera';
 const placeholder=document.querySelector('#scan-placeholder');
 if(placeholder)placeholder.hidden=false;
 if(reader){try{if(reader.isScanning)await reader.stop();reader.clear();}catch{}reader=null;}}
async function shell(){await stopCamera();root.innerHTML=`<div class="layout"><aside>${brand}<div class="nav-label">KHÔNG GIAN LÀM VIỆC</div><nav><button data-view="transactions">${icon('history')} <span>Giao dịch</span></button><button data-view="qr">${icon('qr')} <span>Quét QR</span></button><button data-view="settings">${icon('settings')} <span>Cài đặt</span></button></nav><div class="sidebar-bottom"><span class="status-dot"></span> Hệ thống giả lập<p>Không sử dụng tiền thật</p></div></aside><div class="workspace"><header><div class="mobile-brand">MEDDENTAL<span> NGÂN HÀNG SỐ</span></div><span class="header-title">Ngân hàng số MEDDENTAL</span><div class="user"><span class="avatar">M</span><span>meddental<small>Tài khoản thử nghiệm</small></span><button id="logout" title="Đăng xuất" aria-label="Đăng xuất">${icon('logout')}</button></div></header><main id="content"></main><footer>© 2026 MEDDENTAL <span>Ứng dụng giả lập ngân hàng</span></footer></div></div>`;document.querySelector('#logout').onclick=e=>task(e.currentTarget,async()=>{await api('logout',{});await stopCamera();login();});document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>navigate(b.dataset.view));await navigate(view);}
async function navigate(next){await stopCamera();view=next;window.scrollTo(0,0);document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));try{if(view==='transactions')await transactions();if(view==='qr')qr();if(view==='settings')await settings();}catch(e){toast(e.message);}}
const heading=(tag,title,description,action='')=>`<div class="page-heading"><div><span class="eyebrow">${tag}</span><h1>${title}</h1><p class="muted">${description}</p></div>${action}</div>`;
async function transactions(){const data=await api('transactions?'+new URLSearchParams({...filters,page}));document.querySelector('#content').innerHTML=heading('TỔNG QUAN','Lịch sử giao dịch','Theo dõi các giao dịch chuyển tiền của bạn.',`<button id="new" class="primary">${icon('qr')} Quét QR chuyển tiền</button>`)+`<div class="stats"><div class="stat"><span class="stat-icon">${icon('send')}</span><span>Đã chuyển hôm nay<strong>${money(data.today.amount)}</strong><small>Ngày hiện tại · Giờ Việt Nam</small></span></div><div class="stat"><span class="stat-icon">${icon('transfers')}</span><span>Giao dịch hôm nay<strong>${data.today.count}<em> giao dịch</em></strong><small>Đã ghi nhận thành công</small></span></div><div class="stat"><span class="stat-icon">${icon('limit')}</span><span>Hạn mức mỗi ngày<strong>${data.dailyLimit?money(data.dailyLimit):'Không giới hạn'}</strong><small>${data.dailyLimit?'Còn lại '+money(Math.max(0,data.dailyLimit-data.today.amount)):'Thay đổi trong phần Cài đặt'}</small></span></div></div><section class="panel"><div class="panel-heading"><h2>Danh sách giao dịch <span class="count">${data.total}</span></h2><button id="refresh" class="text-button" aria-label="Làm mới giao dịch">↻ Làm mới</button></div><details class="filter-panel" ${Object.values(filters).some(Boolean)?'open':''}><summary>Bộ lọc giao dịch ${esc([filters.from,filters.to].filter(Boolean).join(' – '))}</summary><form id="filters" class="filters"><label class="search">Nội dung chuyển tiền<input name="search" placeholder="Tìm nội dung chuyển tiền…" value="${esc(filters.search)}"></label><label>Từ ngày<input type="date" name="from" value="${esc(filters.from)}"></label><label>Đến ngày<input type="date" name="to" value="${esc(filters.to)}"></label><button class="secondary">Lọc</button><button type="button" id="reset" class="text-button">Đặt lại</button></form></details><div class="table-wrap"><table><thead><tr><th>GIAO DỊCH / THỜI GIAN</th><th>NGƯỜI NHẬN</th><th>NỘI DUNG</th><th>SỐ TIỀN</th><th>TRẠNG THÁI</th><th>CALLBACK</th></tr></thead><tbody>${data.rows.map(t=>`<tr><td data-label="Giao dịch"><b class="txid">${esc(t.id.slice(0,8).toUpperCase())}</b><small>${new Date(t.created_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</small></td><td data-label="Người nhận"><b>${esc(t.name||t.account)}</b><small>${esc(t.bank)} · ${esc(t.account)}</small></td><td data-label="Nội dung" class="description">${esc(t.content)||'—'}</td><td data-label="Số tiền" class="amount">− ${money(t.amount)}</td><td data-label="Trạng thái"><span class="success">✓ Thành công</span></td><td data-label="Callback" class="callback-cell">${callbackCell(t)}</td></tr>`).join('')}</tbody></table>${!data.rows.length?`<div class="empty"><span>${icon('transfers')}</span><h3>Chưa có giao dịch nào</h3><p>Quét mã QR để tạo giao dịch hoặc thay đổi bộ lọc.</p></div>`:''}</div><div class="pagination"><span>${data.total?'Hiển thị '+((page-1)*10+1)+'–'+Math.min(page*10,data.total)+' / '+data.total+' giao dịch':'0 giao dịch'}</span><div><button id="prev" ${page<=1?'disabled':''} aria-label="Trang trước">←</button><span>Trang ${page} / ${data.pages}</span><button id="next" ${page>=data.pages?'disabled':''} aria-label="Trang sau">→</button></div></div></section>`;
 document.querySelector('#refresh').onclick=e=>task(e.currentTarget,transactions);
 document.querySelectorAll('[data-retry-callback]').forEach(b=>b.onclick=()=>task(b,async()=>{await api('transactions/'+encodeURIComponent(b.dataset.retryCallback)+'/callback',{});toast('Đã xếp hàng gửi callback.');await transactions();}));
 document.querySelector('#new').onclick=()=>navigate('qr');document.querySelector('#filters').onsubmit=e=>{e.preventDefault();filters=Object.fromEntries(new FormData(e.target));page=1;task(e.submitter,transactions);};document.querySelector('#reset').onclick=()=>{filters={search:'',from:'',to:''};page=1;navigate('transactions');};document.querySelector('#prev').onclick=()=>{page--;navigate('transactions');};document.querySelector('#next').onclick=()=>{page++;navigate('transactions');};}
function qr(){pending=null;document.querySelector('#content').innerHTML=heading('CHUYỂN TIỀN','Quét mã QR','Quét VietQR có sẵn số tiền, kiểm tra thông tin và xác nhận.')+`<div class="qr-grid" data-step="scan"><section class="panel qr-panel"><h2>Quét VietQR</h2><div id="reader"></div><div id="scan-placeholder" class="scan-placeholder"><div class="qr-symbol">${icon('qr')}</div><p>Đặt mã QR vào khung hình</p><small>Hỗ trợ VietQR chuyển khoản VND</small></div><div class="scan-actions"><button class="primary" id="camera">Mở camera</button><button class="secondary" id="choose-file">Chọn ảnh QR</button><input type="file" id="qrfile" accept="image/*" hidden></div><details><summary>Nhập chuỗi QR thủ công</summary><textarea id="raw" rows="4" placeholder="Dán nội dung VietQR…"></textarea><button class="secondary" id="parse">Đọc mã QR</button></details><p class="fine">Camera cần localhost hoặc kết nối HTTPS.</p></section><section class="panel" id="confirmation"><div class="empty"><span>${icon('send')}</span><h3>Sẵn sàng chuyển tiền</h3><p>Thông tin người nhận và số tiền sẽ xuất hiện ở đây sau khi quét QR.</p></div></section></div>`;
 const grid=document.querySelector('.qr-grid');
 const accept=async raw=>{pending=await api('qr',{raw});await stopCamera();if(!grid.isConnected)return;grid.dataset.step="review";const p=pending;document.querySelector('#confirmation').innerHTML=`<div class="confirm"><span class="badge">KIỂM TRA THÔNG TIN</span><h2>Xác nhận chuyển tiền</h2><div class="transfer-amount">${money(p.amount)}</div><dl><dt>Người nhận</dt><dd><strong>${esc(p.name)||'QR không có tên người nhận'}</strong></dd><dt>Ngân hàng (BIN)</dt><dd>${esc(p.bank)}</dd><dt>Số tài khoản</dt><dd>${esc(p.account)}</dd><dt>Nội dung</dt><dd>${esc(p.content)||'Không có nội dung'}</dd><dt>Phí giao dịch</dt><dd>0 ₫</dd></dl><div class="info">Giao dịch giả lập, không trừ tiền ngân hàng thực tế. Tên người nhận lấy từ QR, chưa được ngân hàng xác minh.</div><button id="confirm" class="primary wide">Xác nhận chuyển tiền</button><button id="rescan" class="text-button wide">Quét mã khác</button></div>`;document.querySelector('#rescan').onclick=()=>navigate('qr');document.querySelector('#confirm').focus({preventScroll:true});if(matchMedia('(max-width:780px)').matches)window.scrollTo(0,0);document.querySelector('#confirm').onclick=e=>task(e.target,async()=>{await api('transfers',{id:p.id});pending=null;document.querySelector('#confirmation').innerHTML='<div class="empty"><span>✓</span><h3>Chuyển tiền thành công</h3><p>Giao dịch giả lập đã được lưu.</p><button id="history" class="primary">Xem lịch sử giao dịch</button></div>';document.querySelector('#history').onclick=()=>{page=1;navigate('transactions');};});};
 document.querySelector('#choose-file').onclick=()=>document.querySelector('#qrfile').click();
 document.querySelector('#parse').onclick=e=>task(e.target,()=>accept(document.querySelector('#raw').value));document.querySelector('#camera').onclick=e=>task(e.currentTarget,async()=>{if(reader?.isScanning){await stopCamera();return;}await stopCamera();reader=new Html5Qrcode('reader');await reader.start({facingMode:'environment'},{fps:10,aspectRatio:1},raw=>{if(pending)return;pending={};accept(raw).catch(e=>{pending=null;toast(e.message);});},()=>{});document.querySelector('#camera').textContent='Tắt camera';document.querySelector('#scan-placeholder').hidden=true;});document.querySelector('#qrfile').onchange=async e=>{if(!e.target.files[0])return;const file=e.target.files[0];e.target.value='';try{await stopCamera();document.querySelector('#scan-placeholder').hidden=false;reader=new Html5Qrcode('reader');await accept(await reader.scanFile(file,false));}catch(e){toast(e.message||'Không đọc được QR từ ảnh.');}};}
function callbackCell(tx) {
 const labels={pending:'Chờ gửi / gửi lại',processing:'Đang gửi',delivered:'Đã xác nhận',failed:'Gửi thất bại'};
 const state=tx.callback_state;
 return `<div><span class="callback-status ${state==='delivered'?'success':state==='failed'?'callback-failed':''}">${esc(labels[state]||'Chưa gửi')}</span>${state?`<small>${tx.callback_attempts||0} lần gửi</small>`:''}${tx.callback_error?`<small class="callback-error">${esc(tx.callback_error)}</small>`:''}${state==='pending'&&tx.callback_next_at?`<small>Gửi từ ${new Date(tx.callback_next_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</small>`:''}${tx.callback_reference?`<small title="Tham chiếu MedDental">${esc(tx.callback_reference)}</small>`:''}${!state||state==='failed'?`<button class="text-button callback-retry" data-retry-callback="${esc(tx.id)}">${state?'Gửi lại':'Gửi callback'}</button>`:''}</div>`;
}
async function settings(){
 const [c,i]=await Promise.all([api('settings'),api('integration')]);
 const secretInput=(name,label,has)=>`<label>${label}<input name="${name}" type="password" autocomplete="new-password" placeholder="${has?'Đã cấu hình · Để trống để giữ nguyên':'Chưa cấu hình'}"></label>`;
 document.querySelector('#content').innerHTML=heading('TÙY CHỈNH','Cài đặt','Quản lý xác thực Telegram và cấu hình giao dịch.')+`
 <form id="settings" class="settings-form">
  <section class="panel form-section"><h2>Xác thực Telegram</h2><p class="muted">OTP đăng nhập sẽ được gửi đến cuộc trò chuyện này.</p>
   ${secretInput('token','Telegram chatbot token',c.hasToken)}
   <label>Chat ID nhận OTP<input name="chatId" value="${esc(c.chatId)}" required><small>Gửi /start cho bot trước khi nhận mã OTP.</small></label>
  </section>
  <section class="panel form-section"><h2>Hạn mức giao dịch</h2><label>Hạn mức chuyển tiền mỗi ngày (VND)<input name="dailyLimit" type="number" step="1" value="${c.dailyLimit}" required><small>0 = không giới hạn. Số âm được quy về 0. Tính theo giờ Việt Nam.</small></label></section>
  <div class="form-footer"><span class="muted">Cấu hình được lưu trong SQLite.</span><button class="primary">Lưu cài đặt</button></div>
 </form>
 <form id="integration" class="settings-form integration-form">
  <section class="panel form-section"><h2>Tích hợp MedDental Payment <span class="count">${i.enabled?'Đang bật':'Đang tắt'}</span></h2>
   <p class="muted">Gửi callback báo tiền vào tài khoản MedDental sau khi xác nhận chuyển tiền. TripleDES-CBC + chữ ký RSA-SHA256.</p>
   <label class="checkbox-label"><input name="enabled" type="checkbox" ${i.enabled?'checked':''}> Bật tự động gửi callback</label>
   <label>URL callback<input name="callbackUrl" type="url" value="${esc(i.callbackUrl)}" placeholder="https://payment.example/api/partner/v1/callbacks"><small>Dùng đầy đủ URL HTTPS do MedDental cung cấp.</small></label>
   <label>Mã đối tác (partner)<input name="partner" value="${esc(i.partner)}" required pattern="[A-Za-z0-9_.-]{1,100}"></label>
   ${secretInput('apiKey','apiKey (64 ký tự hex)',i.hasApiKey)}
   ${secretInput('secretKey','secretKey (64 ký tự hex)',i.hasSecretKey)}
   ${secretInput('tripleDesKey','Khóa TripleDES (base64, 24 byte)',i.hasTripleDesKey)}
   ${secretInput('signSecret','signSecret (nếu hai bên thống nhất)',i.hasSignSecret)}
   <label class="checkbox-label"><input name="clearSignSecret" type="checkbox"> Xóa signSecret đã lưu</label>
  </section>
  <section class="panel form-section"><h2>Khóa RSA đối tác (ngân hàng)</h2>
   <p class="muted">Khóa riêng ở lại máy chủ, không trả về trình duyệt. Chỉ gửi khóa công khai cho MedDental. Khi đổi khóa cần thống nhất với MedDental trước.</p>
   <label>Nhập khóa riêng RSA (.pem)<input name="partnerPrivateKeyFile" type="file" accept=".pem,text/plain"><small>${i.hasPartnerPrivateKey?'Đã có khóa riêng. Không chọn file để giữ nguyên.':'Chưa có khóa riêng. Nhập file PEM hoặc tạo cặp khóa mới bên dưới.'}</small></label>
   ${!i.hasPartnerPrivateKey?'<button type="button" id="generate-key" class="secondary">Tạo cặp khóa RSA 2048 bit</button>':''}
   ${i.partnerPublicKey?`<label>Khóa công khai gửi MedDental<textarea rows="6" readonly class="key-preview">${esc(i.partnerPublicKey)}</textarea></label><button type="button" id="download-key" class="secondary">Tải partner-public.pem</button>`:''}
   <label>Nhập khóa công khai MedDental (.pem)<input name="meddentalPublicKeyFile" type="file" accept=".pem,text/plain"><small>${i.hasMeddentalPublicKey?'Đã cấu hình. Không chọn file để giữ nguyên.':'Dùng khóa MedDental cung cấp để xác minh chữ ký phản hồi.'}</small></label>
  </section>
  <div class="info">Callback được lưu hàng đợi cùng giao dịch. Lỗi kết nối/lỗi tạm thời được gửi lại trong tối đa 24 giờ. Xem trạng thái, tham chiếu và gửi lại thủ công tại Lịch sử giao dịch. Tắt tích hợp sẽ tạm dừng hàng đợi và không tạo callback cho giao dịch mới.</div>
  <div class="form-footer"><span class="muted">Để trống trường bí mật để giữ giá trị đã lưu.</span><button class="primary">Lưu tích hợp</button></div>
 </form>`;
 document.querySelector('#settings').onsubmit=e=>{e.preventDefault();task(e.submitter,async()=>{
  const data=Object.fromEntries(new FormData(e.target));data.dailyLimit=Number(data.dailyLimit);
  await api('settings',data,'PUT');toast('Đã lưu cài đặt.');await settings();
 });};
 async function integrationData(){
  const form=document.querySelector('#integration');
  const data=Object.fromEntries(new FormData(form));
  data.enabled=form.elements.enabled.checked;data.clearSignSecret=form.elements.clearSignSecret.checked;
  for(const name of ['partnerPrivateKey','meddentalPublicKey']){
   const file=form.elements[name+'File'].files[0];
   if(file&&file.size>16000)throw new Error('File khóa quá lớn (tối đa 16 KB).');
   data[name]=file?await file.text():'';delete data[name+'File'];
  }
  return data;
 }
 document.querySelector('#integration').onsubmit=e=>{e.preventDefault();task(e.submitter,async()=>{
  await api('integration',await integrationData(),'PUT');toast('Đã lưu tích hợp MedDental.');await settings();
 });};
 document.querySelector('#generate-key')?.addEventListener('click',e=>task(e.target,async()=>{
  // Preserve unfinished fields before re-rendering. Key generation does not enable delivery.
  const data=await integrationData();data.enabled=false;
  await api('integration',data,'PUT');await api('integration/keypair',{});toast('Đã tạo khóa. Tải khóa công khai và gửi MedDental.');await settings();
 }));
 document.querySelector('#download-key')?.addEventListener('click',()=>{
  const url=URL.createObjectURL(new Blob([i.partnerPublicKey],{type:'application/x-pem-file'}));
  const link=document.createElement('a');link.href=url;link.download='partner-public.pem';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
}

try{const s=await api('session');if(s.authenticated)await shell();else login(false,s.configured);}catch(e){root.textContent='Không kết nối được máy chủ. Vui lòng tải lại trang.';}
