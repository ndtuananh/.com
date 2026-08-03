-- ===========================================================================
-- Lotto Lab — lược đồ Supabase cho Xổ số Miền Nam
--
-- Chạy một lần trong Supabase → SQL Editor → New query → dán toàn bộ → Run.
-- Chạy lại nhiều lần cũng không sao (tất cả đều IF NOT EXISTS).
--
-- Sau đó vào Vercel → Project lotto-lab → Settings → Environment Variables, thêm:
--   SUPABASE_URL               = https://<project-ref>.supabase.co
--   SUPABASE_SERVICE_ROLE_KEY  = <service_role key trong Settings → API>
-- Thiếu hai biến này thì app vẫn chạy bình thường, chỉ là không đẩy lên Supabase.
--
-- LƯU Ý BẢO MẬT: service_role key bỏ qua mọi luật RLS. Chỉ đặt nó ở biến môi trường
-- phía máy chủ (Vercel), TUYỆT ĐỐI không nhúng vào js/ hay html/ — file trong js/ có
-- thể bị tải về từ trình duyệt.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. KẾT QUẢ THÔ — mỗi (ngày, đài) một dòng. Nguồn: minhngoc.net.vn
-- ---------------------------------------------------------------------------
create table if not exists public.xsmn_days (
  draw_date   date        not null,
  slug        text        not null,
  province    text        not null,
  code        text        default '',
  de          text        not null,           -- 2 số cuối giải Đặc Biệt ("đề 2 số")
  lo2         jsonb       not null,           -- 2 số cuối của cả 18 giải ("lô 2 số")
  updated_at  timestamptz not null default now(),
  primary key (draw_date, slug)
);

create index if not exists xsmn_days_slug_date_idx on public.xsmn_days (slug, draw_date desc);
create index if not exists xsmn_days_de_idx        on public.xsmn_days (de);

-- ---------------------------------------------------------------------------
-- 2. SỔ CAM KẾT TRƯỚC — bằng chứng không ngụy tạo được.
--
-- Dòng được GHI khi kỳ đó CHƯA QUAY (made_at < giờ quay), rồi mới được cập nhật cột
-- kết quả sau khi có đáp án. Đây là khác biệt giữa "backtest tự chấm" và "dự báo đã
-- công bố trước". Đừng bao giờ xoá/sửa tay bảng này — sửa một dòng là mất toàn bộ
-- giá trị chứng minh của cả bảng.
-- ---------------------------------------------------------------------------
create table if not exists public.xsmn_commits (
  for_date      date        not null,         -- ngày quay được dự báo
  slug          text        not null,
  province      text        not null,
  made_at       timestamptz not null,         -- dấu thời gian LÚC GHI (trước khi quay)
  de_picks      jsonb       not null,
  de_arm        text,
  de_arm_name   text,
  lo_picks      jsonb       not null,
  lo_arm        text,
  lo_arm_name   text,
  graded_at     timestamptz,                  -- null = đang chờ kết quả
  actual_de     text,
  de_hit        boolean,
  lo_hit        boolean,
  lo_match      jsonb,                        -- những số lô đã về
  distinct_lo   int,                          -- số giá trị lô phân biệt của kỳ đó
  updated_at    timestamptz not null default now(),
  primary key (for_date, slug)
);

create index if not exists xsmn_commits_slug_idx    on public.xsmn_commits (slug, for_date desc);
create index if not exists xsmn_commits_pending_idx on public.xsmn_commits (graded_at) where graded_at is null;

-- ---------------------------------------------------------------------------
-- 3. ẢNH CHỤP TỈ LỆ CHÍNH XÁC theo từng đài, từng ngày.
--
-- `exp_rate` = mốc bốc số mù, tính CHÍNH XÁC theo đúng số lượng số đã cam kết và số
-- giá trị lô phân biệt của chính kỳ đó. Không có cột này thì `rate` là con số rỗng:
-- chơi 10 số bao giờ cũng "về" nhiều hơn chơi 2 số, kể cả khi bốc mù hoàn toàn.
-- ---------------------------------------------------------------------------
create table if not exists public.xsmn_accuracy (
  snapshot_date date  not null,
  slug          text  not null,
  province      text  not null,
  track         text  not null check (track in ('de', 'lo')),
  n             int   not null,               -- cỡ mẫu: số kỳ đã chấm của đài này
  k             int   not null,               -- chơi bao nhiêu số/kỳ
  hits          int   not null,
  rate          numeric(10,6) not null,
  exp_rate      numeric(10,6) not null,       -- mốc bốc mù
  edge          numeric(10,6) not null,       -- rate − exp_rate
  z             numeric(10,4) not null,
  updated_at    timestamptz not null default now(),
  primary key (snapshot_date, slug, track)
);

create index if not exists xsmn_accuracy_slug_idx on public.xsmn_accuracy (slug, track, snapshot_date desc);

-- ---------------------------------------------------------------------------
-- 4. RLS: khoá ghi, mở đọc.
--
-- App ghi bằng service_role (bỏ qua RLS) nên không cần luật ghi. Mở đọc ẩn danh để
-- sau này dựng bảng điều khiển hay xuất báo cáo mà không phải lộ khoá bí mật.
-- ---------------------------------------------------------------------------
alter table public.xsmn_days     enable row level security;
alter table public.xsmn_commits  enable row level security;
alter table public.xsmn_accuracy enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'xsmn_days' and policyname = 'public read') then
    create policy "public read" on public.xsmn_days for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'xsmn_commits' and policyname = 'public read') then
    create policy "public read" on public.xsmn_commits for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'xsmn_accuracy' and policyname = 'public read') then
    create policy "public read" on public.xsmn_accuracy for select using (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. KHUNG NHÌN TIỆN DỤNG — tỉ lệ chính xác mới nhất của từng đài.
--
-- Luôn trả kèm exp_rate và n. Nếu về sau có ai lấy số từ đây đem đi khoe, họ sẽ buộc
-- phải mang theo cả mốc so sánh và cỡ mẫu.
-- ---------------------------------------------------------------------------
create or replace view public.xsmn_accuracy_latest as
select distinct on (slug, track)
  slug, province, track, snapshot_date, n, k, hits, rate, exp_rate, edge, z
from public.xsmn_accuracy
order by slug, track, snapshot_date desc;

-- Tra nhanh: đài nào đang có dấu hiệu vượt bốc mù rõ nhất (|z| lớn, mẫu đủ dày)?
--   select * from xsmn_accuracy_latest where n >= 30 order by z desc limit 10;
