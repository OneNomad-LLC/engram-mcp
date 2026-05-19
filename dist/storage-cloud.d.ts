/**
 * CloudStorageAdapter — przm Cloud HTTP-backed storage.
 *
 * Speaks the wire contract przm server exposes at /api/engram/*. Each
 * StorageAdapter method maps to a single HTTP request — przm server is
 * a thin multi-tenant Postgres-over-HTTP shim that mirrors what
 * PostgresStorageAdapter does locally.
 *
 * Auth: Bearer token from credentials.json. The server derives the
 * tenant_id from the api-key; the adapter never plumbs it.
 *
 * Error envelope: przm server emits `{ "error": { "code", "message" } }`
 * on non-2xx. errorBody() unpacks it; failures bubble up as Error
 * with that text so the rest of the engram pipeline reports cleanly.
 */
import type { StorageAdapter, StoredChunk, ListChunksOpts, HandoffNote, HandoffSummary, QueryTriplesOpts, TripleStats, VectorHit, ReadDiaryOpts } from './storage-adapter.js';
import type { DailyLogEntry, ProceduralRule, KnowledgeTriple, DiaryEntry } from './types.js';
export interface CloudStorageOptions {
    apiUrl: string;
    apiKey: string;
    label?: string;
    scopes?: string[];
    fetch?: typeof fetch;
}
export declare class CloudStorageAdapter implements StorageAdapter {
    readonly apiUrl: string;
    readonly apiKey: string;
    readonly label: string | undefined;
    readonly scopes: readonly string[];
    private readonly fetchImpl;
    constructor(opts: CloudStorageOptions);
    private url;
    private headers;
    private request;
    private send;
    private sendJson;
    ensureReady(): Promise<void>;
    close(): Promise<void>;
    saveChunk(chunk: StoredChunk): Promise<void>;
    saveChunks(chunks: StoredChunk[]): Promise<void>;
    getChunk(id: string): Promise<StoredChunk | null>;
    deleteChunk(id: string): Promise<void>;
    listChunks(opts?: ListChunksOpts): Promise<StoredChunk[]>;
    updateChunk(id: string, updates: Partial<StoredChunk>): Promise<void>;
    chunkCount(): Promise<number>;
    vectorSearch(queryEmbedding: number[], limit: number, filter?: string): Promise<VectorHit[]>;
    getTaxonomy(): Promise<Record<string, Record<string, number>>>;
    appendDailyEntry(date: string, entry: DailyLogEntry): Promise<void>;
    getDailyLogs(daysBack: number): Promise<Array<{
        date: string;
        entries: DailyLogEntry[];
    }>>;
    saveRule(rule: ProceduralRule): Promise<void>;
    getRules(): Promise<ProceduralRule[]>;
    deleteRule(id: string): Promise<void>;
    saveTriple(triple: KnowledgeTriple): Promise<void>;
    queryTriples(opts?: QueryTriplesOpts): Promise<KnowledgeTriple[]>;
    invalidateTriple(id: string): Promise<void>;
    getTripleTimeline(entity: string): Promise<KnowledgeTriple[]>;
    getTripleStats(): Promise<TripleStats>;
    writeDiaryEntry(content: string, agent?: string): Promise<DiaryEntry>;
    readDiary(opts?: ReadDiaryOpts): Promise<Array<{
        date: string;
        entries: DiaryEntry[];
    }>>;
    listDiaryDates(): Promise<string[]>;
    writeHandoff(note: Omit<HandoffNote, 'timestamp'>): Promise<HandoffNote>;
    readHandoff(stamp?: string): Promise<HandoffNote | null>;
    listHandoffs(limit?: number): Promise<HandoffSummary[]>;
}
