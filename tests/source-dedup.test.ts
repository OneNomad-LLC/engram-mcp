import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { SourceDedupCache } from '../src/source-dedup.js';

test('SourceDedupCache: lookup returns null on empty cache', () => {
  const cache = new SourceDedupCache();
  assert.equal(cache.lookup('file.ts', 'hello'), null);
  assert.equal(cache.stats().misses, 1);
});

test('SourceDedupCache: lookup returns null without source key', () => {
  const cache = new SourceDedupCache();
  cache.remember('file.ts', 'hello', 'id-1');
  assert.equal(cache.lookup(undefined, 'hello'), null);
  assert.equal(cache.lookup('', 'hello'), null);
});

test('SourceDedupCache: hit on identical (source, content)', () => {
  const cache = new SourceDedupCache();
  cache.remember('file.ts', 'hello world', 'id-1');
  const found = cache.lookup('file.ts', 'hello world');
  assert.notEqual(found, null);
  assert.equal(found!.chunkId, 'id-1');
  assert.equal(cache.stats().hits, 1);
});

test('SourceDedupCache: trims content before hashing', () => {
  const cache = new SourceDedupCache();
  cache.remember('file.ts', '  hello world  \n', 'id-1');
  const found = cache.lookup('file.ts', 'hello world');
  assert.notEqual(found, null);
  assert.equal(found!.chunkId, 'id-1');
});

test('SourceDedupCache: same content from different sources is independent', () => {
  const cache = new SourceDedupCache();
  cache.remember('a.ts', 'shared', 'id-a');
  cache.remember('b.ts', 'shared', 'id-b');
  assert.equal(cache.lookup('a.ts', 'shared')!.chunkId, 'id-a');
  assert.equal(cache.lookup('b.ts', 'shared')!.chunkId, 'id-b');
});

test('SourceDedupCache: different content from same source produces independent entries', () => {
  const cache = new SourceDedupCache();
  cache.remember('file.ts', 'v1 content', 'id-v1');
  cache.remember('file.ts', 'v2 content', 'id-v2');
  assert.equal(cache.lookup('file.ts', 'v1 content')!.chunkId, 'id-v1');
  assert.equal(cache.lookup('file.ts', 'v2 content')!.chunkId, 'id-v2');
});

test('SourceDedupCache: re-remember of same hash replaces chunkId', () => {
  const cache = new SourceDedupCache();
  cache.remember('file.ts', 'hello', 'id-1');
  cache.remember('file.ts', 'hello', 'id-2');
  assert.equal(cache.lookup('file.ts', 'hello')!.chunkId, 'id-2');
});

test('SourceDedupCache: per-source cap evicts oldest hash entries', () => {
  const cache = new SourceDedupCache();
  // Push 10 distinct contents under the same source; cap is 8.
  for (let i = 0; i < 10; i++) cache.remember('file.ts', `content-${i}`, `id-${i}`);
  // Oldest two (content-0, content-1) should be evicted.
  assert.equal(cache.lookup('file.ts', 'content-0'), null);
  assert.equal(cache.lookup('file.ts', 'content-1'), null);
  // Most recent should still hit.
  assert.equal(cache.lookup('file.ts', 'content-9')!.chunkId, 'id-9');
  assert.equal(cache.lookup('file.ts', 'content-2')!.chunkId, 'id-2');
});

test('SourceDedupCache: global cap evicts oldest source', () => {
  const cache = new SourceDedupCache();
  // Push 65 distinct sources; cap is 64. Oldest source should be gone.
  for (let i = 0; i < 65; i++) cache.remember(`source-${i}`, 'content', `id-${i}`);
  assert.equal(cache.lookup('source-0', 'content'), null);
  assert.equal(cache.lookup('source-64', 'content')!.chunkId, 'id-64');
});

test('SourceDedupCache: clear resets state', () => {
  const cache = new SourceDedupCache();
  cache.remember('file.ts', 'hello', 'id-1');
  cache.lookup('file.ts', 'hello'); // hit
  cache.clear();
  assert.equal(cache.lookup('file.ts', 'hello'), null);
  assert.equal(cache.stats().hits, 0);
  assert.equal(cache.stats().misses, 1);
});

test('SourceDedupCache: stats track hit-rate', () => {
  const cache = new SourceDedupCache();
  cache.remember('a', 'x', 'id-a');
  cache.lookup('a', 'x'); // hit
  cache.lookup('a', 'y'); // miss
  cache.lookup('b', 'x'); // miss
  const s = cache.stats();
  assert.equal(s.hits, 1);
  assert.equal(s.misses, 2);
  assert.ok(Math.abs(s.hitRate - 1 / 3) < 1e-9);
});
