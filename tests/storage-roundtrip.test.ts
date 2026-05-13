/**
 * storage-roundtrip — adapter parity smoke test.
 *
 * Covers both backends through the StorageAdapter contract:
 *   - file mode      (always runs; uses a tmp dir + LanceDB)
 *   - postgres mode  (gated on SMOKE_POSTGRES_URL; skipped otherwise)
 *
 * Each run: ingest one chunk with a 384-dim embedding + metadata,
 * vectorSearch on a near-identical embedding, assert the returned
 * chunk matches the inserted one. Plus diary write+read and handoff
 * write+read round-trips.
 *
 * Run all:    `npm test`
 * File only:  `node --import tsx --test tests/storage-roundtrip.test.ts`
 * +Postgres:  `SMOKE_POSTGRES_URL=postgres://... node --import tsx --test tests/storage-roundtrip.test.ts`
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { StorageAdapter, StoredChunk } from '../src/storage-adapter.js';
import { FileStorageAdapter } from '../src/storage-file.js';

function seedChunk(): StoredChunk {
  // Sparse-ish 384-vec so vectorSearch returns a meaningful distance.
  const embedding = new Array(384).fill(0);
  embedding[0] = 1.0;
  embedding[1] = 0.5;
  embedding[42] = 0.7;

  return {
    id: 'roundtrip-chunk-1',
    tier: 'daily',
    content: 'The cognitive stack ships in Core, not Pro.',
    type: 'fact',
    cognitiveLayer: 'semantic',
    tags: ['pyre:tier', 'cognitive-stack'],
    domain: 'pyre',
    topic: 'pricing',
    source: 'roundtrip:test',
    importance: 0.8,
    sentiment: 'neutral',
    createdAt: '2026-05-12T00:00:00.000Z',
    lastRecalledAt: null,
    recallCount: 0,
    embedding,
    relatedMemories: [],
    recallOutcomes: [],
    stability: 1.0,
    difficulty: 0.3,
    consolidationLevel: 0,
    embeddingVersion: 1,
    origin: 'user',
  };
}

async function runRoundtrip(adapter: StorageAdapter): Promise<void> {
  await adapter.ensureReady();

  // ── chunks ────────────────────────────────────────────────────────
  const chunk = seedChunk();
  await adapter.saveChunk(chunk);

  const fetched = await adapter.getChunk(chunk.id);
  assert.ok(fetched, 'getChunk returned null');
  assert.equal(fetched.id, chunk.id);
  assert.equal(fetched.content, chunk.content);
  assert.equal(fetched.domain, chunk.domain);
  assert.equal(fetched.topic, chunk.topic);
  assert.deepEqual(fetched.tags, chunk.tags);
  assert.equal(fetched.origin, chunk.origin);

  // vector search with a slightly perturbed query
  const queryEmbedding = chunk.embedding!.slice();
  queryEmbedding[2] = 0.01;
  const hits = await adapter.vectorSearch(queryEmbedding, 5);
  assert.ok(hits.length >= 1, 'vectorSearch returned no hits');
  assert.equal(hits[0].chunk.id, chunk.id);

  // ── diary ─────────────────────────────────────────────────────────
  const diary = await adapter.writeDiaryEntry('Roundtrip diary entry.', 'roundtrip');
  assert.equal(diary.agent, 'roundtrip');
  assert.equal(diary.content, 'Roundtrip diary entry.');

  const readBack = await adapter.readDiary({ daysBack: 1 });
  assert.ok(readBack.length >= 1, 'readDiary returned no days');
  const found = readBack.flatMap((d) => d.entries).find((e) => e.content === 'Roundtrip diary entry.');
  assert.ok(found, 'diary entry not found on read');
  assert.equal(found.agent, 'roundtrip');

  // ── handoff ───────────────────────────────────────────────────────
  const written = await adapter.writeHandoff({
    sessionId: 'roundtrip-session',
    reason: 'manual',
    currentTask: 'verifying storage adapter parity',
    completed: ['wrote chunk', 'wrote diary'],
    nextSteps: ['assert handoff roundtrip'],
    openQuestions: [],
    fileRefs: ['tests/storage-roundtrip.test.ts:1'],
    decisions: ['use single adapter interface'],
    notes: 'no gotchas',
  });
  assert.equal(written.currentTask, 'verifying storage adapter parity');
  assert.equal(written.reason, 'manual');

  const latest = await adapter.readHandoff();
  assert.ok(latest, 'readHandoff returned null');
  assert.equal(latest.currentTask, 'verifying storage adapter parity');
  assert.equal(latest.sessionId, 'roundtrip-session');
}

// ── File backend (always runs) ──────────────────────────────────────

describe('storage roundtrip — file backend', () => {
  it('chunk + diary + handoff round-trip via FileStorageAdapter', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'engram-roundtrip-file-'));
    const adapter = new FileStorageAdapter(dir);
    try {
      await runRoundtrip(adapter);
    } finally {
      try { adapter.close?.(); } catch { /* noop */ }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });
});

// ── Postgres backend (gated on SMOKE_POSTGRES_URL) ─────────────────

const POSTGRES_URL = process.env.SMOKE_POSTGRES_URL;

describe('storage roundtrip — postgres backend', () => {
  it(
    'chunk + diary + handoff round-trip via PostgresStorageAdapter',
    { skip: !POSTGRES_URL && 'SMOKE_POSTGRES_URL not set; skipping postgres backend' },
    async () => {
      // Dynamic import — keeps file-mode-only environments from
      // loading pg (which is an optionalDependency).
      const { PostgresStorageAdapter } = await import('../src/storage-postgres.js');
      const tenantId = `roundtrip-${randomUUID()}`;
      const adapter = new PostgresStorageAdapter({
        databaseUrl: POSTGRES_URL!,
        tenantId,
      });
      try {
        await runRoundtrip(adapter);
      } finally {
        // Best-effort tenant cleanup so repeated runs don't pile up.
        try {
          // The adapter exposes pool via private field; reach in via
          // its public methods only — delete all rows tagged with our
          // tenant by using chunkCount-style queries. Cheapest path is
          // to leave the rows; the tenant_id is unique per run.
          await adapter.close?.();
        } catch { /* noop */ }
      }
    },
  );
});
