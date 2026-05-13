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
import { writeFileSync, renameSync, chmodSync, statSync, unlinkSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
/**
 * Resolve the credentials file path:
 *   1. explicit `path` arg (overrides everything)
 *   2. PYRE_CREDENTIALS_FILE env var
 *   3. ~/.pyre/credentials.json
 */
export function credentialsPath(path) {
    if (path)
        return path;
    const fromEnv = process.env.PYRE_CREDENTIALS_FILE;
    if (fromEnv && fromEnv.trim().length > 0)
        return fromEnv;
    return join(homedir(), '.pyre', 'credentials.json');
}
function warn(msg) {
    process.stderr.write(`engram: credentials — ${msg}\n`);
}
function isStringArray(v) {
    return Array.isArray(v) && v.every(x => typeof x === 'string');
}
function validate(parsed) {
    if (parsed === null || typeof parsed !== 'object') {
        warn('credentials file is not a JSON object — ignoring.');
        return null;
    }
    const o = parsed;
    if (typeof o.api_url !== 'string' || o.api_url.length === 0) {
        warn('credentials.api_url missing or not a string — ignoring file.');
        return null;
    }
    if (typeof o.api_key !== 'string' || o.api_key.length === 0) {
        warn('credentials.api_key missing or not a string — ignoring file.');
        return null;
    }
    if (typeof o.label !== 'string') {
        warn('credentials.label missing or not a string — ignoring file.');
        return null;
    }
    if (!isStringArray(o.scopes)) {
        warn('credentials.scopes missing or not a string[] — ignoring file.');
        return null;
    }
    if (typeof o.issued_at !== 'string' || o.issued_at.length === 0) {
        warn('credentials.issued_at missing or not a string — ignoring file.');
        return null;
    }
    return {
        api_url: o.api_url,
        api_key: o.api_key,
        label: o.label,
        scopes: o.scopes,
        issued_at: o.issued_at,
    };
}
/**
 * Read credentials. Returns null when:
 *   - the file does not exist
 *   - the file does not parse as JSON
 *   - the parsed object is missing any required field or has the wrong shape
 *
 * Never throws — local file mode must keep working even when the
 * credentials file is broken.
 */
export function readCredentials(path) {
    const file = credentialsPath(path);
    let raw;
    try {
        raw = readFileSync(file, 'utf-8');
    }
    catch (err) {
        const code = err.code;
        if (code === 'ENOENT')
            return null;
        warn(`could not read ${file}: ${err.message}`);
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        warn(`malformed JSON in ${file}: ${err.message}`);
        return null;
    }
    return validate(parsed);
}
/**
 * Write credentials atomically with mode 0600. Creates the parent
 * directory if needed. Uses tmp+rename so a crash mid-write can't
 * leave the file half-populated.
 */
export function writeCredentials(creds, path) {
    const file = credentialsPath(path);
    const dir = dirname(file);
    mkdirSync(dir, { recursive: true });
    // chmod the parent dir to 0700 best-effort; ignore failures (e.g.
    // user's HOME is on a filesystem that doesn't support POSIX modes).
    try {
        chmodSync(dir, 0o700);
    }
    catch { /* ignore */ }
    const body = JSON.stringify(creds, null, 2) + '\n';
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, body, { mode: 0o600, encoding: 'utf-8' });
    // writeFileSync's `mode` only applies to a freshly created file;
    // belt-and-suspenders chmod handles the case where the tmp already
    // existed with looser permissions.
    try {
        chmodSync(tmp, 0o600);
    }
    catch { /* ignore */ }
    renameSync(tmp, file);
    // rename preserves the tmp file's mode bits — but again, belt-and-
    // suspenders for the case where the destination already existed.
    try {
        chmodSync(file, 0o600);
    }
    catch { /* ignore */ }
}
/**
 * Delete credentials. Idempotent — returns true if a file was actually
 * removed, false if there was nothing to delete. Never throws on
 * ENOENT.
 */
export function deleteCredentials(path) {
    const file = credentialsPath(path);
    try {
        unlinkSync(file);
        return true;
    }
    catch (err) {
        const code = err.code;
        if (code === 'ENOENT')
            return false;
        throw err;
    }
}
/**
 * Check whether a credentials file exists at the resolved path. Does
 * not validate the contents — callers that need the parsed shape
 * should call readCredentials() and check for null instead.
 */
export function credentialsExist(path) {
    return existsSync(credentialsPath(path));
}
/**
 * Stat the credentials file. Exported for tests that want to assert
 * on the file mode after a write.
 */
export function credentialsStat(path) {
    return statSync(credentialsPath(path));
}
//# sourceMappingURL=credentials.js.map