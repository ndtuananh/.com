-- RoadAI · Driver Radar (Bạn Uống Tôi Lái) — kho đồng bộ trên Supabase
-- Chạy 1 lần trong Supabase → SQL Editor → New query → dán hết → Run.
-- Chạy lại nhiều lần cũng không sao (đều có "if not exists").

create table if not exists public.butl_sync (
  code       text        not null,               -- MÃ TÀI XẾ (ghép các máy của cùng 1 người)
  device     text        not null,               -- MÃ MÁY (mỗi máy giữ đúng 1 dòng của mình)
  picks      jsonb       not null default '[]'::jsonb,   -- điểm tự nạp + số cuốc thật của máy này
  hidden     jsonb       not null default '[]'::jsonb,   -- điểm đã ẩn (kèm mốc thời gian)
  updated_at timestamptz not null default now(),
  primary key (code, device)
);

create index if not exists butl_sync_code_idx on public.butl_sync (code);

-- BẢO MẬT: bật RLS và CỐ TÌNH không tạo policy nào.
-- → khoá anon (nằm công khai trong app) KHÔNG đọc/ghi được dòng nào.
-- → chỉ service_role (chỉ dùng ở /api/pickups chạy trên máy chủ Vercel) mới đi qua được.
alter table public.butl_sync enable row level security;

-- Không cho anon/authenticated đụng vào bảng này ở mọi đường
revoke all on public.butl_sync from anon, authenticated;
