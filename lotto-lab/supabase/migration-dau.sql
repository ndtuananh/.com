-- ===========================================================================
-- Bản vá 04/08/2026 — thêm đường ĐẦU (2 số giải Tám).
--
-- Chạy trong Supabase → SQL Editor → New query → dán → Run.
-- Chạy lại nhiều lần không sao (tất cả đều "if not exists").
--
-- Trước bản vá này app chỉ theo dõi ĐUÔI (2 số cuối giải Đặc Biệt) và LÔ. Nay có thêm
-- ĐẦU, tức là bộ "đầu đuôi" quen thuộc đã đủ cặp.
--
-- App vẫn chạy bình thường nếu chưa chạy file này: xsmn-supabase.js phát hiện thiếu cột
-- thì tự bỏ phần ĐẦU rồi đẩy lại, và báo "dauColumns: thiếu" trong ngăn kéo kỹ thuật.
-- Chỉ là phần ĐẦU chưa được lưu lên Supabase mà thôi.
-- ===========================================================================

alter table public.xsmn_commits add column if not exists dau_picks    jsonb;
alter table public.xsmn_commits add column if not exists dau_arm      text;
alter table public.xsmn_commits add column if not exists dau_arm_name text;
alter table public.xsmn_commits add column if not exists actual_dau   text;
alter table public.xsmn_commits add column if not exists dau_hit      boolean;

-- Cột `track` giờ nhận thêm giá trị 'dau'. Ràng buộc cũ chỉ cho ('de','lo') nên phải
-- thay, nếu không mọi dòng tỉ lệ của đường ĐẦU sẽ bị Postgres từ chối.
alter table public.xsmn_accuracy drop constraint if exists xsmn_accuracy_track_check;
alter table public.xsmn_accuracy add  constraint xsmn_accuracy_track_check
  check (track in ('dau', 'de', 'lo'));

-- Tra nhanh sau khi app đã đẩy:
--   select * from xsmn_accuracy_latest where track = 'dau' order by n desc;
--   select for_date, province, dau_picks, actual_dau, dau_hit
--     from xsmn_commits where dau_hit is not null order by for_date desc limit 20;
