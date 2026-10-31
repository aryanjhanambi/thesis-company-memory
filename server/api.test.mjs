import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.mjs';
import { fileURLToPath } from 'node:url';
test('API authenticates, validates, and returns a persisted integration result', async (t) => {
  let received;
  const services = {
    agent: {
      status: async () => ({ ready: false, missing: ['EXA_API_KEY'] }),
      launch: async () => ({ id: 'test-agent-run', status: 'running' }),
      configure: async (input) => input,
      review: async (id, input) => ({ id, ...input }),
      check: async () => ({ exa: true, nosana: true, neo4j: true }),
      history: async (id) => [{ logicalId: id }],
    },
    shock: {
      seed: async () => ({ relationships: 5 }),
      graph: async (root, asOf) => ({ root, asOf, paths: [] }),
      backtest: async (input) => ({ executor: 'daytona', tickers: input.tickers }),
      explain: async () => ({ text: 'Test explanation' }),
    },
    discover: async (ticker) => ({
      ticker,
      reports: [{ title: 'Official report', url: 'https://www.sec.gov/report' }],
    }),
    health: async () => ({ neo4j: true, daytona: true }),
    ingest: async (input) => {
      received = input;
      return { id: 'test-report', ...input, provenance: 'live' };
    },
    memory: async () => [{ id: 'test-report' }],
  };
  const server = createApp(services, {
    API_TOKEN: 'test-token',
    ALLOWED_ORIGIN: 'https://example.github.io',
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const liveness = await fetch(base + '/healthz');
  assert.equal(liveness.status, 200);
  assert.deepEqual(await liveness.json(), { status: 'ok' });
  assert.equal((await fetch(base + '/api/health')).status, 401);
  const headers = {
    Authorization: 'Bearer test-token',
    'Content-Type': 'application/json',
    Origin: 'https://example.github.io',
  };
  const health = await fetch(base + '/api/health', { headers });
  assert.equal(
    (await (await fetch(base + '/api/agent/status', { headers })).json()).missing[0],
    'EXA_API_KEY',
  );
  assert.equal(
    (await fetch(base + '/api/agent/scan', { method: 'POST', headers, body: '{}' })).status,
    202,
  );
  assert.equal(
    (
      await (
        await fetch(base + '/api/agent/config', {
          method: 'POST',
          headers,
          body: '{"enabled":false}',
        })
      ).json()
    ).enabled,
    false,
  );
  assert.equal(
    (await (await fetch(base + '/api/agent/check', { method: 'POST', headers, body: '{}' })).json())
      .exa,
    true,
  );
  assert.equal(
    (
      await (
        await fetch(base + '/api/agent/proposals/test/review', {
          method: 'POST',
          headers,
          body: '{"decision":"reject"}',
        })
      ).json()
    ).decision,
    'reject',
  );
  assert.equal(
    (await (await fetch(base + '/api/agent/history?id=azure', { headers })).json()).versions[0]
      .logicalId,
    'azure',
  );
  assert.equal(
    (await fetch(base + '/api/shocks/seed', { method: 'POST', headers, body: '{}' })).status,
    200,
  );
  assert.deepEqual(
    await (await fetch(base + '/api/shocks/graph?root=MSFT&asOf=2024-03-19', { headers })).json(),
    { root: 'MSFT', asOf: '2024-03-19', paths: [] },
  );
  assert.equal(
    (
      await (
        await fetch(base + '/api/shocks/backtest', {
          method: 'POST',
          headers,
          body: JSON.stringify({ tickers: ['NVDA'] }),
        })
      ).json()
    ).executor,
    'daytona',
  );
  assert.equal(
    (
      await (
        await fetch(base + '/api/shocks/explain', { method: 'POST', headers, body: '{}' })
      ).json()
    ).text,
    'Test explanation',
  );
  const discovery = await fetch(base + '/api/reports/discover?ticker=NVDA', { headers });
  assert.equal(discovery.status, 200);
  assert.equal((await discovery.json()).ticker, 'NVDA');
  assert.equal(health.headers.get('access-control-allow-origin'), 'https://example.github.io');
  assert.equal((await health.json()).neo4j, true);
  assert.equal(
    (
      await fetch(base + '/api/health', {
        headers: { ...headers, Origin: 'https://untrusted.example' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(base + '/api/reports', { method: 'POST', headers, body: '{}' })).status,
    400,
  );
  const report = {
    companyId: 'nvda',
    companyName: 'NVIDIA',
    title: 'Quarterly report',
    period: 'Q3 FY25',
    url: 'https://investor.nvidia.com/report',
  };
  const result = await fetch(base + '/api/reports', {
    method: 'POST',
    headers,
    body: JSON.stringify(report),
  });
  assert.equal(result.status, 201);
  assert.equal((await result.json()).report.provenance, 'live');
  assert.deepEqual(received, report);
  assert.equal(
    (await (await fetch(base + '/api/companies/nvda/memory', { headers })).json()).reports.length,
    1,
  );
});
test('Railway serves static UI publicly while API and cross-origin access remain protected', async (t) => {
  const server = createApp(
    { health: async () => ({ neo4j: false }) },
    { API_TOKEN: 'local-test' },
    fileURLToPath(new URL('./fixtures/static', import.meta.url)),
  ).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.match(await (await fetch(base)).text(), /Public test dashboard/);
  assert.equal((await fetch(base + '/api/health')).status, 401);
  assert.equal(
    (
      await fetch(base + '/api/health', {
        headers: { Authorization: 'Bearer local-test', Origin: base },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(base + '/api/health', {
        headers: { Authorization: 'Bearer local-test', Origin: 'https://untrusted.example' },
      })
    ).status,
    403,
  );
  assert.equal((await fetch(base + '/server/services.mjs')).status, 404);
});
test('backend refuses to run unprotected without API_TOKEN', async (t) => {
  const server = createApp({}, {}).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/health`)).status, 503);
});

test('access tokens ignore surrounding whitespace but never accept missing or incorrect credentials', async (t) => {
  const server = createApp(
    { health: async () => ({ authenticated: true }) },
    { API_TOKEN: ' \n 0123456789abcdef \r\n' },
  ).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/health`;
  for (const value of ['Bearer 0123456789abcdef', 'Bearer   0123456789abcdef  ']) {
    const response = await fetch(url, { headers: { Authorization: value } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authenticated: true });
  }
  for (const value of ['', 'Bearer ', 'Basic 0123456789abcdef', '0123456789abcdef',
    'Bearer 0123456789abcdeg', 'Bearer 01234567 89abcdef']) {
    assert.equal((await fetch(url, { headers: { Authorization: value } })).status, 401);
  }
});

test('whitespace-only configured token keeps the backend closed', async (t) => {
  const server = createApp({}, { API_TOKEN: ' \r\n\t ' }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`, {
    headers: { Authorization: 'Bearer anything' },
  });
  assert.equal(response.status, 503);
});
