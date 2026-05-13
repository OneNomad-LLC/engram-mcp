/**
 * CloudStorageAdapter — Pyre Cloud HTTP-backed storage. STUB.
 *
 * The cloud storage adapter is the next PR. For now this file exists
 * solely so that the storage factory can construct an adapter when a
 * ~/.pyre/credentials.json is present without having to special-case
 * the wiring up through the rest of the codebase.
 *
 * Every method throws with a clear "not yet implemented" message.
 * That's a feature, not a bug: a user who runs `engram-mcp login`
 * today should see an explicit failure instead of silently falling
 * back to local file mode and having two stores diverge.
 */

import type { StorageAdapter, StoredChunk, ListChunksOpts, HandoffNote, HandoffSummary, QueryTriplesOpts, TripleStats, VectorHit, ReadDiaryOpts } from './storage-adapter.js';
import type { DailyLogEntry, ProceduralRule, KnowledgeTriple, DiaryEntry } from './types.js';

export interface CloudStorageOptions {
  apiUrl: string;
  apiKey: string;
  label?: string;
  scopes?: string[];
}

function notImplemented(method: string): never {
  throw new Error(
    `CloudStorageAdapter.${method}: cloud storage backend is not yet implemented — ` +
    `the device-code login + credentials file landed first, the HTTP adapter ships in the next PR. ` +
    `Until then, unset STORAGE_BACKEND and remove ~/.pyre/credentials.json (or run \`engram-mcp logout\`) ` +
    `to use the local file backend.`,
  );
}

export class CloudStorageAdapter implements StorageAdapter {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly label: string | undefined;
  readonly scopes: readonly string[];

  constructor(opts: CloudStorageOptions) {
    this.apiUrl = opts.apiUrl;
    this.apiKey = opts.apiKey;
    this.label = opts.label;
    this.scopes = Object.freeze([...(opts.scopes ?? [])]);
  }

  // Lifecycle ─────────────────────────────────────────────────────────
  async ensureReady(): Promise<void> { notImplemented('ensureReady'); }
  async close(): Promise<void> { /* nothing to clean up in the stub */ }

  // Chunks ────────────────────────────────────────────────────────────
  async saveChunk(_chunk: StoredChunk): Promise<void> { notImplemented('saveChunk'); }
  async saveChunks(_chunks: StoredChunk[]): Promise<void> { notImplemented('saveChunks'); }
  async getChunk(_id: string): Promise<StoredChunk | null> { notImplemented('getChunk'); }
  async deleteChunk(_id: string): Promise<void> { notImplemented('deleteChunk'); }
  async listChunks(_opts?: ListChunksOpts): Promise<StoredChunk[]> { notImplemented('listChunks'); }
  async updateChunk(_id: string, _updates: Partial<StoredChunk>): Promise<void> { notImplemented('updateChunk'); }
  async chunkCount(): Promise<number> { notImplemented('chunkCount'); }
  async vectorSearch(_q: number[], _limit: number, _filter?: string): Promise<VectorHit[]> { notImplemented('vectorSearch'); }

  // Taxonomy ──────────────────────────────────────────────────────────
  async getTaxonomy(): Promise<Record<string, Record<string, number>>> { notImplemented('getTaxonomy'); }

  // Daily logs ────────────────────────────────────────────────────────
  async appendDailyEntry(_date: string, _entry: DailyLogEntry): Promise<void> { notImplemented('appendDailyEntry'); }
  async getDailyLogs(_daysBack: number): Promise<Array<{ date: string; entries: DailyLogEntry[] }>> { notImplemented('getDailyLogs'); }

  // Procedural rules ──────────────────────────────────────────────────
  async saveRule(_rule: ProceduralRule): Promise<void> { notImplemented('saveRule'); }
  async getRules(): Promise<ProceduralRule[]> { notImplemented('getRules'); }
  async deleteRule(_id: string): Promise<void> { notImplemented('deleteRule'); }

  // Knowledge triples ─────────────────────────────────────────────────
  async saveTriple(_triple: KnowledgeTriple): Promise<void> { notImplemented('saveTriple'); }
  async queryTriples(_opts?: QueryTriplesOpts): Promise<KnowledgeTriple[]> { notImplemented('queryTriples'); }
  async invalidateTriple(_id: string): Promise<void> { notImplemented('invalidateTriple'); }
  async getTripleTimeline(_entity: string): Promise<KnowledgeTriple[]> { notImplemented('getTripleTimeline'); }
  async getTripleStats(): Promise<TripleStats> { notImplemented('getTripleStats'); }

  // Diary ─────────────────────────────────────────────────────────────
  async writeDiaryEntry(_content: string, _agent?: string): Promise<DiaryEntry> { notImplemented('writeDiaryEntry'); }
  async readDiary(_opts?: ReadDiaryOpts): Promise<Array<{ date: string; entries: DiaryEntry[] }>> { notImplemented('readDiary'); }
  async listDiaryDates(): Promise<string[]> { notImplemented('listDiaryDates'); }

  // Handoffs ──────────────────────────────────────────────────────────
  async writeHandoff(_note: Omit<HandoffNote, 'timestamp'>): Promise<HandoffNote> { notImplemented('writeHandoff'); }
  async readHandoff(_stamp?: string): Promise<HandoffNote | null> { notImplemented('readHandoff'); }
  async listHandoffs(_limit?: number): Promise<HandoffSummary[]> { notImplemented('listHandoffs'); }
}
