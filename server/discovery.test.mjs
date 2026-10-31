import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIssuerReports,
  parseSecReports,
  reportingPeriod,
  normalizeTicker,
  issuers,
} from './discovery.mjs';
test('official site discovery excludes calendar announcements, off-site links, and duplicate links', () => {
  const html = `<a href="/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2027">NVIDIA Announces Financial Results for Second Quarter Fiscal 2027</a><a href="/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2027">Read Press Release</a><a href="/news/nvidia-sets-conference-call-for-third-quarter-financial-results">NVIDIA Sets Conference Call for Third-Quarter Financial Results</a><a href="https://evil.example/nvidia-announces-financial-results">NVIDIA Announces Financial Results</a>`;
  const results = parseIssuerReports(html, 'NVDA', issuers.NVDA);
  assert.equal(results.length, 1);
  assert.equal(results[0].period, 'Q2 FY2027');
  assert.equal(new URL(results[0].url).hostname, 'nvidianews.nvidia.com');
  assert.equal(results[0].date, undefined);
});
test('Microsoft report links normalize duplicate case variants and retain fiscal periods', () => {
  const reports = parseIssuerReports(
    '<a href="/en-us/Investor/earnings/FY-2027-Q1/press-release-webcast">View details</a><a href="/en-us/investor/earnings/fy-2027-q1/press-release-webcast">Press release</a><a href="/en-us/Investor/earnings/FY-2027-Q1/metrics">Metrics</a>',
    'MSFT',
    issuers.MSFT,
  );
  assert.equal(reports.length, 1);
  assert.equal(reports[0].period, 'Q1 FY2027');
  assert.match(reports[0].title, /Microsoft/);
});
test('SEC discovery builds original document URLs and excludes unrelated forms', () => {
  const reports = parseSecReports(
    {
      cik: '1045810',
      name: 'NVIDIA',
      filings: {
        recent: {
          form: ['10-Q', '4'],
          accessionNumber: ['0001045810-26-000001', '0001045810-26-000002'],
          primaryDocument: ['nvda.htm', 'form4.htm'],
          filingDate: ['2026-08-28', '2026-08-29'],
          reportDate: ['2026-07-26', ''],
        },
      },
    },
    'NVDA',
  );
  assert.equal(reports.length, 1);
  assert.equal(reports[0].date, '2026-08-28');
  assert.equal(
    reports[0].url,
    'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000001/nvda.htm',
  );
});
test('ticker and period handling avoids invented calendar dates', () => {
  assert.equal(normalizeTicker(' nvda '), 'NVDA');
  assert.throws(() => normalizeTicker('../secret'));
  assert.equal(reportingPeriod('Quarterly results'), 'Period not specified');
});
test('official RSS discovery preserves publication date without guessing fiscal year', () => {
  const reports = parseIssuerReports(
    '<rss><channel><item><title>Apple reports fourth quarter results</title><link>https://www.apple.com/newsroom/2026/10/apple-reports-fourth-quarter-results/</link><pubDate>Thu, 29 Oct 2026 20:30:00 GMT</pubDate></item></channel></rss>',
    'AAPL',
    issuers.AAPL,
  );
  assert.equal(reports.length, 1);
  assert.equal(reports[0].date, '2026-10-29');
  assert.equal(reports[0].period, 'Period not specified');
});
