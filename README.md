# Voucher Shopee 🎫

Trang tổng hợp mã giảm giá Shopee.

**Xem trực tiếp:** https://ndtuananh.github.io/.com/ *(cần bật GitHub Pages trong Settings → Pages → Source: `main` / root)*

## Cấu trúc dự án

| File | Vai trò |
|---|---|
| `index.html` / `style.css` / `app.js` | Giao diện web tĩnh, đọc dữ liệu từ `vouchers.json` |
| `vouchers.json` | Dữ liệu voucher hiện có |

## Cách dữ liệu được cập nhật

Trang "Mã Giảm Giá" của Shopee (`shopee.vn/m/ma-giam-gia`) là ứng dụng render bằng JavaScript và có hệ thống chống bot — không thể lấy dữ liệu chính xác bằng cách gọi API/scrape tự động. Vì vậy trang này **không dùng scraper hay cron tự động**.

Quy trình cập nhật:
1. Vào `shopee.vn/m/ma-giam-gia` trên trình duyệt, chụp màn hình danh sách voucher.
2. Gửi ảnh chụp cho Claude (trong phiên làm việc này hoặc phiên mới).
3. Claude đọc ảnh, cập nhật `vouchers.json`, commit và push lên `main`.
4. GitHub Pages tự publish bản mới trong khoảng 1 phút.

Cách này đảm bảo dữ liệu **chính xác vì lấy từ ảnh chụp thật**, không vi phạm điều khoản sử dụng của Shopee vì không có request tự động nào gọi tới hệ thống của họ.

## Lưu ý

- Voucher trên Shopee thường gắn với tài khoản đăng nhập, không phải mã dùng chung cho mọi người — vì vậy các thẻ voucher trên trang này trỏ thẳng về `shopee.vn/m/ma-giam-gia` để khách tự lưu mã vào tài khoản của họ, thay vì dùng link claim cá nhân (dễ hỏng/hết hạn với người khác).
- Dữ liệu hiện tại trong `vouchers.json` là **ví dụ minh hoạ giao diện**, chưa phải dữ liệu xác thực từ ảnh chụp thật — sẽ được thay khi có ảnh chụp đầu tiên.
