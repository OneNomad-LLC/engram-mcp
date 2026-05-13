/**
 * Engram library entry point.
 *
 * Re-exports the pure modules that make up Engram's memory subsystem so
 * downstream Node packages (Pyre, custom CLIs, alternate MCP wrappers)
 * can consume Engram directly without spawning the MCP stdio server.
 *
 * Importing this module is side-effect-free. It does NOT load config,
 * open LanceDB, spin up embedding providers, or register any signal
 * handlers. The MCP server lives at `./server.js`; bin entries on the
 * package boot it explicitly.
 *
 * The MCP entry (`engram-memory`) and the CLI entry (`engram-mcp`)
 * continue to work unchanged for Claude Code / Claude Desktop users.
 *
 * Stability: the surface below is the public API. Internal modules
 * (utils, llm, graph-rerank, retrieval-trace, etc.) are deliberately
 * NOT re-exported -- they may change shape between minor versions.
 */
// ── Storage ─────────────────────────────────────────────────────────
export { Storage } from './storage.js';
export { createStorageAdapter, resolveBackend, } from './storage-factory.js';
export { FileStorageAdapter } from './storage-file.js';
// ── Config ──────────────────────────────────────────────────────────
export { loadConfig } from './config.js';
// ── Hybrid search ───────────────────────────────────────────────────
export { search, selectRelevant, formatRecalledMemories } from './search.js';
// ── Real-time ingest (despite the filename, no WAL today -- see M5) ─
export { ingest, flushPendingSideEffects, pendingSideEffectCount, } from './wal.js';
// ── Knowledge graph ─────────────────────────────────────────────────
export { addTriple, replaceTriple, queryGraph, getTimeline, invalidateTriple, getGraphStats, formatGraphForPrompt, } from './knowledge-graph.js';
// ── Handoff notes (cross-session resume) ────────────────────────────
export { writeHandoff, readHandoff, listHandoffs, } from './handoff.js';
// ── Diary (per-day session log) ─────────────────────────────────────
export { writeDiaryEntry, readDiary, listDiaryDates, } from './diary.js';
// ── Context pressure (early-compact signal) ─────────────────────────
export { assessPressure, } from './context-pressure.js';
// ── Governance (contradictions, drift, poisoning) ───────────────────
export { runGovernanceCheck, detectContradictions, measureSemanticDrift, checkMemoryPoisoning, } from './governance.js';
// ── Tier lifecycle + FSRS consolidator ──────────────────────────────
export { consolidate, computeFSRSUpdate, } from './consolidator.js';
// ── Procedural rules ────────────────────────────────────────────────
export { extractRules, formatRulesForPrompt, } from './procedural.js';
// ── Reranker (cross-encoder reorder) ────────────────────────────────
export { rerank, isRerankerAvailable, } from './reranker.js';
// ── LLM-powered extraction + reconsolidation ────────────────────────
export { extractFromConversation, reconsolidate, } from './extractor.js';
// ── Session state (per-conversation scratchpad) ─────────────────────
export { readSessionState, updateSessionState, appendToSessionState, clearSessionState, } from './session-state.js';
// ── Importer (Claude Code / ChatGPT history → memory) ───────────────
export { importConversation, } from './importer.js';
// ── Update-metadata helpers (shared with MCP server) ────────────────
export { buildUpdateMetadataPatch, } from './update-metadata.js';
// ── Recall outcome telemetry ────────────────────────────────────────
export { recordRecallOutcome } from './outcome.js';
// ── Mem0 extraction adapter ─────────────────────────────────────────
export { mem0Extract } from './mem0.js';
export { DEFAULT_CONFIG } from './types.js';
//# sourceMappingURL=index.js.map