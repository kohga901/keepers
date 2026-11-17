-- Apply after price_alerts.sql if marking notifications read returns permission denied.
-- Existing row policies restrict updates to the signed-in user's notifications.
grant update (read_at) on public."Price_Notifications" to authenticated;
