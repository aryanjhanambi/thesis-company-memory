import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Command,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  GitBranch,
  Globe,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Network,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Target,
  TrendingUp,
  Upload,
  X,
} from 'lucide-react';
import { EvidenceMemory } from '@/components/evidence-memory';
import { CompanyTimeline } from '@/components/company-timeline';
import { AnalyticsBento } from '@/components/ui/analytics-bento';
import {
  reports as seedReports,
  initialTheses,
  changes as seedChanges,
  graphNodes,
  graphEdges,
  billions,
  formatDate,
} from '@/lib/data';
import type { Change, Report, ThesisItem, Status } from '@/lib/data';
import { compareClaims, extractClaims, findEvidence } from '@/lib/analysis.mjs';

const tabs = ['Overview', 'Thesis tracker', 'Company memory', 'Reports', 'Financials'] as const;
type Tab = (typeof tabs)[number];
type Company = { id: string; name: string; ticker: string; description: string };
const nvidia = {
  id: 'nvda',
  name: 'NVIDIA',
  ticker: 'NVDA',
  description: 'Semiconductors · NASDAQ',
};
function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* App remains usable without persistence. */
    }
  }, [value, key]);
  return [value, setValue] as const;
}
function Badge({ status }: { status: Status }) {
  return (
    <span
      className={`badge ${status === 'Supported' ? 'positive' : status === 'Needs review' ? 'warning' : 'neutral'}`}
    >
      <span />
      {status}
    </span>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const elements = () =>
      [
        ...ref.current!.querySelectorAll<HTMLElement>(
          'button, input, textarea, select, a[href], [tabindex="0"]',
        ),
      ].filter((e) => !e.hasAttribute('disabled'));
    elements()[0]?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const els = elements();
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handle);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handle);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header>
          <div>
            <h2 id="modal-title">{title}</h2>
          </div>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
function Sparkline({
  values,
  color = '#3e644e',
  label,
}: {
  values: number[];
  color?: string;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const min = Math.min(...values),
    max = Math.max(...values),
    span = max - min || 1;
  const points = values.map((v, i) => [
    12 + (i / Math.max(1, values.length - 1)) * 216,
    60 - ((v - min) / span) * 42,
  ]);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${p.join(',')}`).join(' ');
  const id = label.replace(/\W/g, '');
  return (
    <svg viewBox="0 0 240 78" className="sparkline" role="img" aria-label={label}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop stopColor={color} stopOpacity=".17" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L228,78 L12,78 Z`} fill={`url(#${id})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" />
      {points.map(([x, y], i) => (
        <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <circle cx={x} cy={y} r="12" fill="transparent">
            <title>{values[i]}</title>
          </circle>
          <circle
            cx={x}
            cy={y}
            r={hover === i || i === points.length - 1 ? 3.5 : 0}
            fill={color}
            stroke="white"
            strokeWidth="2"
          />
          {hover === i && (
            <text
              x={Math.min(210, Math.max(30, x))}
              y={Math.max(12, y - 12)}
              textAnchor="middle"
              fontSize="11"
              fill={color}
            >
              {values[i]}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
function MemoryGraph({
  onSelect,
  large = false,
}: {
  onSelect: (id: string) => void;
  large?: boolean;
}) {
  const [filter, setFilter] = useState('All relationships');
  const [selected, setSelected] = useState('nvidia');
  const [zoom, setZoom] = useState(1);
  const visible = (id: string) =>
    filter === 'All relationships' ||
    id === 'nvidia' ||
    (filter === 'Thesis links'
      ? ['margin', 'thesis'].includes(id)
      : ['dc', 'h200', 'aws', 'azure', 'blackwell'].includes(id));
  return (
    <div className={`graph-wrap ${large ? 'large' : ''}`}>
      <div className="graph-toolbar">
        <span>
          <i className="live-dot" /> Evidence-linked memory
        </span>
        <select
          aria-label="Filter graph relationships"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option>All relationships</option>
          <option>Thesis links</option>
          <option>Business ecosystem</option>
        </select>
      </div>
      <svg
        viewBox="0 0 650 365"
        role="img"
        aria-label="Company relationship graph. Select a node to inspect evidence."
      >
        <g transform={`translate(${325 * (1 - zoom)} ${182 * (1 - zoom)}) scale(${zoom})`}>
          {graphEdges
            .filter(([a, b]) => visible(a) && visible(b))
            .map(([a, b, label]) => {
              const source = graphNodes.find((n) => n.id === a)!,
                target = graphNodes.find((n) => n.id === b)!;
              return (
                <g key={a + b}>
                  <line
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={b === 'thesis' ? '#d4ad78' : '#bbbeb0'}
                    strokeWidth="1.5"
                    strokeDasharray={b === 'thesis' ? '5 4' : undefined}
                  />
                  <text
                    x={(source.x + target.x) / 2}
                    y={(source.y + target.y) / 2 - 6}
                    textAnchor="middle"
                    fontSize="9"
                    fill="#939baa"
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          {graphNodes
            .filter((n) => visible(n.id))
            .map((n) => (
              <g
                className="graph-node"
                key={n.id}
                tabIndex={0}
                role="button"
                aria-label={`Inspect ${n.label}`}
                onKeyDown={(e) => {
                  if (['Enter', ' '].includes(e.key)) {
                    e.preventDefault();
                    setSelected(n.id);
                    onSelect(n.change);
                  }
                }}
                onClick={() => {
                  setSelected(n.id);
                  onSelect(n.change);
                }}
              >
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.id === 'nvidia' ? 35 : 25}
                  fill={
                    n.id === 'nvidia'
                      ? '#edf5e7'
                      : n.id === 'thesis' || n.id === 'margin'
                        ? '#fff7e9'
                        : '#f6f4ed'
                  }
                  stroke={
                    selected === n.id
                      ? '#7fa462'
                      : n.id === 'margin' || n.id === 'thesis'
                        ? '#e2c89e'
                        : '#c2c6b7'
                  }
                  strokeWidth={selected === n.id ? 2 : 1}
                />
                {n.id === 'nvidia' ? (
                  <text
                    x={n.x}
                    y={n.y + 6}
                    textAnchor="middle"
                    fill="#528232"
                    fontSize="19"
                    fontWeight="650"
                  >
                    N
                  </text>
                ) : (
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r="6"
                    fill={
                      n.id === 'margin' || n.id === 'thesis'
                        ? '#d1a25f'
                        : n.type === 'Product'
                          ? '#758f88'
                          : '#97aec8'
                    }
                  />
                )}
                <text
                  x={n.x}
                  y={n.y + (n.id === 'nvidia' ? 52 : 41)}
                  textAnchor="middle"
                  fill="#475164"
                  fontSize="11"
                  fontWeight="500"
                >
                  {n.label}
                </text>
              </g>
            ))}
        </g>
      </svg>
      <div className="graph-footer">
        <div className="legend">
          <span>
            <i style={{ background: '#a4bb91' }} />
            Company
          </span>
          <span>
            <i style={{ background: '#758f88' }} />
            Business
          </span>
          <span>
            <i style={{ background: '#d1a25f' }} />
            Thesis
          </span>
        </div>
        <div className="zoom-controls">
          <button aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.8, z - 0.1))}>
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.4, z + 0.1))}>
            +
          </button>
        </div>
      </div>
    </div>
  );
}
export default function App() {
  const [tab, setTab] = useState<Tab>('Overview');
  const [companies, setCompanies] = useStored<Company[]>('thesis:companies:v1', [nvidia]);
  const [companyId, setCompanyId] = useState('nvda');
  const company = companies.find((c) => c.id === companyId) || nvidia;
  const [imports, setImports] = useStored<Record<string, Report[]>>('thesis:reports:v1', {});
  const companyReports = useMemo(
    () => [...(companyId === 'nvda' ? seedReports : []), ...(imports[companyId] || [])],
    [companyId, imports],
  );
  const [thesesByCompany, setThesesByCompany] = useStored<Record<string, ThesisItem[]>>(
    'thesis:theses:v1',
    { nvda: initialTheses },
  );
  const theses = thesesByCompany[companyId] || [];
  const setTheses = (items: ThesisItem[]) =>
    setThesesByCompany({ ...thesesByCompany, [companyId]: items });
  const [currentId, setCurrentId] = useState('nvda-q3');
  const [priorId, setPriorId] = useState('nvda-q2');
  const current = companyReports.find((r) => r.id === currentId) || companyReports.at(-1);
  const prior = companyReports.find((r) => r.id === priorId) || companyReports.at(-2);
  const isCurated = current?.id === 'nvda-q3' && prior?.id === 'nvda-q2';
  const comparisons = useMemo<Change[]>(() => {
    if (isCurated) return seedChanges;
    if (!current || !prior || current.id === prior.id) return [];
    const result: Change[] = [];
    for (const metric of ['revenue', 'margin', 'dataCenter'] as const) {
      const a = prior[metric],
        b = current[metric];
      if (a === undefined || b === undefined) continue;
      const name = {
        revenue: 'Revenue',
        margin: 'GAAP gross margin',
        dataCenter: 'Data Center revenue',
      }[metric];
      const value = (n: number) => (metric === 'margin' ? `${n.toFixed(1)}%` : billions(n));
      result.push({
        id: metric,
        title: `${name} ${b >= a ? 'increased' : 'decreased'}`,
        category: 'Financials',
        status: metric === 'margin' && b < a ? 'Needs review' : 'Unresolved',
        summary: `${value(a)} → ${value(b)} between the selected periods.`,
        old: `${name}: ${value(a)}.`,
        next: `${name}: ${value(b)}.`,
        interpretation:
          'Calculated from the selected reports. Review the evidence against your assumptions.',
        section: 'Financial summary',
        metric,
      });
    }
    if (current.imported || prior.imported) {
      const diff = compareClaims(extractClaims(prior.text), extractClaims(current.text));
      diff.added.slice(0, 20).forEach((c, i) =>
        result.push({
          id: `text-${i}`,
          title: 'New passage to review',
          category: c.category,
          status: 'Unresolved',
          summary: c.text.slice(0, 190),
          old:
            diff.removed.find((p) => p.category === c.category)?.text ||
            'No matching passage in the previous report.',
          next: c.text,
          interpretation:
            'Text matching found a new passage. This does not establish a change in business facts. Read both reports in context.',
          section: 'Imported document · Extracted passage',
        }),
      );
    }
    return result;
  }, [current, prior, isCurated]);
  const [filter, setFilter] = useState('All changes');
  const [evidence, setEvidence] = useState<Change | null>(null);
  const [reportView, setReportView] = useState<Report | null>(null);
  const [modal, setModal] = useState<
    'report' | 'thesis' | 'company' | 'settings' | 'search' | 'help' | null
  >(null);
  const [editing, setEditing] = useState<ThesisItem | null>(null);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{
    question: string;
    text: string;
    hits: ReturnType<typeof findEvidence>;
  } | null>(null);
  const [apiUrl, setApiUrl] = useStored('thesis:api:v1', import.meta.env.VITE_API_URL || '');
  const [token, setToken] = useState('');
  const [connection, setConnection] = useState('Not connected');
  const [importText, setImportText] = useState('');
  const [importTitle, setImportTitle] = useState('');
  const [importPeriod, setImportPeriod] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useStored<Record<string, string>>('thesis:notes:v1', {});
  const [showNotes, setShowNotes] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [expandedChanges, setExpandedChanges] = useState(false);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setModal('search');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  function switchCompany(id: string) {
    setCompanyId(id);
    setTab('Overview');
    setAnswer(null);
    setFilter('All changes');
    setShowNotes(false);
    const list = [...(id === 'nvda' ? seedReports : []), ...(imports[id] || [])];
    setCurrentId(list.at(-1)?.id || '');
    setPriorId(list.at(-2)?.id || '');
  }
  const openEvidence = (id: string) => {
    const change =
      comparisons.find((c) => c.id === id) ||
      (isCurated ? seedChanges.find((c) => c.id === id) : undefined);
    if (change) setEvidence(change);
    else setToast('Choose Q2 FY25 → Q3 FY25 to inspect this historical graph relationship.');
  };
  const count = comparisons.filter((c) => c.status === 'Needs review').length;
  const relevantTheses = isCurated
    ? theses
    : theses.map((t) => ({ ...t, status: 'Unresolved' as Status }));
  const checkedCount = theses.filter((t) => t.reviewed).length;
  function ask(e?: FormEvent, prompt?: string) {
    e?.preventDefault();
    const q = (prompt || question).trim();
    if (!q) return;
    const hits = findEvidence(
      /against|contradict|challenge/i.test(q) && isCurated ? 'margin' : q,
      companyReports,
    );
    let text = hits.length
      ? 'These are the closest matching passages in your company memory. Review their reporting periods and sources before drawing a conclusion.'
      : 'Your company memory does not yet contain evidence that answers this question. Add a relevant report or try a specific metric or product name.';
    if (/margin/i.test(q) && current?.margin !== undefined && prior?.margin !== undefined)
      text = `GAAP gross margin ${current.margin < prior.margin ? 'fell' : 'rose'} from ${prior.margin.toFixed(1)}% (${prior.period}) to ${current.margin.toFixed(1)}% (${current.period}), a ${Math.abs(current.margin - prior.margin).toFixed(1)} percentage-point change. ${current.margin < prior.margin ? 'This challenges a margin-improvement assumption.' : 'This supports a margin-improvement assumption.'} The selected reports do not by themselves establish the cause.`;
    if (/against|contradict|challenge/i.test(q) && isCurated)
      text =
        'Two observations deserve a review of the margin thesis: reported GAAP gross margin fell from 75.1% to 74.6%, and the next-quarter margin outlook midpoint moved down to 73.0%. Strong Data Center growth supports the demand thesis, but does not resolve the margin question.';
    setAnswer({ question: q, text, hits });
    setQuestion('');
  }
  async function readFile(file?: File) {
    if (!file) return;
    setError('');
    if (file.size > 10 * 1024 * 1024) {
      setError('Choose a document smaller than 10 MB.');
      return;
    }
    setBusy(true);
    try {
      let text = '';
      if (file.name.toLowerCase().endsWith('.pdf')) {
        const pdfjs = await import('pdfjs-dist');
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
          .promise;
        if (pdf.numPages > 200) throw new Error('Choose a report of 200 pages or fewer.');
        const pages: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const p = await pdf.getPage(i);
          const c = await p.getTextContent();
          pages.push(c.items.map((item) => ('str' in item ? item.str : '')).join(' '));
        }
        text = pages.join('\n\n');
        await pdf.cleanup();
      } else text = await file.text();
      if (!text.trim())
        throw new Error('No readable text found. For scanned PDFs, paste OCR text instead.');
      setImportText(text.slice(0, 600000));
      setImportTitle(file.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read document.');
    } finally {
      setBusy(false);
    }
  }
  async function addReport(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      let report: Report;
      if (apiUrl && importUrl && !importText.trim()) {
        const response = await fetch(`${apiUrl.replace(/\/$/, '')}/api/reports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            companyId,
            companyName: company.name,
            title: importTitle,
            period: importPeriod,
            url: importUrl,
          }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Backend could not process the report.');
        report = { ...body.report, imported: true, provenance: 'live' };
      } else {
        if (!importText.trim())
          throw new Error(
            'Upload a document or paste report text. Fetching a URL requires a connected backend.',
          );
        const url = importUrl.trim();
        if (url && !/^https:\/\//i.test(url))
          throw new Error('Source links must begin with https://.');
        report = {
          id: crypto.randomUUID(),
          title: importTitle.trim(),
          period: importPeriod.trim(),
          date: new Date().toISOString().slice(0, 10),
          text: importText.trim(),
          url: url || undefined,
          imported: true,
          provenance: 'local',
          claims: extractClaims(importText),
        };
      }
      setImports({ ...imports, [companyId]: [...(imports[companyId] || []), report] });
      setPriorId(current?.id || '');
      setCurrentId(report.id);
      setTab('Reports');
      setAnswer(null);
      setModal(null);
      setImportText('');
      setImportTitle('');
      setImportPeriod('');
      setImportUrl('');
      setToast(
        report.provenance === 'live'
          ? 'Report processed in Daytona and saved to Neo4j.'
          : 'Report added to browser memory. Extracted passages are ready for review.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }
  function exportMemory() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            company,
            reports: companyReports,
            theses,
            notes: notes[companyId] || '',
            exportedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `${company.ticker.toLowerCase()}-company-memory.json`;
    a.click();
    URL.revokeObjectURL(href);
    setToast('Company memory exported.');
  }
  async function syncMemory() {
    setBusy(true);
    setConnection('Loading saved company memory…');
    try {
      const response = await fetch(
        `${apiUrl.replace(/\/$/, '')}/api/companies/${encodeURIComponent(companyId)}/memory`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load memory.');
      const merged = new Map((imports[companyId] || []).map((r) => [r.id, r]));
      for (const r of data.reports || [])
        merged.set(r.id, { ...r, imported: true, provenance: 'live' });
      setImports({ ...imports, [companyId]: [...merged.values()] });
      setConnection(`Loaded ${data.reports.length} reports from Neo4j for ${company.name}.`);
    } catch (err) {
      setConnection(err instanceof Error ? err.message : 'Could not load company memory.');
    } finally {
      setBusy(false);
    }
  }
  const changesVisible = comparisons.filter(
    (c) => filter === 'All changes' || filter === c.category || filter === c.status,
  );
  const close = () => {
    setModal(null);
    setError('');
  };
  const evidenceLink = (report?: Report) =>
    report?.url ? (
      <a className="text-link" href={report.url} target="_blank" rel="noreferrer">
        Open original report <ExternalLink size={12} />
      </a>
    ) : (
      <span className="muted small">Uploaded source · stored in this browser</span>
    );
  const thesisCards = (full = false) => (
    <div className={`thesis-list ${full ? 'full' : ''}`}>
      {relevantTheses.length ? (
        relevantTheses.map((item, i) => (
          <article className="thesis-item" key={item.id}>
            <div className="thesis-number">0{i + 1}</div>
            <div className="thesis-content">
              <div className="thesis-item-top">
                <h3>{item.title}</h3>
                <button
                  className="icon-button"
                  aria-label={`Edit ${item.title}`}
                  onClick={() => {
                    setEditing(item);
                    setModal('thesis');
                  }}
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>
              <p>{item.body}</p>
              <div className="thesis-bottom">
                <Badge status={item.status} />
                <button
                  className="subtle-link"
                  onClick={() => {
                    if (item.evidence.length && isCurated) openEvidence(item.evidence[0]);
                    else
                      setToast('No evidence linked yet. Add reports and review matching passages.');
                  }}
                >
                  {item.evidence.length && isCurated
                    ? `${item.evidence.length} evidence links`
                    : 'Awaiting evidence'}{' '}
                  <ChevronRight size={12} />
                </button>
              </div>
              {full && (
                <button
                  className={`review-toggle ${item.reviewed ? 'done' : ''}`}
                  onClick={() =>
                    setTheses(
                      theses.map((t) => (t.id === item.id ? { ...t, reviewed: !t.reviewed } : t)),
                    )
                  }
                >
                  {item.reviewed ? <CheckCheck size={15} /> : <Check size={15} />}
                  {item.reviewed ? 'Reviewed by you' : 'Mark as reviewed'}
                </button>
              )}
            </div>
          </article>
        ))
      ) : (
        <div className="empty-state">
          <Target />
          <h3>Start with your reasoning</h3>
          <p>Write an assumption you want the evidence to test.</p>
          <button
            className="button primary"
            onClick={() => {
              setEditing(null);
              setModal('thesis');
            }}
          >
            Add an assumption
          </button>
        </div>
      )}
    </div>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab('Overview');
          }}
        >
          <span className="brand-mark">
            t<span>·</span>
          </span>
          thesis<span className="brand-period">.</span>
        </a>
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <button className="sidebar-search" onClick={() => setModal('search')}>
          <Search size={15} />
          Search anything<span>⌘ K</span>
        </button>
        <nav aria-label="Workspace navigation">
          <button
            className={tab === 'Overview' && !showNotes ? 'active' : ''}
            onClick={() => {
              setTab('Overview');
              setShowNotes(false);
            }}
          >
            <LayoutDashboard size={17} />
            Overview
          </button>
          <button
            className={tab === 'Thesis tracker' ? 'active' : ''}
            onClick={() => {
              setTab('Thesis tracker');
              setShowNotes(false);
            }}
          >
            <Target size={17} />
            My theses<span className="nav-count">{theses.length}</span>
          </button>
          <button
            className={tab === 'Reports' ? 'active' : ''}
            onClick={() => {
              setTab('Reports');
              setShowNotes(false);
            }}
          >
            <FolderOpen size={17} />
            Report library
          </button>
          <button className={showNotes ? 'active' : ''} onClick={() => setShowNotes(true)}>
            <BookOpen size={17} />
            Research notes
          </button>
        </nav>
        <div className="sidebar-section-title">
          YOUR COMPANIES
          <button aria-label="Add company" onClick={() => setModal('company')}>
            <Plus size={14} />
          </button>
        </div>
        <div className="company-list">
          {companies.map((c) => (
            <button
              key={c.id}
              className={companyId === c.id ? 'selected' : ''}
              onClick={() => switchCompany(c.id)}
            >
              <span className={`company-avatar ${c.id === 'nvda' ? 'nvda' : ''}`}>
                {c.id === 'nvda' ? <span className="nvidia-glyph">N</span> : c.name[0]}
              </span>
              <span>
                {c.name}
                <small>{c.ticker}</small>
              </span>
              {companyId === c.id && <span className="selection-dot" />}
            </button>
          ))}
        </div>
        <button className="add-company" onClick={() => setModal('company')}>
          <Plus size={14} />
          Add a company
        </button>
        <div className="sidebar-bottom">
          <button className="settings-nav" onClick={() => setModal('settings')}>
            <Settings2 size={16} />
            Connections & settings
          </button>
          <button className="profile" onClick={() => setModal('help')}>
            <FolderOpen size={17} />
            <span>
              My workspace<small>Personal research</small>
            </span>
            <ChevronDown size={14} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            Workspace
            <ChevronRight size={12} />
            <span>Companies</span>
            <ChevronRight size={12} />
            <b>{company.name}</b>
          </div>
          <div className="topbar-right">
            <span className="demo-pill">
              <span />
              Historical demo
            </span>
            <button
              className="icon-button"
              aria-label="Notifications"
              onClick={() => setNoticeOpen(!noticeOpen)}
            >
              <Bell size={17} />
              <i className="notification-dot" />
            </button>
            <button className="icon-button" aria-label="Help" onClick={() => setModal('help')}>
              <CircleHelp size={17} />
            </button>
          </div>
          {noticeOpen && (
            <div className="notification-popover">
              <b>Your review queue</b>
              <p>{count} changes need attention in the selected comparison.</p>
              <button
                className="text-link"
                onClick={() => {
                  setFilter('Needs review');
                  setExpandedChanges(true);
                  setTab('Overview');
                  setNoticeOpen(false);
                }}
              >
                Review changes <ArrowRight size={14} />
              </button>
            </div>
          )}
        </header>
        <main>
          <div className="page-heading">
            <div className="company-heading">
              <span className={`company-logo ${companyId === 'nvda' ? 'nvda' : ''}`}>
                {companyId === 'nvda' ? <span className="nvidia-glyph">N</span> : company.name[0]}
              </span>
              <div>
                <div className="heading-line">
                  <h1>{company.name}</h1>
                  <select
                    className="ticker company-picker"
                    aria-label="Choose company"
                    value={companyId}
                    onChange={(e) =>
                      e.target.value === '__add'
                        ? setModal('company')
                        : switchCompany(e.target.value)
                    }
                  >
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.ticker}
                      </option>
                    ))}
                    <option value="__add">+ Add company</option>
                  </select>
                  <span className="watching">
                    <span />
                    In your memory
                  </span>
                </div>
                <p>
                  {company.description}
                  <span className="dot-separator">·</span>
                  {companyReports.length} reports connected
                </p>
              </div>
            </div>
            <div className="heading-actions">
              <button className="button" onClick={exportMemory}>
                <Download size={14} />
                Export
              </button>
              <button
                className="button primary"
                onClick={() => {
                  setError('');
                  setModal('report');
                }}
              >
                <Plus size={16} />
                Add report
              </button>
            </div>
          </div>
          <div className="page-intro">
            <div>
              <h2>Quarterly review</h2>
              <p>Compare disclosures against the assumptions behind your position.</p>
            </div>
            <div className="comparison-selects">
              <span>Compare</span>
              <select
                aria-label="Earlier report"
                value={prior?.id || ''}
                onChange={(e) => {
                  setPriorId(e.target.value);
                  setAnswer(null);
                }}
                disabled={!companyReports.length}
              >
                {!companyReports.length && <option value="">No reports</option>}
                {companyReports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.period}
                  </option>
                ))}
              </select>
              <ArrowRight size={13} />
              <select
                aria-label="Current report"
                value={current?.id || ''}
                onChange={(e) => {
                  setCurrentId(e.target.value);
                  setAnswer(null);
                }}
                disabled={!companyReports.length}
              >
                {!companyReports.length && <option value="">No reports</option>}
                {companyReports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.period}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="tabs-row">
            <nav aria-label="Company views" className="tabs">
              {tabs.map((t) => (
                <button
                  key={t}
                  className={tab === t && !showNotes ? 'selected' : ''}
                  aria-current={tab === t && !showNotes ? 'page' : undefined}
                  onClick={() => {
                    setTab(t);
                    setShowNotes(false);
                  }}
                >
                  {t}
                  {t === 'Thesis tracker' && <span>{theses.length}</span>}
                </button>
              ))}
            </nav>
            <span className="snapshot-label">
              <span />
              {current ? `Snapshot · ${current.period}` : 'Ready for your first report'}
            </span>
          </div>
          {showNotes ? (
            <section className="panel notes-panel">
              <div className="panel-heading">
                <div>
                  <h2>Research notes</h2>
                  <p>Your private working notes for {company.name}.</p>
                </div>
                <span className="small muted">Saved in this browser</span>
              </div>
              <textarea
                aria-label="Research notes"
                placeholder="What do you believe about this company? What would change your mind?"
                value={notes[companyId] || ''}
                onChange={(e) => setNotes({ ...notes, [companyId]: e.target.value })}
              />
            </section>
          ) : (
            <>
              {tab === 'Overview' && (
                <>
                  {current && prior && current.id !== prior.id && (
                    <div className="review-banner">
                      <p>
                        <strong>{current.period} review</strong> {comparisons.length} changes since{' '}
                        {prior.period}
                        {count > 0 && (
                          <>
                            {' '}
                            · <b>{count} flagged for review</b>
                          </>
                        )}
                      </p>
                      <button
                        onClick={() => {
                          setExpandedChanges(true);
                          document
                            .getElementById('changes-panel')
                            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                      >
                        Review changes
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                  {current && current.revenue !== undefined ? (
                    <div className="metric-grid">
                      <article className="panel metric-card">
                        <div className="metric-top">
                          <span>Total revenue</span>
                          <TrendingUp size={15} />
                        </div>
                        <div className="metric-main">
                          <div>
                            <strong>{billions(current.revenue)}</strong>
                            <p>
                              <span className="metric-delta green">
                                <ArrowUpRight size={13} />
                                {prior?.revenue
                                  ? `${((current.revenue / prior.revenue - 1) * 100).toFixed(1)}%`
                                  : '—'}
                              </span>
                              <span>vs. {prior?.period || 'prior period'}</span>
                            </p>
                          </div>
                          <Sparkline
                            values={companyReports
                              .filter((r) => r.revenue !== undefined && r.date <= current.date)
                              .map((r) => r.revenue!)}
                            label="Reported revenue in USD millions"
                          />
                        </div>
                        <div className="metric-foot">
                          <span>{current.period} · Reported</span>
                          <button
                            aria-label="View revenue evidence"
                            onClick={() => setReportView(current)}
                          >
                            <FileText size={12} />
                            Source
                          </button>
                        </div>
                      </article>
                      <article className="panel metric-card">
                        <div className="metric-top">
                          <span>
                            Gross margin <small>GAAP</small>
                          </span>
                          <Activity size={15} />
                        </div>
                        <div className="metric-main">
                          <div>
                            <strong>
                              {current.margin?.toFixed(1)}
                              <em>%</em>
                            </strong>
                            <p>
                              <span
                                className={`metric-delta ${current.margin! < prior?.margin! ? 'amber' : 'green'}`}
                              >
                                <ArrowDownRight size={13} />
                                {prior?.margin !== undefined
                                  ? `${((current.margin! - prior.margin) * 100).toFixed(0)} bps`
                                  : '—'}
                              </span>
                              <span>vs. {prior?.period || 'prior period'}</span>
                            </p>
                          </div>
                          <Sparkline
                            values={companyReports
                              .filter((r) => r.margin !== undefined && r.date <= current.date)
                              .map((r) => r.margin!)}
                            color="#a16e3c"
                            label="Reported GAAP gross margin percent"
                          />
                        </div>
                        <div className="metric-foot">
                          <span>{current.period} · Reported</span>
                          <button
                            aria-label="View margin evidence"
                            onClick={() => setReportView(current)}
                          >
                            <FileText size={12} />
                            Source
                          </button>
                        </div>
                      </article>
                      <article className="panel metric-card thesis-health">
                        <div className="metric-top">
                          <span>Your thesis review</span>
                          <Target size={15} />
                        </div>
                        <div className="metric-main">
                          <div>
                            <strong>
                              {isCurated
                                ? relevantTheses.filter((t) => t.status === 'Needs review').length
                                : relevantTheses.length}
                              <em className="text-em">to revisit</em>
                            </strong>
                            <p>
                              <span className="amber">
                                {isCurated
                                  ? 'Margin resilience needs attention'
                                  : 'Review against selected reports'}
                              </span>
                            </p>
                          </div>
                          <dl className="review-counts">
                            <div>
                              <dt>Supported</dt>
                              <dd>
                                {relevantTheses.filter((t) => t.status === 'Supported').length}
                              </dd>
                            </div>
                            <div>
                              <dt>Unresolved</dt>
                              <dd>
                                {relevantTheses.filter((t) => t.status === 'Unresolved').length}
                              </dd>
                            </div>
                          </dl>
                        </div>
                        <div className="metric-foot">
                          <span>{theses.length} assumptions tracked</span>
                          <button onClick={() => setTab('Thesis tracker')}>
                            Open tracker
                            <ArrowRight size={12} />
                          </button>
                        </div>
                      </article>
                    </div>
                  ) : (
                    <div className="empty-summary">
                      <BookOpen size={24} />
                      <div>
                        <h3>
                          {current
                            ? 'Your report is in company memory'
                            : 'Every thesis starts with a first report'}
                        </h3>
                        <p>
                          {current
                            ? 'Open Reports to inspect extracted passages, then add another report to compare.'
                            : 'Add a report and write your assumptions to begin building a lasting picture.'}
                        </p>
                      </div>
                      <button className="button" onClick={() => setModal('report')}>
                        Add report
                        <Plus size={14} />
                      </button>
                    </div>
                  )}
                  <div className="dashboard-grid">
                    <section className="panel changes-panel" id="changes-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            What changed <span className="count-pill">{comparisons.length}</span>
                          </h2>
                          <p>
                            {prior && current
                              ? `${prior.period} → ${current.period} · Report comparison`
                              : 'Connect two reports to begin comparing'}
                          </p>
                        </div>
                        <select
                          aria-label="Filter changes"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          {[
                            'All changes',
                            'Needs review',
                            'Financials',
                            'Business',
                            'Guidance',
                            'Relationships',
                            'Risks',
                          ].map((f) => (
                            <option key={f}>{f}</option>
                          ))}
                        </select>
                      </div>
                      <div className="changes-list">
                        {changesVisible.length ? (
                          changesVisible.slice(0, expandedChanges ? 30 : 3).map((c) => (
                            <button
                              className="change-item"
                              key={c.id}
                              onClick={() => setEvidence(c)}
                            >
                              <div>
                                <div className="change-eyebrow">
                                  {c.category}
                                  <span>·</span>
                                  {c.status === 'Needs review'
                                    ? 'Challenges an assumption'
                                    : c.status === 'Supported'
                                      ? 'Supports your thesis'
                                      : 'Keep watching'}
                                </div>
                                <h3>{c.title}</h3>
                                <p>{c.summary}</p>
                                <span className="source-label">
                                  <FileText size={11} />
                                  {current?.period} earnings release
                                  <ChevronRight size={11} />
                                </span>
                              </div>
                              <ArrowUpRight className="change-arrow" size={16} />
                            </button>
                          ))
                        ) : (
                          <div className="empty-state small-empty">
                            <FileText size={24} />
                            <p>
                              {current && prior && current.id === prior.id
                                ? 'Select two different reports to see changes.'
                                : 'No changes match this view.'}
                            </p>
                          </div>
                        )}
                      </div>
                      {changesVisible.length > 3 && (
                        <button
                          className="panel-bottom-link"
                          onClick={() => setExpandedChanges(!expandedChanges)}
                        >
                          {expandedChanges
                            ? 'Show fewer changes'
                            : `See all ${changesVisible.length} changes`}
                          <ArrowRight size={14} />
                        </button>
                      )}
                    </section>
                    <section className="panel thesis-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Your investment thesis</h2>
                          <p>The reasons you wanted to own it.</p>
                        </div>
                        <button
                          className="icon-button"
                          aria-label="Add thesis assumption"
                          onClick={() => {
                            setEditing(null);
                            setModal('thesis');
                          }}
                        >
                          <Plus size={17} />
                        </button>
                      </div>
                      {thesisCards()}
                      <button
                        className="panel-bottom-link"
                        onClick={() => setTab('Thesis tracker')}
                      >
                        Open thesis tracker
                        <ArrowRight size={14} />
                      </button>
                    </section>
                    <section className="panel memory-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Business relationships</h2>
                          <p>Follow a relationship back to its evidence.</p>
                        </div>
                        <button
                          className="icon-button"
                          aria-label="Expand company memory"
                          onClick={() => setTab('Company memory')}
                        >
                          <ArrowUpRight size={18} />
                        </button>
                      </div>
                      {companyId === 'nvda' ? (
                        <MemoryGraph onSelect={openEvidence} />
                      ) : (
                        <EvidenceMemory
                          company={company.name}
                          reports={companyReports}
                          onSelect={setReportView}
                        />
                      )}
                    </section>
                    <section className="panel mix-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Where the revenue comes from</h2>
                          <p>{current?.period || 'Company'} · Business platforms</p>
                        </div>
                        <span className="small muted">USD</span>
                      </div>
                      {current?.dataCenter !== undefined ? (
                        <>
                          <div className="mix-total">
                            <strong>{billions(current.revenue)}</strong>
                            <span>Total reported revenue</span>
                          </div>
                          <div className="segment-bar">
                            {[
                              { value: current.dataCenter, color: '#78967c' },
                              { value: current.gaming!, color: '#9c9c89' },
                              { value: current.visualization!, color: '#c2ac78' },
                              { value: current.auto!, color: '#809a9a' },
                            ].map((s, i) => (
                              <div
                                key={i}
                                style={{
                                  width: `${(s.value / current.revenue!) * 100}%`,
                                  background: s.color,
                                }}
                              />
                            ))}
                          </div>
                          <div className="mix-rows">
                            {[
                              ['Data Center', current.dataCenter, '#78967c'],
                              ['Gaming', current.gaming, '#9c9c89'],
                              ['Professional visualization', current.visualization, '#c2ac78'],
                              ['Automotive', current.auto, '#809a9a'],
                            ].map(([name, value, color]) => (
                              <div key={name}>
                                <span>
                                  <i style={{ background: color as string }} />
                                  {name}
                                </span>
                                <b>{billions(value as number)}</b>
                                <small>
                                  {(((value as number) / current.revenue!) * 100).toFixed(1)}%
                                </small>
                              </div>
                            ))}
                          </div>
                          <div className="mix-note">
                            <p>
                              Data Center contributes{' '}
                              {((current.dataCenter / current.revenue!) * 100).toFixed(1)}% of
                              revenue. Keep concentration in view.
                            </p>
                          </div>
                          <button
                            className="panel-bottom-link"
                            onClick={() => setTab('Financials')}
                          >
                            Explore financials
                            <ArrowRight size={14} />
                          </button>
                        </>
                      ) : (
                        <div className="empty-state">
                          <Activity />
                          <p>
                            Financial charts use verified numeric data. Imported passages remain
                            available in Reports.
                          </p>
                        </div>
                      )}
                    </section>
                  </div>
                </>
              )}
              {tab === 'Thesis tracker' && (
                <section className="panel full-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Investment assumptions</h2>
                      <p>
                        Track assumptions, inspect the evidence, and record your review.{' '}
                        {checkedCount} of {theses.length} reviewed.
                      </p>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => {
                        setEditing(null);
                        setModal('thesis');
                      }}
                    >
                      <Plus size={15} />
                      Add assumption
                    </button>
                  </div>
                  {!isCurated && theses.length > 0 && (
                    <div className="inline-notice">
                      Thesis assessments are unresolved for this report pair. The historical
                      assessments apply to Q2 FY25 → Q3 FY25.
                    </div>
                  )}
                  {thesisCards(true)}
                </section>
              )}
              {tab === 'Company memory' && (
                <section className="panel full-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Company relationship record</h2>
                      <p>
                        Relationships carry evidence and a reporting period. Select a node to
                        inspect its source.
                      </p>
                    </div>
                    <span className="badge neutral">
                      {companyId === 'nvda'
                        ? 'Curated historical graph · Q3 FY25'
                        : 'Document memory'}
                    </span>
                  </div>
                  {companyId === 'nvda' ? (
                    <MemoryGraph large onSelect={openEvidence} />
                  ) : (
                    <EvidenceMemory
                      company={company.name}
                      reports={companyReports}
                      onSelect={setReportView}
                    />
                  )}
                  {companyId === 'nvda' && companyReports.some((r) => r.imported) && (
                    <EvidenceMemory
                      company={company.name}
                      reports={companyReports.filter((r) => r.imported)}
                      onSelect={setReportView}
                    />
                  )}
                  <div className="memory-documents">
                    {companyReports.map((r) => (
                      <button key={r.id} onClick={() => setReportView(r)}>
                        <FileText size={18} />
                        <div>
                          <b>{r.period}</b>
                          <span>{r.title}</span>
                        </div>
                        <ChevronRight size={16} />
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {tab === 'Reports' && (
                <section className="panel full-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Source documents</h2>
                      <p>Original reports and extracted evidence form your company memory.</p>
                    </div>
                    <button className="button" onClick={() => setModal('report')}>
                      <Upload size={15} />
                      Import report
                    </button>
                  </div>
                  <div className="reports-table">
                    <div className="report-table-head">
                      <span>DOCUMENT</span>
                      <span>PERIOD</span>
                      <span>ADDED / PUBLISHED</span>
                      <span>PROVENANCE</span>
                    </div>
                    {[...companyReports].reverse().map((r) => (
                      <button className="report-row" key={r.id} onClick={() => setReportView(r)}>
                        <span>
                          <span className="document-icon">
                            <FileText size={19} />
                          </span>
                          <span>
                            <b>{r.title}</b>
                            <small>{r.url ? new URL(r.url).hostname : 'Uploaded document'}</small>
                          </span>
                        </span>
                        <span>{r.period}</span>
                        <span>{formatDate(r.date)}</span>
                        <span className="report-provenance">
                          {r.imported
                            ? r.provenance === 'live'
                              ? 'Daytona → Neo4j'
                              : 'Browser import'
                            : 'Verified historical source'}
                          <ArrowUpRight size={14} />
                        </span>
                      </button>
                    ))}
                  </div>
                  {!companyReports.length && (
                    <div className="empty-state">
                      <FolderOpen />
                      <p>No reports yet. Upload a PDF or paste the first report.</p>
                    </div>
                  )}
                  <div className="library-footnote">
                    <ShieldCheck size={14} />
                    Imported text is retained. Topic extraction uses deterministic matching;
                    interpret passages in context.
                  </div>
                </section>
              )}
              {tab === 'Financials' &&
                (companyId === 'nvda' ? (
                  <>
                    <div className="financial-intro">
                      <h2>The numbers behind the narrative.</h2>
                      <p>
                        Historical GAAP data · FY25 first through third quarters · USD millions
                        unless stated otherwise
                      </p>
                    </div>
                    <AnalyticsBento
                      credit={false}
                      className="financial-bento"
                      revenue={{
                        label: 'Revenue · Q3 FY25',
                        value: 35082,
                        delta: '16.8%',
                        note: 'USD millions · vs. Q2 FY25',
                        caption: 'Q1 → Q3 FY25',
                        series: seedReports.map((r) => ({ label: r.period, value: r.revenue! })),
                      }}
                      sessions={{
                        label: 'Net income · Q3 FY25',
                        value: 19309,
                        delta: '16.3%',
                        note: 'Reported USD millions · GAAP',
                        pointLabels: ['Q1 FY25', 'Q2 FY25', 'Q3 FY25'],
                        desktop: [[14881, 16599, 19309]],
                        mobile: [[16909, 18642, 21869]],
                        labels: {
                          desktop: 'Net income',
                          mobile: 'Operating income',
                          prior: 'Prior periods',
                          current: 'FY25 quarters',
                        },
                      }}
                      categories={{
                        title: 'Revenue by business platform',
                        groups: [
                          { id: 'dc', name: 'Data Center', color: '#78967c', ink: 'dark' },
                          { id: 'gaming', name: 'Gaming', color: '#9c9c89', ink: 'dark' },
                          { id: 'other', name: 'Other platforms', color: '#b8aa81', ink: 'dark' },
                        ],
                        periods: seedReports.map((r, i) => ({
                          label: r.period,
                          total: r.revenue!,
                          delta: i
                            ? `${((r.revenue! / seedReports[i - 1].revenue! - 1) * 100).toFixed(1)}%`
                            : 'Baseline',
                          compare: 'Reported USD millions',
                        })),
                        items: [
                          {
                            name: 'Data Center',
                            group: 'dc',
                            values: seedReports.map((r) => r.dataCenter!),
                          },
                          {
                            name: 'Gaming',
                            group: 'gaming',
                            values: seedReports.map((r) => r.gaming!),
                          },
                          {
                            name: 'Visualization',
                            group: 'other',
                            values: seedReports.map((r) => r.visualization!),
                          },
                          {
                            name: 'Automotive',
                            group: 'other',
                            values: seedReports.map((r) => r.auto!),
                          },
                          { name: 'OEM & other', group: 'other', values: [78, 88, 97] },
                        ],
                        table: {
                          columns: ['Metric', 'Q1', 'Q2', 'Q3'],
                          rows: [
                            { label: 'GAAP gross margin', values: ['78.4%', '75.1%', '74.6%'] },
                            {
                              label: 'Diluted EPS (split adjusted)',
                              values: ['$0.60', '$0.67', '$0.78'],
                            },
                          ],
                        },
                      }}
                      seasonality={{
                        title: 'Quarterly business mix',
                        axis: ['Data Center', 'Gaming', 'Visualization', 'Automotive'],
                        years: [...seedReports].reverse().map((r) => ({
                          label: r.period,
                          values: [r.dataCenter!, r.gaming!, r.visualization!, r.auto!],
                          stats: [
                            {
                              label: 'Revenue',
                              value: r.revenue!,
                              delta: '',
                              note: 'USD millions',
                            },
                            {
                              label: 'Net income',
                              value: r.income!,
                              delta: '',
                              note: 'USD millions',
                            },
                          ],
                          rows: [
                            { label: 'GAAP gross margin', value: `${r.margin}%` },
                            { label: 'Period', value: r.period },
                          ],
                        })),
                      }}
                      colors={{
                        revenue: ['#3e644e', '#3e644e'],
                        desktop: ['#78967c', '#3e644e'],
                        mobile: ['#abb4ac', '#737e72'],
                        radar: '#536b50',
                      }}
                    />
                    <div className="library-footnote">
                      Charts use historical source data; periods do not follow the report selectors
                      above. {evidenceLink(seedReports[2])}
                    </div>
                  </>
                ) : (
                  <div className="panel empty-state">
                    <Activity />
                    <h3>Financial history starts with verified numbers</h3>
                    <p>
                      Your uploaded passages are available in Reports. Connect a backend to extend
                      structured company memory.
                    </p>
                  </div>
                ))}
              {(tab === 'Overview' || tab === 'Reports') && (
                <CompanyTimeline reports={companyReports} onSelect={setReportView} />
              )}
              <section className="ask-panel">
                <div className="ask-heading">
                  <div>
                    <h2>Ask your company memory</h2>
                    <p>Search reported figures and passages in the documents you have saved.</p>
                  </div>
                  <span className="retrieval-label">Evidence retrieval</span>
                </div>
                <form onSubmit={(e) => ask(e)} className="ask-form">
                  <input
                    aria-label="Ask company memory"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder={`What has changed about ${company.name}?`}
                  />
                  <button type="submit" aria-label="Send question" disabled={!question.trim()}>
                    <ArrowUpRight size={19} />
                  </button>
                </form>
                <div className="suggestions">
                  {[
                    'Did margins improve?',
                    'What challenges my thesis?',
                    'What changed in Data Center?',
                  ].map((q) => (
                    <button key={q} onClick={() => ask(undefined, q)}>
                      {q}
                      <ArrowUpRight size={11} />
                    </button>
                  ))}
                </div>
                {answer && (
                  <div className="answer" aria-live="polite">
                    <div className="answer-title">
                      <MessageSquare size={15} />
                      <b>{answer.question}</b>
                      <button
                        className="icon-button"
                        aria-label="Dismiss answer"
                        onClick={() => setAnswer(null)}
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <p>{answer.text}</p>
                    <div className="answer-evidence">
                      {answer.hits.map((hit, i) => (
                        <button
                          key={i}
                          onClick={() =>
                            setReportView(companyReports.find((r) => r.id === hit.reportId)!)
                          }
                        >
                          <FileText size={13} />
                          <span>
                            <b>
                              {hit.period} · {hit.category}
                            </b>
                            {hit.text}
                          </span>
                          <ArrowUpRight size={13} />
                        </button>
                      ))}
                    </div>
                    <small>
                      Deterministic retrieval from stored reports. No live market feed or
                      model-generated investment recommendation.
                    </small>
                  </div>
                )}
              </section>
            </>
          )}
          <footer className="page-footer">
            <span>
              <span className="mini-brand">t·</span>Company research · source-linked notes
            </span>
            <span>
              Historical demo ·{' '}
              {companyId === 'nvda' ? 'FY25 reporting periods' : 'Browser workspace'}
              <button onClick={() => setModal('settings')}>
                Connections <ArrowUpRight size={11} />
              </button>
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {evidence && (
        <Modal wide title={evidence.title} onClose={() => setEvidence(null)}>
          <div className="evidence-meta">
            <Badge status={evidence.status} />
            <span>
              {evidence.category} · {evidence.section}
            </span>
          </div>
          <div className="evidence-comparison">
            <article>
              <span className="eyebrow">BEFORE · {prior?.period}</span>
              <p>{evidence.old}</p>
              {evidenceLink(prior)}
            </article>
            <article>
              <span className="eyebrow">AFTER · {current?.period}</span>
              <p>{evidence.next}</p>
              {evidenceLink(current)}
            </article>
          </div>
          <div className="interpretation">
            <div>
              <h3>Implication for the linked assumption</h3>
              <p>{evidence.interpretation}</p>
              <small>
                Interpretation · Review required. Source passages above are concise paraphrases.
              </small>
            </div>
          </div>
          <label>
            Link this evidence to an assumption
            <select
              aria-label="Link evidence to thesis"
              defaultValue=""
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                setTheses(
                  theses.map((t) =>
                    t.id === id
                      ? { ...t, evidence: [...new Set([...t.evidence, evidence.id])] }
                      : t,
                  ),
                );
                setToast('Evidence linked to your assumption.');
              }}
            >
              <option value="">Choose an assumption…</option>
              {theses.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          <div className="modal-actions">
            <button
              className="button"
              onClick={() => {
                setEvidence(null);
                setTab('Thesis tracker');
              }}
            >
              Go to thesis tracker
              <ArrowRight size={14} />
            </button>
            <button className="button primary" onClick={() => setEvidence(null)}>
              Done reviewing
              <Check size={14} />
            </button>
          </div>
        </Modal>
      )}
      {reportView && (
        <Modal wide title={reportView.title} onClose={() => setReportView(null)}>
          <div className="evidence-meta">
            <span className="badge neutral">{reportView.period}</span>
            <span>
              {formatDate(reportView.date)} ·{' '}
              {reportView.imported ? 'Imported report' : 'Historical source summary'}
            </span>
            {evidenceLink(reportView)}
          </div>
          <div className="report-reader">
            {reportView.text.split(/\n\s*\n/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <div className="extracted-heading">
            <h3>Evidence passages</h3>
            <span>Topic matching · not verified claims</span>
          </div>
          <div className="extracted-list">
            {extractClaims(reportView.text).map((c) => (
              <article key={c.id}>
                <span className="badge neutral">{c.category}</span>
                <p>{c.text}</p>
              </article>
            ))}
          </div>
          <div className="modal-actions">
            <button
              className="button primary"
              onClick={() => {
                setCurrentId(reportView.id);
                const index = companyReports.findIndex((r) => r.id === reportView.id);
                if (index > 0) setPriorId(companyReports[index - 1].id);
                setReportView(null);
                setTab('Overview');
              }}
            >
              Use in comparison
              <ArrowRight size={14} />
            </button>
          </div>
        </Modal>
      )}
      {modal === 'report' && (
        <Modal title="Import a report" onClose={close}>
          <p className="modal-description">
            Upload a report or paste its text. Each report stays connected to {company.name}.
          </p>
          <form onSubmit={addReport}>
            <label className="upload-zone">
              <Upload size={23} />
              <b>Choose a PDF or text file</b>
              <span>Readable PDFs or TXT · up to 10 MB</span>
              <input
                type="file"
                aria-label="Upload report"
                accept=".pdf,.txt,.md"
                disabled={busy}
                onChange={(e) => readFile(e.target.files?.[0])}
              />
            </label>
            <div className="form-row">
              <label>
                Report title
                <input
                  required
                  maxLength={150}
                  value={importTitle}
                  onChange={(e) => setImportTitle(e.target.value)}
                  placeholder="Quarterly earnings release"
                />
              </label>
              <label>
                Reporting period
                <input
                  required
                  maxLength={50}
                  value={importPeriod}
                  onChange={(e) => setImportPeriod(e.target.value)}
                  placeholder="Q4 FY25"
                />
              </label>
            </div>
            <label>
              Source URL <span className="muted">(optional)</span>
              <input
                type="url"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://investor.company.com/report"
              />
            </label>
            <label>
              Report text
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="Paste the report, or upload a document above…"
                rows={6}
              />
            </label>
            <div className="inline-notice">
              <ShieldCheck size={15} />
              <span>
                {apiUrl
                  ? 'URL-only imports use your backend, Daytona, and Neo4j. File and text imports stay in your browser.'
                  : 'Browser mode: documents stay on this device. Connect a backend to fetch online reports with Daytona and save to Neo4j.'}
              </span>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" className="button" onClick={close}>
                Cancel
              </button>
              <button disabled={busy} className="button primary" type="submit">
                {busy ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}
                {busy ? 'Processing…' : 'Add to company memory'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'thesis' && (
        <Modal title={editing ? 'Edit assumption' : 'New investment assumption'} onClose={close}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const item: ThesisItem = {
                id: editing?.id || crypto.randomUUID(),
                title: String(data.get('title')).trim(),
                body: String(data.get('body')).trim(),
                status: String(data.get('assessment')) as Status,
                evidence: editing?.evidence || [],
                reviewed: editing?.reviewed,
              };
              if (!item.title || !item.body) return;
              setTheses(
                editing ? theses.map((t) => (t.id === editing.id ? item : t)) : [...theses, item],
              );
              close();
              setToast('Thesis assumption saved.');
            }}
          >
            <p className="modal-description">
              Be specific about what should happen, why, and what evidence would change your mind.
            </p>
            <label>
              Assumption
              <input
                name="title"
                required
                maxLength={160}
                defaultValue={editing?.title}
                placeholder="Margins improve as input costs fall"
              />
            </label>
            <label>
              Your reasoning
              <textarea
                name="body"
                required
                rows={5}
                maxLength={3000}
                defaultValue={editing?.body}
                placeholder="I expect… because… I would revisit this if…"
              />
            </label>
            <label>
              Your assessment
              <select name="assessment" defaultValue={editing?.status || 'Unresolved'}>
                <option>Unresolved</option>
                <option>Supported</option>
                <option>Needs review</option>
              </select>
            </label>
            <div className="modal-actions">
              {editing && (
                <button
                  type="button"
                  className="button danger"
                  onClick={() => {
                    setTheses(theses.filter((t) => t.id !== editing.id));
                    close();
                    setToast('Assumption removed.');
                  }}
                >
                  Remove assumption
                </button>
              )}
              <button className="button primary" type="submit">
                Save assumption
                <Check size={14} />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'company' && (
        <Modal title="Start a company memory" onClose={close}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const name = String(data.get('name')).trim(),
                ticker = String(data.get('ticker')).trim().toUpperCase();
              if (!name || !ticker) return;
              if (companies.some((c) => c.ticker === ticker)) {
                setError('This ticker is already in your workspace.');
                return;
              }
              const c = {
                id: crypto.randomUUID(),
                name,
                ticker,
                description: 'Your research workspace',
              };
              setCompanies([...companies, c]);
              switchCompany(c.id);
              close();
              setToast('Company added. Start with a report and an assumption.');
            }}
          >
            <p className="modal-description">
              Keep each company’s reports, assumptions, and research in its own workspace.
            </p>
            <label>
              Company name
              <input name="name" required maxLength={80} placeholder="Microsoft" />
            </label>
            <label>
              Ticker
              <input name="ticker" required maxLength={15} placeholder="MSFT" />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button type="submit" className="button primary">
                Create company memory
                <Plus size={14} />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'search' && (
        <Modal title="Search your company memory" onClose={close}>
          <div className="search-dialog-input">
            <Search size={18} />
            <input
              aria-label="Search company memory"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search a report, metric, product, or thesis…"
            />
          </div>
          <div className="search-results">
            {search.trim() ? (
              <>
                {theses
                  .filter((t) => (t.title + t.body).toLowerCase().includes(search.toLowerCase()))
                  .map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setTab('Thesis tracker');
                        close();
                      }}
                    >
                      <Target size={18} />
                      <div>
                        <b>{t.title}</b>
                        <span>Thesis assumption</span>
                      </div>
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                {findEvidence(search, companyReports).map((hit, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setReportView(companyReports.find((r) => r.id === hit.reportId)!);
                      close();
                    }}
                  >
                    <FileText size={18} />
                    <div>
                      <b>
                        {hit.period} · {hit.category}
                      </b>
                      <span>{hit.text.slice(0, 180)}</span>
                    </div>
                    <ArrowUpRight size={15} />
                  </button>
                ))}
                {!findEvidence(search, companyReports).length &&
                  !theses.some((t) =>
                    (t.title + t.body).toLowerCase().includes(search.toLowerCase()),
                  ) && (
                    <p className="muted">
                      No matching evidence. Try “margin”, “Blackwell”, or “revenue”.
                    </p>
                  )}
              </>
            ) : (
              <p className="muted">
                Search across {companyReports.length} reports and {theses.length} assumptions for{' '}
                {company.name}.
              </p>
            )}
          </div>
        </Modal>
      )}
      {modal === 'settings' && (
        <Modal title="Connections & settings" onClose={close}>
          <p className="modal-description">
            The public dashboard works with historical data and browser memory. Connect your own
            backend for live report processing.
          </p>
          <div className="connection-cards">
            <div>
              <Network size={20} />
              <span>
                <b>Neo4j</b>
                <small>Persistent company and evidence graph</small>
              </span>
              <span className="badge neutral">Backend</span>
            </div>
            <div>
              <ShieldCheck size={20} />
              <span>
                <b>Daytona</b>
                <small>Isolated retrieval and document processing</small>
              </span>
              <span className="badge neutral">Backend</span>
            </div>
          </div>
          <label>
            Backend URL
            <input
              type="url"
              value={apiUrl}
              onChange={(e) => {
                setApiUrl(e.target.value);
                setConnection('Not connected');
              }}
              placeholder="https://your-thesis-api.example.com"
            />
          </label>
          <label>
            Session access token
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Backend API_TOKEN · kept in memory only"
            />
          </label>
          <div className="inline-notice">
            Service credentials belong on the backend. The dashboard never needs your Neo4j password
            or Daytona API key.
          </div>
          <button className="button sync-button" disabled={busy || !apiUrl} onClick={syncMemory}>
            Load saved reports from Neo4j
            <Download size={14} />
          </button>
          <p className="connection-status" role="status">
            {connection}
          </p>
          <div className="modal-actions">
            <button
              className="button"
              disabled={busy || !apiUrl}
              onClick={async () => {
                setBusy(true);
                setConnection('Checking…');
                try {
                  const r = await fetch(`${apiUrl.replace(/\/$/, '')}/api/health`, {
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  const data = await r.json();
                  if (!r.ok) throw new Error(data.error || 'Connection rejected');
                  setConnection(
                    `Connected · Neo4j: ${data.neo4j ? 'ready' : 'not configured'} · Daytona: ${data.daytona ? 'configured' : 'not configured'}`,
                  );
                } catch {
                  setConnection(
                    'Could not connect. Check the backend URL, access token, and allowed origin.',
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Test connection
              <Link2 size={14} />
            </button>
            <button
              className="button primary"
              onClick={() => {
                close();
                setToast('Connection settings saved.');
              }}
            >
              Done
              <Check size={14} />
            </button>
          </div>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal title="A second brain for your research" onClose={close}>
          <div className="help-content">
            <p>
              Thesis remembers the company’s story, your assumptions, and the evidence behind them.
            </p>
            <ol>
              <li>Choose a company and add reports.</li>
              <li>Write the assumptions behind your investment view.</li>
              <li>Compare reporting periods and inspect changes.</li>
              <li>Follow evidence links and record your own judgment.</li>
            </ol>
            <div className="inline-notice">
              This demo uses historical NVIDIA FY25 reports. The financial snapshot is not current
              market data. Assessments are curated interpretations; follow-up answers use
              deterministic evidence retrieval.
            </div>
            <p>
              Edits and uploads stay in this browser. Export your memory to keep a copy. Live
              Daytona processing and Neo4j storage require the included backend.
            </p>
            <span className="small muted">
              Chart foundation adapted from your supplied Analytics Bento component by vasnev.art.
            </span>
          </div>
        </Modal>
      )}
    </div>
  );
}
