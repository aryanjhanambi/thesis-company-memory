import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.mjs';
test('API authenticates, validates, and returns a persisted integration result', async (t) => {
  let received;
  const services = {
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
  assert.equal((await fetch(base + '/api/health')).status, 401);
  const headers = {
    Authorization: 'Bearer test-token',
    'Content-Type': 'application/json',
    Origin: 'https://example.github.io',
  };
  const health = await fetch(base + '/api/health', { headers });
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
test('backend refuses to run unprotected without API_TOKEN', async (t) => {
  const server = createApp({}, {}).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/health`)).status, 503);
});
