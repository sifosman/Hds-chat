// Structural guards only: these do not replace PostgreSQL concurrency/integration tests.
// Deployment owner must run the migration against an isolated DB before releasing auth.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync(new URL('../db/migrations/20261021_security_auth_atomic.sql', import.meta.url), 'utf8');
const functionBody = (name: string) => sql.split('FUNCTION public.' + name + '(')[1].split('$$;')[0];

describe('local auth SQL security invariants', () => {
  it('serializes OTP issuance and verification with the same transaction advisory lock', () => {
    const lock = "pg_advisory_xact_lock(pg_catalog.hashtextextended('hds-app-otp:' || p_phone, 0))";
    expect(functionBody('app_auth_issue_otp')).toContain(lock);
    expect(functionBody('app_auth_verify_otp')).toContain(lock);
    expect(functionBody('app_auth_verify_otp')).toContain('FOR UPDATE');
  });
  it('increments attempts inside the locked transaction, never overwrites a stale client count', () => {
    const verify = functionBody('app_auth_verify_otp');
    expect(verify).toContain('v_code.attempts >= 5');
    expect(verify).toContain('SET attempts = attempts + 1');
    expect(verify.indexOf('FOR UPDATE')).toBeLessThan(verify.indexOf('SET attempts = attempts + 1'));
  });
  it('checks replay and expiry again in the final consume for OTP and invites', () => {
    for (const name of ['app_auth_verify_otp', 'app_auth_redeem_invite']) {
      const body = functionBody(name);
      expect(body).toContain('consumed_at IS NULL AND expires_at > clock_timestamp()');
      expect(body).toContain("IF NOT FOUND THEN RETURN jsonb_build_object('status', 'expired')");
      expect(body).toContain('FOR UPDATE');
    }
  });
  it('has a safe search path and explicit service-role-only grants for all functions', () => {
    for (const [name, signature] of [
      ['app_auth_issue_otp', 'text, text, text'], ['app_auth_verify_otp', 'text, text'], ['app_auth_redeem_invite', 'text'], ['app_rate_hit', 'text, integer, integer'],
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${name}(${signature}) FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${name}(${signature}) TO service_role;`);
    }
    expect(sql.match(/SECURITY DEFINER SET search_path = pg_catalog/g)).toHaveLength(3);
    expect(sql).not.toMatch(/GRANT[^;]+TO\s+(PUBLIC|anon|authenticated)/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE|customer_profiles|ai_conversations/);
  });
});
