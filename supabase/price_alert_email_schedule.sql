-- Enable pg_cron and pg_net in Supabase Database > Extensions first.
-- Create Vault secrets price_alert_project_url and price_alert_secret_key first.
-- price_alert_secret_key must contain the project's default sb_secret_... API key.
-- Run once after deploying the Edge Function and configuring its provider secrets.
select cron.schedule(
    'keepers-price-alert-emails', '* * * * *',
    $job$
    select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets
                where name = 'price_alert_project_url') || '/functions/v1/price-alert-emails',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey', (select decrypted_secret from vault.decrypted_secrets
                       where name = 'price_alert_secret_key')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 140000
    ) where exists (
        select 1 from public.price_alert_emails
        where sent_at is null and failed_at is null and next_attempt_at <= now()
    );
    $job$
);
