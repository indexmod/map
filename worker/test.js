// Separate entry point: no production UI or map_state writes.
import prompt from '../prompts/map-semantic.md';
import { runPublished } from '../src/analyze.js';
import { huggingFace } from '../src/huggingface.js';
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname !== '/api/test-published') return new Response('not found', { status: 404 });
    if (req.method !== 'POST') return new Response('Use POST', { status: 405 });
    if (!env.ANALYZER_TEST_TOKEN || req.headers.get('Authorization') !== `Bearer ${env.ANALYZER_TEST_TOKEN}`) return new Response('Unauthorized', { status: 401 });
    const mode = url.searchParams.get('mode') || 'dry-run';
    if (!['dry-run', 'hf'].includes(mode)) return new Response('Invalid mode', { status: 400 });
    try {
      const response = await fetch('https://map.indexmod.press/api/load', { redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Map HTTP ${response.status}`);
      const state = await response.json();
      // Bound subrequests and optional inference costs; paginate large maps.
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || 20);
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 20) return new Response('Invalid pagination', { status: 400 });
      if (!Array.isArray(state.cards)) throw new Error('Invalid published state');
      const report = await runPublished({ cards: state.cards.slice(offset, offset + limit), prompt, mode, cache: env.ANALYSIS_CACHE, ...(mode === 'hf' ? huggingFace(env) : {}) });
      return Response.json({ ...report, totalCards: state.cards.length, nextOffset: offset + limit < state.cards.length ? offset + limit : null }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { return Response.json({ error: error.message }, { status: 502 }); }
  }
};
