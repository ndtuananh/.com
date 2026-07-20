# Thư mục file mẫu

Đặt **file Excel mẫu "LỆNH SẢN XUẤT"** vào đây (đuôi `.xlsx`).

- App tự lấy file `.xlsx` đầu tiên trong thư mục này — đặt tên gì cũng được.
- **KHÔNG** chỉnh sửa file mẫu bằng tay. App chỉ đọc và clone khi xuất.
- App ghi 3 cột vào sheet `MẪU` (hoặc sheet đầu tiên nếu không có), bắt đầu từ dòng 28:
  - Cột **A** = STT
  - Cột **C** = Tên chi tiết
  - Cột **H** = Số lượng
- Toàn bộ header, style, merge cell, công thức được giữ nguyên 100%.

Nếu file mẫu thật có vị trí khác (dòng bắt đầu / cột), sửa 4 hằng số ở đầu
`../api/export.js`: `SHEET_NAME`, `START_ROW`, `COL_STT`, `COL_NAME`, `COL_QTY`.
