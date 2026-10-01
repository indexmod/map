export function canonicalURL(link) {
  const u = new URL(link);
  if (u.protocol !== 'https:' || u.hostname !== 'indexmod.press' || u.port || u.username || u.password || !/^\/[^/]+\/?$/.test(u.pathname)) throw new Error('Invalid Indexmod article URL');
  return `https://indexmod.press/${u.pathname.split('/').filter(Boolean)[0]}`;
}

export function extractPastedArticleLinks(text) {
  const value = String(text || '');
  const candidates = value.match(/https?:\/\/[^\s<>"']+/gi) || [value.trim()];
  const links = new Set();
  for (const candidate of candidates) {
    try {
      const u = new URL(candidate.replace(/[),.;!?]+$/, ''));
      const segments = u.pathname.split('/').filter(Boolean);
      if (u.protocol === 'https:' && u.hostname === 'indexmod.press' && segments.length === 1) {
        links.add(`https://indexmod.press/${segments[0]}`);
      }
    } catch { /* Ignore non-article URLs in pasted text. */ }
  }
  return [...links];
}

export function parseArticle(raw) {
  if (typeof raw !== 'string') throw new Error('Source raw Markdown is missing');
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  // Only a top-level scalar updated in the actual frontmatter is accepted.
  const fields = match ? [...match[1].matchAll(/^updated:[ \t]*(?:"([^"\n]*)"|'([^'\n]*)'|([^#\n]*?))[ \t]*(?:#.*)?$/gm)] : [];
  const updated = fields.length === 1 ? (fields[0][1] ?? fields[0][2] ?? fields[0][3]).trim() : null;
  const eligible = /^2026-09-(?:0[1-9]|[12]\d|30)$/.test(updated || '');
  let article = normalized.slice(match?.[0].length || 0).replace(/<!--[\s\S]*?-->/g, '').replace(/\{\{page:[^}]+\}\}/g, '');
  article = article.replace(/^.*INDEXMOD ADMIN PROMPT[\s\S]*$/mi, '').replace(/^#{1,6}\s+(?:Citations|References|See also)\s*\n[\s\S]*?(?=^#{1,6}\s|$(?![\s\S]))/gmi, '').replace(/^[*_\s]*Updated\s+\d{4}-\d{2}-\d{2}[*_\s]*$/gmi, '').trim();
  return { updated, eligible, article };
}

export async function fetchArticle(link, fetcher = fetch) {
  const url = canonicalURL(link);
  const response = await fetcher(url.replace('indexmod.press/', 'indexmod.press/_get/'), { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Article HTTP ${response.status}`);
  const data = await response.json();
  return { url, raw: data.raw };
}
