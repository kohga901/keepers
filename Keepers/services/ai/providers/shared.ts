import type { ImageLookupInput, ImageLookupResult, LookupSource, ModelLookup } from '../types';

const LOOKUP_TIMEOUT_MS = 90_000;

function parseHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function hostnameFor(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function normalizeSources(rawSources: unknown): LookupSource[] {
  if (!Array.isArray(rawSources)) return [];

  const sources: LookupSource[] = [];
  for (const rawSource of rawSources) {
    if (!rawSource || typeof rawSource !== 'object') continue;

    const candidate = rawSource as Record<string, unknown>;
    const url = parseHttpsUrl(candidate.url);
    if (!url) continue;

    sources.push({
      title:
        typeof candidate.title === 'string'
          ? candidate.title.slice(0, 240)
          : 'Search source',
      url,
    });
  }

  return Array.from(new Map(sources.map((source) => [source.url, source])).values());
}

export function buildLookupResult(
  provider: ImageLookupResult['provider'],
  model: string,
  output: ModelLookup,
  rawSources: unknown,
  maxResults: number,
): ImageLookupResult {
  const sources = normalizeSources(rawSources);
  const sourceUrls = new Set(sources.map((source) => source.url));
  const sourceHosts = new Set(
    sources.map((source) => hostnameFor(source.url)).filter((host): host is string => Boolean(host)),
  );
  const seen = new Set<string>();

  const listings = output.listings
    .flatMap((listing) => {
      const url = parseHttpsUrl(listing.url);
      if (!url || seen.has(url)) return [];
      seen.add(url);

      const host = hostnameFor(url);
      return [
        {
          ...listing,
          url,
          sourceBacked: sourceUrls.has(url) || (host !== null && sourceHosts.has(host)),
        },
      ];
    })
    .slice(0, maxResults);

  return {
    ...output,
    provider,
    model,
    listings,
    searchLinks: [],
    sources,
  };
}

export function createLookupAbortSignal(externalSignal?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();

  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

export function normalizedMaxResults(input: ImageLookupInput): number {
  return Math.min(8, Math.max(1, Math.floor(input.maxResults ?? 5)));
}
