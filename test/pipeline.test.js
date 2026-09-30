import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseArticle, canonicalURL } from '../src/article.js';
import { analyze, runPublished } from '../src/analyze.js';
import { schema, emptyProfile, validateProfile, evidenceWarnings } from '../src/schema.js';
import { semanticPosition, ageTransform } from '../src/position.js';
import { huggingFace } from '../src/huggingface.js';
import { cloudflareAI } from '../src/cloudflare.js';
const raw = '---\nupdated: "2026-09-18"\n---\nA project started in 2007.';
test('only actual frontmatter updated, valid September date', () => {
  assert.equal(parseArticle(raw).eligible, true);
  for (const input of ['update: 2026-09-18', 'created: 2026-09-18', 'updated: 2026-08-18', 'updated: 2026-09-31', 'updated: 2026-09-18\nupdated: 2026-09-19', '  updated: 2026-09-18']) assert.equal(parseArticle(`---\n${input}\n---\ntext`).eligible, false);
  assert.equal(parseArticle('Updated 2026-09-18').eligible, false);
});
test('cleaning excludes service sections and retains later article sections', () => {
  const p = parseArticle(raw + '\n{{page:image}}\n<!-- secret -->\n## See also\nother\n## History\nRetain\n## Citations\nexternal');
  assert.match(p.article, /Retain/); assert.doesNotMatch(p.article, /secret|other|external|page:image/);
});
test('canonical URL blocks offsite and deduplicates tracking', () => {
  assert.equal(canonicalURL('https://indexmod.press/a?utm=x#foo'), 'https://indexmod.press/a');
  for (const u of ['https://indexmod.press.evil/a', 'http://indexmod.press/a', 'https://indexmod.press/a/b']) assert.throws(() => canonicalURL(u));
});
test('age never collapses a noncentral vector; unknown year is identity', () => {
  const p = semanticPosition({ institutional: 1, underground: 0, commercial: 0, experimental: 0 });
  assert.deepEqual(p, { x: 0, y: 0 });
  assert.deepEqual(ageTransform(p, 1500).position, { x: 0.325, y: 0.325 });
  assert.deepEqual(ageTransform(p, null).position, p);
  assert.deepEqual(ageTransform(p, 2026).position, p);
  assert.equal(semanticPosition(emptyProfile().scores), null);
  assert.equal(semanticPosition({ institutional: 0, underground: 0, commercial: 0, experimental: 0 }), null);
  assert.throws(() => ageTransform(p, 1900, { minScale: 0 }));
});
test('schema and evidence validation', async () => {
  assert.deepEqual(JSON.parse(await readFile(new URL('../schemas/analysis.schema.json', import.meta.url))), schema);
  assert.ok(validateProfile(emptyProfile(), ''));
  const p = emptyProfile(); p.subjectYear = 2007; p.evidence.subjectYear = ['started in 2007'];
  assert.ok(validateProfile(p, 'A project started in 2007.'));
  assert.deepEqual(evidenceWarnings(p, 'unrelated'), ['subjectYear: excerpt is not verbatim']);
  p.scores.commercial = 2; assert.throws(() => validateProfile(p, raw));
});
test('filter runs before inference; cache changes with prompt/content/model/version inputs', async () => {
  const entries = new Map(); const cache = { get: k => entries.get(k), put: (k,v) => entries.set(k,v) };
  let calls = 0;
  const infer = async () => { calls++; return emptyProfile(); };
  const options = { raw, prompt: 'v1', mode: 'hf', model: 'qwen', infer, cache };
  assert.equal((await analyze({ ...options, raw: 'old' })).status, 'skipped'); assert.equal(calls, 0);
  const a = await analyze(options); assert.equal(calls, 1);
  assert.equal((await analyze(options)).cacheHit, true); assert.equal(calls, 1);
  for (const change of [{ prompt: 'v2' }, { raw: raw + 'more' }, { model: 'another' }, { endpoint: 'another' }, { mode: 'dry-run' }]) assert.notEqual((await analyze({ ...options, ...change })).cacheKey, a.cacheKey);
  assert.equal((await analyze({ raw, prompt: 'v1' })).result.confidence, 0);
});
test('published run isolates errors, preserves positions and deduplicates', async () => {
  const cards = [{ title: 'A', link: 'https://indexmod.press/a', nx: .7, ny: .2 }, { link: 'https://indexmod.press/a?utm=x' }, { link: 'https://evil.test/a' }];
  const before = JSON.stringify(cards);
  const report = await runPublished({ cards, prompt: 'p', fetcher: async () => Response.json({ raw }) });
  assert.equal(report.results.length, 2); assert.equal(report.results[1].status, 'error'); assert.equal(JSON.stringify(cards), before);
});
test('HF request configuration and failures', async () => {
  assert.throws(() => huggingFace({}));
  const adapter = huggingFace({ HF_TOKEN: 'test' }, async (url, options) => {
    assert.equal(JSON.parse(options.body).model, 'Qwen/Qwen3-4B-Instruct-2507:nscale');
    assert.equal(options.redirect, 'error');
    return Response.json({ choices: [{ message: { content: JSON.stringify(emptyProfile()) }, finish_reason: 'stop' }] });
  });
  assert.deepEqual(await adapter.infer({ prompt: 'p', article: 'a', schema }), emptyProfile());
});
test('Cloudflare Workers AI returns structured profile', async () => {
  let calls = 0;
  const adapter = cloudflareAI({ AI: { run: async (model, input) => {
    calls++;
    assert.equal(model, '@cf/meta/llama-3.1-8b-instruct');
    assert.equal(input.response_format.type, 'json_schema');
    return { response: emptyProfile() };
  } } });
  assert.deepEqual(await adapter.infer({ prompt: 'p', article: 'a', schema }), emptyProfile());
  assert.equal(calls, 1);
});
