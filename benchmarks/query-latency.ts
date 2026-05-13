#!/usr/bin/env node

/**
 * Query latency benchmark.
 *
 * Loads N synthetic chunks into a fresh local store, then runs M
 * queries against it and reports p50 / p95 / p99 latency. Query
 * length is varied across short / medium / long buckets so the
 * report shows latency distribution, not a single point.
 *
 * Wall-clock is measured around the full search() call — this is
 * the same path that memory_search hits at the MCP boundary, not
 * just the vector op.
 *
 * Usage:
 *   npm run bench:latency
 *   npm run bench:latency -- --chunks 5000 --queries 500
 *   npm run bench:latency -- --topk 5
 *
 * No API keys, no Postgres.
 */

import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Storage } from '../src/storage.js';
import { loadConfig } from '../src/config.js';
import { ingest, flushPendingSideEffects } from '../src/wal.js';
import { search } from '../src/search.js';
import type { SmartMemoryConfig } from '../src/types.js';
import { writeBenchmarkResult, percentiles } from './lib/results.js';

// ── Args ─────────────────────────────────────────────────────────────

interface Args {
  chunks: number;
  queries: number;
  topK: number;
  emitJson: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  return {
    chunks: parseInt(get('--chunks', '10000')),
    queries: parseInt(get('--queries', '1000')),
    topK: parseInt(get('--topk', '10')),
    emitJson: !argv.includes('--no-results'),
  };
}

// ── Synthetic content ────────────────────────────────────────────────

const TOPICS = ['typescript', 'postgres', 'auth', 'deployment', 'testing', 'react', 'design', 'product', 'pricing', 'infrastructure'];
const VERBS = ['decided to use', 'prefers', 'noticed that', 'fixed a bug in', 'shipped', 'rolled back', 'documented', 'reviewed', 'rewrote', 'benchmarked'];
const TARGETS = ['the migration script', 'the search pipeline', 'the embedding model', 'the rerank step', 'the storage layer', 'the cli flags', 'the docs', 'the test fixtures', 'the bridge config', 'the consolidator'];

function makeEntry(i: number): { content: string; type: 'fact' | 'preference' | 'decision' | 'context'; tags: string[]; domain: string; topic: string } {
  const topic = TOPICS[i % TOPICS.length];
  const verb = VERBS[i % VERBS.length];
  const target = TARGETS[i % TARGETS.length];
  const types = ['fact', 'preference', 'decision', 'context'] as const;
  return {
    content: `Entry ${i}: user ${verb} ${target} (${topic}).`,
    type: types[i % types.length],
    tags: [topic],
    domain: 'work',
    topic,
  };
}

// ── Query buckets ────────────────────────────────────────────────────

const SHORT_QUERIES = [
  'typescript', 'postgres', 'auth', 'deployment', 'tests',
  'react decision', 'pricing notes', 'docs', 'infra', 'rerank',
];

const MEDIUM_QUERIES = [
  'What did the user decide about postgres migrations?',
  'Show me everything about the deployment pipeline.',
  'What are the user preferences for typescript?',
  'When did the auth bug get fixed?',
  'Notes from the rerank benchmarking work.',
  'What was rolled back recently?',
  'Documentation that mentions the bridge config.',
  'Decisions related to the search pipeline.',
  'Recent changes to the storage layer.',
  'Conclusions about CLI flag design.',
];

const LONG_QUERIES = [
  'Walk me through every decision the user has made about the search pipeline, including the embedding model choice, the rerank step, and any benchmarking work that informed those decisions. Include both shipped changes and rolled-back experiments.',
  'Summarise the user history with postgres — schema migrations, performance benchmarks, the bridge config, related documentation updates, and any pricing or infrastructure decisions that depended on the database choice.',
  'For each topic the user has worked on (typescript, react, auth, deployment, testing, design), what are the most recent decisions and preferences? Include corrections, rollbacks, and outstanding open questions.',
  'Given the user has been benchmarking the search pipeline, the embedding model, and the rerank step, summarise what is known about each component, what was tried, what worked, and what was discarded. Reference any documentation that was updated as a result.',
  'I need a full timeline of changes to the bridge config, including reviewer notes, related CLI flag updates, downstream impact on the consolidator, and any rollbacks or follow-up work in the test fixtures or documentation.',
];

const BUCKETS: Array<{ name: 'short' | 'medium' | 'long'; queries: string[] }> = [
  { name: 'short', queries: SHORT_QUERIES },
  { name: 'medium', queries: MEDIUM_QUERIES },
  { name: 'long', queries: LONG_QUERIES },
];

// ── Runner ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  const benchStart = performance.now();

  const dir = join(tmpdir(), `engram-latency-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  const config: SmartMemoryConfig = {
    ...loadConfig({ dataDir: dir }),
    dataDir: dir,
    maxRecallChunks: args.topK,
  };

  const storage = new Storage(dir);
  await storage.ensureReady();

  // ── Seed ────────────────────────────────────────────────────────
  console.error(`Seeding ${args.chunks} chunks...`);
  const seedStart = performance.now();
  const batchSize = 50;
  for (let i = 0; i < args.chunks; i += batchSize) {
    const batch = [];
    for (let j = 0; j < batchSize && i + j < args.chunks; j++) {
      batch.push({
        ...makeEntry(i + j),
        skipKgExtraction: true,
        skipDailyEntry: true,
        awaitSideEffects: false,
      });
    }
    await ingest(config, storage, batch);
  }
  await flushPendingSideEffects();
  console.error(`Seed complete in ${((performance.now() - seedStart) / 1000).toFixed(1)}s`);

  // Warmup query (embedding model load + cache warm)
  await search(config, storage, 'warmup', args.topK);

  // ── Time queries ────────────────────────────────────────────────
  const samplesByBucket: Record<string, number[]> = { short: [], medium: [], long: [] };
  const queriesPerBucket = Math.max(1, Math.floor(args.queries / BUCKETS.length));
  let totalRun = 0;

  for (const bucket of BUCKETS) {
    console.error(`Running ${queriesPerBucket} ${bucket.name} queries...`);
    for (let i = 0; i < queriesPerBucket; i++) {
      const q = bucket.queries[i % bucket.queries.length];
      const start = performance.now();
      await search(config, storage, q, args.topK);
      const ms = performance.now() - start;
      samplesByBucket[bucket.name].push(ms);
      totalRun++;
    }
  }

  // Cleanup
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }

  // ── Summary ─────────────────────────────────────────────────────
  const allSamples = [...samplesByBucket.short, ...samplesByBucket.medium, ...samplesByBucket.long];

  console.log();
  console.log('='.repeat(76));
  console.log('QUERY LATENCY');
  console.log('='.repeat(76));
  console.log();
  console.log(`  Corpus size       ${args.chunks} chunks`);
  console.log(`  Queries timed     ${totalRun}`);
  console.log(`  Top-K             ${args.topK}`);
  console.log();

  for (const bucket of BUCKETS) {
    const p = percentiles(samplesByBucket[bucket.name]);
    console.log(`  ${bucket.name.padEnd(7)} n=${String(samplesByBucket[bucket.name].length).padStart(4)}  p50=${p.p50.toFixed(1).padStart(6)}ms  p95=${p.p95.toFixed(1).padStart(7)}ms  p99=${p.p99.toFixed(1).padStart(7)}ms  avg=${p.avg.toFixed(1).padStart(6)}ms`);
  }

  const overall = percentiles(allSamples);
  console.log();
  console.log(`  OVERALL          p50=${overall.p50.toFixed(1)}ms  p95=${overall.p95.toFixed(1)}ms  p99=${overall.p99.toFixed(1)}ms  avg=${overall.avg.toFixed(1)}ms`);
  console.log();

  // ── Result file ─────────────────────────────────────────────────
  if (args.emitJson) {
    const perBucket: Record<string, Record<string, unknown>> = {};
    for (const bucket of BUCKETS) {
      perBucket[bucket.name] = {
        n: samplesByBucket[bucket.name].length,
        latencyMs: percentiles(samplesByBucket[bucket.name]),
      };
    }

    const path = writeBenchmarkResult({
      benchmark: 'query-latency',
      durationMs: Math.round(performance.now() - benchStart),
      config: {
        embeddingModel: process.env.SMART_MEMORY_EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2',
        corpusChunks: args.chunks,
        queries: totalRun,
        topK: args.topK,
        storageBackend: 'file',
      },
      results: {
        latencyMs: overall,
        queries: totalRun,
      },
      perCategory: perBucket,
    });
    console.log(`Results JSON: ${path}`);
  }
}

main().catch(err => {
  console.error('Latency bench error:', err);
  process.exit(1);
});
