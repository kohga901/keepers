import type { LookupSource, ModelLookup } from '../domain/lookup.ts';

const unknownSourceSchema = {
  read(value: unknown): LookupSource | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const candidate = value as Record<string, unknown>;
    if (typeof candidate.url !== 'string') {
      return null;
    }

    try {
      new URL(candidate.url);
    } catch {
      return null;
    }

    return {
      title: typeof candidate.title === 'string' ? candidate.title : null,
      url: candidate.url,
    };
  },
};

export function normalizeSources(rawSources: unknown, output: ModelLookup): LookupSource[] {
  const sources: LookupSource[] = [];

  if (Array.isArray(rawSources)) {
    for (const rawSource of rawSources) {
      const source = unknownSourceSchema.read(rawSource);
      if (source) {
        sources.push(source);
      }
    }
  }

  for (const listing of output.listings) {
    sources.push({ title: listing.title, url: listing.url });
  }

  return Array.from(new Map(sources.map((source) => [source.url, source])).values());
}
