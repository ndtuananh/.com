-- ═════════════════════════════════════════════════════════════════════════════
-- RoadAI · Driver Radar (Bạn Uống Tôi Lái) — KHO DỮ LIỆU TRUNG TÂM
-- Chạy trong Supabase → SQL Editor → New query → dán hết → Run.
-- Chạy lại nhiều lần cũng không sao (mọi câu đều "if not exists").
--
-- MỘT NGUỒN SỰ THẬT: đây là nơi giữ dữ liệu NGHIỆP VỤ của tài xế.
--   picks   điểm đón tự nạp + bằng chứng (bao nhiêu cuốc thật ở đó)
--   trips   NHẬT KÝ CUỐC THẬT  ← thêm 12/08/2026, thứ nuôi AI học
--   hidden  điểm đã báo đóng cửa / sai
--   meta    thông tin thiết bị (phiên bản app, nền tảng, lần cuối online)
-- Mỗi MÁY giữ đúng MỘT DÒNG (khoá chính code+device) → 2 máy ghi cùng lúc không
-- đè nhau; /api/pickups gộp các dòng lại khi đọc.
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.butl_sync (
  code       text        not null,               -- MÃ TÀI XẾ (ghép các máy của cùng 1 người)
  device     text        not null,               -- MÃ MÁY (mỗi máy giữ đúng 1 dòng của mình)
  picks      jsonb       not null default '[]'::jsonb,
  hidden     jsonb       not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (code, device)
);

-- ── NÂNG CẤP 12/08/2026 ──────────────────────────────────────────────────────
-- Trước bản này nhật ký cuốc chỉ nằm trong localStorage MỘT máy: ghi 40 cuốc ở
-- máy A thì máy B vẫn ngu như ngày đầu, và 2 máy đưa ra 2 đề xuất khác nhau cho
-- cùng một chỗ đứng. Đó là dữ liệu nghiệp vụ nằm sai chỗ — nay đưa về kho chung.
-- Mỗi cuốc có `id` do máy sinh (idempotency key) nên gửi lại bao nhiêu lần cũng
-- chỉ ra một bản ghi.
alter table public.butl_sync add column if not exists trips jsonb not null default '[]'::jsonb;
alter table public.butl_sync add column if not exists meta  jsonb;

create index if not exists butl_sync_code_idx on public.butl_sync (code);
-- dùng cho câu hỏi rẻ "dữ liệu có đổi không?" (/api/pickups?probe=1)
create index if not exists butl_sync_code_upd_idx on public.butl_sync (code, updated_at desc);

-- ── BẢO MẬT ──────────────────────────────────────────────────────────────────
-- Bật RLS và CỐ TÌNH không tạo policy nào:
--   → khoá anon (nằm công khai trong app) KHÔNG đọc/ghi được dòng nào;
--   → chỉ service_role (chỉ dùng ở /api/pickups chạy trên máy chủ Vercel) đi qua được.
-- App chưa có Supabase Auth, mà mã tài xế là thứ đọc qua Zalo được — nên nếu mở
-- quyền đọc cho anon thì ai cũng đọc được dữ liệu của mọi tài xế. Vì vậy KHÔNG
-- bật Supabase Realtime phía trình duyệt; đồng bộ đi qua /api/pickups (xem
-- js/radar-sync.js, phần "VÌ SAO KHÔNG WEBSOCKET").
alter table public.butl_sync enable row level security;
revoke all on public.butl_sync from anon, authenticated;
