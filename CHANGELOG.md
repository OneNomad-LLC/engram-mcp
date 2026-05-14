# Changelog

All notable changes to `@onenomad/engram-mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
