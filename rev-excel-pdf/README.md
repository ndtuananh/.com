# REV Excel → PDF · Cập nhật "No. Required" theo BOM

App tĩnh, chạy **100% trên trình duyệt** (không server, file không rời máy). Nạp Excel BOM +
PDF shop drawing (Tekla), app tự dò số **"No. Required"** (số nhỏ đứng cạnh mã lắp trong ô
`GRID LOCATION` và tiêu đề `MATERIAL LIST FOR`) và ghi đè bằng cột **`Total Qnty`** trong Excel,
khớp theo **Member No**.

## Vì sao bản cũ báo "0 · 0 · 2 bỏ qua"
Bản cũ neo bằng regex `MATERIAL LIST FOR : <member>` — cho rằng mã lắp nằm **cùng dòng chữ** với
nhãn. Trong bản vẽ Tekla thật, `MATERIAL LIST FOR` và `No. Required` là **tiêu đề cột**, còn mã +
số nằm ở **hàng khác** → regex không khớp → mọi trang bị bỏ qua âm thầm.

## Cơ chế mới — MỘT quy tắc tham chiếu duy nhất
Neo cố định vào nhãn **`No. Required`** trong khối `MATERIAL LIST FOR` (đúng như bản vẽ mẫu):
1. **Số cần đổi** = số nguyên đứng **ngay trước (bên trái)** nhãn `No. Required`, cùng hàng.
2. **Member** = mã cùng hàng bên trái số đó, khớp cột **Member No** trong Excel (chịu được tiền tố
   `TD-Z1-BR1.2-0054`) → tra **Total Qnty**.
3. **Định dạng** số mới: zero-pad 2 chữ số (`1 → 01`, `4 → 04`, `12 → 12`).
4. **Không đụng** số của dòng part (cột "No.") hay kích thước — vì chỉ neo vào nhãn `No. Required`.
5. **Không bao giờ bỏ qua âm thầm**: mỗi trang render ra ảnh, tô sáng ô sẽ đổi (`4 → 01`) kèm trạng
   thái + lý do. Bấm ô để bật/tắt; bấm **"Chọn ô khác"** rồi click số đúng để sửa tay.

## Lưu ý kỹ thuật
- **Che bằng ô trắng + vẽ số mới** (overlay) giữ đúng vị trí/kích thước. Bản in/xem hiển thị đúng
  số mới. Glyph cũ bị **che** (không xoá khỏi text-layer) — đây là cách overlay chuẩn cho bản vẽ
  kỹ thuật; kết quả trực quan là chính xác.
- Kiểm thử engine: `scratchpad/test/test.mjs` dựng PDF giả lập layout Tekla và xác nhận dò đúng 2 ô
  No.Required, bỏ qua số của dòng part và các kích thước, ghi đè đúng `Total Qnty`.

## Cấu trúc
- `index.html` · `style.css` · `app.js` — toàn bộ app (ESM, pdf.js + pdf-lib + SheetJS qua CDN).
- `vercel.json` — cấu hình deploy tĩnh.

## Deploy
Đặt thư mục này làm root project trên Vercel (framework preset: **Other**), hoặc `vercel --prod`.
