#!/usr/bin/env node

/**
 * Ingest throughput benchmark.
 *
 * Pushes N synthetic chunks through the same path that production
 * traffic takes (wal.ingest, with KG extraction skipped to avoid an
 * OPENROUTER_API_KEY dependency) and reports chunks/sec.
 *
 * Two modes:
 *   cold  — fresh data dir, time the N writes
 *   warm  — pre-seed the data dir with N chunks, then time another N
 *
 * Usage:
 *   npm run bench:throughput
 *   npm run bench:throughput -- --chunks 5000
 *   npm run bench:throughput -- --mode cold
 *   npm run bench:throughput -- --batch 100         # entries per ingest() call
 *
 * No API keys, no Postgres. Runs against the local file backend.
 */

import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Storage } from '../src/storage.js';
import { loadConfig } from '../src/config.js';
import { ingest, flushPendingSideEffects } from '../src/wal.js';
import type { SmartMemoryConfig } from '../src/types.js';
import { writeBenchmarkResult } from './lib/results.js';

// ── Args ─────────────────────────────────────────────────────────────

interface Args {
  chunks: number;
  batch: number;
  mode: 'cold' | 'warm' | 'both';
  emitJson: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const mode = get('--mode', 'both') as Args['mode'];
  return {
    chunks: parseInt(get('--chunks', '10000')),
    batch: parseInt(get('--batch', '50')),
    mode: mode === 'cold' || mode === 'warm' ? mode : 'both',
    emitJson: !argv.includes('--no-results'),
  };
}

// ── Synthetic content generator ──────────────────────────────────────
// Mix of types/lengths so the embedding pipeline sees realistic variety.

const TOPICS = ['typescript', 'postgres', 'auth', 'deployment', 'testing', 'react', 'design', 'product', 'pricing', 'infrastructure'];
const VERBS = ['decided to use', 'prefers', 'noticed that', 'fixed a bug in', 'shipped', 'rolled back', 'documented', 'reviewed', 'rewrote', 'benchmarked'];
const TARGETS = ['the migration script', 'the search pipeline', 'the embedding model', 'the rerank step', 'the storage layer', 'the cli flags', 'the docs', 'the test fixtures', 'the bridge config', 'the consolidator'];

function makeEntry(i: number): { content: string; type: 'fact' | 'preference' | 'decision' | 'context'; tags: string[]; domain: string; topic: string } {
  const topic = TOPICS[i % TOPICS.length];
  const verb = VERBS[i % VERBS.length];
  const target = TARGETS[i % TARGETS.length];
  const types = ['fact', 'preference', 'decision', 'context'] as const;
  const type = types[i % types.length];
  // Vary length — short, medium, long — to stress chunker + embedder
  const padding = i % 3 === 0
    ? ''
    : i % 3 === 1
    ? ' The change applied to all environments and was rolled out in stages.'
    : ' The change applied to all environments, was rolled out in stages, required updates to the documentation, the bridge config, and the CLI flags, and was reviewed by two other engineers before merging into the main branch.';
  return {
    content: `Entry ${i}: user ${verb} ${target} (${topic}).${padding}`,
    type,
    tags: [topic],
    domain: 'work',
    topic,
  };
}

// ── Runner ───────────────────────────────────────────────────────────

interface ModeResult {
  mode: 'cold' | 'warm';
  chunks: number;
  batchSize: number;
  totalMs: number;
  chunksPerSec: number;
  msPerChunk: number;
  rssMb: number;
}

/**
 * Print a single-line progress update to stderr (uses CR so the line
 * rewrites itself in TTYs).  When stderr isn't a TTY (CI logs, piped
 * to file), prints with newline so the log stays readable.
 *
 * Throttled to once per ~1 second so a fast inner loop doesn't drown
 * out other output.
 */
function makeProgressReporter(label: string, total: number) {
  const isTty = process.stderr.isTTY;
  const startedAt = performance.now();
  let lastEmitAt = 0;

  const fmtDuration = (ms: number): string => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return m > 0 ? `${m}m${String(rem).padStart(2, '0')}s` : `${rem}s`;
  };

  return {
    tick(done: number, force = false) {
      const now = performance.now();
      if (!force && now - lastEmitAt < 1000) return;
      lastEmitAt = now;
      const elapsed = now - startedAt;
      const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
      const rate = elapsed > 0 ? (done / (elapsed / 1000)) : 0;
      const remaining = rate > 0 ? ((total - done) / rate) * 1000 : 0;
      const line =
        `[${label}] ${done}/${total} ` +
        `(${pct.toFixed(1)}%)  ` +
        `${fmtDuration(elapsed)} elapsed  ` +
        `${rate.toFixed(0)} chunks/s  ` +
        `ETA ${fmtDuration(remaining)}`;
      if (isTty) {
        process.stderr.write(`\r${line.padEnd(80)}`);
      } else {
        process.stderr.write(`${line}\n`);
      }
    },
    finish() {
      if (isTty) process.stderr.write('\n');
    },
  };
}

async function runMode(mode: 'cold' | 'warm', chunkCount: number, batchSize: number): Promise<ModeResult> {
  const dir = join(tmpdir(), `engram-throughput-${mode}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  const config: SmartMemoryConfig = {
    ...loadConfig({ dataDir: dir }),
    dataDir: dir,
  };

  const storage = new Storage(dir);
  await storage.ensureReady();

  // Warm path also preloads N chunks before the timed run.
  if (mode === 'warm') {
    console.error(`Pre-seeding ${chunkCount} chunks for warm mode...`);
    const seedProgress = makeProgressReporter(`${mode} preseed`, chunkCount);
    for (let i = 0; i < chunkCount; i += batchSize) {
      const batch = [];
      for (let j = 0; j < batchSize && i + j < chunkCount; j++) {
        batch.push({
          ...makeEntry(i + j),
          skipKgExtraction: true,
          skipDailyEntry: true,
          awaitSideEffects: false,
        });
      }
      await ingest(config, storage, batch);
      seedProgress.tick(Math.min(i + batchSize, chunkCount));
    }
    seedProgress.tick(chunkCount, true);
    seedProgress.finish();
    await flushPendingSideEffects();
  }

  // Single warmup call so the embedding model is loaded before timing.
  await ingest(config, storage, [{
    content: 'warmup entry for throughput benchmark',
    skipKgExtraction: true,
    skipDailyEntry: true,
    awaitSideEffects: false,
  }]);
  await flushPendingSideEffects();

  console.error(`[${mode}] Timing ${chunkCount} ingests (batch=${batchSize})...`);
  const startWall = performance.now();
  const progress = makeProgressReporter(`${mode} timing`, chunkCount);

  for (let i = 0; i < chunkCount; i += batchSize) {
    const batch = [];
    for (let j = 0; j < batchSize && i + j < chunkCount; j++) {
      batch.push({
        ...makeEntry(i + j),
        skipKgExtraction: true,
        skipDailyEntry: true,
        awaitSideEffects: false,
      });
    }
    await ingest(config, storage, batch);
    progress.tick(Math.min(i + batchSize, chunkCount));
  }
  progress.tick(chunkCount, true);
  progress.finish();
  // Drain background work before stopping the clock — chunks/sec
  // should reflect "fully persisted" not "queued."
  await flushPendingSideEffects();

  const totalMs = performance.now() - startWall;
  const chunksPerSec = (chunkCount / totalMs) * 1000;
  const msPerChunk = totalMs / chunkCount;
  const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);

  // Cleanup
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }

  return {
    mode,
    chunks: chunkCount,
    batchSize,
    totalMs: Math.round(totalMs),
    chunksPerSec: Math.round(chunksPerSec * 10) / 10,
    msPerChunk: Math.round(msPerChunk * 100) / 100,
    rssMb,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const benchStart = performance.now();

  const results: ModeResult[] = [];

  if (args.mode === 'cold' || args.mode === 'both') {
    results.push(await runMode('cold', args.chunks, args.batch));
  }
  if (args.mode === 'warm' || args.mode === 'both') {
    results.push(await runMode('warm', args.chunks, args.batch));
  }

  // ── stdout summary ─────────────────────────────────────────────
  console.log();
  console.log('='.repeat(76));
  console.log('INGEST THROUGHPUT');
  console.log('='.repeat(76));
  console.log();
  for (const r of results) {
    console.log(`  ${r.mode.padEnd(6)} chunks=${String(r.chunks).padStart(6)}  batch=${String(r.batchSize).padStart(4)}  ${r.chunksPerSec.toFixed(1).padStart(7)} chunks/sec  ${r.msPerChunk.toFixed(2).padStart(5)} ms/chunk  rss=${r.rssMb}MB  total=${(r.totalMs / 1000).toFixed(1)}s`);
  }
  console.log();
  console.log(`  Embedding model    ${process.env.SMART_MEMORY_EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2'}`);
  console.log(`  Storage backend    file (local LanceDB)`);
  console.log(`  KG extraction      skipped (would require OPENROUTER_API_KEY)`);
  console.log();

  // ── result file ────────────────────────────────────────────────
  if (args.emitJson) {
    const perMode: Record<string, Record<string, unknown>> = {};
    const flat: Record<string, unknown> = {};
    for (const r of results) {
      perMode[r.mode] = {
        chunks: r.chunks,
        batchSize: r.batchSize,
        totalMs: r.totalMs,
        chunksPerSec: r.chunksPerSec,
        msPerChunk: r.msPerChunk,
        rssMb: r.rssMb,
      };
      flat[`${r.mode}_chunksPerSec`] = r.chunksPerSec;
      flat[`${r.mode}_msPerChunk`] = r.msPerChunk;
    }
    const path = writeBenchmarkResult({
      benchmark: 'ingest-throughput',
      durationMs: Math.round(performance.now() - benchStart),
      config: {
        embeddingModel: process.env.SMART_MEMORY_EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2',
        chunks: args.chunks,
        batchSize: args.batch,
        mode: args.mode,
        storageBackend: 'file',
        kgExtraction: false,
      },
      results: flat,
      perCategory: perMode,
      notes: 'KG extraction skipped to keep the bench API-key-free. Production ingest is ~30-50% slower when KG extraction is enabled and an LLM is available.',
    });
    console.log(`Results JSON: ${path}`);
  }
}

main().catch(err => {
  console.error('Throughput bench error:', err);
  process.exit(1);
});
