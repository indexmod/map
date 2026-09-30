import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const prompt = await readFile(new URL('../prompts/map-semantic.md', import.meta.url), 'utf8');
const source = (await readFile(new URL('../worker/index.js', import.meta.url), 'utf8'))
  .replace("import prompt from '../prompts/map-semantic.md';", `const prompt = ${JSON.stringify(prompt)};`)
  .replaceAll("'../src/analyze.js'", JSON.stringify(new URL('../src/analyze.js', import.meta.url).href))
  .replaceAll("'../src/article.js'", JSON.stringify(new URL('../src/article.js', import.meta.url).href))
  .replaceAll("'../src/huggingface.js'", JSON.stringify(new URL('../src/huggingface.js', import.meta.url).href));
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
test('live map editor can analyze and cache a dated article while saved state stays untouched', async () => {
  const original = globalThis.fetch;
  const stored = new Map([['map_state', JSON.stringify({ cards: [{ link: 'https://indexmod.press/example', nx: .2, ny: .3 }] })]]);
  const env = { HF_TOKEN: 'hf-test', MAP_ANALYZER_TOKEN: 'editor-test', HF_MODEL: 'Qwen/Qwen3-4B-Instruct-2507', MAP_DB: {
    get: async key => stored.get(key) || null,
    put: async (key, value) => stored.set(key, value)
  } };
  let inferenceCalls = 0;
  globalThis.fetch = async url => {
    if (url === 'https://indexmod.press/_get/example') return Response.json({ raw: '---\nupdated: "2026-09-18"\n---\nA project founded in 2007.' });
    if (url === 'https://router.huggingface.co/v1/chat/completions') {
      inferenceCalls++;
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        subjectType: 'project', subjectYear: 2007,
        scores: { institutional: 0.1, underground: 0.1, commercial: 0.8, experimental: 0.7 },
        confidence: .8,
        evidence: { subjectType: ['project'], subjectYear: ['founded in 2007'], institutional: ['project'], underground: ['project'], commercial: ['project'], experimental: ['project'] }
      }) } }] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const page = await worker.fetch(new Request('https://map.indexmod.press/'), env);
    const html = await page.text();
    assert.match(html, /Analyze map/);
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    assert.doesNotThrow(() => new Function(script));
    const request = token => new Request('https://map.indexmod.press/api/analyze', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ link: 'https://indexmod.press/example' }) });
    assert.equal((await worker.fetch(request('wrong'), env)).status, 401);
    const first = await (await worker.fetch(request('editor-test'), env)).json();
    assert.equal(first.status, 'analyzed');
    assert.ok(first.targetPosition?.x > .5);
    assert.ok(first.targetPosition?.y < .5);
    const second = await (await worker.fetch(request('editor-test'), env)).json();
    assert.equal(second.cacheHit, true);
    assert.equal(inferenceCalls, 1);
    assert.deepEqual(JSON.parse(stored.get('map_state')).cards[0], { link: 'https://indexmod.press/example', nx: .2, ny: .3 });
  } finally { globalThis.fetch = original; }
});
