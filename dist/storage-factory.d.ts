/**
 * Storage backend factory.
 *
 * Resolution waterfall (in order):
 *
 *   1. If `STORAGE_BACKEND` is set explicitly, that wins.
 *      - `file`     → LanceDB + filesystem under dataDir.
 *      - `postgres` → pgvector + jsonb. Requires DATABASE_URL and TENANT_ID.
 *      - `cloud`    → Pyre Cloud HTTP. Requires PYRE_API_URL + PYRE_API_KEY
 *                     (or a populated ~/.pyre/credentials.json). The HTTP
 *                     adapter is a stub today — see src/storage-cloud.ts.
 *      Missing accompanying env vars fail fast with a clear error.
 *
 *   2. Otherwise, if `~/.pyre/credentials.json` exists and parses cleanly,
 *      route through the cloud backend using those credentials. Individual
 *      PYRE_API_URL / PYRE_API_KEY env vars override the matching fields
 *      from the file. This is what `engram-mcp login` wires up.
 *
 *   3. Otherwise, `file` mode — today's default. Zero env-var change for
 *      users who never run `login`.
 */
import type { StorageAdapter } from './storage-adapter.js';
export type StorageBackend = 'file' | 'postgres' | 'cloud';
export interface CreateStorageOptions {
    /** Data directory (used only in file mode). Required for file backend. */
    dataDir?: string;
    /** Explicit backend override. Defaults to STORAGE_BACKEND env, then the credentials-file probe, then 'file'. */
    backend?: StorageBackend;
    /** Override DATABASE_URL (postgres mode). */
    databaseUrl?: string;
    /** Override TENANT_ID (postgres mode). */
    tenantId?: string;
    /** Override embedding dimension. Defaults to ENGRAM_EMBEDDING_DIM or 384. */
    embeddingDim?: number;
    /** Override the Pyre Cloud API base URL (cloud mode). */
    apiUrl?: string;
    /** Override the Pyre Cloud API key (cloud mode). */
    apiKey?: string;
}
/**
 * Resolve which backend to use based on env vars and the presence of
 * a credentials file. See the module-level JSDoc for the full
 * three-tier waterfall.
 */
export declare function resolveBackend(explicit?: StorageBackend): StorageBackend;
/**
 * Create a StorageAdapter for the resolved backend.
 *
 * Async because the postgres and cloud backends dynamic-import their
 * driver modules (file-mode users shouldn't pay that cost). File mode
 * resolves immediately — no I/O until ensureReady().
 */
export declare function createStorageAdapter(opts?: CreateStorageOptions): Promise<StorageAdapter>;
