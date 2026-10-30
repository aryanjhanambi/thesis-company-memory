import { ArrowUpRight, FileText, GitBranch } from 'lucide-react';
import type { Report } from '@/lib/data';
import { formatDate } from '@/lib/data';
export function CompanyTimeline({
  reports,
  onSelect,
}: {
  reports: Report[];
  onSelect: (report: Report) => void;
}) {
  if (!reports.length) return null;
  return (
    <section className="panel timeline-panel">
      <div className="panel-heading">
        <div>
          <h2>Reporting history</h2>
          <p>Published reports and the observations recorded for each period.</p>
        </div>
        <GitBranch size={17} className="muted" />
      </div>
      <div className="timeline-events">
        {reports.map((r, i) => (
          <button key={r.id} onClick={() => onSelect(r)}>
            <span className="timeline-point">
              <FileText size={13} />
            </span>
            <small>{formatDate(r.date)}</small>
            <b>{r.period}</b>
            <p>
              {r.id === 'nvda-q1'
                ? 'The financial baseline'
                : r.id === 'nvda-q2'
                  ? 'Revenue grows. Margins soften.'
                  : r.id === 'nvda-q3'
                    ? 'Data Center grows; margin outlook falls.'
                    : 'Imported document; passages await review'}
            </p>
            <span className="timeline-link">
              {i === 0 ? 'Inspect baseline' : 'Inspect report'}
              <ArrowUpRight size={11} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
