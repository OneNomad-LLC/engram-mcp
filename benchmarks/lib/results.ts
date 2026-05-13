/**
 * Shared result-writer for Engram benchmarks.
 *
 * Every benchmark writes a JSON file to benchmarks/results/<name>-<ts>.json
 * alongside its existing stdout summary. The JSON files are .gitignored —
 * reproducible by re-running the bench, but pinned to a specific commit
 * + config so external comparison is auditable.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(HERE, '..', 'results');

export interface BenchmarkResultFile {
  benchmark: string;
  version: string;
  commit: string;
  config: Record<string, unknown>;
  ranAt: string;
  durationMs: number;
  results: Record<string, unknown>;
  perCategory?: Record<string, Record<string, unknown>>;
  notes?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function getPackageVersion(): string {
  try {
    const pkgPath = join(HERE, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return String(pkg.version ?? 'unknown');
  } catch {
    return 'unknown';
  }
}

function getGitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

function timestampSlug(): string {
  // ISO without colons → filename-safe.
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Write a benchmark's JSON result file. Returns the absolute path.
 * Caller passes the benchmark-specific keys; this helper fills in the
 * cross-cutting envelope fields (version, commit, ranAt).
 */
export function writeBenchmarkResult(
  partial: Omit<BenchmarkResultFile, 'version' | 'commit' | 'ranAt'> &
    Partial<Pick<BenchmarkResultFile, 'version' | 'commit' | 'ranAt'>>
): string {
  if (!existsSync(RESULTS_DIR)) {
    mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const filled: BenchmarkResultFile = {
    version: partial.version ?? getPackageVersion(),
    commit: partial.commit ?? getGitCommit(),
    ranAt: partial.ranAt ?? new Date().toISOString(),
    ...partial,
  };

  const filename = `${filled.benchmark}-${timestampSlug()}.json`;
  const path = join(RESULTS_DIR, filename);
  writeFileSync(path, JSON.stringify(filled, null, 2) + '\n');
  return path;
}

/**
 * Compute p50 / p95 / p99 from a list of latencies (ms).
 * Returns 0 for empty input — callers should not record latency keys
 * when no samples were collected.
 */
export function percentiles(samples: number[]): { p50: number; p95: number; p99: number; avg: number; min: number; max: number } {
  if (samples.length === 0) return { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  return {
    p50: Math.round(pick(0.5) * 10) / 10,
    p95: Math.round(pick(0.95) * 10) / 10,
    p99: Math.round(pick(0.99) * 10) / 10,
    avg: Math.round(avg * 10) / 10,
    min: Math.round(sorted[0] * 10) / 10,
    max: Math.round(sorted[sorted.length - 1] * 10) / 10,
  };
}

export const RESULTS_DIR_ABS = RESULTS_DIR;
