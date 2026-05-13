-- 001_init.sql — Engram postgres schema (multi-tenant).
--
-- Tenancy: every row carries tenant_id; every adapter query is
-- WHERE tenant_id = $1.
--
-- Embeddings: pgvector 384-dim by default (matches the local
-- MiniLM-384 model Engram ships with). If you swap the embedding
-- model later, run ALTER TABLE chunks ALTER COLUMN embedding TYPE
-- vector(N) and re-embed.

CREATE EXTENSION IF NOT EXISTS vector;

-- ── Chunks ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chunks (
  id         uuid PRIMARY KEY,
  tenant_id  text NOT NULL,
  embedding  vector(384),
  domain     text NOT NULL DEFAULT '',
  content    text NOT NULL,
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- ── Daily logs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_logs (
  id         bigserial PRIMARY KEY,
  date       date NOT NULL,
  tenant_id  text NOT NULL,
  entry      jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- ── Procedural rules ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rules (
  id         uuid PRIMARY KEY,
  tenant_id  text NOT NULL,
  rule       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- ── Knowledge triples ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_triples (
  id             uuid PRIMARY KEY,
  tenant_id      text NOT NULL,
  subject        text NOT NULL,
  predicate      text NOT NULL,
  object         text NOT NULL,
  source_id      text,
  invalidated_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT NOW()
);

-- ── Diary entries ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS diary_entries (
  id         bigserial PRIMARY KEY,
  date       date NOT NULL,
  tenant_id  text NOT NULL,
  agent      text NOT NULL DEFAULT 'claude',
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- ── Handoffs ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS handoffs (
  id           uuid PRIMARY KEY,
  tenant_id    text NOT NULL,
  content_json jsonb NOT NULL,
  content_md   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT NOW()
);
