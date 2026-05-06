-- Add admin role to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin'));

-- Site configuration table (pricing, feature flags, etc.)
CREATE TABLE IF NOT EXISTS public.site_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insert default pricing configuration
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

-- Analytics events table
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
  ON public.analytics_events FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can view analytics"
  ON public.analytics_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ));

ALTER TABLE public.site_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read site config"
  ON public.site_config FOR SELECT
  USING (true);

CREATE POLICY "Admins can update site config"
  ON public.site_config FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ));
