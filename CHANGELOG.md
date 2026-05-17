# Changelog

All notable changes to `@onenomad/engram-mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.4.0] - 2026-05-16

### Added

- **Verified launch baseline benchmarks.** Full LongMemEval n=500 + LoCoMo n=1,986 results committed to `benchmarks/results/published/`. These pin the exact commit hash, hardware probe, embedding model, per-category breakdown, and latency percentiles. The marketing site cites these JSONs; CI can regression-check against them.
  - **LongMemEval:** 96.8% R@5 / 98.8% R@10 / 44ms p50 search latency. Engram's R@10 exceeds MemPalace hybrid v4's R@5 (98.4%) on the same dataset.
  - **LoCoMo:** 91.9% R@10 / 85.5% R@5 — beats MemPalace hybrid v5 (88.9% R@10) by +3.0pp on the same dataset and metric.
- **Per-question result data** in benchmark JSON output (`perQuestion[]` field) so miss analysis can run against committed result files without re-running the full bench.
- **`benchmarks/diag-isolation.ts`** — a 30-line diagnostic script that proves Storage instances at different `dataDir` paths actually isolate. Use it to debug any future bench contamination suspicion.
- **Preference / aggregation / temporal-inference query detection** in `extractQuerySignals` (`src/search.ts`). Three new signal flags drive selective candidate-pool widening and similarity-floor tuning for query patterns the embedder struggles with on its own (`isPreferenceQuery`, `isAggregationQuery`, plus extended `isTemporalInference` triggers). +0.8pp R@5 on LongMemEval baseline.
- **`referenceDate` option on `search()`** for benchmark callers that need "N days ago" relative dates anchored to a dataset-specific timeline rather than `Date.now()`. Production callers leave it null and get wall-clock today. Wired through to `extractQuerySignals` for "yesterday / last week / N days ago / two weeks ago" parsing.
- **Word-form temporal regex** ("two/three/.../ten weeks ago", "a week ago") in `extractQuerySignals` for natural temporal language coverage.
- **Embedding model download progress logging** (`src/llm.ts`) — first call's silent 23MB HuggingFace download now reports per-file progress at 25/50/75/100% thresholds so users don't think the MCP tool is frozen on first invocation.
- **`ENGRAM_CANDIDATE_POOL_MULT` / `ENGRAM_CANDIDATE_POOL_MAX` / `ENGRAM_SIMILARITY_FLOOR` env-tunable knobs** on the vector-search stage so benchmark experiments can override defaults without code changes.
- **Engines requirement** (`"node": ">=22.0.0"`) and Node-version readme guidance.
- **Hook installation section** in README covering `engram_precompact_hook.sh` + `engram_stop_hook.sh` wiring into Claude Code's `settings.json`.

### Fixed

- **CRITICAL — Path traversal in `engram-handoff-read`.** `STAMP_RE` in `src/handoff.ts` was unanchored at the end. A prompt-injected memory could call `engram-handoff-read({ stamp: "2026-01-01_00-00-00/../../.pyre/credentials" })` and exfiltrate the live Pyre Cloud API bearer token. Anchored the regex AND added a defense-in-depth `isSafeHandoffIdentifier()` check that rejects identifiers containing `/`, `\`, `..`, or NULL bytes.
- **CRITICAL — Windows command injection in `engram-mcp login`.** `src/auth/login.ts` opened the verification URL via `spawn('cmd', ['/c', 'start', '', url])`. cmd's `start` builtin parses `&`, `|`, `^`, `<`, `>` as shell metacharacters even inside quoted arguments. A malicious login server returning `verification_url: "https://x & calc.exe"` could RCE on Windows. Replaced with `rundll32.exe url.dll,FileProtocolHandler` (no shell layer) plus an `isSafeBrowserUrl()` validator that requires http(s) protocol with no control / shell-significant chars.
- **CRITICAL — LIKE-pattern injection in `src/storage-file.ts`.** `esc()` only doubled single quotes, leaving `%` and `_` LIKE wildcards unescaped. A `tag = "%"` filter would widen the match to every row (a tenant-isolation leak risk in postgres mode). Added `escLike()` with proper backslash escaping for `\`, `%`, `_` and surfaced an `ESCAPE '\'` clause on the one LIKE call site. Both `esc()` and `escLike()` now also reject NULL bytes.
- **CRITICAL — Storage silently auto-routed to Pyre Cloud when `~/.pyre/credentials.json` existed.** `resolveBackend()` in `src/storage-factory.ts` returns `'cloud'` whenever a credentials file is present, even when the caller passes an explicit `dataDir`. Benchmark harnesses that called `new Storage(benchDir)` after the user had logged into Pyre Cloud were silently POSTing every chunk to the live tenant — search results then included cross-question contamination from accumulated runs. **Benchmark fix:** `benchmarks/longmemeval.ts` and `benchmarks/locomo.ts` now set `process.env.STORAGE_BACKEND = 'file'` at module load. **Architectural fix:** still pending — `Storage` constructor should accept an explicit `backend` option and warn when the resolved backend doesn't match the passed `dataDir` intent.
- **`recallAtK` no longer auto-passes questions with empty `answer_session_ids`** (`benchmarks/longmemeval.ts`). Previously such questions returned 1 (auto-hit), inflating the headline R@5 by ~3pp on LongMemEval. The bench now excludes them from the denominator entirely and reports an `excludedCount` in the result JSON.
- **LongMemEval ingest now applies the same `buildContextPrefix(...)` the query path uses.** Without symmetric prefixes the query embedding ("search query: ...") and chunk embeddings (raw text) lived in different vector spaces and recall collapsed to ~12.5% R@5. LoCoMo bench already had this; LongMemEval had been missing it. Fixing it restored the 96%+ baseline.
- **README comparison table no longer mixes Recall@K with LLM-judge scores in the same column.** Tables are now split by metric type with explicit methodology caveats — the same pattern that sank MemPalace's 100% claim is now structurally avoided.
- **`json(data: any)` in `src/server.ts` changed to `json(data: unknown)`** — every MCP tool return value now narrows its serialized type at the call site instead of being able to silently leak unintended fields.
- **`engram-extract` now guards `JSON.parse(messages)` with a try/catch and a 1MB input size cap.** Previously a malformed-JSON input crashed with a raw `SyntaxError` stack trace from the MCP server; now returns a clean `{ error: "invalid_messages_json", detail: ... }` response.
- **NDCG calculation in benchmarks deduplicates sessions before rank-weighted scoring.** When sub-chunking was experimented with, the same session ID could appear multiple times in the retrieved list, which would let NDCG exceed 1. Even without sub-chunking, the dedup is the correct measurement; R@K was always correct because it uses a Set internally.
- **Data directories now created with mode `0o700`** (owner-only) in `storage-file`, `diary`, `handoff`, `session-state`, `procedural-bridge`. Memory data shouldn't be world-readable on shared / multi-user systems.
- **`package.json` version field synced to `2.4.0`** to match `src/server.ts`'s identifier; previous `2.0.0` mismatch confused bug-report version pinning.
- **TODO placeholder rows removed from README benchmark table** so first-time visitors don't see incomplete content as a maturity signal.
- **Dead code removed from `src/search.ts:extractQuerySignals`** — an empty for-loop and unused `expandedEntities` variable that suggested KG-driven entity expansion was happening when it wasn't.

### Changed

- README's hero paragraph now leads with verified numbers (96.8 / 98.8 LongMemEval, 91.9 LoCoMo) and the 44ms p50 latency. Old hero claim ("92% LoCoMo, 99% LongMemEval") replaced with honest measurement.
- Benchmark harnesses (`longmemeval`, `locomo`, `diag-isolation`) force `STORAGE_BACKEND=file` at module load to bypass the cloud-auto-routing risk.

## [2.0.0] - 2026-05-14

### BREAKING CHANGES
- **All MCP tools renamed from `memory_*` (snake_case) to `engram-*` (kebab-case).** Every tool the server registers is affected — 29 tools in total. Examples:
  - `memory_search` → `engram-search`
  - `memory_ingest` → `engram-ingest`
  - `memory_handoff_write` → `engram-handoff-write`
  - `memory_kg_add` → `engram-kg-add`
  - `memory_login` → `engram-login` (added in this release)
  - …and 24 more, all following the same pattern.
- Any prompt, slash command, or integration that calls engram tools by name must update to the new names. The repo's bundled slash commands (`.claude/commands/*.md`), skills (`skills/*/SKILL.md`), hooks (`hooks/*.sh`), and docs are all updated as part of this release.
- No backward-compatibility aliases — clean break. Old names will return a "tool not found" error.

### Added
- **Cloud login from MCP.** Four new tools let any MCP client authenticate with Pyre Cloud without dropping to a terminal:
  - `engram-login({ serverUrl, label? })` — starts a device-code pairing and returns the verification URL + user code.
  - `engram-login-resume({ serverUrl, deviceCode, intervalSeconds, expiresAt })` — polls for ~45s, returns `approved` / `pending` / `denied` / `expired`. Writes `~/.pyre/credentials.json` on approval.
  - `engram-login-status()` — reads the local credentials file; returns `loggedIn`, `apiUrl`, `label`, `scopes`, `issuedAt`.
  - `engram-logout()` — idempotent credentials deletion.

### Changed
- Refactored `src/auth/login.ts` to export the device-code primitives (`startDeviceCode`, `pollDeviceCode`, `credentialsFromApproval`) so the CLI and MCP tools share the same code path. CLI behaviour is unchanged.

### Migration
- Search-and-replace `memory_` → `engram-` in any prompt or instruction that names engram tools. The underscore inside the rest of the tool name also flips to a hyphen: `memory_handoff_write` → `engram-handoff-write`, `memory_kg_query` → `engram-kg-query`.
- If you rely on the bundled slash commands / skills, just pull the new repo — they're already updated.

## [1.1.0] - 2026-05-14

### Added
- **Named handoff checkpoints.** `memory_handoff_write` now accepts an optional `name` so users can save labeled session checkpoints (e.g. `"engram-named-checkpoints"`) and resume them by name later.
- **`memory_handoff_list` MCP tool.** Dedicated list-and-pick surface for saved handoffs/checkpoints. Returns newest-first entries including stamp, timestamp, reason, `currentTask` snippet, and (when set) the user-facing `name`.
- `memory_handoff_read` now accepts a `name` parameter alongside `stamp`. When both are provided, `name` wins. If no match is found the response message points the caller at `memory_handoff_list`.

### Changed
- `readHandoff` resolves an identifier as a stamp first, then falls back to a name scan (newest match wins). Existing stamp-based callers are unaffected.
- `listHandoffs` now returns the exported `HandoffListEntry` shape, which includes the optional `name` field.
- Handoff protocol blurb in the server description mentions named-checkpoint resume and "save this session" intent.

[Unreleased]: https://github.com/onenomad-llc/engram-mcp/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/onenomad-llc/engram-mcp/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/onenomad-llc/engram-mcp/compare/v1.0.0...v1.1.0
