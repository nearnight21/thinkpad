import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.ts';

const legacyPrefix = ['MEMORY', 'RECALL'].join('_');
const legacyNames = [
  'DATABASE_URL',
  'COS_BUCKET',
  'COS_REGION',
  'COS_SECRET_ID',
  'COS_SECRET_KEY',
].map((name) => `${legacyPrefix}_${name}`);

const thinkPadNames = [
  'THINKPAD_DATABASE_URL',
  'THINKPAD_SITE_ORIGIN',
  'THINKPAD_COS_BUCKET',
  'THINKPAD_COS_REGION',
  'THINKPAD_COS_SECRET_ID',
  'THINKPAD_COS_SECRET_KEY',
];
const runtimeNames = [...thinkPadNames, ...legacyNames];

test('配置只接受 ThinkPad 变量，不回退到旧产品变量', () => {
  const saved = new Map(runtimeNames.map((name) => [name, process.env[name]]));
  try {
    for (const name of runtimeNames) delete process.env[name];
    process.env[legacyNames[0]] = 'postgres://legacy';
    process.env[legacyNames[1]] = 'legacy';
    process.env[legacyNames[2]] = 'legacy';
    process.env[legacyNames[3]] = 'legacy';
    process.env[legacyNames[4]] = 'legacy';
    assert.throws(() => loadConfig(), /THINKPAD_DATABASE_URL/);

    process.env.THINKPAD_DATABASE_URL = 'postgres://thinkpad';
    process.env.THINKPAD_SITE_ORIGIN = 'https://thinkpad.example.test';
    process.env.THINKPAD_COS_BUCKET = 'thinkpad';
    process.env.THINKPAD_COS_REGION = 'ap-guangzhou';
    process.env.THINKPAD_COS_SECRET_ID = 'id';
    process.env.THINKPAD_COS_SECRET_KEY = 'key';
    const config = loadConfig();
    assert.equal(config.databaseUrl, 'postgres://thinkpad');
    assert.equal(config.cosBucket, 'thinkpad');
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
