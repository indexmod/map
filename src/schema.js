export const dimensions = ['institutional', 'underground', 'commercial', 'experimental'];
export const evidenceFields = ['subjectType', 'subjectYear', ...dimensions];
export const subjectTypes = ['person', 'brand', 'company', 'institution', 'publication', 'venue', 'event', 'movement', 'project', 'other', null];
const score = { type: ['number', 'null'], minimum: 0, maximum: 1 };
export const schema = {
  type: 'object', additionalProperties: false,
  required: ['subjectType', 'subjectYear', 'scores', 'confidence', 'evidence'],
  properties: {
    subjectType: { enum: subjectTypes }, subjectYear: { type: ['integer', 'null'], minimum: 1, maximum: 2026 },
    scores: { type: 'object', additionalProperties: false, required: dimensions, properties: Object.fromEntries(dimensions.map(k => [k, score])) },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    evidence: { type: 'object', additionalProperties: false, required: evidenceFields, properties: Object.fromEntries(evidenceFields.map(k => [k, { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 5 }])) }
  }
};
export function emptyProfile() {
  return { subjectType: null, subjectYear: null, scores: Object.fromEntries(dimensions.map(k => [k, null])), confidence: 0, evidence: Object.fromEntries(evidenceFields.map(k => [k, []])) };
}
function exactKeys(value, keys) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|'); }
export function validateProfile(p, article) {
  const unit = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  if (!exactKeys(p, schema.required) || !subjectTypes.includes(p.subjectType) || !(p.subjectYear === null || Number.isInteger(p.subjectYear) && p.subjectYear >= 1 && p.subjectYear <= 2026) || !unit(p.confidence) || !exactKeys(p.scores, dimensions) || !exactKeys(p.evidence, evidenceFields)) throw new Error('Invalid analysis schema');
  for (const key of evidenceFields) {
    const value = dimensions.includes(key) ? p.scores[key] : p[key];
    if (dimensions.includes(key) && value !== null && !unit(value)) throw new Error(`Invalid score: ${key}`);
    const quotes = p.evidence[key];
    if (!Array.isArray(quotes) || quotes.length > 5 || quotes.some(q => typeof q !== 'string' || !q.trim() || !article.includes(q)) || (value === null ? quotes.length !== 0 : quotes.length === 0)) throw new Error(`Invalid evidence: ${key}`);
  }
  if (evidenceFields.every(k => (dimensions.includes(k) ? p.scores[k] : p[k]) === null) && p.confidence !== 0) throw new Error('Unknown profile must have zero confidence');
  return p;
}
