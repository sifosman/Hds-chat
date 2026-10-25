import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const bundled = JSON.parse(readFileSync(join(root, 'node_modules/expo/bundledNativeModules.json'), 'utf8'));

// Pinned via `expo install` against SDK 54's bundledNativeModules — the values below
// are the authoritative expectations, and these peers must be DIRECT dependencies
// (a transitive-only version, e.g. expo-font@58 under @expo/vector-icons, breaks
// Gradle autolinking publication).
const EXPECTED: Record<string, string> = { 'expo-font': '~14.0.12', 'react-native-worklets': '0.5.1' };
const RESOLVED: Record<string, string> = { 'expo-font': '14.0.12', 'react-native-worklets': '0.5.1' };

test('required native peers are direct dependencies matching SDK bundledNativeModules', () => {
  for (const [name, spec] of Object.entries(EXPECTED)) {
    assert.equal(bundled[name], spec, `SDK 54 expects ${name}@${spec}`);
    assert.equal(pkg.dependencies?.[name], spec, `${name} must be a direct dependency at ${spec}`);
  }
});

test('lockfile resolves the expected versions with no duplicate expo-font', () => {
  const pkgs = lock.packages as Record<string, { version: string }>;
  assert.equal(pkgs['node_modules/expo-font']?.version, RESOLVED['expo-font']);
  assert.equal(pkgs['node_modules/react-native-worklets']?.version, RESOLVED['react-native-worklets']);
  const fontCopies = Object.keys(pkgs).filter(p => /node_modules\/expo-font$/.test(p));
  assert.deepEqual(fontCopies, ['node_modules/expo-font'], 'nested expo-font copies: ' + fontCopies.join(', '));
});
