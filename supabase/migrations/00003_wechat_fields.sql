-- Add WeChat fields to profiles table
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS wechat_openid  TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS wechat_unionid TEXT;

-- Partial indexes for WeChat lookups
CREATE INDEX IF NOT EXISTS idx_profiles_wechat_openid
  ON public.profiles (wechat_openid)
  WHERE wechat_openid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_wechat_unionid
  ON public.profiles (wechat_unionid)
  WHERE wechat_unionid IS NOT NULL;

-- Update the handle_new_user trigger to include WeChat fields
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (
    id, phone, name, avatar, wechat_openid, wechat_unionid
  )
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
