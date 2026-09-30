import { parseArticle, canonicalURL, fetchArticle } from './article.js';
import { emptyProfile, validateProfile, schema } from './schema.js';
import { semanticPosition, ageTransform } from './position.js';
export const analyzerVersion = '1.0.0';
export async function hash(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function analyze({ raw, prompt, mode = 'dry-run', cache, infer, model = 'none', endpoint = 'none' }) {
  if (!['dry-run', 'hf'].includes(mode)) throw new Error('Invalid analysis mode');
  const source = parseArticle(raw);
  if (!source.eligible) return { status: 'skipped', updated: source.updated, reason: 'frontmatter.updated must be a valid September 2026 date' };
  const provenance = { analyzerVersion, promptHash: await hash(prompt), contentHash: await hash(raw), mode, model, endpoint };
  const cacheKey = `analysis:v1:${await hash(JSON.stringify(provenance))}`;
  const cached = await cache?.get(cacheKey);
  let result;
  if (cached) {
    try { result = validateProfile(JSON.parse(cached), source.article); } catch { /* Recompute a corrupt cache entry. */ }
  }
  const cacheHit = Boolean(result);
  if (!result) {
    result = validateProfile(mode === 'dry-run' ? emptyProfile() : await infer({ prompt, article: source.article, schema }), source.article);
    await cache?.put(cacheKey, JSON.stringify(result));
  }
  const semantic = semanticPosition(result.scores);
  const transformed = ageTransform(semantic, result.subjectYear);
  return { status: mode === 'dry-run' ? 'dry-run' : 'analyzed', updated: source.updated, ...provenance, cacheKey, cacheHit, result, semanticPosition: semantic, ageScale: transformed.scale, targetPosition: transformed.position };
}
export async function runPublished({ cards, prompt, fetcher = fetch, ...options }) {
  if (!Array.isArray(cards)) throw new Error('Invalid map_state.cards');
  const results = [];
  const seen = new Set();
  for (const card of cards) {
    try {
      const url = canonicalURL(card.link);
      if (seen.has(url)) continue;
      seen.add(url);
      const { raw } = await fetchArticle(url, fetcher);
      results.push({ url, title: card.title, savedPosition: { x: card.nx ?? null, y: card.ny ?? null }, ...await analyze({ raw, prompt, ...options }) });
    } catch (error) { results.push({ url: card.link, title: card.title, status: 'error', error: error.message }); }
  }
  return { generatedAt: new Date().toISOString(), mode: options.mode || 'dry-run', cardsFound: cards.length, results };
}
