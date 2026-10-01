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

// Pixel-space projection keeps hit areas apart, including at viewport edges.
// Lower weights yield less; a dragged point has weight zero.
export function separatePoints(points, { width, height, margin, distance }) {
  const bound = point => {
    point.x = Math.max(margin, Math.min(Math.max(margin, width - margin), point.x));
    point.y = Math.max(margin, Math.min(Math.max(margin, height - margin), point.y));
  };
  points.forEach(bound);
  for (let pass = 0; pass < 100; pass++) {
    let overlap = 0;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i], b = points[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        if (length >= distance) continue;
        const wa = a.weight ?? 1, wb = b.weight ?? 1;
        if (wa + wb === 0) continue;
        if (length < .001) {
          const angle = (i * 19 + j * 7) * 2.399963229728653;
          dx = Math.cos(angle); dy = Math.sin(angle);
        } else { dx /= length; dy /= length; }
        const push = distance - length + .01;
        overlap = Math.max(overlap, push);
        a.x -= dx * push * wa / (wa + wb);
        a.y -= dy * push * wa / (wa + wb);
        b.x += dx * push * wb / (wa + wb);
        b.y += dy * push * wb / (wa + wb);
        bound(a); bound(b);
      }
    }
    if (overlap < .05) break;
  }
  return points;
}
