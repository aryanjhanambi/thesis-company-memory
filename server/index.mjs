import { createApp } from './app.mjs';
import { createServices } from './services.mjs';
const services = createServices();
const server = createApp(services).listen(Number(process.env.PORT || 8787), '0.0.0.0', () =>
  console.log(`Thesis API listening on port ${process.env.PORT || 8787}`),
);
services.start();
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    server.close(async () => {
      await services.close();
      process.exit(0);
    });
  });
