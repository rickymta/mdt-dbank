# Hướng dẫn tích hợp callback báo tiền về — MedDental Payment

Tài liệu này dành cho **đối tác (ngân hàng / trung gian thanh toán)**. Mỗi khi có tiền chuyển vào tài khoản của MedDental,
đối tác gọi một request tới MedDental Payment để báo giao dịch đó. MedDental dùng nội dung chuyển khoản để khớp với đơn
cần thu.

Mỗi request được bảo vệ **2 lớp**:
- **TripleDES**: mã hoá nội dung, người ngoài không đọc được.
- **RSA**: chữ ký số, người ngoài không giả mạo hay sửa được.

Response của MedDental cũng được mã hoá và ký theo đúng cách đó.

```
 Đối tác                                                     MedDental Payment
   │  POST /api/partner/v1/callbacks                                │
   │  header: apiKey, secretKey                                     │
   │  body:   { data, partner, requestTime, sign } ───────────────▶ │  kiểm khoá → kiểm giờ → kiểm chữ ký
   │                                                                │  → giải mã → ghi nhận giao dịch
   │ ◀─────────────── { data, partner, responseTime, sign }         │  (response cũng mã hoá + ký)
```

---

## 1. Thông tin trao đổi trước khi kết nối

**MedDental gửi đối tác** (qua kênh an toàn, không gửi chung một email):

| Thông tin | Ví dụ / ghi chú |
|---|---|
| URL endpoint | `https://<địa chỉ MedDental cung cấp>/api/partner/v1/callbacks` |
| Mã đối tác `partner` | `mdt-d-bank` |
| `apiKey`, `secretKey` | 2 chuỗi 64 ký tự hex — đặt vào header |
| Khoá TripleDES | chuỗi base64 (24 byte) — dùng mã hoá / giải mã `data` |
| Khoá công khai RSA của MedDental | file PEM `-----BEGIN PUBLIC KEY-----` — dùng kiểm chữ ký response |
| `signSecret` *(chỉ khi hai bên thống nhất dùng)* | chuỗi bí mật nối vào cuối chuỗi ký |

**Đối tác gửi MedDental**: **khoá công khai RSA** (2048 bit trở lên) của đối tác. Đối tác tự sinh cặp khoá và **giữ kín khoá
riêng**:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out partner-private.pem   # GIỮ KÍN
openssl pkey -in partner-private.pem -pubout -out partner-public.pem                    # gửi MedDental
```
Nếu đối tác chưa tự sinh được, MedDental có thể sinh hộ và giao khoá riêng **một lần**; MedDental không lưu lại khoá riêng đó.

---

## 2. Gửi một callback — 5 bước

**Bước 1 — Dựng JSON giao dịch** (chi tiết các trường ở mục 3):
```json
{"transactionId":"FT2631700123","amount":150000,"direction":"in","transactionTime":"20261113094800","accountNumber":"0123456789","content":"MDT YC0000123"}
```

**Bước 2 — Mã hoá thành `data`** bằng TripleDES:
- thuật toán `DES-EDE3`, chế độ **CBC**, padding **PKCS#7** (Java gọi là `PKCS5Padding`);
- sinh **IV ngẫu nhiên 8 byte cho mỗi request**;
- `data = base64( IV (8 byte) + bản mã )`, tức IV đặt ngay trước bản mã rồi mã base64 cả chuỗi.

**Bước 3 — Lấy giờ gửi `requestTime`**: định dạng `yyyyMMddHHmmss`, theo **giờ Việt Nam (UTC+7)**, không ghi múi giờ.
Ví dụ: `20261113094852`. Đồng hồ máy chủ phải đồng bộ NTP, vì request lệch quá 5 phút sẽ bị từ chối.

**Bước 4 — Ký thành `sign`**:
- chuỗi ký là `data|partner|requestTime`, ba giá trị nối bằng dấu `|`; `data` dùng đúng chuỗi base64 ở bước 2;
- nếu có `signSecret` thì nối thêm vào cuối: `data|partner|requestTime|signSecret`;
- ký **RSA PKCS#1 v1.5 + SHA-256** trên byte UTF-8 của chuỗi ký, bằng **khoá riêng của đối tác**, rồi mã base64.

**Bước 5 — Gửi request**:
```http
POST /api/partner/v1/callbacks
Content-Type: application/json
apiKey: <apiKey>
secretKey: <secretKey>

{"data":"<bước 2>","partner":"mdt-d-bank","requestTime":"<bước 3>","sign":"<bước 4>"}
```

---

## 3. JSON giao dịch (nội dung bên trong `data`)

| Trường | Bắt buộc | Mô tả |
|---|---|---|
| `transactionId` | ✔ | Mã giao dịch **duy nhất** phía đối tác (≤ 100 ký tự). MedDental dùng mã này để chống ghi trùng. |
| `amount` | ✔ | Số tiền VND, số nguyên dương. |
| `transactionTime` | ✔ | Thời điểm ngân hàng ghi nhận, `yyyyMMddHHmmss` giờ Việt Nam. |
| `content` | nên có | Nội dung chuyển khoản **nguyên văn** của người chuyển. MedDental tìm mã đơn (vd `YC0000123`) trong đây. |
| `accountNumber` | nên có | Số tài khoản **nhận** tiền của MedDental. |
| `direction` | | `in` (tiền vào, mặc định) hoặc `out` (tiền ra; chỉ ghi nhận, không xử lý). |
| `bankRef` | | Mã tham chiếu ngân hàng (FT…); bỏ trống thì lấy theo `transactionId`. |
| `bankCode` | | Mã ngân hàng. |
| `virtualAccount` | | Tài khoản ảo, nếu có. |

Gửi nhiều giao dịch trong một request (tối đa 100) bằng dạng `{"transactions":[ {...}, {...} ]}`.

---

## 4. Đọc response

Nếu MedDental đã xác định được đối tác, nghĩa là `partner` hợp lệ và `apiKey`/`secretKey` đúng, response có cùng khuôn với
request:
```json
{"data":"…","partner":"mdt-d-bank","responseTime":"20261113094853","sign":"…"}
```
Đối tác làm theo đúng thứ tự:
1. **Kiểm chữ ký trước**: chuỗi `data|partner|responseTime` (thêm `|signSecret` nếu có), dùng **khoá công khai của MedDental**. Sai
   chữ ký thì bỏ qua response đó.
2. **Giải mã `data`** bằng khoá TripleDES: 8 byte đầu là IV, phần còn lại là bản mã. Kết quả có dạng:

```json
{"code":"00","message":"Thành công","requestTime":"20261113094852",
 "results":[{"transactionId":"FT2631700123","status":"accepted","referenceId":"64637ea4-7e29-4ec9-9886-ce07cf4303c0"}]}
```
- `status = accepted`: ghi nhận lần đầu. `status = duplicate`: đã nhận từ trước. **Cả hai đều là thành công.**
- `requestTime`: lặp lại giá trị đối tác đã gửi, để ghép response với request.
- `referenceId`: mã tham chiếu phía MedDental, dùng khi đối soát.

Nếu MedDental **chưa xác định được đối tác** (mã `04`, `05`), response là JSON thường, không mã hoá: `{"code":"05","message":"Sai apiKey hoặc secretKey."}`.

| `code` | HTTP | Ý nghĩa | Đối tác xử lý |
|---|---|---|---|
| `00` | 200 | Thành công | Xong |
| `01` | 400 | Sai định dạng (thiếu trường, JSON lỗi, số tiền không hợp lệ…) | Sửa dữ liệu rồi gửi lại |
| `02` | 401 | Chữ ký sai hoặc không giải mã được `data` | Kiểm khoá RSA, khoá TripleDES, `signSecret`, chuỗi ký |
| `03` | 401 | `requestTime` sai định dạng hoặc lệch quá 5 phút | Đồng bộ đồng hồ, gửi lại với giờ mới |
| `04` | 401 | Mã đối tác không tồn tại, đang tạm khoá hoặc chưa cấu hình đủ | Liên hệ MedDental |
| `05` | 401 | Sai `apiKey` / `secretKey` | Kiểm header |
| `99` | 500 | Lỗi hệ thống MedDental | **Gửi lại sau** vài phút |

**Khi nào gửi lại?** Gặp timeout, mất kết nối, mã `99`, hoặc HTTP 5xx thì gửi lại cùng giao dịch. Mỗi lần gửi lại phải có
`requestTime` mới, `sign` mới và IV mới. Gửi lại không bao giờ gây ghi trùng: giao dịch đã nhận sẽ trả `duplicate`. Gợi ý lịch
thử lại: 1 phút, 5 phút, 15 phút, 1 giờ, rồi mỗi giờ cho đến hết 24 giờ.

---

## 5. Mã mẫu

Mỗi ngôn ngữ gồm 4 hàm: `encryptData`, `decryptData`, `sign`, `verify`. Ghép lại theo mục 2 và mục 4.

### C# (.NET 6+)
```csharp
using System.Security.Cryptography;
using System.Text;

static string EncryptData(string json, string keyB64)
{
    using var des = TripleDES.Create(); des.Key = Convert.FromBase64String(keyB64);
    var iv = RandomNumberGenerator.GetBytes(8);
    var cipher = des.EncryptCbc(Encoding.UTF8.GetBytes(json), iv, PaddingMode.PKCS7);
    return Convert.ToBase64String([.. iv, .. cipher]);
}
static string DecryptData(string dataB64, string keyB64)
{
    var raw = Convert.FromBase64String(dataB64);
    using var des = TripleDES.Create(); des.Key = Convert.FromBase64String(keyB64);
    return Encoding.UTF8.GetString(des.DecryptCbc(raw.AsSpan(8), raw.AsSpan(0, 8), PaddingMode.PKCS7));
}
static string Sign(string text, string privateKeyPem)
{
    using var rsa = RSA.Create(); rsa.ImportFromPem(privateKeyPem);
    return Convert.ToBase64String(rsa.SignData(Encoding.UTF8.GetBytes(text), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
}
static bool Verify(string text, string signB64, string publicKeyPem)
{
    using var rsa = RSA.Create(); rsa.ImportFromPem(publicKeyPem);
    return rsa.VerifyData(Encoding.UTF8.GetBytes(text), Convert.FromBase64String(signB64), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
}
static string VnTime() => DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(7)).ToString("yyyyMMddHHmmss");
```

### Java (8+)
```java
import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.Base64;

static String encryptData(String json, String keyB64) throws Exception {
    byte[] iv = new byte[8]; new SecureRandom().nextBytes(iv);
    Cipher c = Cipher.getInstance("DESede/CBC/PKCS5Padding");
    c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(Base64.getDecoder().decode(keyB64), "DESede"), new IvParameterSpec(iv));
    byte[] ct = c.doFinal(json.getBytes(StandardCharsets.UTF_8));
    byte[] out = new byte[8 + ct.length];
    System.arraycopy(iv, 0, out, 0, 8); System.arraycopy(ct, 0, out, 8, ct.length);
    return Base64.getEncoder().encodeToString(out);
}
static String decryptData(String dataB64, String keyB64) throws Exception {
    byte[] raw = Base64.getDecoder().decode(dataB64);
    Cipher c = Cipher.getInstance("DESede/CBC/PKCS5Padding");
    c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(Base64.getDecoder().decode(keyB64), "DESede"), new IvParameterSpec(raw, 0, 8));
    return new String(c.doFinal(raw, 8, raw.length - 8), StandardCharsets.UTF_8);
}
static byte[] pem(String pem) { return Base64.getMimeDecoder().decode(pem.replaceAll("-----[A-Z ]+-----", "")); }
static PrivateKey privateKey(String pkcs8Pem) throws Exception {
    return KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(pem(pkcs8Pem)));   // "BEGIN PRIVATE KEY"
}
static PublicKey publicKey(String spkiPem) throws Exception {
    return KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(pem(spkiPem)));     // "BEGIN PUBLIC KEY"
}
static String sign(String text, PrivateKey key) throws Exception {
    Signature s = Signature.getInstance("SHA256withRSA"); s.initSign(key);
    s.update(text.getBytes(StandardCharsets.UTF_8));
    return Base64.getEncoder().encodeToString(s.sign());
}
static boolean verify(String text, String signB64, PublicKey key) throws Exception {
    Signature s = Signature.getInstance("SHA256withRSA"); s.initVerify(key);
    s.update(text.getBytes(StandardCharsets.UTF_8));
    return s.verify(Base64.getDecoder().decode(signB64));
}
static String vnTime() {
    return ZonedDateTime.now(ZoneId.of("Asia/Ho_Chi_Minh")).format(DateTimeFormatter.ofPattern("yyyyMMddHHmmss"));
}
```

### Node.js (16+)
```js
const crypto = require('crypto');

function encryptData(json, keyB64) {
  const iv = crypto.randomBytes(8);
  const c = crypto.createCipheriv('des-ede3-cbc', Buffer.from(keyB64, 'base64'), iv);
  return Buffer.concat([iv, c.update(json, 'utf8'), c.final()]).toString('base64');
}
function decryptData(dataB64, keyB64) {
  const raw = Buffer.from(dataB64, 'base64');
  const d = crypto.createDecipheriv('des-ede3-cbc', Buffer.from(keyB64, 'base64'), raw.subarray(0, 8));
  return Buffer.concat([d.update(raw.subarray(8)), d.final()]).toString('utf8');
}
const sign = (text, privateKeyPem) => crypto.sign('sha256', Buffer.from(text, 'utf8'), privateKeyPem).toString('base64');
const verify = (text, signB64, publicKeyPem) =>
  crypto.verify('sha256', Buffer.from(text, 'utf8'), publicKeyPem, Buffer.from(signB64, 'base64'));
const vnTime = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
```

### PHP (7.2+, extension openssl)
```php
function encryptData(string $json, string $keyB64): string {
    $iv = random_bytes(8);
    $ct = openssl_encrypt($json, 'des-ede3-cbc', base64_decode($keyB64), OPENSSL_RAW_DATA, $iv);
    return base64_encode($iv . $ct);
}
function decryptData(string $dataB64, string $keyB64): string {
    $raw = base64_decode($dataB64);
    return openssl_decrypt(substr($raw, 8), 'des-ede3-cbc', base64_decode($keyB64), OPENSSL_RAW_DATA, substr($raw, 0, 8));
}
function signText(string $text, string $privateKeyPem): string {
    openssl_sign($text, $sig, $privateKeyPem, OPENSSL_ALGO_SHA256);
    return base64_encode($sig);
}
function verifyText(string $text, string $signB64, string $publicKeyPem): bool {
    return openssl_verify($text, base64_decode($signB64), $publicKeyPem, OPENSSL_ALGO_SHA256) === 1;
}
function vnTime(): string { return (new DateTime('now', new DateTimeZone('Asia/Ho_Chi_Minh')))->format('YmdHis'); }
```

### Ghép lại (giả mã)
```text
data        = encryptData(jsonGiaoDich, KHOA_TRIPLEDES)
requestTime = vnTime()
sign        = sign(data + "|" + PARTNER + "|" + requestTime [+ "|" + SIGN_SECRET], KHOA_RIENG_DOI_TAC)
POST URL, header apiKey/secretKey, body {data, partner: PARTNER, requestTime, sign}

// response
if !verify(resp.data + "|" + resp.partner + "|" + resp.responseTime [+ "|" + SIGN_SECRET], resp.sign, KHOA_CONG_KHAI_MEDDENTAL): bỏ qua
ketQua = JSON.parse(decryptData(resp.data, KHOA_TRIPLEDES))   // ketQua.code == "00" là xong
```

---

## 6. Số liệu mẫu để tự kiểm phần mã hoá

Dùng số liệu dưới đây, **chỉ để kiểm thử**, để chắc chắn hàm TripleDES của đối tác cho ra đúng kết quả của MedDental. Khi chạy
thật **luôn sinh IV ngẫu nhiên**, không dùng IV cố định này.

| | Giá trị |
|---|---|
| Khoá TripleDES (base64) | `TWVkRGVudGFsVHJpcGxlRGVzS2V5MjRC` |
| IV (8 byte) | `01 02 03 04 05 06 07 08` (base64 `AQIDBAUGBwg=`) |
| JSON | `{"transactionId":"FT2631700123","amount":150000,"direction":"in","transactionTime":"20261113094800","accountNumber":"0123456789","content":"MDT YC0000123"}` |
| `data` đúng | `AQIDBAUGBwiTWwwQcIfB6izpjUnSJgI/iDj8xfaffLrvF8kb/tL9B/s/9N+r/uQm7HS4qtVk1mLkzMyyHD028x1T90xX85yVJJKLM+mP2mQnwYHZOrgobTshspRqtXAc7ClDY8Yu3nGJp+OxGp9SkoSC43gxOMPvPyCYKZ3DOcAY9d90XaLGHyfQWLv+u8Ova992QwvSOAfKPvoyZfZXoHMgrVW9wqm4` |
| Chuỗi ký (với `partner = mdt-d-bank`, `requestTime = 20261113094852`) | `<data đúng ở trên>|mdt-d-bank|20261113094852` |
| Giờ VN của `2026-11-13T02:48:52Z` | `20261113094852` |

Lưu ý:
- JSON phải là chuỗi byte UTF-8 đúng như trên: không xuống dòng, không thêm khoảng trắng.
- Chữ ký RSA không có giá trị mẫu, vì mỗi đối tác có khoá riêng. Đối tác tự kiểm bằng cách ký rồi `verify` lại với khoá công khai của chính mình.

---

## 7. Chạy thử kết nối

1. Nhận đủ thông tin ở mục 1 từ MedDental (môi trường thử nghiệm có khoá riêng, khác khoá chính thức).
2. Gửi một giao dịch tiền ra (`"direction":"out"`, số tiền bất kỳ). Kết quả mong đợi: `code = 00`, `status = accepted`. Giao dịch
   này chỉ được ghi nhận, không ảnh hưởng đơn nào.
3. Gửi lại đúng giao dịch đó, mong đợi `status = duplicate`.
4. Thử sai `secretKey` (`05`), sửa một ký tự của `data` (`02`), lùi `requestTime` 10 phút (`03`) để chắc chắn đối tác xử lý đúng
   các mã lỗi.
5. Báo MedDental kết quả để chuyển sang khoá chính thức.

## 8. Lưu ý bảo mật

- Chỉ gọi qua **HTTPS**. Không ghi `secretKey`, khoá TripleDES, khoá riêng RSA hay `data` đã giải mã vào log.
- Khoá riêng RSA của đối tác **không bao giờ** gửi cho bất kỳ ai, kể cả MedDental.
- **Đổi khoá** (định kỳ, hoặc khi nghi lộ): hai bên hẹn giờ trước. Khoá cũ hết hiệu lực ngay khi MedDental sinh khoá mới.
- Lỗi hay gặp:
  - ký trên JSON gốc thay vì trên chuỗi `data` base64;
  - dùng giờ UTC thay vì giờ Việt Nam;
  - quên nối IV vào trước bản mã;
  - dùng padding khác PKCS#7, hoặc chế độ ECB thay vì CBC;
  - khoá riêng ở dạng `BEGIN RSA PRIVATE KEY` (PKCS#1) trong Java. Đổi sang PKCS#8 bằng
    `openssl pkcs8 -topk8 -nocrypt -in old.pem -out new.pem`.

**Liên hệ kỹ thuật MedDental:** *(MedDental điền đầu mối khi gửi tài liệu)*
