# HƯỚNG DẪN — TRỢ LÝ AFFILIATE HOÀN TIỀN SHOPEE

App gồm: đăng nhập SĐT · ví số dư · rút tiền (khách tự điền STK) · đổi link Shopee →
link hoa hồng AccessTrade (tự lấy giá) · **đối soát đơn tự động** · chi trả bằng VietQR.

> **Mô hình tiền:** khách KHÔNG nạp. Mỗi link mang 1 mã đối soát riêng (sub1).
> Khi đơn về AccessTrade và được duyệt → hệ thống tự cộng 2% vào số dư đúng khách.
> Số dư ≥ 20.000đ → khách bấm rút (điền ngân hàng) → Admin quét VietQR chuyển tiền.

---

## Bước 1 — Chạy database (Supabase)

1. Vào Supabase project **HOÀN TIỀN SHOPEE** → **SQL Editor** → **New query**
2. Mở file `schema.sql`, copy TOÀN BỘ → dán vào → bấm **Run** (phải thấy "Success")
3. Vào **Authentication → Providers → Email**: BẬT Email, **TẮT "Confirm email"**

> URL + anon key đã điền sẵn trong `index.html`. Chạy `schema.sql` lại nhiều lần vẫn an toàn.

## Bước 2 — Deploy lên Vercel

```
cd aff-app
npx vercel --prod
```
Hoặc đưa lên GitHub → vercel.com → Import → Deploy.

## Bước 3 — Đặt tài khoản của anh làm ADMIN

Mở web vừa deploy → đăng ký bằng SĐT của anh. Rồi vào Supabase → SQL Editor:
```sql
update profiles set is_admin = true where phone = '09xxxxxxxx';
```
Tải lại web → hiện tab **Admin**.

## Bước 4 — Bật ĐỐI SOÁT TỰ ĐỘNG (cộng 2% tự động)

Cần đặt biến môi trường trong **Vercel → Project → Settings → Environment Variables**:

| Tên biến | Lấy ở đâu |
|----------|-----------|
| `SUPABASE_SERVICE_ROLE` | Supabase → Settings → **API Keys** → `service_role` (bí mật, KHÔNG để lộ) |
| `ACCESSTRADE_TOKEN` | AccessTrade → Tool/Cài đặt → **Access Token API** |
| `CRON_SECRET` | Tự đặt 1 chuỗi ngẫu nhiên bất kỳ (VD `matkhau-cron-9382`) |
| `CASHBACK_RATE` | (tùy chọn) mặc định `2` |

Đặt xong bấm **Redeploy**. Từ đó mỗi ngày hệ thống tự kéo đơn (3h sáng), hoặc
admin bấm **🔄 Đồng bộ** trong tab Admin để chạy ngay.

> Kiểm tra khớp field AccessTrade: mở `https://<web>/api/sync-orders?debug=1`
> (đang đăng nhập admin) để xem cấu trúc đơn thật. Nếu mã đối soát nằm ở field khác,
> báo lại là chỉnh 1 dòng trong `api/sync-orders.js`.

## Quy trình vận hành

- Khách dán link Shopee → app tạo link hoa hồng (gắn mã đối soát) + tự lấy giá
- Khách mua → đơn về AccessTrade → **tự cộng 2%** vào số dư khách khi đơn được duyệt
- Khách rút (số dư ≥ 20.000đ): chọn ngân hàng + STK + tên chủ TK
- Admin tab **Chi trả**: bấm **📲 QR** → mở app MBBank quét chuyển → bấm
  **✓ Đã chuyển** để trừ số dư

## Ghi chú

- MBBank chỉ đọc số dư, KHÔNG chuyển tự động → dùng VietQR quét chuyển tay (3 giây/đơn).
- Giá Shopee đôi lúc chống bot → app cho nhập giá tay, mức hoàn 2% tự tính lại.
- Cần cộng tiền tay (khi chưa bật đối soát): tab Admin → "Cộng tiền thủ công (theo link)".
