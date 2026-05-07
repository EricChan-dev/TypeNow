-- Sentence knowledge cache: store LLM analysis results keyed by sentence hash

CREATE TABLE IF NOT EXISTS sentence_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sentence_hash TEXT NOT NULL UNIQUE,
  sentence_text TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sentence_knowledge_hash ON sentence_knowledge(sentence_hash);
