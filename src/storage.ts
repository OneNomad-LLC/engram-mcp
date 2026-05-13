/**
 * Storage — backwards-compatible shim over the pluggable StorageAdapter.
 *
 * Engram historically exposed a concrete `Storage` class that owned
 * LanceDB tables directly. ~20 modules import { Storage } from here
 * and call `new Storage(dataDir)` then `await storage.ensureReady()`.
 * The shim keeps that surface intact while delegating every method to
 * a backend adapter selected by createStorageAdapter().
 *
 *   STORAGE_BACKEND=file        — FileStorageAdapter (default; LanceDB)
 *   STORAGE_BACKEND=postgres    — PostgresStorageAdapter (multi-tenant)
 *
 * File-mode callers (`new Storage(dataDir)`) see byte-identical
 * behavior to the pre-adapter implementation. Postgres-mode callers
 * skip the dataDir and read DATABASE_URL + TENANT_ID from env.
 */

import type {
  MemoryTier,
  DailyLogEntry,
  ProceduralRule,
  KnowledgeTriple,
  DiaryEntry,
} from './types.js';
import type {
  StorageAdapter,
  StoredChunk,
  ListChunksOpts,
  QueryTriplesOpts,
  TripleStats,
  VectorHit,
  ReadDiaryOpts,
  HandoffNote,
  HandoffSummary,
} from './storage-adapter.js';
import { createStorageAdapter, resolveBackend } from './storage-factory.js';
import { FileStorageAdapter } from './storage-file.js';

// Re-export so old `import { StoredChunk } from './storage.js'` keeps working.
export type { StoredChunk } from './storage-adapter.js';

export class Storage {
  private adapter!: StorageAdapter;
  private ready: Promise<void>;

  constructor(dataDir: string) {
    // Resolve eagerly; file mode is sync, postgres mode awaits the
    // factory before ensureReady() returns.
    const backend = resolveBackend();
    if (backend === 'file') {
      // Hot path — no dynamic import, no env-var roundtrip.
      this.adapter = new FileStorageAdapter(dataDir);
      this.ready = this.adapter.ensureReady();
    } else {
      this.ready = (async () => {
        this.adapter = await createStorageAdapter({ dataDir, backend });
        await this.adapter.ensureReady();
      })();
    }
  }

  async ensureReady(): Promise<void> {
    await this.ready;
  }

  // ── Chunks ────────────────────────────────────────────────────────

  saveChunk(chunk: StoredChunk): Promise<void> { return this.adapter.saveChunk(chunk); }
  getChunk(id: string): Promise<StoredChunk | null> { return this.adapter.getChunk(id); }
  deleteChunk(id: string): Promise<void> { return this.adapter.deleteChunk(id); }
  listChunks(opts?: ListChunksOpts): Promise<StoredChunk[]> { return this.adapter.listChunks(opts); }
  updateChunk(id: string, updates: Partial<StoredChunk>): Promise<void> { return this.adapter.updateChunk(id, updates); }
  chunkCount(): Promise<number> { return this.adapter.chunkCount(); }
  vectorSearch(queryEmbedding: number[], limit: number, filter?: string): Promise<VectorHit[]> {
    return this.adapter.vectorSearch(queryEmbedding, limit, filter);
  }

  // ── Taxonomy ─────────────────────────────────────────────────────

  getTaxonomy(): Promise<Record<string, Record<string, number>>> { return this.adapter.getTaxonomy(); }

  // ── Daily logs ───────────────────────────────────────────────────

  appendDailyEntry(date: string, entry: DailyLogEntry): Promise<void> {
    return this.adapter.appendDailyEntry(date, entry);
  }
  getDailyLogs(daysBack: number): Promise<Array<{ date: string; entries: DailyLogEntry[] }>> {
    return this.adapter.getDailyLogs(daysBack);
  }

  // ── Rules ────────────────────────────────────────────────────────

  saveRule(rule: ProceduralRule): Promise<void> { return this.adapter.saveRule(rule); }
  getRules(): Promise<ProceduralRule[]> { return this.adapter.getRules(); }
  deleteRule(id: string): Promise<void> { return this.adapter.deleteRule(id); }

  // ── Knowledge triples ────────────────────────────────────────────

  saveTriple(triple: KnowledgeTriple): Promise<void> { return this.adapter.saveTriple(triple); }
  queryTriples(opts?: QueryTriplesOpts): Promise<KnowledgeTriple[]> { return this.adapter.queryTriples(opts); }
  invalidateTriple(id: string): Promise<void> { return this.adapter.invalidateTriple(id); }
  getTripleTimeline(entity: string): Promise<KnowledgeTriple[]> { return this.adapter.getTripleTimeline(entity); }
  getTripleStats(): Promise<TripleStats> { return this.adapter.getTripleStats(); }

  // ── Diary + handoffs (new surface — server.ts routes through these
  //    when STORAGE_BACKEND=postgres so the markdown filesystem layer
  //    isn't required for cloud installs) ───────────────────────────

  writeDiaryEntry(content: string, agent?: string): Promise<DiaryEntry> {
    return this.adapter.writeDiaryEntry(content, agent);
  }
  readDiary(opts?: ReadDiaryOpts): Promise<Array<{ date: string; entries: DiaryEntry[] }>> {
    return this.adapter.readDiary(opts);
  }
  listDiaryDates(): Promise<string[]> { return this.adapter.listDiaryDates(); }

  writeHandoff(note: Omit<HandoffNote, 'timestamp'>): Promise<HandoffNote> {
    return this.adapter.writeHandoff(note);
  }
  readHandoff(stamp?: string): Promise<HandoffNote | null> { return this.adapter.readHandoff(stamp); }
  listHandoffs(limit?: number): Promise<HandoffSummary[]> { return this.adapter.listHandoffs(limit); }

  // ── Lifecycle ────────────────────────────────────────────────────

  close(): void {
    // Adapter close is optional + may be async; fire-and-forget for
    // backwards compat (the file backend's close is a no-op).
    if (this.adapter?.close) {
      Promise.resolve(this.adapter.close()).catch(() => { /* swallow */ });
    }
  }
}

// Silence unused-import warning on MemoryTier; surface kept for downstream callers.
export type { MemoryTier };
