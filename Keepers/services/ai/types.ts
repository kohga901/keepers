import { z } from 'zod';

export const aiProviderSchema = z.enum(['google', 'openai']);

export type AiProvider = z.infer<typeof aiProviderSchema>;

export const PROVIDER_DETAILS: Record<
  AiProvider,
  { label: string; model: string; keyLabel: string }
> = {
  google: {
    label: 'Google Gemini',
    model: 'gemini-2.5-flash',
    keyLabel: 'Gemini API key',
  },
  openai: {
    label: 'OpenAI',
    model: 'gpt-5-mini',
    keyLabel: 'OpenAI API key',
  },
};

const modelListingSchema = z.object({
  title: z.string().min(1).max(240).describe('The listing title shown by the seller'),
  url: z.url().max(2_048).describe('A direct product or marketplace listing URL'),
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

export type ModelLookup = z.infer<typeof modelLookupSchema>;

export type LookupSource = {
  title: string;
  url: string;
};

export type PurchaseListing = z.infer<typeof modelListingSchema> & {
  sourceBacked: boolean;
};

export type ImageLookupResult = Omit<ModelLookup, 'listings'> & {
  provider: AiProvider;
  model: string;
  listings: PurchaseListing[];
  sources: LookupSource[];
};

export type ImageLookupInput = {
  imageUrl: string;
  itemHint?: string;
  maxResults?: number;
  signal?: AbortSignal;
};

export interface ImageLookupProvider {
  readonly name: AiProvider;
  readonly model: string;
  lookup(input: ImageLookupInput): Promise<ImageLookupResult>;
}
