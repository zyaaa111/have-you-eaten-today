-- Supabase 初始化脚本
-- 在 Supabase SQL Editor 中执行此脚本以创建多人协作所需的数据库结构

-- 1. 创建 spaces 表
CREATE TABLE IF NOT EXISTS public.spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. 创建 profiles 表
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT now()
);

-- 3. 创建共享数据表（与本地 IndexedDB 同步）
CREATE TABLE IF NOT EXISTS public.menu_items (
  id TEXT PRIMARY KEY,
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  tags JSONB DEFAULT '[]'::jsonb,
  weight INTEGER DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  ingredients JSONB,
  steps JSONB,
  tips TEXT,
  shop TEXT,
  shop_address TEXT,
  version INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.tags (
  id TEXT PRIMARY KEY,
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT,
  version INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.combo_templates (
  id TEXT PRIMARY KEY,
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rules JSONB NOT NULL,
  is_builtin BOOLEAN DEFAULT false,
  created_at BIGINT NOT NULL,
  updated_at BIGINT,
  version INTEGER DEFAULT 1
);

-- 4. 创建 change_logs 表（变更记录）
CREATE TABLE IF NOT EXISTS public.change_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL CHECK (table_name IN ('menu_items', 'tags', 'combo_templates')),
  record_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
  before_snapshot JSONB,
  after_snapshot JSONB,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. 启用 RLS（行级安全）
ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combo_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_logs ENABLE ROW LEVEL SECURITY;

-- 6. RLS 策略：spaces
CREATE POLICY "允许读取自己所在的空间" ON public.spaces
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.space_id = spaces.id AND profiles.id = auth.uid())
  );

CREATE POLICY "允许任何人创建空间" ON public.spaces
  FOR INSERT WITH CHECK (true);

-- 7. RLS 策略：profiles
CREATE POLICY "允许读取同一空间的成员" ON public.profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles AS me WHERE me.space_id = profiles.space_id AND me.id = auth.uid())
  );

CREATE POLICY "允许用户插入自己的 profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "允许用户更新自己的 profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- 8. RLS 策略：menu_items
CREATE POLICY "允许读取同一空间的菜单" ON public.menu_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.space_id = menu_items.space_id AND profiles.id = auth.uid())
  );

CREATE POLICY "允许同一空间成员写入菜单" ON public.menu_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.space_id = menu_items.space_id AND profiles.id = auth.uid())
  );

-- 9. RLS 策略：tags
CREATE POLICY "允许读取同一空间的标签" ON public.tags
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.space_id = tags.space_id AND profiles.id = auth.uid())
  );

CREATE POLICY "允许同一空间成员写入标签" ON public.tags
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.space_id = tags.space_id AND profiles.id = auth.uid())
  );

-- 10. RLS 策略：combo_templates
CREATE POLICY "允许读取同一空间的模板" ON public.combo_templates
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.space_id = combo_templates.space_id AND profiles.id = auth.uid())
  );

CREATE POLICY "允许同一空间成员写入模板" ON public.combo_templates
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.space_id = combo_templates.space_id AND profiles.id = auth.uid())
  );

-- 11. RLS 策略：change_logs
CREATE POLICY "允许读取同一空间的变更记录" ON public.change_logs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.space_id = change_logs.space_id AND profiles.id = auth.uid())
  );

-- 12. 自动记录 change_logs 的触发器函数
CREATE OR REPLACE FUNCTION public.record_change_log()
RETURNS TRIGGER AS $$
DECLARE
  v_profile_id UUID;
  v_version INTEGER;
BEGIN
  -- 从 current_setting 获取调用者 user id（Supabase 自动设置）
  -- 优先使用 new.profile_id（如果是 insert/update），否则 old.profile_id
  IF TG_OP = 'DELETE' THEN
    v_profile_id := OLD.profile_id;
    v_version := COALESCE(OLD.version, 1);
  ELSE
    v_profile_id := NEW.profile_id;
    v_version := COALESCE(NEW.version, 1);
  END IF;

  INSERT INTO public.change_logs (
    space_id, profile_id, table_name, record_id, operation,
    before_snapshot, after_snapshot, version
  ) VALUES (
    CASE WHEN TG_OP = 'DELETE' THEN OLD.space_id ELSE NEW.space_id END,
    v_profile_id,
    TG_TABLE_NAME,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
    CASE
      WHEN TG_OP = 'INSERT' THEN 'create'
      WHEN TG_OP = 'UPDATE' THEN 'update'
      WHEN TG_OP = 'DELETE' THEN 'delete'
    END,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    v_version
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 13. 为各表创建触发器
DROP TRIGGER IF EXISTS menu_items_change_log ON public.menu_items;
CREATE TRIGGER menu_items_change_log
  AFTER INSERT OR UPDATE OR DELETE ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.record_change_log();

DROP TRIGGER IF EXISTS tags_change_log ON public.tags;
CREATE TRIGGER tags_change_log
  AFTER INSERT OR UPDATE OR DELETE ON public.tags
  FOR EACH ROW EXECUTE FUNCTION public.record_change_log();

DROP TRIGGER IF EXISTS combo_templates_change_log ON public.combo_templates;
CREATE TRIGGER combo_templates_change_log
  AFTER INSERT OR UPDATE OR DELETE ON public.combo_templates
  FOR EACH ROW EXECUTE FUNCTION public.record_change_log();

-- 14. 启用 Realtime（多人实时同步）
BEGIN;
  -- 将共享数据表加入 realtime 发布
  ALTER PUBLICATION supabase_realtime ADD TABLE public.menu_items;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tags;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.combo_templates;
COMMIT;
