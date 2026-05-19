async function errorBody(res) {
    const text = await res.text().catch(() => '');
    if (!text)
        return `${res.status} ${res.statusText}`;
    try {
        const parsed = JSON.parse(text);
        if (parsed.error?.message) {
            return parsed.error.code
                ? `${parsed.error.code}: ${parsed.error.message}`
                : parsed.error.message;
        }
    }
    catch {
        /* raw text fallback */
    }
    return text.slice(0, 200);
}
export class CloudStorageAdapter {
    apiUrl;
    apiKey;
    label;
    scopes;
    fetchImpl;
    constructor(opts) {
        this.apiUrl = opts.apiUrl.replace(/\/+$/, '');
        this.apiKey = opts.apiKey;
        this.label = opts.label;
        this.scopes = Object.freeze([...(opts.scopes ?? [])]);
        this.fetchImpl = opts.fetch ?? fetch;
    }
    // ── HTTP helpers ───────────────────────────────────────────────────
    url(path) {
        return `${this.apiUrl}${path.startsWith('/') ? path : `/${path}`}`;
    }
    headers() {
        return {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        };
    }
    async request(method, path, body) {
        const init = { method, headers: this.headers() };
        if (body !== undefined)
            init.body = JSON.stringify(body);
        return await this.fetchImpl(this.url(path), init);
    }
    async send(method, path, body) {
        const res = await this.request(method, path, body);
        if (!res.ok) {
            const msg = await errorBody(res);
            throw new Error(`przm Memory cloud ${method} ${path} ${res.status}: ${msg}`);
        }
        return res;
    }
    async sendJson(method, path, body) {
        const res = await this.send(method, path, body);
        return (await res.json());
    }
    // ── Lifecycle ──────────────────────────────────────────────────────
    async ensureReady() {
        // Lightweight identity probe. Verifies credentials are live and the
        // server is reachable before any pipeline work spins up. 401 here is
        // a clean signal to re-run `przm-memory-mcp login`.
        const res = await this.request('GET', '/api/auth/whoami');
        if (!res.ok) {
            const msg = await errorBody(res);
            if (res.status === 401) {
                throw new Error(`przm Memory cloud: credentials invalid or expired (${msg}). Run \`przm-memory-mcp login <url>\` again.`);
            }
            throw new Error(`przm Memory cloud: server check failed (${res.status}): ${msg}`);
        }
    }
    async close() {
        /* stateless HTTP client; nothing to close. */
    }
    // ── Chunks ─────────────────────────────────────────────────────────
    async saveChunk(chunk) {
        await this.send('POST', '/api/engram/chunks', chunk);
    }
    async saveChunks(chunks) {
        if (chunks.length === 0)
            return;
        await this.send('POST', '/api/engram/chunks/batch', { chunks });
    }
    async getChunk(id) {
        const res = await this.request('GET', `/api/engram/chunks/${encodeURIComponent(id)}`);
        if (res.status === 404)
            return null;
        if (!res.ok) {
            const msg = await errorBody(res);
            throw new Error(`przm Memory cloud GET /chunks/${id} ${res.status}: ${msg}`);
        }
        return (await res.json());
    }
    async deleteChunk(id) {
        await this.send('DELETE', `/api/engram/chunks/${encodeURIComponent(id)}`);
    }
    async listChunks(opts) {
        const qs = new URLSearchParams();
        if (opts?.excludeTiers && opts.excludeTiers.length > 0) {
            qs.set('excludeTiers', opts.excludeTiers.join(','));
        }
        if (opts?.tier)
            qs.set('tier', opts.tier);
        if (opts?.cognitiveLayer)
            qs.set('cognitiveLayer', opts.cognitiveLayer);
        if (opts?.domain)
            qs.set('domain', opts.domain);
        if (opts?.topic)
            qs.set('topic', opts.topic);
        if (opts?.tag)
            qs.set('tag', opts.tag);
        const path = `/api/engram/chunks${qs.toString() ? `?${qs.toString()}` : ''}`;
        const { chunks } = await this.sendJson('GET', path);
        return chunks;
    }
    async updateChunk(id, updates) {
        await this.send('PATCH', `/api/engram/chunks/${encodeURIComponent(id)}`, updates);
    }
    async chunkCount() {
        const { count } = await this.sendJson('GET', '/api/engram/chunks/count');
        return count;
    }
    async vectorSearch(queryEmbedding, limit, filter) {
        const body = {
            embedding: queryEmbedding,
            limit,
        };
        if (filter)
            body.filter = filter;
        const { hits } = await this.sendJson('POST', '/api/engram/chunks/search', body);
        return hits;
    }
    // ── Taxonomy ───────────────────────────────────────────────────────
    async getTaxonomy() {
        const { taxonomy } = await this.sendJson('GET', '/api/engram/taxonomy');
        return taxonomy;
    }
    // ── Daily logs ─────────────────────────────────────────────────────
    async appendDailyEntry(date, entry) {
        await this.send('POST', '/api/engram/daily-logs', { date, entry });
    }
    async getDailyLogs(daysBack) {
        const { days } = await this.sendJson('GET', `/api/engram/daily-logs?days_back=${daysBack}`);
        return days;
    }
    // ── Procedural rules ───────────────────────────────────────────────
    async saveRule(rule) {
        await this.send('POST', '/api/engram/rules', rule);
    }
    async getRules() {
        const { rules } = await this.sendJson('GET', '/api/engram/rules');
        return rules;
    }
    async deleteRule(id) {
        await this.send('DELETE', `/api/engram/rules/${encodeURIComponent(id)}`);
    }
    // ── Knowledge triples ──────────────────────────────────────────────
    async saveTriple(triple) {
        await this.send('POST', '/api/engram/triples', triple);
    }
    async queryTriples(opts) {
        const qs = new URLSearchParams();
        if (opts?.subject)
            qs.set('subject', opts.subject);
        if (opts?.predicate)
            qs.set('predicate', opts.predicate);
        if (opts?.object)
            qs.set('object', opts.object);
        if (opts?.activeOnly)
            qs.set('active_only', 'true');
        const path = `/api/engram/triples${qs.toString() ? `?${qs.toString()}` : ''}`;
        const { triples } = await this.sendJson('GET', path);
        return triples;
    }
    async invalidateTriple(id) {
        await this.send('POST', `/api/engram/triples/${encodeURIComponent(id)}/invalidate`);
    }
    async getTripleTimeline(entity) {
        const { triples } = await this.sendJson('GET', `/api/engram/triples/timeline/${encodeURIComponent(entity)}`);
        return triples;
    }
    async getTripleStats() {
        return await this.sendJson('GET', '/api/engram/triples/stats');
    }
    // ── Diary ──────────────────────────────────────────────────────────
    async writeDiaryEntry(content, agent) {
        return await this.sendJson('POST', '/api/engram/diary', { content, agent });
    }
    async readDiary(opts) {
        const qs = new URLSearchParams();
        if (opts?.date)
            qs.set('date', opts.date);
        else if (opts?.daysBack !== undefined)
            qs.set('days_back', String(opts.daysBack));
        if (opts?.agent)
            qs.set('agent', opts.agent);
        const path = `/api/engram/diary${qs.toString() ? `?${qs.toString()}` : ''}`;
        const { days } = await this.sendJson('GET', path);
        return days;
    }
    async listDiaryDates() {
        const { dates } = await this.sendJson('GET', '/api/engram/diary/dates');
        return dates;
    }
    // ── Handoffs ───────────────────────────────────────────────────────
    async writeHandoff(note) {
        // przm server returns { stamp, ...HandoffNote }. The local file adapter
        // returns just HandoffNote, and downstream consumers don't depend on
        // `stamp` from this method's return — strip it so the contract matches.
        const full = await this.sendJson('POST', '/api/engram/handoffs', note);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { stamp: _stamp, ...rest } = full;
        return rest;
    }
    async readHandoff(stamp) {
        const target = stamp ?? 'latest';
        const res = await this.request('GET', `/api/engram/handoffs/${encodeURIComponent(target)}`);
        if (res.status === 404)
            return null;
        if (!res.ok) {
            const msg = await errorBody(res);
            throw new Error(`przm Memory cloud GET /handoffs/${target} ${res.status}: ${msg}`);
        }
        return (await res.json());
    }
    async listHandoffs(limit = 10) {
        const { handoffs } = await this.sendJson('GET', `/api/engram/handoffs?limit=${limit}`);
        return handoffs;
    }
}
//# sourceMappingURL=storage-cloud.js.map