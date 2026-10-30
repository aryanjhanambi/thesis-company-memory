import { FileText, Network } from 'lucide-react';
import type { Report } from '@/lib/data';
import { extractClaims } from '@/lib/analysis.mjs';
export function EvidenceMemory({
  company,
  reports,
  onSelect,
}: {
  company: string;
  reports: Report[];
  onSelect: (report: Report) => void;
}) {
  if (!reports.length)
    return (
      <div className="empty-state">
        <Network />
        <p>Add reports to connect source documents and evidence topics.</p>
      </div>
    );
  const categories = [
    ...new Set(reports.flatMap((r) => extractClaims(r.text).map((c) => c.category))),
  ].slice(0, 6);
  const visibleReports = reports.slice(-6);
  const height = Math.max(250, visibleReports.length * 67 + 35, categories.length * 58 + 35);
  return (
    <div className="document-memory">
      <span className="small muted">Document → evidence topic · extracted text preserved</span>
      <svg
        viewBox={`0 0 650 ${height}`}
        role="img"
        aria-label={`${company} report and evidence topic graph`}
      >
        <rect
          x="15"
          y={height / 2 - 24}
          width="125"
          height="48"
          rx="10"
          fill="#f0f5e9"
          stroke="#dde8d3"
        />
        <text x="77" y={height / 2 + 4} textAnchor="middle" fontSize="12" fill="#7a9365">
          {company.slice(0, 16)}
        </text>
        {visibleReports.map((r, i) => {
          const y = 35 + (i * (height - 70)) / Math.max(1, visibleReports.length - 1);
          const topics = new Set(extractClaims(r.text).map((c) => c.category));
          return (
            <g key={r.id}>
              <line x1="140" y1={height / 2} x2="240" y2={y} stroke="#dce4d5" />
              {categories.map(
                (c, j) =>
                  topics.has(c) && (
                    <line
                      key={c}
                      x1="365"
                      y1={y}
                      x2="490"
                      y2={35 + (j * (height - 70)) / Math.max(1, categories.length - 1)}
                      stroke="#e4e5ef"
                    />
                  ),
              )}
              <g
                role="button"
                tabIndex={0}
                aria-label={`Inspect ${r.period} evidence`}
                className="graph-node"
                onClick={() => onSelect(r)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(r);
                  }
                }}
              >
                <rect
                  x="240"
                  y={y - 20}
                  width="125"
                  height="40"
                  rx="8"
                  fill="#f7f9fc"
                  stroke="#e0e5ed"
                />
                <text x="302" y={y + 4} textAnchor="middle" fontSize="11" fill="#8591a3">
                  {r.period.slice(0, 20)}
                </text>
              </g>
            </g>
          );
        })}
        {categories.map((category, i) => {
          const y = 35 + (i * (height - 70)) / Math.max(1, categories.length - 1);
          return (
            <g key={category}>
              <rect
                x="490"
                y={y - 18}
                width="140"
                height="36"
                rx="8"
                fill="#f6f4fa"
                stroke="#e7e1ef"
              />
              <text x="560" y={y + 4} textAnchor="middle" fontSize="11" fill="#9b90ad">
                {category}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="evidence-memory-links">
        {visibleReports.map((r) => (
          <button key={r.id} onClick={() => onSelect(r)}>
            <FileText size={13} />
            {r.period}
            <span>{extractClaims(r.text).length} passages</span>
          </button>
        ))}
      </div>
    </div>
  );
}
