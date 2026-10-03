create table if not exists public.employees (
  id text primary key,
  name text not null,
  role text not null check (role in ('manager', 'richard', 'anastasia', 'jean_claude', 'expense_reporter')),
  telegram_user_id text unique,
  telegram_chat_id text,
  created_at timestamptz not null default now()
);

insert into public.employees (id, name, role) values
  ('svetlana', 'Svetlana de Monte Carlo', 'manager'),
  ('richard', 'Richard “Call Me Dick” Darling', 'richard'),
  ('anastasia', 'Anastasia Ferrari', 'anastasia'),
  ('jean-claude', 'Jean-Claude Bērziņš', 'jean_claude'),
  ('kevin', 'Kevin von Whatever', 'expense_reporter')
on conflict (id) do nothing;

create sequence if not exists public.sales_sheet_row_seq start with 2;
create sequence if not exists public.expenses_sheet_row_seq start with 2;

create table if not exists public.transactions (
  reference text primary key,
  kind text not null check (kind in ('sale', 'expense')),
  submitted_by text not null references public.employees(id),
  submitter_name text not null,
  origin text not null check (origin in ('telegram', 'website')),
  origin_telegram_user_id text,
  origin_chat_id text,
  notification_chat_id text,
  customer text,
  project text check (project in ('A', 'B')),
  description text not null check (length(trim(description)) > 0),
  amount numeric(12, 2) not null check (amount > 0),
  category text check (category in ('Materials', 'Travel', 'Other')),
  proposed_split jsonb,
  approved_split jsonb,
  commission_pool numeric(12, 2) not null default 0 check (commission_pool >= 0),
  commission_amounts jsonb not null default '{"richard":0,"anastasia":0,"jean_claude":0}'::jsonb,
  proposed_allocation text check (proposed_allocation in ('A', 'B', 'company_overhead')),
  final_allocation text check (final_allocation in ('A', 'B', 'company_overhead')),
  status text not null check (status in ('pending_approval', 'approved', 'awaiting_allocation', 'allocated')),
  decision_changed boolean not null default false,
  decided_by text references public.employees(id),
  decided_at timestamptz,
  sheets_sync_status text not null default 'pending' check (sheets_sync_status in ('pending', 'synced', 'failed')),
  sheets_sync_error text,
  submission_notification_status text not null default 'pending' check (submission_notification_status in ('pending', 'sent', 'failed', 'no_recipient')),
  submission_notification_error text,
  decision_notification_status text not null default 'pending' check (decision_notification_status in ('not_required', 'pending', 'sent', 'failed', 'no_recipient')),
  decision_notification_error text,
  sheet_row bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transaction_reference_prefix check (
    (kind = 'sale' and reference ~ '^S[A-Z0-9_-]{1,15}$') or
    (kind = 'expense' and reference ~ '^E[A-Z0-9_-]{1,15}$')
  ),
  constraint sale_fields_required check (
    (kind = 'sale' and customer is not null and project is not null and proposed_split is not null and proposed_allocation is null and category is null) or
    (kind = 'expense' and customer is null and project is null and proposed_split is null and proposed_allocation is not null and category is not null)
  ),
  constraint status_matches_kind check (
    (kind = 'sale' and status in ('pending_approval', 'approved')) or
    (kind = 'expense' and status in ('awaiting_allocation', 'allocated'))
  )
);

create unique index if not exists transactions_sheet_row_unique on public.transactions(kind, sheet_row);
create index if not exists transactions_submitted_by_created_at on public.transactions(submitted_by, created_at desc);
create index if not exists transactions_status_kind on public.transactions(status, kind);

create or replace function public.assign_transaction_sheet_row()
returns trigger language plpgsql as $$
begin
  if new.sheet_row is null then
    if new.kind = 'sale' then
      new.sheet_row := nextval('public.sales_sheet_row_seq');
    else
      new.sheet_row := nextval('public.expenses_sheet_row_seq');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_assign_sheet_row on public.transactions;
create trigger transactions_assign_sheet_row
before insert on public.transactions
for each row execute function public.assign_transaction_sheet_row();

create or replace function public.touch_transaction_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists transactions_touch_updated_at on public.transactions;
create trigger transactions_touch_updated_at
before update on public.transactions
for each row execute function public.touch_transaction_updated_at();

alter table public.employees enable row level security;
alter table public.transactions enable row level security;

revoke all on public.employees, public.transactions from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on public.employees, public.transactions to service_role;
grant usage, select on sequence public.sales_sheet_row_seq, public.expenses_sheet_row_seq to service_role;

comment on table public.transactions is 'Financial records and decision state. Only the Vercel server uses a Supabase secret key; browser clients never receive it.';
