const actions = {
  retry: 'Retry after the cooldown; keep the last checked price until a fresh price is verified.',
  browser: 'Render the saved URL in a browser, then verify the same product, variant and USD offer.',
  merchant_access: 'Try a bounded browser probe. If blocked, use a merchant-approved API/feed or review the listing manually.',
  repair_listing: 'Review the original listing and redirect evidence. Replace a dead URL with an exact product/variant match, or retire the listing.',
  verify_variant: 'Find an offer for the saved size/color/SKU. Repair an obsolete selector only after confirming the exact variant.',
  select_offer: 'Verify which seller/variant and unconditional current price the saved URL selects; do not choose the cheapest offer.',
  usd_listing: 'Find the same product/variant on its US USD listing; do not convert or relabel a foreign price.',
  refresh_offer: 'Obtain a current, unconditional offer from the merchant; do not reuse expired or member-only prices.',
  review_price: 'Inspect the exact product page or approved feed for a published price; record unavailable when no price is published.',
  adapter: 'Inspect the rendered product payload and add a tested merchant adapter, or use an approved price feed; another blind render is unlikely to help.',
  fix_url: 'Repair the missing or unsafe URL to a public HTTPS product listing before fetching it.',
};

export function recoveryFor(result) {
  const reason = result.reason ?? 'unknown_failure';
  let action;
  const browser = result.browser_recovery;
  if (/^merchant_http_(401|402|403|405|406)$|merchant_challenge|browser_host_paused/.test(browser?.outcome ?? '')) action = 'merchant_access';
  else if (browser?.outcome === 'redirect_changed_product' && reason !== 'merchant_challenge') action = 'repair_listing';
  else if (browser?.attempted && ['no_supported_product_data', 'product_or_offer_not_verified', 'requires_browser_rendering'].includes(browser.outcome)) action = 'adapter';
  else if (/^merchant_http_(429|5\d\d)$|merchant_request_failed/.test(reason)) action = 'retry';
  else if (/^merchant_http_(401|402|403|405|406)$|merchant_challenge/.test(reason)) action = 'merchant_access';
  else if (/^merchant_http_(404|410)$|redirect_changed_product|invalid_redirect|too_many_redirects/.test(reason)) action = 'repair_listing';
  else if (/unsafe_product_url|invalid_product_url|missing_product_url/.test(reason)) action = 'fix_url';
  else if (reason === 'variant_not_verified') action = 'verify_variant';
  else if (/ambiguous_offers|price_range/.test(reason)) action = 'select_offer';
  else if (reason === 'currency_not_usd') action = 'usd_listing';
  else if (/expired_offer|conditional_offer/.test(reason)) action = 'refresh_offer';
  else if (/no_supported_product_data|product_or_offer_not_verified|requires_browser_rendering|page_too_large|product_data_too_large|unsupported_content_type/.test(reason)) action = 'browser';
  else action = 'review_price';
  return { action, next_step: actions[action], ...(result.retry_at ? { retry_at: result.retry_at } : {}) };
}

export const browserCandidate = reason => ['browser', 'merchant_access', 'verify_variant', 'select_offer', 'review_price', 'refresh_offer'].includes(recoveryFor({ reason }).action);

export function failureObservation(error) {
  const reason = /^(unsafe_|invalid_|merchant_http_|page_too_large|product_data_too_large|unsupported_content_type|redirect_changed_product|too_many_redirects)/.test(error.message)
    ? error.message : 'merchant_request_failed';
  return { verified: false, request_failed: true, reason,
    ...(error.redirects ? { redirects: error.redirects } : {}), ...(error.retry_at ? { retry_at: error.retry_at } : {}) };
}
