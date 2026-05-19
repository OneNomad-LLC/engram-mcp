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

// ── Storage ─────────────────────────────────────────────────────────
export { Storage, type StoredChunk } from './storage.js';
export {
  createStorageAdapter,
  resolveBackend,
  type StorageBackend,
  type CreateStorageOptions,
} from './storage-factory.js';
export {
  type StorageAdapter,
  type HandoffSummary,
  type ListChunksOpts,
  type QueryTriplesOpts,
  type TripleStats,
  type VectorHit,
  type ReadDiaryOpts,
} from './storage-adapter.js';
export { FileStorageAdapter } from './storage-file.js';

// ── Config ──────────────────────────────────────────────────────────
export { loadConfig } from './config.js';

// ── Hybrid search ───────────────────────────────────────────────────
export { search, selectRelevant, formatRecalledMemories } from './search.js';

// ── Real-time ingest (despite the filename, no WAL today -- see M5) ─
export {
  ingest,
  flushPendingSideEffects,
  pendingSideEffectCount,
  type IngestEntry,
} from './wal.js';

// ── Knowledge graph ─────────────────────────────────────────────────
export {
  addTriple,
  replaceTriple,
  queryGraph,
  getTimeline,
  invalidateTriple,
  getGraphStats,
  formatGraphForPrompt,
} from './knowledge-graph.js';

// ── Handoff notes (cross-session resume) ────────────────────────────
export {
  writeHandoff,
  readHandoff,
  listHandoffs,
  type HandoffNote,
} from './handoff.js';

// ── Diary (per-day session log) ─────────────────────────────────────
export {
  writeDiaryEntry,
  readDiary,
  listDiaryDates,
} from './diary.js';

// ── Context pressure (early-compact signal) ─────────────────────────
export {
  assessPressure,
  type PressureSignal,
} from './context-pressure.js';

// ── Governance (contradictions, drift, poisoning) ───────────────────
export {
  runGovernanceCheck,
  detectContradictions,
  measureSemanticDrift,
  checkMemoryPoisoning,
  type ContradictionResult,
  type DriftReport,
  type PoisonCheckResult,
  type GovernanceReport,
} from './governance.js';

// ── Tier lifecycle + FSRS consolidator ──────────────────────────────
export {
  consolidate,
  computeFSRSUpdate,
  type ConsolidationStats,
} from './consolidator.js';

// ── Procedural rules ────────────────────────────────────────────────
export {
  extractRules,
  formatRulesForPrompt,
} from './procedural.js';

// ── Reranker (cross-encoder reorder) ────────────────────────────────
export {
  rerank,
  isRerankerAvailable,
  type RerankResult,
} from './reranker.js';

// ── LLM-powered extraction + reconsolidation ────────────────────────
export {
  extractFromConversation,
  reconsolidate,
} from './extractor.js';

// ── Session state (per-conversation scratchpad) ─────────────────────
export {
  readSessionState,
  updateSessionState,
  appendToSessionState,
  clearSessionState,
} from './session-state.js';

// ── Importer (Claude Code / ChatGPT history → memory) ───────────────
export {
  importConversation,
  type ImportFormat,
} from './importer.js';

// ── Update-metadata helpers (shared with MCP server) ────────────────
export {
  buildUpdateMetadataPatch,
  type UpdateMetadataInput,
  type UpdateMetadataMode,
} from './update-metadata.js';

// ── Recall outcome telemetry ────────────────────────────────────────
export { recordRecallOutcome } from './outcome.js';

// ── Mem0 extraction adapter ─────────────────────────────────────────
export { mem0Extract } from './mem0.js';

// ── Public types ────────────────────────────────────────────────────
export type {
  MemoryTier,
  MemoryType,
  CognitiveLayer,
  Sentiment,
  MemoryOrigin,
  MemoryChunk,
  MemoryEdge,
  RecallOutcome,
  ProceduralRule,
  KnowledgeTriple,
  DiaryEntry,
  DailyLogEntry,
  SearchResult,
  SmartMemoryConfig,
} from './types.js';

export { DEFAULT_CONFIG } from './types.js';
