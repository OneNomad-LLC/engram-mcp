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

import { hostname, platform } from 'node:os';
import { spawn } from 'node:child_process';
import { writeCredentials, deleteCredentials, credentialsPath, type Credentials } from './credentials.js';

/**
 * Default Pyre Cloud base URL. Single source of truth — flip this one
 * line when pyre.onenomad.com goes live.
 */
export const DEFAULT_API_URL = 'https://pyre-web-dev.up.railway.app';

const PACKAGE_NAME = 'engram-memory';

interface DeviceCodeStart {
  user_code: string;
  device_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

type DeviceCodePoll =
  | { status: 'pending' }
  | { status: 'approved'; api_url: string; api_key: string; label: string; scopes: string[] }
  | { status: 'denied' }
  | { status: 'expired' };

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

function resolveApiUrl(opts: LoginOptions): string {
  const fromFlag = opts.apiUrl?.trim();
  if (fromFlag) return fromFlag.replace(/\/+$/, '');
  const fromEnv = process.env.PYRE_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  return DEFAULT_API_URL;
}

function sleepDefault(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function openInBrowser(url: string): void {
  try {
    const p = platform();
    if (p === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    } else if (p === 'win32') {
      // The empty title arg matters — `start <url>` treats the URL as the title.
      spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
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
async function startDeviceCode(
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
 * Run the login flow end-to-end. Returns 0 on success, non-zero on
 * failure. Prints user-visible messages to stdout/stderr as documented
 * in the deliverable spec.
 */
export async function runLogin(opts: LoginOptions = {}): Promise<number> {
  const apiUrl = resolveApiUrl(opts);
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
  const pollUrl = `${apiUrl}/api/auth/device-code/poll`;

  while (now() < expiresAt) {
    await sleep(intervalMs);
    if (now() >= expiresAt) break;

    let pollRes: { status: number; json: DeviceCodePoll };
    try {
      pollRes = await postJson<DeviceCodePoll>(fetchImpl, pollUrl, { device_code: start.device_code });
    } catch (err) {
      // Transient — log to stderr and keep polling until expires_in
      // wins.
      process.stderr.write(`engram: poll error (will retry): ${(err as Error).message}\n`);
      continue;
    }

    // 410 carries `{ status: "expired" }` per the spec.
    if (pollRes.status === 410) {
      process.stderr.write(`Pairing code expired. Run \`engram-mcp login\` again.\n`);
      return 1;
    }
    if (pollRes.status < 200 || pollRes.status >= 300) {
      process.stderr.write(`engram: poll returned HTTP ${pollRes.status} (will retry)\n`);
      continue;
    }

    const body = pollRes.json;
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
        const creds: Credentials = {
          api_url: body.api_url,
          api_key: body.api_key,
          label: body.label,
          scopes: body.scopes,
          issued_at: new Date().toISOString(),
        };
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
