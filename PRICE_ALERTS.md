# Price alerts in Expo Go

The implementation stays in Expo Go. Users open a liked item in History, enter
a target in USD, and see an unread badge on the bell when that target is reached.
The bell opens an inbox with notifications, active targets, cancellation and
read/unread controls. Alerts fire once; users can set another target afterward.

## Route comparison

| Route | Fits the current app? | Decision |
| --- | --- | --- |
| Compare prices only on the phone | Easy, but misses changes while the app is closed and does not share alert state between devices. | Rejected. |
| Supabase stores targets and creates notifications when catalog prices change | Reuses existing auth/database access, works with Expo Go, and records changes even when the app is closed. | Implemented. |
| Remote push through Expo | Requires a development/production build and push credentials. The project is testing in Expo Go. | Outside this implementation. |

The database trigger claims matching alerts and writes notifications in the
same transaction. A target can fire only once, even if the price changes again.
Saving a target locks the catalog item before changing the alert so a concurrent
price update cannot slip between the price check and subscription. Row-level
security isolates users; clients cannot forge notifications or change prices.

The app refreshes on sign-in, foreground return, pull-to-refresh, and every
60 seconds while active. Unread counts include all notifications; the inbox
shows the latest 50. Removing a like does not remove its explicit price alert;
users can still cancel it from the inbox. Alert state resets on account changes.

## Enable the feature

Run [`server/price_alerts.sql`](server/price_alerts.sql) **once** in the same
Supabase project's SQL editor as the database owner. This creates two tables,
their access policies, the authenticated save RPC and the catalog update trigger.
It does not change existing catalog rows. Restart Expo after adding the new route
so its generated route types include `/price-alerts`.

No new runtime dependency, background service or Expo notification permission is
needed. PGlite is a development-only dependency for testing the actual PostgreSQL
migration, triggers and row-level security without a live database.

## Prices must be refreshed

The current scrapers export prices, and Easy Upload inserts new items. There is
no recurring merchant-price refresh in the repository. Alerts respond to updates
to **existing** `Clothing.item_price` rows; they cannot discover merchant changes
themselves. An operator/importer must preserve the existing `item_id` and update
its price. Inserting a second copy with a new ID does not update the watched item.

The next data integration should revisit the stored merchant listing URLs and
write verified prices to those same rows. Merchant-specific fetching, scheduling
and product/variant matching need to be selected before claiming live store
monitoring. The app labels these as catalog prices and warns that store prices
may differ. No automatic merchant scraper or refresh schedule is added here.

Only unambiguous USD values such as `$29.99`, `USD 29.99`, `29.99` and
`$1,234.50` are supported. Missing prices, other currencies, negative prices and
price ranges do not trigger alerts. Targets must be positive, below the current
catalog price and have at most two decimal places. No currency conversion occurs.

## Validation

From `Keepers/`:

```sh
npm test
npm run typecheck
npm run lint
```

`tests/priceAlerts.database.test.cjs` executes the migration in an isolated
PostgreSQL engine. It checks exact thresholds, deduplication, rearming,
cancellation, invalid/stale prices, authenticated ownership, RLS, immutable
notification content, transactional rollback and account deletion.
`tests/priceAlerts.test.cjs` checks client validation, pagination, ownership
filters, unread counts, failures, foreground refresh, cancellation and stale
responses after sign-out. No live Supabase data is used.

For a device check after applying the migration: save a target below a liked
item's catalog price, update that existing catalog row to the target in Supabase,
and return to Keepers. Confirm a single unread notification appears, mark it read,
then change the price again and confirm no duplicate. Check the account-switch,
small-screen keyboard and pull-to-refresh flows on the devices used for testing.

References: [Expo Go and remote push](https://docs.expo.dev/develop/development-builds/faq/),
[Supabase triggers](https://supabase.com/docs/guides/database/postgres/triggers),
[Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).
