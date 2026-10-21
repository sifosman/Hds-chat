-- App-only reconciliation bookkeeping. No upstream writes, triggers or WhatsApp changes.
-- Existing business rows remain authoritative; notifications are merely app projections.
create table if not exists public.app_async_bridge_state (
  singleton boolean primary key default true check (singleton),
  user_cursor uuid,
  lease_token uuid,
  lease_until timestamptz
);
insert into public.app_async_bridge_state(singleton) values (true) on conflict do nothing;

create table if not exists public.app_async_user_state (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  source_floor timestamptz not null,
  source_cursor_at timestamptz not null,
  source_cursor_id uuid,
  quote_cursor uuid,
  invoice_cursor uuid,
  last_run_at timestamptz not null default now()
);

create table if not exists public.app_async_source_queue (
  user_id uuid not null references public.app_users(id) on delete cascade,
  source_id uuid not null,
  state text not null default 'pending' check (state in ('pending', 'delivered', 'skipped')),
  queued_at timestamptz not null default now(),
  delivered_at timestamptz,
  primary key (user_id, source_id)
);
create index if not exists app_async_source_queue_pending_idx
  on public.app_async_source_queue(user_id, queued_at, source_id) where state = 'pending';

create table if not exists public.app_invoice_observations (
  user_id uuid not null references public.app_users(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  last_status text not null,
  notify_pending boolean not null default false,
  notified_at timestamptz,
  first_seen_at timestamptz not null default now(),
  observed_at timestamptz not null default now(),
  primary key (user_id, invoice_id)
);
create index if not exists app_invoice_observations_pending_idx
  on public.app_invoice_observations(user_id, invoice_id) where notify_pending;

alter table public.app_async_bridge_state enable row level security;
alter table public.app_async_user_state enable row level security;
alter table public.app_async_source_queue enable row level security;
alter table public.app_invoice_observations enable row level security;
revoke all on public.app_async_bridge_state, public.app_async_user_state,
  public.app_async_source_queue, public.app_invoice_observations from public, anon, authenticated;
grant select, insert, update, delete on public.app_async_bridge_state, public.app_async_user_state,
  public.app_async_source_queue, public.app_invoice_observations to service_role;

-- A short global lease serializes state transitions across scheduler/manual invocations.
-- Token-conditioned release prevents an expired worker releasing another worker's lease.
create or replace function public.app_async_claim_run(p_token uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.app_async_bridge_state
  set lease_token = p_token, lease_until = now() + interval '90 seconds'
  where singleton and (lease_until is null or lease_until < now());
  return found;
end $$;
revoke all on function public.app_async_claim_run(uuid) from public, anon, authenticated;
grant execute on function public.app_async_claim_run(uuid) to service_role;
