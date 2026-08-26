SELECT json_build_object(
    'users', (SELECT count(*) FROM thinkpad.users),
    'entries', (SELECT count(*) FROM thinkpad.entries),
    'media', (SELECT count(*) FROM thinkpad.media_migrations),
    'legacy_image_urls', (
        SELECT count(*) FROM thinkpad.entries
        WHERE position('personandb-upload.xiaobai1423.workers.dev' IN content) > 0
    ),
    'stable_image_entries', (
        SELECT count(*) FROM thinkpad.entries
        WHERE position('/thinkpad/api/media/' IN content) > 0
    )
);
