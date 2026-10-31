import { useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  FlaskConical,
  GitBranch,
  Network,
  Play,
  Settings2,
  Upload,
  X,
} from 'lucide-react';
import CompanyMemory from './App';
import {
  companies,
  relationships,
  developments,
  shocks,
  exposurePaths,
} from './lib/shock-data.mjs';
import type { Relationship } from './lib/shock-data.mjs';
import { parsePrices, runBacktest, samplePrices, validDate } from './lib/backtest.mjs';
import type { Price, TestInput, TestResult } from './lib/backtest.mjs';
import './shock-lab.css';

type Run = TestResult & {
  executor: string;
  input: TestInput;
  dataset: string;
  hypothesis: string;
  runAt: string;
};
type Paper = {
  id: string;
  frozenAt: string;
  hypothesis: string;
  root: string;
  asOf: string;
  tickers: string[];
  direction: string;
  capital: number;
  costBps: number;
};
const money = (v: number) =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const percent = (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
function stored<T>(key: string, initial: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? initial;
  } catch {
    return initial;
  }
}
function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Session remains functional. */
  }
}
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function ShockLab() {
  const [memory, setMemory] = useState(false);
  const [tab, setTab] = useState('Investigate');
  const [shockId, setShockId] = useState('capex');
  const shock = shocks.find((s) => s.id === shockId)!;
  const [asOf, setAsOf] = useState('2024-03-19');
  const [selected, setSelected] = useState('foundry');
  const [maxHops, setMaxHops] = useState(2);
  const [remoteGraph, setRemoteGraph] = useState<{
    root: string;
    asOf: string;
    edges: Relationship[];
  } | null>(null);
  const remoteEdges =
    remoteGraph?.root === shock.subject && remoteGraph?.asOf === asOf ? remoteGraph.edges : null;
  const setRemoteEdges = (value: Relationship[] | null) =>
    setRemoteGraph(value ? { root: shock.subject, asOf, edges: value } : null);
  const edges = remoteEdges ?? relationships;
  const paths = useMemo(
    () => exposurePaths(shock.subject, asOf, maxHops, edges),
    [shock.subject, asOf, maxHops, edges],
  );
  const visible = edges.filter(
    (e) => e.published <= asOf && paths.some((p) => p.edges.includes(e.id)),
  );
  const evidence = visible.find((e) => e.id === selected) ?? visible[0];
  const [hypothesis, setHypothesis] = useState(shocks[0].hypothesis);
  const [tickers, setTickers] = useState(['NVDA', 'TSM', 'DELL']);
  const [end, setEnd] = useState('2024-06-20');
  const [capital, setCapital] = useState(10000);
  const [costBps, setCostBps] = useState(10);
  const [direction, setDirection] = useState('long');
  const [prices, setPrices] = useState<Price[]>(samplePrices);
  const [dataset, setDataset] = useState('Synthetic demonstration');
  const [isSample, setIsSample] = useState(true);
  const [executor, setExecutor] = useState('browser');
  const [run, setRun] = useState<Run | null>(null);
  const [runs, setRuns] = useState<Run[]>(() => stored('thesis:shock-runs:v1', []));
  const [papers, setPapers] = useState<Paper[]>(() => stored('thesis:paper:v1', []));
  const [paperResult, setPaperResult] = useState<{
    id: string;
    result: TestResult;
    dataset: string;
  } | null>(null);
  const [settings, setSettings] = useState(false);
  const [api, setApi] = useState(() => stored('thesis:api:v1', import.meta.env.VITE_API_URL || ''));
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [health, setHealth] = useState<{
    neo4j: boolean;
    daytona: boolean;
    nosana: boolean;
  } | null>(null);
  const [explanation, setExplanation] = useState<{
    text: string;
    root: string;
    asOf: string;
  } | null>(null);
  async function request(path: string, body?: unknown) {
    if (!api.trim())
      throw new Error(
        'Open Connections and add your Railway API URL and session token. The local lab does not need them.',
      );
    const url = new URL(api);
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))
    )
      throw new Error('Use an HTTPS API URL, or localhost for development.');
    if (!token) throw new Error('Enter your session API token in Connections.');
    const response = await fetch(`${api.replace(/\/$/, '')}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(150000),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'The backend request failed.');
    return value;
  }
  async function action(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy('');
    }
  }
  function chooseShock(id: string) {
    const next = shocks.find((s) => s.id === id)!;
    setShockId(id);
    setHypothesis(next.hypothesis);
    setRemoteEdges(null);
    setExplanation(null);
  }
  async function execute() {
    await action('Running backtest', async () => {
      if (!hypothesis.trim()) throw new Error('Write a hypothesis before running a test.');
      const available = exposurePaths(shock.subject, asOf, 2);
      if (tickers.some((t) => !available.some((p) => p.company === t)))
        throw new Error(
          'Every basket company must be reachable in the evidence graph at the cutoff.',
        );
      const input = {
        prices,
        tickers,
        benchmark: 'SPY',
        asOf,
        end,
        capital,
        costBps,
        direction,
        root: shock.subject,
      };
      const result =
        executor === 'daytona'
          ? await request('/api/shocks/backtest', input)
          : { ...runBacktest(input), executor: 'browser' };
      setRun({ ...result, input, dataset, hypothesis, runAt: new Date().toISOString() });
    });
  }
  async function upload(file?: File) {
    if (!file) return;
    await action('Reading prices', async () => {
      if (file.size > 700000) throw new Error('Upload a CSV smaller than 700 KB.');
      const rows = parsePrices(await file.text());
      const today = new Date().toISOString().slice(0, 10);
      if (rows.some((p) => p.date > today))
        throw new Error('Price observations cannot be in the future.');
      setPrices(rows);
      setDataset(`Uploaded: ${file.name}`);
      setIsSample(false);
      setRun(null);
      setEnd(
        rows
          .map((p) => p.date)
          .sort()
          .at(-1)!,
      );
      setNotice(
        `Loaded ${rows.length} rows. Prices are user-supplied and have not been independently verified.`,
      );
    });
  }
  function freeze() {
    if (
      !hypothesis.trim() ||
      !tickers.length ||
      !Number.isFinite(capital) ||
      capital < 100 ||
      capital > 10000000 ||
      !Number.isFinite(costBps) ||
      costBps < 0 ||
      costBps > 500
    ) {
      setNotice('Provide a hypothesis, basket, valid capital and costs first.');
      return;
    }
    if (
      !validDate(asOf) ||
      asOf > new Date().toISOString().slice(0, 10) ||
      tickers.some((t) => !exposurePaths(shock.subject, asOf, 2).some((p) => p.company === t))
    ) {
      setNotice('Choose a valid past evidence cutoff with a reachable basket before freezing.');
      return;
    }
    const paper = {
      id: crypto.randomUUID(),
      frozenAt: new Date().toISOString(),
      hypothesis,
      root: shock.subject,
      asOf,
      tickers: [...tickers],
      direction,
      capital,
      costBps,
    };
    const next = [paper, ...papers].slice(0, 20);
    setPapers(next);
    persist('thesis:paper:v1', next);
    setTab('Paper journal');
    setNotice('Hypothesis frozen locally. No money moved and no order was sent.');
  }
  if (memory)
    return (
      <>
        <button className="sl-return" onClick={() => setMemory(false)}>
          ← Return to shock lab
        </button>
        <CompanyMemory />
      </>
    );
  return (
    <div className="sl">
      <aside className="sl-sidebar">
        <a
          className="sl-brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab('Investigate');
          }}
        >
          <span className="sl-mark">t.</span> thesis
          <span className="sl-edition">FIELD LAB / 01</span>
        </a>
        <div className="sl-nav-label">RESEARCH DESK</div>
        <nav aria-label="Research workspace">
          {['Investigate', 'Backtest', 'Paper journal'].map((name, i) => (
            <button
              key={name}
              className={tab === name ? 'active' : ''}
              onClick={() => setTab(name)}
            >
              {i === 0 ? (
                <Network size={17} />
              ) : i === 1 ? (
                <FlaskConical size={17} />
              ) : (
                <GitBranch size={17} />
              )}
              {name}
              <span>0{i + 1}</span>
            </button>
          ))}
        </nav>
        <div className="sl-side-note">
          <span className="sl-live-dot" />
          RESEARCH, NOT SIGNALS
          <p>A connection is a place to investigate. Not a promise of a trade.</p>
        </div>
        <button className="sl-memory-link" onClick={() => setMemory(true)}>
          Company memory <ArrowUpRight size={15} />
        </button>
        <button className="sl-settings" onClick={() => setSettings(true)}>
          <Settings2 size={16} /> Connections
        </button>
        <small>
          Neo4j · Daytona · Nosana
          <br />
          {health ? 'Connection status checked this session' : 'Demo works without credentials'}
        </small>
      </aside>
      <main className="sl-main">
        <header className="sl-top">
          <span>
            WORKSPACE <ChevronRight size={13} /> AI infrastructure
          </span>
          <button onClick={() => setSettings(true)}>
            <span className={`sl-status-dot ${health ? 'connected' : ''}`} />
            {health ? 'API connected' : 'Local research mode'}
            <Settings2 size={14} />
          </button>
        </header>
        <section className="sl-heading">
          <div>
            <div className="sl-kicker">THE MARKET-SHOCK INVESTIGATION LAB</div>
            <h1>
              {tab === 'Investigate' ? (
                <>
                  Follow the shock.
                  <br />
                  <em>Question the trade.</em>
                </>
              ) : tab === 'Backtest' ? (
                <>
                  A hypothesis is not
                  <br />
                  <em>a track record.</em>
                </>
              ) : (
                <>
                  Write it down.
                  <br />
                  <em>Then watch it unfold.</em>
                </>
              )}
            </h1>
          </div>
          <p>
            {tab === 'Investigate'
              ? 'Look past the ticker. Trace the business relationships behind a market move, inspect the evidence, and test your own explanation.'
              : tab === 'Backtest'
                ? 'Define the basket before seeing the result. Test against a benchmark, include costs, and keep the losing runs.'
                : 'Freeze a thesis before new prices arrive. Update it with later observations—not a conveniently chosen past.'}
          </p>
        </section>
        {notice && (
          <div role="status" className="sl-notice">
            {notice}
            <button aria-label="Dismiss message" onClick={() => setNotice('')}>
              <X size={15} />
            </button>
          </div>
        )}
        {tab === 'Investigate' && (
          <>
            <div className="sl-section-title">
              <span>01 / CHOOSE YOUR SCENARIO</span>
              <span>Hypothetical shocks · not breaking news</span>
            </div>
            <div className="sl-shocks">
              {shocks.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => chooseShock(s.id)}
                  className={shockId === s.id ? 'selected' : ''}
                >
                  <span className="sl-number">0{i + 1}</span>
                  <strong>{s.title}</strong>
                  <p>{s.description}</p>
                  <span className="sl-shock-bottom">
                    {s.subject} / SCENARIO{' '}
                    {shockId === s.id ? <Check size={16} /> : <ArrowUpRight size={16} />}
                  </span>
                </button>
              ))}
            </div>
            <div className="sl-replay">
              <div>
                <strong>Replay the evidence</strong>
                <span>What could you have known by this date?</span>
              </div>
              <label>
                Evidence cutoff
                <input
                  type="date"
                  value={asOf}
                  max={new Date().toISOString().slice(0, 10)}
                  onInput={(e) => {
                    if (e.currentTarget.value) {
                      setAsOf(e.currentTarget.value);
                      setRemoteEdges(null);
                      setExplanation(null);
                    }
                  }}
                  onChange={(e) => {
                    if (e.target.value) {
                      setAsOf(e.target.value);
                      setRemoteEdges(null);
                      setExplanation(null);
                    }
                  }}
                />
              </label>
              <label>
                Reach
                <select value={maxHops} onChange={(e) => setMaxHops(+e.target.value)}>
                  <option value={1}>1 connection</option>
                  <option value={2}>2 connections</option>
                </select>
              </label>
            </div>
            <div className="sl-replay-stops">
              {[
                ['2024-03-17', 'Before announcement'],
                ['2024-03-19', 'Blackwell ecosystem'],
                ['2024-07-31', 'Later capex outlook'],
              ].map(([date, label]) => (
                <button
                  key={date}
                  aria-pressed={asOf === date}
                  onClick={() => {
                    setAsOf(date);
                    setRemoteEdges(null);
                    setExplanation(null);
                  }}
                >
                  <span>{date}</span>
                  {label}
                </button>
              ))}
            </div>
            <div className="sl-investigation">
              <section className="sl-graph-panel">
                <div className="sl-panel-heading">
                  <div>
                    <h2>The exposure map</h2>
                    <span>
                      {remoteEdges ? 'NEO4J QUERY' : 'CURATED LOCAL GRAPH'} / {visible.length} dated
                      relationships
                    </span>
                  </div>
                  <button
                    disabled={!!busy}
                    onClick={() =>
                      action('Loading Neo4j graph', async () => {
                        const result = await request(
                          `/api/shocks/graph?root=${shock.subject}&asOf=${asOf}`,
                        );
                        setRemoteEdges(result.relationships);
                      })
                    }
                  >
                    Query Neo4j <ArrowUpRight size={14} />
                  </button>
                </div>
                <div className="sl-graph-wrap">
                  <svg
                    viewBox="0 0 760 420"
                    role="img"
                    aria-label={`Exposure graph for ${shock.subject}. Use the relationship list below to inspect evidence.`}
                  >
                    <defs>
                      <pattern id="grid" width="22" height="22" patternUnits="userSpaceOnUse">
                        <circle cx="1" cy="1" r=".8" fill="#c7c9bd" />
                      </pattern>
                    </defs>
                    <rect width="760" height="420" fill="url(#grid)" />
                    {visible.map((e) => {
                      const a = companies.find((n) => n.id === e.from)!,
                        b = companies.find((n) => n.id === e.to)!;
                      return (
                        <g key={e.id}>
                          <path
                            d={`M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}`}
                            className={e.id === evidence?.id ? 'sl-edge selected' : 'sl-edge'}
                          />
                          <text
                            x={(a.x + b.x) / 2}
                            y={(a.y + b.y) / 2 - 9}
                            className="sl-edge-label"
                          >
                            {e.label}
                          </text>
                        </g>
                      );
                    })}
                    {companies.map((n) => {
                      const reachable = paths.some((p) => p.company === n.id);
                      return (
                        <g
                          key={n.id}
                          className={`sl-node ${n.id === shock.subject ? 'root' : ''} ${reachable ? '' : 'unreachable'}`}
                          transform={`translate(${n.x},${n.y})`}
                        >
                          <rect x="-66" y="-31" width="132" height="62" rx="2" />
                          <text textAnchor="middle" y="-2" className="sl-node-ticker">
                            {n.id}
                          </text>
                          <text textAnchor="middle" y="17" className="sl-node-role">
                            {n.role}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
                <div className="sl-map-legend">
                  <span>
                    <i />
                    Shock subject
                  </span>
                  <span>— Reported / announced relationship</span>
                  <span>No quantified price impact</span>
                </div>
                <div className="sl-paths">
                  {paths
                    .filter((p) => p.edges.length)
                    .map((p) => (
                      <button key={p.company} onClick={() => setSelected(p.edges.at(-1)!)}>
                        <span>{p.nodes.join(' → ')}</span>
                        <small>
                          {p.edges.length} hop{p.edges.length > 1 ? 's' : ''}
                        </small>
                      </button>
                    ))}
                  {visible.length === 0 && (
                    <p>
                      No relationships in this curated set were published by the cutoff. Move the
                      date to March 18, 2024 or later.
                    </p>
                  )}
                </div>
              </section>
              <aside className="sl-evidence">
                <div className="sl-section-title">
                  <span>OPEN THE EVIDENCE</span>
                  <span>↗</span>
                </div>
                <h2>
                  Connections need
                  <br />
                  receipts.
                </h2>
                {visible.length ? (
                  <>
                    <label className="sl-field">
                      Relationship
                      <select value={evidence?.id} onChange={(e) => setSelected(e.target.value)}>
                        {visible.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.from} → {e.to}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="sl-evidence-type">
                      {evidence?.kind === 'reported' ? 'REPORTED FACT' : 'ANNOUNCED PLAN'}
                    </div>
                    <h3>
                      {evidence?.from} → {evidence?.to}
                    </h3>
                    <p>{evidence?.note}</p>
                    <dl>
                      <div>
                        <dt>Published</dt>
                        <dd>{evidence?.published}</dd>
                      </div>
                      <div>
                        <dt>Evidence ID</dt>
                        <dd>{evidence?.id}</dd>
                      </div>
                      <div>
                        <dt>Exposure size</dt>
                        <dd>Not established</dd>
                      </div>
                    </dl>
                    <a href={evidence?.source} target="_blank" rel="noreferrer">
                      Read original announcement <ExternalLink size={14} />
                    </a>
                  </>
                ) : (
                  <p>No eligible source at this cutoff.</p>
                )}
                <div className="sl-caution">
                  <strong>The missing link</strong>
                  <p>{shock.caveat}</p>
                </div>
              </aside>
            </div>
            <div className="sl-bottom-grid">
              <section>
                <div className="sl-section-title">
                  <span>THE RESEARCH TRAIL</span>
                  <span>As of {asOf}</span>
                </div>
                {developments
                  .filter((d) => d.date <= asOf)
                  .map((d) => (
                    <a
                      className="sl-development"
                      key={d.date}
                      href={d.source}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <time>{d.date}</time>
                      <div>
                        <strong>{d.title}</strong>
                        <p>{d.detail}</p>
                      </div>
                      <ArrowUpRight size={17} />
                    </a>
                  ))}
                <p className="sl-footnote">
                  Date-filtered reconstruction from current source pages, not an archived,
                  historically complete feed. Relationship direction is economic context—not a
                  proven causal model.
                </p>
              </section>
              <section className="sl-hypothesis">
                <div className="sl-kicker">FROM CONNECTION TO QUESTION</div>
                <h2>What would you test?</h2>
                <textarea
                  aria-label="Investment hypothesis"
                  value={hypothesis}
                  onChange={(e) => setHypothesis(e.target.value)}
                />
                <div>
                  <button className="sl-primary" onClick={() => setTab('Backtest')}>
                    Build a test <ArrowRight size={16} />
                  </button>
                  <button
                    disabled={!!busy}
                    onClick={() =>
                      action('Requesting Nosana explanation', async () => {
                        const result = await request('/api/shocks/explain', {
                          root: shock.subject,
                          asOf,
                        });
                        setExplanation({ text: result.text, root: shock.subject, asOf });
                      })
                    }
                  >
                    Ask Nosana model <ArrowUpRight size={14} />
                  </button>
                </div>
                {explanation && explanation.root === shock.subject && explanation.asOf === asOf && (
                  <div className="sl-model">
                    <strong>Model-generated · verify against evidence</strong>
                    <p>{explanation.text}</p>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
        {tab === 'Backtest' && (
          <div className="sl-test-grid">
            <section className="sl-test-form">
              <div className="sl-section-title">
                <span>02 / DEFINE THE EXPERIMENT</span>
              </div>
              <label className="sl-field">
                Hypothesis
                <textarea value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} />
              </label>
              <div className="sl-field">
                Basket · equal initial weights
                <div className="sl-ticker-options">
                  {companies.map((c) => (
                    <label key={c.id}>
                      <input
                        type="checkbox"
                        checked={tickers.includes(c.id)}
                        onChange={() =>
                          setTickers(
                            tickers.includes(c.id)
                              ? tickers.filter((t) => t !== c.id)
                              : [...tickers, c.id],
                          )
                        }
                      />
                      {c.id}
                    </label>
                  ))}
                </div>
              </div>
              <label className="sl-field">
                Strategy
                <select value={direction} onChange={(e) => setDirection(e.target.value)}>
                  <option value="long">Buy & hold the basket</option>
                  <option value="cash">Stay in cash · avoid exposure</option>
                </select>
              </label>
              <div className="sl-form-pair">
                <label>
                  Evidence cutoff
                  <input
                    type="date"
                    value={asOf}
                    onInput={(e) => {
                      if (e.currentTarget.value) {
                        setAsOf(e.currentTarget.value);
                        setRemoteEdges(null);
                      }
                    }}
                    onChange={(e) => {
                      if (e.target.value) {
                        setAsOf(e.target.value);
                        setRemoteEdges(null);
                      }
                    }}
                  />
                </label>
                <label>
                  Test end
                  <input
                    type="date"
                    value={end}
                    onInput={(e) => setEnd(e.currentTarget.value)}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </label>
                <label>
                  Starting capital ($)
                  <input
                    type="number"
                    min="100"
                    max="10000000"
                    value={capital}
                    onChange={(e) => setCapital(+e.target.value)}
                  />
                </label>
                <label>
                  Cost per side (bps)
                  <input
                    type="number"
                    min="0"
                    max="500"
                    value={costBps}
                    onChange={(e) => setCostBps(+e.target.value)}
                  />
                </label>
              </div>
              <div className="sl-data-box">
                <strong>{dataset}</strong>
                <p>
                  {isSample
                    ? 'Fabricated prices to demonstrate the workflow. These are NOT actual market returns.'
                    : 'User-supplied prices. Use split/dividend-adjusted series consistently for every ticker and SPY.'}
                </p>
                <label className="sl-upload">
                  <Upload size={14} />
                  Upload price CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => {
                      void upload(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
                <button
                  onClick={() => {
                    setPrices(samplePrices());
                    setDataset('Synthetic demonstration');
                    setIsSample(true);
                    setRun(null);
                    setEnd('2024-06-20');
                  }}
                >
                  Use sample
                </button>
                <details>
                  <summary>CSV format & requirements</summary>
                  <pre>
                    date,ticker,close{'\n'}2024-03-20,NVDA,91.25{'\n'}2024-03-20,SPY,520.48
                  </pre>
                  <p>
                    Illustrative rows only. At least two aligned dates after the cutoff for every
                    basket ticker and SPY. Max 10,000 rows / 700 KB. No gaps, duplicates or future
                    dates. Prices are never fetched automatically.
                  </p>
                </details>
              </div>
              <label className="sl-field">
                Execution
                <select value={executor} onChange={(e) => setExecutor(e.target.value)}>
                  <option value="browser">Browser · no credentials required</option>
                  <option value="daytona">Daytona isolated sandbox · requires API</option>
                </select>
              </label>
              <button className="sl-primary" disabled={!!busy} onClick={execute}>
                <Play size={15} />
                {busy || 'Run experiment'}
              </button>
              <button className="sl-freeze" onClick={freeze}>
                Freeze for forward paper tracking <ArrowRight size={15} />
              </button>
            </section>
            <section className="sl-test-output">
              {!run ? (
                <div className="sl-empty">
                  <FlaskConical size={40} strokeWidth={1} />
                  <h2>
                    Evidence first.
                    <br />
                    Results second.
                  </h2>
                  <p>
                    Your experiment will appear here, with benchmark performance, drawdown and every
                    simulated fill.
                  </p>
                  <div className="sl-rule-note">
                    ENTRY RULE / First available close strictly after the evidence cutoff. No
                    rebalancing. Benchmark: SPY.
                  </div>
                </div>
              ) : (
                <Results
                  run={run}
                  save={() => {
                    const next = [run, ...runs].slice(0, 10);
                    setRuns(next);
                    persist('thesis:shock-runs:v1', next);
                    setNotice(
                      'Saved this complete run locally, including input prices and assumptions.',
                    );
                  }}
                />
              )}
            </section>
          </div>
        )}
        {tab === 'Paper journal' && (
          <>
            <div className="sl-journal-intro">
              <div>
                <h2>A record, not a victory lap.</h2>
                <p>
                  Frozen hypotheses and saved experiments stay in this browser. Forward tracking
                  uses uploaded observations after the freeze date. No brokerage connection,
                  automatic quotes or live orders.
                </p>
              </div>
              <button className="sl-primary" onClick={() => setTab('Backtest')}>
                New experiment <ArrowRight size={15} />
              </button>
            </div>
            <h3 className="sl-journal-label">FORWARD PAPER TRACKING / {papers.length}</h3>
            {!papers.length && (
              <p className="sl-empty-row">
                Nothing frozen yet. Define a basket in Backtest and freeze it before the next
                observations arrive.
              </p>
            )}
            {papers.map((p) => (
              <article className="sl-paper" key={p.id}>
                <div>
                  <span className="sl-kicker">FROZEN {new Date(p.frozenAt).toLocaleString()}</span>
                  <h3>{p.hypothesis}</h3>
                  <p>
                    {p.tickers.join(' / ')} ·{' '}
                    {p.direction === 'cash' ? 'Cash' : 'Equal-weight long'} · {money(p.capital)} ·{' '}
                    {p.costBps} bps per side
                  </p>
                  <small>
                    Research cutoff {p.asOf} · Forward prices must be dated after{' '}
                    {p.frozenAt.slice(0, 10)}.
                  </small>
                </div>
                <div>
                  <button
                    disabled={!!busy}
                    onClick={() =>
                      action('Marking paper basket', async () => {
                        if (isSample)
                          throw new Error(
                            'Upload actual later observations in Backtest before marking a forward basket. Synthetic prices cannot mark paper positions.',
                          );
                        const freezeDate = p.frozenAt.slice(0, 10);
                        const today = new Date().toISOString().slice(0, 10);
                        if (
                          today <= freezeDate ||
                          new Set(
                            prices
                              .filter(
                                (row) =>
                                  row.date > freezeDate &&
                                  row.date <= today &&
                                  [...p.tickers, 'SPY'].includes(row.ticker),
                              )
                              .map((row) => row.date),
                          ).size < 2
                        )
                          throw new Error(
                            `Waiting for at least two later price dates after ${freezeDate}. Historical prices cannot mark this newly frozen basket.`,
                          );
                        const result = runBacktest({
                          prices,
                          tickers: p.tickers,
                          benchmark: 'SPY',
                          asOf: p.frozenAt.slice(0, 10),
                          end: new Date().toISOString().slice(0, 10),
                          capital: p.capital,
                          costBps: p.costBps,
                          direction: p.direction,
                        });
                        setPaperResult({ id: p.id, result, dataset });
                      })
                    }
                  >
                    Mark with uploaded CSV
                  </button>
                  <button onClick={() => download(`paper-${p.id}.json`, p)}>
                    <Download size={14} /> Export frozen thesis
                  </button>
                </div>
                {paperResult?.id === p.id && (
                  <div className="sl-paper-mark">
                    Uploaded marks through {paperResult.result.exit}:{' '}
                    {percent(paperResult.result.totalReturn)} · SPY{' '}
                    {percent(paperResult.result.benchmarkReturn)}
                    <p>
                      Hypothetical liquidation value including exit costs; no closing order
                      executed. Prices: {paperResult.dataset}. Re-upload aligned observations to
                      update.
                    </p>
                  </div>
                )}
              </article>
            ))}
            <h3 className="sl-journal-label">SAVED EXPERIMENTS / {runs.length}</h3>
            {runs.length === 0 && (
              <p className="sl-empty-row">
                Save any completed backtest here—including the ones that disprove your idea.
              </p>
            )}
            {runs.map((r, i) => (
              <button
                className="sl-saved-run"
                key={`${r.runAt}-${i}`}
                onClick={() => {
                  setRun(r);
                  setTab('Backtest');
                }}
              >
                <span>
                  {r.hypothesis}
                  <small>
                    {r.dataset} · {r.entry} → {r.exit} · {r.executor}
                  </small>
                </span>
                <strong className={r.totalReturn < 0 ? 'sl-negative' : 'sl-positive'}>
                  {percent(r.totalReturn)}
                </strong>
                <ArrowRight size={17} />
              </button>
            ))}
          </>
        )}
        <footer className="sl-footer">
          <span>THESIS / RESEARCH WITH A PAPER TRAIL</span>
          <span>Relationships ≠ causation. Backtests ≠ future returns.</span>
        </footer>
      </main>
      {settings && (
        <div className="sl-modal-backdrop" onClick={() => setSettings(false)}>
          <section
            className="sl-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Connections"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSettings(false);
              if (e.key === 'Tab') {
                const fields = [
                  ...e.currentTarget.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), input, select, textarea, a[href]',
                  ),
                ];
                const first = fields[0],
                  last = fields.at(-1);
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sl-panel-heading">
              <h2>Connect the research stack</h2>
              <button aria-label="Close connections" onClick={() => setSettings(false)}>
                <X size={19} />
              </button>
            </div>
            <p>
              The local lab works now. Live services need backend credentials in Railway—not in
              frontend code.
            </p>
            <label className="sl-field">
              Railway API URL
              <input
                type="url"
                autoFocus
                placeholder="https://your-service.up.railway.app"
                value={api}
                onChange={(e) => {
                  setApi(e.target.value);
                  setHealth(null);
                  persist('thesis:api:v1', e.target.value);
                }}
              />
            </label>
            <label className="sl-field">
              Session API token
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setHealth(null);
                }}
              />
            </label>
            <small>
              URL is saved locally. Token stays in memory and clears on reload. Uploaded prices are
              sent to Railway/Daytona only when you select sandbox execution.
            </small>
            <button
              className="sl-primary"
              disabled={!!busy}
              onClick={() =>
                action('Testing connection', async () => {
                  setHealth(await request('/api/health'));
                  setNotice('API reachable. Provider statuses are shown in Connections.');
                })
              }
            >
              {busy || 'Test connection'}
            </button>
            <div className="sl-providers">
              {[
                ['Neo4j', health?.neo4j, 'Dated company relationships; query up to two hops.'],
                ['Daytona', health?.daytona, 'Fixed-code backtests in network-blocked sandboxes.'],
                [
                  'Nosana',
                  health?.nosana,
                  'Evidence explanation via a configured GPU model. No model training.',
                ],
              ].map(([name, ready, desc]) => (
                <div key={String(name)}>
                  <strong>{name}</strong>
                  <span>{health ? (ready ? 'Configured' : 'Not configured') : 'Not checked'}</span>
                  <p>{desc}</p>
                </div>
              ))}
            </div>
            <button
              disabled={!!busy}
              onClick={() =>
                action('Seeding Neo4j', async () => {
                  const result = await request('/api/shocks/seed', {});
                  setNotice(
                    `Stored ${result.relationships} curated relationships in Neo4j. Use Query Neo4j to retrieve them.`,
                  );
                })
              }
            >
              Load curated graph into Neo4j
            </button>
            <p className="sl-footnote">
              Idempotent load of this demo dataset only. Provider configuration does not prove a
              live job succeeded; execution errors are never silently replaced with demo results.
            </p>
            {notice && (
              <p role="status" className="sl-modal-notice">
                {notice}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Results({ run, save }: { run: Run; save: () => void }) {
  const values = run.curve.flatMap((p) => [p.equity, p.benchmark]);
  const low = Math.min(...values) * 0.99,
    high = Math.max(...values) * 1.01;
  const points = (key: 'equity' | 'benchmark') =>
    run.curve
      .map(
        (p, i) =>
          `${30 + (i / (run.curve.length - 1)) * 670},${235 - ((p[key] - low) / (high - low)) * 200}`,
      )
      .join(' ');
  return (
    <>
      <div className="sl-result-header">
        <div className="sl-kicker">
          {run.dataset.startsWith('Synthetic')
            ? 'SYNTHETIC DEMO / NOT HISTORICAL PERFORMANCE'
            : 'USER-SUPPLIED DATA / NOT INDEPENDENTLY VERIFIED'}
        </div>
        <h2>
          {run.input.direction === 'cash' ? 'Cash vs. the market' : 'The basket vs. the market'}
        </h2>
        <p>{run.hypothesis}</p>
        <span>
          {run.executor.toUpperCase()} · {run.engineVersion} · {run.entry} → {run.exit}
        </span>
      </div>
      <div className="sl-metrics">
        {[
          ['Basket return', run.totalReturn],
          ['SPY return', run.benchmarkReturn],
          ['Excess return', run.excessReturn],
          ['Max drawdown', run.maxDrawdown],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <span>{label}</span>
            <strong className={Number(value) < 0 ? 'sl-negative' : 'sl-positive'}>
              {percent(Number(value))}
            </strong>
          </div>
        ))}
      </div>
      <div className="sl-chart">
        <div>
          <span>— Strategy equity</span>
          <span className="sl-benchmark-key">--- SPY equity</span>
          <small>{money(run.input.capital)} initial</small>
        </div>
        <svg
          viewBox="0 0 730 270"
          role="img"
          aria-label={`Equity curve: strategy returned ${percent(run.totalReturn)}, benchmark ${percent(run.benchmarkReturn)}`}
        >
          <line x1="30" y1="235" x2="700" y2="235" stroke="#d7d8ce" />
          <text x="30" y="18">
            {money(high)}
          </text>
          <text x="30" y="260">
            {money(low)}
          </text>
          <polyline
            points={points('benchmark')}
            fill="none"
            stroke="#9a9d90"
            strokeDasharray="5 5"
            strokeWidth="2"
          />
          <polyline points={points('equity')} fill="none" stroke="#496148" strokeWidth="2.5" />
        </svg>
      </div>
      <div className="sl-result-actions">
        <button onClick={save}>Save experiment</button>
        <button onClick={() => download('thesis-experiment.json', run)}>
          <Download size={15} />
          Export inputs & results
        </button>
      </div>
      <details className="sl-method" open>
        <summary>Method & limitations</summary>
        <p>{run.assumptions}</p>
        <p>
          This tests your selected basket, not a validated graph-derived alpha signal. Basket
          selection can still contain hindsight bias. The curated evidence set is small and
          incomplete.
        </p>
      </details>
      <h3 className="sl-journal-label">SIMULATED TRADE LOG / {run.trades.length}</h3>
      <div className="sl-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Ticker</th>
              <th>Side</th>
              <th>Shares</th>
              <th>Price</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {run.trades.map((t, i) => (
              <tr key={i}>
                <td>{t.date}</td>
                <td>{t.ticker}</td>
                <td>{t.side}</td>
                <td>{t.shares.toFixed(4)}</td>
                <td>${t.price.toFixed(2)}</td>
                <td>${t.fee.toFixed(2)}</td>
              </tr>
            ))}
            {run.trades.length === 0 && (
              <tr>
                <td colSpan={6}>Cash strategy: no simulated orders.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
