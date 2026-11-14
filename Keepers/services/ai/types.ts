import { z } from 'zod';

export const aiProviderSchema = z.enum(['google', 'openai']);

export type AiProvider = z.infer<typeof aiProviderSchema>;

const modelListingSchema = z.object({
  title: z.string().min(1).max(240).describe('The listing title shown by the seller'),
  url: z
    .string()
    .min(1)
    .max(2_048)
    .describe('A direct HTTPS product or marketplace listing URL'),
  seller: z.string().min(1).max(120).describe('The retailer, marketplace, or seller name, or unknown'),
  displayedPrice: z.string().min(1).max(80).describe('Price exactly as displayed with currency, or unknown'),
  condition: z.enum(['new', 'used', 'refurbished', 'unknown']),
  matchType: z.enum(['exact', 'similar']),
  confidence: z.number().min(0).max(1),
  evidence: z.string().min(1).max(500).describe('Brief evidence supporting the match classification'),
});

export const modelLookupSchema = z.object({
  identifiedItem: z.object({
    name: z.string().min(1).max(240),
    brand: z.string().min(1).max(120).describe('Brand name, or unknown'),
    category: z.string().min(1).max(120),
    colors: z.array(z.string().max(80)).max(12),
    identifiers: z
      .array(z.string().max(120))
      .max(12)
      .describe('Visible model names, SKUs, logos, or other identifiers'),
  }),
  searchSummary: z.string().min(1).max(1_000),
  listings: z.array(modelListingSchema).max(10),
});

const httpsUrlSchema = z.string().max(2_048).url().refine((value) => new URL(value).protocol === 'https:');

export const imageLookupResultSchema = modelLookupSchema.extend({
  provider: aiProviderSchema,
  model: z.string().min(1),
  listings: z.array(modelListingSchema.extend({ url: httpsUrlSchema, sourceBacked: z.boolean() })).max(10),
  searchLinks: z.array(z.object({
    marketplace: z.string(), query: z.string(), title: z.string(), url: httpsUrlSchema,
  })).max(8),
  sources: z.array(z.object({ title: z.string(), url: httpsUrlSchema })).max(30),
});

export type ImageLookupResult = z.infer<typeof imageLookupResultSchema>;
export type ImageLookupInput = {
  itemId: string;
  maxResults?: number;
  signal?: AbortSignal;
};
