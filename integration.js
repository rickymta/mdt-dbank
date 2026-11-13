import {createPublicKey, generateKeyPairSync} from 'node:crypto';
import {db, integrationSettings, settings, enqueueCallback} from './db.js';
import {vnTime, validTime, tripleKey, privateKey, publicKey, encryptData, decryptData, signatureText, sign, verify} from './integration-crypto.js';

const DAY = 24 * 3600000;
const secretFields = ['apiKey', 'secretKey', 'tripleDesKey', 'partnerPrivateKey', 'meddentalPublicKey', 'signSecret'];
function endpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('URL callback không hợp lệ.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Callback cần URL HTTPS, không có user/password hoặc fragment.');
  return url.href;
}
export function integrationView() {
  const c = integrationSettings();
  const flags = Object.fromEntries(secretFields.map(key => ['has' + key[0].toUpperCase() + key.slice(1), Boolean(c[key])]));
  const partnerPublicKey = c.partnerPrivateKey ? createPublicKey(c.partnerPrivateKey).export({type:'spki',format:'pem'}) : '';
  return {enabled: Boolean(c.enabled), partner: c.partner || 'mdt-d-bank', callbackUrl: settings().callback_url, ...flags, partnerPublicKey};
}
export function saveIntegration(input) {
  if (!input || typeof input.enabled !== 'boolean' || typeof input.partner !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(input.partner)) throw new Error('Mã đối tác hoặc trạng thái tích hợp không hợp lệ.');
  const config = {...integrationSettings(), enabled: input.enabled, partner: input.partner};
  for (const field of secretFields) {
    if (input[field] !== undefined && (typeof input[field] !== 'string' || input[field].length > 16000)) throw new Error('Trường khóa tích hợp không hợp lệ.');
    // An empty field preserves the stored value. signSecret is explicitly removable.
    if (input[field]?.trim()) config[field] = field === 'signSecret' ? input[field] : input[field].trim();
  }
  if (input.clearSignSecret === true) config.signSecret = '';
  for (const key of ['apiKey','secretKey']) if (config[key] && !/^[a-fA-F0-9]{64}$/.test(config[key])) throw new Error(`${key} phải có đúng 64 ký tự hex.`);
  if (config.tripleDesKey) tripleKey(config.tripleDesKey);
  if (config.partnerPrivateKey) privateKey(config.partnerPrivateKey);
  if (config.meddentalPublicKey) publicKey(config.meddentalPublicKey);
  if (config.signSecret && /[\r\n]/.test(config.signSecret)) throw new Error('signSecret không được chứa xuống dòng.');
  const url = input.callbackUrl;
  if (typeof url !== 'string' || url.length > 2048) throw new Error('URL callback không hợp lệ.');
  if (url) endpoint(url);
  if (config.enabled && (!url || secretFields.slice(0,5).some(key => !config[key]))) throw new Error('Điền đầy đủ URL, apiKey, secretKey, TripleDES và hai khóa RSA trước khi bật callback.');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE integration_settings SET config=? WHERE id=1').run(JSON.stringify(config));
    db.prepare('UPDATE settings SET callback_url=? WHERE id=1').run(url);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return integrationView();
}
export function generatePartnerKey() {
  if (integrationSettings().partnerPrivateKey) throw new Error('Đã có khóa riêng RSA. Tải khóa công khai hiện tại hoặc nhập khóa thay thế khi hai bên đã thống nhất.');
  const pair = generateKeyPairSync('rsa', {modulusLength:2048, privateKeyEncoding:{type:'pkcs8',format:'pem'}, publicKeyEncoding:{type:'spki',format:'pem'}});
  const config = {...integrationSettings(), partnerPrivateKey:pair.privateKey};
  db.prepare('UPDATE integration_settings SET config=? WHERE id=1').run(JSON.stringify(config));
  return {partnerPublicKey:pair.publicKey};
}
export function transactionPayload(tx) {
  return {transactionId:tx.id, amount:tx.amount, direction:'in', transactionTime:vnTime(new Date(tx.created_at)), accountNumber:tx.account, content:tx.content, bankRef:tx.id, bankCode:tx.bank};
}
class CallbackError extends Error {
  constructor(message, retryable = true, code = null) { super(message); this.retryable=retryable; this.code=code; }
}
const codeMessages = {'01':'Dữ liệu callback bị từ chối (01).','02':'Khóa hoặc chữ ký callback bị từ chối (02).','03':'Thời gian gửi callback bị từ chối (03).','04':'Mã đối tác chưa hợp lệ hoặc bị khóa (04).','05':'apiKey hoặc secretKey bị từ chối (05).','99':'Hệ thống MedDental tạm thời bị lỗi (99).'};
async function readResponse(response) {
  // Bound the response including streaming/chunked bodies; do not persist decrypted payloads.
  if (Number(response.headers.get('content-length') || 0) > 65536) throw new CallbackError('Phản hồi callback quá lớn.');
  let text = '';
  const decoder = new TextDecoder();
  let size = 0;
  for await (const bytes of response.body || []) {
    size += bytes.length;
    if (size > 65536) throw new CallbackError('Phản hồi callback quá lớn.');
    text += decoder.decode(bytes,{stream:true});
  }
  text += decoder.decode();
  try { return JSON.parse(text); } catch { throw new CallbackError('Phản hồi callback không phải JSON hợp lệ.'); }
}
export async function deliverCallback(tx, config, url, fetcher = globalThis.fetch, now = new Date()) {
  const requestTime = vnTime(now);
  const data = encryptData(JSON.stringify(transactionPayload(tx)), config.tripleDesKey);
  const body = {data, partner:config.partner, requestTime, sign:sign(signatureText(data,config.partner,requestTime,config.signSecret),config.partnerPrivateKey)};
  const response = await fetcher(endpoint(url), {
    method:'POST', redirect:'error', signal:AbortSignal.timeout(15000),
    headers:{'Content-Type':'application/json', apiKey:config.apiKey, secretKey:config.secretKey}, body:JSON.stringify(body)
  });
  // 5xx responses are retried even if an upstream gateway sends HTML or empty data.
  if (response.status >= 500) throw new CallbackError('Máy chủ callback trả lỗi HTTP 5xx.');
  const envelope = await readResponse(response);
  if (response.status === 401 && ['04','05'].includes(envelope?.code) && envelope.data === undefined) throw new CallbackError(codeMessages[envelope.code],false,envelope.code);
  if (!envelope || envelope.partner !== config.partner || !validTime(envelope.responseTime) || typeof envelope.data !== 'string' || envelope.data.length > 65536 || !verify(signatureText(envelope.data,envelope.partner,envelope.responseTime,config.signSecret),envelope.sign,config.meddentalPublicKey)) throw new CallbackError('Không xác minh được chữ ký hoặc đối tác của phản hồi.');
  let result;
  try { result = JSON.parse(decryptData(envelope.data,config.tripleDesKey)); } catch { throw new CallbackError('Không giải mã được phản hồi đã ký.'); }
  if (!result || result.requestTime !== requestTime) throw new CallbackError('Phản hồi không khớp requestTime đã gửi.');
  if (result.code !== '00') {
    if (!Object.hasOwn(codeMessages,result.code)) throw new CallbackError('Mã phản hồi callback không hợp lệ.');
    throw new CallbackError(codeMessages[result.code],['03','99'].includes(result.code),result.code);
  }
  const match = Array.isArray(result.results) && result.results.length === 1 ? result.results[0] : null;
  if (response.status !== 200 || !match || match.transactionId !== tx.id || !['accepted','duplicate'].includes(match.status) || typeof match.referenceId !== 'string' || !match.referenceId || match.referenceId.length > 200) throw new CallbackError('Kết quả callback không khớp giao dịch đã gửi.');
  return {status:match.status, referenceId:match.referenceId};
}
export function retryCallback(id, now = Date.now()) {
  if (!integrationSettings().enabled) throw new Error('Cần bật tích hợp callback trước khi gửi.');
  if (!db.prepare('SELECT id FROM transactions WHERE id=?').get(id)) throw new Error('Không tìm thấy giao dịch.');
  const job = db.prepare('SELECT * FROM callback_jobs WHERE transaction_id=?').get(id);
  if (job?.state === 'processing') throw new Error('Callback đang gửi, vui lòng đợi.');
  if (job?.state === 'delivered') throw new Error('Callback đã được MedDental xác nhận.');
  // Explicit operator retry opens a new 24-hour retry window, keeping the same transaction ID.
  if (job) db.prepare("UPDATE callback_jobs SET state='pending',attempts=0,next_at=?,created_at=?,last_error=NULL,last_code=NULL WHERE transaction_id=?").run(now,now,id);
  else enqueueCallback(id,now);
}
export function createCallbackWorker({fetcher = (...args) => globalThis.fetch(...args), clock = () => Date.now()} = {}) {
  let busy = false;
  let timer;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const now = clock();
      db.prepare("UPDATE callback_jobs SET state='failed',last_error='Đã hết thời gian tự gửi lại 24 giờ.' WHERE state='pending' AND created_at<=?").run(now-DAY);
      const config = integrationSettings();
      if (!config.enabled) return;
      const job = db.prepare("SELECT * FROM callback_jobs WHERE state='pending' AND next_at<=? ORDER BY next_at LIMIT 1").get(now);
      if (!job) return;
      const claimed = db.prepare("UPDATE callback_jobs SET state='processing',attempts=attempts+1 WHERE transaction_id=? AND state='pending'").run(job.transaction_id);
      if (!claimed.changes) return;
      const tx = db.prepare('SELECT * FROM transactions WHERE id=?').get(job.transaction_id);
      try {
        const result = await deliverCallback(tx,config,settings().callback_url,fetcher,new Date(now));
        db.prepare("UPDATE callback_jobs SET state='delivered',last_code='00',last_error=NULL,reference_id=?,result_status=?,delivered_at=? WHERE transaction_id=?").run(result.referenceId,result.status,clock(),tx.id);
      } catch (error) {
        const attempt = job.attempts + 1;
        const delay = [60000,300000,900000][attempt-1] || 3600000;
        const nextAt = clock() + delay;
        const retry = error.retryable !== false && nextAt < job.created_at + DAY;
        // Never copy remote error bodies, credentials or raw network errors into logs/UI.
        const message = error instanceof CallbackError ? error.message : 'Không gửi được callback (mất kết nối, timeout hoặc cấu hình khóa không hợp lệ).';
        db.prepare('UPDATE callback_jobs SET state=?,next_at=?,last_code=?,last_error=? WHERE transaction_id=?').run(retry?'pending':'failed',nextAt,error instanceof CallbackError?error.code:null,message,job.transaction_id);
      }
    } finally { busy = false; }
  }
  return {
    tick,
    start() {
      // A single app instance owns this durable queue; recover interrupted deliveries on startup.
      db.prepare("UPDATE callback_jobs SET state='pending' WHERE state='processing'").run();
      timer = setInterval(() => tick().catch(() => console.error('Callback worker: không xử lý được hàng đợi SQLite.')),1000);
      timer.unref();
    },
    stop() { clearInterval(timer); }
  };
}
