import test from 'node:test';
import assert from 'node:assert/strict';
import { launchRoute, jost, entranceTheme, parsePreviewUrl, resolveFixture, authActionsEnabled, type LaunchState } from '../src/lib/entrance.ts';

const base: LaunchState = {
  bootDone: false, signedIn: false, initialUrlResolved: false, invite: false,
};
const route = (over: Partial<LaunchState>) => launchRoute({ ...base, ...over });

test('launch: session beats everything', () => {
  assert.equal(route({ signedIn: true, bootDone: true, initialUrlResolved: true }), 'app');
  assert.equal(route({ signedIn: true, invite: true }), 'app');
});

test('launch: invite wins over boot and login', () => {
  assert.equal(route({ invite: true }), 'invite');
  assert.equal(route({ invite: true, initialUrlResolved: true }), 'invite');
});

test('launch: boot holds while identity restore or the initial URL is unresolved', () => {
  assert.equal(route({ bootDone: false, initialUrlResolved: true }), 'boot');
  assert.equal(route({ bootDone: true, initialUrlResolved: false }), 'boot');
  assert.equal(route({}), 'boot');
});

test('launch: settled unauthenticated launch goes straight to auth — no promo step', () => {
  assert.equal(route({ bootDone: true, initialUrlResolved: true }), 'auth');
  assert.equal(route({ bootDone: true, initialUrlResolved: true, signedIn: false, invite: false }), 'auth');
});

test('preview: only exact hds-chat://dev-preview links with a known state parse', () => {
  assert.equal(parsePreviewUrl('hds-chat://dev-preview?state=otp'), 'otp');
  assert.equal(parsePreviewUrl('hds-chat://dev-preview?state=no_channel'), 'no_channel');
  assert.equal(parsePreviewUrl('hds-chat://dev-preview?state=off'), 'off');
  assert.equal(parsePreviewUrl('hds-chat://dev-preview'), 'phone');
  for (const bad of [
    'https://dev-preview?state=otp',
    'hds-chat://evil-preview?state=otp',
    'hds-chat://dev-preview/x?state=otp',
    'hds-chat://dev-preview?state=hack',
    'hds-chat://dev-preview?state=OTP',
    'hds-chat://dev-preview?state=reveal',
    'hds-chat://app/i/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'hds-chat://app?u=dev-preview',
    'not a url', '', 42, null,
  ]) assert.equal(parsePreviewUrl(bad), null, String(bad));
});

test('preview: fixtures resolve only under __DEV__', () => {
  const fx = { phone: '82' };
  assert.equal(resolveFixture(fx, true), fx);
  assert.equal(resolveFixture(fx, false), undefined);
});

test('preview: the auth action gate blocks fixture renders and allows live ones', () => {
  assert.equal(authActionsEnabled(true), false);
  assert.equal(authActionsEnabled(false), true);
});

test('tokens: jost falls back to the platform face when the font fails to load', () => {
  assert.deepEqual(jost(false), {});
  assert.deepEqual(jost(true, '600'), { fontFamily: 'HDS-Jost', fontWeight: '600' });
  assert.equal(JSON.stringify(jost(true)).includes('fontVariationSettings'), false);
});

test('tokens: entrance palette is separate from the chat theme', () => {
  assert.equal(entranceTheme(false).bg, '#F6F2EA');
  assert.equal(entranceTheme(true).bg, '#191C1A');
  assert.equal(entranceTheme(false).wa, '#128C7E');
});
