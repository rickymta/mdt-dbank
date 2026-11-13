# Cấu hình callback MedDental Payment

Ứng dụng đóng vai **đối tác/ngân hàng gửi callback**, theo [tài liệu đối tác](../huong-dan-tich-hop-doi-tac.md). Endpoint nhận callback nằm ở MedDental Payment, không phải `dbank.antblog.xyz`. Không tạo endpoint nhận `/api/partner/v1/callbacks` ở ngân hàng.

## Cấu hình trong ứng dụng

1. Đăng nhập bằng tài khoản `meddental` và OTP Telegram. Mở **Cài đặt → Tích hợp MedDental Payment**.
2. Điền đầy đủ URL HTTPS MedDental cung cấp, ví dụ `https://payment.example/api/partner/v1/callbacks`; mã đối tác mặc định `mdt-d-bank` (dùng đúng mã MedDental đã cấp).
3. Điền `apiKey` và `secretKey`, mỗi giá trị 64 ký tự hex; khóa TripleDES là base64 của đúng 24 byte. Khóa ví dụ trong tài liệu chỉ dùng kiểm thử, không tự dùng làm cấu hình mặc định.
4. **Khóa riêng RSA của ngân hàng**: chọn file PEM có sẵn, hoặc bấm **Tạo cặp khóa RSA 2048 bit**. Việc tạo khóa lưu cấu hình đang nhập ở trạng thái tắt để hoàn tất trao đổi khóa trước khi gửi. Nếu đã có khóa, nút tạo không xuất hiện; nhập file mới chỉ khi đã thống nhất đổi khóa với MedDental.
5. Sau khi tạo hoặc lưu khóa riêng, bấm **Tải partner-public.pem** để gửi **khóa công khai** cho MedDental. Khóa riêng không được trả qua API hoặc tải xuống trình duyệt. Khóa riêng PEM không mã hóa bằng mật khẩu; ứng dụng hỗ trợ PKCS#8 và PKCS#1, yêu cầu RSA thông thường tối thiểu 2048 bit.
6. Nhập file **khóa công khai RSA của MedDental** (.pem) để xác minh phản hồi. Không dùng khóa công khai của chính ngân hàng ở ô này.
7. Chỉ điền `signSecret` nếu hai bên đã thống nhất. Để trống giữ nguyên giá trị cũ; tick **Xóa signSecret đã lưu** nếu hai bên ngừng sử dụng nó.
8. Bật **Tự động gửi callback** và bấm **Lưu tích hợp**. Ứng dụng từ chối bật nếu thiếu URL hoặc khóa bắt buộc. Trường bí mật để trống sẽ giữ cấu hình cũ; API chỉ trả trạng thái đã cấu hình và khóa công khai ngân hàng.

Telegram và hạn mức vẫn có nút lưu riêng, không thay đổi cấu hình callback khi lưu các phần đó.

## Giao dịch và payload

Sau khi xác nhận QR, ứng dụng ghi giao dịch và một job callback **trong cùng transaction SQLite**. Callback chạy nền, không chờ MedDental để trả kết quả chuyển tiền. Nếu callback bị từ chối hoặc mất kết nối, giao dịch đã xác nhận vẫn giữ nguyên.

| Trường gửi | Nguồn dữ liệu |
|---|---|
| `transactionId` | UUID đầy đủ của giao dịch, giữ nguyên khi gửi lại |
| `amount` | Số tiền VND nguyên dương đọc từ QR |
| `direction` | `in` — tiền vào tài khoản nhận của MedDental |
| `transactionTime` | Thời điểm ghi giao dịch, `yyyyMMddHHmmss` theo UTC+7 |
| `accountNumber` | Số tài khoản nhận trong QR |
| `content` | Nội dung chuyển khoản trong QR, giữ nguyên để khớp mã đơn |
| `bankRef` | Cùng giá trị `transactionId` |
| `bankCode` | BIN ngân hàng trong VietQR, ví dụ `970436` |

Mỗi request gửi **một giao dịch**, không gộp batch và không tự thêm `virtualAccount` khi QR không cung cấp. Hiện không có màn tạo giao dịch `out`; đó là dạng kiểm thử tùy chọn bên MedDental, còn luồng quét QR luôn báo tiền vào người nhận.

`data = base64(IV 8 byte + TripleDES-CBC/PKCS#7 ciphertext)`. Mỗi lần gửi sinh IV mới. Chuỗi ký UTF-8 là `data|partner|requestTime` (thêm `|signSecret` khi được cấu hình), ký RSA PKCS#1 v1.5 + SHA-256 bằng khóa riêng ngân hàng. Header dùng `apiKey` và `secretKey`. `requestTime` luôn lấy thời gian hiện tại ở UTC+7, độc lập timezone của container. Server cần đồng bộ giờ NTP để không lệch quá 5 phút.

## Xác minh phản hồi và trạng thái

Với phản hồi mã hóa, kiểm RSA bằng khóa công khai MedDental **trước khi giải mã**. Chỉ coi callback thành công khi HTTP 200, `code=00`, partner đúng, `requestTime` khớp request, kết quả đúng `transactionId` và status là `accepted` hoặc `duplicate`. Lưu `referenceId` để đối soát. Chữ ký sai, bản mã hỏng, response ghép nhầm hoặc JSON thường giả `code=00` không được đánh dấu thành công.

Mở **Lịch sử giao dịch**, bấm **Làm mới** để xem trạng thái callback:

- **Chưa gửi**: chưa có job. Giao dịch tạo khi tích hợp tắt không tự được gửi hồi tố. Sau khi bật, có thể bấm **Gửi callback** cho giao dịch cần báo.
- **Chờ gửi / gửi lại**: hàng đợi đang đợi lần gửi kế tiếp, hiển thị thời gian dự kiến theo giờ Việt Nam.
- **Đang gửi**: đang chờ response, timeout 15 giây.
- **Đã xác nhận**: nhận `accepted` hoặc `duplicate` đã xác minh; hiển thị tham chiếu MedDental. Không cho gửi lại thủ công giao dịch đã xác nhận.
- **Gửi thất bại**: lỗi cần sửa cấu hình/dữ liệu hoặc đã hết thời gian tự gửi lại. Sau khi khắc phục có thể bấm **Gửi lại**.

Mỗi job giữ cùng mã giao dịch. Retry luôn tạo `requestTime`, IV và chữ ký mới. Lịch chờ giữa các lần gửi: **1 phút, 5 phút, 15 phút, sau đó mỗi giờ**, tối đa 24 giờ từ lúc job được tạo. Thử lại thủ công mở cửa sổ 24 giờ mới, vẫn giữ mã giao dịch để MedDental chống trùng.

| Lỗi | Xử lý |
|---|---|
| Timeout, lỗi mạng, HTTP 5xx / `99` | Tự gửi lại |
| `03` đã ký hợp lệ | Tự gửi lại với thời gian mới; kiểm tra NTP nếu lặp lại |
| `01`, `02` đã ký hợp lệ | Dừng tự gửi, hiển thị mã lỗi để sửa cấu hình/dữ liệu |
| HTTP 401, JSON thường `04` hoặc `05` | Theo tài liệu, đối tác chưa xác định nên phản hồi không mã hóa; dừng tự gửi để sửa partner/khóa |
| Chữ ký sai, response không khớp, JSON sai | Không tin phản hồi; thử lại để đối soát cùng giao dịch |

Không theo HTTP redirect để tránh chuyển header bí mật sang endpoint khác. Chỉ gọi HTTPS, giới hạn response 64 KB. Không ghi khóa, chữ ký, bản mã hoặc payload đã giải mã vào log; lịch sử chỉ lưu trạng thái, số lần gửi, mã lỗi chung và tham chiếu.

## Lưu dữ liệu và triển khai

Migration tự thêm bảng `integration_settings`, `callback_jobs` và chỉ mục hàng đợi, giữ nguyên giao dịch/cài đặt cũ. Tích hợp mặc định **tắt** sau nâng cấp. Khóa cùng cấu hình và hàng đợi lưu ở SQLite trong volume `bank-data`; database/backup chứa khóa bí mật, cần bảo vệ quyền truy cập. Không commit database hoặc file PEM riêng vào Git.

Chỉ chạy **một instance** ngân hàng. Khi container khởi động lại, job đang gửi được đưa lại vào hàng đợi; nếu MedDental đã nhận trước khi mất kết nối, lần sau trả `duplicate`. Phiên đăng nhập trong RAM vẫn mất khi khởi động lại. Tắt tích hợp tạm dừng gửi và không tạo job cho giao dịch mới; cửa sổ 24 giờ của job cũ vẫn tính theo thời gian thực. Retry dùng URL, partner và khóa đang lưu tại thời điểm gửi; thống nhất đổi khóa với MedDental trước khi cập nhật.

Dockerfile đã chép hai module tích hợp vào image. Không cần mở thêm cổng, thêm service hoặc biến môi trường khóa: cấu hình qua màn Cài đặt. Server phải được phép kết nối HTTPS ra endpoint MedDental.

```bash
# Trên server, trong repo mdt-dbank
git pull
docker compose -f docker-compose.antblog.yml up -d --build
```

## Kiểm thử trước khi dùng

```bash
npm test
npx playwright install chromium
npm run check:ui
```

Test dùng SQLite trong RAM, khóa RSA sinh tạm và Telegram/MedDental mô phỏng; không gọi đối tác thật. Bao gồm mẫu TripleDES chính xác từ tài liệu, ký/xác minh, accepted/duplicate, phản hồi sửa đổi/ghép nhầm, mã lỗi, retry/khôi phục hàng đợi và rollback nếu không ghi được job. Kiểm thử trình duyệt cấu hình khóa, gửi callback từ lịch sử, nhận xác nhận và responsive 360–1440px.

Sau khi triển khai, điền khóa sandbox thật do MedDental cấp, trao đổi khóa công khai ngân hàng, thử QR chứa tài khoản MedDental và mã đơn sandbox. Kiểm tra trạng thái callback cùng dữ liệu đơn trên MedDental trước khi chuyển sang bộ khóa chính thức.
