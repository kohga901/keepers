import cors, { type CorsOptions } from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { config } from './config.ts';
import { lookupRequestSchema } from './domain/lookup.ts';
import { getProvider, getProviderStatus } from './providers/index.ts';
import { ProviderConfigurationError } from './providers/types.ts';

function corsOptions(): CorsOptions {
  if (config.corsOrigins.includes('*')) {
    return { origin: true };
  }

  return {
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin is not allowed by CORS'));
    },
  };
}

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors(corsOptions()));
  app.use(express.json({ limit: '12mb' }));

  app.get('/health', (_request, response) => {
    response.json({
      status: 'ok',
      defaultProvider: config.defaultProvider,
      providers: getProviderStatus(),
    });
  });

  app.post('/api/lookups/image', async (request, response, next) => {
    try {
      const input = lookupRequestSchema.parse(request.body);
      const provider = getProvider(input.provider ?? config.defaultProvider);
      const result = await provider.lookup(input);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: 'Route not found' });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      response.status(400).json({
        error: 'Invalid request',
        issues: error.issues,
      });
      return;
    }

    if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
      response.status(400).json({ error: 'Malformed JSON request body' });
      return;
    }

    if (error instanceof ProviderConfigurationError) {
      response.status(503).json({ error: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[image-lookup]', message);
    response.status(502).json({
      error: 'The AI provider could not complete the image lookup',
      detail: message,
    });
  });

  return app;
}
