import type { FastifyRequest } from 'fastify';
import type { DatabasePool } from './database.ts';
import { newOpaqueToken, parseCookies, sessionCookie, sha256 } from './security.ts';

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export async function currentUser(
  request: FastifyRequest,
  pool: DatabasePool,
): Promise<AuthenticatedUser | null> {
  const token = parseCookies(request.headers.cookie).thinkpad_session;
  if (!token) return null;
  const result = await pool.query<AuthenticatedUser>(
    `SELECT u.id, u.email
       FROM thinkpad.sessions s
       JOIN thinkpad.users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()`,
    [sha256(token)],
  );
  const user = result.rows[0] ?? null;
  if (user) {
    void pool.query(
      `UPDATE thinkpad.sessions SET last_seen_at = now()
        WHERE token_hash = $1 AND last_seen_at < now() - interval '5 minutes'`,
      [sha256(token)],
    ).catch(() => undefined);
  }
  return user;
}

export async function createSession(
  pool: DatabasePool,
  userId: string,
  sessionDays: number,
  basePath: string,
): Promise<string> {
  const token = newOpaqueToken();
  const seconds = sessionDays * 24 * 60 * 60;
  await pool.query(
    `INSERT INTO thinkpad.sessions(token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 * interval '1 second'))`,
    [sha256(token), userId, seconds],
  );
  return sessionCookie(token, basePath, seconds);
}

export async function revokeSession(request: FastifyRequest, pool: DatabasePool): Promise<void> {
  const token = parseCookies(request.headers.cookie).thinkpad_session;
  if (!token) return;
  await pool.query(
    'UPDATE thinkpad.sessions SET revoked_at = now() WHERE token_hash = $1',
    [sha256(token)],
  );
}
