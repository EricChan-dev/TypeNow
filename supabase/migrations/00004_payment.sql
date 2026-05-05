-- Payment orders: track individual WeChat Pay payment attempts
CREATE TABLE IF NOT EXISTS public.payment_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan            TEXT NOT NULL CHECK (plan IN ('monthly', 'yearly')),
  amount          INTEGER NOT NULL,
  out_trade_no    TEXT UNIQUE NOT NULL,
  transaction_id  TEXT,
  code_url        TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'paid', 'expired', 'cancelled')),
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  expires_at      TIMESTAMPTZ
);

-- Subscriptions: track active/cancelled/expired member subscriptions
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan            TEXT NOT NULL CHECK (plan IN ('monthly', 'yearly')),
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'cancelled', 'expired')),
  payment_order_id UUID REFERENCES public.payment_orders(id) ON DELETE SET NULL,
  starts_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  cancelled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payment_orders_user_id
  ON public.payment_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_out_trade_no
  ON public.payment_orders (out_trade_no);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status
  ON public.payment_orders (status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id
  ON public.subscriptions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_expires
  ON public.subscriptions (expires_at) WHERE status = 'active';

-- RLS
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own payment orders"
  ON public.payment_orders FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own subscriptions"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own subscriptions"
  ON public.subscriptions FOR UPDATE
  USING (auth.uid() = user_id);

-- Allow service role full access (for notify webhook and server-side ops)
CREATE POLICY "Service role full access to payment_orders"
  ON public.payment_orders FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access to subscriptions"
  ON public.subscriptions FOR ALL
  USING (true)
  WITH CHECK (true);
