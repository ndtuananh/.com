/* RoadAI · Driver Radar — CHẠY MIGRATION KHO DỮ LIỆU (một lệnh, một lần).

   Việc nó làm: thêm 2 cột `trips` và `meta` vào bảng public.butl_sync, để NHẬT KÝ
   CUỐC THẬT đồng bộ được giữa các máy (§31 học toàn cục). Không có 2 cột này thì
   app vẫn chạy y như cũ — /api/pickups tự lùi về bộ cột cũ và báo `tripsReady:false`
   — chỉ là mỗi máy học riêng, đúng cái lỗi kiến trúc đang đi sửa.

   CÁCH CHẠY (trong thư mục roadai):
       SB_PAT=sbp_xxxxxxxx node scripts/supabase-migrate.mjs
   Lấy SB_PAT ở: https://supabase.com/dashboard/account/tokens → Generate new token

   KHÔNG CÓ PAT thì làm tay cũng chỉ mất 20 giây:
       Supabase → project roadai → SQL Editor → New query
       → dán toàn bộ supabase/schema.sql → Run
   Chạy lại nhiều lần đều không sao (mọi câu đều "if not exists").

   Kiểm đã ăn chưa: mở app → ⚙️ Cài đặt → Chẩn đoán hệ thống →
   dòng "Kho cuốc trên máy chủ" phải là "sẵn sàng".
*/
import { readFileSync } from 'node:fs';

const PAT = (process.env.SB_PAT || '').trim();
// ⚠️ ĐÚNG project của roadai-vn. Đừng nhầm với nxvcsotzybjxykadbxbr — đó là project
// antigravity, nằm ở TÀI KHOẢN KHÁC, token bên này không đụng vào được.
const REF = (process.env.SB_REF || 'incugzqdezergjzxwote').trim();

if (!PAT) {
  console.error('THIẾU SB_PAT.\n  SB_PAT=sbp_xxx node scripts/supabase-migrate.mjs\n' +
    '  (hoặc dán supabase/schema.sql vào Supabase → SQL Editor → Run)');
  process.exit(1);
}

const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
console.log('Đang chạy migration trên project ' + REF + '…');
const r = await fetch('https://api.supabase.com/v1/projects/' + REF + '/database/query', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + PAT, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const txt = await r.text();
if (!r.ok) {
  console.error('✗ Lỗi ' + r.status + ': ' + txt.slice(0, 400));
  if (r.status === 401 || r.status === 403) console.error('  → token không có quyền trên project này (xem cảnh báo về 2 tài khoản ở đầu file).');
  process.exit(1);
}
console.log('✓ Xong. Kiểm lại:');
console.log('  curl -s "https://roadai-vn.vercel.app/api/pickups?code=SMOKE123" | grep -o \'"tripsReady":[a-z]*\'');
