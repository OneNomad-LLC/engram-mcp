# Changelog

All notable changes to `@onenomad/engram-mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-05-14

### Added
- **Named handoff checkpoints.** `memory_handoff_write` now accepts an optional `name` so users can save labeled session checkpoints (e.g. `"engram-named-checkpoints"`) and resume them by name later.
- **`memory_handoff_list` MCP tool.** Dedicated list-and-pick surface for saved handoffs/checkpoints. Returns newest-first entries including stamp, timestamp, reason, `currentTask` snippet, and (when set) the user-facing `name`.
- `memory_handoff_read` now accepts a `name` parameter alongside `stamp`. When both are provided, `name` wins. If no match is found the response message points the caller at `memory_handoff_list`.

### Changed
- `readHandoff` resolves an identifier as a stamp first, then falls back to a name scan (newest match wins). Existing stamp-based callers are unaffected.
- `listHandoffs` now returns the exported `HandoffListEntry` shape, which includes the optional `name` field.
- Handoff protocol blurb in the server description mentions named-checkpoint resume and "save this session" intent.

[Unreleased]: https://github.com/onenomad-llc/engram-mcp/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/onenomad-llc/engram-mcp/compare/v1.0.0...v1.1.0
