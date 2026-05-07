-- TTS audio cache: store Youdao TTS results keyed by text + voice + speed + volume

CREATE TABLE IF NOT EXISTS tts_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT NOT NULL UNIQUE,
  text TEXT NOT NULL,
  voice_name TEXT NOT NULL,
  audio_data TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tts_cache_key ON tts_cache(cache_key);
