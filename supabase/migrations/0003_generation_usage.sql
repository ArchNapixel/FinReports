-- Daily AI-generation quota per accountant (Nena categorize/chat/narrative/receipt calls).
create table public.generation_usage (
  accountant_id uuid not null references public.accountants (id) on delete cascade,
  usage_date date not null default current_date,
  count int not null default 0,
  primary key (accountant_id, usage_date)
);

alter table public.generation_usage enable row level security;
create policy "self" on public.generation_usage
  for all using (accountant_id = auth.uid()) with check (accountant_id = auth.uid());

-- Atomically bumps today's counter (creating the row on first use) and returns the new count.
create function public.increment_generation_usage() returns int
language sql security definer set search_path = public as $$
  insert into public.generation_usage (accountant_id, usage_date, count)
  values (auth.uid(), current_date, 1)
  on conflict (accountant_id, usage_date) do update set count = generation_usage.count + 1
  returning count;
$$;
