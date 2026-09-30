import {
  createOpenAI,
  type OpenAILanguageModelResponsesOptions,
} from '@ai-sdk/openai';
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

export function createOpenAiLookupProvider(apiKey: string): ImageLookupProvider {
  const model = PROVIDER_DETAILS.openai.model;
  const openai = createOpenAI({ apiKey });

  return {
    name: 'openai',
    model,
    async lookup(input: ImageLookupInput) {
      const maxResults = normalizedMaxResults(input);
      const abort = createLookupAbortSignal(input.signal);

      try {
        const result = await generateText({
          model: openai.responses(model),
          output: Output.object({
            name: 'image_purchase_lookup',
            description: 'An identified fashion item and current exact or similar purchase listings',
            schema: modelLookupSchema,
          }),
          messages: [
            {
              role: 'user',
              content: [
                { type: 'file', mediaType: 'image', data: input.imageUrl },
                { type: 'text', text: buildImageLookupPrompt(input, maxResults) },
              ],
            },
          ],
          tools: {
            web_search: openai.tools.webSearch({
              externalWebAccess: true,
              searchContextSize: 'medium',
            }),
          },
          toolChoice: 'auto',
          prepareStep: ({ stepNumber }) =>
            stepNumber === 0
              ? { toolChoice: { type: 'tool', toolName: 'web_search' } }
              : undefined,
          providerOptions: {
            openai: {
              reasoningEffort: 'low',
              reasoningSummary: null,
              store: false,
            } satisfies OpenAILanguageModelResponsesOptions,
          },
          stopWhen: stepCountIs(5),
          maxOutputTokens: 4_000,
          maxRetries: 0,
          abortSignal: abort.signal,
          experimental_telemetry: {
            isEnabled: false,
            recordInputs: false,
            recordOutputs: false,
          },
        });

        return buildLookupResult('openai', model, result.output, result.sources, maxResults);
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
