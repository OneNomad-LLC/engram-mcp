# Architecture Debt

Living ledger of known shortcuts in Engram's architecture. Each entry
captures the choice, why we made it, what hurts today (or what *will*
hurt), and the trigger that should make us revisit. The point is not
to fix everything — it's to make the choices visible so we don't
rediscover them under pressure.

Add new entries at the bottom. When closing one out, leave the entry
in place with a `## Resolved (YYYY-MM-DD)` heading and a one-line note
on what shipped — the historical record is more useful than a clean
slate.

---

## DEBT-001 — No tenant isolation in storage

**Where:** `src/storage.ts`, LanceDB collection layout, all retrieval
paths.

**Choice:** Engram runs single-user / single-process. Memories are
keyed by user only via the calling client; there's no DB-layer
enforcement that one user cannot read another user's rows.

**Why:** The product today is a personal MCP server installed locally;
there is no second user on the box. Adding RLS / row-level isolation
costs real complexity and would have slowed the LoCoMo benchmark loop
that was the priority for this segment.

**What hurts:** The moment Engram Cloud lands (or anyone deploys this
multi-tenant), every retrieval call becomes a leak vector. The same
pattern Cortex needs (Postgres RLS keyed off
`current_setting('app.user_id')`) applies here.

**Revisit when:** First multi-user deployment is on the roadmap, or
Cortex's RLS work lands and we want to share the pattern.

**Pattern reference:** Engram architecture-patterns §1, Cortex
architecture-patterns §1.

---

## DEBT-002 — `engram-dossier` exists, but `engram-search` doesn't auto-route entity-shaped queries to it

**Where:** `src/search.ts` (every entity-shaped query goes straight
through the hybrid retrieval pipeline). `engram-dossier` lives in
`src/server.ts` as a separate MCP tool the caller has to invoke
explicitly.

**Choice:** The dossier surface is built and returns the right
structured snapshot (KG facts where entity is subject + referencedBy,
plus categorized memory chunks). But there's no intent classifier
that detects "what do you know about Matt" and routes the call to
`engram-dossier` ahead of `engram-search`. The agent has to know to
ask for the dossier.

**Why:** Building the classifier means a small LLM call per search
(latency + cost) or a heuristic-based router (false positives /
negatives). Both punted on so the dossier could ship without
blocking on classification.

**What hurts:** Agents that don't know about `engram-dossier` —
which is most of them, since `engram-search` is the canonical entry
point — fall back to RAG-style retrieval for entity queries.
Authoritative entity facts get retrieved as memories with relevance
scores rather than loaded as ground truth, and the model can
interpolate fields the dossier would have made authoritative.

**Revisit when:** A workload appears where the diagnostic traces
(DEBT-004) show entity-shaped queries are routinely missing the
dossier. The hook is in `src/search.ts` before the vector stage.

**Pattern reference:** Engram architecture-patterns §3.

---

## Resolved (2026-05-09) — DEBT-003: Retrieval floor calibration

**Was:** The 0.25 vector-similarity floor in `src/search.ts` was picked
empirically during benchmark tuning with no permanent test artifact
guarding against drift.

**Resolved by:** `tests/alien-query-floor.test.ts`, which runs:
1. **Vector calibration** — 20 alien queries against a single-topic
   (Pyre + Cortex) 15-chunk corpus, asserts max raw cosine similarity
   stays under 0.45 (margin of ~0.20 above the production 0.25 floor).
2. **Pipeline leak check** — full `search()` against same corpus,
   asserts no alien query produces a composite score ≥ 0.10.
3. **Control queries** — 3 corpus-topic queries assert the floor
   isn't over-tightened (real queries still return results).

A future model swap, contextual-prefix change, or embedding-dim tweak
that drifts the alien-query distribution will fail (1) and force a
deliberate re-calibration of the production floor.

**Pattern reference:** Engram architecture-patterns §2.

---

---

## DEBT-004 — Diagnostic retrieval traces ship minimal stages, replay tool not built

**Where:** `src/retrieval-trace.ts` defines the trace primitive;
`src/search.ts` records `corpusSize`, `vectorAboveFloor`,
`vectorBelowFloor`, `keywordMatches`, and `finalCount`. The
`engram-trace-recent` MCP tool surfaces them.

**Choice:** Stage instrumentation is intentionally minimal — vector
above/below floor + keyword matches + final count. The remaining
stages (bonus factors, temporal boost, time-window retrieval, KG
lookup, spreading activation) are NOT instrumented. There is no
replay tool that re-runs a saved query against the current corpus.
Traces are off by default (`ENGRAM_ENABLE_RETRIEVAL_TRACES`).

**Why:** The minimal stage set covers the most common diagnostic
question — *did the result get pulled and did it survive the floor* —
without making every retrieval call carry a 9-stage instrumentation
tax. The replay tool is a separate piece of work that needs the
full stage set first to be useful.

**What hurts:** Misses that pass the vector floor but get dropped in
later stages (e.g. bonus factors push them below the cap, or the time
window excludes them) are not visible from the trace alone — you can
see the result *wasn't returned*, but not *which stage dropped it*.

**Revisit when:** A diagnostic session needs to know which post-vector
stage dropped a candidate. Add per-stage `recordStage` calls in the
boost / window / KG / spreading-activation passes.

**Pattern reference:** Engram architecture-patterns §5.

---

## DEBT-005 — No approval / lifecycle workflow on memories

**Where:** `src/storage.ts`, `src/governance.ts` (governance covers
write-side validation but not lifecycle).

**Choice:** Every memory is immediately retrievable as soon as it's
written. There's no `experimental → approved → transactional`
lifecycle, no role-gated approval, no audit table tracking who
approved what.

**Why:** The local-first single-user deployment doesn't have a "the
agent wrote it, now an admin approves it" workflow at all — the user
is the only actor. Building the lifecycle now would be over-
engineering for the current shape.

**What hurts:** Existential blocker for any regulated-vertical
deployment (legal, finance, healthcare, anything SOC 2 / HIPAA / SOX-
adjacent). They will not deploy without a legal audit trail of who
approved what.

**Revisit when:** First regulated-vertical customer is in the
pipeline, OR Engram Cloud's enterprise tier ships.

**Pattern reference:** Engram architecture-patterns §4.

---

## DEBT-006 — No write-time isolation validator on KG edges

**Where:** `src/knowledge-graph.ts` (edge writes don't validate that
both endpoints are in the same isolation scope).

**Choice:** Today every edge write succeeds as long as both nodes
exist. There's no check that the two nodes belong to the same tenant
/ workspace / scope.

**Why:** With single-user storage (DEBT-001), there's only one scope,
so the check is a no-op. Building it now would be guarding against a
boundary that doesn't exist yet.

**What hurts:** As soon as DEBT-001 closes, every cross-scope edge
becomes a silent isolation leak. Query-time filters fail open; one
missed `WHERE tenant_id = ?` and data crosses boundaries. By the time
you notice, you've shown customer A's data to customer B.

**Revisit when:** DEBT-001 closes, AT THE SAME TIME — these two are
linked. Don't ship multi-tenant storage without the write-time
validator.

**Pattern reference:** Engram architecture-patterns §6.

---

## DEBT-007 — No audit events with trace IDs on mutations

**Where:** `src/storage.ts`, every write path
(`engram-ingest`, `engram-update-metadata`, `engram-kg-add`, etc.).

**Choice:** Writes succeed (or fail), but no separate audit event is
emitted with actor + scope + before/after diff + trace ID linking back
to the originating MCP call.

**Why:** Single-user means there's only one actor; the existing
governance log captures enough for the local case.

**What hurts:** Multi-tenant deployments need this for compliance
(who modified what, when, why). It's also what feeds incident
response when something goes wrong — without trace IDs linking writes
back to the originating MCP call, root-causing a bad write requires
log correlation by hand.

**Revisit when:** Bundle with DEBT-005 (approval workflow) — the
audit table is the same table both features write to.

**Pattern reference:** Engram architecture-patterns §7.

---

## DEBT-008 — Embedding model is effectively hardcoded

**Where:** `src/storage.ts` references `Xenova/all-MiniLM-L6-v2` (384-
dim) as the embedding model.

**Choice:** A single embedding model ships with Engram. Swapping it
requires re-embedding the entire corpus and changing the dim
constant.

**Why:** MiniLM-L6-v2 is the right default — small (23MB), runs on
CPU, scores 92% R@10 on LoCoMo. Multi-model support adds config
complexity and a corpus migration story.

**What hurts:** Specialized domains (code search, legal text, medical
text) benefit from domain-specific embeddings, and we can't offer
that today. Larger-context embeddings (768-dim or 1536-dim) need a
new collection.

**Revisit when:** A specific customer or domain shows measurable
benefit from a different model — i.e. don't speculatively
generalize, wait for the pull.

---

## DEBT-009 — No reranker (intentional, but track the trade-off)

**Where:** `src/reranker.ts` exists as a stub — Engram intentionally
ships without an LLM reranker.

**Choice:** Per `docs/benchmark-optimization.md`, LLM reranking was
*actively harmful* on this pipeline against LoCoMo. We left the file
in place so it's easy to bring back, but no rerank runs in production.

**Why:** Cost (LLM call per query), latency (~500-2000ms), and the
benchmark says it doesn't help — adding it would make the system
slower, more expensive, and worse on the dataset we measure on.

**What hurts:** This is a *non-debt* entry — it's here so future-us
doesn't add a reranker reflexively. The cost is that some kinds of
retrieval (very long candidate lists, cross-language matching) might
benefit from a reranker even if LoCoMo doesn't show it.

**Revisit when:** A workload appears where the benchmark numbers
diverge from customer-reported quality, AND the diagnostic traces
(DEBT-004) show the candidates were correct but the ranking was
wrong. Both conditions matter.

---

## How to add an entry

Pick the next `DEBT-NNN` number. Stick to this skeleton:

```
## DEBT-NNN — One-line title

**Where:** file path / module.
**Choice:** what we did.
**Why:** what trade-off we accepted.
**What hurts:** what this costs us today / what it will cost.
**Revisit when:** the trigger that should make us revisit.
**Pattern reference:** (optional) link to architecture pattern note.
```

Resist the urge to write "we should fix this later" as a closing
line. Every entry that survives in the ledger is one we explicitly
chose not to fix today; that's the whole point of the file.
