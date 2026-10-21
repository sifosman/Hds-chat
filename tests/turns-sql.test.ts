// Structural guards, not a substitute for isolated PostgreSQL transaction/concurrency tests.
// Parent owns applying SQL; this suite does not access a local or remote database.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync(new URL('../db/migrations/004_turn_recovery.sql', import.meta.url), 'utf8');
const body = (name: string) => sql.split(`FUNCTION public.${name}(`)[1].split('END $$;')[0];

describe('app-only turn recovery SQL invariants', () => {
  it('baselines existing claims as legacy then defaults future claims to running', () => {
    const add = "ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'legacy'";
    const change = "ALTER COLUMN state SET DEFAULT 'running'";
    expect(sql).toContain(add); expect(sql.indexOf(change)).toBeGreaterThan(sql.indexOf(add));
    expect(sql).not.toMatch(/UPDATE\s+public\.app_turn_claims\s+SET\s+state\s*=\s*'running'/i);
  });
  it('preserves permanent dedupe and limits current execution identity without requiring historical uniqueness', () => {
    expect(body('app_claim_turn')).toContain('ON CONFLICT DO NOTHING');
    expect(sql).toContain("ON public.app_turn_claims(execution_id) WHERE state <> 'legacy'");
    expect(sql).not.toMatch(/DELETE\s+FROM\s+(?:public\.)?app_turn_claims|TRUNCATE|DROP\s+TABLE/i);
  });
  it('serializes claim, finish and timeout against the same user row before locking claims', () => {
    for (const name of ['app_claim_turn', 'app_finish_turn', 'app_recover_turns']) {
      const fn = body(name);
      expect(fn).toMatch(/PERFORM 1 FROM public\.app_users[^;]+FOR UPDATE/);
      const userLock = fn.indexOf('PERFORM 1 FROM public.app_users');
      const claimWrite = name === 'app_claim_turn' ? fn.indexOf('INSERT INTO public.app_turn_claims') : fn.indexOf('INTO turn FROM public.app_turn_claims');
      expect(userLock).toBeLessThan(claimWrite);
    }
  });
  it('only transitions running claims and never upgrades timeout or downgrades completion', () => {
    const finish = body('app_finish_turn');
    expect(finish).toContain("IF turn.state = 'running' THEN");
    expect(finish).toContain("p_outcome NOT IN ('completed', 'failed')");
    expect(finish).toContain("state <> 'legacy'");
    expect(finish).toContain("'matched', true, 'changed', did_change");
    expect(finish).toContain("UPDATE public.app_messages SET bot_status = turn.state");
    expect(finish).not.toMatch(/IF turn\.state (?:IN|=) [^\n]*timed_out/);
  });
  it('clears typing only inside the transaction when no other running claim exists', () => {
    for (const name of ['app_finish_turn', 'app_recover_turns']) {
      const fn = body(name);
      expect(fn).toMatch(/SET typing_until = NULL[^;]+AND NOT EXISTS \(SELECT 1 FROM public\.app_turn_claims[^;]+t\.state = 'running'/);
      expect(fn).toContain("status = 'active'");
    }
  });
  it('limits recovery to ten active-user candidates at least ten minutes old with bounded SQL', () => {
    const recover = body('app_recover_turns');
    expect(recover).toContain('LIMIT 10');
    expect(recover).toContain("interval '10 minutes'");
    expect(recover).toContain("t.state = 'running'");
    expect(recover).toContain("t.state IN ('failed', 'timed_out') AND t.notice_pending");
    expect(recover).toContain("u.status = 'active'");
    expect(recover).toContain('FOR UPDATE SKIP LOCKED');
    expect(recover).toContain("SET bot_status = 'timed_out'");
    expect(recover).toContain("SET statement_timeout = '4s'");
  });
  it('persists pending notices before delivery and only the acknowledgement function clears them', () => {
    expect(body('app_finish_turn')).toContain("notice_pending = (p_outcome = 'failed')");
    expect(body('app_recover_turns')).toContain('notice_pending = true');
    expect(body('app_finish_turn')).not.toContain('notice_pending = false');
    expect(body('app_recover_turns')).not.toContain('notice_pending = false');
    expect(body('app_ack_turn_notice')).toContain('SET notice_pending = false, notice_delivered_at = clock_timestamp()');
    expect(body('app_ack_turn_notice')).toContain("state IN ('failed', 'timed_out') AND notice_pending");
  });
  it('exposes service-role-only RPCs, secure search paths and no business mutations', () => {
    for (const signature of ['app_claim_turn(text, text, text)', 'app_finish_turn(text, text)', 'app_recover_turns()', 'app_ack_turn_notice(uuid)']) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`);
    }
    expect(sql.match(/SECURITY DEFINER SET search_path = pg_catalog/g)).toHaveLength(4);
    expect(sql).not.toMatch(/\b(?:quotes|invoices|payments|ai_conversations|chatwoot|http_post|net\.)\b/i);
    expect(sql).not.toMatch(/CREATE[^;]*TRIGGER/i);
    expect(sql).toContain('BEGIN;'); expect(sql).toContain('COMMIT;');
  });
});
