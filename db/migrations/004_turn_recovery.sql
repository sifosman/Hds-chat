-- App-only recovery. A turn claim is NEVER deleted/released/replayed.
-- Existing claims cannot be retrospectively timed out: only new claims run the watchdog.
BEGIN;
ALTER TABLE public.app_turn_claims ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'legacy'
  CHECK (state IN ('legacy', 'running', 'completed', 'failed', 'timed_out'));
ALTER TABLE public.app_turn_claims ALTER COLUMN state SET DEFAULT 'running';
ALTER TABLE public.app_turn_claims ADD COLUMN IF NOT EXISTS finished_at timestamptz;
ALTER TABLE public.app_turn_claims ADD COLUMN IF NOT EXISTS notice_pending boolean NOT NULL DEFAULT false;
ALTER TABLE public.app_turn_claims ADD COLUMN IF NOT EXISTS notice_delivered_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS app_turn_execution_current ON public.app_turn_claims(execution_id) WHERE state <> 'legacy';
CREATE INDEX IF NOT EXISTS app_turn_running_age ON public.app_turn_claims(claimed_at, message_id) WHERE state = 'running';
CREATE INDEX IF NOT EXISTS app_turn_pending_notice ON public.app_turn_claims(finished_at, message_id) WHERE notice_pending;
ALTER TABLE public.app_turn_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_turn_claims FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.app_turn_claims TO service_role;

-- Serialize new claims and terminal typing changes on the owning user row.
-- The permanent message PK remains the financial-tool replay barrier.
CREATE OR REPLACE FUNCTION public.app_claim_turn(p_wa_id text, p_phone text, p_execution text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
SET statement_timeout = '4s' AS $$
DECLARE mid uuid; inserted uuid;
BEGIN
  IF p_execution IS NULL OR length(btrim(p_execution)) = 0 OR length(p_execution) > 200 THEN RETURN false; END IF;
  PERFORM 1 FROM public.app_users WHERE phone = p_phone AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT id INTO mid FROM public.app_messages WHERE wa_id = p_wa_id AND phone = p_phone AND direction = 'in';
  IF mid IS NULL THEN RETURN false; END IF;
  INSERT INTO public.app_turn_claims(message_id, execution_id) VALUES (mid, p_execution)
    ON CONFLICT DO NOTHING RETURNING message_id INTO inserted;
  IF inserted IS NULL THEN RETURN false; END IF;
  UPDATE public.app_messages SET bot_status = 'processing' WHERE id = mid;
  RETURN true;
END $$;

-- All terminal states are absorbing. In particular a completed turn cannot be downgraded
-- and a late completion cannot retract an interruption notice already delivered/in flight.
-- Legacy executions are deliberately unmatched. Never emit internal execution IDs to clients.
CREATE OR REPLACE FUNCTION public.app_finish_turn(p_execution text, p_outcome text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
SET statement_timeout = '4s' AS $$
DECLARE turn public.app_turn_claims%ROWTYPE; target_phone text; did_change boolean := false;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'invalid_turn_outcome' USING ERRCODE = '22023';
  END IF;
  SELECT m.phone INTO target_phone FROM public.app_turn_claims t
    JOIN public.app_messages m ON m.id = t.message_id
    WHERE t.execution_id = p_execution AND t.state <> 'legacy';
  IF target_phone IS NULL THEN RETURN jsonb_build_object('matched', false, 'changed', false); END IF;
  PERFORM 1 FROM public.app_users WHERE phone = target_phone AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('matched', false, 'changed', false); END IF;
  SELECT * INTO turn FROM public.app_turn_claims
    WHERE execution_id = p_execution AND state <> 'legacy' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('matched', false, 'changed', false); END IF;
  IF turn.state = 'running' THEN
    UPDATE public.app_turn_claims SET state = p_outcome, finished_at = clock_timestamp(),
      notice_pending = (p_outcome = 'failed') WHERE message_id = turn.message_id RETURNING * INTO turn;
    UPDATE public.app_messages SET bot_status = turn.state WHERE id = turn.message_id;
    -- Conservatively retain typing for ANY other running turn (including a newer one).
    UPDATE public.app_users u SET typing_until = NULL WHERE u.phone = target_phone
      AND NOT EXISTS (SELECT 1 FROM public.app_turn_claims t JOIN public.app_messages m ON m.id = t.message_id
        WHERE m.phone = target_phone AND t.state = 'running');
    did_change := true;
  END IF;
  RETURN jsonb_build_object('matched', true, 'changed', did_change, 'message_id', turn.message_id,
    'phone', target_phone, 'state', turn.state, 'notice_pending', turn.notice_pending);
END $$;

-- One transaction chooses at most ten active-user candidates. SKIP LOCKED permits overlap
-- without waiting for another worker. Notice idempotency also survives crashes after insert.
-- A minimum age of ten minutes is fixed server-side, never supplied by a caller.
CREATE OR REPLACE FUNCTION public.app_recover_turns()
RETURNS TABLE(message_id uuid, phone text, state text, notice_pending boolean, changed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
SET statement_timeout = '4s' AS $$
DECLARE candidate record; turn public.app_turn_claims%ROWTYPE; did_change boolean;
BEGIN
  FOR candidate IN
    SELECT t.message_id, m.phone FROM public.app_turn_claims t
      JOIN public.app_messages m ON m.id = t.message_id
      JOIN public.app_users u ON u.phone = m.phone AND u.status = 'active'
      WHERE (t.state = 'running' AND t.claimed_at <= clock_timestamp() - interval '10 minutes')
        OR (t.state IN ('failed', 'timed_out') AND t.notice_pending)
      ORDER BY coalesce(t.finished_at, t.claimed_at), t.message_id LIMIT 10
  LOOP
    PERFORM 1 FROM public.app_users u WHERE u.phone = candidate.phone AND u.status = 'active' FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT t.* INTO turn FROM public.app_turn_claims t WHERE t.message_id = candidate.message_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    did_change := false;
    IF turn.state = 'running' AND turn.claimed_at <= clock_timestamp() - interval '10 minutes' THEN
      UPDATE public.app_turn_claims t SET state = 'timed_out', finished_at = clock_timestamp(), notice_pending = true
        WHERE t.message_id = turn.message_id RETURNING t.* INTO turn;
      UPDATE public.app_messages m SET bot_status = 'timed_out' WHERE m.id = turn.message_id;
      UPDATE public.app_users u SET typing_until = NULL WHERE u.phone = candidate.phone
        AND NOT EXISTS (SELECT 1 FROM public.app_turn_claims t JOIN public.app_messages m ON m.id = t.message_id
          WHERE m.phone = candidate.phone AND t.state = 'running');
      did_change := true;
    END IF;
    IF turn.state IN ('failed', 'timed_out') AND turn.notice_pending THEN
      RETURN QUERY SELECT turn.message_id, candidate.phone, turn.state, turn.notice_pending, did_change;
    END IF;
  END LOOP;
END $$;

-- Called ONLY after deliverOutbound resolves. Failure/crash keeps the durable flag set.
CREATE OR REPLACE FUNCTION public.app_ack_turn_notice(p_message_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
SET statement_timeout = '4s' AS $$
BEGIN
  UPDATE public.app_turn_claims SET notice_pending = false, notice_delivered_at = clock_timestamp()
    WHERE message_id = p_message_id AND state IN ('failed', 'timed_out') AND notice_pending;
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.app_claim_turn(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_finish_turn(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_recover_turns() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_ack_turn_notice(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_claim_turn(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_finish_turn(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_recover_turns() TO service_role;
GRANT EXECUTE ON FUNCTION public.app_ack_turn_notice(uuid) TO service_role;
COMMIT;
