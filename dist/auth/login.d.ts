/**
 * Device-code login + logout against pyre-web.
 *
 * Flow:
 *   1. POST /api/auth/device-code → user_code, device_code, verification_url, expires_in, interval.
 *   2. Print the URL + code, best-effort open the browser.
 *   3. Poll /api/auth/device-code/poll until approved / denied / expired / timeout.
 *   4. On approval, write ~/.pyre/credentials.json. The api_url written
 *      to disk is the server-returned canonical URL from the poll
 *      response, NOT the one the user typed at login time. Server is
 *      the source of truth -- it may normalise / redirect / hand back
 *      a different storage endpoint than the login endpoint.
 *
 * No hardcoded URLs. The CLI requires the user to supply the server
 * URL at login (positional arg, --server flag, or PYRE_API_URL env).
 * Shipping prod is "users point at prod when they log in."
 *
 * Everything except the final success/failure line goes to stderr. The
 * URL + code block goes to stdout so a caller piping our output to a
 * file gets only the actionable bits.
 */
import { credentialsPath } from './credentials.js';
export interface LoginOptions {
    /**
     * pyre-web base URL. Required. Caller (the CLI) is responsible for
     * resolving this from positional arg / --server flag / PYRE_API_URL
     * env var and refusing to call runLogin() without one. runLogin
     * itself does NOT look at process.env — keeps the function
     * testable and the policy ("server URL required") visible at the
     * caller.
     */
    apiUrl: string;
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
 * Resolve a user-supplied server URL from CLI arg / flag / env, in
 * that precedence. Returns null when none of the three sources gave
 * us a URL — caller is expected to print the spec'd error message
 * and exit 1.
 */
export declare function resolveServerUrl(opts: {
    positional?: string;
    flag?: string;
}): string | null;
/**
 * Run the login flow end-to-end. Returns 0 on success, non-zero on
 * failure. Prints user-visible messages to stdout/stderr as documented
 * in the deliverable spec.
 */
export declare function runLogin(opts: LoginOptions): Promise<number>;
/**
 * Idempotent logout — exits 0 whether or not the file existed.
 */
export declare function runLogout(opts?: {
    credentialsFile?: string;
}): number;
export { credentialsPath };
