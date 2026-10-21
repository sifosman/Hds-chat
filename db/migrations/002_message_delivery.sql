-- Durable inbound-turn deduplication: a network retry must not generate another quote.
alter table public.app_users add column if not exists typing_until timestamptz;
create table if not exists public.app_turn_claims (
  message_id uuid primary key references public.app_messages(id) on delete cascade,
  execution_id text not null,
  claimed_at timestamptz not null default now()
);
alter table public.app_turn_claims enable row level security;
revoke all on public.app_turn_claims from public, anon, authenticated;
grant all on public.app_turn_claims to service_role;
create or replace function public.app_claim_turn(p_wa_id text, p_phone text, p_execution text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare mid uuid; inserted uuid;
begin
  select id into mid from app_messages where wa_id=p_wa_id and phone=p_phone and direction='in';
  if mid is null then return false; end if;
  insert into app_turn_claims(message_id,execution_id) values(mid,p_execution)
    on conflict do nothing returning message_id into inserted;
  if inserted is null then return false; end if;
  update app_messages set bot_status='processing' where id=mid;
  return true;
end $$;
revoke all on function public.app_claim_turn(text,text,text) from public, anon, authenticated;
grant execute on function public.app_claim_turn(text,text,text) to service_role;
