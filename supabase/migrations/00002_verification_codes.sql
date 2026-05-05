-- Verification codes for phone SMS login
CREATE TABLE IF NOT EXISTS public.verification_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL,
  code        TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookup by phone (rate limiting + code verification)
CREATE INDEX IF NOT EXISTS idx_verification_codes_phone
  ON public.verification_codes (phone, created_at DESC);

-- Index for cleanup of expired codes
CREATE INDEX IF NOT EXISTS idx_verification_codes_expires
  ON public.verification_codes (expires_at)
  WHERE used = false;

ALTER TABLE public.verification_codes ENABLE ROW LEVEL SECURITY;
