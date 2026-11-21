import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { envConfig } from './backend/src/config/env';
import { createApp, startBackgroundWorkers } from './backend/src/app';
import { ensureIndex } from './backend/src/search/opensearch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = createApp();
  const isProd = process.env.NODE_ENV === 'production';

  await ensureIndex().catch((err) => {
    console.warn('[OpenSearch Init Notice]', err instanceof Error ? err.message : err);
  });

  startBackgroundWorkers();

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  const port = envConfig.port;
  app.listen(port, '0.0.0.0', () => {
    console.log(
      `[BazaarBridge] Server running on http://0.0.0.0:${port} ` +
        `(PG: ${envConfig.isPgConfigured ? 'Aiven' : 'Local Sandbox'}, ` +
        `Kafka: ${envConfig.isKafkaConfigured ? 'Aiven' : 'Local Keyed Bus'}, ` +
        `OpenSearch: ${envConfig.isOpenSearchConfigured ? 'Aiven' : 'Local Fuzzy Index'})`
    );
  });
}

startServer().catch((err) => {
  console.error('[BazaarBridge] Failed to start server:', err);
  process.exit(1);
});
