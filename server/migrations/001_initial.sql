CREATE SCHEMA IF NOT EXISTS thinkpad;

CREATE TABLE IF NOT EXISTS thinkpad.users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS thinkpad_users_email_unique
    ON thinkpad.users (lower(email));

CREATE TABLE IF NOT EXISTS thinkpad.sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES thinkpad.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS thinkpad_sessions_user_id
    ON thinkpad.sessions(user_id);
CREATE INDEX IF NOT EXISTS thinkpad_sessions_expires_at
    ON thinkpad.sessions(expires_at);

CREATE TABLE IF NOT EXISTS thinkpad.invitations (
    code_hash CHAR(64) PRIMARY KEY,
    created_by UUID NOT NULL REFERENCES thinkpad.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
    use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0)
);

CREATE TABLE IF NOT EXISTS thinkpad.entries (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES thinkpad.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    type TEXT NOT NULL DEFAULT 'note'
        CHECK (type IN ('note', 'thought', 'question', 'link', 'code')),
    archived BOOLEAN NOT NULL DEFAULT false,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS thinkpad_entries_user_created
    ON thinkpad.entries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS thinkpad_entries_user_archived
    ON thinkpad.entries(user_id, archived);
CREATE INDEX IF NOT EXISTS thinkpad_entries_tags
    ON thinkpad.entries USING GIN(tags);
CREATE INDEX IF NOT EXISTS thinkpad_entries_type
    ON thinkpad.entries(user_id, type);

CREATE TABLE IF NOT EXISTS thinkpad.media_migrations (
    old_url_hash CHAR(64) PRIMARY KEY,
    old_url TEXT NOT NULL,
    new_key TEXT NOT NULL,
    content_sha256 CHAR(64) NOT NULL,
    migrated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION thinkpad.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_touch_updated_at ON thinkpad.users;
CREATE TRIGGER users_touch_updated_at
    BEFORE UPDATE ON thinkpad.users
    FOR EACH ROW EXECUTE FUNCTION thinkpad.touch_updated_at();

DROP TRIGGER IF EXISTS entries_touch_updated_at ON thinkpad.entries;
CREATE TRIGGER entries_touch_updated_at
    BEFORE UPDATE ON thinkpad.entries
    FOR EACH ROW EXECUTE FUNCTION thinkpad.touch_updated_at();
