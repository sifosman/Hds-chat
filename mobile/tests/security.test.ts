import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_ORIGIN, isTrustedUrl, externalHttps, navigationAction, appDeepLink, inviteToken, parseBridgeMessage } from '../src/security.ts';

test('exact trusted HTTPS origin only', () => {
  assert.equal(isTrustedUrl(`${APP_ORIGIN}/i/token`), true);
  for (const url of ['http://hds-chat.vercel.app', 'https://hds-chat.vercel.app.evil.test', 'https://evil.test/?next=https://hds-chat.vercel.app', 'https://user@hds-chat.vercel.app', 'https://hds-chat.vercel.app:8443', 'file:///etc/passwd', 'javascript:alert(1)', ' https://hds-chat.vercel.app', 'https://hds-chat.vercel.app\\@evil.test']) assert.equal(isTrustedUrl(url), false, url);
});

test('external payment and PDF destinations use browser, unsafe schemes blocked', () => {
  assert.equal(navigationAction(`${APP_ORIGIN}/`), 'webview');
  assert.equal(navigationAction(`${APP_ORIGIN}/quote.PDF?token=123`), 'browser');
  assert.equal(navigationAction('https://pay.example.test/pay'), 'browser');
  for (const url of ['javascript:alert(1)', 'file:///tmp/a.pdf', 'intent://test', 'data:text/html,hi', 'http://example.test', 'blob:https://hds-chat.vercel.app/test', 'tel:123']) {
    assert.equal(navigationAction(url), 'block');
    assert.equal(externalHttps(url), null);
  }
});

test('bridge messages require trusted source, valid schema and safe destinations', () => {
  assert.deepEqual(parseBridgeMessage('{"type":"ready"}', APP_ORIGIN), { type: 'ready' });
  assert.deepEqual(parseBridgeMessage('{"type":"push:register"}', APP_ORIGIN), { type: 'push:register' });
  assert.deepEqual(parseBridgeMessage('{"type":"open","url":"https://pay.example.test/"}', APP_ORIGIN), { type: 'open', url: 'https://pay.example.test/' });
  for (const body of ['oops', 'null', '[]', '{"type":"open","url":"javascript:alert(1)"}', '{"type":"open","url":123}', '{"type":"unknown"}']) assert.equal(parseBridgeMessage(body, APP_ORIGIN), null);
  assert.equal(parseBridgeMessage('{"type":"ready"}', 'https://evil.test'), null);
  assert.equal(parseBridgeMessage(' '.repeat(16385), APP_ORIGIN), null);
});

test('deep links cannot escape trusted app origin', () => {
  assert.equal(appDeepLink(`${APP_ORIGIN}/i/abc`), `${APP_ORIGIN}/i/abc`);
  assert.equal(appDeepLink('hds-chat://app/i/abc?x=1#invite'), `${APP_ORIGIN}/i/abc?x=1#invite`);
  for (const url of ['https://evil.test', 'hds-chat://evil.test/i/abc', 'javascript:alert(1)', 'hds-chat://app/quote.pdf', 'hds-chat://user@app/i/abc', 'hds-chat://app:123/i/abc']) assert.equal(appDeepLink(url), null);
});

test('invite links require an exact /i/<token> path', () => {
  const tok = 'a'.repeat(40);
  assert.equal(inviteToken(`${APP_ORIGIN}/i/${tok}`), tok);
  assert.equal(inviteToken(`hds-chat://app/i/${tok}`), tok);
  assert.equal(inviteToken(`${APP_ORIGIN}/i/${tok}?ref=push`), tok);
  for (const url of [`${APP_ORIGIN}/i/${tok}/extra`, `${APP_ORIGIN}/i/${tok}/`, `${APP_ORIGIN}/i/short`, `${APP_ORIGIN}/i/${tok}%20`, `${APP_ORIGIN}/x/i/${tok}`, 'https://evil.test/i/' + tok]) {
    assert.equal(inviteToken(url), null, url);
  }
});
