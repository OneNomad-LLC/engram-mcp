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
export declare class CloudStorageAdapter implements StorageAdapter {
    readonly apiUrl: string;
    readonly apiKey: string;
    readonly label: string | undefined;
    readonly scopes: readonly string[];
    constructor(opts: CloudStorageOptions);
    ensureReady(): Promise<void>;
    close(): Promise<void>;
    saveChunk(_chunk: StoredChunk): Promise<void>;
    getChunk(_id: string): Promise<StoredChunk | null>;
    deleteChunk(_id: string): Promise<void>;
    listChunks(_opts?: ListChunksOpts): Promise<StoredChunk[]>;
    updateChunk(_id: string, _updates: Partial<StoredChunk>): Promise<void>;
    chunkCount(): Promise<number>;
    vectorSearch(_q: number[], _limit: number, _filter?: string): Promise<VectorHit[]>;
    getTaxonomy(): Promise<Record<string, Record<string, number>>>;
    appendDailyEntry(_date: string, _entry: DailyLogEntry): Promise<void>;
    getDailyLogs(_daysBack: number): Promise<Array<{
        date: string;
        entries: DailyLogEntry[];
    }>>;
    saveRule(_rule: ProceduralRule): Promise<void>;
    getRules(): Promise<ProceduralRule[]>;
    deleteRule(_id: string): Promise<void>;
    saveTriple(_triple: KnowledgeTriple): Promise<void>;
    queryTriples(_opts?: QueryTriplesOpts): Promise<KnowledgeTriple[]>;
    invalidateTriple(_id: string): Promise<void>;
    getTripleTimeline(_entity: string): Promise<KnowledgeTriple[]>;
    getTripleStats(): Promise<TripleStats>;
    writeDiaryEntry(_content: string, _agent?: string): Promise<DiaryEntry>;
    readDiary(_opts?: ReadDiaryOpts): Promise<Array<{
        date: string;
        entries: DiaryEntry[];
    }>>;
    listDiaryDates(): Promise<string[]>;
    writeHandoff(_note: Omit<HandoffNote, 'timestamp'>): Promise<HandoffNote>;
    readHandoff(_stamp?: string): Promise<HandoffNote | null>;
    listHandoffs(_limit?: number): Promise<HandoffSummary[]>;
}
