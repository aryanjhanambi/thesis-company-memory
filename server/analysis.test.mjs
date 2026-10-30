import test from 'node:test';
import assert from 'node:assert/strict';
import { extractClaims, compareClaims, findEvidence } from '../src/lib/analysis.mjs';
import { validateReportUrl } from './services.mjs';
test('keeps exact evidence text and never invents a numeric claim', () => {
  const text =
    'GAAP gross margin fell to 74.6% this quarter. Blackwell entered full production during the period.';
  const claims = extractClaims(text);
  assert.equal(claims.length, 2);
  assert.equal(claims[0].text, 'GAAP gross margin fell to 74.6% this quarter.');
  assert.equal(claims[0].category, 'Financials');
  assert.deepEqual(extractClaims(''), []);
});
test('comparison distinguishes additions, removals, and unchanged passages', () => {
  const a = extractClaims(
    'Revenue increased during the quarter. Gross margin held at 75.1% in the quarter.',
  );
  const b = extractClaims(
    'Revenue increased during the quarter. Gross margin fell to 74.6% in the quarter.',
  );
  const diff = compareClaims(a, b);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.unchanged.length, 1);
  assert.match(diff.added[0].text, /74.6/);
});
test('retrieval preserves source identity and returns no evidence for unknown questions', () => {
  const reports = [
    { id: 'q3', period: 'Q3 FY25', text: 'GAAP gross margin fell to 74.6% this quarter.' },
  ];
  assert.equal(findEvidence('margin', reports)[0].reportId, 'q3');
  assert.deepEqual(findEvidence('dividends', reports), []);
  assert.equal(findEvidence('Did margins improve?', reports)[0].reportId, 'q3');
});
test('report retrieval accepts only approved HTTPS origins', () => {
  const hosts = ['investor.nvidia.com'];
  assert.equal(
    validateReportUrl('https://investor.nvidia.com/report.pdf', hosts),
    'https://investor.nvidia.com/report.pdf',
  );
  for (const url of [
    'http://investor.nvidia.com/report',
    'https://investor.nvidia.com.evil.example/report',
    'https://127.0.0.1/report',
    'https://user:pass@investor.nvidia.com/report',
    'https://investor.nvidia.com:8000/report',
  ])
    assert.throws(() => validateReportUrl(url, hosts));
});
