# Ngân hàng số MEDDENTAL

Ứng dụng **giả lập** ngân hàng để kiểm thử, viết bằng Node.js, Express và SQLite. Giao diện tiếng Việt, responsive cho điện thoại, tablet và desktop. Không kết nối hoặc chuyển tiền thật.

## Khởi chạy

Yêu cầu Node.js 24 trở lên.

```powershell
npm install
Copy-Item .env.example .env
```

Điền `.env`:

- `TELEGRAM_BOT_TOKEN`: bot token tạo qua @BotFather.
- `TELEGRAM_CHAT_ID`: chat nhận OTP. Mở bot và gửi `/start` trước. Có thể lấy chat ID từ API `getUpdates` của bot sau khi nhắn tin.
- `SESSION_SECRET`: chuỗi bí mật ngẫu nhiên. Tạo bằng `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `PORT`: mặc định 3000.

```powershell
npm start
```

Truy cập http://localhost:3000, nhập tên tài khoản **meddental**, nhận OTP qua Telegram để đăng nhập. Không có mật khẩu hoặc OTP bỏ qua. Lần đầu cấu hình Telegram qua `.env` để tránh phải đăng nhập trước khi có thể cài đặt. Sau khi đăng nhập, thay đổi cấu hình trong Cài đặt; giá trị được lưu trong SQLite và ưu tiên hơn `.env`.

## Chức năng

- OTP 6 chữ số, hết hạn sau 5 phút, tối đa 5 lần nhập sai; gửi lại sau 60 giây. OTP băm trong phiên, hủy khi sử dụng. Giới hạn số yêu cầu đăng nhập.
- Lịch sử: phân trang 10 giao dịch/trang, lọc từ/đến ngày, tìm nội dung bằng SQL LIKE. `%` và `_` trong ô tìm kiếm được tìm như ký tự thường. Tham số SQL được bind.
- Quét camera, ảnh QR hoặc dán chuỗi QR. Hỗ trợ **VietQR chuyển khoản VND có số tiền nguyên dương**, kiểm tra CRC. QR không có số tiền sẽ báo lỗi. Ngân hàng hiển thị BIN; tên trong QR không được tra cứu hay xác minh với ngân hàng.
- Xác nhận bằng một nút, lấy đúng số tiền đã đọc từ QR ở phía máy chủ. Giao dịch thành công lưu SQLite. Xác nhận lại cùng mã không tạo giao dịch trùng. Thông tin xác nhận hết hạn sau 10 phút.
- Hạn mức mặc định 0 = không giới hạn. Số âm quy về 0; số dương giới hạn tổng tiền chuyển trong ngày theo múi giờ Asia/Ho_Chi_Minh. Kiểm tra và ghi giao dịch trong transaction SQLite.
- Cài đặt token bot Telegram, chat ID, hạn mức ngày, URL callback. Token đã lưu không trả về trình duyệt; để trống giữ nguyên token.
- Callback hiện **chỉ lưu URL**, chưa gửi request. Chờ đặc tả payload, xác thực, thời điểm gọi và retry.

## Responsive và camera

Desktop có thanh điều hướng bên trái và bảng giao dịch; điện thoại có điều hướng dưới cùng, giao dịch dạng thẻ và biểu mẫu một cột. Camera yêu cầu localhost hoặc HTTPS cùng quyền truy cập camera. Nếu mở bằng IP LAN trên điện thoại qua HTTP, dùng tải ảnh QR hoặc triển khai HTTPS để dùng camera.

## Dữ liệu và phiên

SQLite tự tạo ở `data/bank.sqlite`; sao lưu cả thư mục `data` khi ứng dụng đã tắt. Chưa có giao dịch sẽ hiển thị trạng thái trống, không tự thêm dữ liệu giả.

Phiên đăng nhập/OTP sử dụng MemoryStore, phù hợp một tiến trình thử nghiệm. Khởi động lại sẽ đăng xuất; dữ liệu/cài đặt SQLite vẫn giữ nguyên. Không dùng cấu hình này cho ngân hàng thực hoặc production nhiều instance. Khi tự triển khai HTTPS trực tiếp, đặt `COOKIE_SECURE=true`. Không commit `.env` và database.

## Kiểm tra

```powershell
npm test
npx playwright install chromium
npm run check:ui
```

Test API dùng SQLite trong RAM và mô phỏng Telegram, không gửi tin nhắn thật. Kiểm tra OTP, xác thực, QR/checksum, hạn mức, ghi trùng, phân trang, LIKE và đăng xuất. Test trình duyệt kiểm tra luồng đăng nhập → QR → chuyển tiền → cài đặt và độ rộng 360, 390, 768, 1024, 1440px. Ảnh kiểm tra lưu ở `artifacts/`. Camera thiết bị và gửi OTP thật cần kiểm tra thêm với bot Telegram của bạn.

## Chạy bằng Docker Compose

Mã nguồn tại `D:\Work\meddental\mdt-dbank`. Cài Docker Engine/Docker Desktop với Docker Compose v2 và chế độ Linux containers.

```powershell
cd D:\Work\meddental\mdt-dbank
Copy-Item .env.example .env
# Điền TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID và SESSION_SECRET vào .env

docker compose up -d --build
docker compose ps
docker compose logs -f mdt-dbank
```

Mở http://localhost:3000. Compose đọc `.env` trên máy host để truyền cấu hình; `.env` và dữ liệu không được đóng gói vào image. `PORT` trong `.env` thay đổi cổng host, cổng trong container luôn là 3000. Ví dụ `PORT=3080` mở http://localhost:3080.

SQLite lưu trong named volume `bank-data` tại `/app/data`, được giữ lại khi chạy `docker compose down` hoặc build lại image. Phiên đăng nhập trong RAM vẫn mất khi container khởi động lại. Container chạy bằng user `node`, có healthcheck và tự khởi động lại trừ khi bị dừng thủ công.

```powershell
# Dừng và giữ dữ liệu
docker compose down

# Áp dụng thay đổi source hoặc .env
docker compose up -d --build
```

Volume Docker mới có database riêng, không tự nhập database chạy local ở `data/`. Để chuyển dữ liệu local hiện có vào volume, trước tiên dừng ứng dụng local rồi:

```powershell
# Khởi tạo volume/container mà chưa khởi động ứng dụng
docker compose create --build
$containerId = docker compose ps -aq mdt-dbank
# Chép cả thư mục để giữ đồng bộ SQLite và các file WAL/SHM nếu có
docker cp .\data\. "${containerId}:/app/data/"
# Đặt quyền ghi cho user node trước khi chạy
docker compose run --rm --no-deps --user root --cap-add CHOWN mdt-dbank chown -R node:node /app/data
docker compose up -d
```

Không dùng `docker compose down -v` nếu cần giữ dữ liệu, vì `-v` xóa volume. Để sao lưu, dừng container trước, dùng `docker compose cp mdt-dbank:/app/data ./backup-data`, rồi `docker compose start`.

