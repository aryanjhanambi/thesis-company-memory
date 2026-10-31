import test from 'node:test';
import assert from 'node:assert/strict';
import { runBacktest, parsePrices, samplePrices, validDate } from '../src/lib/backtest.mjs';
import { exposurePaths } from '../src/lib/shock-data.mjs';
import { createShockServices } from './shock-services.mjs';
const prices = [
  { date: '2024-03-18', ticker: 'NVDA', close: 1 },
  { date: '2024-03-19', ticker: 'NVDA', close: 100 },
  { date: '2024-03-19', ticker: 'SPY', close: 100 },
  { date: '2024-03-20', ticker: 'NVDA', close: 80 },
  { date: '2024-03-20', ticker: 'SPY', close: 110 },
];
const input = {
  prices,
  tickers: ['NVDA'],
  benchmark: 'SPY',
  asOf: '2024-03-18',
  end: '2024-03-20',
  capital: 10000,
  costBps: 100,
  direction: 'long',
};
test('entry excludes cutoff prices, costs both legs and exposes losing runs', () => {
  const result = runBacktest(input);
  assert.equal(result.entry, '2024-03-19');
  assert.equal(result.trades[0].price, 100);
  assert.ok(Math.abs(result.totalReturn - ((0.8 * 0.99) / 1.01 - 1)) < 1e-10);
  assert.ok(Math.abs(result.benchmarkReturn - ((1.1 * 0.99) / 1.01 - 1)) < 1e-10);
  assert.equal(result.maxDrawdown, result.totalReturn);
  assert.equal(result.trades.length, 2);
});
test('cash earns zero, benchmark still includes costs', () => {
  const result = runBacktest({ ...input, direction: 'cash' });
  assert.equal(result.totalReturn, 0);
  assert.equal(result.trades.length, 0);
  assert.ok(result.benchmarkReturn > 0);
});
test('basket has equal initial dollar weights and no rebalancing', () => {
  const result = runBacktest({
    ...input,
    costBps: 0,
    tickers: ['NVDA', 'TSM'],
    prices: [
      ...prices,
      { date: '2024-03-19', ticker: 'TSM', close: 200 },
      { date: '2024-03-20', ticker: 'TSM', close: 240 },
    ],
  });
  assert.equal(result.trades[0].shares, 50);
  assert.equal(result.trades[1].shares, 25);
  assert.ok(Math.abs(result.totalReturn) < 1e-10);
});
test('rejects missing dates, duplicates, invalid prices and unsupported strategies', () => {
  assert.throws(() => runBacktest({ ...input, prices: prices.slice(0, -1) }), /Missing SPY/);
  assert.throws(() => runBacktest({ ...input, prices: [...prices, prices[0]] }), /Duplicate/);
  assert.throws(() => runBacktest({ ...input, capital: NaN }), /Capital/);
  assert.throws(() => runBacktest({ ...input, direction: 'short' }), /Shorting/);
  assert.throws(() => runBacktest({ ...input, tickers: ['NVDA', 'NVDA'] }), /distinct/);
  assert.throws(
    () =>
      parsePrices(
        'date,ticker,close\n2024-03-19,NVDA,-1\n2024-03-19,SPY,2\n2024-03-20,NVDA,3\n2024-03-20,SPY,4',
      ),
    /positive/,
  );
  assert.equal(validDate('2024-02-30'), false);
});
test('replay hides future edges and discovers only permitted hops', () => {
  assert.equal(exposurePaths('MSFT', '2024-03-17').length, 1);
  assert.deepEqual(
    exposurePaths('MSFT', '2024-03-19', 1).map((p) => p.company),
    ['MSFT', 'NVDA'],
  );
  assert.ok(
    exposurePaths('MSFT', '2024-03-19', 2).some((p) => p.company === 'TSM' && p.edges.length === 2),
  );
  const custom = [{ id: 'future', from: 'MSFT', to: 'NVDA', published: '2025-01-01' }];
  assert.equal(exposurePaths('MSFT', '2024-03-19', 2, custom).length, 1);
});
test('synthetic fixture is deterministic and executable, not mislabeled market data', () => {
  assert.deepEqual(samplePrices(), samplePrices());
  assert.ok(
    runBacktest({ ...input, prices: samplePrices(), asOf: '2024-03-19', end: '2024-06-20' }).curve
      .length > 10,
  );
});
test('unconfigured integrations fail explicitly and validate before compute', async () => {
  const service = createShockServices({ env: {}, driver: null });
  await assert.rejects(service.seed(), /Configure Neo4j/);
  await assert.rejects(service.graph('MSFT', 'bad'), /ISO/);
  await assert.rejects(service.backtest(input), /Daytona is not configured/);
  await assert.rejects(service.backtest({}), /price rows/);
  await assert.rejects(service.explain({ root: 'MSFT', asOf: '2024-03-19' }), /NOSANA_API_KEY/);
});
test('Daytona adapter uploads only fixed code and JSON, blocks networking, and cleans up', async () => {
  const uploads = [];
  let config,
    deleted = false;
  const sandbox = {
    fs: {
      uploadFile: async (buffer, path) => {
        uploads.push([path, buffer.toString()]);
      },
    },
    process: {
      executeCommand: async (command) => {
        assert.equal(command, 'node /tmp/run-backtest.mjs');
        return { exitCode: 0, result: JSON.stringify(runBacktest(input)) };
      },
    },
  };
  const service = createShockServices({
    env: { DAYTONA_API_KEY: 'test-only' },
    driver: null,
    daytonaFactory: () => ({
      create: async (options) => {
        config = options;
        return sandbox;
      },
      delete: async (s) => {
        assert.equal(s, sandbox);
        deleted = true;
      },
    }),
  });
  assert.equal((await service.backtest(input)).executor, 'daytona');
  assert.equal(config.networkBlockAll, true);
  assert.equal(deleted, true);
  assert.deepEqual(JSON.parse(uploads.find(([p]) => p === '/tmp/backtest-input.json')[1]), input);
  assert.ok(
    uploads.find(([p]) => p === '/tmp/backtest.mjs')[1].includes('export function runBacktest'),
  );
  sandbox.process.executeCommand = async () => ({ exitCode: 1, result: 'failure' });
  deleted = false;
  await assert.rejects(service.backtest(input), /No local result was substituted/);
  assert.equal(deleted, true);
});
test('Neo4j queries gate every hop by cutoff and idempotently seed in one transaction', async () => {
  const queries = [];
  let closed = false;
  const tx = {
    run: async (query, params) => {
      queries.push({ query, params });
    },
  };
  const driver = {
    session: () => ({
      executeWrite: async (fn) => fn(tx),
      close: async () => {
        closed = true;
      },
    }),
    executeQuery: async (query, params) => {
      queries.push({ query, params });
      return { records: [] };
    },
  };
  const service = createShockServices({ env: {}, driver });
  assert.equal((await service.seed()).relationships, 5);
  assert.equal(closed, true);
  assert.match(queries[1].query, /MERGE/);
  const graph = await service.graph('MSFT', '2024-03-17');
  assert.deepEqual(
    graph.paths.map((p) => p.company),
    ['MSFT'],
  );
  assert.match(queries[2].query, /all\(r IN relationships\(p\) WHERE r.published <= \$asOf\)/);
  assert.equal(queries[2].params.asOf, '2024-03-17');
});
test('Nosana inference receives only eligible evidence and never treats failure as a demo answer', async () => {
  let sent;
  const service = createShockServices({
    env: {
      NOSANA_INFERENCE_URL: 'https://nosana-deployment.example/v1',
      NOSANA_MODEL: 'test-model',
    },
    driver: null,
    fetcher: async (url, options) => {
      assert.equal(url, 'https://nosana-deployment.example/v1/chat/completions');
      sent = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Insufficient evidence at this date.' } }],
        }),
      };
    },
  });
  const result = await service.explain({ root: 'MSFT', asOf: '2024-03-17' });
  assert.deepEqual(JSON.parse(sent.messages[1].content).evidence, []);
  assert.equal(result.model, 'test-model');
  const failing = createShockServices({
    env: {
      NOSANA_INFERENCE_URL: 'https://nosana-deployment.example/v1',
      NOSANA_MODEL: 'test-model',
    },
    driver: null,
    fetcher: async () => ({ ok: false }),
  });
  await assert.rejects(
    failing.explain({ root: 'MSFT', asOf: '2024-03-19' }),
    /provider request failed/,
  );
});
