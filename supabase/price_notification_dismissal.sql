-- Apply after price_alerts.sql, before updating the app.
-- Retain notification snapshots so clearing the inbox does not cancel queued emails.
begin;
alter table public."Price_Notifications" add column dismissed_at timestamptz;
grant update (dismissed_at) on public."Price_Notifications" to authenticated;
commit;
