-- ============================================================================
-- ANTIGRAVITY v2 — SCHEMA (Supabase / PostgreSQL)
-- ============================================================================
-- Nền tảng quản lý YÊU CẦU đổi link affiliate (admin tạo link thủ công),
-- ĐỐI SOÁT đơn hàng, và VÍ hoa hồng.
--
-- An toàn: mọi lệnh đều "if not exists" / "add column if not exists" nên chạy
-- lại nhiều lần không hỏng dữ liệu, và không phá app cũ dùng chung Supabase.
--
-- Chạy: Supabase > SQL Editor > dán toàn bộ > Run.
-- Cuối file có 1 lệnh đặt tài khoản của anh làm admin.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) HỒ SƠ NGƯỜI DÙNG + VÍ
--    available = profiles.balance (số dư rút được)
--    pending   = hoa hồng đơn đã ghi nhận, đang chờ đối soát duyệt
--    paid      = tổng đã chi trả (rút)
--    total     = tổng kiếm được từ trước tới nay
-- ----------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  phone text unique,
  balance bigint not null default 0,           -- Available Balance (đồng)
  is_admin boolean not null default false,
  push_sub jsonb,
  created_at timestamptz not null default now()
);
alter table profiles add column if not exists ag_pending bigint not null default 0; -- Pending Commission
alter table profiles add column if not exists ag_paid    bigint not null default 0; -- Paid Commission
alter table profiles add column if not exists ag_total   bigint not null default 0; -- Total Earned
create index if not exists idx_profiles_admin on profiles(is_admin) where is_admin;

-- REFERRAL: mã giới thiệu duy nhất mỗi user (sinh bằng sequence -> không trùng dù triệu user)
alter table profiles add column if not exists ref_code    text;
alter table profiles add column if not exists referred_by uuid references profiles(id) on delete set null;
create sequence if not exists ag_ref_seq start 1000;
create unique index if not exists idx_profiles_refcode on profiles(ref_code) where ref_code is not null;
create index if not exists idx_profiles_refby on profiles(referred_by) where referred_by is not null;
-- gán mã cho user cũ còn thiếu
update profiles set ref_code = 'R'||lpad(nextval('ag_ref_seq')::text,7,'0') where ref_code is null;

-- Tự tạo hồ sơ + mã giới thiệu khi có user đăng ký mới
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, phone, ref_code)
  values (new.id, coalesce(new.raw_user_meta_data->>'phone', new.email),
          'R'||lpad(nextval('ag_ref_seq')::text,7,'0'))
  on conflict (id) do nothing;
  return new;
end $$;

-- Số bạn bè mình đã giới thiệu (RLS chặn user đọc profile người khác -> cần RPC)
create or replace function ag_my_referrals()
returns int language sql security definer set search_path = public as $$
  select count(*)::int from profiles where referred_by = auth.uid();
$$;

-- Khách nhập mã giới thiệu (1 lần, không tự giới thiệu chính mình)
create or replace function ag_set_referrer(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ref uuid;
begin
  if auth.uid() is null then return; end if;
  if (select referred_by from profiles where id = auth.uid()) is not null then return; end if;
  select id into v_ref from profiles where ref_code = upper(trim(p_code));
  if v_ref is null or v_ref = auth.uid() then return; end if;
  update profiles set referred_by = v_ref where id = auth.uid() and referred_by is null;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();

-- Kiểm tra admin an toàn (không đệ quy RLS)
create or replace function is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- ----------------------------------------------------------------------------
-- 2) YÊU CẦU ĐỔI LINK  — mã duy nhất AG000001, AG000002 ...
--    Sinh mã bằng SEQUENCE (nguyên tử, không đua/không trùng dù triệu user).
-- ----------------------------------------------------------------------------
create sequence if not exists ag_request_seq start 1;

create table if not exists ag_requests (
  id           bigint generated always as identity primary key,
  code         text unique not null,                 -- AG000001
  user_id      uuid not null references profiles(id) on delete cascade,
  platform     text not null,                         -- shopee | tiktok
  original_url text not null,
  aff_url      text,                                  -- admin dán vào (thủ công)
  track_code   text,                                  -- = code, dùng đối soát (sub_id / utm_content)
  status       text not null default 'pending',       -- pending | completed | rejected
  note         text,
  processed_by uuid references profiles(id),
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists idx_ag_req_user   on ag_requests(user_id, created_at desc);
create index if not exists idx_ag_req_status on ag_requests(status, created_at desc);
create index if not exists idx_ag_req_track  on ag_requests(track_code);

-- Gán mã AGxxxxxx + ép user_id = người đang đăng nhập (không cho giả mạo)
create or replace function ag_assign_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.code is null or new.code = '' then
    new.code := 'AG' || lpad(nextval('ag_request_seq')::text, 6, '0');
  end if;
  new.track_code := new.code;
  if auth.uid() is not null then new.user_id := auth.uid(); end if;
  new.status := 'pending';
  new.aff_url := null;
  return new;
end $$;
drop trigger if exists trg_ag_assign_code on ag_requests;
create trigger trg_ag_assign_code before insert on ag_requests
  for each row execute function ag_assign_code();

-- KHUYẾN MÃI CHÀO MỪNG: 10.000đ cho 300 user ĐẦU TIÊN khi tạo link đầu tiên.
-- Ngân sách tối đa 300 × 10.000 = 3.000.000đ. Idempotent (1 lần/user) + có trần 300.
-- (Ngưỡng rút 20.000đ khiến 10k welcome không rút được một mình -> chống bot.)
create or replace function ag_grant_welcome(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare nbal bigint;
begin
  if p_user is null then return; end if;
  -- Kết thúc khi ĐẾN TRƯỚC: hết 300 suất, HOẶC quá 23:59 ngày 31/07/2026 (giờ VN).
  if now() >= timestamptz '2026-08-01 00:00:00+07' then return; end if;
  if exists (select 1 from balance_log where user_id = p_user and reason = 'welcome') then return; end if;
  if (select count(*) from balance_log where reason = 'welcome') >= 300 then return; end if;
  update profiles set balance = balance + 10000, ag_total = ag_total + 10000
    where id = p_user returning balance into nbal;
  insert into balance_log(user_id, change, balance_after, reason, ref)
    values (p_user, 10000, nbal, 'welcome', 'WELCOME300');
end $$;

create or replace function ag_after_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform ag_grant_welcome(new.user_id);
  return new;
end $$;
drop trigger if exists trg_ag_after_request on ag_requests;
create trigger trg_ag_after_request after insert on ag_requests
  for each row execute function ag_after_request();

-- Đếm số suất welcome đã phát (để hiển thị "còn N suất")
create or replace function ag_welcome_left()
returns int language sql security definer set search_path = public as $$
  select case when now() >= timestamptz '2026-08-01 00:00:00+07' then 0
    else greatest(300 - (select count(*)::int from balance_log where reason = 'welcome'), 0) end;
$$;

-- ----------------------------------------------------------------------------
-- 3) ĐỐI SOÁT ĐƠN  — nạp từ báo cáo AccessTrade (Shopee + TikTok)
--    Chống trùng bằng order_id (unique). Khớp về user qua track_code = mã AG.
-- ----------------------------------------------------------------------------
create table if not exists ag_orders (
  id              bigint generated always as identity primary key,
  order_id        text unique not null,              -- "Order id" trong báo cáo
  track_code      text,                              -- sub_id / utm_content = mã AG
  request_id      bigint references ag_requests(id) on delete set null,
  user_id         uuid references profiles(id) on delete set null,
  platform        text,                              -- shopee | tiktok
  shop_name       text,
  product_title   text,
  order_value     bigint,                            -- Giá trị đơn hàng (đồng)
  commission      bigint,                            -- Hoa hồng đơn hàng — tổng (đồng)
  user_commission bigint,                            -- phần chia cho user (đồng)
  status          text not null default 'pending',   -- pending | approved | rejected
  wallet_state    text not null default 'none',      -- none | pending | available | reversed
  order_time      timestamptz,
  imported_at     timestamptz not null default now()
);
create index if not exists idx_ag_ord_user  on ag_orders(user_id, imported_at desc);
create index if not exists idx_ag_ord_track on ag_orders(track_code);
create index if not exists idx_ag_ord_settle on ag_orders(status, wallet_state);

-- ----------------------------------------------------------------------------
-- 4) RÚT TIỀN
-- ----------------------------------------------------------------------------
create table if not exists withdrawals (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references profiles(id) on delete cascade,
  amount       bigint not null check (amount >= 20000),   -- tối thiểu 20.000đ
  bank_code    text,
  account_no   text,
  account_name text,
  bank_info    text,
  status       text not null default 'pending',           -- pending | approved | rejected
  created_at   timestamptz not null default now(),
  paid_at      timestamptz
);
create index if not exists idx_wd_user   on withdrawals(user_id, created_at desc);
create index if not exists idx_wd_status on withdrawals(status, created_at desc);

-- ----------------------------------------------------------------------------
-- 5) SỔ QUỸ (mọi thay đổi số dư) + THÔNG BÁO + AUDIT
-- ----------------------------------------------------------------------------
create table if not exists balance_log (
  id            bigint generated always as identity primary key,
  user_id       uuid references profiles(id) on delete cascade,
  change        bigint not null,
  balance_after bigint,
  reason        text not null,             -- cashback | reverse | withdraw
  ref           text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_blog_user on balance_log(user_id, created_at desc);

create table if not exists notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid references profiles(id) on delete cascade,  -- null = cho admin
  kind       text not null,                -- new_request | completed | withdraw | order
  title      text,
  body       text,
  ref        text,
  seen       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notif_user on notifications(user_id, created_at desc);
create index if not exists idx_notif_admin on notifications(created_at desc) where user_id is null;

create table if not exists audit_logs (
  id         bigint generated always as identity primary key,
  actor      uuid references profiles(id),
  action     text not null,
  target     text,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_time on audit_logs(created_at desc);

-- ============================================================================
-- BẢO MẬT: ROW LEVEL SECURITY
-- ============================================================================
alter table profiles      enable row level security;
alter table ag_requests   enable row level security;
alter table ag_orders     enable row level security;
alter table withdrawals   enable row level security;
alter table balance_log   enable row level security;
alter table notifications enable row level security;
alter table audit_logs    enable row level security;

drop policy if exists p_prof_self  on profiles;
drop policy if exists p_prof_admin on profiles;
create policy p_prof_self  on profiles for select using (auth.uid() = id);
create policy p_prof_admin on profiles for select using (is_admin());

drop policy if exists p_req_self_sel on ag_requests;
drop policy if exists p_req_self_ins on ag_requests;
drop policy if exists p_req_admin    on ag_requests;
create policy p_req_self_sel on ag_requests for select using (auth.uid() = user_id);
create policy p_req_self_ins on ag_requests for insert with check (auth.uid() = user_id);
create policy p_req_admin    on ag_requests for select using (is_admin());

-- Khách KHÔNG đọc ag_orders (ẩn công thức chia hoa hồng: tổng HH + tỷ lệ).
-- Khách chỉ thấy SỐ TIỀN được cộng qua balance_log. Chỉ admin xem đơn đối soát.
drop policy if exists p_ord_self  on ag_orders;
drop policy if exists p_ord_admin on ag_orders;
create policy p_ord_admin on ag_orders for select using (is_admin());

drop policy if exists p_wd_self_sel on withdrawals;
drop policy if exists p_wd_self_ins on withdrawals;
drop policy if exists p_wd_admin    on withdrawals;
create policy p_wd_self_sel on withdrawals for select using (auth.uid() = user_id);
create policy p_wd_self_ins on withdrawals for insert with check (auth.uid() = user_id);
create policy p_wd_admin    on withdrawals for select using (is_admin());

drop policy if exists p_blog_self  on balance_log;
drop policy if exists p_blog_admin on balance_log;
create policy p_blog_self  on balance_log for select using (auth.uid() = user_id);
create policy p_blog_admin on balance_log for select using (is_admin());

drop policy if exists p_notif_self  on notifications;
drop policy if exists p_notif_admin on notifications;
create policy p_notif_self  on notifications for select using (auth.uid() = user_id);
create policy p_notif_admin on notifications for select using (is_admin());

drop policy if exists p_audit_admin on audit_logs;
create policy p_audit_admin on audit_logs for select using (is_admin());

-- ============================================================================
-- RPC — chỉ admin mới đụng được tiền / duyệt yêu cầu
-- ============================================================================

-- Admin hoàn tất yêu cầu: dán link affiliate, chuyển sang Completed.
create or replace function ag_complete_request(p_id bigint, p_aff_url text)
returns ag_requests language plpgsql security definer set search_path = public as $$
declare r ag_requests;
begin
  if not is_admin() then raise exception 'Chỉ admin'; end if;
  if coalesce(p_aff_url,'') = '' then raise exception 'Thiếu link affiliate'; end if;
  update ag_requests
     set aff_url = p_aff_url, status = 'completed',
         processed_by = auth.uid(), processed_at = now()
   where id = p_id and status <> 'completed'
   returning * into r;
  if r is null then raise exception 'Yêu cầu không tồn tại hoặc đã xử lý'; end if;
  -- KHÁCH KHÔNG có thông báo (theo yêu cầu). Chỉ ghi audit cho admin.
  insert into audit_logs(actor, action, target, detail)
    values (auth.uid(), 'complete_request', r.code, jsonb_build_object('aff_url', p_aff_url));
  return r;
end $$;

create or replace function ag_reject_request(p_id bigint, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r ag_requests;
begin
  if not is_admin() then raise exception 'Chỉ admin'; end if;
  update ag_requests set status='rejected', note=p_note, processed_by=auth.uid(), processed_at=now()
   where id=p_id and status='pending' returning * into r;
  if r is null then raise exception 'Không xử lý được'; end if;
  -- KHÁCH KHÔNG có thông báo. Khách tự xem trạng thái trong app.
end $$;

-- Lưu đăng ký push của thiết bị
create or replace function save_push_sub(sub jsonb)
returns void language sql security definer set search_path = public as $$
  update profiles set push_sub = sub where id = auth.uid();
$$;

-- Duyệt rút tiền: trừ số dư khả dụng, cộng "đã chi", ghi sổ quỹ.
create or replace function approve_withdrawal(withdrawal_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare w withdrawals; nbal bigint;
begin
  if not is_admin() then raise exception 'Chỉ admin'; end if;
  select * into w from withdrawals where id = withdrawal_id and status='pending' for update;
  if w is null then raise exception 'Yêu cầu không tồn tại hoặc đã xử lý'; end if;
  if (select balance from profiles where id = w.user_id) < w.amount then
    raise exception 'Số dư không đủ';
  end if;
  update withdrawals set status='approved', paid_at=now() where id = withdrawal_id;
  update profiles set balance = balance - w.amount, ag_paid = ag_paid + w.amount
    where id = w.user_id returning balance into nbal;
  insert into balance_log(user_id,change,balance_after,reason,ref)
    values (w.user_id, -w.amount, nbal, 'withdraw', 'RUT-'||withdrawal_id);
  insert into audit_logs(actor,action,target,detail)
    values (auth.uid(),'approve_withdrawal','RUT-'||withdrawal_id, jsonb_build_object('amount',w.amount));
end $$;

create or replace function reject_withdrawal(withdrawal_id bigint, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Chỉ admin'; end if;
  update withdrawals set status='rejected', paid_at=now() where id=withdrawal_id and status='pending';
end $$;

-- ============================================================================
-- ĐỐI SOÁT SET-BASED (chạy 1 lệnh cho MỌI đơn — chịu tải triệu đơn)
--   Gọi từ server (service_role) sau khi import báo cáo, hoặc bằng cron.
--   p_hold_days: số ngày "giam" hoa hồng ở Pending trước khi cho rút.
--   Idempotent: gọi lại bao nhiêu lần cũng ra đúng số dư.
-- ============================================================================
create or replace function ag_reconcile(p_hold_days int default 7)
returns json language plpgsql security definer set search_path = public as $$
declare v_to_pending bigint := 0; v_to_avail bigint := 0; v_reversed bigint := 0;
begin
  -- (1) approved + chưa vào ví  ->  PENDING
  with moved as (
    update ag_orders o set wallet_state='pending'
      where o.status='approved' and o.wallet_state='none'
            and o.user_id is not null and coalesce(o.user_commission,0) > 0
      returning o.user_id, o.user_commission
  ), agg as (select user_id, sum(user_commission) s from moved group by user_id)
  update profiles p set ag_pending = ag_pending + agg.s
    from agg where p.id = agg.user_id;
  get diagnostics v_to_pending = row_count;

  -- (2) approved + PENDING + đã quá hạn giam  ->  AVAILABLE (rút được)
  with matured as (
    update ag_orders o set wallet_state='available'
      where o.status='approved' and o.wallet_state='pending'
            and coalesce(o.order_time, o.imported_at) < now() - (p_hold_days || ' days')::interval
      returning o.id, o.user_id, o.user_commission, o.order_id
  ), agg as (select user_id, sum(user_commission) s from matured group by user_id)
  update profiles p set ag_pending = greatest(ag_pending - agg.s,0),
                        balance    = balance + agg.s,
                        ag_total   = ag_total + agg.s
    from agg where p.id = agg.user_id;
  insert into balance_log(user_id,change,balance_after,reason,ref)
    select m.user_id, m.user_commission,
           (select balance from profiles where id=m.user_id), 'cashback', m.order_id
    from ag_orders m where m.wallet_state='available' and m.status='approved'
      and not exists (select 1 from balance_log b where b.ref=m.order_id and b.reason='cashback');

  -- (3) rejected khi đang PENDING  ->  gỡ khỏi pending
  with rev as (
    update ag_orders o set wallet_state='reversed'
      where o.status='rejected' and o.wallet_state='pending'
      returning o.user_id, o.user_commission
  ), agg as (select user_id, sum(user_commission) s from rev group by user_id)
  update profiles p set ag_pending = greatest(ag_pending - agg.s,0)
    from agg where p.id = agg.user_id;

  -- (4) rejected khi đã AVAILABLE  ->  THU HỒI khỏi số dư
  with rev as (
    update ag_orders o set wallet_state='reversed'
      where o.status='rejected' and o.wallet_state='available'
      returning o.user_id, o.user_commission, o.order_id
  ), agg as (select user_id, sum(user_commission) s from rev group by user_id)
  update profiles p set balance  = balance  - agg.s,
                        ag_total = greatest(ag_total - agg.s,0)
    from agg where p.id = agg.user_id;
  get diagnostics v_reversed = row_count;

  -- đánh dấu mã đơn khách đã nhận là "đã đối soát" khi đơn đã vào ví
  update ag_claims c set matched = true from ag_orders o
    where c.order_id = o.order_id and o.wallet_state = 'available' and not c.matched;

  return json_build_object('to_pending',v_to_pending,'reversed',v_reversed,'hold_days',p_hold_days);
end $$;
revoke all on function ag_reconcile(int) from public;

-- THƯỞNG GIỚI THIỆU (tách riêng khỏi ag_reconcile để KHÔNG ảnh hưởng luồng cộng hoa hồng đã
-- kiểm chứng). 5.000đ/1 lần cho người giới thiệu khi khách được giới thiệu có hoa hồng đầu tiên.
-- Idempotent theo ref='refbonus:<referee>'. Gọi sau ag_reconcile / sau khi cộng ví bằng claim.
create or replace function ag_referral_bonus()
returns void language plpgsql security definer set search_path = public as $$
begin
  with newref as (
    select distinct p.referred_by as ref_uid, p.id as referee
    from profiles p
    where p.referred_by is not null
      -- KHÔNG BAO GIỜ LỖ + chống farm ảo: chỉ thưởng khi bạn được giới thiệu đã tích
      -- HOA HỒNG THẬT ≥ 5.000đ (welcome KHÔNG tính). Lúc đó app đã lãi ≥5.000đ từ
      -- khách này (chia 50/50) nên chi 5.000đ referral vẫn net ≥ 0.
      and coalesce((select sum(c.change) from balance_log c
                    where c.user_id = p.id and c.reason = 'cashback'), 0) >= 5000
      and not exists (select 1 from balance_log b where b.reason='referral' and b.ref='refbonus:'||p.id::text)
      -- trần 100 lượt/người giới thiệu (tối đa 500k) -> bao ngân sách
      and (select count(*) from balance_log b3 where b3.user_id = p.referred_by and b3.reason='referral') < 100
  ), ins as (
    insert into balance_log(user_id, change, balance_after, reason, ref)
      select ref_uid, 5000, null, 'referral', 'refbonus:'||referee::text from newref
      returning user_id, change
  )
  update profiles pr set balance = balance + agg.s, ag_total = ag_total + agg.s
    from (select user_id, sum(change) s from ins group by user_id) agg
    where pr.id = agg.user_id;
end $$;
revoke all on function ag_referral_bonus() from public;

-- ============================================================================
-- THỐNG KÊ TỔNG QUAN (admin)
-- ============================================================================
create or replace function admin_stats()
returns json language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Chỉ admin'; end if;
  return (select json_build_object(
    'so_khach',      (select count(*) from profiles),
    'req_cho',       (select count(*) from ag_requests where status='pending'),
    'req_xong',      (select count(*) from ag_requests where status='completed'),
    'req_hom_nay',   (select count(*) from ag_requests where created_at >= current_date),
    'so_don',        (select count(*) from ag_orders),
    'tong_hoan',     (select coalesce(sum(user_commission),0) from ag_orders where wallet_state='available'),
    'tong_so_du',    (select coalesce(sum(balance),0) from profiles),
    'tong_pending',  (select coalesce(sum(ag_pending),0) from profiles),
    'tong_chi',      (select coalesce(sum(amount),0) from withdrawals where status='approved'),
    'rut_cho',       (select count(*) from withdrawals where status='pending')
  ));
end $$;

-- ANALYTICS: bảng xếp hạng (Module 12) — chỉ admin
create or replace function admin_top()
returns json language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Chỉ admin'; end if;
  return json_build_object(
    'top_earners', (select coalesce(json_agg(t),'[]') from (
        select phone, ag_total from profiles where ag_total>0 order by ag_total desc limit 8) t),
    'by_platform', (select coalesce(json_agg(t),'[]') from (
        select platform, count(*) don, coalesce(sum(user_commission),0) hh
        from ag_orders where wallet_state='available' group by platform order by hh desc) t),
    'top_products', (select coalesce(json_agg(t),'[]') from (
        select product_title ten, count(*) don, coalesce(sum(user_commission),0) hh
        from ag_orders where wallet_state='available' and product_title is not null and product_title<>''
        group by product_title order by hh desc limit 8) t)
  );
end $$;

-- CRM: danh sách khách hàng (Module 11) — chỉ admin, có tìm kiếm theo SĐT
create or replace function admin_customers(p_q text default null)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Chỉ admin'; end if;
  return (select coalesce(json_agg(t),'[]') from (
    select p.phone, p.balance, p.ag_pending, p.ag_total, p.ref_code, p.created_at,
           (select count(*) from profiles c where c.referred_by = p.id) as refs,
           (select count(*) from ag_requests r where r.user_id = p.id) as reqs
    from profiles p
    where p_q is null or p_q = '' or p.phone ilike '%'||p_q||'%'
    order by p.ag_total desc, p.created_at desc
    limit 100) t);
end $$;

-- ============================================================================
-- KHÁCH NHẬP MÃ ĐƠN (claim) — cách khớp đơn về khách cho CẢ Shopee + TikTok.
--   TikTok không có Sub_id nên không tự khớp qua link được. Khách tự dán mã đơn
--   sau khi mua; khi nạp báo cáo, hệ thống khớp order_id ↔ mã khách đã nhập.
--   Mỗi mã đơn chỉ 1 người nhận (unique) → chống 2 khách nhận trùng.
-- ============================================================================
create table if not exists ag_claims (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  request_id bigint references ag_requests(id) on delete set null,
  order_id   text unique not null,               -- mã đơn khách dán vào
  platform   text,
  matched    boolean not null default false,     -- đã đối soát & cộng tiền chưa
  created_at timestamptz not null default now()
);
create index if not exists idx_ag_claims_user  on ag_claims(user_id, created_at desc);
create index if not exists idx_ag_claims_order on ag_claims(order_id);

alter table ag_claims enable row level security;
drop policy if exists p_claim_self_sel on ag_claims;
drop policy if exists p_claim_admin    on ag_claims;
create policy p_claim_self_sel on ag_claims for select using (auth.uid() = user_id);
create policy p_claim_admin    on ag_claims for select using (is_admin());
-- (không cho insert trực tiếp; đi qua RPC ag_claim_order để kiểm tra trùng)

-- Cộng hoa hồng cho ĐÚNG 1 đơn (idempotent). Dùng khi khách nhận mã sau khi
-- báo cáo đã nạp (truy hồi cộng bù ngay), hoặc gọi nội bộ.
create or replace function ag_credit_one(p_order_id text)
returns void language plpgsql security definer set search_path = public as $$
declare o ag_orders; nbal bigint;
begin
  select * into o from ag_orders where order_id = p_order_id for update;
  if o is null or o.user_id is null then return; end if;
  if o.status = 'approved' and o.wallet_state in ('none','pending') and coalesce(o.user_commission,0) > 0 then
    if o.wallet_state = 'pending' then
      update profiles set ag_pending = greatest(ag_pending - o.user_commission, 0) where id = o.user_id;
    end if;
    update ag_orders set wallet_state = 'available' where order_id = p_order_id;
    if not exists (select 1 from balance_log where ref = p_order_id and reason = 'cashback') then
      update profiles set balance = balance + o.user_commission, ag_total = ag_total + o.user_commission
        where id = o.user_id returning balance into nbal;
      insert into balance_log(user_id, change, balance_after, reason, ref)
        values (o.user_id, o.user_commission, nbal, 'cashback', o.order_id);
    end if;
    update ag_claims set matched = true where order_id = p_order_id;
  end if;
end $$;

-- Khách nhận 1 mã đơn. Trả về mã đơn nếu ok. Tự truy hồi cộng bù nếu đơn đã có.
create or replace function ag_claim_order(p_order_id text, p_request_id bigint default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;        -- chủ claim hiện tại (nếu có)
  v_ord_owner uuid;    -- chủ đơn trong ag_orders (thường do mã AG gán — chống giả)
  v_pending int;       -- số claim CHƯA khớp đang treo
  v_today int;         -- số claim trong 24h
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  p_order_id := upper(regexp_replace(coalesce(p_order_id,''), '\s', '', 'g'));
  -- CHỐNG GIAN LẬN 0: định dạng mã đơn hợp lệ (chỉ chữ+số, 6–32 ký tự)
  if p_order_id !~ '^[A-Z0-9]{6,32}$' then raise exception 'Ma don khong hop le'; end if;

  -- CHỐNG GIAN LẬN 1: mã đơn đã được TÀI KHOẢN KHÁC ghi nhận trước → chặn cướp
  select user_id into v_owner from ag_claims where order_id = p_order_id;
  if v_owner is not null and v_owner <> v_uid then
    raise exception 'Ma don da duoc tai khoan khac ghi nhan';
  end if;

  -- CHỐNG GIAN LẬN 2: đơn đã thuộc về KHÁCH KHÁC qua mã AG (Sub_id, không thể giả) → không cho claim đè
  select user_id into v_ord_owner from ag_orders where order_id = p_order_id;
  if v_ord_owner is not null and v_ord_owner <> v_uid then
    raise exception 'Ma don da thuoc ve khach khac qua ma AG';
  end if;

  -- CHỐNG GIAN LẬN 3: chặn dò mã hàng loạt — tối đa 20 claim CHƯA khớp đang treo
  select count(*) into v_pending from ag_claims
    where user_id = v_uid and matched = false;
  if v_pending >= 20 then
    raise exception 'Ban co qua nhieu ma don chua khop (limit) — cho doi soat roi thu lai';
  end if;

  -- CHỐNG GIAN LẬN 4: giới hạn tần suất — tối đa 40 claim / 24 giờ
  select count(*) into v_today from ag_claims
    where user_id = v_uid and created_at > now() - interval '24 hours';
  if v_today >= 40 then
    raise exception 'Ban da ghi nhan qua nhieu ma don hom nay (limit) — thu lai sau';
  end if;

  -- CHỐNG GIAN LẬN 5: request (nếu truyền) phải là của chính khách
  if p_request_id is not null and not exists(
       select 1 from ag_requests where id = p_request_id and user_id = v_uid) then
    raise exception 'Yeu cau khong hop le';
  end if;

  insert into ag_claims(user_id, request_id, order_id, platform)
    values (v_uid, p_request_id, p_order_id,
            (select platform from ag_requests where id = p_request_id))
    on conflict (order_id) do update set request_id = coalesce(excluded.request_id, ag_claims.request_id);
  -- gán khách cho đơn đã nạp trước đó (chỉ khi đơn chưa có chủ) rồi cộng bù ngay
  update ag_orders set user_id = v_uid
    where order_id = p_order_id and user_id is null;
  perform ag_credit_one(p_order_id);
  perform ag_referral_bonus();
  return p_order_id;
end $$;

-- ============================================================================
-- SAU KHI CHẠY XONG — đặt tài khoản của anh làm admin (đổi SĐT của anh):
--   update profiles set is_admin = true where phone = '09xxxxxxxx';
-- ============================================================================

-- ============================================================================
-- REALTIME: cho phép khách nhận thông báo NGAY khi admin bấm "Hoàn tất" link.
-- (idempotent — chạy lại không lỗi)
do $$
begin
  begin
    alter publication supabase_realtime add table ag_requests;
  exception
    when duplicate_object then null;   -- đã có trong publication
    when undefined_object then null;   -- publication chưa tồn tại (bỏ qua)
  end;
end $$;
