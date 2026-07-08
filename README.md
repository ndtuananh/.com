# Voucher Shopee 🎫

Trang tổng hợp mã giảm giá Shopee, cập nhật tự động mỗi giờ — kèm công cụ phân tích Deal Score cho từng sản phẩm.

**Xem trực tiếp:** https://ndtuananh.github.io/.com/

## Cấu trúc dự án

| File | Vai trò |
|---|---|
| `index.html` / `style.css` / `app.js` | Giao diện web tĩnh, đọc dữ liệu từ `vouchers.json` |
| `vouchers.json` | Dữ liệu voucher hiện tại (do scraper ghi đè) |
| `scraper.mjs` | Script cào + gửi email cảnh báo, chạy bởi GitHub Actions |
| `.github/workflows/update-vouchers.yml` | Cron chạy `scraper.mjs` mỗi giờ, tự commit nếu có thay đổi |
| `analyze.mjs` | CLI phân tích 1 link sản phẩm Shopee → Deal Score (xem mục bên dưới) |
| `analyze.html` / `analyze.css` / `analyze-app.js` | Dashboard hiển thị kết quả từ `analyze.mjs` |

## AI Shopping Optimizer — phân tích Deal Score theo từng sản phẩm

Dán 1 link sản phẩm Shopee, công cụ tính giá sau voucher, tiết kiệm thực và Deal Score (0-100) kèm khuyến nghị `BUY_NOW` / `WAIT` / `NOT_GOOD`.

**Cách chạy** (local, cần `SHOPEE_COOKIES` giống `scraper.mjs`):
```bash
node analyze.mjs "https://shopee.vn/ten-san-pham-i.<shopid>.<itemid>"
```
Lệnh này ghi ra `analysis.json` — mở `analyze.html` (double-click hoặc `npx http-server`) và bấm "Tải kết quả" để xem dashboard. Trang cũng có ô dán link + nút "Sao chép lệnh phân tích" để copy sẵn lệnh trên vào clipboard.

**Nguồn dữ liệu:** không dùng API công khai (Shopee không có) mà đọc thẳng response nội bộ `/api/v4/pdp/get_pc` mà chính trang sản phẩm của Shopee gọi khi tải — cùng dữ liệu Shopee hiển thị cho tài khoản đang đăng nhập (giá, voucher Shop/Shopee đã được Shopee tự chọn tối ưu, đánh giá, đã bán, độ uy tín shop). Không đoán mò các con số này.

**Những gì là ước tính (ghi rõ trong mục `estimates` của kết quả, không trộn vào số liệu thật):**
- Dự đoán Flash Sale: suy luận đơn giản từ mức giảm giá hiện tại, không phải dữ liệu Flash Sale thật.
- Xu hướng giá: `price-history.json` (gitignored, lưu local) tự tích luỹ một điểm dữ liệu mỗi lần chạy `analyze.mjs` cho cùng sản phẩm — cần chạy lại vài lần mới có xu hướng thật, không bịa lịch sử giá 60 ngày ngay từ lần đầu.
- **Không có** so sánh Lazada/TikTok Shop — không có nguồn dữ liệu đáng tin cho việc này nên bỏ hẳn thay vì bịa số.
- Hoàn Xu / quà tặng: chỉ hiển thị khi Shopee trả về giá trị cụ thể; nếu sản phẩm có chương trình quà tặng nhưng không có giá trị VNĐ rõ ràng, chỉ ghi nhận "có chương trình" chứ không bịa số tiền.

## Cách dữ liệu được cập nhật

Trang `shopee.vn/m/ma-giam-gia` là SPA (cần JS render) và **chỉ hiện voucher khi đã đăng nhập** — `scraper.mjs` dùng Playwright (trình duyệt headless thật) kèm cookie phiên đăng nhập để đọc được dữ liệu.

- Cookie được truyền qua biến môi trường `SHOPEE_COOKIES` — repo secret trên GitHub Actions, hoặc file `.env` (gitignored) khi chạy local. **Không bao giờ hardcode trong code hay commit lên git.**
- Danh sách voucher bị ảo hoá (virtualized) khi cuộn — script cuộn dần xuống và gom dữ liệu ở mỗi bước thay vì đợi tới cuối, tránh mất dữ liệu đã tải.
- Nếu tìm thấy voucher → ghi đè `vouchers.json`, cập nhật `lastUpdated`.
- Nếu không tìm thấy gì (cookie hết hạn/bị chặn/đổi giao diện) → **giữ nguyên dữ liệu cũ**, chỉ cập nhật `lastChecked`, không báo sai là "mới nhất". Script tự phát hiện riêng trường hợp "cookie hết hạn" (thấy trang yêu cầu đăng nhập lại) để ghi đúng lý do.
- Mỗi lần chạy đều chụp `debug.png` (toàn trang) và upload làm workflow artifact (Actions tab → chọn lần chạy → Artifacts) để kiểm tra khi có sự cố.

### Cookie hết hạn
Cookie Shopee sẽ hết hạn theo thời gian. Khi phát hiện (trang yêu cầu đăng nhập lại), scraper **tự gửi email cảnh báo** tới Gmail chủ repo (chỉ gửi 1 lần khi mới phát hiện, không spam mỗi giờ) kèm hướng dẫn — không cần tự kiểm tra thủ công. Khi cookie mới được cập nhật và scrape thành công trở lại, trạng thái cảnh báo tự reset.

Cách lấy cookie mới và cập nhật:
1. Đăng nhập `shopee.vn` trên trình duyệt → F12 → tab Network → chọn request tới `shopee.vn` → copy giá trị header `Cookie`.
2. Cập nhật secret: `gh secret set SHOPEE_COOKIES --repo ndtuananh/.com` (dán cookie khi được hỏi), hoặc qua Settings → Secrets and variables → Actions trên GitHub.

## Cảnh báo qua email

Dùng chung một cơ chế gửi email (SMTP Gmail + App Password, secret `GMAIL_APP_PASSWORD`; không có secret thì bỏ qua, phần còn lại vẫn chạy bình thường):

- **Voucher HOT**: voucher đã dùng ≥90% lượt được đánh dấu `hot: true` (badge "HOT" trên web). Mỗi lần chạy, script so sánh với lần trước — nếu có voucher **mới** rơi vào diện HOT, gửi email danh sách.
- **Cookie hết hạn**: xem mục "Cookie hết hạn" bên trên.

## Lưu ý

- Voucher trên Shopee gắn với tài khoản đăng nhập, không phải mã dùng chung — các thẻ voucher trên trang này trỏ về `shopee.vn/m/ma-giam-gia` để khách tự lưu mã vào tài khoản của họ, thay vì link claim cá nhân (dễ hỏng với người khác).
- Shopee có hệ thống chống bot; chạy scraper dồn dập trong thời gian ngắn có thể khiến trang trả về rỗng dù cookie còn hợp lệ — bình thường trở lại sau một lúc, cron mỗi giờ không gặp vấn đề này.
