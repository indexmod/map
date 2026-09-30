// Workers AI fallback when Hugging Face credits are unavailable.
export function cloudflareAI(env) {
  if (!env.AI?.run) throw new Error('Cloudflare Workers AI binding is unavailable');
  const model = env.CF_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const endpoint = 'cloudflare-workers-ai';
  return { model, endpoint, infer: async ({ prompt, article, schema }) => {
    // This small model has a shorter context than Qwen. Keep the beginning and
    // chronology rather than silently exceeding its limit.
    const input = article.length <= 18000 ? article : `${article.slice(0, 14000)}\n\n[Article truncated]\n\n${article.slice(-4000)}`;
    const output = await env.AI.run(model, {
      messages: [{ role: 'system', content: prompt }, { role: 'user', content: input }],
      response_format: { type: 'json_schema', json_schema: schema },
      max_tokens: 2200, temperature: 0
    });
    const value = output?.response;
    if (typeof value === 'string') return JSON.parse(value);
    if (value && typeof value === 'object') return value;
    throw new Error('Workers AI returned no structured profile');
  } };
}
