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

import { hostname, platform } from 'node:os';
import { spawn } from 'node:child_process';
import { writeCredentials, deleteCredentials, credentialsPath, type Credentials } from './credentials.js';

const PACKAGE_NAME = 'engram-memory';

export interface DeviceCodeStart {
  user_code: string;
  device_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export type DeviceCodePoll =
  | { status: 'pending' }
  | { status: 'approved'; api_url: string; api_key: string; label: string; scopes: string[] }
  | { status: 'denied' }
  | { status: 'expired' };

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
export function resolveServerUrl(opts: { positional?: string; flag?: string }): string | null {
  const trim = (s: string | undefined): string | null => {
    const t = s?.trim();
    if (!t) return null;
    return t.replace(/\/+$/, '');
  };
  return trim(opts.positional) ?? trim(opts.flag) ?? trim(process.env.PYRE_API_URL);
}

function sleepDefault(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Validate a URL is safe to hand to a child process opener.
 *
 * SECURITY: the previous implementation passed the URL through
 * `cmd /c start` on Windows, which re-parses arguments via cmd's
 * built-in `start` command and treats `&`, `|`, `^`, `<`, `>` as
 * shell metacharacters even when quoted. A hostile login server
 * returning `verification_url: "https://x & calc.exe"` could RCE
 * the developer's machine. Windows path now goes through rundll32
 * + url.dll,FileProtocolHandler (no shell interpretation), and we
 * validate the URL is well-formed http(s) before any spawn.
 */
function isSafeBrowserUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  if (url.length > 2000) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  // Reject control chars, quotes, and shell-significant chars that
  // shouldn't appear in a real verification URL even though some
  // are technically valid in URI syntax. Defense-in-depth — the
  // launcher choices below already avoid shell interpretation.
  if (/[\x00-\x1f\x7f"<>|\\^`'\n\r]/.test(url)) return false;
  return true;
}

function openInBrowser(url: string): void {
  if (!isSafeBrowserUrl(url)) {
    process.stderr.write(`engram: refusing to open malformed URL\n`);
    return;
  }
  try {
    const p = platform();
    if (p === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    } else if (p === 'win32') {
      // Avoid `cmd /c start` -- its `start` builtin re-parses
      // arguments and interprets shell metacharacters. rundll32 +
      // FileProtocolHandler is the documented Windows API for
      // opening a URL with no shell layer between us and ShellExecute.
      spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
        stdio: 'ignore',
        detached: true,
      }).unref();
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
    }
  } catch {
    // Best-effort — the printed URL is always the fallback.
  }
}

async function postJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
): Promise<{ status: number; json: T }> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  if (text.length > 0) {
    try { json = JSON.parse(text); } catch {
      // Fall through — non-JSON response is itself a failure to surface.
      throw new Error(`non-JSON response from ${url} (status ${res.status}): ${text.slice(0, 200)}`);
    }
  }
  return { status: res.status, json: json as T };
}

/**
 * Start a device-code pairing. Retries up to 3 times with 1s/2s/4s
 * backoff on transient network failures before giving up.
 */
export async function startDeviceCode(
  fetchImpl: typeof fetch,
  apiUrl: string,
  deviceName: string,
  sleep: (ms: number) => Promise<void>,
): Promise<DeviceCodeStart> {
  const url = `${apiUrl}/api/auth/device-code`;
  const backoffs = [1000, 2000, 4000];
  let lastErr: unknown;
  for (let attempt = 0; attempt < backoffs.length; attempt++) {
    try {
      const { status, json } = await postJson<DeviceCodeStart & { error?: string }>(
        fetchImpl,
        url,
        { device_name: deviceName, package_name: PACKAGE_NAME },
      );
      if (status >= 200 && status < 300) {
        if (!json.user_code || !json.device_code || !json.verification_url) {
          throw new Error(`malformed device-code response: ${JSON.stringify(json)}`);
        }
        return json;
      }
      throw new Error(`server returned HTTP ${status}${json?.error ? `: ${json.error}` : ''}`);
    } catch (err) {
      lastErr = err;
      if (attempt < backoffs.length - 1) {
        await sleep(backoffs[attempt]);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Single poll of /api/auth/device-code/poll. Normalises HTTP 410 to
 * the `expired` status the rest of the codebase already handles.
 * Other non-2xx responses are surfaced as thrown errors so callers
 * (CLI's loop, MCP tool) can decide whether to retry or give up.
 */
export async function pollDeviceCode(
  fetchImpl: typeof fetch,
  apiUrl: string,
  deviceCode: string,
): Promise<DeviceCodePoll> {
  const pollUrl = `${apiUrl}/api/auth/device-code/poll`;
  const res = await postJson<DeviceCodePoll>(fetchImpl, pollUrl, { device_code: deviceCode });
  if (res.status === 410) return { status: 'expired' };
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`poll returned HTTP ${res.status}`);
  }
  return res.json;
}

/**
 * Build a Credentials object from an approved poll response. Centralises
 * the shape used by both the CLI and the MCP tool path.
 */
export function credentialsFromApproval(approved: Extract<DeviceCodePoll, { status: 'approved' }>): Credentials {
  return {
    api_url: approved.api_url,
    api_key: approved.api_key,
    label: approved.label,
    scopes: approved.scopes,
    issued_at: new Date().toISOString(),
  };
}

/**
 * Run the login flow end-to-end. Returns 0 on success, non-zero on
 * failure. Prints user-visible messages to stdout/stderr as documented
 * in the deliverable spec.
 */
export async function runLogin(opts: LoginOptions): Promise<number> {
  const apiUrl = opts.apiUrl.trim().replace(/\/+$/, '');
  const deviceName = opts.deviceName ?? hostname();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? sleepDefault;
  const now = opts.now ?? Date.now;
  const open = opts.openBrowser ?? openInBrowser;

  let start: DeviceCodeStart;
  try {
    start = await startDeviceCode(fetchImpl, apiUrl, deviceName, sleep);
  } catch (err) {
    process.stderr.write(`Could not reach ${apiUrl}: ${(err as Error).message}.\n`);
    return 1;
  }

  // The URL + code block — stdout, in one piece so it's easy to grab.
  process.stdout.write(
    `Open this URL in your browser to authorize:\n` +
    `\n` +
    `  ${start.verification_url}\n` +
    `\n` +
    `Enter this code when prompted: ${start.user_code}\n` +
    `(waiting for approval — Ctrl+C to cancel)\n`,
  );

  open(start.verification_url);

  const intervalMs = Math.max(1, start.interval) * 1000;
  const expiresAt = now() + start.expires_in * 1000;

  while (now() < expiresAt) {
    await sleep(intervalMs);
    if (now() >= expiresAt) break;

    let body: DeviceCodePoll;
    try {
      body = await pollDeviceCode(fetchImpl, apiUrl, start.device_code);
    } catch (err) {
      // Transient — log and keep polling until expires_in wins.
      process.stderr.write(`engram: poll error (will retry): ${(err as Error).message}\n`);
      continue;
    }

    switch (body.status) {
      case 'pending':
        continue;
      case 'denied':
        process.stderr.write(`Authorization denied.\n`);
        return 1;
      case 'expired':
        process.stderr.write(`Pairing code expired. Run \`engram-mcp login\` again.\n`);
        return 1;
      case 'approved': {
        const creds = credentialsFromApproval(body);
        try {
          writeCredentials(creds, opts.credentialsFile);
        } catch (err) {
          process.stderr.write(`engram: could not write credentials: ${(err as Error).message}\n`);
          return 1;
        }
        const where = opts.credentialsFile ?? '~/.pyre/credentials.json';
        process.stdout.write(`Logged in. Credentials saved to ${where}.\n`);
        return 0;
      }
      default:
        // Unknown status — keep polling. Defensive only; the type
        // union above is exhaustive against the documented API.
        continue;
    }
  }

  process.stderr.write(`Login timed out.\n`);
  return 1;
}

/**
 * Idempotent logout — exits 0 whether or not the file existed.
 */
export function runLogout(opts: { credentialsFile?: string } = {}): number {
  const removed = deleteCredentials(opts.credentialsFile);
  if (removed) {
    process.stdout.write(`Logged out.\n`);
  } else {
    process.stdout.write(`Already logged out.\n`);
  }
  return 0;
}

// Re-export so callers (cli.ts) can resolve the documented path string
// for the success message.
export { credentialsPath };
