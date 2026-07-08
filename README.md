# Voucher Shopee 🎫

Trang tổng hợp mã giảm giá Shopee, tự động cập nhật mỗi giờ qua GitHub Actions.

**Xem trực tiếp:** https://ndtuananh.github.io/.com/ *(cần bật GitHub Pages trong Settings → Pages → Source: `main` / root)*

## Cấu trúc dự án

| File | Vai trò |
|---|---|
| `index.html` / `style.css` / `app.js` | Giao diện web tĩnh, đọc dữ liệu từ `vouchers.json` |
| `vouchers.json` | Dữ liệu voucher hiện có (được scraper ghi đè) |
| `scraper.py` | Script lấy dữ liệu, chạy bởi GitHub Actions |
| `.github/workflows/update-vouchers.yml` | Cron chạy `scraper.py` mỗi giờ và tự commit `vouchers.json` nếu có thay đổi |

## ⚠️ Giới hạn cần biết

- Shopee **không cung cấp API công khai** cho danh sách voucher. Endpoint mà `scraper.py` đang gọi (`voucher_wallet/get_voucher_list`) yêu cầu đăng nhập, nên trong thực tế nó gần như luôn fail và fallback về **danh sách tĩnh** đã có sẵn trong file — chỉ có thời gian `lastUpdated` là thay đổi mỗi giờ, **dữ liệu voucher thực chất không tự làm mới**.
- Các link voucher hiện tại trong `vouchers.json` có chứa `signature`/`evcode` — đây là link claim gắn với một phiên đăng nhập Shopee cụ thể, **nhiều khả năng đã hết hạn hoặc chỉ dùng được 1 lần**, không đảm bảo hoạt động cho mọi khách truy cập trang.
- Muốn trang thực sự "cập nhật 24/7 chính xác", cần một trong các hướng sau: (1) dùng tài khoản Shopee Affiliate/Partner có API chính thức, (2) tự tay cập nhật danh sách định kỳ, hoặc (3) chấp nhận rủi ro chặn IP/ToS khi scrape trực tiếp trang Shopee bằng trình duyệt headless (Playwright/Puppeteer) thay vì gọi endpoint nội bộ.

Nên coi trang này là **demo/khung sườn**, không phải nguồn voucher đảm bảo chính xác 100%.
