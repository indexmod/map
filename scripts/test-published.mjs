import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { runPublished } from '../src/analyze.js';
import { huggingFace } from '../src/huggingface.js';
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const mode = option('--mode', 'dry-run');
if (!['dry-run', 'hf'].includes(mode)) throw new Error('Use --mode dry-run or hf');
const snapshot = option('--snapshot');
const saveSnapshot = option('--save-snapshot');
const out = option('--out', 'reports/published.json');
const prompt = await readFile(new URL('../prompts/map-semantic.md', import.meta.url), 'utf8');
const captured = snapshot ? JSON.parse(await readFile(snapshot, 'utf8')) : { capturedAt: new Date().toISOString(), articles: {} };
const getJSON = async url => { const r = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
const state = snapshot ? captured.state : await getJSON('https://map.indexmod.press/api/load');
captured.state = state;
const fetcher = async url => {
  if (snapshot) {
    if (!Object.hasOwn(captured.articles, url)) throw new Error('Article missing from snapshot');
    return Response.json(captured.articles[url]);
  }
  const data = await getJSON(url);
  captured.articles[url] = { raw: data.raw };
  return Response.json(captured.articles[url]);
};
await mkdir('.cache/analysis', { recursive: true });
const cache = {
  get: key => readFile(`.cache/analysis/${key.split(':').pop()}.json`, 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; }),
  put: (key, value) => writeFile(`.cache/analysis/${key.split(':').pop()}.json`, value)
};
const report = await runPublished({ cards: state.cards, prompt, mode, cache, fetcher, ...(mode === 'hf' ? huggingFace(process.env) : {}) });
async function save(path, value) { const { dirname } = await import('node:path'); await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value, null, 2) + '\n'); }
await save(out, report);
if (saveSnapshot) await save(saveSnapshot, captured);
console.table(report.results.map(r => ({ title: r.title, updated: r.updated, status: r.status, cache: r.cacheHit ?? '', error: r.error || '' })));
console.log(`Report: ${out}`);
if (report.results.some(r => r.status === 'error')) process.exitCode = 1;
