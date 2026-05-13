/**
 * Device-code login + logout against pyre-web.
 *
 * Flow:
 *   1. POST /api/auth/device-code → user_code, device_code, verification_url, expires_in, interval.
 *   2. Print the URL + code, best-effort open the browser.
 *   3. Poll /api/auth/device-code/poll until approved / denied / expired / timeout.
 *   4. On approval, write ~/.pyre/credentials.json.
 *
 * Server-side is hosted at https://pyre-web-dev.up.railway.app today and
 * will flip to https://pyre.onenomad.com at GA. The default lives in
 * DEFAULT_API_URL below — single line to change at flip time.
 *
 * Everything except the final success/failure line goes to stderr. The
 * URL + code block goes to stdout so a caller piping our output to a
 * file gets only the actionable bits.
 */
import { credentialsPath } from './credentials.js';
/**
 * Default Pyre Cloud base URL. Single source of truth — flip this one
 * line when pyre.onenomad.com goes live.
 */
export declare const DEFAULT_API_URL = "https://pyre-web-dev.up.railway.app";
export interface LoginOptions {
    apiUrl?: string;
    /** Override hostname (tests). */
    deviceName?: string;
    /** Override the writes-to-disk target (tests). */
    credentialsFile?: string;
    /** Override the "open in browser" hook (tests). */
    openBrowser?: (url: string) => void;
    /** Override fetch (tests). */
    fetchImpl?: typeof fetch;
    /** Override sleep (tests). */
    sleep?: (ms: number) => Promise<void>;
    /** Override Date.now (tests). */
    now?: () => number;
}
/**
 * Run the login flow end-to-end. Returns 0 on success, non-zero on
 * failure. Prints user-visible messages to stdout/stderr as documented
 * in the deliverable spec.
 */
export declare function runLogin(opts?: LoginOptions): Promise<number>;
/**
 * Idempotent logout — exits 0 whether or not the file existed.
 */
export declare function runLogout(opts?: {
    credentialsFile?: string;
}): number;
export { credentialsPath };
