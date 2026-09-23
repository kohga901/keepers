import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

import { providerNameSchema } from './domain/lookup.ts';

loadEnv({ quiet: true });

const optionalSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z.object({
  AI_PROVIDER: providerNameSchema.default('google'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  CORS_ORIGINS: z.string().default('*'),
  GOOGLE_GENERATIVE_AI_API_KEY: optionalSecret,
  GEMINI_API_KEY: optionalSecret,
  GOOGLE_MODEL: z.string().min(1).default('gemini-2.5-flash'),
  OPENAI_API_KEY: optionalSecret,
  OPENAI_MODEL: z.string().min(1).default('gpt-5-mini'),
});

const parsedEnv = envSchema.parse(process.env);

export const config = {
  defaultProvider: parsedEnv.AI_PROVIDER,
  host: parsedEnv.HOST,
  port: parsedEnv.PORT,
  corsOrigins: parsedEnv.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  google: {
    apiKey: parsedEnv.GOOGLE_GENERATIVE_AI_API_KEY ?? parsedEnv.GEMINI_API_KEY,
    model: parsedEnv.GOOGLE_MODEL,
  },
  openai: {
    apiKey: parsedEnv.OPENAI_API_KEY,
    model: parsedEnv.OPENAI_MODEL,
  },
} as const;
