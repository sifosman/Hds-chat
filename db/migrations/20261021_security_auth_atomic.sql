-- LOCAL ONLY: deployment owner must review/apply before deploying server/auth.ts.
-- Existing app_auth_codes/app_rate_hit are prerequisites. No CRM objects are changed.
-- Service-role RPCs only; customers receive opaque app tokens, never Supabase JWTs.
BEGIN;

CREATE OR REPLACE FUNCTION public.app_auth_issue_otp(p_phone text, p_code_hash text, p_channel text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  IF p_phone IS NULL OR p_phone !~ '^[1-9][0-9]{9,14}$'
     OR p_code_hash IS NULL OR p_code_hash !~ '^[a-f0-9]{64}$'
     OR p_channel IS NULL OR p_channel NOT IN ('sms', 'whatsapp', 'email', 'test') THEN
    RAISE EXCEPTION 'invalid auth input';
  END IF;
  -- Lock by phone before reading/writing: issuance and verification share this lock.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hds-app-otp:' || p_phone, 0));
  UPDATE public.app_auth_codes SET consumed_at = clock_timestamp()
    WHERE phone = p_phone AND purpose = 'otp' AND consumed_at IS NULL;
  INSERT INTO public.app_auth_codes(phone, purpose, code_hash, channel, expires_at)
    VALUES (p_phone, 'otp', p_code_hash, p_channel, clock_timestamp() + interval '10 minutes');
  RETURN jsonb_build_object('status', 'issued');
END;
$$;

CREATE OR REPLACE FUNCTION public.app_auth_verify_otp(p_phone text, p_code_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  v_code public.app_auth_codes%ROWTYPE;
BEGIN
  IF p_phone IS NULL OR p_phone !~ '^[1-9][0-9]{9,14}$'
     OR p_code_hash IS NULL OR p_code_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hds-app-otp:' || p_phone, 0));
  SELECT * INTO v_code FROM public.app_auth_codes
    WHERE phone = p_phone AND purpose = 'otp' AND consumed_at IS NULL
    ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE;
  -- clock_timestamp (not transaction-start now()) is evaluated AFTER any lock wait.
  IF NOT FOUND OR v_code.expires_at IS NULL OR v_code.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;
  IF v_code.attempts IS NULL OR v_code.attempts >= 5 THEN
    RETURN jsonb_build_object('status', 'too_many_attempts');
  END IF;
  IF v_code.code_hash IS DISTINCT FROM p_code_hash THEN
    UPDATE public.app_auth_codes SET attempts = attempts + 1 WHERE id = v_code.id;
    RETURN jsonb_build_object('status', 'wrong_code');
  END IF;
  -- The guarded update is the success linearization point, including expiry.
  UPDATE public.app_auth_codes SET consumed_at = clock_timestamp()
    WHERE id = v_code.id AND consumed_at IS NULL AND expires_at > clock_timestamp() AND attempts < 5;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  RETURN jsonb_build_object('status', 'verified');
END;
$$;

CREATE OR REPLACE FUNCTION public.app_auth_redeem_invite(p_code_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  v_code public.app_auth_codes%ROWTYPE;
BEGIN
  SELECT * INTO v_code FROM public.app_auth_codes
    WHERE purpose = 'invite' AND code_hash = p_code_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid_link'); END IF;
  IF v_code.consumed_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'used'); END IF;
  IF v_code.expires_at IS NULL OR v_code.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;
  UPDATE public.app_auth_codes SET consumed_at = clock_timestamp()
    WHERE id = v_code.id AND consumed_at IS NULL AND expires_at > clock_timestamp();
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  RETURN jsonb_build_object('status', 'verified', 'phone', v_code.phone, 'channel', v_code.channel);
END;
$$;

REVOKE ALL ON FUNCTION public.app_auth_issue_otp(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_auth_verify_otp(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_auth_redeem_invite(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_auth_issue_otp(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_auth_verify_otp(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_auth_redeem_invite(text) TO service_role;
-- Existing rate RPC must not let anonymous callers drain arbitrary auth buckets.
REVOKE ALL ON FUNCTION public.app_rate_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_rate_hit(text, integer, integer) TO service_role;

COMMIT;
