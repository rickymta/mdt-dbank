// VietQR / EMVCo TLV parser with CRC validation.
export function crc16(text) { let crc=0xffff; for(const byte of new TextEncoder().encode(text)){crc^=byte<<8;for(let i=0;i<8;i++)crc=(crc&0x8000)?(crc<<1)^0x1021:crc<<1;crc&=0xffff;}return crc.toString(16).toUpperCase().padStart(4,'0'); }
function tlv(raw) { const result={}; let p=0; while(p<raw.length){const id=raw.slice(p,p+2),len=raw.slice(p+2,p+4);if(!/^\d{2}$/.test(id)||!/^\d{2}$/.test(len)||p+4+Number(len)>raw.length)throw new Error('Dữ liệu QR không hợp lệ.');if(id in result)throw new Error('Dữ liệu QR bị trùng trường.'); result[id]=raw.slice(p+4,p+4+Number(len));p+=4+Number(len);}return result; }
export function parseQR(raw) {
 if(typeof raw!=='string'||raw.length>5000)throw new Error('QR không hợp lệ.');
 raw=raw.trim(); const fields=tlv(raw);
 if(!/6304[0-9A-Fa-f]{4}$/.test(raw)||crc16(raw.slice(0,-4))!==raw.slice(-4).toUpperCase())throw new Error('Mã QR sai checksum.');
 const merchant=tlv(fields['38']||'');
 if(merchant['00']!=='A000000727'||fields['53']!=='704'||fields['58']!=='VN')throw new Error('Chỉ hỗ trợ VietQR chuyển khoản VND.');
 const receiver=tlv(merchant['01']||'');const amount=Number(fields['54']);
 if(!receiver['00']||!/^\d{1,40}$/.test(receiver['01']||'')||!Number.isSafeInteger(amount)||amount<=0)throw new Error('QR cần có tài khoản nhận và số tiền VND nguyên lớn hơn 0.');
 return {bank:receiver['00'],account:receiver['01'],name:fields['59']||'',amount,content:fields['62']?tlv(fields['62'])['08']||'':''};
}
