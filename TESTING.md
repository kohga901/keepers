# Keepers test suite

## Run locally

Use Node 22 or newer and Python 3.14, matching CI. Tests need no credentials,
running server, device, model downloads, or external services.

Frontend, from `Keepers/`:

```sh
npm ci
npm test
npm run typecheck
npm run lint
```

In PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.
The existing `npm run test:graph` and `npm run test:stylewrap` still work.

Backend and ingestion, from the repository root:

```sh
python -m venv .venv
```

Activate `.venv` with `.venv\Scripts\Activate.ps1` on Windows or
`source .venv/bin/activate` on macOS/Linux, then run:

```sh
python -m pip install -r server/requirements-test.txt
python -m unittest discover -s server/tests -t server -v
```

The dependency subset uses the production versions of NumPy, FAISS, FastAPI,
Starlette, Pydantic, HTTPX, dotenv and Supabase. The runners are Python's
`unittest` and Node's `node:test`; no testing framework was added.
The full server requirements also work, but include unnecessary ML packages
for these tests. Dependency installation requires network access; test execution
does not contact external services.

GitLab CI runs both suites alongside the existing typecheck, lint and syntax
jobs, under the repository's existing GitLab.com mirror workflow rules.

## Repository understanding and priorities

Keepers recommends clothing through an Expo/React Native app and a FastAPI
service. The frontend loads a signed-in user's deck, prefetches more items,
records likes/dislikes, filters by tags, displays reaction history and a style
recap, and draws a map of clothing and the user's taste. Optional native AI
lookup identifies clothing and helps find shopping links using a user-supplied
provider key.

The critical backend path is:

1. `Startup.initialize` reads paginated catalog embeddings, normalizes and
   centers them, builds a FAISS cosine-similarity index, detects copies of
   products, and loads tags and map coordinates.
2. `user_state` loads ordered reactions, caches them, and tracks served products
   and their copies. Likes drive a recency-weighted preference vector; dislikes
   push that vector away from unwanted clothing.
3. `/clothes/recommendations` holds the user's lock across history lookup,
   recommendation selection, catalog retrieval and marking items served. Cold
   users get random unseen products. Other users get similarity ranking with
   MMR diversity and adjacent/random exploration. Filters apply across all pools.
4. `/clothes/swipe` persists reactions and updates the cache. Periodic background
   work stores preferences and map coordinates. Undo and authenticated history
   clearing update the same state.
5. Local upload/relabel tools update both persistence and the live index/tag
   lookups so changes appear without restarting the server.

`Image_Process_PL` supplies the image-download, background-removal and CLIP
embedding pipeline. `Scrapers` collects catalog metadata; `ML_Pipeline` and
older scripts under `server/services` contain offline experiments and data
conversion/visualization tools. These support catalog creation but are outside
the running mobile recommendation path. Their heavy model execution and live
web scraping are not part of the default suite.

The suite prioritizes wrong recommendations, repeated products, lost/mixed
reactions, incorrect user scoping, stale async responses and misleading success
after dependency failure. It does not target a coverage percentage.

## Functional coverage

| Area and tests | Behaviors protected / realistic regressions caught |
| --- | --- |
| `server/tests/test_recommendations.py` | Cold start without known likes; normalized dislike weighting; exact recency half-life; filtered exploration fading; similarity-weighted map positions; embedding centering; duplicate detection; OR within and AND across tag categories; unknown filters; relabel membership removal; live embedding insertion; paginated JSON/array embeddings; failed startup; degraded tag loading; real FAISS eligibility; MMR diversity; exploration in each client batch; depleted-pool fallback without repeated products. |
| `server/tests/test_user_state.py` | Ordered histories beyond one page; isolation between users; copied snapshots; repeat-swipe recency; switching reactions; unliking while keeping products seen; TTL refresh after external edits; missing timestamp fallback without hiding real errors; clearing served/filter history for only one user. |
| `server/tests/test_api.py` | Real HTTP validation and response serialization; cold and personalized feeds; attached tags and ranked row order; concurrent requests without overlapping products; persisted swipe/switch/undo workflows and background preference sync; failed writes/reads without corrupting cached state; retry recovery; authenticated clear scopes and ownership; token/scope rejection; warmup; populated filter options; three known-bug reproductions. |
| `server/tests/test_db.py` | Recovery after transient errors; final error propagation; partial, empty and exact-multiple pages; later page failure cannot silently truncate the catalog. |
| `server/tests/test_admin.py` | Disabled write tools; per-item upload errors with successful items still indexed and filterable; persisted and live relabel replacement; unknown tags/missing items cannot erase existing tags. |
| `server/tests/test_ingestion.py` | Pipeline stage order, limit/batch propagation, fail-fast behavior and optional clearing; offline merchant-card extraction keeps prices/photos/links associated with the correct product; duplicate scrapes prefer merchant links and preserve export fields. |
| `Keepers/tests/swiper.test.cjs` | Authenticated feed and reaction direction; same-user token refresh preserves the deck; sign-out removes cards; single in-flight prefetch; deck restart after exhaustion; stale filter responses ignored; refresh recovery; secure listing opening without losing the final card; one known-bug reproducer. |
| `Keepers/tests/serverApi.test.cjs` | Request/response contracts, reaction payloads, filtered errors/exhaustion never fall back to unrelated clothing, unfiltered fallback, uncertain swipe failures, bearer-authenticated clear requests and useful server/network errors. |
| `Keepers/tests/recap.test.cjs` | Unique saved reactions; category-specific tag percentages; duplicated/non-liked tag assignments ignored; personality thresholds/ties and milestone advancement; usable featured items; all reaction/tag pages and ID chunks; tag-only degradation versus reaction errors; cancellation and signed-out access. |
| `Keepers/tests/ai.test.cjs` | Shared concurrent lookups and cache separation; independent caller cancellation; safe provider errors and retries; invalid image/native-only validation; secure deduplicated listing URLs and source-host matching; deadline cleanup; provider-isolated credentials and development-only key overrides; Google shopping-link encoding and non-fashion results. |
| Existing graph/style-wrap tests | Map projection, zoom anchoring, safe previews, WebView bridge validation and gestures, stale metadata/cancellation, reaction reconciliation, lookup dismissal and catalog icon behavior. |

The original 33 frontend tests were retained. Nine initially failed because the
graph harness lacked the newly required tutorial context. Adding its boundary
stub restores those tests without changing their assertions or production code.

## Validation results

Validated locally on Windows with Node 24.14.0 and Python 3.14.3:

| Suite | Total | Passing | Known failing behavior | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Frontend | 61 | 60 | 1 executing TODO | 0 |
| Backend and ingestion | 52 | 49 | 3 expected failures | 0 |
| Total | 113 | 109 | 4 | 0 |

There are **80 new tests**, including the four bug reproductions. Both default
commands exit successfully because those known failures are explicitly marked;
this does **not** mean all application behavior is correct. Unexpected failures
still fail CI. Python also fails on an unexpected success of an expected-failure
test; Node TODO tests need their marker removed when fixed.

Frontend typecheck and lint, Python compilation across all four Python folders,
and `git diff --check` passed. The Linux CI jobs were added but were not executed
locally.

Assertion quality was checked with three temporary faults applied only in memory:

- Set dislike weight to zero: the preference-vector assertion failed.
- Disable duplicate expansion: the unique-product recommendation assertion failed.
- Allow unfiltered fallback while filters are active: the frontend returned an
  unrelated fixture item and the filtered-feed assertion failed.

All faults were restored automatically/by process exit. Production files were
never modified. The three backend known-bug tests were also run with their
expected-failure markers disabled in memory: all failed on the intended
assertions, with no test infrastructure errors.

## Known production bugs reproduced

No production fixes are included, per the task's constraint.

1. **Opposite reaction survives a cold cache.** Seed an existing dislike, then
   like that item before the user's cache is loaded. The route writes the like
   first. Loading history prioritizes likes and hides the existing dislike from
   the cache, so `record_swipe` misses the switch and the database cleanup never
   runs. The test expects only the like; both rows remain. A normal warm-cache
   switch is separately tested and passes.
2. **Negative recommendation count returns 500.** `n=-1` reaches random sampling
   instead of failing request validation with 422. The request model has no lower
   bound. The reproducer asserts the client-error response.
3. **Swipe identity is unverified.** The route accepts an arbitrary `user_id`
   without an authorization header and returns 200, updating that user's fixture
   history. The reproducer requires 401 and no write. The actual deployment's
   database key/RLS may affect persistence; the backend itself does not validate
   ownership. History-by-user routes also warrant an authorization review.
4. **Filter exhaustion looks like a connection error.** A successful empty
   filtered response causes `refreshDeck` to set `refreshFailed`, hiding the
   intended “No more items match these filters” message. The executing Node TODO
   retains the intended-message assertion; recovery on refresh is separately
   tested and passes.

Reproduce just the known cases using:

```sh
# From the repository root, using the test Python environment:
python -m unittest discover -s server/tests -t server -k test_regression_ -v

# From Keepers/ (shows the frontend assertion failure marked TODO):
node --test --test-name-pattern="regression:" tests/swiper.test.cjs
```

## Boundaries and remaining risks

- Backend tests use real FastAPI, Pydantic, NumPy and FAISS with a small,
  normalized 512-dimensional catalog. A strict, in-memory table fixture replaces
  Supabase at client creation, and dotenv loading is suppressed. Tests never need
  developers' credentials. External socket connections are blocked in backend
  tests; loopback is allowed for Windows asyncio's internal socket pair.
- The persistence fixture implements only the query operations under test. It
  does not validate real PostgREST wire behavior, foreign keys, constraints,
  transactions, RLS, JWT verification, or deployed database schema. A disposable
  Supabase integration environment is the next useful addition for those risks.
  The range fixture follows the SDK's [inclusive range contract](https://supabase.com/docs/reference/javascript/range).
- Screen tests execute real callbacks under deterministic hook scheduling, with
  native components stubbed. They do not prove actual React reconciliation,
  iOS/Android gesture rendering, secure-store encryption, accessibility or
  device lifecycle behavior. Device E2E tests should cover login, swipe, filter,
  history deletion/clear and account switching with in-flight requests.
- AI tests stop at provider/storage boundaries, except the Google adapter's
  structured-output transformation. They do not test live provider availability,
  SDK transport compatibility, model quality, purchase availability, or complete
  OpenAI/Anthropic multi-step research flows. No paid calls are made.
- CLIP inference, background removal, UMAP generation and image download are not
  run. Catalog/model quality needs a controlled image fixture and model artifacts;
  synthetic embeddings verify algorithm behavior rather than fashion relevance.
  Historical ML scripts, live scrapers, auth form error recovery, tutorial
  persistence and settings UI have no new dedicated tests.
- Seen/filter exposure state is process-local. Restarts, LRU eviction, multiple
  workers, and lock/cache invalidation races need additional stress/deployment
  testing. The concurrent-request test protects the normal single-process path.
- Recap expectations follow the documented distinction between saved reactions
  and lifetime swipe events: a product present in both tables counts as two saved
  reactions. Recommendation cache loading instead gives likes precedence. The
  tests preserve those distinct contracts rather than inventing event history.
