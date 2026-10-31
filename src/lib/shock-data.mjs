// Curated research, not an automatically discovered or exhaustive supply chain.
export const companies = [
  { id: 'MSFT', name: 'Microsoft', role: 'Cloud buyer', x: 115, y: 120 },
  { id: 'AMZN', name: 'Amazon', role: 'Cloud buyer', x: 115, y: 280 },
  { id: 'NVDA', name: 'NVIDIA', role: 'Accelerators', x: 360, y: 200 },
  { id: 'TSM', name: 'TSMC', role: 'Foundry', x: 625, y: 95 },
  { id: 'DELL', name: 'Dell', role: 'Server systems', x: 625, y: 220 },
  { id: 'SMCI', name: 'Supermicro', role: 'Server systems', x: 625, y: 345 },
];
const source =
  'https://nvidianews.nvidia.com/news/nvidia-blackwell-platform-arrives-to-power-a-new-era-of-computing/';
export const relationships = [
  {
    id: 'azure',
    from: 'MSFT',
    to: 'NVDA',
    label: 'Planned adoption',
    published: '2024-03-18',
    kind: 'announced',
    note: 'Microsoft is named as a planned Blackwell adopter. This is not a disclosed revenue share.',
    source,
  },
  {
    id: 'aws',
    from: 'AMZN',
    to: 'NVDA',
    label: 'Planned adoption',
    published: '2024-03-18',
    kind: 'announced',
    note: 'AWS is named as an intended Blackwell cloud provider; future plans are not completed purchases.',
    source,
  },
  {
    id: 'foundry',
    from: 'NVDA',
    to: 'TSM',
    label: 'Manufacturing',
    published: '2024-03-18',
    kind: 'reported',
    note: 'Blackwell uses a custom TSMC process. The announcement does not quantify financial exposure.',
    source,
  },
  {
    id: 'dell',
    from: 'NVDA',
    to: 'DELL',
    label: 'Planned systems',
    published: '2024-03-18',
    kind: 'announced',
    note: 'Dell is listed among expected Blackwell server partners, not as an exclusive supplier.',
    source,
  },
  {
    id: 'smci',
    from: 'NVDA',
    to: 'SMCI',
    label: 'Planned systems',
    published: '2024-03-18',
    kind: 'announced',
    note: 'Supermicro is listed among expected Blackwell server partners. Realized orders are not established.',
    source,
  },
];
export const developments = [
  {
    date: '2024-03-18',
    title: 'Blackwell ecosystem announced',
    detail:
      'Cloud adoption, manufacturing and server-system relationships become visible in the curated graph.',
    source,
  },
  {
    date: '2024-07-30',
    title: 'Microsoft discusses infrastructure expansion',
    detail:
      'Management expects FY25 capital expenditure to exceed FY24. This is counterevidence to a spending-cut scenario, not proof that one cannot occur.',
    source: 'https://www.microsoft.com/en-us/investor/events/fy-2024/earnings-fy-2024-q4',
  },
];
export const shocks = [
  {
    id: 'capex',
    title: 'The AI spending reversal',
    subject: 'MSFT',
    description: 'What if a major cloud buyer reduces its AI infrastructure spending?',
    hypothesis: 'TSMC and server partners could face second-order demand pressure through NVIDIA.',
    caveat:
      'A smaller budget need not mean fewer GPU orders. Mix, contracts and other customers can offset it.',
  },
  {
    id: 'supply',
    title: 'A foundry bottleneck',
    subject: 'TSM',
    description: 'What if advanced chip manufacturing capacity becomes constrained?',
    hypothesis:
      'A foundry disruption could delay accelerator availability and downstream server delivery.',
    caveat:
      'A supply constraint could increase pricing power; it does not imply every connected stock falls.',
  },
  {
    id: 'orders',
    title: 'A server-order slowdown',
    subject: 'DELL',
    description: 'What if enterprise demand for AI servers disappoints?',
    hypothesis:
      'Shared platform exposure may connect server-order weakness to other system partners.',
    caveat:
      'A product partnership alone does not establish the size or direction of earnings sensitivity.',
  },
];

// Traverse economic connections in either direction; the result is reachability,
// never a causal estimate, probability, price target, or exposure percentage.
export function exposurePaths(root, asOf, maxHops = 2, edges = relationships) {
  const known = edges.filter((e) => e.published <= asOf);
  const paths = [{ company: root, nodes: [root], edges: [] }];
  const seen = new Set([root]);
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    if (p.edges.length >= maxHops) continue;
    for (const edge of known) {
      const next = edge.from === p.company ? edge.to : edge.to === p.company ? edge.from : null;
      if (next && !seen.has(next)) {
        seen.add(next);
        paths.push({ company: next, nodes: [...p.nodes, next], edges: [...p.edges, edge.id] });
      }
    }
  }
  return paths;
}
