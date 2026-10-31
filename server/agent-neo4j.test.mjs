import test from 'node:test';
import assert from 'node:assert/strict';
import neo4j from 'neo4j-driver';
import { createAgentStore } from './agent-store.mjs';
import { createResearchAgent } from './research-agent.mjs';
import { createApp } from './app.mjs';

// Opt-in only. Never run destructive cleanup against a user's hosted database.
test(
  'real Neo4j: scan → deduplicate → review → version → retire → restart → durable limits',
  { skip: !process.env.TEST_NEO4J_URI },
  async (t) => {
    assert.equal(process.env.TEST_NEO4J_URI, 'bolt://127.0.0.1:17687');
    assert.equal(process.env.TEST_NEO4J_PASSWORD, 'thesis-local-qa-only');
    const driver = neo4j.driver(
      process.env.TEST_NEO4J_URI,
      neo4j.auth.basic('neo4j', process.env.TEST_NEO4J_PASSWORD),
    );
    let ownsFixture = false;
    t.after(async () => {
      if (ownsFixture) await driver.executeQuery('MATCH (n) DETACH DELETE n');
      await driver.close();
    });
    const count = await driver.executeQuery('MATCH (n) RETURN count(n) AS count');
    assert.equal(
      count.records[0].get('count').toNumber(),
      0,
      'Integration tests require a fresh, disposable local database. Refusing to touch existing data.',
    );
    ownsFixture = true;
    const env = {
      API_TOKEN: 'unit-test',
      EXA_API_KEY: 'unit-test',
      NOSANA_API_KEY: 'unit-test',
      NEO4J_URI: process.env.TEST_NEO4J_URI,
      NEO4J_PASSWORD: process.env.TEST_NEO4J_PASSWORD,
      AGENT_ENABLED: 'false',
      AGENT_MAX_SEARCHES_PER_DAY: '8',
    };
    const store = createAgentStore(driver, env);
    await store.initialize();
    await store.configure({ enabled: false, watchlist: ['NVDA'], intervalMinutes: 1440 });
    let instant = Date.now(),
      mode = 'initial',
      networkCalls = 0;
    const today = new Date(instant).toISOString().slice(0, 10);
    const quote =
      'NVIDIA and Dell announced a new AI systems supply agreement for this integration test.';
    const secondQuote =
      'NVIDIA and Dell expanded their AI systems supply agreement for this integration test.';
    const endedQuote =
      'NVIDIA and Dell ended their AI systems supply agreement for this integration test.';
    const fetcher = async (url, options) => {
      networkCalls++;
      assert.equal(url, 'https://api.exa.ai/search');
      const body = JSON.parse(options.body);
      assert.equal(body.numResults, 3);
      assert.ok(body.includeDomains.includes('nvidianews.nvidia.com'));
      if (mode === 'provider-error') return { ok: false, status: 401 };
      const quotes = mode === 'ended' ? [endedQuote] : [quote, secondQuote];
      return {
        ok: true,
        json: async () => ({
          results: quotes.map((text, i) => ({
            url: `https://nvidianews.nvidia.com/news/local-integration-test-${mode}-${i}`,
            title: 'Synthetic LOCAL TEST ONLY',
            text,
            publishedDate: today,
          })),
        }),
      };
    };
    const inference = {
      configured: true,
      complete: async (messages) => {
        const doc = JSON.parse(messages[1].content).source;
        return {
          model: 'mock-integration-model',
          text: JSON.stringify({
            claims: [
              {
                from: 'NVDA',
                to: 'DELL',
                relation: 'supplies',
                status: mode === 'ended' ? 'ended' : 'reported',
                summary: `LOCAL INTEGRATION TEST: ${doc.text}`,
                quote: doc.text,
                targetId: 'dell',
                effectiveDate: today,
              },
            ],
          }),
        };
      },
    };
    const agent = createResearchAgent({ env, store, fetcher, inference, clock: () => instant });
    const server = createApp({ agent }, env).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { Authorization: 'Bearer unit-test', 'Content-Type': 'application/json' };
    const launched = await fetch(base + '/api/agent/scan', { method: 'POST', headers, body: '{}' });
    assert.equal(launched.status, 202);
    await agent.idle();
    let state = await store.snapshot();
    assert.equal(state.runs[0].status, 'completed');
    assert.equal(state.candidates.length, 2);
    const first = state.candidates[0],
      second = state.candidates[1];
    assert.equal((await store.graph(today)).find((e) => e.id === 'dell').versionId, 'seed:dell');
    assert.equal(
      (
        await fetch(base + `/api/agent/proposals/${first.id}/review`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            decision: 'approve',
            expectedVersion: first.before.versionId,
            reason: 'Local QA only',
          }),
        })
      ).status,
      200,
    );
    assert.equal((await store.history('dell')).length, 2);
    assert.equal(
      (await store.snapshot()).candidates.find((p) => p.id === first.id).before.versionId,
      'seed:dell',
    );
    await assert.rejects(
      agent.review(second.id, { decision: 'approve', expectedVersion: second.before.versionId }),
      /changed since/,
    );
    await agent.review(second.id, {
      decision: 'reject',
      expectedVersion: '',
      reason: 'Reject duplicate fixture',
    });
    assert.equal((await store.history('dell')).length, 2);
    const idempotent = await agent.review(first.id, {
      decision: 'approve',
      expectedVersion: 'outdated',
    });
    assert.equal(idempotent.alreadyReviewed, true);
    instant += 61000;
    await agent.launch();
    await agent.idle();
    state = await store.snapshot();
    assert.equal(state.runs[0].duplicateCount, 2);
    assert.equal(state.candidates.length, 2);
    mode = 'ended';
    instant += 61000;
    await agent.launch();
    await agent.idle();
    state = await store.snapshot();
    const retirement = state.candidates.find((p) => p.status === 'pending');
    assert.equal(retirement.change, 'retire');
    await agent.review(retirement.id, {
      decision: 'approve',
      expectedVersion: retirement.before.versionId,
    });
    assert.equal(
      (await store.graph(today)).some((e) => e.id === 'dell'),
      false,
    );
    assert.equal((await store.history('dell')).length, 3);
    assert.equal((await store.graph('2024-03-19')).length, 0);
    assert.equal(
      (await store.graph('2024-03-19', 'published')).some((e) => e.id === 'dell'),
      true,
    );
    const restarted = createAgentStore(driver, env);
    await restarted.initialize();
    assert.equal((await restarted.history('dell')).length, 3);
    assert.equal(
      (await restarted.graph(today)).some((e) => e.id === 'dell'),
      false,
    );
    mode = 'provider-error';
    instant += 61000;
    await agent.launch();
    await agent.idle();
    state = await store.snapshot();
    assert.equal(state.runs[0].status, 'failed');
    assert.match(state.runs[0].error, /check the API key/);
    assert.equal(state.control.leaseUntil, 0);
    assert.equal(await store.acquire('scheduled', instant + 61000, 'paused-test'), null);
    await store.configure({ enabled: true, watchlist: ['NVDA'], intervalMinutes: 1440 });
    const lease = await store.acquire('scheduled', instant + 61000, 'lease-test');
    assert.equal(lease.id, 'lease-test');
    await assert.rejects(
      restarted.acquire('manual', instant + 61001, 'conflict-test'),
      /already active/,
    );
    await store.finish('lease-test', { status: 'completed' });
    assert.equal(await restarted.acquire('scheduled', instant + 61002, 'not-due-test'), null);
    await store.acquire('manual', instant + 122000, 'abandoned-test');
    assert.equal(
      (await restarted.acquire('scheduled', instant + 122000 + 16 * 60000, 'recovered-test')).id,
      'recovered-test',
    );
    assert.equal(
      (await store.snapshot()).runs.find((r) => r.id === 'abandoned-test').status,
      'interrupted',
    );
    await store.finish('recovered-test', { status: 'completed' });
    assert.ok((await store.snapshot()).events.some((e) => e.kind === 'approved'));
    for (let i = state.searchesToday; i < 8; i++) await store.reserveSearch(today, 8);
    await assert.rejects(restarted.reserveSearch(today, 8), /Daily Exa search allowance/);
    assert.equal(networkCalls, 4);
  },
);
