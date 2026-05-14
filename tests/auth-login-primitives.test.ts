/**
 * Tests for the extracted device-code primitives that the MCP cloud-login
 * tools share with the CLI runLogin flow.
 *
 * Covers: startDeviceCode happy path + transient-failure retry; pollDeviceCode
 * mapping of HTTP 410 → expired, 2xx body pass-through, non-2xx throw;
 * credentialsFromApproval shape.
 *
 * Run: `npm test` or `node --import tsx --test tests/auth-login-primitives.test.ts`
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  startDeviceCode,
  pollDeviceCode,
  credentialsFromApproval,
} from '../src/auth/login.js';

function jsonResponse(status: number, body: unknown): Response {
  const text = body === undefined ? '' : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetch(responders: Array<() => Promise<Response> | Response>): typeof fetch {
  let i = 0;
  return (async () => {
    const r = responders[Math.min(i++, responders.length - 1)];
    return await r();
  }) as typeof fetch;
}

const noSleep = async () => {};

describe('startDeviceCode', () => {
  it('returns the parsed body on a 2xx response', async () => {
    const fetchImpl = mockFetch([
      () => jsonResponse(200, {
        user_code: 'ABCD-EFGH',
        device_code: 'dev-123',
        verification_url: 'https://example.com/verify',
        expires_in: 600,
        interval: 5,
      }),
    ]);
    const out = await startDeviceCode(fetchImpl, 'https://example.com', 'test-host', noSleep);
    assert.equal(out.user_code, 'ABCD-EFGH');
    assert.equal(out.device_code, 'dev-123');
    assert.equal(out.interval, 5);
  });

  it('retries transient failures up to 3 times before succeeding', async () => {
    const fetchImpl = mockFetch([
      () => jsonResponse(503, { error: 'temporarily unavailable' }),
      () => jsonResponse(503, { error: 'still down' }),
      () => jsonResponse(200, {
        user_code: 'A1B2',
        device_code: 'dev-9',
        verification_url: 'https://example.com/verify',
        expires_in: 600,
        interval: 5,
      }),
    ]);
    const out = await startDeviceCode(fetchImpl, 'https://example.com', 'test-host', noSleep);
    assert.equal(out.device_code, 'dev-9');
  });

  it('throws after exhausting retries', async () => {
    const fetchImpl = mockFetch([
      () => jsonResponse(500, { error: 'boom' }),
      () => jsonResponse(500, { error: 'boom' }),
      () => jsonResponse(500, { error: 'boom' }),
    ]);
    await assert.rejects(
      () => startDeviceCode(fetchImpl, 'https://example.com', 'test-host', noSleep),
      /HTTP 500/,
    );
  });
});

describe('pollDeviceCode', () => {
  it('maps HTTP 410 to status: expired', async () => {
    const fetchImpl = mockFetch([
      () => new Response('', { status: 410 }),
    ]);
    const out = await pollDeviceCode(fetchImpl, 'https://example.com', 'dev-123');
    assert.deepEqual(out, { status: 'expired' });
  });

  it('returns the JSON body as-is for 2xx responses', async () => {
    const fetchImpl = mockFetch([
      () => jsonResponse(200, { status: 'pending' }),
    ]);
    const pending = await pollDeviceCode(fetchImpl, 'https://example.com', 'dev-123');
    assert.deepEqual(pending, { status: 'pending' });

    const fetchImpl2 = mockFetch([
      () => jsonResponse(200, {
        status: 'approved',
        api_url: 'https://engram.example.com',
        api_key: 'sk_pyre_xxx',
        label: 'matts-laptop',
        scopes: ['memory:read', 'memory:write'],
      }),
    ]);
    const approved = await pollDeviceCode(fetchImpl2, 'https://example.com', 'dev-123');
    assert.equal(approved.status, 'approved');
    if (approved.status === 'approved') {
      assert.equal(approved.api_key, 'sk_pyre_xxx');
    }
  });

  it('throws on unexpected non-2xx, non-410 responses', async () => {
    const fetchImpl = mockFetch([
      () => jsonResponse(500, { error: 'kaboom' }),
    ]);
    await assert.rejects(
      () => pollDeviceCode(fetchImpl, 'https://example.com', 'dev-123'),
      /HTTP 500/,
    );
  });
});

describe('credentialsFromApproval', () => {
  it('builds the Credentials shape including an ISO issued_at', () => {
    const creds = credentialsFromApproval({
      status: 'approved',
      api_url: 'https://engram.example.com',
      api_key: 'sk_pyre_abc',
      label: 'box-1',
      scopes: ['memory:read'],
    });
    assert.equal(creds.api_url, 'https://engram.example.com');
    assert.equal(creds.api_key, 'sk_pyre_abc');
    assert.equal(creds.label, 'box-1');
    assert.deepEqual(creds.scopes, ['memory:read']);
    assert.match(creds.issued_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
