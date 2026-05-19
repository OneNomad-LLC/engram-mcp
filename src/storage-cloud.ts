/**
 * CloudStorageAdapter — przm Cloud HTTP-backed storage.
 *
 * Speaks the wire contract przm server exposes at /api/engram/*. Each
 * StorageAdapter method maps to a single HTTP request — przm server is
 * a thin multi-tenant Postgres-over-HTTP shim that mirrors what
 * PostgresStorageAdapter does locally.
 *
 * Auth: Bearer token from credentials.json. The server derives the
 * tenant_id from the api-key; the adapter never plumbs it.
 *
 * Error envelope: przm server emits `{ "error": { "code", "message" } }`
 * on non-2xx. errorBody() unpacks it; failures bubble up as Error
 * with that text so the rest of the engram pipeline reports cleanly.
 */
import type {
  StorageAdapter,
  StoredChunk,
  ListChunksOpts,
  HandoffNote,
  HandoffSummary,
  QueryTriplesOpts,
  TripleStats,
  VectorHit,
  ReadDiaryOpts,
} from './storage-adapter.js';
import type {
  DailyLogEntry,
  ProceduralRule,
  KnowledgeTriple,
  DiaryEntry,
} from './types.js';

export interface CloudStorageOptions {
  apiUrl: string;
  apiKey: string;
  label?: string;
  scopes?: string[];
  fetch?: typeof fetch;
}

async function errorBody(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return `${res.status} ${res.statusText}`;
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
    if (parsed.error?.message) {
      return parsed.error.code
        ? `${parsed.error.code}: ${parsed.error.message}`
        : parsed.error.message;
    }
  } catch {
    /* raw text fallback */
  }
  return text.slice(0, 200);
}

export class CloudStorageAdapter implements StorageAdapter {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly label: string | undefined;
  readonly scopes: readonly string[];
  private readonly fetchImpl: typeof fetch;

  constructor(opts: CloudStorageOptions) {
    this.apiUrl = opts.apiUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.label = opts.label;
    this.scopes = Object.freeze([...(opts.scopes ?? [])]);
    this.fetchImpl = opts.fetch ?? fetch;
  }

  // ── HTTP helpers ───────────────────────────────────────────────────

  private url(path: string): string {
    return `${this.apiUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const init: RequestInit = { method, headers: this.headers() };
    if (body !== undefined) init.body = JSON.stringify(body);
    return await this.fetchImpl(this.url(path), init);
  }

  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await this.request(method, path, body);
    if (!res.ok) {
      const msg = await errorBody(res);
      throw new Error(`przm Memory cloud ${method} ${path} ${res.status}: ${msg}`);
    }
    return res;
  }

  private async sendJson<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.send(method, path, body);
    return (await res.json()) as T;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async ensureReady(): Promise<void> {
    // Lightweight identity probe. Verifies credentials are live and the
    // server is reachable before any pipeline work spins up. 401 here is
    // a clean signal to re-run `przm-memory-mcp login`.
    const res = await this.request('GET', '/api/auth/whoami');
    if (!res.ok) {
      const msg = await errorBody(res);
      if (res.status === 401) {
        throw new Error(
          `przm Memory cloud: credentials invalid or expired (${msg}). Run \`przm-memory-mcp login <url>\` again.`,
        );
      }
      throw new Error(`przm Memory cloud: server check failed (${res.status}): ${msg}`);
    }
  }

  async close(): Promise<void> {
    /* stateless HTTP client; nothing to close. */
  }

  // ── Chunks ─────────────────────────────────────────────────────────

  async saveChunk(chunk: StoredChunk): Promise<void> {
    await this.send('POST', '/api/engram/chunks', chunk);
  }

  async saveChunks(chunks: StoredChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    await this.send('POST', '/api/engram/chunks/batch', { chunks });
  }

  async getChunk(id: string): Promise<StoredChunk | null> {
    const res = await this.request('GET', `/api/engram/chunks/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      const msg = await errorBody(res);
      throw new Error(`przm Memory cloud GET /chunks/${id} ${res.status}: ${msg}`);
    }
    return (await res.json()) as StoredChunk;
  }

  async deleteChunk(id: string): Promise<void> {
    await this.send('DELETE', `/api/engram/chunks/${encodeURIComponent(id)}`);
  }

  async listChunks(opts?: ListChunksOpts): Promise<StoredChunk[]> {
    const qs = new URLSearchParams();
    if (opts?.excludeTiers && opts.excludeTiers.length > 0) {
      qs.set('excludeTiers', opts.excludeTiers.join(','));
    }
    if (opts?.tier) qs.set('tier', opts.tier);
    if (opts?.cognitiveLayer) qs.set('cognitiveLayer', opts.cognitiveLayer);
    if (opts?.domain) qs.set('domain', opts.domain);
    if (opts?.topic) qs.set('topic', opts.topic);
    if (opts?.tag) qs.set('tag', opts.tag);
    const path = `/api/engram/chunks${qs.toString() ? `?${qs.toString()}` : ''}`;
    const { chunks } = await this.sendJson<{ chunks: StoredChunk[] }>('GET', path);
    return chunks;
  }

  async updateChunk(id: string, updates: Partial<StoredChunk>): Promise<void> {
    await this.send('PATCH', `/api/engram/chunks/${encodeURIComponent(id)}`, updates);
  }

  async chunkCount(): Promise<number> {
    const { count } = await this.sendJson<{ count: number }>('GET', '/api/engram/chunks/count');
    return count;
  }

  async vectorSearch(queryEmbedding: number[], limit: number, filter?: string): Promise<VectorHit[]> {
    const body: { embedding: number[]; limit: number; filter?: string } = {
      embedding: queryEmbedding,
      limit,
    };
    if (filter) body.filter = filter;
    const { hits } = await this.sendJson<{ hits: VectorHit[] }>(
      'POST',
      '/api/engram/chunks/search',
      body,
    );
    return hits;
  }

  // ── Taxonomy ───────────────────────────────────────────────────────

  async getTaxonomy(): Promise<Record<string, Record<string, number>>> {
    const { taxonomy } = await this.sendJson<{
      taxonomy: Record<string, Record<string, number>>;
    }>('GET', '/api/engram/taxonomy');
    return taxonomy;
  }

  // ── Daily logs ─────────────────────────────────────────────────────

  async appendDailyEntry(date: string, entry: DailyLogEntry): Promise<void> {
    await this.send('POST', '/api/engram/daily-logs', { date, entry });
  }

  async getDailyLogs(daysBack: number): Promise<Array<{ date: string; entries: DailyLogEntry[] }>> {
    const { days } = await this.sendJson<{
      days: Array<{ date: string; entries: DailyLogEntry[] }>;
    }>('GET', `/api/engram/daily-logs?days_back=${daysBack}`);
    return days;
  }

  // ── Procedural rules ───────────────────────────────────────────────

  async saveRule(rule: ProceduralRule): Promise<void> {
    await this.send('POST', '/api/engram/rules', rule);
  }

  async getRules(): Promise<ProceduralRule[]> {
    const { rules } = await this.sendJson<{ rules: ProceduralRule[] }>('GET', '/api/engram/rules');
    return rules;
  }

  async deleteRule(id: string): Promise<void> {
    await this.send('DELETE', `/api/engram/rules/${encodeURIComponent(id)}`);
  }

  // ── Knowledge triples ──────────────────────────────────────────────

  async saveTriple(triple: KnowledgeTriple): Promise<void> {
    await this.send('POST', '/api/engram/triples', triple);
  }

  async queryTriples(opts?: QueryTriplesOpts): Promise<KnowledgeTriple[]> {
    const qs = new URLSearchParams();
    if (opts?.subject) qs.set('subject', opts.subject);
    if (opts?.predicate) qs.set('predicate', opts.predicate);
    if (opts?.object) qs.set('object', opts.object);
    if (opts?.activeOnly) qs.set('active_only', 'true');
    const path = `/api/engram/triples${qs.toString() ? `?${qs.toString()}` : ''}`;
    const { triples } = await this.sendJson<{ triples: KnowledgeTriple[] }>('GET', path);
    return triples;
  }

  async invalidateTriple(id: string): Promise<void> {
    await this.send('POST', `/api/engram/triples/${encodeURIComponent(id)}/invalidate`);
  }

  async getTripleTimeline(entity: string): Promise<KnowledgeTriple[]> {
    const { triples } = await this.sendJson<{ triples: KnowledgeTriple[] }>(
      'GET',
      `/api/engram/triples/timeline/${encodeURIComponent(entity)}`,
    );
    return triples;
  }

  async getTripleStats(): Promise<TripleStats> {
    return await this.sendJson<TripleStats>('GET', '/api/engram/triples/stats');
  }

  // ── Diary ──────────────────────────────────────────────────────────

  async writeDiaryEntry(content: string, agent?: string): Promise<DiaryEntry> {
    return await this.sendJson<DiaryEntry>('POST', '/api/engram/diary', { content, agent });
  }

  async readDiary(opts?: ReadDiaryOpts): Promise<Array<{ date: string; entries: DiaryEntry[] }>> {
    const qs = new URLSearchParams();
    if (opts?.date) qs.set('date', opts.date);
    else if (opts?.daysBack !== undefined) qs.set('days_back', String(opts.daysBack));
    if (opts?.agent) qs.set('agent', opts.agent);
    const path = `/api/engram/diary${qs.toString() ? `?${qs.toString()}` : ''}`;
    const { days } = await this.sendJson<{
      days: Array<{ date: string; entries: DiaryEntry[] }>;
    }>('GET', path);
    return days;
  }

  async listDiaryDates(): Promise<string[]> {
    const { dates } = await this.sendJson<{ dates: string[] }>('GET', '/api/engram/diary/dates');
    return dates;
  }

  // ── Handoffs ───────────────────────────────────────────────────────

  async writeHandoff(note: Omit<HandoffNote, 'timestamp'>): Promise<HandoffNote> {
    // przm server returns { stamp, ...HandoffNote }. The local file adapter
    // returns just HandoffNote, and downstream consumers don't depend on
    // `stamp` from this method's return — strip it so the contract matches.
    const full = await this.sendJson<HandoffNote & { stamp?: string }>(
      'POST',
      '/api/engram/handoffs',
      note,
    );
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { stamp: _stamp, ...rest } = full;
    return rest as HandoffNote;
  }

  async readHandoff(stamp?: string): Promise<HandoffNote | null> {
    const target = stamp ?? 'latest';
    const res = await this.request('GET', `/api/engram/handoffs/${encodeURIComponent(target)}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      const msg = await errorBody(res);
      throw new Error(`przm Memory cloud GET /handoffs/${target} ${res.status}: ${msg}`);
    }
    return (await res.json()) as HandoffNote;
  }

  async listHandoffs(limit: number = 10): Promise<HandoffSummary[]> {
    const { handoffs } = await this.sendJson<{ handoffs: HandoffSummary[] }>(
      'GET',
      `/api/engram/handoffs?limit=${limit}`,
    );
    return handoffs;
  }
}
