-- ============================================================
-- TRỢ LÝ AFFILIATE - SCHEMA SUPABASE
-- Chạy toàn bộ file này trong Supabase > SQL Editor > Run
-- ============================================================

-- 1. HỒ SƠ NGƯỜI DÙNG (số dư tính bằng đồng)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  phone text unique not null,
  balance bigint not null default 0,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Tự tạo hồ sơ khi có user mới đăng ký
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'phone', new.email));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- 2. LINK ĐÃ TẠO
create table if not exists links (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  original_url text not null,
  aff_url text not null,
  product_title text,
  price bigint,                  -- giá sản phẩm (đ)
  cashback bigint,               -- hoàn tiền 2% (đ)
  status text not null default 'created',  -- created / ordered / credited
  created_at timestamptz not null default now()
);

-- 3. YÊU CẦU RÚT TIỀN
create table if not exists withdrawals (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  amount bigint not null check (amount > 0),
  bank_info text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- ============================================================
-- BẢO MẬT: RLS - mỗi người chỉ thấy dữ liệu của mình
-- ============================================================
alter table profiles enable row level security;
alter table links enable row level security;
alter table withdrawals enable row level security;

-- Hàm kiểm tra admin CHẠY AN TOÀN (security definer -> không kích hoạt lại
-- RLS trên profiles, tránh lỗi "infinite recursion detected in policy").
create or replace function is_admin()
returns boolean language sql security definer stable
set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

create policy "xem ho so cua minh" on profiles
  for select using (auth.uid() = id);

create policy "xem link cua minh" on links
  for select using (auth.uid() = user_id);
create policy "tao link cua minh" on links
  for insert with check (auth.uid() = user_id);

create policy "xem rut cua minh" on withdrawals
  for select using (auth.uid() = user_id);
create policy "tao yeu cau rut" on withdrawals
  for insert with check (auth.uid() = user_id);

-- Admin xem được tất cả (dùng hàm is_admin() an toàn, không đệ quy)
create policy "admin xem het profiles" on profiles for select
  using (is_admin());
create policy "admin xem het withdrawals" on withdrawals for select
  using (is_admin());
create policy "admin xem het links" on links for select
  using (is_admin());

-- ============================================================
-- HÀM RPC AN TOÀN (chỉ admin duyệt được tiền)
-- ============================================================

-- Duyệt hoàn tiền 2% khi đơn hàng hoàn tất
create or replace function credit_cashback(link_id bigint)
returns void language plpgsql security definer as $$
declare l record;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
    raise exception 'Chỉ admin được duyệt';
  end if;
  select * into l from links where id = link_id and status != 'credited' for update;
  if l is null then raise exception 'Link không tồn tại hoặc đã cộng tiền'; end if;
  if coalesce(l.cashback,0) <= 0 then raise exception 'Link chưa có số tiền hoàn'; end if;
  update links set status = 'credited' where id = link_id;
  update profiles set balance = balance + l.cashback where id = l.user_id;
end $$;

-- Duyệt rút tiền: trừ số dư (đánh dấu đã chi)
create or replace function approve_withdrawal(withdrawal_id bigint)
returns void language plpgsql security definer as $$
declare w record; wbal bigint;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
    raise exception 'Chỉ admin được duyệt';
  end if;
  select * into w from withdrawals where id = withdrawal_id and status = 'pending' for update;
  if w is null then raise exception 'Yêu cầu không tồn tại hoặc đã xử lý'; end if;
  if (select balance from profiles where id = w.user_id) < w.amount then
    raise exception 'Số dư không đủ';
  end if;
  update withdrawals set status = 'approved', paid_at = now() where id = withdrawal_id;
  update profiles set balance = balance - w.amount where id = w.user_id
    returning balance into wbal;
  insert into balance_log(user_id,change,balance_after,reason,ref)
    values (w.user_id, -w.amount, wbal, 'withdraw', 'RUT-'||withdrawal_id);
end $$;

-- SỔ AUDIT: ghi lại MỌI thay đổi số dư (cộng hoàn tiền / thu hồi / trừ khi rút)
create table if not exists balance_log (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id) on delete cascade,
  change bigint not null,             -- +cộng / -trừ (đồng)
  balance_after bigint,
  reason text not null,               -- cashback / reverse / withdraw
  ref text,                           -- mã đơn AccessTrade / mã rút
  created_at timestamptz not null default now()
);
alter table balance_log enable row level security;
drop policy if exists "xem log cua minh" on balance_log;
create policy "xem log cua minh" on balance_log for select using (auth.uid() = user_id);
drop policy if exists "admin xem het log" on balance_log;
create policy "admin xem het log" on balance_log for select using (is_admin());

-- ============================================================
-- NÂNG CẤP: ĐỐI SOÁT ĐƠN ACCESSTRADE + THÔNG TIN CHI TRẢ
-- (chạy lại được nhiều lần, an toàn với DB đã có)
-- ============================================================

-- Mỗi link mang 1 MÃ RIÊNG để đối soát đơn về đúng khách
alter table links add column if not exists track_code text;
create index if not exists idx_links_track on links(track_code);

-- Thông tin ngân hàng nhận tiền (khách tự điền) + thời điểm đã chi
alter table withdrawals add column if not exists bank_code text;
alter table withdrawals add column if not exists account_no text;
alter table withdrawals add column if not exists account_name text;
alter table withdrawals add column if not exists paid_at timestamptz;

-- Sổ đối soát: mỗi đơn AccessTrade kéo về 1 dòng (chống trùng bằng at_order_id)
create table if not exists orders (
  id bigint generated always as identity primary key,
  at_order_id text unique not null,       -- mã đơn từ AccessTrade
  user_id uuid references profiles(id) on delete set null,
  link_id bigint references links(id) on delete set null,
  track_code text,
  product_title text,
  order_value bigint,                      -- giá trị đơn (đ)
  pub_commission bigint,                   -- hoa hồng thật của anh (đ)
  cashback bigint,                         -- 2% trả khách (đ)
  status text not null default 'pending',  -- pending / approved / rejected (theo AccessTrade)
  credited boolean not null default false, -- đã cộng 2% vào số dư khách chưa
  sales_time timestamptz,
  created_at timestamptz not null default now()
);
alter table orders enable row level security;
drop policy if exists "xem don cua minh" on orders;
create policy "xem don cua minh" on orders for select using (auth.uid() = user_id);
drop policy if exists "admin xem het orders" on orders;
create policy "admin xem het orders" on orders for select using (is_admin());

-- Cộng 2% cho khách khi đơn AccessTrade đã DUYỆT (idempotent: cộng đúng 1 lần).
-- Chỉ gọi từ server (service_role); đã chặn anon/authenticated gọi trực tiếp.
create or replace function credit_order(p_order_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select * into o from orders where id = p_order_id for update;
  if o is null then return; end if;
  if o.credited then return; end if;                 -- đã cộng rồi
  if o.status <> 'approved' then return; end if;      -- chỉ cộng khi AccessTrade duyệt
  if coalesce(o.cashback,0) <= 0 or o.user_id is null then return; end if;
  update orders set credited = true where id = p_order_id;
  update profiles set balance = balance + o.cashback where id = o.user_id;
end $$;
revoke all on function credit_order(bigint) from public;

-- ĐỐI SOÁT CHUẨN XÁC (2 chiều, idempotent):
--   • đơn 'approved' + chưa cộng  -> cộng 2% vào ví khách
--   • đơn 'rejected' + đã cộng     -> THU HỒI 2% (đơn bị hủy/hoàn sau khi đã cộng)
-- Gọi cho MỌI đơn mỗi lần đồng bộ; hàm tự biết cộng hay thu hồi hay bỏ qua.
create or replace function settle_order(p_order_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare o record; nbal bigint;
begin
  select * into o from orders where id = p_order_id for update;
  if o is null or o.user_id is null then return; end if;

  if o.status = 'approved' and not o.credited and coalesce(o.cashback,0) > 0 then
    update orders set credited = true where id = p_order_id;
    update profiles set balance = balance + o.cashback where id = o.user_id returning balance into nbal;
    insert into balance_log(user_id,change,balance_after,reason,ref)
      values (o.user_id, o.cashback, nbal, 'cashback', o.at_order_id);

  elsif o.status = 'rejected' and o.credited then
    update orders set credited = false where id = p_order_id;
    update profiles set balance = balance - coalesce(o.cashback,0) where id = o.user_id returning balance into nbal;
    insert into balance_log(user_id,change,balance_after,reason,ref)
      values (o.user_id, -coalesce(o.cashback,0), nbal, 'reverse', o.at_order_id);
  end if;
end $$;
revoke all on function settle_order(bigint) from public;

-- PUSH NOTIFICATION: lưu đăng ký thiết bị của user (để đẩy thông báo)
alter table profiles add column if not exists push_sub jsonb;
create or replace function save_push_sub(sub jsonb)
returns void language sql security definer set search_path = public as $$
  update profiles set push_sub = sub where id = auth.uid();
$$;

-- THỐNG KÊ TOÀN APP (chỉ admin gọi được)
create or replace function admin_stats()
returns json language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Chỉ admin'; end if;
  return (select json_build_object(
    'so_khach',      (select count(*) from profiles),
    'tong_so_du',    (select coalesce(sum(balance),0) from profiles),
    'so_link',       (select count(*) from links),
    'link_hom_nay',  (select count(*) from links where created_at >= current_date),
    'so_don',        (select count(*) from orders),
    'tong_hoan',     (select coalesce(sum(cashback),0) from orders where credited),
    'tong_chi',      (select coalesce(sum(amount),0) from withdrawals where status='approved'),
    'rut_cho',       (select count(*) from withdrawals where status='pending')
  ));
end $$;

-- ============================================================
-- SAU KHI CHẠY XONG: đặt tài khoản của bạn làm admin bằng lệnh:
-- update profiles set is_admin = true where phone = 'SĐT_CỦA_BẠN';
-- ============================================================
