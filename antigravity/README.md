# 🛰️ AntiGravity v2

Nền tảng quản lý **yêu cầu đổi link affiliate** (admin tạo link **thủ công**), **đối soát đơn hàng** và **ví hoa hồng** — cho **Shopee** và **TikTok Shop**.

PWA (cài như app), giao diện tối giản cam/trắng, responsive. Backend: Supabase (Postgres + Auth + RLS). Hosting: Vercel (tĩnh + serverless).

---

## Luồng hoạt động

```
KHÁCH                          ADMIN
─────                          ─────
Đăng nhập
Dán link Shopee/TikTok
Gửi yêu cầu  ──► AG000001 (Pending) ──► 🔔 Báo admin (push + notifications)
                                        Mở link gốc
                                        Tạo link affiliate THỦ CÔNG
                                        (gắn Sub ID = AG000001)
                                        Dán link vào Dashboard
Nhận link (Completed) ◄──────────────── Hoàn tất
Copy gửi khách

… sau khi có đơn …
Admin nạp báo cáo AccessTrade (.csv) ──► Đối soát khớp theo mã AG
                                          ├─ đơn duyệt  → cộng "Chờ đối soát"
                                          ├─ quá hạn giam → chuyển "Khả dụng"
                                          └─ đơn hủy    → thu hồi
Khách rút ≥ 20.000đ ──► Admin duyệt (VietQR) ──► Chuyển khoản
```

## Ví (mỗi tài khoản)
- **Khả dụng** (`balance`) — rút được. Đơn hợp lệ được **cộng thẳng 50%** hoa hồng vào đây khi đối soát (`HOLD_DAYS=0`).
- **Chờ đối soát** (`ag_pending`) — chỉ dùng khi bật giam (`HOLD_DAYS>0`); mặc định = 0.
- **Đã rút** (`ag_paid`) · **Tổng kiếm** (`ag_total`)

> 🔒 **Công thức chia ẩn với khách.** Khách chỉ thấy *số tiền được cộng mỗi đơn* trong Lịch sử ví
> (`balance_log`), không thấy tổng hoa hồng đơn hay tỷ lệ %. RLS chặn khách đọc bảng `ag_orders`.

---

## Cài đặt (1 lần)

### 1) Database
Vào **Supabase → SQL Editor → New query**, dán toàn bộ [`schema.sql`](./schema.sql) → **Run**.
Rồi đặt tài khoản của anh làm admin (đăng ký trên app trước, rồi chạy):
```sql
update profiles set is_admin = true where phone = '09xxxxxxxx';
```

### 2) Deploy lên Vercel
Trong thư mục `antigravity/`:
```bash
npm i -g vercel      # nếu chưa có
vercel login         # đăng nhập tài khoản Vercel của anh
vercel --prod        # deploy — chọn New project, root = thư mục này
```
> Bước `vercel login` cần thao tác đăng nhập của anh nên chạy trên máy anh (không tự động headless được).

### 3) Biến môi trường trên Vercel (Project → Settings → Environment Variables)
| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `SUPABASE_SERVICE_ROLE` | ✅ | Supabase → Settings → API → `service_role` (BÍ MẬT) |
| `SUPABASE_URL` | tùy | mặc định đã ghi sẵn trong code |
| `COMMISSION_SHARE` | tùy | **công thức ẩn** — tỷ lệ chia cho khách, mặc định `0.5` (50%). Khách không thấy tỷ lệ này. |
| `HOLD_DAYS` | tùy | số ngày giam trước khi rút, mặc định `0` = cộng **thẳng** vào số dư khi đối soát |
| `VAPID_PUBLIC` / `VAPID_PRIVATE` / `VAPID_SUBJECT` | tùy | để bật push cho admin |

Deploy lại sau khi thêm biến: `vercel --prod`.

---

## 📄 Mẫu file đối soát (rất quan trọng)

Hệ thống đọc thẳng file **.csv** xuất từ AccessTrade → **Báo cáo chuyển đổi → Xuất dữ liệu**.
Bộ đọc tự nhận cột theo tên tiếng Việt, chỉ cần file có các cột sau (thứ tự tuỳ ý):

| Ý nghĩa | Tên cột chấp nhận (một trong số) | Bắt buộc |
|---|---|---|
| Mã đơn | `Order id`, `Mã đơn` | ✅ (chống trùng) |
| **Mã khớp khách** | `Sub ID`, `Sub1`, `Sub4`, `utm_content`, `Mã theo dõi` → chứa **AG000123** | ✅ để tự cộng ví |
| Hoa hồng đơn | `Hoa hồng đơn hàng`, `Hoa hồng`, `Commission` | ✅ |
| Giá trị đơn | `Giá trị đơn hàng`, `Order value` | tùy |
| Trạng thái | `Trạng thái đơn hàng` (Đã duyệt / Chờ / Đã hủy) | nên có |
| Thời gian đặt | `Thời gian đặt hàng` | nên có (tính hạn giam) |
| Nền tảng | `Nền tảng` / `Merchant` (Shopee/TikTok) | tự đoán nếu thiếu |

### 🔑 Cách khớp đơn về đúng khách — 2 cơ chế (chạy song song)

**Cách 1 — Mã AG trong Sub ID (chỉ Shopee, tự động, chống giả):**
Khi tạo link affiliate thủ công, điền **mã AG** (VD `AG000123`) vào ô **Sub ID / utm_content**
(AccessTrade → Custom Link). App có nút **Copy Sub ID** sẵn. Khi xuất Báo cáo chuyển đổi bật cột
**Sub ID** rồi Xuất. Đơn về tự khớp theo mã AG.

**Cách 2 — Khách nhập mã đơn (Shopee + TikTok):**
Vì **file TikTok KHÔNG có Sub ID**, cách chính là: sau khi mua, khách vào app dán **mã đơn hàng**
(VD `584409947068794600`) vào yêu cầu của họ (nút *Ghi nhận mã đơn*). Khi anh nạp báo cáo, hệ thống
khớp **order_id ↔ mã khách đã nhập** → cộng đúng người. Khách nhập trước hay sau khi nạp đều được
(nạp trước thì khi khách nhập sẽ **truy hồi cộng bù ngay**). Mỗi mã đơn chỉ 1 người nhận (chống trùng).

> Đơn chưa khớp được khách vẫn lưu để tra cứu, **không** tự cộng (tránh cộng nhầm).

### 📥 Định dạng file mỗi sàn
| Sàn | Xuất từ | Định dạng | Cột mã đơn | Cột hoa hồng (app lấy) | Trạng thái tính là "thành công" |
|---|---|---|---|---|---|
| **Shopee** | AccessTrade → Báo cáo chuyển đổi → Xuất dữ liệu | `.csv` | `ID Đơn hàng` | `Hoa hồng ròng tiếp thị liên kết` (ưu tiên) hoặc `Tổng hoa hồng đơn hàng` | `Hoàn thành` / `Đã duyệt` |
| **TikTok** | Đơn hàng liên kết → tải xuống | `.xlsx` | `ID đơn hàng` | `Tổng số tiền nhận được cuối cùng` (ròng thực nhận) | `Đã quyết toán` |

App **tự nhận sàn** từ tiêu đề file, tự đọc `.csv` lẫn `.xlsx`, tự đọc số kiểu `52434.9` (thập phân)
lẫn `141.000` (nghìn), gộp nhiều dòng cùng 1 đơn, và giữ nguyên mã đơn 18 chữ số (không làm tròn).

### Ví dụ file CSV tối thiểu
```csv
Order id,Sub ID,Trạng thái đơn hàng,Giá trị đơn hàng,Hoa hồng đơn hàng,Thời gian đặt hàng,Nền tảng
260712FFH4D8Y6,AG000123,Đã duyệt,442000,52435,12:07 12-07-2026,Shopee
2508XY99TT001,AG000124,Chờ duyệt,199000,18000,09:15 13-07-2026,TikTok
```

---

## Quy mô lớn (đã tối ưu)
- Frontend tĩnh chạy trên CDN Vercel — mở rộng gần như vô hạn.
- Mã yêu cầu `AG…` sinh bằng **sequence** (nguyên tử, không trùng dù nhiều người gửi cùng lúc).
- Mọi truy vấn đều có **index** + phân trang; RLS bảo vệ dữ liệu từng người.
- Nạp báo cáo: **bulk upsert 500 dòng/lô**, chống trùng theo `order_id`.
- Cộng ví bằng hàm **set-based** `ag_reconcile()` (1 câu lệnh cho mọi đơn), **idempotent**.
- Khi lên rất cao: bật **Supavisor connection pooler** + cân nhắc **partition** `ag_orders`/`balance_log` theo tháng, và **read replica** cho báo cáo. Kiến trúc không đổi.

## Các giai đoạn
- **Phase 1 (MVP)** — đăng nhập · gửi link · báo admin · admin dán link · gửi lại khách · lịch sử. ✅
- **Phase 2** — ví hoa hồng · nạp báo cáo đối soát · tự cộng số dư · rút ≥ 20.000đ. ✅
- **Phase 3** — khi Shopee/TikTok mở API phù hợp, thay từng phần thủ công bằng tự động; kiến trúc giữ nguyên (chỉ thêm 1 endpoint bơm đơn vào `ag_orders` rồi gọi `ag_reconcile`). 🔜

## File
```
antigravity/
├── index.html          # toàn bộ app (auth, khách, admin, đối soát)
├── schema.sql          # DB + RLS + RPC (chạy trên Supabase)
├── api/
│   ├── notify-admin.js  # báo admin khi có yêu cầu mới
│   └── import-orders.js # nạp báo cáo + đối soát (bulk, idempotent)
├── manifest.json  sw.js  # PWA
├── vercel.json  package.json
└── icon-*.png  apple-touch-icon.png
```
