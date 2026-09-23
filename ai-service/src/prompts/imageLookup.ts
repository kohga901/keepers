import type { LookupRequest } from '../domain/lookup.ts';

export function buildImageLookupPrompt(input: LookupRequest): string {
  const hint = input.itemHint
    ? `The app has this unverified hint: "${input.itemHint}". Treat it only as a clue.`
    : 'No product-name hint is available.';

  return `
Identify the purchasable clothing or fashion item in the supplied image, then search the live web for active listings.

${hint}

Return at most ${input.maxResults} listings. Prefer exact matches, then visually and commercially similar alternatives.

Rules:
- A listing is exact only when brand, product line or style, colorway, and important visible details agree.
- Use direct product or marketplace listing pages, not search-result pages or home pages.
- Never invent a URL, seller, price, availability, identifier, or match claim.
- If a price or condition cannot be verified, return null or unknown as required by the schema.
- Keep duplicate listings out.
- Confidence measures confidence in exact-versus-similar classification, not general writing confidence.
- If the image is not a purchasable fashion item, return an empty listings array and explain that in searchSummary.
`.trim();
}
