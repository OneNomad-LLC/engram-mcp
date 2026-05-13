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
import { FileStorageAdapter } from './storage-file.js';
export function resolveBackend(explicit) {
    if (explicit)
        return explicit;
    const v = (process.env.STORAGE_BACKEND ?? '').trim().toLowerCase();
    if (v === 'postgres')
        return 'postgres';
    if (v === 'file' || v === '')
        return 'file';
    throw new Error(`Unknown STORAGE_BACKEND='${v}'. Expected 'file' or 'postgres'.`);
}
/**
 * Create a StorageAdapter for the resolved backend.
 *
 * Async because the postgres backend dynamic-imports the `pg` driver
 * (file-mode users don't have it installed). File mode resolves
 * immediately — no I/O until ensureReady().
 */
export async function createStorageAdapter(opts = {}) {
    const backend = resolveBackend(opts.backend);
    if (backend === 'file') {
        const dataDir = opts.dataDir;
        if (!dataDir) {
            throw new Error('createStorageAdapter: dataDir is required for file backend');
        }
        return new FileStorageAdapter(dataDir);
    }
    // postgres
    const databaseUrl = opts.databaseUrl ?? process.env.DATABASE_URL;
    const tenantId = opts.tenantId ?? process.env.TENANT_ID;
    if (!databaseUrl || !tenantId) {
        throw new Error('STORAGE_BACKEND=postgres requires DATABASE_URL and TENANT_ID environment variables.');
    }
    const { PostgresStorageAdapter } = await import('./storage-postgres.js');
    const dimEnv = opts.embeddingDim ?? (process.env.ENGRAM_EMBEDDING_DIM
        ? Number(process.env.ENGRAM_EMBEDDING_DIM)
        : undefined);
    return new PostgresStorageAdapter({
        databaseUrl,
        tenantId,
        embeddingDim: dimEnv,
    });
}
//# sourceMappingURL=storage-factory.js.map