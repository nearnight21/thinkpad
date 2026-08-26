const apiKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
const model = String(process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim();

if (!apiKey) {
  console.error('deepseek_configured=false');
  process.exit(1);
}

try {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: '只回复 OK' }],
      max_tokens: 4,
      stream: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  await response.body?.cancel().catch(() => undefined);
  console.log(`deepseek_http=${response.status}`);
  if (!response.ok) process.exitCode = 1;
} catch {
  console.error('deepseek_http=network_error');
  process.exitCode = 1;
}
