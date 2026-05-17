#!/usr/bin/env node

/**
 * LongMemEval Benchmark -- same dataset as MemPalace
 *
 * Dataset: 500 questions across 6 types, ~53 sessions per question.
 * Source:  https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned
 *
 * MemPalace scores:
 *   Raw ChromaDB:          96.6% R@5  (zero API)
 *   Hybrid v4 (no rerank): 98.4% R@5  (zero API, held-out 450)
 *   Hybrid v4 + Haiku:     100%  R@5  (Haiku rerank)
 *
 * Usage:
 *   # 1. Download dataset (~277 MB)
 *   curl -fsSL -o benchmarks/data/longmemeval_s_cleaned.json \
 *     https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json
 *
 *   # 2. Run benchmark
 *   npm run bench:longmemeval
 *   npm run bench:longmemeval -- --limit 50        # quick test with 50 questions
 *   npm run bench:longmemeval -- --verbose          # per-question output
 */

// CRITICAL: force the local file backend. Without this, src/storage-factory.ts
// auto-routes Storage to Pyre Cloud whenever ~/.pyre/credentials.json exists,
// silently ignoring the temp dataDir we pass in. That made the bench POST every
// chunk to the live cloud tenant and pull mixed results from every prior run.
process.env.STORAGE_BACKEND = 'file';

import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { rm as fsRm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Storage } from '../src/storage.js';
import { loadConfig } from '../src/config.js';
import { embed, isLlmAvailable } from '../src/llm.js';
import { buildContextPrefix } from '../src/utils.js';
import { search, selectRelevant } from '../src/search.js';
import type { SmartMemoryConfig, SearchResult } from '../src/types.js';
import type { StoredChunk } from '../src/storage.js';
import { randomUUID } from 'node:crypto';
import { writeBenchmarkResult, percentiles } from './lib/results.js';

// ── Types ───────────────────────────────────────────────────────────

interface LMEEntry {
  question_id: string;
  question_type: string;
  question: string;
  answer: string | number;
  question_date: string;
  haystack_session_ids: string[];
  haystack_dates: string[];
  haystack_sessions: Array<Array<{ role: string; content: string; has_answer?: boolean }>>;
  answer_session_ids: string[];
}

interface QuestionResult {
  questionId: string;
  questionType: string;
  question: string;
  recall5: number;
  recall10: number;
  ndcg5: number;
  ndcg10: number;
  latencyMs: number;
  answerSessionIds: string[];
  retrievedSessionIds: string[];
}

// ── Metrics ─────────────────────────────────────────────────────────

function recallAtK(retrieved: string[], relevant: string[], k: number): number {
  // INTEGRITY: an earlier version returned 1 (auto-hit) when
  // relevant.length === 0. That silently inflates the headline metric
  // by the number of dataset questions with no answer_session_ids.
  // The correct handling is to EXCLUDE such questions from the
  // benchmark entirely (done at the question loop), not score them.
  // Return 0 here as a defensive fallback in case an empty list ever
  // reaches this function -- it should not.
  if (relevant.length === 0) return 0;
  const topK = new Set(retrieved.slice(0, k));
  const found = relevant.filter(id => topK.has(id)).length;
  return found > 0 ? 1 : 0; // Binary recall: did we find ANY answer session in top K?
}

/**
 * Dedupe a retrieved-session list while preserving first-rank order.
 * Sub-session chunking means multiple chunks can map back to the same
 * session ID, so the raw retrieved list contains duplicates. NDCG
 * computed on the raw list yields values >1 (it counts the same hit
 * multiple times). For metric correctness, dedupe by session before
 * any rank-weighted calculation.
 */
function dedupeSessions(retrieved: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of retrieved) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function ndcgAtK(retrieved: string[], relevant: string[], k: number): number {
  // Dedupe by session — sub-chunking causes the same session to appear
  // multiple times in the retrieved list, which would otherwise let
  // NDCG exceed 1. R@K uses a Set internally so it's unaffected.
  const deduped = dedupeSessions(retrieved);
  const relevantSet = new Set(relevant);
  let dcg = 0;
  const topK = deduped.slice(0, k);
  for (let i = 0; i < topK.length; i++) {
    if (relevantSet.has(topK[i])) {
      dcg += 1 / Math.log2(i + 2);
    }
  }
  let idcg = 0;
  for (let i = 0; i < Math.min(relevant.length, k); i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg === 0 ? 0 : dcg / idcg;
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const benchStart = performance.now();
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const limitArg = args.find((_, i) => args[i - 1] === '--limit');
  const limit = limitArg ? parseInt(limitArg) : undefined;
  const useRerank = args.includes('--rerank');
  const emitJson = !args.includes('--no-results');

  // Find dataset
  const dataPath = join(import.meta.dirname ?? '.', 'data', 'longmemeval_s_cleaned.json');
  if (!existsSync(dataPath)) {
    console.error('Dataset not found at:', dataPath);
    console.error('');
    console.error('Download it first:');
    console.error('  mkdir -p benchmarks/data');
    console.error('  curl -fsSL -o benchmarks/data/longmemeval_s_cleaned.json \\');
    console.error('    https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json');
    process.exit(1);
  }

  console.error('Loading dataset...');
  const raw = readFileSync(dataPath, 'utf-8');
  let dataset: LMEEntry[] = JSON.parse(raw);
  console.error(`Loaded ${dataset.length} questions`);

  if (limit) {
    dataset = dataset.slice(0, limit);
    console.error(`Limited to ${dataset.length} questions`);
  }

  // Process each question independently (like MemPalace does)
  const results: QuestionResult[] = [];
  const byType: Record<string, QuestionResult[]> = {};
  let excludedCount = 0;

  // Warm up embedding model
  console.error('Warming up embedding model...');
  await embed(loadConfig(), 'warmup');
  console.error('Model ready.\n');

  for (let qi = 0; qi < dataset.length; qi++) {
    const entry = dataset[qi];

    // INTEGRITY: questions whose dataset entry has no answer_session_ids
    // cannot be scored honestly (there is no ground truth to recall
    // against). Exclude them entirely rather than auto-scoring as a hit
    // (the prior bug) or auto-scoring as a miss (also wrong). Track
    // exclusions and surface in the result file so the published number
    // is transparent about what it measures.
    if (!Array.isArray(entry.answer_session_ids) || entry.answer_session_ids.length === 0) {
      excludedCount++;
      if (verbose) {
        console.error(`  [SKIP] ${entry.question_id}: no answer_session_ids in dataset`);
      }
      continue;
    }

    if (verbose || qi % 50 === 0 || qi <= 2) {
      console.error(`[${qi + 1}/${dataset.length}] ${entry.question_type}: ${entry.question.slice(0, 60)}...`);
    }

    // Yield to the event loop. After the previous iteration's storage
    // goes out of scope, fire-and-forget background writes from
    // search.ts (audit finding C5: unawaited recallCount updates) and
    // LanceDB's internal connection cleanup may still be pending. A
    // setImmediate yield lets those drain before we open a new LanceDB
    // connection -- on Windows the two collide and stall.
    await new Promise(resolve => setImmediate(resolve));

    if (qi <= 2) console.error(`  [${qi + 1}] creating storage...`);

    // Create isolated storage for this question
    const benchDir = join(tmpdir(), `lme-bench-${Date.now()}-${qi}`);
    mkdirSync(benchDir, { recursive: true });

    const config: SmartMemoryConfig = {
      ...loadConfig({ dataDir: benchDir }),
      dataDir: benchDir,
      maxRecallChunks: 10,
      maxRecallTokens: 50000, // Don't limit by tokens for benchmark
    };

    if (qi <= 2) console.error(`  [${qi + 1}] connecting LanceDB...`);
    const storage = new Storage(benchDir);
    await storage.ensureReady();
    if (qi <= 2) console.error(`  [${qi + 1}] storage ready, ingesting ${entry.haystack_sessions.length} sessions...`);

    // Ingest sessions as whole documents (same approach as MemPalace)
    const sessionIdMap = new Map<string, string>(); // chunkId -> sessionId
    const ingestStart = performance.now();
    const totalSessions = entry.haystack_sessions.length;

    for (let si = 0; si < totalSessions; si++) {
      const session = entry.haystack_sessions[si];
      const sessionId = entry.haystack_session_ids[si];
      const sessionDate = entry.haystack_dates[si] ?? '';

      // Liveness signal:
      //   - every 5 sessions for question 1 (cold-start visibility)
      //   - every 10 sessions in verbose mode
      //   - every 25 sessions in default mode (less spammy but enough
      //     to know the bench hasn't wedged inside a single question)
      const shouldLog =
        (qi === 0 && si > 0 && si % 5 === 0) ||
        (verbose && si > 0 && si % 10 === 0) ||
        (!verbose && si > 0 && si % 25 === 0);
      if (shouldLog) {
        const elapsedMs = performance.now() - ingestStart;
        const rate = si / (elapsedMs / 1000);
        console.error(`  ingesting [${si}/${totalSessions}] ${rate.toFixed(1)} sessions/sec`);
      }

      // Concatenate session into a single document
      const sessionText = session
        .map(m => `${m.role}: ${m.content}`)
        .join('\n');

      if (sessionText.length < 10) continue;

      // Single atomic chunk per session — reverted from sub-chunking
      // approach after 2026-05-15 full-500 run showed sub-chunking
      // regressed overall recall from 96.0% to 93.6% (preference and
      // temporal categories dropped most). Sub-chunks added noise
      // candidates that crowded out the actual answer-session chunk
      // for abstract / multi-aspect queries.
      const chunkId = randomUUID();
      sessionIdMap.set(chunkId, sessionId);

      let embedding: number[] | undefined;
      try {
        const prefix = buildContextPrefix({
          type: 'context',
          cognitiveLayer: 'episodic',
          createdAt: sessionDate || new Date().toISOString(),
        });
        embedding = await embed(config, sessionText.slice(0, 2000), prefix);
      } catch {
        // Fall back to no embedding
      }

      const chunk: StoredChunk = {
        id: chunkId,
        tier: 'long-term',
        content: sessionText,
        type: 'context',
        cognitiveLayer: 'episodic',
        tags: [],
        domain: '',
        topic: '',
        source: sessionId,
        importance: 0.5,
        sentiment: 'neutral',
        createdAt: sessionDate || new Date().toISOString(),
        lastRecalledAt: null,
        recallCount: 0,
        embedding,
        relatedMemories: [],
        recallOutcomes: [],
      };

      await storage.saveChunk(chunk);
    }

    // Search — wrapped with hard timeout so a stuck pipeline can't
    // wedge the entire benchmark run. The first question on a cold
    // cache can take 5-15s; anything past 60s is a real bug worth
    // surfacing (probably KG extraction or spreading activation
    // looping on a pathological session).
    if (qi === 0) {
      console.error(`  search starting for question 1...`);
    }
    // Compute reference "now" from the latest haystack session date so
    // "N days ago" queries anchor to the dataset's timeline rather than
    // wall-clock today. Without this, temporal-reasoning queries miss
    // because the computed date is years off. Falls back to Date.now()
    // when the haystack has no usable dates.
    let referenceDate: number | undefined;
    try {
      const haystackTimes = entry.haystack_dates
        .map(d => Date.parse(d))
        .filter((n): n is number => Number.isFinite(n));
      if (haystackTimes.length > 0) {
        referenceDate = Math.max(...haystackTimes);
      }
    } catch { /* fall back to Date.now() */ }

    const start = performance.now();
    const searchTimeoutMs = 60_000;
    let searchResults: SearchResult[];
    try {
      searchResults = await Promise.race([
        search(config, storage, entry.question, 10, referenceDate ? { referenceDate } : undefined),
        new Promise<SearchResult[]>((_, reject) =>
          setTimeout(() => reject(new Error(`search timeout after ${searchTimeoutMs}ms`)), searchTimeoutMs),
        ),
      ]);
    } catch (err) {
      console.error(`  [SEARCH FAIL] ${entry.question_id}: ${err instanceof Error ? err.message : String(err)}`);
      // Skip this question rather than wedging the run.
      try { rmSync(benchDir, { recursive: true, force: true }); } catch { /* noop */ }
      continue;
    }
    if (qi === 0) {
      console.error(`  search completed in ${(performance.now() - start).toFixed(0)}ms`);
    }

    let selected: SearchResult[];
    if (useRerank && isLlmAvailable()) {
      try {
        selected = await selectRelevant(config, entry.question, searchResults);
      } catch {
        selected = searchResults;
      }
    } else {
      selected = searchResults;
    }
    const latencyMs = performance.now() - start;

    // Map results back to session IDs
    const retrievedSessionIds = selected.map(r => sessionIdMap.get(r.chunk.id) ?? r.chunk.source);

    const recall5 = recallAtK(retrievedSessionIds, entry.answer_session_ids, 5);
    const recall10 = recallAtK(retrievedSessionIds, entry.answer_session_ids, 10);
    const ndcg5 = ndcgAtK(retrievedSessionIds, entry.answer_session_ids, 5);
    const ndcg10 = ndcgAtK(retrievedSessionIds, entry.answer_session_ids, 10);

    const result: QuestionResult = {
      questionId: entry.question_id,
      questionType: entry.question_type,
      question: entry.question,
      recall5,
      recall10,
      ndcg5,
      ndcg10,
      latencyMs: Math.round(latencyMs),
      answerSessionIds: entry.answer_session_ids,
      retrievedSessionIds: retrievedSessionIds.slice(0, 10),
    };

    results.push(result);
    if (!byType[entry.question_type]) byType[entry.question_type] = [];
    byType[entry.question_type].push(result);

    if (verbose) {
      const status = recall5 >= 1 ? 'HIT' : 'MISS';
      console.error(`  [${status}] R@5=${recall5} R@10=${recall10} ${latencyMs.toFixed(0)}ms`);
      if (recall5 < 1) {
        console.error(`  Expected sessions: ${entry.answer_session_ids.join(', ')}`);
        console.error(`  Retrieved: ${retrievedSessionIds.slice(0, 5).join(', ')}`);
      }
    }

    // Cleanup. On Windows LanceDB can hold file handles on the
    // chunks table even after Storage falls out of scope, and the
    // synchronous rmSync will block indefinitely waiting for the
    // lock. Use async fs.rm with a 3-second timeout race -- if it
    // can't clean up in 3s, leak the temp dir and move on. The OS
    // will reclaim %TEMP% eventually.
    if (qi === 0) console.error(`  cleanup...`);
    const cleanupStart = performance.now();
    try {
      await Promise.race([
        fsRm(benchDir, { recursive: true, force: true }),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`cleanup timeout`)), 3_000),
        ),
      ]);
    } catch {
      // Couldn't clean up in 3s. Don't block the run -- temp dir
      // accumulation is annoying but not fatal for a bench.
    }
    if (qi === 0) console.error(`  cleanup done in ${(performance.now() - cleanupStart).toFixed(0)}ms`);

    // Periodic progress so the run doesn't go silent for 50 questions
    // at a stretch (the qi % 50 == 0 line at the top of the loop only
    // fires on entry, before search). After every question, in non-
    // verbose mode, emit one tight progress line.
    if (!verbose && (qi + 1) % 10 === 0) {
      const elapsed = (performance.now() - benchStart) / 1000;
      const rate = (qi + 1) / elapsed;
      const eta = (dataset.length - qi - 1) / rate;
      console.error(`progress [${qi + 1}/${dataset.length}] ${rate.toFixed(2)} q/s — ETA ${(eta / 60).toFixed(1)}min`);
    }
  }

  // ── Results ─────────────────────────────────────────────────────

  console.log();
  console.log('='.repeat(76));
  console.log('LONGMEMEVAL BENCHMARK RESULTS');
  console.log('='.repeat(76));
  console.log();

  // Per-type breakdown
  console.log('Per-category:');
  for (const [type, typeResults] of Object.entries(byType).sort((a, b) => a[0].localeCompare(b[0]))) {
    const r5 = typeResults.reduce((s, r) => s + r.recall5, 0) / typeResults.length;
    const r10 = typeResults.reduce((s, r) => s + r.recall10, 0) / typeResults.length;
    const ndcg = typeResults.reduce((s, r) => s + r.ndcg10, 0) / typeResults.length;
    const avgMs = typeResults.reduce((s, r) => s + r.latencyMs, 0) / typeResults.length;
    console.log(`  ${type.padEnd(30)} R@5=${(r5 * 100).toFixed(1).padStart(5)}%  R@10=${(r10 * 100).toFixed(1).padStart(5)}%  NDCG@10=${ndcg.toFixed(3)}  avg=${avgMs.toFixed(0).padStart(5)}ms  n=${typeResults.length}`);
  }

  console.log();

  // Overall
  const avgR5 = results.reduce((s, r) => s + r.recall5, 0) / results.length;
  const avgR10 = results.reduce((s, r) => s + r.recall10, 0) / results.length;
  const avgNDCG5 = results.reduce((s, r) => s + r.ndcg5, 0) / results.length;
  const avgNDCG10 = results.reduce((s, r) => s + r.ndcg10, 0) / results.length;
  const avgLatency = results.reduce((s, r) => s + r.latencyMs, 0) / results.length;
  const hits5 = results.filter(r => r.recall5 >= 1).length;
  const hits10 = results.filter(r => r.recall10 >= 1).length;

  console.log('-'.repeat(76));
  console.log(`  OVERALL                        R@5=${(avgR5 * 100).toFixed(1)}% (${hits5}/${results.length})  R@10=${(avgR10 * 100).toFixed(1)}% (${hits10}/${results.length})`);
  console.log(`                                 NDCG@5=${avgNDCG5.toFixed(3)}  NDCG@10=${avgNDCG10.toFixed(3)}`);
  console.log(`  Latency                        avg=${avgLatency.toFixed(0)}ms`);
  console.log(`  LLM rerank                     ${useRerank && isLlmAvailable() ? 'enabled' : 'disabled'}`);
  console.log(`  Embedding model                ${process.env.SMART_MEMORY_EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2'}`);
  if (excludedCount > 0) {
    console.log(`  Excluded questions             ${excludedCount} (no answer_session_ids in dataset; not scored)`);
  }
  console.log();

  // Comparison
  console.log('Comparison vs MemPalace:');
  console.log(`  MemPalace raw ChromaDB:        R@5=96.6%  (zero API)`);
  console.log(`  MemPalace hybrid v4 (held-out): R@5=98.4%  (zero API)`);
  console.log(`  MemPalace hybrid v4 + Haiku:   R@5=100%   (Haiku rerank)`);
  console.log(`  Engram (this run):             R@5=${(avgR5 * 100).toFixed(1)}%  (${useRerank ? 'with rerank' : 'zero API'})`);
  console.log();

  // ── Emit machine-readable result file ─────────────────────────
  if (emitJson) {
    const perCategory: Record<string, Record<string, unknown>> = {};
    for (const [type, typeResults] of Object.entries(byType)) {
      perCategory[type] = {
        n: typeResults.length,
        'recall@5': typeResults.reduce((s, r) => s + r.recall5, 0) / typeResults.length,
        'recall@10': typeResults.reduce((s, r) => s + r.recall10, 0) / typeResults.length,
        'ndcg@5': typeResults.reduce((s, r) => s + r.ndcg5, 0) / typeResults.length,
        'ndcg@10': typeResults.reduce((s, r) => s + r.ndcg10, 0) / typeResults.length,
        latencyMs: percentiles(typeResults.map(r => r.latencyMs)),
      };
    }

    const path = writeBenchmarkResult({
      benchmark: 'longmemeval',
      durationMs: Math.round(performance.now() - benchStart),
      config: {
        embeddingModel: process.env.SMART_MEMORY_EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2',
        useRerank: useRerank && isLlmAvailable(),
        rerankModel: useRerank && isLlmAvailable() ? (process.env.ENGRAM_MODEL ?? 'default') : null,
        questionLimit: limit ?? null,
      },
      results: {
        'recall@5': avgR5,
        'recall@10': avgR10,
        'ndcg@5': avgNDCG5,
        'ndcg@10': avgNDCG10,
        latencyMs: percentiles(results.map(r => r.latencyMs)),
        questions: results.length,
        hits5,
        hits10,
      },
      perCategory,
      // Per-question breakdown — lean shape (no full chunk content,
      // just the IDs needed to diagnose misses). Top-K retrieved
      // sessions trimmed to 10 to keep the JSON small.
      perQuestion: results.map(r => ({
        questionId: r.questionId,
        questionType: r.questionType,
        questionPreview: r.question.slice(0, 120),
        recall5: r.recall5,
        recall10: r.recall10,
        latencyMs: r.latencyMs,
        answerSessionIds: r.answerSessionIds,
        retrievedSessionIds: r.retrievedSessionIds.slice(0, 10),
      })),
    });
    console.log(`Results JSON: ${path}`);
  }
}

main().catch(err => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
