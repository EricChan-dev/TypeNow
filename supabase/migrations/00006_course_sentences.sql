-- Course sentences: link sentences to lessons and add word-level detail

-- Add lesson_id to link sentences to course lessons
ALTER TABLE sentences ADD COLUMN IF NOT EXISTS lesson_id TEXT;

-- Word-level data: phonetic, part of speech, per-word Chinese translation
ALTER TABLE sentences ADD COLUMN IF NOT EXISTS words JSONB;

-- Index for lesson-based queries
CREATE INDEX IF NOT EXISTS idx_sentences_lesson_id ON sentences(lesson_id);
