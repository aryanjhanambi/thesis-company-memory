import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { discoverReports, issuers } from '../server/discovery.mjs';
const output = new URL('../public/report-index.json', import.meta.url);
let previous = { companies: {} };
try {
  previous = JSON.parse(await readFile(output, 'utf8'));
} catch {
  /* First run. */
}
const companies = {};
for (const ticker of Object.keys(issuers)) {
  try {
    companies[ticker] = await discoverReports(ticker, { companySitesOnly: true });
    console.log(`${ticker}: discovered ${companies[ticker].reports.length} official reports`);
  } catch (error) {
    companies[ticker] = {
      ...(previous.companies[ticker] || {
        ticker,
        company: issuers[ticker].name,
        reports: [],
        sourceUrl: issuers[ticker].source,
      }),
      sourceUrl: issuers[ticker].source,
      refreshError: error.message,
    };
    console.warn(`${ticker}: ${error.message}`);
  }
}
await mkdir(new URL('../public/', import.meta.url), { recursive: true });
await writeFile(
  output,
  JSON.stringify({ generatedAt: new Date().toISOString(), companies }, null, 2) + '\n',
);
