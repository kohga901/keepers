# Catalog price refresh

A standalone Cloudflare Worker reads the existing `Clothing.item_web_listing`
URLs and proposes updates to `Clothing.item_price`. **It ships in dry-run mode.**
Dry runs make only GET requests to Supabase: they do not change clothing rows,
schema, alerts, or emails. Reports and the scheduled scan cursor live in Cloudflare
KV, so no Supabase migration is required.

## Run a local dry run first

Requires Node 22+ (the project is tested with Node 24).

```powershell
cd workers/price-refresh
npm ci
Copy-Item .dev.vars.example .dev.vars
```

Fill in `SUPABASE_URL` and `SUPABASE_KEY` in `.dev.vars`. Use the intended
project's **server-side** secret/service-role key, or a key/JWT with SELECT access
to `Clothing`. An anonymous frontend key can return an empty array when row-level
security hides the catalog. Do not weaken RLS to make the worker work. Do not put
server credentials in Expo variables or commit `.dev.vars`.

```powershell
npm run dry-run -- --env-file .dev.vars --limit 10 --output reports/sample.json
```

The CLI always runs read-only, even if `DRY_RUN=false` is set elsewhere. It saves
a JSON report locally and prints its path, counts, and the next cursor. An empty
first page prints a permissions warning and exits with a nonzero status; it is
not treated as proof that the catalog is empty.

For subsequent pages, pass the preceding report's `next_after_id`:

```powershell
npm run dry-run -- --env-file .dev.vars --after-id 123 --limit 50 --output reports/next.json
```

Stop when `cycle_complete` is true. The maximum batch is 50 rows. IDs are ordered
by `item_id`, not assumed to be consecutive; failed or missing links still advance
the scan. They are checked again on the next catalog sweep.

## Review the report

Each result includes `item_id`, saved `url`, `stored_price`, `extracted_price`,
verification time, currency, availability and extraction source where available:

| Status | Meaning |
| --- | --- |
| `would_update` | A verified USD offer differs from the stored price; no write in a dry run. |
| `unchanged` | The numeric price is already current. |
| `skipped` | Missing/ambiguous product data, unverified variant, other currency or unavailable offer. See `reason`. |
| `error` | Fetch, size, redirect or database failure. See `reason`. |
| `updated` / `conflict` | Live mode only: changed the price, or the row changed before the conditional write. |

Open the saved retailer URLs and compare the exact variant's public USD sale
price with `extracted_price`. Check several different merchants, unchanged rows,
large changes, sold-out items and skips before considering live mode. Reports
may include private catalog URLs, so keep them private too; local reports are
gitignored. Neither credentials nor raw merchant/database responses are saved.

## Deploy the dry-run Worker

Set a separate random `ADMIN_TOKEN` of at least 32 characters in `.dev.vars`.
The token protects manual runs and report retrieval. For example, generate one:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npx wrangler login
npm run deploy -- --secrets-file .dev.vars
```

Wrangler uploads `.dev.vars` as encrypted Worker secrets and provisions the
`PRICE_REFRESH` KV binding on first deployment. No Cloudflare credentials or
resource IDs are committed. `wrangler.jsonc` is the configuration source of truth:

- `DRY_RUN="true"` leaves Supabase untouched on every scheduled run.
- Cron runs every 15 minutes (UTC), checking up to `BATCH_SIZE="50"` rows.
- Three merchant requests run concurrently; identical URLs share a fetch within
  each batch. Meaningful query parameters, including variants, are retained.
- A separate cursor for each mode advances after the report is saved and wraps
  to zero at the end. At 50 rows every 15 minutes this processes up to 4,800 rows
  per day, subject to runtime and failures; this is a sweep, not a freshness SLA.
- Reports expire after seven days. The latest scheduled summary is also logged.
- Prefer Workers Paid for catalog scans. Free CPU/subrequest limits are too
  restrictive for the default batch; the build does not subscribe to a plan.

To call a deployed Worker from PowerShell, set `PRICE_REFRESH_ADMIN_TOKEN` in
your shell to the same admin token, then use the URL printed by deployment:

```powershell
$workerUrl = 'https://keepers-price-refresh.YOUR_SUBDOMAIN.workers.dev'
$headers = @{ Authorization = "Bearer $env:PRICE_REFRESH_ADMIN_TOKEN" }
Invoke-RestMethod "$workerUrl/dry-run" -Method Post -Headers $headers -ContentType 'application/json' -Body '{"limit":10}' |
    ConvertTo-Json -Depth 12
Invoke-RestMethod "$workerUrl/reports/latest" -Headers $headers | ConvertTo-Json -Depth 12
```

`POST /dry-run` accepts only `after_id` and `limit`; it **always** previews,
including when the scheduled worker is live. Manual runs do not move the cron
cursor. `GET /reports/REPORT_ID` retrieves an older report by its UUID. There is
no public run endpoint, CORS allowance, or HTTP switch to turn on writes. Run
`npm run dev` to exercise these endpoints locally with local KV and `.dev.vars`.

## Extraction limits

The extractor reads JSON-LD Product/Offer data, including `@graph` references,
ProductGroup children identified by their offer URL, and matching variant offers.
Exact variant offers take priority over generic entries and sibling variants.
It also supports page-level Open Graph product-price metadata with a matching
product URL. It does not take the first dollar amount on a page or use search
to replace a saved URL.

For pages with marked Shopify product JSON (`data-product-json` or
`data-product`), it can read the exact saved `variant` ID's integer-cent price
and explicit stock status. The embedded product handle must match the fetched
product path, and matching page product data must establish USD. It does not
execute scripts or use unrelated product/recommendation JSON. Subscription-only
variants and expired/member-only offer evidence remain excluded.

An automatic update requires a positive, single USD price and explicit InStock
availability. Price ranges, expired offers, conditional member offers, unknown
currency/stock and conflicting offers are left for review. Known variant/SKU,
color and size selectors (including `seq`) in the saved URL must match the product
or offer URL. Embedded JSON fallback supports only a single `variant` selector;
additional size/color selectors still require a matching structured offer.
There is no guess based on another product's name or photo. Current catalog
prices remain strings such as `$24.99` for compatibility with the app and its
existing price-alert trigger.

Merchant requests have a 15-second timeout, a 2 MiB body limit and at most three
redirects. Same-merchant product slug changes are accepted when they preserve the
saved variant ID or a stable numeric product ID. A renamed variant page must
provide a matching offer URL or marked embedded variant data before its price
can be verified. Extraction uses the final product URL; reports retain the
original URL, final URL and redirect chain for review. Unicode and percent-escape
spelling differences are normalized when comparing product paths.

Known tracking/navigation parameters may disappear during redirects. Private/IP
URLs, credentials, non-HTTPS targets, unrelated merchant or home/category
redirects, and redirects dropping/changing meaningful or unknown query
parameters remain rejected. Currency and country comparisons ignore letter case.
The worker never forwards Supabase/admin credentials to merchants. Blocked pages
are reported; there is no CAPTCHA bypass or automatic browser fallback.

Pages that render prices only in JavaScript, omit stock/currency, use unsupported
markup or present unusual variant selectors may be skipped. Structured data can
itself be stale. Pilot coverage must be measured against real merchant pages;
add targeted adapters or browser rendering only for demonstrated gaps.

## Enable writes only after reviewing real dry-run results

This has **not** been enabled. After the reports are accepted, change only
`DRY_RUN` to the literal string `"false"` in `wrangler.jsonc` and redeploy. Any
missing or other value stays read-only. The next scheduled run starts its own
live cursor from zero. Restoring `"true"` and redeploying disables scheduled
writes again. The local CLI and `/dry-run` remain read-only in either mode.

Live runs update only existing `item_price` values, only when the numeric amount
changes. The update also checks that the original stored price and URL still
match, so a concurrent edit causes a conflict rather than being overwritten.
The key needs UPDATE access for live mode. There are no catalog inserts, deletes,
or embedding changes. Updates can immediately fire existing price alerts and
queue emails if those migrations are installed; confirm their deployed state.

KV is eventually consistent and is not a distributed lock. Concurrent scans can
repeat work, and compare-and-set is not a substitute for strict observation
ordering if another updater is added. Keep one scheduled refresher; introduce a
transactional lease before multiple live refresh writers are necessary.

## Verification

```powershell
npm test
npm run build
```

Tests use mock Supabase/merchant HTTP boundaries and exercise real HTML parsing,
variant selection, currency/stock guards, dry-run mutation prevention, paging,
authentication, cursor/report persistence, conditional writes and failed requests.
`build` invokes Wrangler with `--dry-run`; it bundles without deploying.

Reference: [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/),
[runtime limits](https://developers.cloudflare.com/workers/platform/limits/),
[KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/),
[Wrangler resource provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning),
[secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
