import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const equal = (a, b) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export function createApp(
  services,
  env = process.env,
  staticDirectory = fileURLToPath(new URL('../dist', import.meta.url)),
) {
  const app = express();
  // Copying Railway variables can append a newline. Normalize only the edges;
  // preserve the token's contents and constant-time comparison.
  const accessToken = (env.API_TOKEN || '').trim();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res
      .set('X-Content-Type-Options', 'nosniff')
      .set('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  // Railway probes process liveness without credentials. Configuration and
  // third-party connectivity remain behind the authenticated /api/health route.
  app.get('/healthz', (_req, res) => res.set('Cache-Control', 'no-store').json({ status: 'ok' }));
  // Public static UI, private API. Railway can serve both from one origin.
  if (existsSync(staticDirectory))
    app.use(
      express.static(staticDirectory, {
        dotfiles: 'deny',
        index: 'index.html',
        setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
      }),
    );
  const origins = (env.ALLOWED_ORIGIN || 'http://127.0.0.1:5173').split(',').map((s) => s.trim());
  app.use('/api', (req, res, next) => {
    const origin = req.get('Origin');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'no-store');
    const sameOrigin = origin === `${req.protocol}://${req.get('host')}`;
    if (origin && !sameOrigin && !origins.includes(origin))
      return res.status(403).json({ error: 'Origin is not allowed.' });
    if (origin) res.set('Access-Control-Allow-Origin', origin).set('Vary', 'Origin');
    res
      .set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      .set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    if (!accessToken)
      return res.status(503).json({ error: 'Set API_TOKEN before exposing the backend.' });
    const authorization = req.get('Authorization') || '';
    const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!suppliedToken || !equal(suppliedToken, accessToken))
      return res.status(401).json({ error: 'A valid access token is required.' });
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/agent/status', async (_req, res, next) => {
    try {
      res.json(await services.agent.status());
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/agent/scan', async (_req, res, next) => {
    try {
      res.status(202).json(await services.agent.launch());
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/agent/check', async (_req, res, next) => {
    try {
      res.json(await services.agent.check());
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/agent/config', async (req, res, next) => {
    try {
      res.json(await services.agent.configure(req.body));
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/agent/proposals/:id/review', async (req, res, next) => {
    try {
      res.json(await services.agent.review(req.params.id, req.body));
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/agent/history', async (req, res, next) => {
    try {
      if (typeof req.query.id !== 'string' || req.query.id.length > 150)
        return res.status(400).json({ error: 'Provide a relationship ID.' });
      res.json({ versions: await services.agent.history(req.query.id) });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/shocks/graph', async (req, res, next) => {
    try {
      res.json(await services.shock.graph(req.query.root, req.query.asOf));
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/shocks/seed', async (_req, res, next) => {
    try {
      res.json(await services.shock.seed());
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/shocks/backtest', async (req, res, next) => {
    try {
      res.json(await services.shock.backtest(req.body));
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/shocks/explain', async (req, res, next) => {
    try {
      res.json(await services.shock.explain(req.body || {}));
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/reports/discover', async (req, res, next) => {
    try {
      res.json(await services.discover(req.query.ticker));
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/health', async (_req, res, next) => {
    try {
      res.json(await services.health());
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/companies/:id/memory', async (req, res, next) => {
    try {
      res.json({ reports: await services.memory(req.params.id) });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/reports', async (req, res, next) => {
    try {
      const input = req.body;
      for (const field of ['companyId', 'companyName', 'title', 'period', 'url'])
        if (
          typeof input?.[field] !== 'string' ||
          !input[field].trim() ||
          input[field].length > (field === 'url' ? 2000 : 200)
        )
          return res.status(400).json({ error: `Provide a valid ${field}.` });
      const report = await services.ingest(
        Object.fromEntries(
          Object.entries(input).map(([key, value]) => [
            key,
            typeof value === 'string' ? value.trim() : value,
          ]),
        ),
      );
      res.status(201).json({ report });
    } catch (error) {
      next(error);
    }
  });
  app.use((_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    if (status >= 500) console.error('Request failed:', error.name);
    res.status(status).json({
      error:
        status === 500 ? 'Request failed. Check backend configuration and logs.' : error.message,
    });
  });
  return app;
}
