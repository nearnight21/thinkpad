import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
export type DatabasePool = pg.Pool;

export function createDatabasePool(databaseUrl: string): DatabasePool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export async function applyMigrations(pool: DatabasePool): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = resolve(here, '../migrations');
  const files = (await readdir(migrationsDir))
    .filter((file) => /^\d+_[^/]+\.sql$/i.test(file))
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('thinkpad:migrations'))");
    try {
      await client.query('CREATE SCHEMA IF NOT EXISTS thinkpad');
      await client.query(`
        CREATE TABLE IF NOT EXISTS thinkpad.schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      for (const file of files) {
        const version = Number.parseInt(file, 10);
        const applied = await client.query(
          'SELECT 1 FROM thinkpad.schema_migrations WHERE version = $1',
          [version],
        );
        if (applied.rowCount) continue;
        const sql = await readFile(resolve(migrationsDir, file), 'utf8');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query(
            'INSERT INTO thinkpad.schema_migrations(version, name) VALUES ($1, $2)',
            [version, file],
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('thinkpad:migrations'))");
    }
  } finally {
    client.release();
  }
}
