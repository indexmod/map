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

// Put every card on a distinct ring around the fixed centre mark. The radii
// are deliberately based on the viewport rather than semantic coordinates so
// a new card cannot pull the existing orbit system back into the centre.
export function orbitalPosition(index, count, { width, height, hitSize = 52, margin = 12, logoRatio = 0.18 } = {}) {
  const orbit = orbitalParameters(index, count, { width, height, hitSize, margin, logoRatio });
  return orbit ? orbitalPoint(orbit, 0, { width, height }) : null;
}

// A stable orbital system: each card gets its own radius, tilt, phase and
// angular velocity. The 2D projection is kept for saved state and tests.
export function orbitalParameters(index, count, { width, height, hitSize = 52, margin = 12, logoRatio = 0.18 } = {}) {
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 0 || index >= count || width <= 0 || height <= 0) return null;
  const shortSide = Math.min(width, height);
  const edgeRadius = shortSide / 2 - hitSize / 2 - margin;
  const logoRadius = shortSide * logoRatio;
  const innerRadius = Math.min(logoRadius + hitSize / 2 + 30, edgeRadius);
  const outerRadius = Math.max(innerRadius, edgeRadius);
  const fraction = count === 1 ? .5 : index / (count - 1);
  return {
    radius: innerRadius + (outerRadius - innerRadius) * fraction,
    phase: -Math.PI / 2 + index * 2.399963229728653,
    // One shared plane keeps the rings nested instead of crossing one another.
    tilt: 0.2,
    depth: Math.min(100, shortSide * 0.14),
    // Inner planets move faster, like a compact orbital version of Kepler's law.
    speed: 0.00022 + 0.00011 / Math.sqrt(1 + fraction * 3),
    width,
    height
  };
}

export function orbitalPoint(orbit, time = 0, { width = orbit?.width, height = orbit?.height } = {}) {
  if (!orbit || !(width > 0) || !(height > 0)) return null;
  const angle = orbit.phase + time * orbit.speed;
  const x = width / 2 + Math.cos(angle) * orbit.radius;
  const flatY = Math.sin(angle) * orbit.radius;
  const y = height / 2 + flatY * Math.cos(orbit.tilt);
  const z = Math.sin(angle) * orbit.radius * Math.sin(orbit.tilt) + Math.cos(angle * 2) * orbit.depth * 0.18;
  return {
    x: Math.max(0.015, Math.min(0.985, x / width)),
    y: Math.max(0.025, Math.min(0.975, y / height)),
    z
  };
}

/* Legacy 2D projection helper. */
function legacyOrbitalPosition(index, count, { width, height, hitSize = 52, margin = 12, logoRatio = 0.35 } = {}) {
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 0 || index >= count || width <= 0 || height <= 0) return null;
  const centreX = width / 2;
  const centreY = height / 2;
  const shortSide = Math.min(width, height);
  const logoRadius = shortSide * logoRatio;
  const edgeRadius = shortSide / 2 - hitSize / 2 - margin;
  const innerRadius = Math.min(logoRadius + hitSize / 2 + 24, edgeRadius);
  const outerRadius = Math.max(innerRadius, edgeRadius);
  const fraction = (index + 1) / (count + 1);
  const radius = innerRadius + (outerRadius - innerRadius) * fraction;
  const angle = -Math.PI / 2 + index * 2.399963229728653;
  return {
    x: Math.max(0.015, Math.min(0.985, (centreX + Math.cos(angle) * radius) / width)),
    y: Math.max(0.025, Math.min(0.975, (centreY + Math.sin(angle) * radius) / height))
  };
}

// Pixel-space projection keeps hit areas apart, including at viewport edges.
// Lower weights yield less; a dragged point has weight zero.
export function separatePoints(points, { width, height, margin, distance }) {
  for (const point of points) {
    point.x = Math.max(margin, Math.min(Math.max(margin, width - margin), point.x));
    point.y = Math.max(margin, Math.min(Math.max(margin, height - margin), point.y));
  }
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
        for (const point of [a, b]) {
          point.x = Math.max(margin, Math.min(Math.max(margin, width - margin), point.x));
          point.y = Math.max(margin, Math.min(Math.max(margin, height - margin), point.y));
        }
      }
    }
    if (overlap < .05) break;
  }
  return points;
}
