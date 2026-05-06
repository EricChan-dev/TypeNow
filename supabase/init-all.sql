-- ============================================================
-- TypeNow 数据库初始化 SQL（合并 5 个迁移文件）
-- 在 Supabase SQL Editor 中全选执行即可
-- ============================================================

-- ============================================================
-- 1. 用户表 + 触发器
-- ============================================================
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

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- ============================================================
-- 2. 句子库
-- ============================================================
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

-- ============================================================
-- 3. 练习记录
-- ============================================================
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

-- ============================================================
-- 4. 智能复习队列
-- ============================================================
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

-- ============================================================
-- 5. AI 强化记录
-- ============================================================
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

-- ============================================================
-- 6. 写作记录
-- ============================================================
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

-- ============================================================
-- 7. 短信验证码
-- ============================================================
CREATE TABLE IF NOT EXISTS public.verification_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL,
  code        TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verification_codes_phone
  ON public.verification_codes (phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_verification_codes_expires
  ON public.verification_codes (expires_at) WHERE used = false;

ALTER TABLE public.verification_codes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 8. 微信字段 + 角色字段（合并迁移 00003 + 00005）
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS wechat_openid  TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS wechat_unionid TEXT,
  ADD COLUMN IF NOT EXISTS role          TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin'));

CREATE INDEX IF NOT EXISTS idx_profiles_wechat_openid
  ON public.profiles (wechat_openid) WHERE wechat_openid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_wechat_unionid
  ON public.profiles (wechat_unionid) WHERE wechat_unionid IS NOT NULL;

-- ============================================================
-- 9. 新用户自动创建 profile 的触发器（最终版，含微信字段）
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, phone, name, avatar, wechat_openid, wechat_unionid)
  VALUES (
    new.id,
    new.phone,
    new.raw_user_meta_data->>'name',
    new.raw_user_meta_data->>'avatar',
    new.raw_user_meta_data->>'wechat_openid',
    new.raw_user_meta_data->>'wechat_unionid'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 10. 支付订单表
-- ============================================================
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

CREATE INDEX IF NOT EXISTS idx_payment_orders_user_id
  ON public.payment_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_out_trade_no
  ON public.payment_orders (out_trade_no);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status
  ON public.payment_orders (status) WHERE status = 'pending';

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own payment orders"
  ON public.payment_orders FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to payment_orders"
  ON public.payment_orders FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================
-- 11. 订阅表
-- ============================================================
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

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id
  ON public.subscriptions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_expires
  ON public.subscriptions (expires_at) WHERE status = 'active';

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscriptions"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own subscriptions"
  ON public.subscriptions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to subscriptions"
  ON public.subscriptions FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================
-- 12. 站点配置表（定价等）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.site_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.site_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read site config"
  ON public.site_config FOR SELECT USING (true);

CREATE POLICY "Admins can update site config"
  ON public.site_config FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ));

-- 默认定价数据
INSERT INTO public.site_config (key, value) VALUES ('pricing', '{
  "plans": {
    "free": {
      "name": "普通会员",
      "price": 0,
      "period": "永久免费",
      "description": "快速上手，体验核心打字练习功能",
      "features": [
        "每天 30 句打字练习",
        "2 个开放场景",
        "最近 50 个错误智能复习",
        "每周 2 次 AI 强化",
        "基础学习统计"
      ],
      "ctaText": "免费开始",
      "variant": "neutral"
    },
    "monthly": {
      "name": "月度会员",
      "price": 29,
      "period": "/月",
      "description": "解锁全部功能，高效提升英语能力",
      "features": [
        "无限打字练习",
        "全部 6 个开放场景",
        "全部历史错误智能复习",
        "无限次 AI 强化训练",
        "深度统计 & 学习报告导出",
        "会员专属徽章"
      ],
      "ctaText": "立即订阅",
      "variant": "emphasized"
    },
    "yearly": {
      "name": "年度会员",
      "price": 199,
      "period": "/年",
      "originalPrice": "¥348",
      "subPeriod": "≈ ¥16.6/月",
      "description": "最划算的选择，解锁全部功能",
      "features": [
        "无限打字练习",
        "全部 6 个开放场景",
        "全部历史错误智能复习",
        "无限次 AI 强化训练",
        "深度统计 & 学习报告导出",
        "会员专属徽章"
      ],
      "ctaText": "立即订阅",
      "variant": "prominent",
      "badge": "推荐",
      "saveBadge": "省 ¥149"
    }
  }
}')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 13. 埋点事件表
-- ============================================================
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  properties JSONB DEFAULT '{}',
  page_url TEXT,
  session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ae_type_time ON analytics_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ae_user ON analytics_events(user_id, created_at DESC);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can insert analytics events"
  ON public.analytics_events FOR INSERT WITH CHECK (true);

CREATE POLICY "Admins can view analytics"
  ON public.analytics_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ));

-- ============================================================
-- 完成！共创建 12 张表
-- ============================================================
