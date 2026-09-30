import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
// Node does not import Markdown; emulate the Wrangler Text binding in this test.
const prompt = await readFile(new URL('../prompts/map-semantic.md', import.meta.url), 'utf8');
const source = (await readFile(new URL('../worker/test.js', import.meta.url), 'utf8'))
  .replace("import prompt from '../prompts/map-semantic.md';", `const prompt = ${JSON.stringify(prompt)};`)
  .replaceAll("'../src/analyze.js'", JSON.stringify(new URL('../src/analyze.js', import.meta.url).href))
  .replaceAll("'../src/huggingface.js'", JSON.stringify(new URL('../src/huggingface.js', import.meta.url).href));
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
test('Worker requires authentication and returns snapshot report without map writes', async () => {
  const original = globalThis.fetch;
  const snapshot = JSON.parse(await readFile(new URL('./fixtures/published-2026-09-30.json', import.meta.url)));
  let calls = 0;
  globalThis.fetch = async (url, options = {}) => {
    calls++;
    assert.ok(!options.method || options.method === 'GET');
    if (url === 'https://map.indexmod.press/api/load') return Response.json(snapshot.state);
    assert.ok(snapshot.articles[url]);
    return Response.json(snapshot.articles[url]);
  };
  try {
    const env = { ANALYZER_TEST_TOKEN: 'local-test' };
    const request = token => new Request('https://test/api/test-published', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assert.equal((await worker.fetch(request('wrong'), env)).status, 401);
    assert.equal(calls, 0);
    const response = await worker.fetch(request('local-test'), env);
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.equal(report.totalCards, 20);
    assert.equal(report.results.filter(r => r.status === 'dry-run').length, 17);
    assert.equal(report.results.filter(r => r.status === 'skipped').length, 3);
    assert.equal(report.nextOffset, null);
  } finally { globalThis.fetch = original; }
});
