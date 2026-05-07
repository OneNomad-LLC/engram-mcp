/**
 * Pure helper: build the storage patch for a memory_update_metadata
 * call. Separated from server.ts so importing it (e.g. from tests)
 * doesn't pull in the MCP stdio server bootstrap.
 *
 * - `merge`: only fields the caller specified land in the patch.
 *   Untouched fields are absent → Storage.updateChunk leaves them alone.
 * - `replace`: every metadata-shape field is set, with caller values
 *   where present and engram defaults otherwise. Existing untouched
 *   fields get overwritten with the default. Footgun-y; the tool
 *   layer logs a warning when this mode fires.
 *
 * Immutable fields (id, createdAt, embedding, embeddingVersion) are
 * never produced by this helper; the tool layer doesn't accept them
 * in its input schema either.
 */
export function buildUpdateMetadataPatch(metadata, mode) {
    const patch = {};
    if (mode === 'replace') {
        patch.tags = metadata.tags ?? [];
        patch.source = metadata.source ?? '';
        patch.domain = metadata.domain ?? '';
        patch.topic = metadata.topic ?? '';
        patch.type = metadata.type ?? 'context';
        patch.sentiment = metadata.sentiment ?? 'neutral';
        patch.importance = metadata.importance ?? 0.5;
        if (metadata.cognitiveLayer !== undefined) {
            patch.cognitiveLayer = metadata.cognitiveLayer;
        }
    }
    else {
        if (metadata.tags !== undefined)
            patch.tags = metadata.tags;
        if (metadata.source !== undefined)
            patch.source = metadata.source;
        if (metadata.domain !== undefined)
            patch.domain = metadata.domain;
        if (metadata.topic !== undefined)
            patch.topic = metadata.topic;
        if (metadata.type !== undefined)
            patch.type = metadata.type;
        if (metadata.sentiment !== undefined)
            patch.sentiment = metadata.sentiment;
        if (metadata.importance !== undefined)
            patch.importance = metadata.importance;
        if (metadata.cognitiveLayer !== undefined) {
            patch.cognitiveLayer = metadata.cognitiveLayer;
        }
    }
    return patch;
}
//# sourceMappingURL=update-metadata.js.map