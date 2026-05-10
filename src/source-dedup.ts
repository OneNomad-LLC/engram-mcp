/**
 * Session-scoped same-source ingest dedup.
 *
 * Agents in long sessions repeatedly re-read stable files, re-poll
 * unchanged endpoints, and re-list the same directories. Each re-ingest
 * goes through the full chunk → embed → save pipeline even though the
 * content hasn't moved. On CPU embeddings (Engram's default backend),
 * a 20K-token re-read can cost 5–15 seconds; multiplied across a
 * 50-step agent run that's significant wall-clock burn.
 *
 * The existing 0.75-similarity dedup (in `server.ts`'s memory_ingest
 * tool handler) catches semantic duplicates, but does so against the
 * ENTIRE memory store — and at write-time it actually trips on
 * incidentally-similar memories (a fact about Pyre at 0.78 similarity
 * to a fact about Engram). It also requires the new content to be
 * embedded first, so it doesn't save the embedding cost.
 *
 * This module is the cheaper, more conservative path:
 *   - Scoped to a single source identifier (file path, URL, etc.).
 *   - Hash-based equality (SHA-256 of trimmed content) — exact match
 *     only, no false positives.
 *   - In-memory LRU keyed by `source` → list of recent content hashes.
 *   - Bounded: max 64 sources tracked, max 8 hashes per source.
 *
 * When an ingest hits the dedup cache, the caller can skip embedding
 * AND skip the disk write — return the cached chunk id. Agent's
 * conversation history stays internally consistent (same id for same
 * content), and the wall-clock cost drops from "embed + save" to a
 * map lookup.
 *
 * Process-scoped intentionally: the persistence layer doesn't need
 * to know about this. Engram restart resets the cache — first ingest
 * after restart goes through the full pipeline, which is fine.
 */

import { createHash } from 'node:crypto';

export interface SourceDedupEntry {
  /** SHA-256 of trimmed content. */
  hash: string;
  /** ID of the existing chunk in storage. Returned on cache hit so
   *  the caller's response is identical to what a fresh ingest would
   *  have produced. */
  chunkId: string;
  /** Insertion timestamp for LRU eviction. */
  ts: number;
}

const MAX_SOURCES = 64;
const MAX_PER_SOURCE = 8;

export class SourceDedupCache {
  /** sourceKey → list of recent (hash, chunkId) entries, MRU first. */
  private readonly bySource = new Map<string, SourceDedupEntry[]>();

  /** Cache hit count since boot. Useful for telemetry. */
  hits = 0;
  /** Cache miss count since boot. */
  misses = 0;

  /**
   * Hash trimmed content. Stable across ingest calls for the same
   * payload — that's the whole point.
   */
  static hashContent(content: string): string {
    return createHash('sha256').update(content.trim()).digest('hex');
  }

  /**
   * Look up a (source, content) pair. Returns the cached entry on hit
   * or null on miss. Does NOT promote the entry on read — promote on
   * write only, so a hit doesn't reset its LRU position.
   */
  lookup(source: string | undefined, content: string): SourceDedupEntry | null {
    if (!source) {
      // No source key → no scoping → don't dedup. The caller's
      // existing semantic-similarity dedup is the right tool for
      // unscoped ingests.
      this.misses++;
      return null;
    }
    const list = this.bySource.get(source);
    if (!list || list.length === 0) {
      this.misses++;
      return null;
    }
    const hash = SourceDedupCache.hashContent(content);
    const found = list.find((e) => e.hash === hash);
    if (found) {
      this.hits++;
      return found;
    }
    this.misses++;
    return null;
  }

  /**
   * Record a new (source, content, chunkId) entry after a successful
   * ingest. LRU-evicts the oldest entry per source when the per-source
   * cap is hit, and the oldest source when the overall cap is hit.
   */
  remember(source: string | undefined, content: string, chunkId: string): void {
    if (!source) return;
    const hash = SourceDedupCache.hashContent(content);
    const entry: SourceDedupEntry = { hash, chunkId, ts: Date.now() };

    let list = this.bySource.get(source);
    if (!list) {
      list = [];
      // Evict the oldest source if we're at the global cap.
      if (this.bySource.size >= MAX_SOURCES) {
        let oldestKey: string | null = null;
        let oldestTs = Infinity;
        for (const [k, entries] of this.bySource.entries()) {
          const recent = entries[0]?.ts ?? 0;
          if (recent < oldestTs) {
            oldestTs = recent;
            oldestKey = k;
          }
        }
        if (oldestKey) this.bySource.delete(oldestKey);
      }
      this.bySource.set(source, list);
    }

    // De-dupe by hash within the per-source list — if the same hash
    // is already there, replace it (fresh chunkId), otherwise prepend.
    const existing = list.findIndex((e) => e.hash === hash);
    if (existing >= 0) {
      list[existing] = entry;
    } else {
      list.unshift(entry);
      if (list.length > MAX_PER_SOURCE) list.length = MAX_PER_SOURCE;
    }
  }

  /** Drop the entire cache. Useful for tests and explicit resets. */
  clear(): void {
    this.bySource.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /** Snapshot stats for telemetry / Settings UI. */
  stats(): { sources: number; entries: number; hits: number; misses: number; hitRate: number } {
    let entries = 0;
    for (const list of this.bySource.values()) entries += list.length;
    const total = this.hits + this.misses;
    return {
      sources: this.bySource.size,
      entries,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }
}

/**
 * Module-level singleton. Engram is process-singleton anyway (one
 * server instance per data dir), so a single cache covers the whole
 * lifetime. Tests construct fresh `SourceDedupCache` instances; prod
 * uses this default.
 */
export const sourceDedup = new SourceDedupCache();
