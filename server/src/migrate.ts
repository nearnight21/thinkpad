import { loadConfig } from './config.ts';
import { applyMigrations, createDatabasePool } from './database.ts';

const config = loadConfig();
const pool = createDatabasePool(config.databaseUrl);

try {
  await applyMigrations(pool);
  console.log('ThinkPad 数据库结构已更新。');
} finally {
  await pool.end();
}
