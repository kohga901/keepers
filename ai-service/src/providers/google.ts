import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, Output, stepCountIs } from 'ai';

import { modelLookupSchema, type LookupRequest } from '../domain/lookup.ts';
import { buildImageLookupPrompt } from '../prompts/imageLookup.ts';
import { normalizeSources } from './shared.ts';
import type { ImageLookupProvider } from './types.ts';

export function createGoogleProvider(apiKey: string, model: string): ImageLookupProvider {
  const google = createGoogleGenerativeAI({ apiKey });

  return {
    name: 'google',
    model,
    async lookup(input: LookupRequest) {
      const result = await generateText({
        model: google(model),
        output: Output.object({
          name: 'image_purchase_lookup',
          description: 'An identified fashion item and active exact or similar purchase listings',
          schema: modelLookupSchema,
        }),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', image: input.imageUrl },
              { type: 'text', text: buildImageLookupPrompt(input) },
            ],
          },
        ],
        tools: {
          google_search: google.tools.googleSearch({
            searchTypes: { webSearch: {}, imageSearch: {} },
          }),
        },
        stopWhen: stepCountIs(5),
      });

      return {
        ...result.output,
        provider: 'google',
        model,
        sources: normalizeSources(result.sources, result.output),
      };
    },
  };
}
