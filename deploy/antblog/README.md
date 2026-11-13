# Triển khai dbank.antblog.xyz qua Nginx của antblog

Hai repo độc lập, ví dụ `/srv/antblog` và `/srv/mdt-dbank`. Nginx của antblog tiếp tục giữ cổng 80/443. Ngân hàng tham gia mạng Docker hiện có và không publish cổng ra host.

```text
Internet → Cloudflare → Nginx của antblog → mdt-dbank:3000 → SQLite volume
```

## 1. Chuẩn bị mdt-dbank

Các lệnh dưới đây chạy trên server Linux. Trong `/srv/mdt-dbank`:

```bash
cd /srv/mdt-dbank
# Chỉ chép khi chưa có .env; không ghi đè cấu hình đang dùng.
test -f .env || cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Nếu server không cài Node, tạo SESSION_SECRET bằng `openssl rand -hex 32`.

Sửa `.env`: điền `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` và thay `SESSION_SECRET` bằng chuỗi ngẫu nhiên vừa tạo. Gửi `/start` cho bot trước khi đăng nhập. Không commit `.env`.

```bash
docker network ls
```

Mạng mặc định theo Compose của antblog là `tech-knowledge-hub_tkh`. Nếu server dùng tên khác, sửa biến `ANTBLOG_NETWORK` trong `.env` theo kết quả thực tế. Stack antblog phải chạy trước để mạng tồn tại.

```bash
docker compose -f docker-compose.antblog.yml config --quiet
docker compose -f docker-compose.antblog.yml up -d --build
docker compose -f docker-compose.antblog.yml ps
docker compose -f docker-compose.antblog.yml logs --tail=100 mdt-dbank
```

**Chỉ dùng một file `-f docker-compose.antblog.yml`.** Đây là file triển khai độc lập, không gộp với file local `docker-compose.yml`, để tránh giữ lại port publish. Dùng cùng thư mục/project Compose hiện có để giữ volume `bank-data`; không đổi `-p` hay `COMPOSE_PROJECT_NAME` nếu đã có dữ liệu. Nếu chuyển từ container local trong cùng project, lệnh trên sẽ tạo lại service, gỡ cổng publish và giữ volume.

File antblog bắt buộc `SESSION_SECRET` không rỗng, bật sẵn `COOKIE_SECURE=true` và `TRUST_PROXY=1`, dù `.env.example` giữ mặc định HTTP cho phát triển local. `PORT` trong `.env` không publish cổng ở chế độ antblog. Healthcheck chạy nội bộ qua HTTP và không cần đăng nhập.

## 2. DNS và SSL trong hạ tầng antblog

Trên Cloudflare tạo bản ghi A `dbank` trỏ tới IP server của antblog, bật proxy; giữ SSL/TLS **Full (strict)**. Nếu cấu hình AAAA, địa chỉ IPv6 cũng phải trỏ đúng server.

Trong `.env` của **antblog**, thêm `dbank.antblog.xyz` vào `CERT_EXTRA_DOMAINS`, giữ tất cả tên miền đang có. Ví dụ:

```dotenv
CERT_EXTRA_DOMAINS=www.antblog.xyz,dbank.antblog.xyz
```

```bash
cd /srv/antblog
docker compose up -d certbot
docker compose logs --tail=100 certbot
```

Chờ Certbot báo cấp/mở rộng chứng chỉ thành công. Cấu hình antblog hiện có dùng cùng chứng chỉ tại `/etc/nginx/tkh-ssl.conf` cho các virtual host.

## 3. Đưa template Nginx vào antblog

Repo mdt-dbank cung cấp sẵn `deploy/antblog/dbank.conf.template`. Chép vào repo antblog trên server (kiểm tra file đích chưa có hoặc so sánh trước khi thay thế):

```bash
cd /srv/antblog
cp -i ../mdt-dbank/deploy/antblog/dbank.conf.template deploy/nginx/templates/dbank.conf.template
```

Commit template này trong repo antblog riêng nếu muốn lưu thay đổi hạ tầng ở Git. Không sửa template đang phục vụ blog/admin.

Template chuyển toàn bộ request của `dbank.antblog.xyz`, bao gồm `/api`, tới ngân hàng, không dùng cache của blog. Nó dùng Docker DNS để cập nhật IP backend khi container được tạo lại, dùng chứng chỉ chung và thêm `noindex`. Nginx ghi đè Host/X-Forwarded-Host/X-Forwarded-Proto/X-Forwarded-For; Express chỉ tin một proxy. Không publish trực tiếp app khi bật `TRUST_PROXY=1`, vì client trực tiếp có thể giả header proxy. Mạng chung phải chỉ gồm các container tin cậy.

Theo Dockerfile hiện tại của antblog, thư mục templates được COPY vào image nên cần build lại Nginx. Có thể kiểm tra image mới mà chưa thay container đang chạy:

```bash
cd /srv/antblog
docker compose build nginx
# Dùng entrypoint để sinh config từ template và chọn chứng chỉ, sau đó kiểm tra syntax.
docker compose run --rm --no-deps nginx nginx -t
# Khi kiểm tra thành công mới cập nhật riêng Nginx; có thể gián đoạn vài giây.
docker compose up -d --no-deps nginx
docker compose exec nginx nginx -t
```

Không chạy thêm Nginx hoặc Certbot ở repo ngân hàng. Các file trong repo này chưa tự áp dụng bất kỳ thay đổi nào lên antblog hay DNS.

## 4. Xác minh và cập nhật

```bash
curl -I https://dbank.antblog.xyz
curl https://dbank.antblog.xyz/api/session
```

API session chưa đăng nhập phải trả `authenticated: false`. Thử đăng nhập bằng OTP, xem lịch sử và mở camera trên điện thoại qua HTTPS. OTP thật/camera cần kiểm tra trên thiết bị và Telegram thật; test tự động dùng Telegram mô phỏng.

- 502: kiểm tra health/log ngân hàng và hai container cùng mạng `ANTBLOG_NETWORK`.
- 526: kiểm tra chứng chỉ origin đã chứa `dbank.antblog.xyz` và Nginx đã nạp chứng chỉ mới.
- 403 khi đăng nhập: kiểm tra Host, X-Forwarded-Proto và cấu hình TRUST_PROXY.
- OTP đúng nhưng mất phiên: kiểm tra HTTPS, Secure cookie và SESSION_SECRET. Container khởi động lại sẽ mất phiên trong RAM.
- Trang ngân hàng bị cache: kiểm tra Cloudflare cache rules cho hostname này; không dùng Cache Everything cho app/API.

Khi cập nhật riêng ngân hàng:

```bash
cd /srv/mdt-dbank
git pull
docker compose -f docker-compose.antblog.yml up -d --build
```

Dữ liệu SQLite nằm trong volume `bank-data`, không nằm trong image; không dùng `down -v` khi cần giữ dữ liệu. Dùng cùng `-f docker-compose.antblog.yml` cho các lệnh quản lý bản triển khai này. Triển khai này vẫn dành cho thử nghiệm một instance, phiên đăng nhập dùng MemoryStore.
