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
import { FileStorageAdapter } from './storage-file.js';
import { readCredentials, credentialsExist } from './auth/credentials.js';

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
export function resolveBackend(explicit?: StorageBackend): StorageBackend {
  if (explicit) return explicit;
  const v = (process.env.STORAGE_BACKEND ?? '').trim().toLowerCase();
  if (v === 'postgres') return 'postgres';
  if (v === 'cloud') return 'cloud';
  if (v === 'file') return 'file';
  if (v !== '') {
    throw new Error(
      `Unknown STORAGE_BACKEND='${v}'. Expected 'file', 'postgres', or 'cloud'.`,
    );
  }
  // No explicit setting — probe for a credentials file.
  if (credentialsExist()) return 'cloud';
  return 'file';
}

/**
 * Create a StorageAdapter for the resolved backend.
 *
 * Async because the postgres and cloud backends dynamic-import their
 * driver modules (file-mode users shouldn't pay that cost). File mode
 * resolves immediately — no I/O until ensureReady().
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

  if (backend === 'postgres') {
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

  // cloud — credentials file + env overrides. Either source may
  // supply each field; env vars win when both are present.
  const creds = readCredentials();
  const apiUrl = opts.apiUrl ?? process.env.PYRE_API_URL ?? creds?.api_url;
  const apiKey = opts.apiKey ?? process.env.PYRE_API_KEY ?? creds?.api_key;
  if (!apiUrl || !apiKey) {
    throw new Error(
      'STORAGE_BACKEND=cloud requires PYRE_API_URL and PYRE_API_KEY (or a valid ~/.pyre/credentials.json — ' +
      'run `engram-mcp login`).',
    );
  }
  const { CloudStorageAdapter } = await import('./storage-cloud.js');
  return new CloudStorageAdapter({
    apiUrl,
    apiKey,
    label: creds?.label,
    scopes: creds?.scopes,
  });
}
