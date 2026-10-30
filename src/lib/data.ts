export type Status = 'Supported' | 'Needs review' | 'Unresolved';
export type ThesisItem = {
  id: string;
  title: string;
  body: string;
  status: Status;
  evidence: string[];
  reviewed?: boolean;
};
export type Report = {
  id: string;
  period: string;
  date: string;
  title: string;
  url?: string;
  text: string;
  revenue?: number;
  margin?: number;
  income?: number;
  eps?: number;
  dataCenter?: number;
  gaming?: number;
  auto?: number;
  visualization?: number;
  imported?: boolean;
  provenance?: 'local' | 'live';
  claims?: { text: string; category: string }[];
};
const ir = 'https://investor.nvidia.com/news/press-release-details/';
export const reports: Report[] = [
  {
    id: 'nvda-q1',
    period: 'Q1 FY25',
    date: '2024-05-22',
    title: 'First quarter results',
    url: ir + '2024/NVIDIA-Announces-Financial-Results-for-First-Quarter-Fiscal-2025/default.aspx',
    revenue: 26044,
    margin: 78.4,
    income: 14881,
    eps: 0.6,
    dataCenter: 22563,
    gaming: 2647,
    auto: 329,
    visualization: 427,
    text: 'Historical financial baseline. Revenue: $26,044 million. GAAP gross margin: 78.4%. Net income: $14,881 million. Figures are also presented as comparative data in the Q2 FY25 earnings release.',
  },
  {
    id: 'nvda-q2',
    period: 'Q2 FY25',
    date: '2024-08-28',
    title: 'Second quarter results',
    url: ir + '2024/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2025/default.aspx',
    revenue: 30040,
    margin: 75.1,
    income: 16599,
    eps: 0.67,
    dataCenter: 26272,
    gaming: 2880,
    auto: 346,
    visualization: 454,
    text: 'Financial summary (paraphrased): Revenue reached $30,040 million. GAAP gross margin was 75.1%. Data Center revenue reached approximately $26.3 billion. Management expected next-quarter revenue of $32.5 billion and GAAP gross margin of 74.4%, each subject to the ranges in the source. Blackwell samples were shipping to partners and customers. CoreWeave offered H200 systems.',
  },
  {
    id: 'nvda-q3',
    period: 'Q3 FY25',
    date: '2024-11-20',
    title: 'Third quarter results',
    url: ir + '2024/NVIDIA-Announces-Financial-Results-for-Third-Quarter-Fiscal-2025/default.aspx',
    revenue: 35082,
    margin: 74.6,
    income: 19309,
    eps: 0.78,
    dataCenter: 30771,
    gaming: 3279,
    auto: 449,
    visualization: 486,
    text: 'Financial summary (paraphrased): Revenue reached $35,082 million. GAAP gross margin was 74.6%. Data Center revenue reached approximately $30.8 billion. Management expected next-quarter revenue of $37.5 billion and GAAP gross margin of 73.0%, subject to the ranges in the source. Blackwell was in full production. H200 instances were available through AWS, CoreWeave, and Microsoft Azure.',
  },
];
export const initialTheses: ThesisItem[] = [
  {
    id: 'demand',
    title: 'AI infrastructure demand stays durable',
    body: 'Data Center revenue should continue growing as cloud providers invest in accelerated computing.',
    status: 'Supported',
    evidence: ['demand', 'cloud'],
  },
  {
    id: 'margin',
    title: 'Scale supports stronger gross margins',
    body: 'As revenue scales, gross margins should hold at or above the Q2 baseline of 75.1%.',
    status: 'Needs review',
    evidence: ['margin', 'guidance'],
  },
  {
    id: 'blackwell',
    title: 'Blackwell becomes the next growth engine',
    body: 'The next architecture should move from sampling into production and translate into reported revenue.',
    status: 'Unresolved',
    evidence: ['blackwell'],
  },
];
export type Change = {
  id: string;
  title: string;
  category: string;
  status: Status;
  summary: string;
  old: string;
  next: string;
  interpretation: string;
  section: string;
  metric?: 'revenue' | 'margin' | 'dataCenter';
};
export const changes: Change[] = [
  {
    id: 'margin',
    title: 'Growth is accelerating. Margins aren’t.',
    category: 'Financials',
    status: 'Needs review',
    summary: 'GAAP gross margin fell 50 bps, despite 16.8% sequential revenue growth.',
    old: 'GAAP gross margin: 75.1%.',
    next: 'GAAP gross margin: 74.6%.',
    interpretation:
      'This challenges the assumption that scale alone improves margins. It does not establish why margins changed.',
    section: 'GAAP financial summary · Gross margin',
    metric: 'margin',
  },
  {
    id: 'demand',
    title: 'Data Center demand keeps building',
    category: 'Business',
    status: 'Supported',
    summary:
      'Data Center revenue grew from $26.3B to $30.8B, up approximately 17% quarter over quarter.',
    old: 'Data Center revenue: approximately $26.3 billion.',
    next: 'Data Center revenue: approximately $30.8 billion.',
    interpretation:
      'Sequential growth supports the demand thesis. One quarter does not establish how long that growth can persist.',
    section: 'Highlights · Data Center',
    metric: 'dataCenter',
  },
  {
    id: 'guidance',
    title: 'The next margin outlook moves lower',
    category: 'Guidance',
    status: 'Needs review',
    summary:
      'The GAAP gross margin outlook midpoint moved from 74.4% to 73.0%. These forecasts cover different quarters.',
    old: 'Next-quarter GAAP gross margin outlook: 74.4%, ±50 basis points.',
    next: 'Next-quarter GAAP gross margin outlook: 73.0%, ±50 basis points.',
    interpretation:
      'A lower forward midpoint makes margin resilience worth revisiting. Guidance is a management forecast, not a reported outcome.',
    section: 'Outlook · GAAP gross margin',
  },
  {
    id: 'blackwell',
    title: 'Blackwell moves beyond sampling',
    category: 'Business',
    status: 'Unresolved',
    summary: 'Management described a transition from shipping samples to full production.',
    old: 'Management described Blackwell samples shipping to partners and customers.',
    next: 'Management described Blackwell as being in full production.',
    interpretation:
      'The production milestone is encouraging, but these passages do not quantify Blackwell revenue or profitability.',
    section: 'Management commentary · Product transition',
  },
  {
    id: 'cloud',
    title: 'H200 availability expands across cloud platforms',
    category: 'Relationships',
    status: 'Supported',
    summary:
      'The release expands the named H200 availability from CoreWeave to AWS, CoreWeave, and Azure.',
    old: 'H200-powered systems were available on CoreWeave.',
    next: 'H200 instances were available through AWS, CoreWeave, and Microsoft Azure.',
    interpretation:
      'Broader distribution supports access to the platform. Availability alone does not quantify sales to each provider.',
    section: 'Highlights · Data Center ecosystem',
  },
];
export const graphNodes = [
  { id: 'nvidia', label: 'NVIDIA', type: 'Company', x: 310, y: 180, change: 'demand' },
  { id: 'dc', label: 'Data Center', type: 'Segment', x: 140, y: 92, change: 'demand' },
  { id: 'blackwell', label: 'Blackwell', type: 'Product', x: 475, y: 85, change: 'blackwell' },
  { id: 'margin', label: 'Gross margin', type: 'Metric', x: 470, y: 278, change: 'margin' },
  { id: 'h200', label: 'H200', type: 'Product', x: 140, y: 275, change: 'cloud' },
  { id: 'aws', label: 'AWS', type: 'Cloud platform', x: 48, y: 180, change: 'cloud' },
  { id: 'azure', label: 'Azure', type: 'Cloud platform', x: 270, y: 328, change: 'cloud' },
  {
    id: 'thesis',
    label: 'Margin thesis',
    type: 'Your assumption',
    x: 580,
    y: 185,
    change: 'margin',
  },
];
export const graphEdges = [
  ['nvidia', 'dc', 'reports'],
  ['nvidia', 'blackwell', 'develops'],
  ['nvidia', 'margin', 'reports'],
  ['dc', 'h200', 'includes'],
  ['h200', 'aws', 'available on'],
  ['h200', 'azure', 'available on'],
  ['margin', 'thesis', 'challenges'],
];
export const formatDate = (date: string) =>
  new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
export const billions = (n?: number) => (n === undefined ? '—' : `$${(n / 1000).toFixed(2)}B`);
