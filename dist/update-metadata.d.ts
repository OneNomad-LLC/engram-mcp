import type { CognitiveLayer, MemoryChunk, MemoryType, Sentiment } from './types.js';
export interface UpdateMetadataInput {
    tags?: string[];
    source?: string;
    domain?: string;
    topic?: string;
    type?: MemoryType;
    sentiment?: Sentiment;
    importance?: number;
    cognitiveLayer?: CognitiveLayer;
}
export type UpdateMetadataMode = 'merge' | 'replace';
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
export declare function buildUpdateMetadataPatch(metadata: UpdateMetadataInput, mode: UpdateMetadataMode): Partial<MemoryChunk>;
