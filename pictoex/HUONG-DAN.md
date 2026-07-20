# Pictoex — Hướng dẫn

Chụp ảnh **phiếu cắt** (in máy hoặc viết tay) → OCR bằng Claude Vision → soát lỗi trên bảng → xuất
**Lệnh Sản Xuất (.xlsx)** đúng file mẫu (giữ nguyên header, style, công thức).

## Cấu trúc

```
pictoex/
├─ index.html            UI: upload ảnh → bảng review/sửa → nút Xuất Excel
├─ api/
│  ├─ extract.js         gọi Claude Vision, trả JSON (code / qty / confidence)
│  └─ export.js          ExcelJS: load mẫu → ghi cột A/C/H từ dòng 28 → trả .xlsx
├─ templates/            ĐẶT FILE MẪU .xlsx VÀO ĐÂY (xem templates/README.md)
├─ package.json          dependency: exceljs
└─ vercel.json
```

## 3 việc cần làm trước khi chạy thật

1. **Đặt file mẫu**: copy `LỆNH_VẬT_TƯ...mẫu.xlsx` vào `pictoex/templates/`.
2. **Set biến môi trường trên Vercel** (Project → Settings → Environment Variables):
   - `GEMINI_API_KEY` = key MIỄN PHÍ lấy ở https://aistudio.google.com/apikey (không cần thẻ, không nạp tiền).
   - `GEMINI_MODEL` = `gemini-3-flash-preview` (mặc định; không cần thêm cũng được).
3. **Deploy** (xem dưới).

## Deploy lên Vercel (domain pictoex)

```bash
cd pictoex
vercel deploy --prod --yes        # lần đầu: chọn/đặt project tên "pictoex"
```
Sau khi tạo project, vào Settings → Domains để gắn `pictoex.vercel.app` (hoặc domain riêng),
và nhớ set 2 biến môi trường ở mục trên rồi deploy lại.

## Cách dùng

1. Mở web → **chụp / chọn / kéo-thả / dán** ảnh phiếu cắt (ảnh tự nén để nhanh & rẻ).
2. Bấm **Nhận diện** → xem bảng kết quả.
3. Soát các dòng gắn cờ **⚠** (chữ mờ/dễ nhầm 4↔A, 1↔7, 0↔6). Sửa trực tiếp, thêm/xóa dòng tùy ý.
4. Bấm **Xuất Excel** → tải file `LenhSanXuat_<LSX>.xlsx`.

## Đối chiếu danh mục (chống sai số lượng)

Vì đọc sai 1 số lượng là ra tiền/phế, app có bước **đối chiếu với danh mục chuẩn**:

1. Trên đầu trang, mở **🔎 Danh mục đối chiếu** → **Chọn file .xlsx** = file Lệnh Sản Xuất hôm nay.
   App tự lấy danh sách **mã chuẩn (cột TÊN CHI TIẾT) + số lượng (cột Số lượng)**.
2. Danh mục được nhớ trong trình duyệt cả ngày (không phải nạp lại mỗi ảnh).
3. Khi soát bảng OCR, mỗi dòng được gắn cờ:
   - <span>✓</span> khớp danh mục · <span>DS:n</span> số lượng khác danh mục (n = số trong danh mục)
   - <span>→ gợi ý</span> mã đọc lệch (bấm để tự sửa về mã chuẩn) · <span>lạ</span> mã không có trong danh mục
4. Endpoint `api/master.js` (ExcelJS) tự dò cột theo tiêu đề, fallback cột C/H.

## Độ bền (đã xử lý)

- **Tự đổi model dự phòng**: nếu Gemini quá tải / hết quota / model bị Google khóa, `extract.js` tự
  nhảy sang model kế trong `GEMINI_MODEL` (mặc định: `gemini-3-flash-preview,gemini-flash-latest,gemini-2.5-flash-lite`).
- **Chống ghi đè công thức**: trước khi xuất, `export.js` kiểm tra ô A/C/H đích không phải công thức;
  nếu file mẫu lệch vị trí → **báo lỗi, không xuất bừa** (tránh phá công thức mà file vẫn trông đúng).

## Quy tắc trích xuất (AI tự áp)

- **Bảng in** (String / Instances): cột String → tên chi tiết, cột Instances → số lượng.
- **Viết tay** (`MÃ = SỐ`): chỉ nhận dòng có `=` và vế phải là **số nguyên thuần**
  (vd `SS576=1`). Dòng như `CT=VIOLA.200`, `U-250X90`, `1017` → bỏ vào "đã bỏ qua".
- Header/công thức trong file mẫu: **không bao giờ bị đụng tới**.

## Chi phí / bảo mật

- Dùng Google Gemini bản **miễn phí** (không cần thẻ). API key nằm ở server (`api/extract.js`), không lộ ra trình duyệt.
- Ảnh chỉ xử lý tạm trong request, không lưu trên máy chủ.
- Ảnh được nén xuống cạnh dài ≤ 1600px trước khi gửi → giảm token & tăng tốc.
