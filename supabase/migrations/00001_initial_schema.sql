-- Initial schema for TypeNow

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone       TEXT UNIQUE,
  name        TEXT,
  avatar      TEXT,
  level       INTEGER DEFAULT 1,
  total_score INTEGER DEFAULT 0,
  is_pro      BOOLEAN DEFAULT false,
  pro_expires TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Trigger to create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, phone, name, avatar)
  VALUES (new.id, new.phone, new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'avatar');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Sentences table
CREATE TABLE IF NOT EXISTS public.sentences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chinese     TEXT NOT NULL,
  english     TEXT NOT NULL,
  words_count INTEGER,
  category    TEXT,
  difficulty  INTEGER DEFAULT 1,
  tags        TEXT[],
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.sentences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sentences are readable by all"
  ON public.sentences FOR SELECT
  USING (true);

-- Practice records
CREATE TABLE IF NOT EXISTS public.practice_records (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  sentence_id UUID REFERENCES public.sentences(id) ON DELETE SET NULL,
  user_input  TEXT,
  score       INTEGER,
  mistakes    INTEGER DEFAULT 0,
  is_review   BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.practice_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own practice records"
  ON public.practice_records FOR ALL
  USING (auth.uid() = user_id);

-- Review queue
CREATE TABLE IF NOT EXISTS public.review_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  sentence_id     UUID REFERENCES public.sentences(id) ON DELETE SET NULL,
  user_wrong      TEXT,
  review_count    INTEGER DEFAULT 0,
  consecutive_ok  INTEGER DEFAULT 0,
  next_review_at  TIMESTAMPTZ,
  status          TEXT DEFAULT 'pending',
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.review_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own review queue"
  ON public.review_queue FOR ALL
  USING (auth.uid() = user_id);

-- Strengthen sessions
CREATE TABLE IF NOT EXISTS public.strengthen_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type        TEXT,
  analysis    JSONB,
  content     JSONB,
  result      JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.strengthen_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own strengthen sessions"
  ON public.strengthen_sessions FOR ALL
  USING (auth.uid() = user_id);

-- Writing entries
CREATE TABLE IF NOT EXISTS public.writing_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  topic         TEXT,
  original_text TEXT,
  ai_report     JSONB,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.writing_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own writing entries"
  ON public.writing_entries FOR ALL
  USING (auth.uid() = user_id);
