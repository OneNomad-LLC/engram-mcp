-- 002_indexes.sql — Hot-path indexes for multi-tenant Engram.
--
-- Each tenant typically has hundreds-to-millions of rows, so every
-- query is (tenant_id, ...) keyed. Indexes lead with tenant_id.

-- Chunks: scoped recency scans + vector search.
CREATE INDEX IF NOT EXISTS chunks_tenant_created_idx
  ON chunks (tenant_id, created_at DESC);

-- IVFFlat for cosine-distance ANN. lists=100 is a sane default for
-- < 1M rows per tenant; bump to lists=sqrt(rows) for larger tenants.
-- Index is built lazily — fine to create on an empty table.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'chunks_embedding_ivfflat_idx'
  ) THEN
    EXECUTE 'CREATE INDEX chunks_embedding_ivfflat_idx
             ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)';
  END IF;
END$$;

-- Knowledge triples: subject-keyed lookups dominate (queryTriples,
-- getTripleTimeline). Tenant + subject covers it; tenant + object
-- handles the timeline's OR branch.
CREATE INDEX IF NOT EXISTS knowledge_triples_tenant_subject_idx
  ON knowledge_triples (tenant_id, subject);
CREATE INDEX IF NOT EXISTS knowledge_triples_tenant_object_idx
  ON knowledge_triples (tenant_id, object);

-- Diary: date-range reads.
CREATE INDEX IF NOT EXISTS diary_entries_tenant_date_idx
  ON diary_entries (tenant_id, date DESC);

-- Handoffs: newest-first.
CREATE INDEX IF NOT EXISTS handoffs_tenant_created_idx
  ON handoffs (tenant_id, created_at DESC);

-- Daily logs: date-range reads.
CREATE INDEX IF NOT EXISTS daily_logs_tenant_date_idx
  ON daily_logs (tenant_id, date DESC);

-- Rules: tenant lookup.
CREATE INDEX IF NOT EXISTS rules_tenant_idx
  ON rules (tenant_id);
