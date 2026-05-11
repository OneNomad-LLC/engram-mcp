export interface RetrievalTrace {
    /** Unique ID; used as the persisted filename. */
    id: string;
    /** ISO timestamp of when the trace started. */
    startedAt: string;
    /** The query string the caller passed. */
    query: string;
    /** Filters applied to the search (domain/topic/tag if any). */
    filters: {
        domain?: string;
        topic?: string;
        tag?: string;
    } | undefined;
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
export declare function createTrace(query: string, opts: {
    filters?: RetrievalTrace["filters"];
    maxResults?: number;
    intentHint?: string;
}): RetrievalTrace;
/** In-place stage update. Caller passes only the fields that just resolved. */
export declare function recordStage(trace: RetrievalTrace, stages: Partial<RetrievalTrace["stages"]>): void;
/** Finalize the trace: stamp duration + result IDs. Caller still has to
 *  persist with `persistTrace` — split so callers can decide whether to
 *  drop a trace (e.g. for cancelled queries). */
export declare function endTrace(trace: RetrievalTrace, resultIds: string[]): void;
/**
 * Persist a trace to disk under <dataDir>/traces/<YYYY-MM-DD>/<id>.json.
 * Best-effort; errors are swallowed (trace persistence must never break
 * the retrieval call).
 */
export declare function persistTrace(cfg: TraceConfig, trace: RetrievalTrace): Promise<void>;
/** List the most recent N traces across all retention days. */
export declare function listRecentTraces(cfg: TraceConfig, limit?: number): Promise<RetrievalTrace[]>;
/**
 * Garbage-collect day directories older than retentionDays.
 * Best-effort; safe to call on every server start.
 */
export declare function gcOldTraces(cfg: TraceConfig): Promise<void>;
