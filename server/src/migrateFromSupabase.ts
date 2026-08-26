import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { GetObjectCommand, S3Client, type GetObjectCommandOutput } from '@aws-sdk/client-s3';
import pg from 'pg';
import { ThinkPadCos } from './cos.ts';
import { loadConfig } from './config.ts';
import { applyMigrations, createDatabasePool, type DatabasePool } from './database.ts';
import { sha256 } from './security.ts';

const { Pool } = pg;
const WORKER_HOST = 'personandb-upload.xiaobai1423.workers.dev';
const MARKDOWN_IMAGE = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)(?:\s+["'][^"']*["'])?\)/g;

interface SourceUser {
  id: string;
  email: string;
  encrypted_password: string;
  created_at: Date;
  updated_at: Date;
}

interface SourceEntry {
  id: string;
  user_id: string;
  title: string;
  content: string;
  tags: string[];
  type: string;
  archived: boolean;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface MigratedImage {
  oldUrl: string;
  key: string;
  stableUrl: string;
  contentType: string;
  digest: string;
  body: Buffer;
}

interface MigrationEnvironment {
  SUPABASE_DB_URL?: string;
  THINKPAD_SOURCE_DATABASE_URL?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
}

interface R2Source {
  client: S3Client;
  bucket: string;
}

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function cleanDatabaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/^[\s'"`\u2018\u2019\u201c\u201d]+|[\s'"`\u2018\u2019\u201c\u201d]+$/g, '');
  const start = trimmed.search(/postgres(?:ql)?:\/\//i);
  return start >= 0 ? trimmed.slice(start) : trimmed;
}

function cleanEnvValue(raw: string): string {
  return raw.trim().replace(/^[\s'"`\u2018\u2019\u201c\u201d]+|[\s'"`\u2018\u2019\u201c\u201d]+$/g, '');
}

async function migrationEnvironment(): Promise<MigrationEnvironment> {
  const envPath = resolve(option('source-env') ?? '../../../.env');
  const text = await readFile(envPath, 'utf8');
  const parsed: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match?.[1] && match[2] !== undefined) parsed[match[1]] = cleanEnvValue(match[2]);
  }
  const names = [
    'SUPABASE_DB_URL',
    'THINKPAD_SOURCE_DATABASE_URL',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
  ] as const;
  for (const name of names) {
    if (process.env[name]?.trim()) parsed[name] = cleanEnvValue(process.env[name] ?? '');
  }
  if (!/^[0-9a-f]{32}$/i.test(parsed.R2_ACCOUNT_ID ?? '')) {
    const wranglerPath = resolve(option('wrangler') ?? '../../../wrangler.toml');
    const wrangler = await readFile(wranglerPath, 'utf8');
    const account = wrangler.match(/^\s*account_id\s*=\s*["']([0-9a-f]{32})["']\s*$/im)?.[1];
    if (account) {
      parsed.R2_ACCOUNT_ID = account;
      console.log('已从 wrangler.toml 读取 R2 Account ID。');
    }
  }
  return parsed;
}

function sourceDatabaseUrl(environment: MigrationEnvironment): string {
  const result = cleanDatabaseUrl(
    environment.SUPABASE_DB_URL
      || environment.THINKPAD_SOURCE_DATABASE_URL
      || '',
  );
  if (!result) throw new Error('找不到 SUPABASE_DB_URL。');
  return result;
}

function r2Source(environment: MigrationEnvironment): R2Source {
  const accountId = environment.R2_ACCOUNT_ID?.trim();
  const accessKeyId = environment.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = environment.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = environment.R2_BUCKET?.trim();
  if (!accountId || !/^[0-9a-f]{32}$/i.test(accountId) || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('R2 读取凭据不完整。');
  }
  return {
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
  };
}

function imageUrls(entries: SourceEntry[]): string[] {
  const urls = new Set<string>();
  for (const entry of entries) {
    for (const match of entry.content.matchAll(MARKDOWN_IMAGE)) {
      try {
        const parsed = new URL(match[1]);
        if (parsed.protocol === 'https:' && parsed.hostname === WORKER_HOST) {
          urls.add(parsed.toString());
        }
      } catch {
        // 非法 URL 保留原文，不参与迁移。
      }
    }
  }
  return [...urls];
}

function extensionFor(contentType: string, url: string): string {
  const known: Record<string, string> = {
    'image/avif': 'avif',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
  };
  if (known[contentType]) return known[contentType];
  const candidate = extname(new URL(url).pathname).slice(1).toLowerCase();
  if (['avif', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'svg', 'webp'].includes(candidate)) return candidate;
  throw new Error('源图片缺少可识别的图片类型。');
}

async function downloadImages(
  urls: string[],
  userId: string,
  basePath: string,
  source: R2Source,
): Promise<MigratedImage[]> {
  const images: MigratedImage[] = [];
  for (const [index, oldUrl] of urls.entries()) {
    const sourceKey = decodeURIComponent(new URL(oldUrl).pathname.replace(/^\/+/, ''));
    if (!sourceKey || sourceKey.includes('..') || sourceKey.includes('\\') || sourceKey.includes('\0')) {
      throw new Error(`第 ${index + 1} 张源图片的 R2 Key 无效。`);
    }
    let result: GetObjectCommandOutput | null = null;
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        result = await source.client.send(new GetObjectCommand({
          Bucket: source.bucket,
          Key: sourceKey,
        }));
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 3) console.log(`第 ${index + 1} 张 R2 图片读取失败，正在重试（${attempt}/3）。`);
      }
    }
    if (!result) {
      const reason = lastError instanceof Error ? lastError.message : '网络连接失败';
      throw new Error(`第 ${index + 1} 张 R2 图片无法读取：${reason}`);
    }
    if (!result.Body) throw new Error(`第 ${index + 1} 张 R2 图片内容为空。`);
    const body = Buffer.from(await result.Body.transformToByteArray());
    if (!body.length || body.length > 25 * 1024 * 1024) {
      throw new Error(`第 ${index + 1} 张源图片大小无效。`);
    }
    const contentType = String(result.ContentType ?? '').split(';')[0].trim().toLowerCase();
    const extension = extensionFor(contentType, oldUrl);
    const urlDigest = sha256(oldUrl);
    const key = `thinkpad/${userId}/migrated/${urlDigest.slice(0, 32)}.${extension}`;
    const stablePath = key.split('/').map(encodeURIComponent).join('/');
    images.push({
      oldUrl,
      key,
      stableUrl: `${basePath}/api/media/${stablePath}`,
      contentType: contentType || `image/${extension}`,
      digest: createHash('sha256').update(body).digest('hex'),
      body,
    });
    console.log(`已验证源图片 ${index + 1}/${urls.length}。`);
  }
  return images;
}

function rewriteContent(content: string, images: MigratedImage[]): string {
  let rewritten = content;
  for (const image of images) rewritten = rewritten.split(image.oldUrl).join(image.stableUrl);
  return rewritten;
}

async function importData(
  target: DatabasePool,
  users: SourceUser[],
  entries: SourceEntry[],
  images: MigratedImage[],
  cos: ThinkPadCos,
): Promise<void> {
  for (const [index, image] of images.entries()) {
    await cos.put(image.key, image.body, image.contentType);
    console.log(`已上传迁移图片 ${index + 1}/${images.length}。`);
  }

  const client = await target.connect();
  try {
    await client.query('BEGIN');
    for (const user of users) {
      await client.query(
        `INSERT INTO thinkpad.users(id, email, password_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           password_hash = EXCLUDED.password_hash,
           created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at`,
        [user.id, user.email, user.encrypted_password, user.created_at, user.updated_at],
      );
    }
    for (const image of images) {
      await client.query(
        `INSERT INTO thinkpad.media_migrations(old_url_hash, old_url, new_key, content_sha256)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (old_url_hash) DO UPDATE SET
           new_key = EXCLUDED.new_key,
           content_sha256 = EXCLUDED.content_sha256,
           migrated_at = now()`,
        [sha256(image.oldUrl), image.oldUrl, image.key, image.digest],
      );
    }
    for (const entry of entries) {
      await client.query(
        `INSERT INTO thinkpad.entries(
           id, user_id, title, content, tags, type, archived, archived_at, created_at, updated_at, current_revision_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, md5($1::text || ':baseline')::uuid)
         ON CONFLICT (id) DO NOTHING`,
        [
          entry.id,
          entry.user_id,
          entry.title,
          rewriteContent(entry.content, images),
          entry.tags,
          entry.type,
          entry.archived,
          entry.archived_at,
          entry.created_at,
          entry.updated_at,
        ],
      );
      await client.query(
        `INSERT INTO thinkpad.entry_revisions(
           id, entry_id, revision_no, title, content, tags, type, created_at, change_message
         ) VALUES (md5($1::text || ':baseline')::uuid, $1, 1, $2, $3, $4, $5, $6, 'Supabase 迁移基线')
         ON CONFLICT (entry_id, revision_no) DO NOTHING`,
        [entry.id, entry.title, rewriteContent(entry.content, images), entry.tags, entry.type, entry.updated_at],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  const environment = await migrationEnvironment();
  const sourceR2 = r2Source(environment);
  const sourcePool = new Pool({
    connectionString: sourceDatabaseUrl(environment),
    max: 2,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });
  try {
  const [userResult, entryResult] = await Promise.all([
    sourcePool.query<SourceUser>(
      `SELECT id, email, encrypted_password, created_at, updated_at
         FROM auth.users
        WHERE deleted_at IS NULL
        ORDER BY created_at`,
    ),
    sourcePool.query<SourceEntry>(
      `SELECT id, user_id, title, content, tags, type, archived, archived_at, created_at, updated_at
         FROM public.entries
        ORDER BY created_at`,
    ),
  ]);
  if (!userResult.rows.length) throw new Error('源库没有可迁移账号。');
  const userIds = new Set(userResult.rows.map((user) => user.id));
  if (entryResult.rows.some((entry) => !userIds.has(entry.user_id))) {
    throw new Error('源笔记存在无法对应的账号。');
  }
  const urls = imageUrls(entryResult.rows);
  const primaryUserId = userResult.rows[0].id;
  const basePath = process.env.THINKPAD_BASE_PATH?.trim().replace(/\/+$/, '') || '/thinkpad';
  const images = await downloadImages(urls, primaryUserId, basePath, sourceR2);
  console.log(`源数据检查完成：${userResult.rows.length} 个账号，${entryResult.rows.length} 条笔记，${images.length} 张图片。`);

  if (!apply) {
    console.log('当前是只读预演；未写入 PostgreSQL 或 COS。使用 --apply 才会执行迁移。');
  } else {
    const config = loadConfig();
    const target = createDatabasePool(config.databaseUrl);
    try {
      await applyMigrations(target);
      const cos = new ThinkPadCos({
        bucket: config.cosBucket,
        region: config.cosRegion,
        secretId: config.cosSecretId,
        secretKey: config.cosSecretKey,
      });
      await importData(target, userResult.rows, entryResult.rows, images, cos);
      const counts = await target.query<{ users: string; entries: string; media: string }>(
        `SELECT
           (SELECT count(*) FROM thinkpad.users)::text AS users,
           (SELECT count(*) FROM thinkpad.entries)::text AS entries,
           (SELECT count(*) FROM thinkpad.media_migrations)::text AS media`,
      );
      const result = counts.rows[0];
      if (!result || Number(result.users) < userResult.rows.length || Number(result.entries) < entryResult.rows.length || Number(result.media) < images.length) {
        throw new Error('迁移后的数量核对失败。');
      }
      console.log(`迁移完成并已核对：${result.users} 个账号，${result.entries} 条笔记，${result.media} 张图片。`);
    } finally {
      await target.end();
    }
  }
  } finally {
    await sourcePool.end();
  }
}

main().catch((error) => {
  console.error(`迁移失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
