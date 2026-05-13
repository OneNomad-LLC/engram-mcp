/**
 * CloudStorageAdapter — Pyre Cloud HTTP-backed storage. STUB.
 *
 * The cloud storage adapter is the next PR. For now this file exists
 * solely so that the storage factory can construct an adapter when a
 * ~/.pyre/credentials.json is present without having to special-case
 * the wiring up through the rest of the codebase.
 *
 * Every method throws with a clear "not yet implemented" message.
 * That's a feature, not a bug: a user who runs `engram-mcp login`
 * today should see an explicit failure instead of silently falling
 * back to local file mode and having two stores diverge.
 */
function notImplemented(method) {
    throw new Error(`CloudStorageAdapter.${method}: cloud storage backend is not yet implemented — ` +
        `the device-code login + credentials file landed first, the HTTP adapter ships in the next PR. ` +
        `Until then, unset STORAGE_BACKEND and remove ~/.pyre/credentials.json (or run \`engram-mcp logout\`) ` +
        `to use the local file backend.`);
}
export class CloudStorageAdapter {
    apiUrl;
    apiKey;
    label;
    scopes;
    constructor(opts) {
        this.apiUrl = opts.apiUrl;
        this.apiKey = opts.apiKey;
        this.label = opts.label;
        this.scopes = Object.freeze([...(opts.scopes ?? [])]);
    }
    // Lifecycle ─────────────────────────────────────────────────────────
    async ensureReady() { notImplemented('ensureReady'); }
    async close() { }
    // Chunks ────────────────────────────────────────────────────────────
    async saveChunk(_chunk) { notImplemented('saveChunk'); }
    async getChunk(_id) { notImplemented('getChunk'); }
    async deleteChunk(_id) { notImplemented('deleteChunk'); }
    async listChunks(_opts) { notImplemented('listChunks'); }
    async updateChunk(_id, _updates) { notImplemented('updateChunk'); }
    async chunkCount() { notImplemented('chunkCount'); }
    async vectorSearch(_q, _limit, _filter) { notImplemented('vectorSearch'); }
    // Taxonomy ──────────────────────────────────────────────────────────
    async getTaxonomy() { notImplemented('getTaxonomy'); }
    // Daily logs ────────────────────────────────────────────────────────
    async appendDailyEntry(_date, _entry) { notImplemented('appendDailyEntry'); }
    async getDailyLogs(_daysBack) { notImplemented('getDailyLogs'); }
    // Procedural rules ──────────────────────────────────────────────────
    async saveRule(_rule) { notImplemented('saveRule'); }
    async getRules() { notImplemented('getRules'); }
    async deleteRule(_id) { notImplemented('deleteRule'); }
    // Knowledge triples ─────────────────────────────────────────────────
    async saveTriple(_triple) { notImplemented('saveTriple'); }
    async queryTriples(_opts) { notImplemented('queryTriples'); }
    async invalidateTriple(_id) { notImplemented('invalidateTriple'); }
    async getTripleTimeline(_entity) { notImplemented('getTripleTimeline'); }
    async getTripleStats() { notImplemented('getTripleStats'); }
    // Diary ─────────────────────────────────────────────────────────────
    async writeDiaryEntry(_content, _agent) { notImplemented('writeDiaryEntry'); }
    async readDiary(_opts) { notImplemented('readDiary'); }
    async listDiaryDates() { notImplemented('listDiaryDates'); }
    // Handoffs ──────────────────────────────────────────────────────────
    async writeHandoff(_note) { notImplemented('writeHandoff'); }
    async readHandoff(_stamp) { notImplemented('readHandoff'); }
    async listHandoffs(_limit) { notImplemented('listHandoffs'); }
}
//# sourceMappingURL=storage-cloud.js.map