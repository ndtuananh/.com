# Voucher Shopee 🎫

Trang tổng hợp mã giảm giá Shopee, cập nhật tự động mỗi giờ.

**Xem trực tiếp:** https://ndtuananh.github.io/.com/

## Cấu trúc dự án

| File | Vai trò |
|---|---|
| `index.html` / `style.css` / `app.js` | Giao diện web tĩnh, đọc dữ liệu từ `vouchers.json` |
| `vouchers.json` | Dữ liệu voucher hiện tại (do scraper ghi đè) |
| `scraper.mjs` | Script cào + gửi email cảnh báo, chạy bởi GitHub Actions |
| `.github/workflows/update-vouchers.yml` | Cron chạy `scraper.mjs` mỗi giờ, tự commit nếu có thay đổi |

## Cách dữ liệu được cập nhật

Trang `shopee.vn/m/ma-giam-gia` là SPA (cần JS render) và **chỉ hiện voucher khi đã đăng nhập** — `scraper.mjs` dùng Playwright (trình duyệt headless thật) kèm cookie phiên đăng nhập để đọc được dữ liệu.

- Cookie được truyền qua biến môi trường `SHOPEE_COOKIES` — repo secret trên GitHub Actions, hoặc file `.env` (gitignored) khi chạy local. **Không bao giờ hardcode trong code hay commit lên git.**
- Danh sách voucher bị ảo hoá (virtualized) khi cuộn — script cuộn dần xuống và gom dữ liệu ở mỗi bước thay vì đợi tới cuối, tránh mất dữ liệu đã tải.
- Nếu tìm thấy voucher → ghi đè `vouchers.json`, cập nhật `lastUpdated`.
- Nếu không tìm thấy gì (cookie hết hạn/bị chặn/đổi giao diện) → **giữ nguyên dữ liệu cũ**, chỉ cập nhật `lastChecked`, không báo sai là "mới nhất". Script tự phát hiện riêng trường hợp "cookie hết hạn" (thấy trang yêu cầu đăng nhập lại) để ghi đúng lý do.
- Mỗi lần chạy đều chụp `debug.png` (toàn trang) và upload làm workflow artifact (Actions tab → chọn lần chạy → Artifacts) để kiểm tra khi có sự cố.

### Cookie hết hạn
Cookie Shopee sẽ hết hạn theo thời gian. Khi đó cần lấy cookie mới:
1. Đăng nhập `shopee.vn` trên trình duyệt → F12 → tab Network → chọn request tới `shopee.vn` → copy giá trị header `Cookie`.
2. Cập nhật secret: `gh secret set SHOPEE_COOKIES --repo ndtuananh/.com` (dán cookie khi được hỏi), hoặc qua Settings → Secrets and variables → Actions trên GitHub.

## Cảnh báo voucher HOT qua email

Voucher đã dùng ≥90% lượt được đánh dấu `hot: true` (badge "HOT" trên web). Mỗi lần chạy, script so sánh với lần trước — nếu có voucher **mới** rơi vào diện HOT, tự gửi email tới Gmail của chủ repo qua SMTP (App Password, secret `GMAIL_APP_PASSWORD`). Không có secret này thì bỏ qua bước gửi email, các phần còn lại vẫn chạy bình thường.

## Lưu ý

- Voucher trên Shopee gắn với tài khoản đăng nhập, không phải mã dùng chung — các thẻ voucher trên trang này trỏ về `shopee.vn/m/ma-giam-gia` để khách tự lưu mã vào tài khoản của họ, thay vì link claim cá nhân (dễ hỏng với người khác).
- Shopee có hệ thống chống bot; chạy scraper dồn dập trong thời gian ngắn có thể khiến trang trả về rỗng dù cookie còn hợp lệ — bình thường trở lại sau một lúc, cron mỗi giờ không gặp vấn đề này.
