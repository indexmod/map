// One-time placement on the first production deploy. Manual positions remain
// authoritative on later deploys; the map button can reanalyze on demand.
import { readFile } from 'node:fs/promises';
import { runPublished } from '../src/analyze.js';
import { huggingFace } from '../src/huggingface.js';
const base = process.env.MAP_URL || 'https://map.indexmod.press';
const getState = async () => {
  const response = await fetch(`${base}/api/load`, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Map load HTTP ${response.status}`);
  return response.json();
};
const initial = await getState();
if (initial.semanticBootstrapVersion === 1) {
  console.log('Initial semantic placement already completed; manual positions preserved.');
  process.exit(0);
}
if (!Array.isArray(initial.cards) || !initial.cards.length) throw new Error('No published cards to analyze');
const prompt = await readFile(new URL('../prompts/map-semantic.md', import.meta.url), 'utf8');
const report = await runPublished({ cards: initial.cards, prompt, mode: 'hf', ...huggingFace(process.env) });
const results = new Map(report.results.filter(item => item.status === 'analyzed').map(item => [item.url, item]));
const errors = report.results.filter(item => item.status === 'error');
const latest = await getState();
if (latest.semanticBootstrapVersion === 1) {
  console.log('Another placement already completed; no changes saved.');
  process.exit(0);
}
const original = new Map(initial.cards.map(card => [card.id, card]));
let placed = 0, profiled = 0;
const cards = latest.cards.map(card => {
  const before = original.get(card.id);
  if (!before || before.nx !== card.nx || before.ny !== card.ny || card.analysis) return card;
  let url;
  try { const u = new URL(card.link); url = `${u.origin}${u.pathname.replace(/\/$/, '')}`; } catch { return card; }
  const analysis = results.get(url);
  if (!analysis) return card;
  profiled++;
  if (!analysis.targetPosition) return { ...card, analysis };
  placed++;
  return { ...card, analysis, nx: Number(analysis.targetPosition.x.toFixed(6)), ny: Number(analysis.targetPosition.y.toFixed(6)) };
});
console.log(`Model results: ${report.results.length} links, ${profiled} profiles, ${placed} positions, ${errors.length} errors.`);
for (const item of errors) console.error(`${item.url}: ${item.error}`);
if (!profiled) throw new Error('No validated model profiles; map state was not changed');
const response = await fetch(`${base}/api/save`, {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...latest, cards, semanticBootstrapVersion: 1, semanticBootstrappedAt: new Date().toISOString() })
});
if (!response.ok) throw new Error(`Map save HTTP ${response.status}`);
console.log('Initial semantic placement saved; later deploys will preserve manual positions.');
