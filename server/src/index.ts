import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { applyMigrations, createDatabasePool } from './database.ts';

const config = loadConfig();
const pool = createDatabasePool(config.databaseUrl);
await applyMigrations(pool);

const app = await buildApp({ config, pool });

async function close(signal: string): Promise<void> {
  app.log.info({ signal }, '正在关闭 ThinkPad API');
  await app.close();
  await pool.end();
  process.exit(0);
}

process.once('SIGINT', () => void close('SIGINT'));
process.once('SIGTERM', () => void close('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
