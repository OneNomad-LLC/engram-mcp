#!/usr/bin/env node
/**
 * Diagnostic: prove whether two Storage instances at different paths
 * are actually isolated, or whether LanceDB / our code leaks chunks
 * across instances.
 *
 *   npm run bench -- diag-isolation
 *   OR
 *   node --import tsx benchmarks/diag-isolation.ts
 */

// Force file backend; see longmemeval.ts comment + task #44.
process.env.STORAGE_BACKEND = 'file';

import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Storage } from '../src/storage.js';
import type { StoredChunk } from '../src/storage.js';

async function main(): Promise<void> {
  const dirA = join(tmpdir(), `diag-iso-A-${Date.now()}`);
  const dirB = join(tmpdir(), `diag-iso-B-${Date.now() + 1}`);
  mkdirSync(dirA, { recursive: true });
  mkdirSync(dirB, { recursive: true });

  console.log('A:', dirA);
  console.log('B:', dirB);

  const baseChunk = (source: string, content: string): StoredChunk => ({
    id: randomUUID(),
    tier: 'long-term',
    content,
    type: 'context',
    cognitiveLayer: 'episodic',
    tags: [],
    domain: '',
    topic: '',
    source,
    importance: 0.5,
    sentiment: 'neutral',
    createdAt: new Date().toISOString(),
    lastRecalledAt: null,
    recallCount: 0,
    embedding: new Array(384).fill(0.01).map((v, i) => v + i * 0.001),
    relatedMemories: [],
    recallOutcomes: [],
  });

  // ── Storage A ────────────────────────────────────────────────────
  const sA = new Storage(dirA);
  await sA.ensureReady();
  await sA.saveChunk(baseChunk('A_only_source', 'Content for storage A only'));
  const aListBefore = await sA.listChunks();
  console.log(`\n[A] saved 1 chunk; listChunks returns ${aListBefore.length} chunks`);
  console.log(`[A] sources:`, aListBefore.map(c => c.source));

  // ── Storage B (different path) ───────────────────────────────────
  const sB = new Storage(dirB);
  await sB.ensureReady();
  await sB.saveChunk(baseChunk('B_only_source', 'Content for storage B only'));
  const bList = await sB.listChunks();
  console.log(`\n[B] saved 1 chunk; listChunks returns ${bList.length} chunks`);
  console.log(`[B] sources:`, bList.map(c => c.source));

  // ── Re-list A — has it been polluted by B? ───────────────────────
  const aListAfter = await sA.listChunks();
  console.log(`\n[A] re-listed after B was created; returns ${aListAfter.length} chunks`);
  console.log(`[A] sources:`, aListAfter.map(c => c.source));

  // ── Verdict ──────────────────────────────────────────────────────
  console.log('\n──────── VERDICT ────────');
  const aHasB = aListAfter.some(c => c.source === 'B_only_source');
  const bHasA = bList.some(c => c.source === 'A_only_source');
  if (aHasB || bHasA) {
    console.log('🔴 ISOLATION BROKEN');
    if (aHasB) console.log('   A sees B chunks');
    if (bHasA) console.log('   B sees A chunks');
    console.log('   → LanceDB or code-level leakage. This is the bench bug.');
  } else {
    console.log('🟢 ISOLATION OK');
    console.log('   A and B do not see each others chunks.');
    console.log('   → Bench bug is elsewhere (not raw storage isolation).');
  }

  // Cleanup
  try { rmSync(dirA, { recursive: true, force: true }); } catch { /* noop */ }
  try { rmSync(dirB, { recursive: true, force: true }); } catch { /* noop */ }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
