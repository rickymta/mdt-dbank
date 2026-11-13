import {
  constants, createCipheriv, createDecipheriv, createPrivateKey, createPublicKey,
  randomBytes, sign as rsaSign, verify as rsaVerify
} from 'node:crypto';

export function vnTime(date = new Date()) {
  return new Date(date.getTime() + 7 * 3600000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
}
export function validTime(value) {
  if (typeof value !== 'string' || !/^\d{14}$/.test(value)) return false;
  const date = new Date(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(8,10)}:${value.slice(10,12)}:${value.slice(12,14)}+07:00`);
  return Number.isFinite(date.getTime()) && vnTime(date) === value;
}
export function decodeBase64(value) {
  if (typeof value !== 'string' || !value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Base64 không hợp lệ.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error('Base64 không hợp lệ.');
  return bytes;
}
export function tripleKey(value) {
  const key = decodeBase64(value);
  if (key.length !== 24) throw new Error('Khóa TripleDES phải là base64 của đúng 24 byte.');
  return key;
}
export function privateKey(pem) {
  let key;
  try { key = createPrivateKey(pem); } catch { throw new Error('Khóa riêng RSA PEM không hợp lệ.'); }
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) throw new Error('Khóa RSA cần tối thiểu 2048 bit, loại RSA thông thường.');
  return key;
}
export function publicKey(pem) {
  let key;
  try { key = createPublicKey(pem); } catch { throw new Error('Khóa công khai RSA PEM không hợp lệ.'); }
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048 || /PRIVATE KEY/.test(pem)) throw new Error('Cần khóa công khai RSA tối thiểu 2048 bit.');
  return key;
}
export function encryptData(json, keyB64, iv = randomBytes(8)) {
  const cipher = createCipheriv('des-ede3-cbc', tripleKey(keyB64), iv);
  return Buffer.concat([iv, cipher.update(json, 'utf8'), cipher.final()]).toString('base64');
}
export function decryptData(dataB64, keyB64) {
  const bytes = decodeBase64(dataB64);
  if (bytes.length < 16 || (bytes.length - 8) % 8 !== 0) throw new Error('Bản mã TripleDES không hợp lệ.');
  const decipher = createDecipheriv('des-ede3-cbc', tripleKey(keyB64), bytes.subarray(0, 8));
  return Buffer.concat([decipher.update(bytes.subarray(8)), decipher.final()]).toString('utf8');
}
export function signatureText(data, partner, time, secret = '') {
  return [data, partner, time, ...(secret ? [secret] : [])].join('|');
}
export function sign(text, pem) {
  return rsaSign('sha256', Buffer.from(text, 'utf8'), {key: privateKey(pem), padding: constants.RSA_PKCS1_PADDING}).toString('base64');
}
export function verify(text, signature, pem) {
  try { return rsaVerify('sha256', Buffer.from(text, 'utf8'), {key: publicKey(pem), padding: constants.RSA_PKCS1_PADDING}, decodeBase64(signature)); }
  catch { return false; }
}
