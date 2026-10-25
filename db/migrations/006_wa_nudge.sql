-- WhatsApp -> app soft nudge bookkeeping. When a WhatsApp message arrives from an
-- active app user who has recently used the app, /internal/wa-nudge claims a slot
-- here (atomic upsert, one row per phone) so the workflow sends the "use the app"
-- nudge at most once per cooldown window.
create table if not exists public.app_wa_nudges (
  phone text primary key,
  last_sent_at timestamptz not null default now()
);

alter table public.app_wa_nudges enable row level security;
revoke all on public.app_wa_nudges from public, anon, authenticated;

-- Atomic cooldown claim: inserts the phone or refreshes last_sent_at only when the
-- previous nudge is older than p_cooldown. Returns true when the caller may nudge.
create or replace function public.claim_wa_nudge(p_phone text, p_cooldown interval default '7 days')
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  insert into public.app_wa_nudges(phone, last_sent_at) values (p_phone, now())
  on conflict (phone) do update set last_sent_at = now()
    where app_wa_nudges.last_sent_at < now() - p_cooldown;
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.claim_wa_nudge(text, interval) from public, anon, authenticated;
grant execute on function public.claim_wa_nudge(text, interval) to service_role;
