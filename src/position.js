export function semanticPosition(scores) {
  const values = Object.values(scores);
  if (values.length !== 4 || values.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)) return null;
  const { institutional: i, underground: u, commercial: c, experimental: e } = scores;
  const total = i + u + c + e;
  return total ? { x: (c + e) / total, y: (u + e) / total } : null;
}

// Fixed bounds keep one object's target stable when the cohort changes.
export function ageTransform(position, year, { oldestYear = 1900, newestYear = 2026, minScale = 0.35, maxScale = 1 } = {}) {
  if (!(oldestYear < newestYear && minScale > 0 && maxScale >= minScale && maxScale <= 1)) throw new Error('Invalid age configuration');
  if (!position) return { position: null, scale: null };
  const scale = year === null ? 1 : minScale + Math.max(0, Math.min(1, (year - oldestYear) / (newestYear - oldestYear))) * (maxScale - minScale);
  return { position: { x: 0.5 + (position.x - 0.5) * scale, y: 0.5 + (position.y - 0.5) * scale }, scale };
}
