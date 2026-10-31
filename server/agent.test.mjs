import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sourceDocument,
  canonicalSource,
  proposalFor,
  parseClaims,
  projectVersions,
} from './agent-domain.mjs';
import { createInferenceClient, providerJson } from './provider-client.mjs';
import { createResearchAgent } from './research-agent.mjs';
const now = '2026-10-31T08:00:00.000Z';
const quote = 'Microsoft and NVIDIA announced an additional AI infrastructure partnership.';
const document = () =>
  sourceDocument(
    {
      url: 'https://nvidianews.nvidia.com/news/unit-test?utm_source=qa',
      title: 'Unit test fixture, not a real announcement',
      text: quote,
      publishedDate: '2026-10-30',
    },
    now,
  );
const claim = {
  from: 'MSFT',
  to: 'NVDA',
  relation: 'partners_with',
  status: 'announced',
  summary: 'Unit-test partnership claim only.',
  quote,
  targetId: null,
};
test('source validation rejects untrusted hosts, unknown/future dates, and unsafe URLs', () => {
  assert.equal(canonicalSource('https://nvidianews.nvidia.com.evil.example/a'), null);
  assert.equal(canonicalSource('http://nvidianews.nvidia.com/a'), null);
  assert.equal(canonicalSource('https://user:pass@nvidianews.nvidia.com/a'), null);
  assert.equal(document().url, 'https://nvidianews.nvidia.com/news/unit-test');
  assert.equal(sourceDocument({ url: document().url, text: quote }, now), null);
  assert.equal(
    sourceDocument({ url: document().url, text: quote, publishedDate: '2027-01-01' }, now),
    null,
  );
  assert.equal(document().id, document().id);
});
test('candidate generation requires exact evidence naming both entities and never invents removals', () => {
  assert.equal(
    proposalFor(
      { ...claim, quote: 'A passage that never appeared in the source.' },
      document(),
      [],
      'run',
    ),
    null,
  );
  assert.equal(proposalFor({ ...claim, from: 'UNKNOWN' }, document(), [], 'run'), null);
  assert.equal(proposalFor({ ...claim, status: 'ended' }, document(), [], 'run'), null);
  assert.equal(proposalFor({ ...claim, targetId: 'missing' }, document(), [], 'run'), null);
  const proposal = proposalFor(claim, document(), [], 'run');
  assert.equal(proposal.change, 'add');
  assert.equal(proposal.status, 'pending');
  assert.equal(proposal.discoveredAt, now);
  assert.equal(proposalFor(claim, document(), [], 'other-run').id, proposal.id);
  const current = [{ id: 'azure', from: 'NVDA', to: 'MSFT', versionId: 'seed:azure' }];
  const update = proposalFor({ ...claim, targetId: 'azure' }, document(), current, 'run');
  assert.equal(update.from, 'MSFT');
  assert.equal(update.logicalId, 'azure');
  assert.equal(update.change, 'update');
});
test('retirement needs explicit evidence and a known edge; no historical evidence is erased', () => {
  const quote = 'Microsoft and NVIDIA ended their earlier AI infrastructure partnership.';
  const doc = sourceDocument(
    { url: document().url, text: quote, publishedDate: '2026-10-30' },
    now,
  );
  const ended = { ...claim, status: 'ended', quote, targetId: 'azure' };
  assert.equal(proposalFor(ended, doc, [], 'run'), null);
  assert.equal(
    proposalFor(ended, doc, [{ id: 'azure', from: 'MSFT', to: 'NVDA', versionId: 'old' }], 'run')
      .change,
    'retire',
  );
});
test('two-clock replay prevents discovered-later and reviewed-later evidence entering old backtests', () => {
  const old = {
    logicalId: 'edge',
    status: 'reported',
    published: '2024-03-18',
    effectiveDate: '2024-03-18',
    discoveredAt: '2024-03-19T00:00:00Z',
    reviewedAt: '2024-03-20T00:00:00Z',
    sequence: 1,
  };
  const ended = {
    ...old,
    status: 'ended',
    published: '2024-03-21',
    discoveredAt: '2026-01-01T00:00:00Z',
    reviewedAt: '2026-01-02T00:00:00Z',
    sequence: 2,
  };
  assert.equal(projectVersions([old, ended], '2024-03-19').length, 0);
  assert.equal(projectVersions([old, ended], '2024-03-22')[0].status, 'reported');
  assert.equal(projectVersions([old, ended], '2026-01-02')[0].status, 'ended');
  assert.equal(projectVersions([old, ended], '2024-03-22', 'published')[0].status, 'ended');
});
test('strict extraction JSON and invalid schemas fail closed', () => {
  assert.deepEqual(parseClaims('```json\n{"claims":[]}\n```'), []);
  assert.throws(() => parseClaims('{"claims":"invented"}'));
  assert.throws(() => parseClaims('Not JSON'));
});
test('future announced plans are visible as plans, but future-effective endings do not hide active edges early', () => {
  const base = {
    logicalId: 'edge',
    status: 'reported',
    published: '2024-01-01',
    effectiveDate: '2024-01-01',
    discoveredAt: '2024-01-01T00:00:00Z',
    reviewedAt: '2024-01-01T00:00:00Z',
    sequence: 1,
  };
  const future = { ...base, status: 'ended', effectiveDate: '2025-01-01', sequence: 2 };
  assert.equal(projectVersions([base, future], '2024-06-01')[0].status, 'reported');
  assert.equal(
    projectVersions([base, { ...future, status: 'announced' }], '2024-06-01')[0].status,
    'announced',
  );
});
test('managed Nosana key discovers a currently serving model rather than requiring endpoint setup', async () => {
  const calls = [];
  const client = createInferenceClient({ NOSANA_API_KEY: 'test-key' }, async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    return {
      ok: true,
      json: async () =>
        url.endsWith('/models')
          ? {
              data: [
                { id: 'unavailable', available: false },
                { id: 'serving-model', available: true, context_length: 16000 },
              ],
            }
          : { choices: [{ message: { content: 'READY' } }] },
    };
  });
  assert.equal(
    (await client.complete([{ role: 'user', content: 'Check' }])).model,
    'serving-model',
  );
  assert.equal(calls[0], 'https://inference.nosana.com/v1/models');
  await client.complete([{ role: 'user', content: 'Again' }]);
  assert.equal(calls.filter((c) => c.endsWith('/models')).length, 1);
});
test('provider errors are actionable and do not expose raw responses or credentials', async () => {
  await assert.rejects(
    providerJson(async () => ({ ok: false, status: 402 }), 'https://example.test', {}, 'Exa'),
    /add credits/,
  );
  await assert.rejects(
    providerJson(
      async () => {
        throw new Error('secret-key-in-raw-error');
      },
      'https://example.test',
      {},
      'Exa',
    ),
    (e) => !e.message.includes('secret-key'),
  );
  const unavailable = createInferenceClient({ NOSANA_API_KEY: 'test' }, async () => ({
    ok: true,
    json: async () => ({ data: [] }),
  }));
  await assert.rejects(unavailable.model(), /No suitable Nosana model/);
});
test('missing setup causes zero provider calls and configuration rejects arbitrary scope', async () => {
  let calls = 0;
  const agent = createResearchAgent({
    env: {},
    store: {},
    fetcher: async () => {
      calls++;
    },
  });
  assert.equal((await agent.status()).ready, false);
  await assert.rejects(agent.launch(), /Research agent needs/);
  await assert.rejects(
    agent.configure({ enabled: true, watchlist: ['FAKE'], intervalMinutes: 60 }),
    /supported companies/,
  );
  await assert.rejects(agent.review('bad', { decision: 'approve' }), /valid proposal/);
  assert.equal(calls, 0);
});
