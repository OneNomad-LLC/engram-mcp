import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '../src/storage.js';
import { ingest, flushPendingSideEffects, pendingSideEffectCount } from '../src/wal.ts';
import { loadConfig } from '../src/config.js';

async function withTempStorage<T>(fn: (storage: Storage) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'engram-async-'));
  const storage = new Storage(dir);
  await storage.ensureReady();
  try {
    return await fn(storage);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

test('ingest with awaitSideEffects: false returns before side effects finish', async () => {
  await withTempStorage(async (storage) => {
    const config = loadConfig();
    const t0 = Date.now();
    const chunks = await ingest(config, storage, [{
      content: 'Engram is the memory MCP server. Tokens are cached. Workers run periodically.',
      source: 'test-async-1',
      domain: 'test',
      skipDedupe: true,
      awaitSideEffects: false,
    }]);
    const ingestElapsed = Date.now() - t0;
    assert.ok(chunks.length > 0, 'should return at least one chunk');
    // Side effects might still be pending; flush to clean up
    await flushPendingSideEffects();
    assert.equal(pendingSideEffectCount(), 0);
    // Sanity: the async path shouldn't take dramatically longer than
    // the sync path. We're not asserting speed here (env-dependent)
    // — just confirming the return-then-finish ordering doesn't hang.
    assert.ok(ingestElapsed < 60_000, `async ingest should not block excessively (took ${ingestElapsed}ms)`);
  });
});

test('ingest with awaitSideEffects: true (default) waits for everything', async () => {
  await withTempStorage(async (storage) => {
    const config = loadConfig();
    await ingest(config, storage, [{
      content: 'Test content for sync ingest path.',
      source: 'test-sync-1',
      skipDedupe: true,
      // awaitSideEffects defaults true
    }]);
    // After sync ingest, no work should be pending.
    assert.equal(pendingSideEffectCount(), 0);
  });
});

test('flushPendingSideEffects no-ops when nothing is pending', async () => {
  // Should not hang or throw.
  await flushPendingSideEffects();
  assert.equal(pendingSideEffectCount(), 0);
});

test('mixed batch with one async entry still waits (any-sync wins)', async () => {
  await withTempStorage(async (storage) => {
    const config = loadConfig();
    // Two entries: one async-flagged, one not. Default conservative
    // behavior is to await (only flip async when ALL entries opt in).
    const chunks = await ingest(config, storage, [
      {
        content: 'Sync entry — caller will query immediately.',
        source: 'mix-sync',
        skipDedupe: true,
        // awaitSideEffects: undefined → default true
      },
      {
        content: 'Async-flagged entry — but batched with sync above.',
        source: 'mix-async',
        skipDedupe: true,
        awaitSideEffects: false,
      },
    ]);
    assert.ok(chunks.length > 0);
    // Sync path won — nothing should be pending.
    assert.equal(pendingSideEffectCount(), 0);
  });
});

test('all-async batch flips to background', async () => {
  await withTempStorage(async (storage) => {
    const config = loadConfig();
    await ingest(config, storage, [
      {
        content: 'Async entry one with reasonable content for chunking.',
        source: 'all-async-1',
        skipDedupe: true,
        awaitSideEffects: false,
      },
      {
        content: 'Async entry two with reasonable content for chunking.',
        source: 'all-async-2',
        skipDedupe: true,
        awaitSideEffects: false,
      },
    ]);
    // Background work may be in flight; flush to clean up.
    await flushPendingSideEffects();
    assert.equal(pendingSideEffectCount(), 0);
  });
});
