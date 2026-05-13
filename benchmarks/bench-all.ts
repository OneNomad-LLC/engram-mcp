#!/usr/bin/env node

/**
 * Aggregator — runs every benchmark in sequence and prints a single
 * consolidated table at the end.
 *
 * Each child benchmark already writes its own JSON file to
 * benchmarks/results/. The aggregator captures the most-recent file
 * per benchmark and stitches them together for the final summary.
 *
 * Skips benchmarks whose dataset is missing (LoCoMo, LongMemEval) and
 * reports the skip rather than failing — partial runs are valid.
 *
 * Usage:
 *   npm run bench:all
 *   npm run bench:all -- --skip locomo,longmemeval     # operational only
 *   npm run bench:all -- --only bench,query-latency    # specific set
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESULTS_DIR_ABS } from './lib/results.js';

const HERE = dirname(fileURLToPath(import.meta.url));

interface BenchSpec {
  name: string;
  script: string;
  // When the dataset file at this path is missing, skip the bench with a clear note.
  datasetCheck?: string;
  datasetHint?: string;
}

const SPECS: BenchSpec[] = [
  { name: 'engram-synthetic', script: 'bench.ts' },
  { name: 'ingest-throughput', script: 'ingest-throughput.ts' },
  { name: 'query-latency', script: 'query-latency.ts' },
  {
    name: 'locomo',
    script: 'locomo.ts',
    datasetCheck: join(HERE, 'data', 'locomo', 'data', 'locomo10.json'),
    datasetHint: 'bash benchmarks/download-datasets.sh locomo',
  },
  {
    name: 'longmemeval',
    script: 'longmemeval.ts',
    datasetCheck: join(HERE, 'data', 'longmemeval_s_cleaned.json'),
    datasetHint: 'bash benchmarks/download-datasets.sh lme',
  },
];

// ── Args ─────────────────────────────────────────────────────────────

function parseList(flag: string): Set<string> | null {
  const i = process.argv.indexOf(flag);
  if (i < 0 || !process.argv[i + 1]) return null;
  return new Set(process.argv[i + 1].split(',').map(s => s.trim()));
}

const onlyFilter = parseList('--only');
const skipFilter = parseList('--skip');

// ── Per-bench run + capture result file ──────────────────────────────

interface RunRecord {
  name: string;
  status: 'ok' | 'skipped' | 'failed';
  reason?: string;
  resultFile?: string;
  payload?: any;
}

function findLatestResultFor(benchName: string, sinceMs: number): string | undefined {
  if (!existsSync(RESULTS_DIR_ABS)) return undefined;
  const entries = readdirSync(RESULTS_DIR_ABS)
    .filter(f => f.startsWith(`${benchName}-`) && f.endsWith('.json'))
    .map(f => ({ f, path: join(RESULTS_DIR_ABS, f), mtime: statSync(join(RESULTS_DIR_ABS, f)).mtimeMs }))
    .filter(e => e.mtime >= sinceMs - 1000)
    .sort((a, b) => b.mtime - a.mtime);
  return entries[0]?.path;
}

function runOne(spec: BenchSpec): RunRecord {
  if (spec.datasetCheck && !existsSync(spec.datasetCheck)) {
    return {
      name: spec.name,
      status: 'skipped',
      reason: `dataset not found at ${spec.datasetCheck} — run: ${spec.datasetHint ?? 'bash benchmarks/download-datasets.sh'}`,
    };
  }

  const startMs = Date.now();
  console.log();
  console.log('━'.repeat(76));
  console.log(`▶  ${spec.name}`);
  console.log('━'.repeat(76));

  const scriptPath = join(HERE, spec.script);
  const res = spawnSync(
    process.execPath,
    ['--import', 'tsx', scriptPath],
    { stdio: 'inherit', env: process.env }
  );

  if (res.status !== 0) {
    return { name: spec.name, status: 'failed', reason: `exit code ${res.status}` };
  }

  const resultFile = findLatestResultFor(spec.name, startMs);
  let payload: any;
  if (resultFile) {
    try {
      payload = JSON.parse(readFileSync(resultFile, 'utf-8'));
    } catch {
      /* noop */
    }
  }

  return { name: spec.name, status: 'ok', resultFile, payload };
}

// ── Run ──────────────────────────────────────────────────────────────

function shouldRun(name: string): boolean {
  if (onlyFilter && !onlyFilter.has(name)) return false;
  if (skipFilter && skipFilter.has(name)) return false;
  return true;
}

const records: RunRecord[] = [];
for (const spec of SPECS) {
  if (!shouldRun(spec.name)) continue;
  records.push(runOne(spec));
}

// ── Consolidated summary ─────────────────────────────────────────────

console.log();
console.log('═'.repeat(76));
console.log('  ENGRAM BENCHMARK SUITE — CONSOLIDATED');
console.log('═'.repeat(76));
console.log();

for (const r of records) {
  if (r.status === 'skipped') {
    console.log(`  ${r.name.padEnd(20)}  SKIPPED  ${r.reason ?? ''}`);
    continue;
  }
  if (r.status === 'failed') {
    console.log(`  ${r.name.padEnd(20)}  FAILED   ${r.reason ?? ''}`);
    continue;
  }

  const res = r.payload?.results ?? {};
  const cells: string[] = [];

  if (typeof res['recall@5'] === 'number') cells.push(`R@5=${(res['recall@5'] * 100).toFixed(1)}%`);
  if (typeof res['recall@10'] === 'number') cells.push(`R@10=${(res['recall@10'] * 100).toFixed(1)}%`);
  if (typeof res['ndcg@5'] === 'number') cells.push(`NDCG@5=${res['ndcg@5'].toFixed(3)}`);
  if (typeof res['ndcg@10'] === 'number') cells.push(`NDCG@10=${res['ndcg@10'].toFixed(3)}`);
  if (res.latencyMs && typeof res.latencyMs === 'object') {
    const l = res.latencyMs;
    cells.push(`latency p50=${l.p50}ms p95=${l.p95}ms p99=${l.p99}ms`);
  }
  if (typeof res.cold_chunksPerSec === 'number') cells.push(`cold=${res.cold_chunksPerSec}/s`);
  if (typeof res.warm_chunksPerSec === 'number') cells.push(`warm=${res.warm_chunksPerSec}/s`);

  console.log(`  ${r.name.padEnd(20)}  OK       ${cells.join('  ')}`);
}

console.log();
console.log(`  Result files in   ${RESULTS_DIR_ABS}`);
console.log(`  Run details:      see per-benchmark JSON for full config + per-category breakdown`);
console.log();

const failed = records.filter(r => r.status === 'failed');
if (failed.length > 0) {
  console.error(`\n${failed.length} benchmark(s) failed.`);
  process.exit(1);
}
