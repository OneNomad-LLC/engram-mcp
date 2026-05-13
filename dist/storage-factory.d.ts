/**
 * Storage backend factory.
 *
 *   STORAGE_BACKEND=file        (default) — LanceDB + filesystem under dataDir.
 *   STORAGE_BACKEND=postgres    — pgvector + jsonb. Requires DATABASE_URL and TENANT_ID.
 *
 * Local installs see no behavior change: with no env vars set the
 * factory picks `file` and constructs a FileStorageAdapter rooted at
 * dataDir, exactly like the pre-adapter Storage class did.
 */
import type { StorageAdapter } from './storage-adapter.js';
export type StorageBackend = 'file' | 'postgres';
export interface CreateStorageOptions {
    /** Data directory (used only in file mode). Required for file backend. */
    dataDir?: string;
    /** Explicit backend override. Defaults to STORAGE_BACKEND env, then 'file'. */
    backend?: StorageBackend;
    /** Override DATABASE_URL (postgres mode). */
    databaseUrl?: string;
    /** Override TENANT_ID (postgres mode). */
    tenantId?: string;
    /** Override embedding dimension. Defaults to ENGRAM_EMBEDDING_DIM or 384. */
    embeddingDim?: number;
}
export declare function resolveBackend(explicit?: StorageBackend): StorageBackend;
/**
 * Create a StorageAdapter for the resolved backend.
 *
 * Async because the postgres backend dynamic-imports the `pg` driver
 * (file-mode users don't have it installed). File mode resolves
 * immediately — no I/O until ensureReady().
 */
export declare function createStorageAdapter(opts?: CreateStorageOptions): Promise<StorageAdapter>;
