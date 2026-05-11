/**
 * Diagnostic retrieval trace.
 *
 * Every search() call optionally records a structured trace: the query
 * text, the candidate counts at each stage that participated, the final
 * result IDs, total latency, plus filter/intent flags. Traces persist to
 * `<dataDir>/traces/<YYYY-MM-DD>/<traceid>.json` so a future replay tool
 * can reconstruct what the retrieval pipeline saw.
 *
 * Why: per Engram architecture-patterns §5, "why didn't you find the
 * obvious doc" is the most common quality complaint. Without traces,
 * every report is a bespoke debugging session. Traces also feed quality
 * metrics (floor calibration, recall@k per workspace) when enough
 * accumulate.
 *
 * This is the v1 surface. Stage-by-stage instrumentation (per-stage
 * latency, knowledge-graph hits, spreading-activation hops) is left
 * intentionally minimal — the trace primitive is in place so future
 * stages can record into it without changing the public shape.
 *
 * Disabled by default (config.enableRetrievalTraces). Enable via env
 * `ENGRAM_ENABLE_RETRIEVAL_TRACES=true` or by setting the config flag.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface RetrievalTrace {
  /** Unique ID; used as the persisted filename. */
  id: string;
  /** ISO timestamp of when the trace started. */
  startedAt: string;
  /** The query string the caller passed. */
  query: string;
  /** Filters applied to the search (domain/topic/tag if any). */
  filters: { domain?: string; topic?: string; tag?: string } | undefined;
  /** Caller-supplied maxResults (or null when default). */
  maxResults: number | null;
  /** Per-stage candidate counts. Stages may be absent when they didn't run
   *  (e.g. vectorCandidates is undefined when embedding fell back to
   *  keyword-only). */
  stages: {
    /** Total chunks pulled from storage before any filtering. */
    corpusSize?: number;
    /** Vector ANN candidates AFTER the 0.25 floor; below-floor matches
     *  are dropped here. */
    vectorAboveFloor?: number;
    /** Vector ANN candidates BELOW the 0.25 floor (informational). */
    vectorBelowFloor?: number;
    /** IDF-weighted keyword scoring matches. */
    keywordMatches?: number;
    /** Final ranked candidates returned (post merge / boost / cap). */
    finalCount?: number;
  };
  /** Final result chunk IDs in returned order. */
  resultIds: string[];
  /** Total wall-clock duration in milliseconds. Set by `endTrace`. */
  durationMs?: number;
  /** Why search was called. Free-form caller hint; not part of the
   *  retrieval logic. */
  intentHint?: string;
}

export interface TraceConfig {
  /** Where to persist traces. Defaults to <dataDir>/traces. */
  dataDir: string;
  /** Days to keep traces before garbage collection. */
  retentionDays: number;
}

const DEFAULT_RETENTION_DAYS = 7;

export function createTrace(query: string, opts: {
  filters?: RetrievalTrace["filters"];
  maxResults?: number;
  intentHint?: string;
}): RetrievalTrace {
  return {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    query,
    filters: opts.filters,
    maxResults: opts.maxResults ?? null,
    stages: {},
    resultIds: [],
    intentHint: opts.intentHint,
  };
}

/** In-place stage update. Caller passes only the fields that just resolved. */
export function recordStage(trace: RetrievalTrace, stages: Partial<RetrievalTrace["stages"]>): void {
  Object.assign(trace.stages, stages);
}

/** Finalize the trace: stamp duration + result IDs. Caller still has to
 *  persist with `persistTrace` — split so callers can decide whether to
 *  drop a trace (e.g. for cancelled queries). */
export function endTrace(trace: RetrievalTrace, resultIds: string[]): void {
  trace.resultIds = resultIds;
  trace.durationMs = Date.now() - new Date(trace.startedAt).getTime();
}

/**
 * Persist a trace to disk under <dataDir>/traces/<YYYY-MM-DD>/<id>.json.
 * Best-effort; errors are swallowed (trace persistence must never break
 * the retrieval call).
 */
export async function persistTrace(cfg: TraceConfig, trace: RetrievalTrace): Promise<void> {
  try {
    const day = trace.startedAt.slice(0, 10);
    const dir = join(cfg.dataDir, "traces", day);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${trace.id}.json`), JSON.stringify(trace, null, 2), "utf8");
  } catch {
    // intentional: persistence failures don't surface to the user.
    // The retrieval call already returned.
  }
}

/** List the most recent N traces across all retention days. */
export async function listRecentTraces(cfg: TraceConfig, limit = 50): Promise<RetrievalTrace[]> {
  const root = join(cfg.dataDir, "traces");
  let dayDirs: string[];
  try {
    dayDirs = (await readdir(root)).sort().reverse();
  } catch {
    return [];
  }

  const out: RetrievalTrace[] = [];
  for (const day of dayDirs) {
    if (out.length >= limit) break;
    let files: string[];
    try {
      files = (await readdir(join(root, day))).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    // Newest UUIDs lexicographically aren't truly newest, but stat-each-file
    // would multiply the disk hits. Read all then sort by startedAt.
    for (const file of files) {
      if (out.length >= limit) break;
      try {
        const raw = await readFile(join(root, day, file), "utf8");
        out.push(JSON.parse(raw) as RetrievalTrace);
      } catch {
        // skip malformed
      }
    }
  }
  return out
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}

/**
 * Garbage-collect day directories older than retentionDays.
 * Best-effort; safe to call on every server start.
 */
export async function gcOldTraces(cfg: TraceConfig): Promise<void> {
  const root = join(cfg.dataDir, "traces");
  let dayDirs: string[];
  try {
    dayDirs = await readdir(root);
  } catch {
    return;
  }
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - (cfg.retentionDays ?? DEFAULT_RETENTION_DAYS));
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  for (const day of dayDirs) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (day < cutoffDay) {
      try { await rm(join(root, day), { recursive: true, force: true }); } catch {}
    }
  }
}
