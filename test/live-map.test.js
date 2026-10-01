import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const prompt = await readFile(new URL('../prompts/map-semantic.md', import.meta.url), 'utf8');
const source = (await readFile(new URL('../worker/index.js', import.meta.url), 'utf8'))
  .replace("import prompt from '../prompts/map-semantic.md';", `const prompt = ${JSON.stringify(prompt)};`)
  .replaceAll("'../src/analyze.js'", JSON.stringify(new URL('../src/analyze.js', import.meta.url).href))
  .replaceAll("'../src/article.js'", JSON.stringify(new URL('../src/article.js', import.meta.url).href))
  .replaceAll("'../src/huggingface.js'", JSON.stringify(new URL('../src/huggingface.js', import.meta.url).href))
  .replaceAll("'../src/cloudflare.js'", JSON.stringify(new URL('../src/cloudflare.js', import.meta.url).href))
  .replaceAll("'../src/position.js'", JSON.stringify(new URL('../src/position.js', import.meta.url).href));
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
test('new map generation clears legacy cards once and rejects stale saves', async () => {
  const store = new Map([['map_state', JSON.stringify({ cards: [{ id: 'old' }] })]]);
  const env = { MAP_DB: { get: async key => store.get(key), put: async (key, value) => store.set(key, value) } };
  const loaded = await (await worker.fetch(new Request('https://map.indexmod.press/api/load'), env)).json();
  assert.deepEqual(loaded, { generation: 2, cards: [] });
  assert.deepEqual(JSON.parse(store.get('map_state')), loaded);
  const stale = await worker.fetch(new Request('https://map.indexmod.press/api/save', { method: 'POST', body: JSON.stringify({ cards: [{ id: 'old' }] }) }), env);
  assert.equal(stale.status, 409);
  const cards = Array.from({ length: 21 }, (_, id) => ({ id }));
  const saved = await worker.fetch(new Request('https://map.indexmod.press/api/save', {
    method: 'POST', body: JSON.stringify({ generation: 2, cards })
  }), env);
  assert.equal(saved.status, 200);
  const retained = JSON.parse(store.get('map_state')).cards;
  assert.equal(retained.length, 20);
  assert.equal(retained[0].id, 1);
});
test('new pasted article without September frontmatter is analyzed through Workers AI', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(url, 'https://indexmod.press/_get/example');
    return Response.json({ raw: '---\nupdated: "2026-08-18"\n---\nAn experimental project founded in 2007.' });
  };
  let calls = 0;
  const profile = { subjectType: 'project', subjectYear: 2007,
    scores: { institutional: .1, underground: .1, commercial: .8, experimental: .7 }, confidence: .7,
    evidence: { subjectType: [], subjectYear: [], institutional: [], underground: [], commercial: [], experimental: [] } };
  const store = new Map();
  const env = { MAP_AI_PROVIDER: 'cloudflare', AI: { run: async () => { calls++; return { response: profile }; } }, MAP_DB: { get: async key => store.get(key), put: async (key, value) => store.set(key, value) } };
  try {
    const request = new Request('https://map.indexmod.press/api/analyze', { method: 'POST', body: JSON.stringify({ link: 'https://indexmod.press/example' }) });
    const response = await worker.fetch(request, env);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, 'analyzed');
    assert.ok(result.targetPosition);
    assert.ok(result.evidenceWarnings.length);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
test('Cyrillic article text reaches inference intact and supports verbatim evidence', async () => {
  const original = globalThis.fetch;
  const raw = '---\ntitle: Огненная Леди\nupdated: 2026-09-29\n---\nОгненная Леди — независимый театральный проект московской клубной сцены с 1993 года.';
  globalThis.fetch = async url => {
    assert.equal(url, 'https://indexmod.press/_get/ognennaya-lady');
    return Response.json({ raw });
  };
  const profile = { subjectType: 'project', subjectYear: 1993,
    scores: { institutional: 0, underground: .9, commercial: .1, experimental: .8 }, confidence: .85,
    evidence: { subjectType: ['проект'], subjectYear: ['с 1993 года'], institutional: ['проект'], underground: ['независимый'], commercial: ['проект'], experimental: ['театральный проект'] } };
  let calls = 0;
  const store = new Map();
  const env = { MAP_AI_PROVIDER: 'cloudflare', AI: { run: async (model, input) => {
    calls++;
    assert.match(input.messages[1].content, /Огненная Леди — независимый театральный проект/);
    return { response: profile };
  } }, MAP_DB: { get: async key => store.get(key), put: async (key, value) => store.set(key, value) } };
  try {
    const request = () => new Request('https://map.indexmod.press/api/analyze', { method: 'POST', body: JSON.stringify({ link: 'https://indexmod.press/ognennaya-lady' }) });
    const first = await (await worker.fetch(request(), env)).json();
    assert.equal(first.status, 'analyzed');
    assert.equal(first.result.subjectYear, 1993);
    assert.deepEqual(first.evidenceWarnings, []);
    assert.ok(first.targetPosition);
    const second = await (await worker.fetch(request(), env)).json();
    assert.equal(second.cacheHit, true);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
test('live map editor can analyze and cache a dated article while saved state stays untouched', async () => {
  const original = globalThis.fetch;
  const stored = new Map([['map_state', JSON.stringify({ generation: 2, cards: [{ link: 'https://indexmod.press/example', nx: .2, ny: .3 }] })]]);
  const env = { HF_TOKEN: 'hf-test', MAP_AI_PROVIDER: 'hf', HF_MODEL: 'Qwen/Qwen3-4B-Instruct-2507', MAP_DB: {
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
    assert.doesNotMatch(html, /Retry analysis|mapAnalyzerToken|class=\"del\"/);
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    assert.doesNotThrow(() => new Function(script));
    const request = () => new Request('https://map.indexmod.press/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ link: 'https://indexmod.press/example' }) });
    const first = await (await worker.fetch(request(), env)).json();
    assert.equal(first.status, 'analyzed');
    assert.ok(first.targetPosition?.x > .5);
    assert.ok(first.targetPosition?.y < .5);
    const second = await (await worker.fetch(request(), env)).json();
    assert.equal(second.cacheHit, true);
    assert.equal(inferenceCalls, 1);
    assert.deepEqual(JSON.parse(stored.get('map_state')).cards[0], { link: 'https://indexmod.press/example', nx: .2, ny: .3 });
  } finally { globalThis.fetch = original; }
});
