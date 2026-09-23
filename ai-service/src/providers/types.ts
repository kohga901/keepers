import type {
  LookupRequest,
  LookupResponse,
  ProviderName,
} from '../domain/lookup.ts';

export interface ImageLookupProvider {
  readonly name: ProviderName;
  readonly model: string;
  lookup(input: LookupRequest): Promise<LookupResponse>;
}

export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigurationError';
  }
}
