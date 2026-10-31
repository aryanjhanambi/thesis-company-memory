import { load } from 'cheerio';
import { createHash } from 'node:crypto';

export const issuers = {
  NVDA: {
    name: 'NVIDIA',
    cik: '1045810',
    source: 'https://nvidianews.nvidia.com/news?q=financial%20results',
    hosts: ['nvidianews.nvidia.com', 'investor.nvidia.com'],
  },
  MSFT: {
    name: 'Microsoft',
    cik: '789019',
    source: 'https://www.microsoft.com/en-us/investor/default',
    hosts: ['www.microsoft.com'],
  },
  AAPL: {
    name: 'Apple',
    cik: '320193',
    source: 'https://www.apple.com/newsroom/rss-feed.rss',
    hosts: ['www.apple.com', 'investor.apple.com'],
  },
};
const userAgent =
  'ThesisCompanyMemory/1.0 (https://github.com/aryanjhanambi/thesis-company-memory)';
const cache = new Map();
export function normalizeTicker(value) {
  const ticker = String(value || '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(ticker))
    throw Object.assign(new Error('Enter a valid company ticker, such as NVDA.'), { status: 400 });
  return ticker;
}
const idFor = (url) => createHash('sha256').update(url.toLowerCase()).digest('hex').slice(0, 20);
export function reportingPeriod(text) {
  let match = text.match(/FY[-\s]?(\d{4})[-\s]Q([1-4])/i);
  if (match) return `Q${match[2]} FY${match[1]}`;
  match = text.match(/(first|second|third|fourth)[-\s]quarter.*?fiscal[-\s](\d{4})/i);
  if (match)
    return `Q${['first', 'second', 'third', 'fourth'].indexOf(match[1].toLowerCase()) + 1} FY${match[2]}`;
  match = text.match(/(?:fourth[-\s]quarter[-\s]and[-\s])?fiscal[-\s](\d{4})/i);
  return match ? `FY${match[1]}` : 'Period not specified';
}
export function parseIssuerReports(html, ticker, config) {
  const $ = load(html, { xmlMode: /<(?:rss|feed)\b/i.test(html) }),
    found = new Map();
  $('item, entry').each((_i, item) => {
    const source = $(item),
      href = source.find('link').first().attr('href') || source.find('link').first().text().trim();
    if (href)
      $.root().append(
        $('<a></a>')
          .attr('href', href)
          .attr('data-published', source.find('pubDate, published, updated').first().text())
          .text(source.find('title').first().text()),
      );
  });
  $('a[href]').each((_i, element) => {
    const a = $(element);
    let url;
    try {
      url = new URL(a.attr('href'), config.source);
    } catch {
      return;
    }
    if (url.protocol !== 'https:' || !config.hosts.includes(url.hostname) || url.search || url.hash)
      return;
    const path = decodeURIComponent(url.pathname);
    const text = a.text().replace(/\s+/g, ' ').trim();
    const combined = `${text} ${path}`;
    if (/conference[-\s]call|sets?[-\s].*results|release[-\s]date|sharer|share\//i.test(combined))
      return;
    const microsoft = /\/earnings\/fy-?\d{4}-q[1-4]\/press-release-webcast\/?$/i.test(path);
    const earnings =
      /announces?[-\s]financial[-\s]results|reports?[-\s](?:first|second|third|fourth)[-\s]quarter[-\s]results/i.test(
        combined,
      );
    const annual =
      /annual[-\s]report/i.test(text) &&
      /\d{4}/.test(path + text) &&
      !/proxy|sustainab|environment|responsib/i.test(combined);
    if (!microsoft && !earnings && !annual) return;
    const period = reportingPeriod(path + ' ' + text);
    let title = text;
    if (microsoft) title = `${config.name} ${period} earnings release`;
    if (!title || /^read|^view|^download/i.test(title))
      title = path.split('/').filter(Boolean).at(-1).replace(/-/g, ' ');
    const dateRaw =
      a.attr('data-published') ||
      a.closest('article, li, .release, .item').find('time').first().attr('datetime');
    const date =
      dateRaw && !Number.isNaN(Date.parse(dateRaw))
        ? new Date(dateRaw).toISOString().slice(0, 10)
        : undefined;
    const key = url.href.toLowerCase();
    const entry = {
      id: idFor(url.href),
      ticker,
      title,
      period,
      form: annual ? 'Annual report' : 'Earnings release',
      url: url.href,
      source: 'Official company website',
      ...(date ? { date } : {}),
    };
    if (!found.has(key) || title.length > found.get(key).title.length) found.set(key, entry);
  });
  return [...found.values()]
    .sort((a, b) => {
      const key = (r) =>
        Number((r.period.match(/FY(\d{4})/) || [])[1] || (r.date || '').slice(0, 4) || 0) * 10 +
        Number((r.period.match(/Q([1-4])/) || [])[1] || 0);
      return key(b) - key(a);
    })
    .slice(0, 12);
}
export function parseSecReports(data, ticker) {
  const recent = data?.filings?.recent;
  if (!recent?.form || !data.cik) throw new Error('SEC returned an unexpected filing index.');
  return recent.form
    .flatMap((form, i) => {
      if (!['10-Q', '10-K', '20-F', '40-F'].includes(form)) return [];
      const accession = recent.accessionNumber[i],
        document = recent.primaryDocument[i];
      if (!/^\d{10}-\d{2}-\d{6}$/.test(accession) || !document || /\.\.|[\\?#]/.test(document))
        return [];
      const url = `https://www.sec.gov/Archives/edgar/data/${Number(data.cik)}/${accession.replaceAll('-', '')}/${document.split('/').map(encodeURIComponent).join('/')}`;
      return [
        {
          id: idFor(url),
          ticker,
          title: `${data.name} — ${form}`,
          form,
          period: recent.reportDate?.[i] || 'Period not specified',
          date: recent.filingDate[i],
          url,
          source: 'SEC EDGAR',
        },
      ];
    })
    .slice(0, 12);
}
async function get(url, fetcher) {
  const hosts = new Set([
    'www.sec.gov',
    'data.sec.gov',
    ...Object.values(issuers).flatMap((i) => i.hosts),
  ]);
  for (let attempt = 0; attempt < 5; attempt++) {
    const target = new URL(url);
    if (
      target.protocol !== 'https:' ||
      !hosts.has(target.hostname) ||
      target.username ||
      target.password ||
      target.port
    )
      throw new Error('Source redirected outside approved official report hosts.');
    let response;
    try {
      response = await fetcher(target.href, {
        headers: { 'User-Agent': userAgent, Accept: 'application/json,text/html' },
        signal: AbortSignal.timeout(15000),
        redirect: 'manual',
      });
    } catch (error) {
      throw new Error(`Source request failed: ${error.cause?.message || error.message}`);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Source redirect did not include a destination.');
      url = new URL(location, target).href;
      continue;
    }
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
    return response;
  }
  throw new Error('Source redirected too many times.');
}
export async function discoverReports(
  rawTicker,
  { fetcher = fetch, companySitesOnly = false } = {},
) {
  const ticker = normalizeTicker(rawTicker),
    config = issuers[ticker];
  const cached = cache.get(`${ticker}:${companySitesOnly}`);
  if (cached && Date.now() - cached.time < 10 * 60 * 1000) return cached.value;
  let secError = '';
  if (!companySitesOnly) {
    try {
      let cik = config?.cik;
      if (!cik) {
        const tickers = await (
          await get('https://www.sec.gov/files/company_tickers.json', fetcher)
        ).json();
        cik = Object.values(tickers).find((item) => item.ticker === ticker)?.cik_str;
      }
      if (!cik)
        throw Object.assign(new Error('No SEC-listed company matched that ticker.'), {
          status: 404,
        });
      const data = await (
        await get(
          `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`,
          fetcher,
        )
      ).json();
      const value = {
        ticker,
        company: data.name,
        checkedAt: new Date().toISOString(),
        reports: parseSecReports(data, ticker),
        sourceUrl: `https://www.sec.gov/edgar/browse/?CIK=${cik}&owner=exclude`,
      };
      cache.set(`${ticker}:${companySitesOnly}`, { time: Date.now(), value });
      return value;
    } catch (error) {
      secError = error.message;
    }
  }
  if (!config)
    throw Object.assign(new Error(`Live discovery is unavailable for ${ticker}. ${secError}`), {
      status: 502,
    });
  const html = await (await get(config.source, fetcher)).text();
  const reports = parseIssuerReports(html, ticker, config);
  if (!reports.length)
    throw Object.assign(
      new Error(
        'No report links were found on the official source page. Open the source directly or try live SEC discovery.',
      ),
      { status: 502 },
    );
  const value = {
    ticker,
    company: config.name,
    checkedAt: new Date().toISOString(),
    reports,
    sourceUrl: config.source,
    ...(secError
      ? { note: 'SEC lookup was unavailable; results came from the official company website.' }
      : {}),
  };
  cache.set(`${ticker}:${companySitesOnly}`, { time: Date.now(), value });
  return value;
}
