export interface ThinkPadConfig {
  host: string;
  port: number;
  databaseUrl: string;
  siteOrigin: string;
  basePath: string;
  sessionDays: number;
  cosBucket: string;
  cosRegion: string;
  cosSecretId: string;
  cosSecretKey: string;
  deepSeekApiKey: string;
  deepSeekModel: string;
}

function value(name: string, fallback = ''): string {
  return String(process.env[name] ?? fallback).trim();
}

function required(name: string, fallback = ''): string {
  const result = value(name, fallback);
  if (!result) throw new Error(`缺少环境变量 ${name}。`);
  return result;
}

function positiveInteger(name: string, fallback: number): number {
  const result = Number(value(name, String(fallback)));
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new Error(`${name} 必须是正整数。`);
  }
  return result;
}

export function loadConfig(): ThinkPadConfig {
  const basePath = value('THINKPAD_BASE_PATH', '/thinkpad').replace(/\/+$/, '') || '/thinkpad';
  return {
    host: value('THINKPAD_HOST', '127.0.0.1'),
    port: positiveInteger('THINKPAD_PORT', 8790),
    databaseUrl: required(
      'THINKPAD_DATABASE_URL',
      value('MEMORY_RECALL_DATABASE_URL'),
    ),
    siteOrigin: required('THINKPAD_SITE_ORIGIN', 'https://memorae.cn').replace(/\/+$/, ''),
    basePath,
    sessionDays: positiveInteger('THINKPAD_SESSION_DAYS', 30),
    cosBucket: required('THINKPAD_COS_BUCKET', value('MEMORY_RECALL_COS_BUCKET')),
    cosRegion: required('THINKPAD_COS_REGION', value('MEMORY_RECALL_COS_REGION')),
    cosSecretId: required('THINKPAD_COS_SECRET_ID', value('MEMORY_RECALL_COS_SECRET_ID')),
    cosSecretKey: required('THINKPAD_COS_SECRET_KEY', value('MEMORY_RECALL_COS_SECRET_KEY')),
    deepSeekApiKey: value('DEEPSEEK_API_KEY'),
    deepSeekModel: value('DEEPSEEK_MODEL', 'deepseek-chat'),
  };
}
