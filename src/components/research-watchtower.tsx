import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ExternalLink, Pause, Play, Radio, RefreshCw, X } from 'lucide-react';
import { companies } from '../lib/shock-data.mjs';
import './research-watchtower.css';

type Edge = {
  id: string;
  versionId: string;
  from: string;
  to: string;
  label: string;
  note: string;
  quote?: string;
  source: string;
  published: string;
  discoveredAt: string;
  reviewedAt: string;
  status: string;
  effectiveDate?: string;
  sequence?: number;
};
type Candidate = Omit<Edge, 'status' | 'reviewedAt' | 'versionId'> & {
  logicalId: string;
  kind: string;
  status: string;
  change: string;
  before: Edge | null;
  model: string;
  dateProvenance: string;
  reviewReason?: string;
};
type AgentState = {
  scheduleDisabledByEnvironment?: boolean;
  ready: boolean;
  missing: string[];
  storageError: string;
  dailyLimit: number;
  maxSources: number;
  searchesToday: number;
  scope: string[];
  control: {
    enabled: boolean;
    watchlist: string[];
    intervalMinutes: number;
    nextRunAt: number;
    leaseUntil: number;
  } | null;
  runs: {
    id: string;
    status: string;
    startedAt: string;
    finishedAt?: string;
    error?: string;
    sourceCount: number;
    proposalCount: number;
    searchCount: number;
  }[];
  candidates: Candidate[];
  events: { id: string; at: string; kind: string; message: string; runId: string }[];
  current: Edge[];
  lastCheck: { at: string; model: string } | null;
};
type Props = {
  request: (path: string, body?: unknown) => Promise<any>;
  connected: boolean;
  connectionId: string;
  onConnect: () => void;
  onUseGraph: () => Promise<void>;
};
const when = (value?: string | number) =>
  value ? new Date(value).toLocaleString() : 'Not scheduled';
export function ResearchWatchtower({
  request,
  connected,
  connectionId,
  onConnect,
  onUseGraph,
}: Props) {
  const requester = useRef(request);
  requester.current = request;
  const [state, setState] = useState<AgentState | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [watchlist, setWatchlist] = useState(['MSFT', 'NVDA', 'TSM', 'DELL', 'SMCI']);
  const [interval, setIntervalMinutes] = useState(1440);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [checked, setChecked] = useState(false);
  const [reason, setReason] = useState('');
  const [filter, setFilter] = useState('pending');
  const [versions, setVersions] = useState<Edge[] | null>(null);
  const dirty = useRef(false);
  async function load() {
    const next: AgentState = await requester.current('/api/agent/status');
    setState(next);
    if (next.control && !dirty.current) {
      setWatchlist(next.control.watchlist);
      setIntervalMinutes(next.control.intervalMinutes);
    }
    return next;
  }
  useEffect(() => {
    setState(null);
    if (!connected) return;
    let mounted = true;
    const poll = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const next: AgentState = await requester.current('/api/agent/status');
        if (!mounted) return;
        setState(next);
        if (next.control && !dirty.current) {
          setWatchlist(next.control.watchlist);
          setIntervalMinutes(next.control.intervalMinutes);
        }
      } catch (e) {
        if (mounted)
          setMessage(e instanceof Error ? e.message : 'Agent status could not be loaded.');
      }
    };
    void poll();
    const timer = window.setInterval(poll, 10000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [connected, connectionId]);
  async function action(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Agent request failed.');
    } finally {
      setBusy('');
    }
  }
  function inspect(candidate: Candidate) {
    setSelected(candidate);
    setChecked(false);
    setReason('');
    setVersions(null);
  }
  async function review(decision: string) {
    if (!selected) return;
    await action('Saving review', async () => {
      await requester.current(`/api/agent/proposals/${selected.id}/review`, {
        decision,
        expectedVersion: selected.before?.versionId || '',
        reason,
      });
      setSelected(null);
      await load();
      setMessage(
        decision === 'approve'
          ? 'New relationship version committed. Historical evidence was preserved.'
          : 'Proposal rejected. No graph changes were made.',
      );
    });
  }
  const running = state?.runs.find(
    (r) => r.status === 'running' && (state.control?.leaseUntil || 0) > Date.now(),
  );
  const candidates = state?.candidates.filter((c) => filter === 'all' || c.status === filter) || [];
  const pending = state?.candidates.filter((c) => c.status === 'pending').length || 0;
  const needsSetup = !connected || !state?.ready;
  return (
    <div className="rw">
      <div className="rw-operating-line">
        <div>
          <Radio size={15} />
          <span>
            {running
              ? 'RESEARCH RUN IN PROGRESS'
              : state?.ready
                ? state.control?.enabled
                  ? 'SCHEDULED RESEARCH ENABLED'
                  : 'SCHEDULE PAUSED'
                : 'AWAITING CONNECTION / CREDENTIALS'}
          </span>
        </div>
        <span>HUMAN-REVIEWED GRAPH UPDATES</span>
      </div>
      {message && (
        <div className="sl-notice" role="status">
          {message}
          <button aria-label="Dismiss agent message" onClick={() => setMessage('')}>
            <X size={15} />
          </button>
        </div>
      )}
      <section className="rw-controls">
        <div>
          <h2>Your research coverage.</h2>
          <p>
            Official announcements and filings. Six supported companies. New evidence becomes a
            proposal—not an automatic trade.
          </p>
        </div>
        <div className="rw-buttons">
          <button
            disabled={!!busy || !connected}
            onClick={() =>
              action('Checking providers', async () => {
                await requester.current('/api/agent/check', {});
                await load();
                setMessage(
                  'Neo4j initialized, Exa authenticated, and Nosana returned a live inference response. This check used one search.',
                );
              })
            }
          >
            Check live setup
          </button>
          <button
            className="sl-primary"
            disabled={!!busy || !state?.ready || !!running}
            onClick={() =>
              action('Starting scan', async () => {
                await requester.current('/api/agent/scan', {});
                await load();
              })
            }
          >
            <Play size={14} />
            {running ? 'Scanning…' : 'Scan now'}
          </button>
        </div>
      </section>
      <div className="rw-layout">
        <aside className="rw-watchlist">
          <div className="sl-section-title">
            <span>01 / COVERAGE</span>
            <span>90-day search window</span>
          </div>
          {companies.map((c) => (
            <label key={c.id}>
              <input
                type="checkbox"
                checked={watchlist.includes(c.id)}
                onChange={() => {
                  dirty.current = true;
                  setWatchlist(
                    watchlist.includes(c.id)
                      ? watchlist.filter((t) => t !== c.id)
                      : [...watchlist, c.id],
                  );
                }}
              />
              <span>
                {c.name}
                <small>{c.id}</small>
              </span>
            </label>
          ))}
          <label className="sl-field">
            Scan interval
            <select
              value={interval}
              onChange={(e) => {
                dirty.current = true;
                setIntervalMinutes(+e.target.value);
              }}
            >
              <option value={60}>Hourly</option>
              <option value={360}>Every 6 hours</option>
              <option value={1440}>Daily · recommended</option>
              <option value={10080}>Weekly</option>
              {![60, 360, 1440, 10080].includes(interval) && (
                <option value={interval}>Every {interval} minutes</option>
              )}
            </select>
          </label>
          <button
            disabled={!!busy || !state?.control || !watchlist.length}
            onClick={() =>
              action('Saving schedule', async () => {
                await requester.current('/api/agent/config', {
                  enabled: state?.control?.enabled ?? true,
                  watchlist,
                  intervalMinutes: interval,
                });
                dirty.current = false;
                await load();
                setMessage(
                  'Coverage and schedule saved in Neo4j. Next eligible scan will use this watchlist.',
                );
              })
            }
          >
            Save coverage
          </button>
          <button
            disabled={!!busy || !state?.control || state?.scheduleDisabledByEnvironment}
            onClick={() =>
              action('Updating schedule', async () => {
                await requester.current('/api/agent/config', {
                  enabled: !state?.control?.enabled,
                  watchlist,
                  intervalMinutes: interval,
                });
                dirty.current = false;
                await load();
              })
            }
          >
            {state?.control?.enabled ? <Pause size={13} /> : <Play size={13} />}{' '}
            {state?.control?.enabled ? 'Pause scheduling' : 'Enable scheduling'}
          </button>
          {state?.scheduleDisabledByEnvironment && (
            <p className="sl-footnote">
              Automatic scheduling is disabled by AGENT_ENABLED=false in Railway. Manual scans
              remain available.
            </p>
          )}
          <dl>
            <div>
              <dt>Next scheduled scan</dt>
              <dd>
                {state?.control?.enabled
                  ? state.control.nextRunAt
                    ? when(state.control.nextRunAt)
                    : 'Next worker tick (within a minute)'
                  : 'Paused / not configured'}
              </dd>
            </div>
            <div>
              <dt>Searches today (UTC)</dt>
              <dd>
                {state?.searchesToday || 0} / {state?.dailyLimit || 12}
              </dd>
            </div>
            <div>
              <dt>Sources per run</dt>
              <dd>Up to {state?.maxSources || 6}</dd>
            </div>
          </dl>
          <p className="sl-footnote">
            Limits include manual scans and setup checks. Searches stop at the daily allowance; this
            is a request cap, not a dollar-price guarantee. Pausing prevents future scheduled runs;
            an active run can finish.
          </p>
        </aside>
        <div className="rw-desk">
          {needsSetup && (
            <section className="rw-setup">
              <div className="sl-kicker">CONNECT ONCE / RESEARCH CONTINUES ON RAILWAY</div>
              <h2>Ready for your first scan.</h2>
              <p>
                {!connected
                  ? 'Connect the Railway API with your session token to inspect the worker.'
                  : state?.storageError ||
                    'Add the missing backend credentials below. The worker starts when its required services are configured.'}
              </p>
              <div className="rw-env-list">
                {(state?.missing.length
                  ? state.missing
                  : !connected
                    ? ['API_TOKEN', 'EXA_API_KEY', 'NOSANA_API_KEY', 'NEO4J_URI', 'NEO4J_PASSWORD']
                    : state?.storageError
                      ? ['NEO4J_CONNECTION / SCHEMA PERMISSIONS']
                      : ['Checking worker status…']
                ).map((key) => (
                  <code key={key}>{key}</code>
                ))}
              </div>
              <button onClick={onConnect}>
                Open connections <ArrowRight size={14} />
              </button>
              <p className="sl-footnote">
                Service secrets belong in Railway Variables. A Nosana model is selected from
                currently serving models, or you can specify NOSANA_MODEL. Daytona is needed for
                sandbox tests—not for web monitoring.
              </p>
            </section>
          )}
          <div className="rw-pipeline">
            {[
              ['SEARCH', 'Exa / official sources'],
              ['EXTRACT', 'Nosana / quoted claims'],
              ['COMPARE', 'Neo4j / dated versions'],
              ['REVIEW', 'You / accept or reject'],
            ].map(([name, detail], i) => (
              <div key={name}>
                <span>0{i + 1}</span>
                <strong>{name}</strong>
                <small>{detail}</small>
              </div>
            ))}
          </div>
          <section className="rw-queue">
            <div className="rw-queue-header">
              <div>
                <h2>
                  The change desk <span>{pending} pending</span>
                </h2>
                <p>
                  Sources can be new, duplicated, contradictory or irrelevant. Only approved
                  evidence changes the graph.
                </p>
              </div>
              <button
                disabled={!!busy || !connected}
                aria-label="Refresh research queue"
                onClick={() =>
                  action('Refreshing', async () => {
                    await load();
                  })
                }
              >
                <RefreshCw size={15} />
              </button>
            </div>
            <div className="rw-filters">
              {['pending', 'approved', 'rejected', 'all'].map((value) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {value}
                </button>
              ))}
              <button
                className="rw-open-map"
                disabled={!state?.ready || !!busy}
                onClick={() => action('Loading live graph', onUseGraph)}
              >
                Open approved graph <ArrowRight size={13} />
              </button>
            </div>
            {!candidates.length ? (
              <div className="rw-empty">
                <GitMark />
                <h3>{needsSetup ? 'Waiting for the first scan.' : 'No proposals in this view.'}</h3>
                <p>
                  {needsSetup
                    ? 'Run results, source evidence and proposed graph changes will appear here after the first scan.'
                    : 'A completed scan may legitimately find no usable changes. Check the activity log for rejected sources, duplicates or provider errors.'}
                </p>
              </div>
            ) : (
              candidates.map((c) => (
                <button className="rw-proposal" key={c.id} onClick={() => inspect(c)}>
                  <span className={`rw-change rw-${c.change}`}>{c.change.toUpperCase()}</span>
                  <div>
                    <h3>
                      {c.from} → {c.to}
                      <span>{c.label}</span>
                    </h3>
                    <p>{c.note}</p>
                    <small>
                      Published {c.published} · discovered {when(c.discoveredAt)} · {c.status}
                    </small>
                  </div>
                  <ArrowRight size={16} />
                </button>
              ))
            )}
          </section>
          <section className="rw-activity">
            <div className="sl-section-title">
              <span>02 / WORKER ACTIVITY</span>
              <span>Persisted in Neo4j</span>
            </div>
            {!state?.events.length ? (
              <p className="rw-empty-log">No recorded activity yet.</p>
            ) : (
              state.events.slice(0, 25).map((e) => (
                <div className="rw-event" key={e.id}>
                  <time>{when(e.at)}</time>
                  <span>{e.kind}</span>
                  <p>{e.message}</p>
                </div>
              ))
            )}
          </section>
          {!!state?.runs.length && (
            <section className="rw-runs">
              <div className="sl-section-title">
                <span>03 / RUN HISTORY</span>
                <span>Latest 15</span>
              </div>
              {state.runs.map((r) => (
                <div key={r.id}>
                  <time>{when(r.startedAt)}</time>
                  <strong>
                    {r.status === 'running' && !running ? 'interrupted / lease expired' : r.status}
                  </strong>
                  <span>
                    {r.sourceCount || 0} sources / {r.proposalCount || 0} proposals
                  </span>
                  {r.error && <p>{r.error}</p>}
                </div>
              ))}
              {state.lastCheck && (
                <p className="sl-footnote">
                  Last live setup check: {when(state.lastCheck.at)} · model {state.lastCheck.model}
                </p>
              )}
            </section>
          )}
        </div>
      </div>
      {selected && (
        <div className="sl-modal-backdrop" onClick={() => setSelected(null)}>
          <section
            className="sl-modal rw-diff"
            role="dialog"
            aria-modal="true"
            aria-label="Review graph change"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSelected(null);
              if (e.key === 'Tab') {
                const controls = [
                  ...e.currentTarget.querySelectorAll<HTMLElement>(
                    'button:not(:disabled),input,textarea,a[href]',
                  ),
                ];
                if (e.shiftKey && document.activeElement === controls[0]) {
                  e.preventDefault();
                  controls.at(-1)?.focus();
                } else if (!e.shiftKey && document.activeElement === controls.at(-1)) {
                  e.preventDefault();
                  controls[0]?.focus();
                }
              }
            }}
          >
            <div className="sl-panel-heading">
              <h2>Review the graph diff</h2>
              <button
                autoFocus
                aria-label="Close graph comparison"
                onClick={() => setSelected(null)}
              >
                <X size={17} />
              </button>
            </div>
            <div className="rw-diff-columns">
              <div>
                <span>BEFORE / {selected.before?.status || 'NO RELATIONSHIP'}</span>
                <h3>
                  {selected.before
                    ? `${selected.before.from} → ${selected.before.to}`
                    : 'New connection'}
                </h3>
                <p>
                  {selected.before?.note || 'No previously approved version of this relationship.'}
                </p>
                {selected.before && <small>Version {selected.before.versionId}</small>}
              </div>
              <div>
                <span>PROPOSED / {selected.kind.toUpperCase()}</span>
                <h3>
                  {selected.from} → {selected.to}
                </h3>
                <strong>{selected.label}</strong>
                <p>{selected.note}</p>
              </div>
            </div>
            <blockquote>{selected.quote}</blockquote>
            <a className="rw-source-link" href={selected.source} target="_blank" rel="noreferrer">
              Verify original source <ExternalLink size={13} />
            </a>
            <dl className="rw-diff-dates">
              <div>
                <dt>Published (search metadata)</dt>
                <dd>{selected.published}</dd>
              </div>
              <div>
                <dt>Discovered by this agent</dt>
                <dd>{when(selected.discoveredAt)}</dd>
              </div>
              <div>
                <dt>Effective from (proposed)</dt>
                <dd>{selected.effectiveDate}</dd>
              </div>
              <div>
                <dt>Extraction model</dt>
                <dd>{selected.model}</dd>
              </div>
            </dl>
            <p className="sl-footnote">
              Exact quote matching proves the passage was returned, not that the model's
              interpretation is correct. Check entity identities, relationship direction and dates.
              Approval appends a version; retirement never deletes old evidence.
            </p>
            {selected.status === 'pending' && (
              <>
                <label className="rw-confirm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => setChecked(e.target.checked)}
                  />
                  I checked the source, dates and relationship interpretation.
                </label>
                <label className="sl-field">
                  Review note (optional)
                  <textarea
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <div className="rw-review-actions">
                  <button
                    className="sl-primary"
                    disabled={!checked || !!busy}
                    onClick={() => review('approve')}
                  >
                    <Check size={14} />
                    Approve version
                  </button>
                  <button disabled={!!busy} onClick={() => review('reject')}>
                    Reject proposal
                  </button>
                  <button
                    disabled={!!busy}
                    onClick={() =>
                      action('Refreshing comparison', async () => {
                        const next = await load();
                        const c = next.candidates.find((p) => p.id === selected.id);
                        if (c) inspect(c);
                      })
                    }
                  >
                    Refresh comparison
                  </button>
                </div>
              </>
            )}
            <button
              disabled={!!busy}
              onClick={() =>
                action('Loading history', async () => {
                  const result = await requester.current(
                    `/api/agent/history?id=${encodeURIComponent(selected.logicalId)}`,
                  );
                  setVersions(result.versions);
                })
              }
            >
              Inspect version history
            </button>
            {versions && (
              <div className="rw-history">
                {versions.length ? (
                  versions.map((v) => (
                    <article key={v.versionId}>
                      <strong>
                        {v.status} / {v.label}
                      </strong>
                      <p>{v.note}</p>
                      <small>
                        Published {v.published} · discovered {when(v.discoveredAt)} · approved{' '}
                        {when(v.reviewedAt)}
                      </small>
                    </article>
                  ))
                ) : (
                  <p>No approved versions yet.</p>
                )}
              </div>
            )}
            {message && (
              <p role="status" className="sl-modal-notice">
                {message}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function GitMark() {
  return (
    <svg width="35" height="35" viewBox="0 0 35 35" aria-hidden="true">
      <path d="M8 6v23M8 18c0-8 18-1 18-12" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="6" r="3" fill="#f7f6f0" stroke="currentColor" />
      <circle cx="8" cy="29" r="3" fill="#f7f6f0" stroke="currentColor" />
      <circle cx="26" cy="6" r="3" fill="#f7f6f0" stroke="currentColor" />
    </svg>
  );
}
