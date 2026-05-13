/**
 * Credentials file for Pyre Cloud — read/write/delete.
 *
 * Stored at `~/.pyre/credentials.json` by default. Override with the
 * PYRE_CREDENTIALS_FILE env var or by passing an explicit path.
 *
 * The file is the source of truth for the cloud storage backend; if
 * present and valid the storage factory routes through Pyre Cloud
 * instead of local LanceDB. On parse failure or shape mismatch reads
 * return null — local file mode must keep working even if the user's
 * credentials file is corrupt.
 */
export interface Credentials {
    api_url: string;
    api_key: string;
    label: string;
    scopes: string[];
    issued_at: string;
}
/**
 * Resolve the credentials file path:
 *   1. explicit `path` arg (overrides everything)
 *   2. PYRE_CREDENTIALS_FILE env var
 *   3. ~/.pyre/credentials.json
 */
export declare function credentialsPath(path?: string): string;
/**
 * Read credentials. Returns null when:
 *   - the file does not exist
 *   - the file does not parse as JSON
 *   - the parsed object is missing any required field or has the wrong shape
 *
 * Never throws — local file mode must keep working even when the
 * credentials file is broken.
 */
export declare function readCredentials(path?: string): Credentials | null;
/**
 * Write credentials atomically with mode 0600. Creates the parent
 * directory if needed. Uses tmp+rename so a crash mid-write can't
 * leave the file half-populated.
 */
export declare function writeCredentials(creds: Credentials, path?: string): void;
/**
 * Delete credentials. Idempotent — returns true if a file was actually
 * removed, false if there was nothing to delete. Never throws on
 * ENOENT.
 */
export declare function deleteCredentials(path?: string): boolean;
/**
 * Check whether a credentials file exists at the resolved path. Does
 * not validate the contents — callers that need the parsed shape
 * should call readCredentials() and check for null instead.
 */
export declare function credentialsExist(path?: string): boolean;
/**
 * Stat the credentials file. Exported for tests that want to assert
 * on the file mode after a write.
 */
export declare function credentialsStat(path?: string): import("fs").Stats;
