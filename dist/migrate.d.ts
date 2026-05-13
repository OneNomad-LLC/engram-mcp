#!/usr/bin/env node
/**
 * engram-migrate — apply postgres schema migrations.
 *
 * Reads SQL files from `migrations/postgres/` (sorted by filename),
 * applies each in a transaction, records applied filenames in a
 * `_migrations` table. Idempotent on re-run — already-applied files
 * are skipped.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx engram-migrate
 *
 * Kept deliberately tiny — no node-pg-migrate dependency, no fancy
 * features. If you need rollbacks or down-migrations, reach for a
 * real migration tool. For Engram's small fixed schema this is enough.
 */
export {};
