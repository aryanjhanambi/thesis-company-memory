import express from 'express';
import { timingSafeEqual } from 'node:crypto';

const equal = (a, b) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export function createApp(services, env = process.env) {
  const app = express();
  app.disable('x-powered-by');
  const origins = (env.ALLOWED_ORIGIN || 'http://127.0.0.1:5173').split(',').map((s) => s.trim());
  app.use((req, res, next) => {
    const origin = req.get('Origin');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'no-store');
    if (origin && !origins.includes(origin))
      return res.status(403).json({ error: 'Origin is not allowed.' });
    if (origin) res.set('Access-Control-Allow-Origin', origin).set('Vary', 'Origin');
    res
      .set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      .set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    if (!env.API_TOKEN)
      return res.status(503).json({ error: 'Set API_TOKEN before exposing the backend.' });
    if (!equal(req.get('Authorization') || '', `Bearer ${env.API_TOKEN}`))
      return res.status(401).json({ error: 'A valid access token is required.' });
    next();
  });
  app.use(express.json({ limit: '1mb' }));
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
        status === 500
          ? 'Report processing failed. Check backend configuration and logs.'
          : error.message,
    });
  });
  return app;
}
