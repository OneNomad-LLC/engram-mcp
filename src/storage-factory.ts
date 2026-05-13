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
import { FileStorageAdapter } from './storage-file.js';

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

export function resolveBackend(explicit?: StorageBackend): StorageBackend {
  if (explicit) return explicit;
  const v = (process.env.STORAGE_BACKEND ?? '').trim().toLowerCase();
  if (v === 'postgres') return 'postgres';
  if (v === 'file' || v === '') return 'file';
  throw new Error(
    `Unknown STORAGE_BACKEND='${v}'. Expected 'file' or 'postgres'.`,
  );
}

/**
 * Create a StorageAdapter for the resolved backend.
 *
 * Async because the postgres backend dynamic-imports the `pg` driver
 * (file-mode users don't have it installed). File mode resolves
 * immediately — no I/O until ensureReady().
 */
export async function createStorageAdapter(opts: CreateStorageOptions = {}): Promise<StorageAdapter> {
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
    throw new Error(
      'STORAGE_BACKEND=postgres requires DATABASE_URL and TENANT_ID environment variables.',
    );
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
