import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output, stepCountIs } from 'ai';

import { modelLookupSchema, type LookupRequest } from '../domain/lookup.ts';
import { buildImageLookupPrompt } from '../prompts/imageLookup.ts';
import { normalizeSources } from './shared.ts';
import type { ImageLookupProvider } from './types.ts';

export function createOpenAIProvider(apiKey: string, model: string): ImageLookupProvider {
  const openai = createOpenAI({ apiKey });

  return {
    name: 'openai',
    model,
    async lookup(input: LookupRequest) {
      const result = await generateText({
        model: openai(model),
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
          web_search: openai.tools.webSearch({
            searchContextSize: 'medium',
          }),
        },
        stopWhen: stepCountIs(5),
      });

      return {
        ...result.output,
        provider: 'openai',
        model,
        sources: normalizeSources(result.sources, result.output),
      };
    },
  };
}
