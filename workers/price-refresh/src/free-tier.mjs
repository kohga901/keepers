export const FREE_TIER_LIMITS = Object.freeze({ batch_size: 1, html_bytes: 256 * 1024, json_bytes: 64 * 1024, fetches: 16 });

// Byte/work bounds reduce CPU risk; Workers does not expose a usable in-request CPU timer.
export function freeTierFetcher(fetcher) {
  const stats = { requests: 0 };
  const bounded = async (input, init) => {
    if (stats.requests >= FREE_TIER_LIMITS.fetches) throw new Error('free_tier_request_limit');
    stats.requests++;
    const response = await fetcher(input, init);
    if (!response.ok || !response.body) return response;
    const json = /(?:application\/(?:json|[^;]+\+json|javascript)|text\/javascript)/i.test(response.headers.get('content-type') ?? '');
    const maximum = json ? FREE_TIER_LIMITS.json_bytes : FREE_TIER_LIMITS.html_bytes;
    if (Number(response.headers.get('content-length')) > maximum) {
      await response.body.cancel(); throw new Error('free_tier_page_limit');
    }
    const reader = response.body.getReader(); let bytes = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) { controller.close(); return; }
          bytes += value.byteLength;
          if (bytes > maximum) {
            await reader.cancel(); controller.error(new Error('free_tier_page_limit')); return;
          }
          controller.enqueue(value);
        } catch (error) { controller.error(error); await reader.cancel().catch(() => {}); }
      },
      cancel(reason) { return reader.cancel(reason); },
    });
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  bounded.stats = stats;
  return bounded;
}
