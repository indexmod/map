import test from 'node:test';
import assert from 'node:assert/strict';
test('first deployment places validated profiles once and keeps manual positions on later runs', async () => {
  const originalFetch = globalThis.fetch;
  const previous = process.env.HF_TOKEN;
  const state = { cards: [
    { id: 'a', title: 'Example', link: 'https://indexmod.press/example?utm=x', nx: .2, ny: .3 },
    { id: 'b', title: 'Old', link: 'https://indexmod.press/old', nx: .7, ny: .8 }
  ] };
  let inferenceCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url === 'https://map.indexmod.press/api/load') return Response.json(state);
    if (url === 'https://map.indexmod.press/api/save') {
      assert.equal(options.method, 'POST');
      Object.assign(state, JSON.parse(options.body));
      return Response.json({ ok: true });
    }
    if (url === 'https://indexmod.press/_get/example') return Response.json({ raw: '---\nupdated: "2026-09-18"\n---\nAn experimental project founded in 2007.' });
    if (url === 'https://indexmod.press/_get/old') return Response.json({ raw: '---\nupdated: "2026-08-18"\n---\nOld article.' });
    if (url === 'https://router.huggingface.co/v1/chat/completions') {
      inferenceCalls++;
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        subjectType: 'project', subjectYear: 2007,
        scores: { institutional: 0.1, underground: 0.1, commercial: 0.8, experimental: 0.7 },
        confidence: .8,
        evidence: { subjectType: ['project'], subjectYear: ['founded in 2007'], institutional: ['project'], underground: ['project'], commercial: ['project'], experimental: ['experimental'] }
      }) } }] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  process.env.HF_TOKEN = 'test-only';
  try {
    await import('../scripts/apply-published.mjs?first');
    assert.equal(state.semanticBootstrapVersion, 1);
    assert.ok(state.cards[0].nx > .5);
    assert.ok(state.cards[0].analysis);
    assert.deepEqual([state.cards[1].nx, state.cards[1].ny], [.7, .8]);
    state.cards[0].nx = .123;
    await import('../scripts/apply-published.mjs?second');
    assert.equal(state.cards[0].nx, .123);
    assert.equal(inferenceCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.HF_TOKEN;
    else process.env.HF_TOKEN = previous;
  }
});
