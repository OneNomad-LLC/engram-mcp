/**
 * Diagnostic retrieval trace.
 *
 * Every search() call optionally records a structured trace: the query
 * text, the candidate counts at each stage that participated, the final
 * result IDs, total latency, plus filter/intent flags. Traces persist to
 * `<dataDir>/traces/<YYYY-MM-DD>/<traceid>.json` so a future replay tool
 * can reconstruct what the retrieval pipeline saw.
 *
 * Why: per przm Memory architecture-patterns §5, "why didn't you find the
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
const DEFAULT_RETENTION_DAYS = 7;
export function createTrace(query, opts) {
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
export function recordStage(trace, stages) {
    Object.assign(trace.stages, stages);
}
/** Finalize the trace: stamp duration + result IDs. Caller still has to
 *  persist with `persistTrace` — split so callers can decide whether to
 *  drop a trace (e.g. for cancelled queries). */
export function endTrace(trace, resultIds) {
    trace.resultIds = resultIds;
    trace.durationMs = Date.now() - new Date(trace.startedAt).getTime();
}
/**
 * Persist a trace to disk under <dataDir>/traces/<YYYY-MM-DD>/<id>.json.
 * Best-effort; errors are swallowed (trace persistence must never break
 * the retrieval call).
 */
export async function persistTrace(cfg, trace) {
    try {
        const day = trace.startedAt.slice(0, 10);
        const dir = join(cfg.dataDir, "traces", day);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `${trace.id}.json`), JSON.stringify(trace, null, 2), "utf8");
    }
    catch {
        // intentional: persistence failures don't surface to the user.
        // The retrieval call already returned.
    }
}
/** List the most recent N traces across all retention days. */
export async function listRecentTraces(cfg, limit = 50) {
    const root = join(cfg.dataDir, "traces");
    let dayDirs;
    try {
        dayDirs = (await readdir(root)).sort().reverse();
    }
    catch {
        return [];
    }
    const out = [];
    for (const day of dayDirs) {
        if (out.length >= limit)
            break;
        let files;
        try {
            files = (await readdir(join(root, day))).filter((f) => f.endsWith(".json"));
        }
        catch {
            continue;
        }
        // Newest UUIDs lexicographically aren't truly newest, but stat-each-file
        // would multiply the disk hits. Read all then sort by startedAt.
        for (const file of files) {
            if (out.length >= limit)
                break;
            try {
                const raw = await readFile(join(root, day, file), "utf8");
                out.push(JSON.parse(raw));
            }
            catch {
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
export async function gcOldTraces(cfg) {
    const root = join(cfg.dataDir, "traces");
    let dayDirs;
    try {
        dayDirs = await readdir(root);
    }
    catch {
        return;
    }
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - (cfg.retentionDays ?? DEFAULT_RETENTION_DAYS));
    const cutoffDay = cutoff.toISOString().slice(0, 10);
    for (const day of dayDirs) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
            continue;
        if (day < cutoffDay) {
            try {
                await rm(join(root, day), { recursive: true, force: true });
            }
            catch { }
        }
    }
}
//# sourceMappingURL=retrieval-trace.js.map