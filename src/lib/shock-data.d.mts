export type Relationship = {
  id: string;
  from: string;
  to: string;
  label: string;
  published: string;
  kind: string;
  note: string;
  source: string;
  versionId?: string;
  discoveredAt?: string;
  reviewedAt?: string;
};
export const companies: { id: string; name: string; role: string; x: number; y: number }[];
export const relationships: Relationship[];
export const developments: { date: string; title: string; detail: string; source: string }[];
export const shocks: {
  id: string;
  title: string;
  subject: string;
  description: string;
  hypothesis: string;
  caveat: string;
}[];
export function exposurePaths(
  root: string,
  asOf: string,
  maxHops?: number,
  edges?: Relationship[],
): { company: string; nodes: string[]; edges: string[] }[];
