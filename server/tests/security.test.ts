import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app.ts';
import type { ThinkPadConfig } from '../src/config.ts';
import type { DatabasePool } from '../src/database.ts';
import {
  hashPassword,
  needsPasswordUpgrade,
  newOpaqueToken,
  parseCookies,
  sessionCookie,
  sha256,
  verifyPassword,
} from '../src/security.ts';

test('兼容 Supabase bcrypt，并可升级为 Argon2id', async () => {
  const bcryptHash = await bcrypt.hash('correct horse battery staple', 10);
  assert.equal(await verifyPassword(bcryptHash, 'correct horse battery staple'), true);
  assert.equal(await verifyPassword(bcryptHash, 'wrong'), false);
  assert.equal(needsPasswordUpgrade(bcryptHash), true);

  const argonHash = await hashPassword('correct horse battery staple');
  assert.match(argonHash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(argonHash, 'correct horse battery staple'), true);
  assert.equal(needsPasswordUpgrade(argonHash), false);
});

test('会话 Cookie 不暴露数据库里保存的令牌摘要', () => {
  const token = newOpaqueToken();
  const hash = sha256(token);
  const cookie = sessionCookie(token, '/thinkpad', 3600);
  assert.notEqual(token, hash);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\/thinkpad/);
  assert.equal(parseCookies(cookie).thinkpad_session, token);
});

test('登录签发安全 Cookie，写请求拒绝错误来源', async () => {
  const password = 'correct horse battery staple';
  const passwordHash = await bcrypt.hash(password, 10);
  const queries: string[] = [];
  const pool = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes('SELECT id, email, password_hash')) {
        return {
          rows: [{
            id: '8a542173-6261-47b6-88f9-153e299a849b',
            email: 'owner@example.com',
            password_hash: passwordHash,
          }],
        };
      }
      return { rows: [] };
    },
  } as unknown as DatabasePool;
  const config: ThinkPadConfig = {
    host: '127.0.0.1',
    port: 8790,
    databaseUrl: 'postgres://unused',
    siteOrigin: 'https://memorae.cn',
    basePath: '/thinkpad',
    sessionDays: 30,
    cosBucket: 'bucket-123',
    cosRegion: 'ap-guangzhou',
    cosSecretId: 'test-id',
    cosSecretKey: 'test-key',
    deepSeekApiKey: '',
    deepSeekModel: 'deepseek-chat',
  };
  const app = await buildApp({ config, pool });
  try {
    const denied = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { email: 'owner@example.com', password },
    });
    assert.equal(denied.statusCode, 403);

    const response = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: { origin: 'https://memorae.cn' },
      payload: { email: 'owner@example.com', password },
    });
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['set-cookie']), /thinkpad_session=/);
    assert.equal(response.json().session.user.email, 'owner@example.com');
    assert.equal(queries.some((sql) => sql.includes('INSERT INTO thinkpad.sessions')), true);
  } finally {
    await app.close();
  }
});
