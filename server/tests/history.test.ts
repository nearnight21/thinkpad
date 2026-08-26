import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('历史迁移包含基线、唯一版本号和回收站约束', async () => {
  const sql = await readFile(new URL('../migrations/002_revisions.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS thinkpad\.entry_revisions/);
  assert.match(sql, /UNIQUE \(entry_id, revision_no\)/);
  assert.match(sql, /current_revision_id/);
  assert.match(sql, /deleted_at/);
  assert.match(sql, /启用历史时的基线/);
});

test('服务端提供历史、恢复、置顶和软删除接口', async () => {
  const source = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
  assert.match(source, /\/api\/entries\/:id\/revisions/);
  assert.match(source, /\/api\/entries\/:id\/revisions\/:revisionId\/restore/);
  assert.match(source, /deleted_at = now\(\)/);
  assert.match(source, /body\.pinned/);
  assert.match(source, /entry_conflict/);
});

test('历史入口使用稳定图标并提供 GitHub 风格逐行差异', async () => {
  const source = await readFile(new URL('../../web/app.html', import.meta.url), 'utf8');
  assert.match(source, /class="history-glyph"/);
  assert.match(source, /diff-add/);
  assert.match(source, /diff-del/);
  assert.match(source, /buildDiffRows/);
});
