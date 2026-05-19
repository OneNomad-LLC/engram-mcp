/**
 * Storage — backwards-compatible shim over the pluggable StorageAdapter.
 *
 * przm Memory historically exposed a concrete `Storage` class that owned
 * LanceDB tables directly. ~20 modules import { Storage } from here
 * and call `new Storage(dataDir)` then `await storage.ensureReady()`.
 * The shim keeps that surface intact while delegating every method to
 * a backend adapter selected by createStorageAdapter().
 *
 *   STORAGE_BACKEND=file        — FileStorageAdapter (default; LanceDB)
 *   STORAGE_BACKEND=postgres    — PostgresStorageAdapter (multi-tenant)
 *
 * File-mode callers (`new Storage(dataDir)`) see byte-identical
 * behavior to the pre-adapter implementation. Postgres-mode callers
 * skip the dataDir and read DATABASE_URL + TENANT_ID from env.
 */
import { createStorageAdapter, resolveBackend } from './storage-factory.js';
import { FileStorageAdapter } from './storage-file.js';
export class Storage {
    adapter;
    ready;
    constructor(dataDir) {
        // Resolve eagerly; file mode is sync, postgres mode awaits the
        // factory before ensureReady() returns.
        const backend = resolveBackend();
        if (backend === 'file') {
            // Hot path — no dynamic import, no env-var roundtrip.
            this.adapter = new FileStorageAdapter(dataDir);
            this.ready = this.adapter.ensureReady();
        }
        else {
            this.ready = (async () => {
                this.adapter = await createStorageAdapter({ dataDir, backend });
                await this.adapter.ensureReady();
            })();
        }
    }
    async ensureReady() {
        await this.ready;
    }
    // ── Chunks ────────────────────────────────────────────────────────
    saveChunk(chunk) { return this.adapter.saveChunk(chunk); }
    saveChunks(chunks) { return this.adapter.saveChunks(chunks); }
    getChunk(id) { return this.adapter.getChunk(id); }
    deleteChunk(id) { return this.adapter.deleteChunk(id); }
    listChunks(opts) { return this.adapter.listChunks(opts); }
    updateChunk(id, updates) { return this.adapter.updateChunk(id, updates); }
    chunkCount() { return this.adapter.chunkCount(); }
    vectorSearch(queryEmbedding, limit, filter) {
        return this.adapter.vectorSearch(queryEmbedding, limit, filter);
    }
    // ── Taxonomy ─────────────────────────────────────────────────────
    getTaxonomy() { return this.adapter.getTaxonomy(); }
    // ── Daily logs ───────────────────────────────────────────────────
    appendDailyEntry(date, entry) {
        return this.adapter.appendDailyEntry(date, entry);
    }
    getDailyLogs(daysBack) {
        return this.adapter.getDailyLogs(daysBack);
    }
    // ── Rules ────────────────────────────────────────────────────────
    saveRule(rule) { return this.adapter.saveRule(rule); }
    getRules() { return this.adapter.getRules(); }
    deleteRule(id) { return this.adapter.deleteRule(id); }
    // ── Knowledge triples ────────────────────────────────────────────
    saveTriple(triple) { return this.adapter.saveTriple(triple); }
    queryTriples(opts) { return this.adapter.queryTriples(opts); }
    invalidateTriple(id) { return this.adapter.invalidateTriple(id); }
    getTripleTimeline(entity) { return this.adapter.getTripleTimeline(entity); }
    getTripleStats() { return this.adapter.getTripleStats(); }
    // ── Diary + handoffs (new surface — server.ts routes through these
    //    when STORAGE_BACKEND=postgres so the markdown filesystem layer
    //    isn't required for cloud installs) ───────────────────────────
    writeDiaryEntry(content, agent) {
        return this.adapter.writeDiaryEntry(content, agent);
    }
    readDiary(opts) {
        return this.adapter.readDiary(opts);
    }
    listDiaryDates() { return this.adapter.listDiaryDates(); }
    writeHandoff(note) {
        return this.adapter.writeHandoff(note);
    }
    readHandoff(stamp) { return this.adapter.readHandoff(stamp); }
    listHandoffs(limit) { return this.adapter.listHandoffs(limit); }
    // ── Lifecycle ────────────────────────────────────────────────────
    close() {
        // Adapter close is optional + may be async; fire-and-forget for
        // backwards compat (the file backend's close is a no-op).
        if (this.adapter?.close) {
            Promise.resolve(this.adapter.close()).catch(() => { });
        }
    }
}
//# sourceMappingURL=storage.js.map