/**
 * Graph-aware reranking — a 1-hop expansion over the KG that operates
 * on similarity-search candidates.
 *
 * This is a lite version of HippoRAG (Gutiérrez et al, NeurIPS 2024).
 * Full HippoRAG runs personalized PageRank from query-seed entities;
 * this implementation does a single-hop expansion plus score boosting.
 * Same spirit, contained scope: real graph-awareness without the
 * algorithmic complexity of PPR convergence.
 *
 * Procedure:
 *   1. Take the top-K similarity-ranked candidates from `search()`.
 *   2. For each candidate, look up KG triples whose `source` field is
 *      that chunk's id — these are the entity assertions the chunk
 *      contributed.
 *   3. From those triples, gather the *connected entities* (subjects
 *      and objects).
 *   4. For each connected entity, find OTHER chunks in the candidate
 *      pool whose content mentions the entity (case-insensitive
 *      substring match).
 *   5. Boost those chunks' scores. The boost is conservative — a chunk
 *      that gets connected via 2+ entities gets a stronger lift than
 *      one connected via 1.
 *
 * Why this helps LoCoMo R@k: the dataset has multi-hop QA pairs
 * ("what city does X live in, and what's the weather like there?")
 * where the answer chunks aren't the top similarity match — they're
 * one graph hop away. Pure similarity ranking misses them; graph-
 * aware reranking catches them.
 *
 * Lower bound on quality: when no KG triples exist for any candidate,
 * results are returned unchanged. The function is safe to enable as
 * a default; it just doesn't help on memory stores without graph data.
 */
import type { Storage } from './storage.js';
import type { SearchResult } from './types.js';
/**
 * Rerank candidates using a 1-hop KG expansion. Returns a new array
 * (does not mutate inputs); preserves all candidates, only reorders.
 */
export declare function graphAwareRerank(storage: Storage, candidates: SearchResult[]): Promise<SearchResult[]>;
export declare function graphAwareRerankPPR(storage: Storage, candidates: SearchResult[]): Promise<SearchResult[]>;
/**
 * Telemetry helper — returns the boost that *would* be applied to
 * each candidate without actually re-ranking them. Useful for
 * debugging and for the LoCoMo bench's per-question diagnostics.
 */
export declare function explainGraphRerank(storage: Storage, candidates: SearchResult[]): Promise<Array<{
    id: string;
    score: number;
    connectionCount: number;
    boost: number;
}>>;
