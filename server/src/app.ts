import { Readable } from 'node:stream';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { ThinkPadConfig } from './config.ts';
import type { DatabasePool } from './database.ts';
import { createSession, currentUser, revokeSession, type AuthenticatedUser } from './auth.ts';
import { ThinkPadCos } from './cos.ts';
import {
  clearedSessionCookie,
  hashPassword,
  needsPasswordUpgrade,
  newId,
  newOpaqueToken,
  normalizeEmail,
  sha256,
  verifyPassword,
} from './security.ts';

interface AppOptions {
  config: ThinkPadConfig;
  pool: DatabasePool;
  cos?: ThinkPadCos;
}

type JsonObject = Record<string, unknown>;

const ENTRY_TYPES = new Set(['note', 'thought', 'question', 'link', 'code']);
const IMAGE_TYPES: Record<string, string> = {
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function objectBody(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result.length <= max ? result : null;
}

function cleanTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const tags = value.map((tag) => typeof tag === 'string' ? tag.trim() : '');
  if (tags.some((tag) => !tag || tag.length > 80)) return null;
  return [...new Set(tags)];
}

async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
  pool: DatabasePool,
): Promise<AuthenticatedUser | null> {
  const user = await currentUser(request, pool);
  if (!user) {
    await reply.code(401).send({ error: '请先登录。', code: 'auth_required' });
    return null;
  }
  return user;
}

function publicUser(user: AuthenticatedUser): { id: string; email: string } {
  return { id: user.id, email: user.email };
}

function mediaUrl(basePath: string, key: string): string {
  const path = key.split('/').map(encodeURIComponent).join('/');
  return `${basePath}/api/media/${path}`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function sameTags(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const leftTags = left.map(String).sort();
  const rightTags = right.map(String).sort();
  return leftTags.every((tag, index) => tag === rightTags[index]);
}

function sameEntryContent(entry: Record<string, unknown>, next: { title: string; content: string; tags: string[]; type: string }): boolean {
  return entry.title === next.title && entry.content === next.content
    && sameTags(entry.tags, next.tags) && entry.type === next.type;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === '23505');
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { config, pool } = options;
  const cos = options.cos ?? new ThinkPadCos({
    bucket: config.cosBucket,
    region: config.cosRegion,
    secretId: config.cosSecretId,
    secretKey: config.cosSecretKey,
  });
  const app = Fastify({
    logger: true,
    bodyLimit: 128 * 1024,
    trustProxy: true,
  });

  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) => request.ip,
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
    const origin = request.headers.origin;
    if (origin !== config.siteOrigin) {
      await reply.code(403).send({ error: '请求来源无效。', code: 'invalid_origin' });
    }
  });

  app.get('/health', async () => ({ ok: true }));

  app.get('/api/session', async (request) => {
    const user = await currentUser(request, pool);
    return { session: user ? { user: publicUser(user) } : null };
  });

  app.post('/api/login', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const body = objectBody(request.body);
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password || password.length > 512) {
      return reply.code(400).send({ error: '邮箱或密码格式不正确。', code: 'invalid_credentials' });
    }
    const result = await pool.query<AuthenticatedUser & { password_hash: string }>(
      'SELECT id, email, password_hash FROM thinkpad.users WHERE lower(email) = $1',
      [email],
    );
    const user = result.rows[0];
    if (!user || !(await verifyPassword(user.password_hash, password))) {
      return reply.code(401).send({ error: '邮箱或密码错误。', code: 'invalid_credentials' });
    }
    if (needsPasswordUpgrade(user.password_hash)) {
      const upgraded = await hashPassword(password);
      await pool.query('UPDATE thinkpad.users SET password_hash = $1 WHERE id = $2', [upgraded, user.id]);
    }
    const cookie = await createSession(pool, user.id, config.sessionDays, config.basePath);
    reply.header('Set-Cookie', cookie);
    return { session: { user: publicUser(user) } };
  });

  app.post('/api/logout', async (request, reply) => {
    await revokeSession(request, pool);
    reply.header('Set-Cookie', clearedSessionCookie(config.basePath));
    return { ok: true };
  });

  app.post('/api/register', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const body = objectBody(request.body);
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    const invitation = typeof body.invitation === 'string' ? body.invitation.trim() : '';
    if (!email || password.length < 10 || password.length > 512 || invitation.length < 16) {
      return reply.code(400).send({ error: '注册信息格式不正确。', code: 'invalid_registration' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const invite = await client.query<{ max_uses: number; use_count: number }>(
        `SELECT max_uses, use_count FROM thinkpad.invitations
          WHERE code_hash = $1 AND expires_at > now()
          FOR UPDATE`,
        [sha256(invitation)],
      );
      const row = invite.rows[0];
      if (!row || row.use_count >= row.max_uses) {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: '邀请码无效或已过期。', code: 'invalid_invitation' });
      }
      const id = newId();
      await client.query(
        'INSERT INTO thinkpad.users(id, email, password_hash) VALUES ($1, $2, $3)',
        [id, email, await hashPassword(password)],
      );
      await client.query(
        'UPDATE thinkpad.invitations SET use_count = use_count + 1 WHERE code_hash = $1',
        [sha256(invitation)],
      );
      await client.query('COMMIT');
      const user = { id, email };
      reply.header('Set-Cookie', await createSession(pool, id, config.sessionDays, config.basePath));
      return reply.code(201).send({ session: { user } });
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: '该邮箱已经注册。', code: 'email_exists' });
      }
      throw error;
    } finally {
      client.release();
    }
  });

  app.post('/api/invitations', async (request, reply) => {
    const user = await requireUser(request, reply, pool);
    if (!user) return;
    const body = objectBody(request.body);
    const days = Number(body.days ?? 7);
    const maxUses = Number(body.maxUses ?? 1);
    if (!Number.isInteger(days) || days < 1 || days > 30 || !Number.isInteger(maxUses) || maxUses < 1 || maxUses > 20) {
      return reply.code(400).send({ error: '邀请码参数无效。', code: 'invalid_invitation_options' });
    }
    const code = newOpaqueToken();
    await pool.query(
      `INSERT INTO thinkpad.invitations(code_hash, created_by, expires_at, max_uses)
       VALUES ($1, $2, now() + ($3 * interval '1 day'), $4)`,
      [sha256(code), user.id, days, maxUses],
    );
    return reply.code(201).send({ invitation: code, expiresInDays: days, maxUses });
  });

  app.post('/api/change-password', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const user = await requireUser(request, reply, pool);
    if (!user) return;
    const body = objectBody(request.body);
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (newPassword.length < 10 || newPassword.length > 512) {
      return reply.code(400).send({ error: '新密码至少需要 10 个字符。', code: 'weak_password' });
    }
    const result = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM thinkpad.users WHERE id = $1',
      [user.id],
    );
    if (!result.rows[0] || !(await verifyPassword(result.rows[0].password_hash, currentPassword))) {
      return reply.code(401).send({ error: '当前密码错误。', code: 'invalid_current_password' });
    }
    await pool.query('UPDATE thinkpad.users SET password_hash = $1 WHERE id = $2', [await hashPassword(newPassword), user.id]);
    await pool.query('UPDATE thinkpad.sessions SET revoked_at = now() WHERE user_id = $1', [user.id]);
    reply.header('Set-Cookie', clearedSessionCookie(config.basePath));
    return { ok: true };
  });

  app.get('/api/entries', async (request, reply) => {
    const user = await requireUser(request, reply, pool);
    if (!user) return;
    const query = request.query as Record<string, string | undefined>;
    const page = Math.max(0, Number.parseInt(query.page ?? '0', 10) || 0);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize ?? '20', 10) || 20));
    const deleted = query.deleted === 'true';
    const values: unknown[] = [user.id];
    const conditions = ['user_id = $1'];
    if (deleted) {
      conditions.push('deleted_at IS NOT NULL');
    } else {
      conditions.push('deleted_at IS NULL');
      const archived = query.archived === 'true';
      values.push(archived);
      conditions.push(`archived = $${values.length}`);
    }
    if (query.type && ENTRY_TYPES.has(query.type)) {
      values.push(query.type);
      conditions.push(`type = $${values.length}`);
    }
    if (query.tag) {
      values.push(query.tag);
      conditions.push(`$${values.length} = ANY(tags)`);
    }
    if (query.q?.trim()) {
      values.push(`%${query.q.trim()}%`);
      conditions.push(`(title ILIKE $${values.length} OR content ILIKE $${values.length})`);
    }
    values.push(pageSize + 1, page * pageSize);
    const result = await pool.query(
      `SELECT id, user_id, title, content, tags, type, archived, archived_at,
              pinned_at, current_revision_id, deleted_at, created_at, updated_at
         FROM thinkpad.entries
         WHERE ${conditions.join(' AND ')}
        ORDER BY ${deleted ? 'deleted_at DESC' : 'pinned_at DESC NULLS LAST, created_at DESC'}, id DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return { entries: result.rows.slice(0, pageSize), hasMore: result.rows.length > pageSize };
  });

  app.get('/api/entries/archived-count', async (request, reply) => {
    const user = await requireUser(request, reply, pool);
    if (!user) return;
    const result = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM thinkpad.entries WHERE user_id = $1 AND archived = true AND deleted_at IS NULL',
      [user.id],
    );
    return { count: Number(result.rows[0]?.count ?? 0) };
  });

  app.get('/api/entries/:id/revisions', async (request, reply) => {
    const user = await requireUser(request, reply, pool);
    if (!user) return;
    const id = (request.params as { id: string }).id;
    if (!isUuid(id)) return reply.code(400).send({ error: '笔记 ID 无效。', code: 'invalid_entry_id' });
    const query = request.query as Record<string, string | undefined>;
    const page = Math.max(0, Number.parseInt(query.page ?? '0', 10) || 0);
    const pageSize = Math.min(50, Math.max(1, Number.parseInt(query.pageSize ?? '20', 10) || 20));
    const result = await pool.query(
      `SELECT r.id, r.entry_id, r.revision_no, r.title, r.content, r.tags, r.type,
              r.created_at, r.change_message, r.restored_from_revision_id,
              (r.id = e.current_revision_id) AS is_current
         FROM thinkpad.entry_revisions r
         JOIN thinkpad.entries e ON e.id = r.entry_id
        WHERE e.id = $1 AND e.user_id = $2
        ORDER BY r.revision_no DESC
        LIMIT $3 OFFSET $4`,
      [id, user.id, pageSize + 1, page * pageSize],
    );
    return { revisions: result.rows.slice(0, pageSize), hasMore: result.rows.length > pageSize };
  });

  app.get('/api/entries/:id/revisions/:revisionId', async (request, reply) => {
    const user = await requireUser(request, reply, pool);
    if (!user) return;
    const params = request.params as { id: string; revisionId: string };
    if (!isUuid(params.id) || !isUuid(params.revisionId)) {
      return reply.code(400).send({ error: '版本 ID 无效。', code: 'invalid_revision_id' });
    }
    const result = await pool.query(
      `SELECT r.id, r.entry_id, r.revision_no, r.title, r.content, r.tags, r.type,
              r.created_at, r.change_message, r.restored_from_revision_id,
              (r.id = e.current_revision_id) AS is_current
         FROM thinkpad.entry_revisions r
         JOIN thinkpad.entries e ON e.id = r.entry_id
        WHERE r.entry_id = $1 AND r.id = $2 AND e.user_id = $3`,
      [params.id, params.revisionId, user.id],
    );
    if (!result.rows[0]) return reply.code(404).send({ error: '历史版本不存在。', code: 'revision_not_found' });
    return { revision: result.rows[0] };
  });

  app.post('/api/entries/:id/revisions/:revisionId/restore', async (request, reply) => {
    const user = await requireUser(request, reply, pool);
    if (!user) return;
    const params = request.params as { id: string; revisionId: string };
    const body = objectBody(request.body);
    const baseRevisionId = typeof body.base_revision_id === 'string' ? body.base_revision_id : '';
    if (!isUuid(params.id) || !isUuid(params.revisionId) || !isUuid(baseRevisionId)) {
      return reply.code(400).send({ error: '恢复参数无效。', code: 'invalid_revision_id' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const entryResult = await client.query(
        `SELECT * FROM thinkpad.entries WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`, [params.id, user.id]);
      const entry = entryResult.rows[0] as Record<string, unknown> | undefined;
      if (!entry) { await client.query('ROLLBACK'); return reply.code(404).send({ error: '笔记不存在。', code: 'entry_not_found' }); }
      if (entry.current_revision_id !== baseRevisionId) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: '笔记已被其他设备修改。', code: 'entry_conflict', entry });
      }
      const sourceResult = await client.query(
        `SELECT id, revision_no, title, content, tags, type FROM thinkpad.entry_revisions WHERE entry_id = $1 AND id = $2`,
        [params.id, params.revisionId]);
      const source = sourceResult.rows[0];
      if (!source) { await client.query('ROLLBACK'); return reply.code(404).send({ error: '历史版本不存在。', code: 'revision_not_found' }); }
      const nextRevisionId = newId();
      const nextNoResult = await client.query<{ next_no: number }>(
        'SELECT COALESCE(MAX(revision_no), 0) + 1 AS next_no FROM thinkpad.entry_revisions WHERE entry_id = $1', [params.id]);
      const nextNo = nextNoResult.rows[0].next_no;
      await client.query(
        `INSERT INTO thinkpad.entry_revisions(id, entry_id, revision_no, title, content, tags, type, change_message, restored_from_revision_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [nextRevisionId, params.id, nextNo, source.title, source.content, source.tags, source.type, `恢复自 v${source.revision_no}`, source.id]);
      const updated = await client.query(
        `UPDATE thinkpad.entries SET title = $1, content = $2, tags = $3, type = $4, current_revision_id = $5
          WHERE id = $6 AND user_id = $7 RETURNING *`,
        [source.title, source.content, source.tags, source.type, nextRevisionId, params.id, user.id]);
      await client.query('COMMIT');
      return { entry: updated.rows[0], revision: { id: nextRevisionId, revision_no: nextNo } };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) return reply.code(409).send({ error: '版本号冲突，请重试。', code: 'revision_conflict' });
      throw error;
    } finally { client.release(); }
  });

  app.post('/api/entries', async (request, reply) => {
    const user = await requireUser(request, reply, pool);
    if (!user) return;
    const body = objectBody(request.body);
    const title = cleanString(body.title ?? '', 500);
    const content = typeof body.content === 'string' && body.content.length <= 2_000_000 ? body.content : null;
    const tags = cleanTags(body.tags ?? []);
    const type = typeof body.type === 'string' ? body.type : 'note';
    if (title === null || content === null || tags === null || !ENTRY_TYPES.has(type)) {
      return reply.code(400).send({ error: '笔记内容格式不正确。', code: 'invalid_entry' });
    }
    const entryId = newId();
    const revisionId = newId();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO thinkpad.entries(id, user_id, title, content, tags, type, current_revision_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [entryId, user.id, title, content, tags, type, revisionId],
      );
      await client.query(
        `INSERT INTO thinkpad.entry_revisions(
           id, entry_id, revision_no, title, content, tags, type, change_message
         ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7)`,
        [revisionId, entryId, title, content, tags, type, '创建笔记'],
      );
      await client.query('COMMIT');
      return reply.code(201).send({ entry: result.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.patch('/api/entries/:id', async (request, reply) => {
    const user = await requireUser(request, reply, pool);
    if (!user) return;
    const id = (request.params as { id: string }).id;
    if (!isUuid(id)) return reply.code(400).send({ error: '笔记 ID 无效。', code: 'invalid_entry_id' });
    const body = objectBody(request.body);
    const hasContentFields = ['title', 'content', 'tags', 'type'].some((field) => field in body);
    const baseRevisionId = typeof body.base_revision_id === 'string' ? body.base_revision_id : '';
    if (hasContentFields && !isUuid(baseRevisionId)) {
      return reply.code(400).send({ error: '保存操作缺少当前版本。', code: 'base_revision_required' });
    }
    let nextTitle: string | undefined;
    let nextContent: string | undefined;
    let nextTags: string[] | undefined;
    let nextType: string | undefined;
    let nextArchived: boolean | undefined;
    let nextPinnedAt: Date | null | undefined;
    if ('title' in body) {
      const title = cleanString(body.title, 500);
      if (title === null) return reply.code(400).send({ error: '标题格式不正确。', code: 'invalid_entry' });
      nextTitle = title;
    }
    if ('content' in body) {
      if (typeof body.content !== 'string' || body.content.length > 2_000_000) return reply.code(400).send({ error: '正文格式不正确。', code: 'invalid_entry' });
      nextContent = body.content;
    }
    if ('tags' in body) {
      const tags = cleanTags(body.tags);
      if (!tags) return reply.code(400).send({ error: '标签格式不正确。', code: 'invalid_entry' });
      nextTags = tags;
    }
    if ('type' in body) {
      if (typeof body.type !== 'string' || !ENTRY_TYPES.has(body.type)) return reply.code(400).send({ error: '笔记类型无效。', code: 'invalid_entry' });
      nextType = body.type;
    }
    if ('archived' in body) {
      if (typeof body.archived !== 'boolean') return reply.code(400).send({ error: '归档状态无效。', code: 'invalid_entry' });
      nextArchived = body.archived;
    }
    if ('pinned' in body) {
      if (typeof body.pinned !== 'boolean') return reply.code(400).send({ error: '置顶状态无效。', code: 'invalid_entry' });
      nextPinnedAt = body.pinned ? new Date() : null;
    }
    if (!hasContentFields && nextArchived === undefined && nextPinnedAt === undefined) {
      return reply.code(400).send({ error: '没有可更新的内容。', code: 'empty_update' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const currentResult = await client.query(
        'SELECT * FROM thinkpad.entries WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE',
        [id, user.id],
      );
      const entry = currentResult.rows[0] as Record<string, unknown> | undefined;
      if (!entry) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: '笔记不存在。', code: 'entry_not_found' });
      }
      if (hasContentFields && entry.current_revision_id !== baseRevisionId) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: '笔记已被其他设备修改。', code: 'entry_conflict', entry });
      }
      const next = {
        title: nextTitle ?? String(entry.title ?? ''),
        content: nextContent ?? String(entry.content ?? ''),
        tags: nextTags ?? (Array.isArray(entry.tags) ? entry.tags as string[] : []),
        type: nextType ?? String(entry.type ?? 'note'),
      };
      const contentChanged = hasContentFields && !sameEntryContent(entry, next);
      const assignments: string[] = [];
      const values: unknown[] = [];
      const add = (column: string, value: unknown) => { values.push(value); assignments.push(`${column} = $${values.length}`); };
      if (contentChanged) {
        const nextRevisionId = newId();
        const nextNoResult = await client.query<{ next_no: number }>(
          'SELECT COALESCE(MAX(revision_no), 0) + 1 AS next_no FROM thinkpad.entry_revisions WHERE entry_id = $1', [id]);
        const nextNo = nextNoResult.rows[0].next_no;
        await client.query(
          `INSERT INTO thinkpad.entry_revisions(id, entry_id, revision_no, title, content, tags, type, change_message)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [nextRevisionId, id, nextNo, next.title, next.content, next.tags, next.type,
            typeof body.change_message === 'string' ? body.change_message.slice(0, 200) : '编辑笔记'],
        );
        add('title', next.title); add('content', next.content); add('tags', next.tags); add('type', next.type); add('current_revision_id', nextRevisionId);
      }
      if (nextArchived !== undefined) {
        add('archived', nextArchived); add('archived_at', nextArchived ? new Date() : null);
        if (nextArchived) add('pinned_at', null);
      }
      if (nextPinnedAt !== undefined) {
        if (nextPinnedAt && (entry.archived || nextArchived === true)) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: '归档笔记不能置顶。', code: 'archived_entry' });
        }
        add('pinned_at', nextPinnedAt);
      }
      if (!assignments.length) {
        await client.query('ROLLBACK');
        return { entry };
      }
      values.push(id, user.id);
      const result = await client.query(
        `UPDATE thinkpad.entries SET ${assignments.join(', ')}
          WHERE id = $${values.length - 1} AND user_id = $${values.length}
          RETURNING *`, values);
      await client.query('COMMIT');
      return { entry: result.rows[0] };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) return reply.code(409).send({ error: '版本号冲突，请重试。', code: 'revision_conflict' });
      throw error;
    } finally { client.release(); }
  });

  app.delete('/api/entries/:id', async (request, reply) => {
    const user = await requireUser(request, reply, pool);
    if (!user) return;
    const id = (request.params as { id: string }).id;
    if (!isUuid(id)) return reply.code(400).send({ error: '笔记 ID 无效。', code: 'invalid_entry_id' });
    const result = await pool.query(
      `UPDATE thinkpad.entries SET deleted_at = now(), pinned_at = NULL
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING id`,
      [id, user.id],
    );
    if (!result.rows[0]) return reply.code(404).send({ error: '笔记不存在。', code: 'entry_not_found' });
    return { ok: true };
  });

  app.post('/api/entries/:id/restore-deleted', async (request, reply) => {
    const user = await requireUser(request, reply, pool);
    if (!user) return;
    const id = (request.params as { id: string }).id;
    if (!isUuid(id)) return reply.code(400).send({ error: '笔记 ID 无效。', code: 'invalid_entry_id' });
    const result = await pool.query(
      `UPDATE thinkpad.entries SET deleted_at = NULL
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL RETURNING *`, [id, user.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: '回收站中没有这条笔记。', code: 'entry_not_found' });
    return { entry: result.rows[0] };
  });

  app.delete('/api/entries/:id/permanent', async (request, reply) => {
    const user = await requireUser(request, reply, pool);
    if (!user) return;
    const id = (request.params as { id: string }).id;
    if (!isUuid(id)) return reply.code(400).send({ error: '笔记 ID 无效。', code: 'invalid_entry_id' });
    const result = await pool.query(
      'DELETE FROM thinkpad.entries WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL RETURNING id', [id, user.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: '回收站中没有这条笔记。', code: 'entry_not_found' });
    return { ok: true };
  });

  app.post('/api/uploads', {
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const user = await requireUser(request, reply, pool);
    if (!user) return;
    const body = objectBody(request.body);
    const contentType = typeof body.contentType === 'string' ? body.contentType.toLowerCase() : '';
    const size = Number(body.size);
    const extension = IMAGE_TYPES[contentType];
    if (!extension || !Number.isSafeInteger(size) || size < 1 || size > MAX_UPLOAD_BYTES) {
      return reply.code(400).send({ error: '只允许上传不超过 20MB 的常见图片。', code: 'invalid_upload' });
    }
    const now = new Date();
    const key = [
      'thinkpad',
      user.id,
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${newId()}.${extension}`,
    ].join('/');
    return {
      uploadUrl: cos.signedUrl(key, 'PUT', 300),
      mediaUrl: mediaUrl(config.basePath, key),
      expiresIn: 300,
    };
  });

  app.get('/api/media/*', async (request, reply) => {
    const user = await requireUser(request, reply, pool);
    if (!user) return;
    const key = (request.params as { '*': string })['*'];
    if (!key || !key.startsWith(`thinkpad/${user.id}/`) || key.includes('..')) {
      return reply.code(404).send({ error: '图片不存在。', code: 'media_not_found' });
    }
    reply.header('Cache-Control', 'private, no-store');
    return reply.redirect(cos.signedUrl(key, 'GET', 300));
  });

  app.post('/api/ai/explain', {
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const user = await requireUser(request, reply, pool);
    if (!user) return;
    if (!config.deepSeekApiKey) {
      return reply.code(503).send({ error: 'AI 服务尚未配置。', code: 'missing_api_key' });
    }
    const body = objectBody(request.body);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const rawHistory = body.history;
    if (!text || text.length > 6_000 || (rawHistory !== undefined && !Array.isArray(rawHistory))) {
      return reply.code(400).send({ error: '解释内容格式不正确。', code: 'invalid_request' });
    }
    const history: Array<{ role: 'assistant' | 'user'; content: string }> = [];
    let historyChars = 0;
    for (const [index, item] of (rawHistory as unknown[] ?? []).entries()) {
      const record = objectBody(item);
      const role = index % 2 === 0 ? 'assistant' : 'user';
      const content = typeof record.content === 'string' ? record.content.trim() : '';
      if (record.role !== role || !content || content.length > 6_000 || history.length >= 12) {
        return reply.code(400).send({ error: '对话历史格式不正确。', code: 'invalid_history' });
      }
      historyChars += content.length;
      history.push({ role, content });
    }
    if (historyChars > 24_000 || (history.length && history.at(-1)?.role !== 'user')) {
      return reply.code(413).send({ error: '对话历史过长。', code: 'history_too_long' });
    }
    let upstream: Response;
    try {
      upstream = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.deepSeekApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.deepSeekModel,
          messages: [
            {
              role: 'system',
              content: [
                '你是 ThinkPad 学习笔记中的解释助手。',
                '请用简明、准确、自然的中文解释用户选中的内容。',
                '先说明核心含义；必要时补充背景、术语或一个短例子。',
                '使用适合阅读的 Markdown，但不要重复粘贴整段原文，也不要添加客套话。',
              ].join('\n'),
            },
            { role: 'user', content: text },
            ...history,
          ],
          max_tokens: 1200,
          stream: true,
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      return reply.code(502).send({ error: '暂时无法连接 AI 服务。', code: 'upstream_unreachable' });
    }
    if (!upstream.ok || !upstream.body) {
      await upstream.text().catch(() => '');
      const status = upstream.status === 429 ? 429 : 502;
      const code = upstream.status === 429 ? 'rate_limited' : 'upstream_error';
      return reply.code(status).send({ error: 'AI 服务请求失败。', code });
    }
    reply.raw.writeHead(200, {
      'Content-Type': upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    });
    reply.hijack();
    Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).pipe(reply.raw);
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) request.log.warn(error);
    else request.log.error(error);
    if (statusCode === 429) {
      return reply.code(429).send({ error: '请求过于频繁，请稍后重试。', code: 'rate_limited' });
    }
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: '请求格式不正确。', code: 'invalid_request' });
    }
    return reply.code(500).send({ error: '服务器暂时无法处理请求。', code: 'internal_error' });
  });

  return app;
}
