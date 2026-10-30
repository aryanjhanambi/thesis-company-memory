// Deterministic evidence extraction, shared by browser demo and sandbox backend.
// Labels identify topics; they do not claim an LLM has verified the document.
export function extractClaims(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const paragraphs = text
    .replace(/\r/g, '')
    .split(/\n\s*\n|(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25);
  const rules = [
    ['Financials', /revenue|margin|income|cash flow|earnings|profit/i],
    ['Guidance', /expect|outlook|guidance|forecast/i],
    ['Risks', /risk|uncertain|declin|restrict|dependen|headwind/i],
    ['Relationships', /customer|supplier|partner|cloud|platform/i],
    ['Business', /segment|product|launch|production|demand/i],
  ];
  return paragraphs
    .slice(0, 200)
    .map((text, i) => ({
      id: `claim-${i}`,
      text: text.slice(0, 2200),
      category: rules.find(([, re]) => re.test(text))?.[0] || 'Other',
    }));
}
export function compareClaims(before, after) {
  const normalize = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const oldSet = new Set(before.map((c) => normalize(c.text)));
  const newSet = new Set(after.map((c) => normalize(c.text)));
  return {
    added: after.filter((c) => !oldSet.has(normalize(c.text))),
    removed: before.filter((c) => !newSet.has(normalize(c.text))),
    unchanged: after.filter((c) => oldSet.has(normalize(c.text))),
  };
}
export function findEvidence(question, reportList) {
  const terms = [
    ...new Set(
      (question.toLowerCase().match(/[a-z]{3,}/g) || []).map((t) =>
        t === 'margins' ? 'margin' : t,
      ),
    ),
  ].filter(
    (t) =>
      ![
        'the',
        'did',
        'what',
        'does',
        'have',
        'this',
        'that',
        'and',
        'for',
        'with',
        'from',
        'company',
      ].includes(t),
  );
  return reportList
    .flatMap((r) =>
      extractClaims(r.text).map((c) => ({
        ...c,
        reportId: r.id,
        period: r.period,
        score: terms.filter((t) => c.text.toLowerCase().includes(t)).length,
      })),
    )
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
