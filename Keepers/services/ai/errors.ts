export type AiLookupErrorCode =
  | 'cancelled'
  | 'unauthorized'
  | 'invalid_image'
  | 'unavailable'
  | 'network'
  | 'quota'
  | 'busy'
  | 'timeout'
  | 'unknown';

const USER_MESSAGES: Record<AiLookupErrorCode, string> = {
  cancelled: 'The lookup was cancelled.',
  unauthorized: 'Sign in again to search for this item.',
  invalid_image: 'This item is unavailable or does not have a usable image to search.',
  unavailable: 'AI shopping search is temporarily unavailable. Please try again later.',
  network: 'Shopping search could not be reached. Check your connection and try again.',
  quota: 'The shopping search limit has been reached. Please try again later.',
  busy: 'Shopping search is busy. Please try again in a moment.',
  timeout: 'Shopping search took too long to respond. Please try again.',
  unknown: 'Shopping search could not complete this lookup. Please try again.',
};

export class AiLookupError extends Error {
  readonly code: AiLookupErrorCode;

  constructor(code: AiLookupErrorCode) {
    super(USER_MESSAGES[code]);
    this.name = 'AiLookupError';
    this.code = code;
  }
}

export function toAiLookupError(error: unknown): AiLookupError {
  if (error instanceof AiLookupError) return error;
  if (error instanceof Error && error.name === 'AbortError') return new AiLookupError('cancelled');
  if (error && typeof error === 'object' && 'status' in error) {
    if (error.status === 401 || error.status === 403) return new AiLookupError('unauthorized');
    if (error.status === 429) return new AiLookupError('quota');
    if (error.status === 503) return new AiLookupError('unavailable');
    if (error.status === 504) return new AiLookupError('timeout');
    if (error.status === 502) return new AiLookupError('network');
  }
  return new AiLookupError(error instanceof TypeError ? 'network' : 'unknown');
}
