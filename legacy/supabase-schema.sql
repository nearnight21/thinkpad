-- ============================================================
-- ThinkPad · 个人学习思考记录系统
-- 在 Supabase SQL Editor 中运行此脚本
-- ============================================================

-- 1. 创建 entries 表
CREATE TABLE IF NOT EXISTS entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL DEFAULT '',
    tags        TEXT[] DEFAULT ARRAY[]::TEXT[],
    type        TEXT NOT NULL DEFAULT 'note'
                CHECK (type IN ('note', 'thought', 'question', 'link', 'code')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. 索引
CREATE INDEX IF NOT EXISTS idx_entries_user_id ON entries(user_id);
CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_tags ON entries USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);

-- 3. updated_at 自动更新触发器
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS entries_updated_at ON entries;
CREATE TRIGGER entries_updated_at
    BEFORE UPDATE ON entries
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- 4. 启用 RLS
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;

-- 5. RLS 策略
DROP POLICY IF EXISTS "Users can read own entries" ON entries;
CREATE POLICY "Users can read own entries"
    ON entries FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own entries" ON entries;
CREATE POLICY "Users can insert own entries"
    ON entries FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own entries" ON entries;
CREATE POLICY "Users can update own entries"
    ON entries FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own entries" ON entries;
CREATE POLICY "Users can delete own entries"
    ON entries FOR DELETE
    USING (auth.uid() = user_id);

-- 6. 归档支持
ALTER TABLE entries ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_entries_archived ON entries(user_id, archived);

-- 7. user_id 触发器：自动填充当前用户 ID（兜底）
CREATE OR REPLACE FUNCTION set_user_id()
RETURNS TRIGGER AS $$
BEGIN
    NEW.user_id = auth.uid();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS entries_set_user_id ON entries;
CREATE TRIGGER entries_set_user_id
    BEFORE INSERT ON entries
    FOR EACH ROW EXECUTE FUNCTION set_user_id();
