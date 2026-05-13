/**
 * StorageAdapter — the storage contract every backend implements.
 *
 * Engram supports two backends today:
 *   - file       (default; LanceDB tables + markdown/JSON files under ENGRAM_DATA_DIR)
 *   - postgres   (multi-tenant cloud; pgvector + jsonb columns)
 *
 * The adapter is pure async, scoped to a single tenant when running on
 * postgres. No backend types (lancedb.Table, pg.Pool, fs.PathLike) leak
 * through this interface — callers depend only on the shapes in
 * src/types.ts and the few extra shapes re-exported below.
 *
 * Single-tenant file installs see no behavior change. Cloud installs
 * route every query through `tenant_id`.
 */
export {};
//# sourceMappingURL=storage-adapter.js.map