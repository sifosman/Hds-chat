-- HDS application foundation. Already applied remotely as hds_app_channel_schema on 2026-10-21.
-- Existing quotes/invoices/customer_profiles/ai_conversations remain authoritative; not recreated here.
create table if not exists public.app_users (
 id uuid primary key default gen_random_uuid(), phone text not null unique check(phone ~ '^[1-9][0-9]{9,14}$'),
 name text, realtime_topic text not null unique default encode(gen_random_bytes(24),'hex'),
 status text not null default 'active' check(status in('active','blocked')), source text,
 created_at timestamptz not null default now(), last_seen_at timestamptz,
 wa_history_cutoff timestamptz not null default now()
);
create table if not exists public.app_sessions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.app_users(id) on delete cascade,
 token_hash text not null unique,platform text,device_label text,user_agent text,
 created_at timestamptz not null default now(),last_used_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '180 days',revoked_at timestamptz
);
create index if not exists app_sessions_user_idx on public.app_sessions(user_id);
create table if not exists public.app_auth_codes (
 id uuid primary key default gen_random_uuid(),phone text not null,purpose text not null check(purpose in('otp','invite')),
 code_hash text not null,expires_at timestamptz not null,attempts int not null default 0,consumed_at timestamptz,
 channel text,meta jsonb not null default '{}',created_at timestamptz not null default now()
);
create index if not exists app_auth_codes_phone_idx on public.app_auth_codes(phone,purpose,created_at desc);
create unique index if not exists app_auth_codes_hash_uq on public.app_auth_codes(code_hash) where purpose='invite';
create table if not exists public.app_media (
 id uuid primary key default gen_random_uuid(),phone text not null,storage_path text not null,mime text not null,
 size_bytes int,filename text,created_at timestamptz not null default now()
);
create table if not exists public.app_messages (
 id uuid primary key default gen_random_uuid(),phone text not null,direction text not null check(direction in('in','out')),
 sender text not null check(sender in('customer','bot','agent','system')),sender_name text,type text not null,body text,
 media_id uuid references public.app_media(id),media_url text,payload jsonb not null default '{}',client_id text unique,wa_id text unique,
 status text not null default 'sent' check(status in('sending','sent','delivered','read','failed')),bot_status text,
 created_at timestamptz not null default now(),delivered_at timestamptz,read_at timestamptz
);
create index if not exists app_messages_phone_idx on public.app_messages(phone,created_at desc);
create table if not exists public.app_push_subscriptions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.app_users(id) on delete cascade,
 session_id uuid references public.app_sessions(id) on delete cascade,kind text not null check(kind in('webpush','expo')),
 endpoint text not null unique,keys jsonb,created_at timestamptz not null default now(),last_ok_at timestamptz,fail_count int not null default 0
);
create table if not exists public.app_events(id bigserial primary key,phone text,event text not null,meta jsonb not null default '{}',created_at timestamptz not null default now());
create index if not exists app_events_event_idx on public.app_events(event,created_at desc);
create table if not exists public.app_rate_limits(key text not null,window_start timestamptz not null,count int not null default 0,primary key(key,window_start));
create table if not exists public.app_settings(key text primary key,value jsonb not null,updated_at timestamptz not null default now());
insert into public.app_settings(key,value) values('invite_enabled','false'),('otp_channels','["sms","whatsapp_window","email"]') on conflict(key) do nothing;
create or replace function public.app_rate_hit(p_key text,p_window_seconds int,p_max int) returns boolean language plpgsql security definer set search_path=public as $$
declare w timestamptz:=to_timestamp(floor(extract(epoch from now())/p_window_seconds)*p_window_seconds); c int;
begin
 insert into app_rate_limits(key,window_start,count) values(p_key,w,1) on conflict(key,window_start) do update set count=app_rate_limits.count+1 returning count into c;
 delete from app_rate_limits where window_start<now()-interval '2 days' and random()<0.01;
 return c<=p_max;
end $$;
do $$ declare t text; begin foreach t in array array['app_users','app_sessions','app_auth_codes','app_media','app_messages','app_push_subscriptions','app_events','app_rate_limits','app_settings'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
end loop; end $$;
revoke all on function public.app_rate_hit(text,int,int) from public,anon,authenticated;
grant execute on function public.app_rate_hit(text,int,int) to service_role;
insert into storage.buckets(id,name,public,file_size_limit) values('app-media','app-media',false,26214400) on conflict(id) do nothing;
