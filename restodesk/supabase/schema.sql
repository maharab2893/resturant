-- =====================================================================
--  RestoDesk — Supabase schema
--  Paste this whole file into: Supabase Dashboard → SQL Editor → New query → Run
--  Safe to run on a fresh project. (To re-run, drop the tables first.)
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. PROFILES  (one row per staff login; linked to Supabase Auth)
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text,
  role        text not null default 'staff'
              check (role in ('admin','cashier','kitchen','staff')),
  is_active   boolean not null default false,   -- new users must be approved by an admin
  created_at  timestamptz not null default now()
);

-- The FIRST user who ever signs up becomes an active admin.
-- Every later user is created as an inactive 'staff' until an admin approves them.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_first boolean;
begin
  select not exists (select 1 from public.profiles) into is_first;

  insert into public.profiles (id, full_name, email, role, is_active)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
    new.email,
    case when is_first then 'admin' else 'staff' end,
    is_first
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 2. ROLE HELPERS (security definer → no RLS recursion)
-- ---------------------------------------------------------------------
create or replace function public.current_role_name()
returns text
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.current_role_name() is not null
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.current_role_name() = 'admin', false)
$$;

create or replace function public.has_role(roles text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.current_role_name() = any(roles), false)
$$;

-- ---------------------------------------------------------------------
-- 3. SETTINGS (single row)
-- ---------------------------------------------------------------------
create table public.settings (
  id               int primary key default 1 check (id = 1),
  restaurant_name  text not null default 'My Restaurant',
  address          text not null default '',
  phone            text not null default '',
  currency         text not null default '$',
  tax_rate         numeric(5,2) not null default 5.00 check (tax_rate >= 0 and tax_rate <= 100),
  receipt_footer   text not null default 'Thank you for dining with us!',
  updated_at       timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------
-- 4. RESTAURANT TABLES (dining tables)
-- ---------------------------------------------------------------------
create table public.restaurant_tables (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  seats       int  not null default 4 check (seats > 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
insert into public.restaurant_tables (name, seats)
select 'Table ' || n, case when n <= 4 then 2 when n <= 8 then 4 else 6 end
from generate_series(1, 10) as n;

-- ---------------------------------------------------------------------
-- 5. INVENTORY (menu items + stock + recipe cost)
-- ---------------------------------------------------------------------
create table public.inventory (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  category             text not null default 'Mains',
  description          text,
  price                numeric(10,2) not null check (price >= 0),
  recipe_cost          numeric(10,2) not null default 0 check (recipe_cost >= 0),
  stock_qty            numeric(12,2) not null default 0,
  unit                 text not null default 'pcs',
  low_stock_threshold  numeric(12,2) not null default 5,
  track_stock          boolean not null default true,
  is_available         boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index inventory_category_idx on public.inventory (category);
create index inventory_name_idx on public.inventory (lower(name));

-- ---------------------------------------------------------------------
-- 6. ORDERS + ORDER ITEMS
-- ---------------------------------------------------------------------
create sequence public.order_number_seq start with 1001 minvalue 1001;

create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  tracking_no     text not null unique,                      -- A-1001, A-1002, ...
  order_type      text not null default 'walk_in' check (order_type in ('walk_in','dine_in')),
  table_id        uuid references public.restaurant_tables(id) on delete set null,
  table_name      text,
  customer_name   text,
  status          text not null default 'incoming'
                  check (status in ('incoming','preparing','ready','completed','cancelled')),
  payment_status  text not null default 'unpaid' check (payment_status in ('unpaid','paid')),
  payment_method  text check (payment_method in ('cash','card','mobile')),
  subtotal        numeric(12,2) not null default 0,
  tax_rate        numeric(5,2)  not null default 0,
  tax_amount      numeric(12,2) not null default 0,
  discount        numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  notes           text,
  created_by      uuid references auth.users(id) default auth.uid(),
  cashier_name    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  paid_at         timestamptz,
  completed_at    timestamptz
);
create index orders_created_idx on public.orders (created_at desc);
create index orders_status_idx  on public.orders (status);

create table public.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  item_id     uuid references public.inventory(id) on delete set null,
  item_name   text not null,
  category    text,
  unit_price  numeric(10,2) not null,
  unit_cost   numeric(10,2) not null default 0,
  quantity    int not null check (quantity > 0),
  line_total  numeric(12,2) not null
);
create index order_items_order_idx on public.order_items (order_id);

-- Always generate the tracking number on the server: "A-" + next number
create or replace function public.set_tracking_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.tracking_no := 'A-' || nextval('public.order_number_seq');
  return new;
end;
$$;

create trigger orders_set_tracking_no
  before insert on public.orders
  for each row execute function public.set_tracking_no();

-- Keep timestamps in sync and put stock back when an order is cancelled
create or replace function public.orders_status_hooks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();

  if new.status = 'completed' and old.status <> 'completed' then
    new.completed_at := now();
  end if;

  if new.payment_status = 'paid' and old.payment_status <> 'paid' and new.paid_at is null then
    new.paid_at := now();
  end if;

  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.inventory i
       set stock_qty = i.stock_qty + s.q
      from (select item_id, sum(quantity) as q
              from public.order_items
             where order_id = new.id and item_id is not null
             group by item_id) s
     where i.id = s.item_id and i.track_stock;
  end if;

  return new;
end;
$$;

create trigger orders_before_update
  before update on public.orders
  for each row execute function public.orders_status_hooks();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger inventory_touch before update on public.inventory
  for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 7. create_order() — atomic checkout used by the POS
--    Prices are read from the database, never trusted from the browser.
-- ---------------------------------------------------------------------
create or replace function public.create_order(
  p_order_type     text,
  p_table_id       uuid,
  p_customer_name  text,
  p_notes          text,
  p_discount       numeric,
  p_payment_method text,
  p_mark_paid      boolean,
  p_items          jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings   public.settings;
  v_order      public.orders;
  v_item       jsonb;
  v_inv        public.inventory;
  v_qty        int;
  v_subtotal   numeric := 0;
  v_discount   numeric;
  v_tax        numeric;
  v_table_name text;
  v_cashier    text;
  v_method     text;
begin
  if not public.has_role(array['admin','cashier']) then
    raise exception 'You are not allowed to create orders';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'The order has no items';
  end if;
  if p_order_type not in ('walk_in','dine_in') then
    raise exception 'Invalid order type';
  end if;
  if p_order_type = 'dine_in' then
    if p_table_id is null then raise exception 'Select a table for dine-in orders'; end if;
    select name into v_table_name from public.restaurant_tables where id = p_table_id;
    if v_table_name is null then raise exception 'Table not found'; end if;
  end if;

  v_method := case when p_mark_paid then coalesce(nullif(p_payment_method, ''), 'cash') else null end;
  if v_method is not null and v_method not in ('cash','card','mobile') then
    raise exception 'Invalid payment method';
  end if;

  select * into v_settings from public.settings where id = 1;
  select full_name into v_cashier from public.profiles where id = auth.uid();

  insert into public.orders (
    order_type, table_id, table_name, customer_name, notes, tax_rate,
    cashier_name, payment_status, payment_method, paid_at
  ) values (
    p_order_type,
    case when p_order_type = 'dine_in' then p_table_id end,
    v_table_name,
    nullif(trim(p_customer_name), ''),
    nullif(trim(p_notes), ''),
    v_settings.tax_rate,
    v_cashier,
    case when p_mark_paid then 'paid' else 'unpaid' end,
    v_method,
    case when p_mark_paid then now() end
  )
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity';
    end if;

    select * into v_inv from public.inventory
     where id = (v_item->>'item_id')::uuid
     for update;
    if not found then
      raise exception 'A menu item in this order no longer exists';
    end if;
    if not v_inv.is_available then
      raise exception '% is currently unavailable', v_inv.name;
    end if;
    if v_inv.track_stock and v_inv.stock_qty < v_qty then
      raise exception 'Not enough stock for % (only % left)', v_inv.name, v_inv.stock_qty;
    end if;

    insert into public.order_items (order_id, item_id, item_name, category, unit_price, unit_cost, quantity, line_total)
    values (v_order.id, v_inv.id, v_inv.name, v_inv.category, v_inv.price, v_inv.recipe_cost, v_qty, v_inv.price * v_qty);

    if v_inv.track_stock then
      update public.inventory set stock_qty = stock_qty - v_qty where id = v_inv.id;
    end if;

    v_subtotal := v_subtotal + v_inv.price * v_qty;
  end loop;

  v_discount := least(greatest(coalesce(p_discount, 0), 0), v_subtotal);
  v_tax      := round((v_subtotal - v_discount) * v_settings.tax_rate / 100, 2);

  update public.orders
     set subtotal   = v_subtotal,
         discount   = v_discount,
         tax_amount = v_tax,
         total      = v_subtotal - v_discount + v_tax
   where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. FOOD WASTAGE
-- ---------------------------------------------------------------------
create table public.food_wastage (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid references public.inventory(id) on delete set null,
  item_name    text not null,
  quantity     numeric(12,2) not null check (quantity > 0),
  unit_cost    numeric(10,2) not null default 0,
  total_cost   numeric(12,2) generated always as (round(quantity * unit_cost, 2)) stored,
  reason       text,
  recorded_by  uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now()
);
create index food_wastage_created_idx on public.food_wastage (created_at desc);

-- Cost + name come from inventory; stock is reduced automatically.
create or replace function public.food_wastage_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.inventory;
begin
  if new.item_id is not null then
    select * into v_inv from public.inventory where id = new.item_id;
    if found then
      new.item_name := v_inv.name;
      new.unit_cost := v_inv.recipe_cost;
      if v_inv.track_stock then
        update public.inventory
           set stock_qty = greatest(0, stock_qty - new.quantity)
         where id = v_inv.id;
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger food_wastage_bi
  before insert on public.food_wastage
  for each row execute function public.food_wastage_before_insert();

-- ---------------------------------------------------------------------
-- 9. EMPLOYEE ATTENDANCE
-- ---------------------------------------------------------------------
create table public.employee_attendance (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.profiles(id) on delete cascade,
  work_date    date not null default current_date,
  check_in     timestamptz not null default now(),
  check_out    timestamptz,
  notes        text,
  created_at   timestamptz not null default now(),
  constraint attendance_times_ok check (check_out is null or check_out >= check_in)
);
create index attendance_date_idx     on public.employee_attendance (work_date);
create index attendance_employee_idx on public.employee_attendance (employee_id, work_date);
-- One open (not yet checked-out) session per employee
create unique index attendance_one_open_session
  on public.employee_attendance (employee_id) where check_out is null;

-- Timestamps are written by the server so staff can't back-date themselves.
create or replace function public.clock_in(p_work_date date default current_date)
returns public.employee_attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.employee_attendance;
begin
  if not public.is_staff() then
    raise exception 'Your account is not active';
  end if;
  if exists (select 1 from public.employee_attendance where employee_id = auth.uid() and check_out is null) then
    raise exception 'You are already checked in';
  end if;

  insert into public.employee_attendance (employee_id, work_date)
  values (auth.uid(), coalesce(p_work_date, current_date))
  returning * into r;
  return r;
end;
$$;

create or replace function public.clock_out()
returns public.employee_attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.employee_attendance;
begin
  if not public.is_staff() then
    raise exception 'Your account is not active';
  end if;

  update public.employee_attendance
     set check_out = now()
   where employee_id = auth.uid() and check_out is null
  returning * into r;

  if not found then
    raise exception 'You are not checked in';
  end if;
  return r;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.settings            enable row level security;
alter table public.restaurant_tables   enable row level security;
alter table public.inventory           enable row level security;
alter table public.orders              enable row level security;
alter table public.order_items         enable row level security;
alter table public.food_wastage        enable row level security;
alter table public.employee_attendance enable row level security;

-- profiles: see yourself (even if pending approval); admins see + manage everyone
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profiles: admin update" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- settings
create policy "settings: staff read" on public.settings
  for select to authenticated using (public.is_staff());
create policy "settings: admin update" on public.settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- dining tables
create policy "tables: staff read" on public.restaurant_tables
  for select to authenticated using (public.is_staff());
create policy "tables: admin write" on public.restaurant_tables
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- inventory
create policy "inventory: staff read" on public.inventory
  for select to authenticated using (public.is_staff());
create policy "inventory: admin write" on public.inventory
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- orders (cashiers create orders through create_order(); everyone on shift can move them through the KDS)
create policy "orders: staff read" on public.orders
  for select to authenticated using (public.is_staff());
create policy "orders: staff update" on public.orders
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "orders: admin insert" on public.orders
  for insert to authenticated with check (public.is_admin());
create policy "orders: admin delete" on public.orders
  for delete to authenticated using (public.is_admin());

create policy "order_items: staff read" on public.order_items
  for select to authenticated using (public.is_staff());
create policy "order_items: admin write" on public.order_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- wastage
create policy "wastage: staff read" on public.food_wastage
  for select to authenticated using (public.is_staff());
create policy "wastage: staff insert" on public.food_wastage
  for insert to authenticated with check (public.is_staff());
create policy "wastage: admin delete" on public.food_wastage
  for delete to authenticated using (public.is_admin());

-- attendance: staff read their own rows, admins read everything.
-- Staff write ONLY through clock_in() / clock_out().
create policy "attendance: read own or admin" on public.employee_attendance
  for select to authenticated using (employee_id = auth.uid() or public.is_admin());
create policy "attendance: admin write" on public.employee_attendance
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Only signed-in users may call the RPCs
revoke all on function public.create_order(text, uuid, text, text, numeric, text, boolean, jsonb) from public, anon;
revoke all on function public.clock_in(date) from public, anon;
revoke all on function public.clock_out() from public, anon;
grant execute on function public.create_order(text, uuid, text, text, numeric, text, boolean, jsonb) to authenticated;
grant execute on function public.clock_in(date) to authenticated;
grant execute on function public.clock_out() to authenticated;

-- ---------------------------------------------------------------------
-- 11. REALTIME (live dashboard, kitchen board, attendance)
-- ---------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.orders;              exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.inventory;           exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.employee_attendance; exception when duplicate_object then null; end;
end $$;

-- ---------------------------------------------------------------------
-- 12. SAMPLE MENU (delete or edit later from the app)
-- ---------------------------------------------------------------------
insert into public.inventory (name, category, price, recipe_cost, stock_qty, unit, low_stock_threshold) values
  ('Arancini',            'Starters', 7.50, 2.40, 40, 'pcs', 8),
  ('Avocado Toast',       'Starters', 8.00, 2.80, 30, 'pcs', 6),
  ('Bruschetta',          'Starters', 6.50, 1.90, 35, 'pcs', 8),
  ('Caesar Salad',        'Starters', 9.00, 3.10, 25, 'pcs', 6),
  ('Grilled Salmon',      'Mains',   21.00, 8.90, 18, 'pcs', 5),
  ('Margherita Pizza',    'Mains',   13.50, 3.80, 40, 'pcs', 8),
  ('Beef Burger',         'Mains',   14.00, 5.20, 32, 'pcs', 8),
  ('Chicken Alfredo',     'Mains',   16.50, 5.60, 22, 'pcs', 6),
  ('Garlic Bread',        'Sides',    4.50, 1.10, 50, 'pcs', 10),
  ('French Fries',        'Sides',    5.00, 1.20, 60, 'pcs', 12),
  ('Apple Pie',           'Desserts', 6.50, 1.90, 20, 'pcs', 5),
  ('Tiramisu',            'Desserts', 7.00, 2.30, 16, 'pcs', 4),
  ('Americano',           'Drinks',   3.50, 0.40, 200,'cups', 30),
  ('Fresh Lemonade',      'Drinks',   4.50, 0.90, 80, 'cups', 15),
  ('Iced Latte',          'Drinks',   5.00, 1.10, 90, 'cups', 15);

-- Done. Next: create your first user in Authentication → Users (that user becomes the admin).
