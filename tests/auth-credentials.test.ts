/**
 * auth/credentials — read/write/delete unit tests.
 *
 * Scoped to filesystem behavior only. The device-code login flow has
 * to talk to a live pyre-web endpoint; we exercise it manually rather
 * than mock fetch here.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readCredentials,
  writeCredentials,
  deleteCredentials,
  type Credentials,
} from '../src/auth/credentials.js';

function withTempPath<T>(fn: (path: string, dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'engram-creds-'));
  const path = join(dir, 'credentials.json');
  try {
    return fn(path, dir);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

const validCreds: Credentials = {
  api_url: 'https://pyre-web-dev.up.railway.app',
  api_key: 'sk_pyre_test_abcdef',
  label: 'Matt — laptop',
  scopes: ['engram:read', 'engram:write', 'persona:read', 'persona:write'],
  issued_at: '2026-05-12T12:00:00.000Z',
};

test('readCredentials returns null for missing file', () => {
  withTempPath((path) => {
    const result = readCredentials(path);
    assert.equal(result, null);
  });
});

test('readCredentials returns null for malformed JSON', () => {
  withTempPath((path) => {
    writeFileSync(path, '{not valid json', 'utf-8');
    const result = readCredentials(path);
    assert.equal(result, null);
  });
});

test('readCredentials returns null for missing required fields', () => {
  withTempPath((path) => {
    // Missing api_key, scopes, issued_at.
    writeFileSync(path, JSON.stringify({ api_url: 'https://example.test', label: 'x' }), 'utf-8');
    const result = readCredentials(path);
    assert.equal(result, null);
  });
});

test('readCredentials returns null when scopes is not a string[]', () => {
  withTempPath((path) => {
    writeFileSync(path, JSON.stringify({
      api_url: 'https://example.test',
      api_key: 'sk_test',
      label: 'x',
      scopes: [1, 2, 3],
      issued_at: '2026-05-12T00:00:00.000Z',
    }), 'utf-8');
    const result = readCredentials(path);
    assert.equal(result, null);
  });
});

test('readCredentials returns the object for a valid file', () => {
  withTempPath((path) => {
    writeFileSync(path, JSON.stringify(validCreds), 'utf-8');
    const result = readCredentials(path);
    assert.deepEqual(result, validCreds);
  });
});

test('writeCredentials writes with 0600 permissions', () => {
  // Skipped on win32 — POSIX mode bits are meaningless there.
  if (process.platform === 'win32') return;
  withTempPath((path) => {
    writeCredentials(validCreds, path);
    const stat = statSync(path);
    // Mask off the file-type bits; only the permission bits matter.
    const mode = stat.mode & 0o777;
    assert.equal(mode, 0o600, `expected 0600, got 0${mode.toString(8)}`);
  });
});

test('writeCredentials uses atomic tmp+rename (no .tmp left behind)', () => {
  withTempPath((path) => {
    writeCredentials(validCreds, path);
    assert.equal(existsSync(`${path}.tmp`), false, 'tmp file should not survive write');
    assert.equal(existsSync(path), true, 'final file should exist');
    // And the contents should round-trip.
    const round = readCredentials(path);
    assert.deepEqual(round, validCreds);
  });
});

test('writeCredentials overwrites an existing file', () => {
  withTempPath((path) => {
    writeCredentials(validCreds, path);
    const updated: Credentials = { ...validCreds, label: 'Matt — desktop' };
    writeCredentials(updated, path);
    const round = readCredentials(path);
    assert.deepEqual(round, updated);
  });
});

test('deleteCredentials is idempotent (true then false)', () => {
  withTempPath((path) => {
    writeCredentials(validCreds, path);
    assert.equal(deleteCredentials(path), true);
    assert.equal(existsSync(path), false);
    assert.equal(deleteCredentials(path), false);
  });
});
