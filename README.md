# Voucher Shopee 🎫

Trang tổng hợp mã giảm giá Shopee.

**Xem trực tiếp:** https://ndtuananh.github.io/.com/ *(cần bật GitHub Pages trong Settings → Pages → Source: `main` / root)*

## Cấu trúc dự án

| File | Vai trò |
|---|---|
| `index.html` / `style.css` / `app.js` | Giao diện web tĩnh, đọc dữ liệu từ `vouchers.json` |
| `vouchers.json` | Dữ liệu voucher hiện có |

## Cách dữ liệu được cập nhật

`scraper.mjs` dùng trình duyệt headless thật (Playwright) để mở `shopee.vn/m/ma-giam-gia` — trang này là SPA nên fetch HTTP thường không đọc được, cần render JS thật sự. GitHub Actions (`update-vouchers.yml`) chạy script này mỗi giờ, không cần đăng nhập.

- Nếu tìm thấy voucher → ghi đè `vouchers.json`, cập nhật `lastUpdated`.
- Nếu không tìm thấy gì (bị chặn/captcha/đổi giao diện) → **giữ nguyên dữ liệu cũ**, chỉ cập nhật `lastChecked`, không báo sai là "mới nhất".
- Mỗi lần chạy đều chụp `debug.png` (toàn trang) và upload làm workflow artifact (Actions tab → chọn lần chạy → Artifacts) để kiểm tra Shopee đang trả về gì khi có sự cố.

### Giới hạn thực tế
Shopee có hệ thống chống bot; IP của GitHub Actions runner có thể bị chặn hoặc gặp captcha bất kỳ lúc nào, khiến workflow liên tục không lấy được dữ liệu mới dù không báo lỗi đỏ. Nếu để ý thấy `lastUpdated` không nhích lên trong thời gian dài, hãy kiểm tra `debug.png` trong Artifacts — nếu Shopee đang chặn, cách chắc chắn nhất vẫn là gửi ảnh chụp màn hình thật để cập nhật thủ công.

## Lưu ý

- Voucher trên Shopee thường gắn với tài khoản đăng nhập, không phải mã dùng chung cho mọi người — vì vậy các thẻ voucher trên trang này trỏ thẳng về `shopee.vn/m/ma-giam-gia` để khách tự lưu mã vào tài khoản của họ, thay vì dùng link claim cá nhân (dễ hỏng/hết hạn với người khác).
- Dữ liệu hiện tại trong `vouchers.json` là **ví dụ minh hoạ giao diện**, chưa phải dữ liệu xác thực từ ảnh chụp thật — sẽ được thay khi có ảnh chụp đầu tiên.
