import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, Output, stepCountIs } from 'ai';

import { AiLookupError, toAiLookupError } from '../errors';
import { buildImageLookupPrompt } from '../prompt';
import {
  modelLookupSchema,
  PROVIDER_DETAILS,
  type ImageLookupInput,
  type ImageLookupProvider,
} from '../types';
import {
  buildLookupResult,
  createLookupAbortSignal,
  normalizedMaxResults,
} from './shared';

export function createGoogleLookupProvider(apiKey: string): ImageLookupProvider {
  const model = PROVIDER_DETAILS.google.model;
  const google = createGoogleGenerativeAI({ apiKey });

  return {
    name: 'google',
    model,
    async lookup(input: ImageLookupInput) {
      const maxResults = normalizedMaxResults(input);
      const abort = createLookupAbortSignal(input.signal);

      try {
        const result = await generateText({
          model: google(model),
          output: Output.object({
            name: 'image_purchase_lookup',
            description: 'An identified fashion item and current exact or similar purchase listings',
            schema: modelLookupSchema,
          }),
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', image: input.imageUrl },
                { type: 'text', text: buildImageLookupPrompt(input, maxResults) },
              ],
            },
          ],
          tools: {
            google_search: google.tools.googleSearch({
              searchTypes: { webSearch: {}, imageSearch: {} },
            }),
          },
          toolChoice: { type: 'tool', toolName: 'google_search' },
          stopWhen: stepCountIs(5),
          maxOutputTokens: 1_600,
          maxRetries: 0,
          abortSignal: abort.signal,
          experimental_telemetry: {
            isEnabled: false,
            recordInputs: false,
            recordOutputs: false,
          },
        });

        return buildLookupResult('google', model, result.output, result.sources, maxResults);
      } catch (error) {
        if (abort.signal.aborted && !input.signal?.aborted) {
          throw new AiLookupError('timeout');
        }
        throw toAiLookupError(error);
      } finally {
        abort.cleanup();
      }
    },
  };
}
