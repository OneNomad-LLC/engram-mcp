/**
 * przm Memory library entry point.
 *
 * Re-exports the pure modules that make up the memory subsystem so
 * downstream Node packages (przm, custom CLIs, alternate MCP wrappers)
 * can consume przm Memory directly without spawning the MCP stdio server.
 *
 * Importing this module is side-effect-free. It does NOT load config,
 * open LanceDB, spin up embedding providers, or register any signal
 * handlers. The MCP server lives at `./server.js`; bin entries on the
 * package boot it explicitly.
 *
 * The MCP entry (`przm-memory`) and the CLI entry (`przm-memory-mcp`)
 * continue to work unchanged for Claude Code / Claude Desktop users.
 *
 * Stability: the surface below is the public API. Internal modules
 * (utils, llm, graph-rerank, retrieval-trace, etc.) are deliberately
 * NOT re-exported -- they may change shape between minor versions.
 */
export { Storage, type StoredChunk } from './storage.js';
export { createStorageAdapter, resolveBackend, type StorageBackend, type CreateStorageOptions, } from './storage-factory.js';
export { type StorageAdapter, type HandoffSummary, type ListChunksOpts, type QueryTriplesOpts, type TripleStats, type VectorHit, type ReadDiaryOpts, } from './storage-adapter.js';
export { FileStorageAdapter } from './storage-file.js';
export { loadConfig } from './config.js';
export { search, selectRelevant, formatRecalledMemories } from './search.js';
export { ingest, flushPendingSideEffects, pendingSideEffectCount, type IngestEntry, } from './wal.js';
export { addTriple, replaceTriple, queryGraph, getTimeline, invalidateTriple, getGraphStats, formatGraphForPrompt, } from './knowledge-graph.js';
export { writeHandoff, readHandoff, listHandoffs, type HandoffNote, } from './handoff.js';
export { writeDiaryEntry, readDiary, listDiaryDates, } from './diary.js';
export { assessPressure, type PressureSignal, } from './context-pressure.js';
export { runGovernanceCheck, detectContradictions, measureSemanticDrift, checkMemoryPoisoning, type ContradictionResult, type DriftReport, type PoisonCheckResult, type GovernanceReport, } from './governance.js';
export { consolidate, computeFSRSUpdate, type ConsolidationStats, } from './consolidator.js';
export { extractRules, formatRulesForPrompt, } from './procedural.js';
export { rerank, isRerankerAvailable, type RerankResult, } from './reranker.js';
export { extractFromConversation, reconsolidate, } from './extractor.js';
export { readSessionState, updateSessionState, appendToSessionState, clearSessionState, } from './session-state.js';
export { importConversation, type ImportFormat, } from './importer.js';
export { buildUpdateMetadataPatch, type UpdateMetadataInput, type UpdateMetadataMode, } from './update-metadata.js';
export { recordRecallOutcome } from './outcome.js';
export { mem0Extract } from './mem0.js';
export type { MemoryTier, MemoryType, CognitiveLayer, Sentiment, MemoryOrigin, MemoryChunk, MemoryEdge, RecallOutcome, ProceduralRule, KnowledgeTriple, DiaryEntry, DailyLogEntry, SearchResult, SmartMemoryConfig, } from './types.js';
export { DEFAULT_CONFIG } from './types.js';
