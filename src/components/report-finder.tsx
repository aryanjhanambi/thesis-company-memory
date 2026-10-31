import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ExternalLink, LoaderCircle, Search } from 'lucide-react';

export type FoundReport = {
  id: string;
  ticker: string;
  title: string;
  period: string;
  form: string;
  date?: string;
  url: string;
  source: string;
};
type Discovery = {
  ticker: string;
  company: string;
  checkedAt?: string;
  reports: FoundReport[];
  sourceUrl?: string;
  note?: string;
  refreshError?: string;
};
export function ReportFinder({
  ticker: initialTicker,
  apiUrl,
  token,
  onUse,
}: {
  ticker: string;
  apiUrl: string;
  token: string;
  onUse: (report: FoundReport, companyName: string) => void;
}) {
  const [ticker, setTicker] = useState(initialTicker);
  const [result, setResult] = useState<Discovery | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'index' | 'live'>('index');
  const [indexedTickers, setIndexedTickers] = useState(['NVDA', 'MSFT']);
  const active = useRef<AbortController | null>(null);
  const search = useCallback(
    async (value: string, live = false) => {
      const symbol = value.trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol)) {
        setError('Enter a ticker such as NVDA or MSFT.');
        return;
      }
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      setLoading(true);
      setError('');
      setResult(null);
      try {
        if (live && apiUrl) {
          const r = await fetch(
            `${apiUrl.replace(/\/$/, '')}/api/reports/discover?ticker=${encodeURIComponent(symbol)}`,
            { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal },
          );
          const data = await r.json();
          if (!r.ok) throw new Error(data.error || 'Live discovery failed.');
          setResult(data);
          setMode('live');
        } else {
          const r = await fetch(`${import.meta.env.BASE_URL}report-index.json`, {
            signal: controller.signal,
          });
          if (!r.ok) throw new Error('The official report index could not be loaded.');
          const index = await r.json();
          setIndexedTickers(
            Object.keys(index.companies || {}).filter(
              (key) => index.companies[key]?.reports?.length,
            ),
          );
          const entry = index.companies?.[symbol];
          if (!entry)
            throw new Error(
              `The deployed index does not cover ${symbol} yet. Connect a backend for live SEC discovery, or search the SEC directly below.`,
            );
          if (!entry.reports?.length)
            throw new Error(
              `${entry.company}: automatic discovery did not return reports. ${entry.refreshError || 'Open the official source directly.'}`,
            );
          setResult(entry);
          setMode('index');
        }
      } catch (err) {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : 'Could not find reports.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [apiUrl, token],
  );
  useEffect(() => {
    void search(initialTicker);
    return () => active.current?.abort();
  }, [initialTicker, search]);
  return (
    <div className="report-finder">
      <p className="modal-description">
        Find reporting documents on official company websites. Select a source to prepare an import,
        or open the original report.
      </p>
      <form
        className="finder-search"
        onSubmit={(e) => {
          e.preventDefault();
          void search(ticker, Boolean(apiUrl));
        }}
      >
        <label htmlFor="report-ticker">Company ticker</label>
        <div>
          <input
            id="report-ticker"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            maxLength={15}
            autoComplete="off"
            placeholder="NVDA"
          />
          <button className="button primary" type="submit" disabled={loading}>
            {loading ? <LoaderCircle size={14} className="spin" /> : <Search size={14} />}Find
            reports
          </button>
        </div>
      </form>
      <div className="finder-shortcuts">
        <span>Indexed companies</span>
        {indexedTickers.map((symbol) => (
          <button
            key={symbol}
            onClick={() => {
              setTicker(symbol);
              void search(symbol);
            }}
          >
            {symbol}
          </button>
        ))}
      </div>
      {loading && (
        <p className="finder-loading" role="status">
          Looking for official reports…
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <>
          <div className="finder-summary">
            <h3>{result.company}</h3>
            <span>{result.reports.length} reports found</span>
          </div>
          <p className="finder-checked">
            {mode === 'live' ? 'Live search' : 'Deployment index'} ·{' '}
            {result.checkedAt
              ? `Checked ${new Date(result.checkedAt).toLocaleString()}`
              : 'Check date unavailable'}
          </p>
          {result.refreshError && (
            <p className="inline-notice">
              The last refresh failed. These are previously discovered links; check their dates
              before use.
            </p>
          )}
          {result.note && <p className="finder-note">{result.note}</p>}
          <div className="finder-results">
            {result.reports.map((report) => (
              <article key={report.id}>
                <div className="finder-report-meta">
                  <span>{report.form}</span>
                  <span>
                    {report.period !== 'Period not specified'
                      ? report.period
                      : 'Check reporting period in source'}
                    {report.date ? ` · ${report.date}` : ''}
                  </span>
                </div>
                <h4>{report.title}</h4>
                <p>
                  {new URL(report.url).hostname} · {report.source}
                </p>
                <div className="finder-report-actions">
                  <a href={report.url} target="_blank" rel="noreferrer">
                    Open report
                    <ExternalLink size={12} />
                  </a>
                  <button onClick={() => onUse(report, result.company)}>
                    Prepare import
                    <ArrowRight size={13} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      <div className="finder-footnote">
        <p>
          The public index is refreshed on deployment. Live SEC search requires the backend because
          SEC does not allow browser API requests. Discovery finds URLs; extracting and analyzing a
          URL still requires the processing backend.
        </p>
        <a
          href={`https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(ticker.trim())}&category=custom&forms=10-K%252C10-Q%252C20-F`}
          target="_blank"
          rel="noreferrer"
        >
          Search SEC EDGAR directly
          <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}
