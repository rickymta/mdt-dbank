import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
mkdirSync('data', { recursive: true });
export const db = new DatabaseSync(process.env.DB_PATH || 'data/bank.sqlite');
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL DEFAULT '', chat_id TEXT NOT NULL DEFAULT '', daily_limit INTEGER NOT NULL DEFAULT 0, callback_url TEXT NOT NULL DEFAULT ''); INSERT OR IGNORE INTO settings(id) VALUES(1); CREATE TABLE IF NOT EXISTS transactions(id TEXT PRIMARY KEY, bank TEXT NOT NULL, account TEXT NOT NULL, name TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), content TEXT NOT NULL, created_at TEXT NOT NULL, day TEXT NOT NULL);`);
// Additive migration: existing settings and transactions remain unchanged.
db.exec(`CREATE TABLE IF NOT EXISTS integration_settings (
  id INTEGER PRIMARY KEY CHECK(id=1), config TEXT NOT NULL
);
INSERT OR IGNORE INTO integration_settings VALUES(1, '{"enabled":false,"partner":"mdt-d-bank"}');
CREATE TABLE IF NOT EXISTS callback_jobs (
  transaction_id TEXT PRIMARY KEY REFERENCES transactions(id),
  state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
  last_code TEXT, last_error TEXT, reference_id TEXT, result_status TEXT,
  delivered_at INTEGER
);
CREATE INDEX IF NOT EXISTS callback_due ON callback_jobs(state,next_at);`);
export function integrationSettings() {
  return JSON.parse(db.prepare('SELECT config FROM integration_settings WHERE id=1').get().config);
}
export function enqueueCallback(id, now = Date.now()) {
  if (!integrationSettings().enabled) return;
  db.prepare('INSERT OR IGNORE INTO callback_jobs(transaction_id,next_at,created_at) VALUES(?,?,?)').run(id,now,now);
}
export function settings() { return db.prepare('SELECT * FROM settings WHERE id=1').get(); }
export function dayKey(date = new Date()) { return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(date); }
export function limitValue(value) { const n=Number(value); if (!Number.isSafeInteger(n)) throw new Error('Hạn mức phải là số nguyên hợp lệ.'); return Math.max(0,n); }
export function transfer(input, id) {
 const {bank,account,name='',content='',amount}=input;
 if (typeof bank!=='string'||!bank.trim()||typeof account!=='string'||!/^\d{1,40}$/.test(account)||typeof name!=='string'||typeof content!=='string'||name.length>200||content.length>500||!Number.isSafeInteger(amount)||amount<=0) throw new Error('Thông tin chuyển tiền không hợp lệ.');
 db.exec('BEGIN IMMEDIATE');
 try {
  const existing=db.prepare('SELECT * FROM transactions WHERE id=?').get(id);
  if(existing) { db.exec('COMMIT'); return existing; }
  const day=dayKey(), limit=settings().daily_limit;
  const spent=db.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE day=?').get(day).total;
  if(limit>0&&spent+amount>limit) throw new Error('Giao dịch vượt hạn mức chuyển tiền trong ngày.');
  const tx={id,bank:bank.trim(),account,name,amount,content,created_at:new Date().toISOString(),day};
  db.prepare('INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?)').run(...Object.values(tx));
  enqueueCallback(id);
  db.exec('COMMIT'); return tx;
 } catch(e) { db.exec('ROLLBACK'); throw e; }
}
