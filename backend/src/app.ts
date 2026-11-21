import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import cron from 'node-cron';
import { envConfig } from './config/env';
import { apiRouter } from './api/routes';
import { flushOutbox, runRefundStubWorker, runReservationExpiryCleanup } from './events/pipeline';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  const allowedOrigins = new Set([
    envConfig.frontendUrl,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow same-origin requests (no Origin header) or configured frontend origins
        if (!origin || allowedOrigins.has(origin) || origin.endsWith('.run.app')) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      credentials: false,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  app.use(express.json({ limit: '1mb' }));

  // Security headers
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use('/api', apiRouter);

  // Fallback JSON 404 for unknown /api routes
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'API route not found.' });
  });

  // Error handler (never logs raw request bodies so OTPs cannot leak into logs)
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Express Error]', err.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Server error occurred.' });
  });

  return app;
}

let backgroundJobsStarted = false;

export function startBackgroundWorkers(): void {
  if (backgroundJobsStarted) return;
  backgroundJobsStarted = true;

  // 60-second reservation expiry cleanup (v7.2: ONLY status='reserved' AND expires_at < now())
  cron.schedule('* * * * *', () => {
    runReservationExpiryCleanup().catch((err) => {
      console.error('[Expiry Cleanup Error]', err instanceof Error ? err.message : err);
    });
  });

  // Outbox publisher & SIMULATED refund-stub worker polling every 4 seconds
  setInterval(() => {
    flushOutbox().catch(() => {});
    runRefundStubWorker(3000).catch(() => {});
  }, 4000);
}
