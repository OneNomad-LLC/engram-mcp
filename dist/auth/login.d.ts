/**
 * Device-code login + logout against przm server.
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
import { credentialsPath, type Credentials } from './credentials.js';
export interface DeviceCodeStart {
    user_code: string;
    device_code: string;
    verification_url: string;
    expires_in: number;
    interval: number;
}
export type DeviceCodePoll = {
    status: 'pending';
} | {
    status: 'approved';
    api_url: string;
    api_key: string;
    label: string;
    scopes: string[];
} | {
    status: 'denied';
} | {
    status: 'expired';
};
export interface LoginOptions {
    /**
     * przm server base URL. Required. Caller (the CLI) is responsible for
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
 * Start a device-code pairing. Retries up to 3 times with 1s/2s/4s
 * backoff on transient network failures before giving up.
 */
export declare function startDeviceCode(fetchImpl: typeof fetch, apiUrl: string, deviceName: string, sleep: (ms: number) => Promise<void>): Promise<DeviceCodeStart>;
/**
 * Single poll of /api/auth/device-code/poll. Normalises HTTP 410 to
 * the `expired` status the rest of the codebase already handles.
 * Other non-2xx responses are surfaced as thrown errors so callers
 * (CLI's loop, MCP tool) can decide whether to retry or give up.
 */
export declare function pollDeviceCode(fetchImpl: typeof fetch, apiUrl: string, deviceCode: string): Promise<DeviceCodePoll>;
/**
 * Build a Credentials object from an approved poll response. Centralises
 * the shape used by both the CLI and the MCP tool path.
 */
export declare function credentialsFromApproval(approved: Extract<DeviceCodePoll, {
    status: 'approved';
}>): Credentials;
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
