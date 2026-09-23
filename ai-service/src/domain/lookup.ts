import { z } from 'zod';

export const providerNameSchema = z.enum(['google', 'openai']);

const remoteImageUrlSchema = z
  .url()
  .refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
    message: 'imageUrl must use http or https',
  });

const dataImageUrlSchema = z
  .string()
  .regex(/^data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\s]+$/, {
    message: 'imageUrl must be a base64-encoded image data URL',
  });

export const lookupRequestSchema = z.object({
  imageUrl: z.union([remoteImageUrlSchema, dataImageUrlSchema]),
  provider: providerNameSchema.optional(),
  maxResults: z.number().int().min(1).max(10).default(5),
  itemHint: z.string().trim().min(1).max(300).optional(),
});

export const listingSchema = z.object({
  title: z.string().describe('The listing title shown by the seller'),
  url: z.url().describe('The direct product or marketplace listing URL'),
  seller: z.string().nullable().describe('Retailer, marketplace, or seller name'),
  displayedPrice: z.string().nullable().describe('Price exactly as displayed, including currency'),
  condition: z
    .enum(['new', 'used', 'refurbished', 'unknown'])
    .describe('The listing condition'),
  matchType: z.enum(['exact', 'similar']).describe('Whether this is the same item or only similar'),
  confidence: z.number().min(0).max(1).describe('Confidence that the match type is correct'),
  evidence: z.string().describe('Short visual or product-detail evidence for this match'),
});

export const modelLookupSchema = z.object({
  identifiedItem: z.object({
    name: z.string().describe('Concise product name'),
    brand: z.string().nullable(),
    category: z.string(),
    colors: z.array(z.string()),
    identifiers: z
      .array(z.string())
      .describe('Visible style names, model numbers, SKUs, logos, or other useful identifiers'),
  }),
  searchSummary: z.string().describe('A brief summary of what was searched and how strong the matches are'),
  listings: z.array(listingSchema),
});

export const sourceSchema = z.object({
  title: z.string().nullable(),
  url: z.url(),
});

export const lookupResponseSchema = modelLookupSchema.extend({
  provider: providerNameSchema,
  model: z.string(),
  sources: z.array(sourceSchema),
});

export type ProviderName = z.infer<typeof providerNameSchema>;
export type LookupRequest = z.infer<typeof lookupRequestSchema>;
export type ModelLookup = z.infer<typeof modelLookupSchema>;
export type LookupSource = z.infer<typeof sourceSchema>;
export type LookupResponse = z.infer<typeof lookupResponseSchema>;
