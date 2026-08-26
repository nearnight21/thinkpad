ALTER TABLE thinkpad.entries
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_revision_id UUID,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS thinkpad.entry_revisions (
    id UUID PRIMARY KEY,
    entry_id UUID NOT NULL REFERENCES thinkpad.entries(id) ON DELETE CASCADE,
    revision_no INTEGER NOT NULL CHECK (revision_no > 0),
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    type TEXT NOT NULL DEFAULT 'note'
        CHECK (type IN ('note', 'thought', 'question', 'link', 'code')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    change_message TEXT,
    restored_from_revision_id UUID,
    UNIQUE (entry_id, revision_no),
    UNIQUE (entry_id, id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'revisions_restored_same_entry'
  ) THEN
    ALTER TABLE thinkpad.entry_revisions
      ADD CONSTRAINT revisions_restored_same_entry
      FOREIGN KEY (entry_id, restored_from_revision_id)
      REFERENCES thinkpad.entry_revisions(entry_id, id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'entries_archived_not_pinned'
  ) THEN
    ALTER TABLE thinkpad.entries
      ADD CONSTRAINT entries_archived_not_pinned
      CHECK (NOT archived OR pinned_at IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS thinkpad_entries_user_pin_created
    ON thinkpad.entries(user_id, pinned_at DESC NULLS LAST, created_at DESC, id DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS thinkpad_revisions_entry_created
    ON thinkpad.entry_revisions(entry_id, revision_no DESC);

INSERT INTO thinkpad.entry_revisions(
    id, entry_id, revision_no, title, content, tags, type, created_at, change_message
)
SELECT
    md5(e.id::text || ':baseline')::uuid,
    e.id,
    1,
    e.title,
    e.content,
    e.tags,
    e.type,
    e.updated_at,
    '启用历史时的基线'
FROM thinkpad.entries e
WHERE NOT EXISTS (
    SELECT 1 FROM thinkpad.entry_revisions r WHERE r.entry_id = e.id
);

DROP TRIGGER IF EXISTS entries_touch_updated_at ON thinkpad.entries;

UPDATE thinkpad.entries e
SET current_revision_id = r.id
FROM thinkpad.entry_revisions r
WHERE r.entry_id = e.id
  AND r.revision_no = 1
  AND e.current_revision_id IS NULL;

ALTER TABLE thinkpad.entries
  ALTER COLUMN current_revision_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'entries_current_revision_same_entry'
  ) THEN
    ALTER TABLE thinkpad.entries
      ADD CONSTRAINT entries_current_revision_same_entry
      FOREIGN KEY (id, current_revision_id)
      REFERENCES thinkpad.entry_revisions(entry_id, id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE TRIGGER entries_touch_updated_at
    BEFORE UPDATE ON thinkpad.entries
    FOR EACH ROW EXECUTE FUNCTION thinkpad.touch_updated_at();
