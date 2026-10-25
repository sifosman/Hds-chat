-- Live WhatsApp -> app mirror wake-up: ai_conversations inserts for active app users
-- poke the app's /internal/wa-mirror, which copies the row into app_messages and
-- broadcasts a realtime sync. The catch-up scan inside listMessages covers missed pokes.
-- Hook config lives in app_settings.wa_mirror_hook = {"url": "...", "key": "<INTERNAL_KEY>"};
-- until that row exists the trigger is a no-op.
create extension if not exists pg_net with schema extensions;

create or replace function public.app_wa_mirror_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare cfg jsonb; uid uuid;
begin
  if NEW.role not in ('user','assistant') then return NEW; end if;
  -- App-channel rows already live in app_messages; internal/private rows are not customer messages.
  if coalesce(NEW.conversation_metadata->>'channel','') = 'app'
     or coalesce(NEW.tool_results->>'channel','') = 'app'
     or NEW.tool_results->>'automatic_internal' = 'true'
     or NEW.conversation_metadata->>'automatic_internal' = 'true'
     or NEW.tool_results->>'private' = 'true'
     or NEW.conversation_metadata->>'private' = 'true' then return NEW; end if;
  select u.id into uid from public.app_users u
    where u.status = 'active' and u.wa_history_cutoff <= NEW.created_at
      and u.phone in (NEW.phone_number, ltrim(NEW.phone_number, '+'), '0' || substring(NEW.phone_number from 3))
    limit 1;
  if uid is null then return NEW; end if;
  select value into cfg from public.app_settings where key = 'wa_mirror_hook';
  if cfg is null or cfg->>'url' is null or cfg->>'key' is null then return NEW; end if;
  perform net.http_post(
    url := cfg->>'url',
    body := jsonb_build_object('phone', NEW.phone_number),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', cfg->>'key'),
    timeout_milliseconds := 3000
  );
  return NEW;
end $$;

revoke all on function public.app_wa_mirror_notify() from public, anon, authenticated;
grant execute on function public.app_wa_mirror_notify() to service_role;

drop trigger if exists ai_conversations_wa_mirror on public.ai_conversations;
create trigger ai_conversations_wa_mirror
  after insert on public.ai_conversations
  for each row execute function public.app_wa_mirror_notify();
