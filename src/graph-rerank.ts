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

const MAX_CANDIDATES_TO_EXPAND = 20;
const MAX_ENTITIES_PER_CANDIDATE = 5;
const BOOST_PER_CONNECTION = 0.15;
const MAX_BOOST = 0.5;

/**
 * Rerank candidates using a 1-hop KG expansion. Returns a new array
 * (does not mutate inputs); preserves all candidates, only reorders.
 */
export async function graphAwareRerank(
  storage: Storage,
  candidates: SearchResult[],
): Promise<SearchResult[]> {
  if (candidates.length === 0) return candidates;

  // Limit how many candidates we look up triples for — at typical
  // top-K (10-50), this is the whole list. Cap protects against
  // pathological inputs.
  const expandable = candidates.slice(0, MAX_CANDIDATES_TO_EXPAND);

  // Step 1+2: gather entities mentioned by each candidate's contributed
  // triples. Map entity → set of candidate ids that contributed it.
  const entityToCandidateIds = new Map<string, Set<string>>();
  const entitiesByCandidate = new Map<string, Set<string>>();

  for (const cand of expandable) {
    const id = cand.chunk.id;
    const triples = await storage.queryTriples({}).then((all) =>
      all.filter((t) => t.source === id),
    );
    if (triples.length === 0) continue;

    const entities = new Set<string>();
    for (const t of triples) {
      // Cheap dedup — both subject and object count as entities.
      entities.add(t.subject.toLowerCase());
      entities.add(t.object.toLowerCase());
    }
    // Cap per candidate so a single chunk that contributed 50 triples
    // doesn't dominate the entity index.
    const capped = Array.from(entities).slice(0, MAX_ENTITIES_PER_CANDIDATE);
    entitiesByCandidate.set(id, new Set(capped));
    for (const e of capped) {
      let set = entityToCandidateIds.get(e);
      if (!set) {
        set = new Set<string>();
        entityToCandidateIds.set(e, set);
      }
      set.add(id);
    }
  }

  if (entityToCandidateIds.size === 0) {
    // No graph data on these candidates — return unchanged.
    return candidates;
  }

  // Step 3+4: for each candidate, count how many connected entities
  // appear in its content. A candidate is "connected" via an entity
  // E if some OTHER candidate contributed E and this candidate's
  // content mentions E.
  const connectionCount = new Map<string, number>();

  for (const cand of candidates) {
    const id = cand.chunk.id;
    const ownEntities = entitiesByCandidate.get(id) ?? new Set<string>();
    const contentLower = cand.chunk.content.toLowerCase();
    let count = 0;
    for (const [entity, contributors] of entityToCandidateIds.entries()) {
      // Skip entities this candidate itself contributed.
      if (ownEntities.has(entity)) continue;
      // Skip entities only this candidate would have matched (no other contributors).
      if (contributors.size === 0) continue;
      if (contributors.has(id)) continue;
      // Cheap substring check — entity name appears in content.
      if (contentLower.includes(entity)) count++;
    }
    if (count > 0) connectionCount.set(id, count);
  }

  // Step 5: apply the boost.
  const boosted = candidates.map((cand) => {
    const count = connectionCount.get(cand.chunk.id) ?? 0;
    const boost = Math.min(MAX_BOOST, count * BOOST_PER_CONNECTION);
    return {
      ...cand,
      score: cand.score + boost,
    };
  });

  boosted.sort((a, b) => b.score - a.score);
  return boosted;
}

/**
 * Telemetry helper — returns the boost that *would* be applied to
 * each candidate without actually re-ranking them. Useful for
 * debugging and for the LoCoMo bench's per-question diagnostics.
 */
export async function explainGraphRerank(
  storage: Storage,
  candidates: SearchResult[],
): Promise<Array<{ id: string; score: number; connectionCount: number; boost: number }>> {
  const reranked = await graphAwareRerank(storage, candidates);
  // Re-zip: the reranked array carries the boosted score; the
  // diff against original gives boost magnitude.
  const originalById = new Map(candidates.map((c) => [c.chunk.id, c.score]));
  return reranked.map((r) => {
    const original = originalById.get(r.chunk.id) ?? r.score;
    const boost = r.score - original;
    return {
      id: r.chunk.id,
      score: r.score,
      connectionCount: Math.round(boost / BOOST_PER_CONNECTION),
      boost,
    };
  });
}
