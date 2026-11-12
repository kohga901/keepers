/* global __dirname */
const { before, after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { createLoader } = require('./helpers/load.cjs');
const { parseAlertPrice } = createLoader()('utils/priceAlerts.ts');

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
let db;
before(async () => {
  db = new PGlite();
  // Supabase's auth boundary; the migration and all trigger/RLS logic run unchanged.
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    create table public."Clothing" (item_id bigint primary key, item_name text, item_price text);
    grant select on public."Clothing" to authenticated;
  `);
  await db.exec(fs.readFileSync(path.resolve(__dirname, '../../server/price_alerts.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.resolve(__dirname, '../../server/price_alert_emails.sql'), 'utf8'));
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`truncate auth.users, "Clothing" cascade;
    insert into auth.users (id, email, email_confirmed_at) values
      ('${alice}', 'alice@example.com', now()), ('${bob}', 'bob@example.com', now());
    insert into "Clothing" values (1, 'Linen shirt', '$40.00'), (2, 'Jacket', '$120.00');`);
});

async function asUser(user, action) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  await db.exec('set role authenticated');
  try { return await action(); }
  finally { await db.exec('reset role'); await db.exec("reset request.jwt.claim.sub"); }
}
const save = (user, item, target) => asUser(user, () =>
  db.query('select * from public.set_price_alert($1, $2)', [item, target]));
const price = (value, item = 1) => db.query('update "Clothing" set item_price = $1 where item_id = $2', [value, item]);
const notices = () => db.query('select * from "Price_Notifications" order by user_id');

test('email jobs are queued once with notifications and are inaccessible to clients', async () => {
  await save(alice, 1, '30');
  await price('$25');
  await price('$20');
  const jobs = await db.query('select * from public.price_alert_emails');
  assert.equal(jobs.rows.length, 1);
  assert.equal(jobs.rows[0].notification_id, (await notices()).rows[0].id);
  assert.equal(jobs.rows[0].sent_at, null);
  await asUser(alice, () => assert.rejects(db.query('select * from public.price_alert_emails'), /permission denied/));
  await asUser(alice, () => assert.rejects(db.query('select * from public.claim_price_alert_emails()'), /permission denied/));
  await asUser(alice, () => assert.rejects(db.query('select public.finish_price_alert_email($1, $2)',
    [jobs.rows[0].notification_id, alice]), /permission denied/));
  await db.query('delete from auth.users where id = $1', [alice]);
  assert.equal((await db.query('select * from public.price_alert_emails')).rows.length, 0);
});

test('email claims require verified accounts, lease jobs and reject stale completions', async () => {
  await save(alice, 1, '30');
  await price('$25');
  await db.exec(`update auth.users set email_confirmed_at = null where id = '${alice}'`);
  assert.equal((await db.query('select * from claim_price_alert_emails()')).rows.length, 0);
  await db.exec(`update auth.users set email_confirmed_at = now() where id = '${alice}'`);
  await db.exec('set role service_role');
  let job;
  try { job = (await db.query('select * from claim_price_alert_emails()')).rows[0]; }
  finally { await db.exec('reset role'); }
  assert.equal(job.recipient, 'alice@example.com');
  assert.equal(job.item_name, 'Linen shirt');
  assert.equal((await db.query('select * from claim_price_alert_emails()')).rows.length, 0);
  await db.exec("update price_alert_emails set next_attempt_at = now() - interval '1 second'");
  const retry = (await db.query('select * from claim_price_alert_emails()')).rows[0];
  assert.notEqual(retry.lease_id, job.lease_id);
  await db.query('select finish_price_alert_email($1, $2)', [job.notification_id, job.lease_id]);
  assert.equal((await db.query('select sent_at from price_alert_emails')).rows[0].sent_at, null);
  await db.query('select finish_price_alert_email($1, $2, $3)', [retry.notification_id, retry.lease_id, 'provider_http_429']);
  assert.equal((await db.query('select last_error from price_alert_emails')).rows[0].last_error, 'provider_http_429');
  await db.query('select finish_price_alert_email($1, $2)', [retry.notification_id, retry.lease_id]);
  assert.ok((await db.query('select sent_at from price_alert_emails')).rows[0].sent_at);
});

test('email retry limits prevent resending outside provider idempotency protection', async () => {
  await save(alice, 1, '30');
  await price('$25');
  await db.exec("update price_alert_emails set first_attempt_at = now() - interval '24 hours'");
  assert.equal((await db.query('select * from claim_price_alert_emails()')).rows.length, 0);
  assert.equal((await db.query('select last_error from price_alert_emails')).rows[0].last_error, 'retry_limit');
  await db.exec('update price_alert_emails set first_attempt_at = now(), failed_at = null, attempts = 12');
  assert.equal((await db.query('select * from claim_price_alert_emails()')).rows.length, 0);
  assert.ok((await db.query('select failed_at from price_alert_emails')).rows[0].failed_at);
});

test('SQL and client accept the same USD formats and reject ambiguous catalog prices', async () => {
  for (const [value, expected] of [
    ['$1,234.50', 1234.5], ['USD 25.99', 25.99], [' 30 ', 30], ['$0', 0], [null, null],
    ['', null], ['Free', null], ['€20', null], ['CAD 20', null], ['-$10', null],
    ['$10 - $30', null], ['12,34.50', null], ['1e2', null], ['2.999', null], ['NaN', null],
  ]) {
    const result = await db.query('select public.price_alert_usd($1)::float8 as price', [value]);
    assert.equal(result.rows[0].price, expected, String(value));
    assert.equal(parseAlertPrice(value), expected, String(value));
  }
});

test('an alert fires at its exact target once, stores a snapshot and can be explicitly rearmed', async () => {
  await save(alice, 1, '30.00');
  await price('$35');
  assert.equal((await notices()).rows.length, 0);
  await price('$30.00');
  const first = (await notices()).rows;
  assert.equal(first.length, 1);
  assert.equal(first[0].item_name, 'Linen shirt');
  assert.equal(first[0].price, '30.00');
  assert.equal(first[0].target_price, '30.00');
  assert.equal(first[0].read_at, null);
  const saved = (await db.query('select * from "Price_Alerts"')).rows[0];
  assert.equal(saved.active, false);
  assert.ok(saved.triggered_at);
  await price('$40'); await price('$25'); await price('$20');
  assert.equal((await notices()).rows.length, 1);
  await save(alice, 1, '15.00');
  await price('$15');
  assert.equal((await notices()).rows.length, 2);
});

test('targets update in place; cancelled alerts, unrelated products and invalid prices do not notify', async () => {
  await save(alice, 1, '30');
  await save(alice, 1, '20');
  await save(bob, 1, '25');
  await save(alice, 2, '100');
  assert.equal((await db.query('select * from "Price_Alerts"')).rows.length, 3);
  for (const value of ['€10', null, '$10 - $20', 'USD unavailable']) await price(value);
  assert.equal((await notices()).rows.length, 0);
  await asUser(bob, () => db.query('delete from "Price_Alerts" where clothes_id = 1'));
  await price('$25');
  assert.equal((await notices()).rows.length, 0);
  await price('$20');
  assert.deepEqual((await notices()).rows.map(row => row.user_id), [alice]);
  await price('$100', 2);
  assert.equal((await notices()).rows.length, 2);
});

test('RPC rejects invalid targets and stale catalog prices; the authenticated caller owns the alert', async () => {
  for (const value of ['0', '-1', '40', '50', '10.001', 'NaN', 'Infinity', '100000000', null]) {
    await assert.rejects(save(alice, 1, value));
  }
  await assert.rejects(save(alice, 999, '10'), /no longer available/);
  await price('€40');
  await assert.rejects(save(alice, 1, '20'), /supported USD/);
  await price('$15');
  await assert.rejects(save(alice, 1, '20'), /below the current/);
  await assert.rejects(save('', 1, '10'), /Sign in again/);
  await save(alice, 1, '10');
  assert.equal((await db.query('select user_id from "Price_Alerts"')).rows[0].user_id, alice);
  await db.exec('set role anon');
  try { await assert.rejects(db.query('select * from public.set_price_alert(1, 10)'), /permission denied/); }
  finally { await db.exec('reset role'); }
});

test('RLS isolates alerts and notifications; clients can only change their own read status', async () => {
  await save(alice, 1, '30');
  await save(bob, 1, '20');
  await asUser(bob, async () => {
    assert.equal((await db.query('select * from "Price_Alerts"')).rows.length, 1);
    assert.equal((await db.query('delete from "Price_Alerts" where user_id = $1 returning *', [alice])).rows.length, 0);
    await assert.rejects(db.query('update "Price_Alerts" set target_price = 100'), /permission denied/);
    await assert.rejects(db.query('insert into "Price_Alerts" values ($1, 2, 10, true, null)', [alice]), /permission denied/);
  });
  await price('$20');
  await asUser(alice, async () => {
    assert.deepEqual((await db.query('select user_id from "Price_Notifications"')).rows, [{ user_id: alice }]);
    assert.equal((await db.query('update "Price_Notifications" set read_at = now() where user_id = $1 returning id', [bob])).rows.length, 0);
    await db.query('update "Price_Notifications" set read_at = now()');
    await assert.rejects(db.query('update "Price_Notifications" set price = 1'), /permission denied/);
    await assert.rejects(db.query('insert into "Price_Notifications" (user_id, clothes_id, item_name, price, target_price) values ($1, 1, $2, 1, 1)', [alice, 'Forged']), /permission denied/);
    await assert.rejects(db.query('select public.notify_price_alerts()'), /permission denied/);
  });
  const rows = (await notices()).rows;
  assert.ok(rows[0].read_at);
  assert.equal(rows[1].read_at, null);
});

test('price changes and notifications roll back together; deleting an account removes private alert data', async () => {
  await save(alice, 1, '30');
  await db.exec('begin');
  await price('$20');
  assert.equal((await notices()).rows.length, 1);
  await db.exec('rollback');
  assert.equal((await notices()).rows.length, 0);
  assert.equal((await db.query('select active from "Price_Alerts"')).rows[0].active, true);
  await price('$30');
  await db.query('delete from auth.users where id = $1', [alice]);
  assert.equal((await notices()).rows.length, 0);
  assert.equal((await db.query('select * from "Price_Alerts"')).rows.length, 0);
});
