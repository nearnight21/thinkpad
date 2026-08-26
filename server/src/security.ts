import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Algorithm, hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import bcrypt from 'bcryptjs';

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function newId(): string {
  return randomUUID();
}

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });
}

export async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  try {
    if (/^\$2[aby]\$/.test(encoded)) return bcrypt.compare(password, encoded);
    if (encoded.startsWith('$argon2')) return argonVerify(encoded, password);
    return false;
  } catch {
    return false;
  }
}

export function needsPasswordUpgrade(encoded: string): boolean {
  return /^\$2[aby]\$/.test(encoded);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of String(header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const raw = part.slice(separator + 1).trim();
    try {
      result[name] = decodeURIComponent(raw);
    } catch {
      result[name] = raw;
    }
  }
  return result;
}

export function sessionCookie(token: string, basePath: string, maxAgeSeconds: number): string {
  return [
    `thinkpad_session=${encodeURIComponent(token)}`,
    `Path=${basePath}`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');
}

export function clearedSessionCookie(basePath: string): string {
  return [
    'thinkpad_session=',
    `Path=${basePath}`,
    'Max-Age=0',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');
}
