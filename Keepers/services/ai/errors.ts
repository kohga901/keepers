export type AiLookupErrorCode =
  | 'cancelled'
  | 'invalid_key'
  | 'invalid_image'
  | 'missing_key'
  | 'model_unavailable'
  | 'network'
  | 'not_supported'
  | 'quota'
  | 'timeout'
  | 'unknown';

const USER_MESSAGES: Record<AiLookupErrorCode, string> = {
  cancelled: 'The lookup was cancelled.',
  invalid_key: 'The saved API key was rejected. Replace it in Settings and try again.',
  invalid_image: 'This item does not have a valid secure image URL to search.',
  missing_key: 'Add an API key for the selected provider in Settings before searching.',
  model_unavailable: 'This model is not available for the selected API project. Try another provider.',
  network: 'The provider could not be reached. Check your connection and try again.',
  not_supported: 'AI lookup is available only in the native iOS and Android app.',
  quota: 'The provider reported a quota, billing, or rate-limit problem for this API key.',
  timeout: 'The provider took too long to respond. Please try again.',
  unknown: 'The provider could not complete this lookup. Please try again.',
};

export class AiLookupError extends Error {
  readonly code: AiLookupErrorCode;

  constructor(code: AiLookupErrorCode) {
    super(USER_MESSAGES[code]);
    this.name = 'AiLookupError';
    this.code = code;
  }
}

function readStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;

  const candidate = error as Record<string, unknown>;
  const value = candidate.statusCode ?? candidate.status;
  return typeof value === 'number' ? value : undefined;
}

export function toAiLookupError(error: unknown): AiLookupError {
  if (error instanceof AiLookupError) return error;

  if (error instanceof Error && error.name === 'AbortError') {
    return new AiLookupError('cancelled');
  }

  const statusCode = readStatusCode(error);
  if (statusCode === 401 || statusCode === 403) {
    return new AiLookupError('invalid_key');
  }
  if (statusCode === 404) {
    return new AiLookupError('model_unavailable');
  }
  if (statusCode === 402 || statusCode === 429) {
    return new AiLookupError('quota');
  }

  if (error instanceof TypeError) {
    return new AiLookupError('network');
  }

  return new AiLookupError('unknown');
}
