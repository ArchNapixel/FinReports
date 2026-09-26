-- FinReports core schema.
-- Tenancy: one accountant (auth user) owns many client_companies; every
-- bookkeeping row hangs off a client_company. RLS enforces ownership.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────── accountants
create table public.accountants (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  email text not null,
  subscription_tier text not null default 'trial'
    check (subscription_tier in ('trial', 'solo', 'pro')),
  created_at timestamptz not null default now()
);

-- Create the accountant profile when a Supabase auth user signs up.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.accountants (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''), new.email);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ────────────────────────────────────────────────────────── client companies
create table public.client_companies (
  id uuid primary key default gen_random_uuid(),
  accountant_id uuid not null references public.accountants (id) on delete cascade,
  name text not null,
  "TIN" text not null default '',
  industry text not null default '',
  chart_of_accounts_template text not null default 'ph_standard',
  -- Tax profile drives VAT vs percentage tax and 1701Q applicability.
  registered_address text not null default '',
  rdo_code text not null default '',
  tax_type text not null default 'vat' check (tax_type in ('vat', 'non_vat')),
  taxpayer_type text not null default 'corporation'
    check (taxpayer_type in ('individual', 'corporation')),
  created_at timestamptz not null default now()
);
create index on public.client_companies (accountant_id);

create function public.owns_company(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.client_companies c
    where c.id = cid and c.accountant_id = auth.uid()
  );
$$;

-- ────────────────────────────────────────────────────────── chart of accounts
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  client_company_id uuid not null references public.client_companies (id) on delete cascade,
  code text not null,
  name text not null,
  type text not null check (type in ('asset', 'liability', 'equity', 'revenue', 'cost_of_sales', 'expense')),
  subtype text not null default '',
  is_cash boolean not null default false,
  cash_flow_class text not null default 'operating'
    check (cash_flow_class in ('operating', 'investing', 'financing')),
  active boolean not null default true,
  unique (client_company_id, code)
);

-- ─────────────────────────────────────────────── transactions (journal heads)
-- A transaction is one journal entry. Its lines live in ledger_entries.
-- type: 'debit' = the category account is debited (expense/asset purchase,
-- i.e. a cash outflow); 'credit' = the category account is credited (revenue,
-- i.e. a cash inflow). Posted rows are immutable; corrections are reversals.
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  client_company_id uuid not null references public.client_companies (id) on delete cascade,
  vendor text not null default '',
  amount numeric(14, 2) not null check (amount >= 0),
  date date not null,
  category text not null default '',
  description text not null default '',
  receipt_url text,
  hash text not null,
  previous_hash text not null,
  type text not null check (type in ('debit', 'credit')),
  source text not null
    check (source in ('receipt', 'manual', 'invoice', 'bill', 'payment', 'payroll', 'reversal')),
  reference text,
  reverses_transaction_id uuid references public.transactions (id),
  -- 'nena' when the category came from Nena's suggestion and was accepted.
  categorized_by text not null default 'accountant' check (categorized_by in ('accountant', 'nena')),
  nena_confidence numeric(4, 3),
  created_at timestamptz not null default now(),
  unique (reverses_transaction_id)
);
create index on public.transactions (client_company_id, date);

-- ───────────────────────────────────────────────── ledger entries (lines)
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  client_company_id uuid not null references public.client_companies (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  seq bigint not null,
  account_code text not null,
  debit numeric(14, 2) not null default 0 check (debit >= 0),
  credit numeric(14, 2) not null default 0 check (credit >= 0),
  entry_date date not null,
  memo text not null default '',
  hash text not null,
  previous_hash text not null,
  created_at timestamptz not null default now(),
  check ((debit = 0) <> (credit = 0)),
  unique (client_company_id, seq),
  -- One successor per link: a forked chain cannot be written.
  unique (client_company_id, previous_hash)
);
create index on public.ledger_entries (client_company_id, entry_date);
create index on public.ledger_entries (transaction_id);

-- Hashed rows can never be edited or deleted. The only exception is the
-- cascade that runs when the whole client company is deleted.
create function public.forbid_mutation() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and not exists (
    select 1 from public.client_companies where id = old.client_company_id
  ) then
    return old;
  end if;
  raise exception '% rows are immutable; post a reversing entry instead', tg_table_name;
end $$;

create trigger ledger_entries_immutable before update or delete on public.ledger_entries
  for each row execute function public.forbid_mutation();
create trigger transactions_immutable before update or delete on public.transactions
  for each row execute function public.forbid_mutation();

-- Atomically append a journal entry whose hashes were computed by the app.
-- Rejects the write if the chain head moved (the app re-reads and retries) or
-- if the lines do not balance.
create function public.post_journal(p_company uuid, p_txn jsonb, p_lines jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_head text;
  v_seq bigint;
  v_txn uuid;
  v_dr numeric := 0;
  v_cr numeric := 0;
  v_line jsonb;
begin
  if not public.owns_company(p_company) then
    raise exception 'not authorized for company %', p_company;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_company::text));

  select hash, seq into v_head, v_seq from public.ledger_entries
   where client_company_id = p_company order by seq desc limit 1;
  v_head := coalesce(v_head, repeat('0', 64));
  v_seq := coalesce(v_seq, 0);

  if (p_lines -> 0 ->> 'previous_hash') is distinct from v_head
     or (p_lines -> 0 ->> 'seq')::bigint <> v_seq + 1 then
    raise exception 'CHAIN_HEAD_MOVED' using errcode = 'P0001';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_dr := v_dr + coalesce((v_line ->> 'debit')::numeric, 0);
    v_cr := v_cr + coalesce((v_line ->> 'credit')::numeric, 0);
  end loop;
  if v_dr <> v_cr or v_dr = 0 then
    raise exception 'UNBALANCED: debits % credits %', v_dr, v_cr;
  end if;

  insert into public.transactions (
    id, client_company_id, vendor, amount, date, category, description, receipt_url,
    hash, previous_hash, type, source, reference, reverses_transaction_id,
    categorized_by, nena_confidence)
  values (
    (p_txn ->> 'id')::uuid, p_company, coalesce(p_txn ->> 'vendor', ''),
    (p_txn ->> 'amount')::numeric, (p_txn ->> 'date')::date,
    coalesce(p_txn ->> 'category', ''), coalesce(p_txn ->> 'description', ''),
    p_txn ->> 'receipt_url', p_txn ->> 'hash', p_txn ->> 'previous_hash',
    p_txn ->> 'type', p_txn ->> 'source', p_txn ->> 'reference',
    (p_txn ->> 'reverses_transaction_id')::uuid,
    coalesce(p_txn ->> 'categorized_by', 'accountant'),
    (p_txn ->> 'nena_confidence')::numeric)
  returning id into v_txn;

  insert into public.ledger_entries (
    client_company_id, transaction_id, seq, account_code, debit, credit,
    entry_date, memo, hash, previous_hash)
  select p_company, v_txn, (l ->> 'seq')::bigint, l ->> 'account_code',
         coalesce((l ->> 'debit')::numeric, 0), coalesce((l ->> 'credit')::numeric, 0),
         (l ->> 'entry_date')::date, coalesce(l ->> 'memo', ''),
         l ->> 'hash', l ->> 'previous_hash'
    from jsonb_array_elements(p_lines) l;

  return v_txn;
end $$;

-- ────────────────────────────────────────────────────── receipt intake drafts
-- Nena's extraction results waiting for the accountant's confirm step.
create table public.receipt_drafts (
  id uuid primary key default gen_random_uuid(),
  client_company_id uuid not null references public.client_companies (id) on delete cascade,
  receipt_url text,
  extracted jsonb,
  status text not null default 'pending' check (status in ('pending', 'failed', 'confirmed', 'discarded')),
  error text,
  transaction_id uuid references public.transactions (id),
  created_at timestamptz not null default now()
);
create index on public.receipt_drafts (client_company_id, status);

-- ─────────────────────────────────────────────────────────────── AR / AP
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  client_company_id uuid not null references public.client_companies (id) on delete cascade,
  customer_name text not null,
  invoice_no text not null default '',
  amount numeric(14, 2) not null check (amount > 0),
  vat_amount numeric(14, 2) not null default 0,
  revenue_account text not null default '4000',
  issue_date date not null,
  due_date date not null,
  status text not null default 'unpaid' check (status in ('unpaid', 'partial', 'paid')),
  amount_paid numeric(14, 2) not null default 0 check (amount_paid >= 0),
  transaction_id uuid references public.transactions (id),
  created_at timestamptz not null default now(),
  check (amount_paid <= amount)
);
create index on public.invoices (client_company_id, status);

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  client_company_id uuid not null references public.client_companies (id) on delete cascade,
  vendor_name text not null,
  bill_no text not null default '',
  amount numeric(14, 2) not null check (amount > 0),
  vat_amount numeric(14, 2) not null default 0,
  expense_account text not null default '6900',
  issue_date date not null,
  due_date date not null,
  status text not null default 'unpaid' check (status in ('unpaid', 'partial', 'paid')),
  amount_paid numeric(14, 2) not null default 0 check (amount_paid >= 0),
  transaction_id uuid references public.transactions (id),
  created_at timestamptz not null default now(),
  check (amount_paid <= amount)
);
create index on public.bills (client_company_id, status);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  client_company_id uuid not null references public.client_companies (id) on delete cascade,
  invoice_id uuid references public.invoices (id) on delete cascade,
  bill_id uuid references public.bills (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  paid_on date not null,
  cash_account text not null default '1010',
  transaction_id uuid references public.transactions (id),
  created_at timestamptz not null default now(),
  check ((invoice_id is null) <> (bill_id is null))
);

-- ─────────────────────────────────────────────────────────────── payroll
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  client_company_id uuid not null references public.client_companies (id) on delete cascade,
  name text not null,
  "TIN" text not null default '',
  "SSS_no" text not null default '',
  "PhilHealth_no" text not null default '',
  "PagIBIG_no" text not null default '',
  monthly_salary numeric(14, 2) not null check (monthly_salary >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  client_company_id uuid not null references public.client_companies (id) on delete cascade,
  period text not null check (period ~ '^\d{4}-\d{2}$'), -- YYYY-MM
  status text not null default 'draft' check (status in ('draft', 'finalized')),
  transaction_id uuid references public.transactions (id),
  created_at timestamptz not null default now(),
  unique (client_company_id, period)
);

create table public.payroll_items (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  gross numeric(14, 2) not null,
  "SSS_deduction" numeric(14, 2) not null,
  "PhilHealth_deduction" numeric(14, 2) not null,
  "PagIBIG_deduction" numeric(14, 2) not null,
  withholding_tax numeric(14, 2) not null,
  net_pay numeric(14, 2) not null,
  -- Employer shares, needed for the payroll journal and remittance reports.
  sss_employer numeric(14, 2) not null default 0,
  sss_ec numeric(14, 2) not null default 0,
  philhealth_employer numeric(14, 2) not null default 0,
  pagibig_employer numeric(14, 2) not null default 0,
  unique (payroll_run_id, employee_id)
);

-- Versioned, date-effective statutory tables (SSS, PhilHealth, Pag-IBIG,
-- withholding tax). New rates are new rows — no code deploy required.
create table public.statutory_tables (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('sss', 'philhealth', 'pagibig', 'wtax_monthly', 'wtax_annual')),
  effective_from date not null,
  effective_to date,
  payload jsonb not null,
  source text not null default '',
  created_at timestamptz not null default now(),
  unique (kind, effective_from)
);

-- ─────────────────────────────────────────────────────────────── RLS
alter table public.accountants enable row level security;
alter table public.client_companies enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.receipt_drafts enable row level security;
alter table public.invoices enable row level security;
alter table public.bills enable row level security;
alter table public.payments enable row level security;
alter table public.employees enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_items enable row level security;
alter table public.statutory_tables enable row level security;

create policy "self" on public.accountants
  for all using (id = auth.uid()) with check (id = auth.uid());
create policy "own companies" on public.client_companies
  for all using (accountant_id = auth.uid()) with check (accountant_id = auth.uid());

-- Company-scoped tables.
create policy "company scope" on public.accounts
  for all using (public.owns_company(client_company_id)) with check (public.owns_company(client_company_id));
create policy "company scope read" on public.transactions
  for select using (public.owns_company(client_company_id));
create policy "company scope insert" on public.transactions
  for insert with check (public.owns_company(client_company_id));
create policy "company scope read" on public.ledger_entries
  for select using (public.owns_company(client_company_id));
create policy "company scope insert" on public.ledger_entries
  for insert with check (public.owns_company(client_company_id));
create policy "company scope" on public.receipt_drafts
  for all using (public.owns_company(client_company_id)) with check (public.owns_company(client_company_id));
create policy "company scope" on public.invoices
  for all using (public.owns_company(client_company_id)) with check (public.owns_company(client_company_id));
create policy "company scope" on public.bills
  for all using (public.owns_company(client_company_id)) with check (public.owns_company(client_company_id));
create policy "company scope" on public.payments
  for all using (public.owns_company(client_company_id)) with check (public.owns_company(client_company_id));
create policy "company scope" on public.employees
  for all using (public.owns_company(client_company_id)) with check (public.owns_company(client_company_id));
create policy "company scope" on public.payroll_runs
  for all using (public.owns_company(client_company_id)) with check (public.owns_company(client_company_id));
create policy "company scope" on public.payroll_items
  for all using (exists (select 1 from public.payroll_runs r
                         where r.id = payroll_run_id and public.owns_company(r.client_company_id)))
  with check (exists (select 1 from public.payroll_runs r
                      where r.id = payroll_run_id and public.owns_company(r.client_company_id)));
-- Statutory tables are shared reference data: readable by any signed-in
-- accountant, writable only via the service role / SQL editor.
create policy "read statutory tables" on public.statutory_tables
  for select using (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────────────── storage
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
  on conflict (id) do nothing;

-- Objects are stored as <client_company_id>/<uuid>.<ext>.
create policy "receipts by company" on storage.objects
  for all using (bucket_id = 'receipts' and public.owns_company(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'receipts' and public.owns_company(((storage.foldername(name))[1])::uuid));
