export function huggingFace(env, fetcher = fetch) {
  const model = env.HF_MODEL || 'Qwen/Qwen3-4B-Instruct-2507';
  const endpoint = env.HF_ENDPOINT || 'https://router.huggingface.co/v1/chat/completions';
  if (!env.HF_TOKEN) throw new Error('HF_TOKEN is required for hf mode');
  if (new URL(endpoint).protocol !== 'https:') throw new Error('HF_ENDPOINT must use HTTPS');
  return { model, endpoint, infer: async ({ prompt, article, schema }) => {
    const response = await fetcher(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${env.HF_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 3000, messages: [{ role: 'system', content: `${prompt}\nRequired JSON schema:\n${JSON.stringify(schema)}` }, { role: 'user', content: JSON.stringify({ article }) }] })
    });
    if (!response.ok) throw new Error(`HF HTTP ${response.status}; check model/provider availability and token permissions`);
    const data = await response.json();
    if (data.choices?.[0]?.finish_reason === 'length') throw new Error('HF response was truncated');
    return JSON.parse(data.choices?.[0]?.message?.content);
  } };
}
