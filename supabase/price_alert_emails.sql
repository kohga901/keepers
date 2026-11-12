-- Apply after price_alerts.sql, as the database owner.
begin;
create table if not exists public.price_alert_emails (
    notification_id uuid primary key references public."Price_Notifications"(id) on delete cascade,
    attempts integer not null default 0,
    next_attempt_at timestamptz not null default now(),
    sent_at timestamptz
);
-- These additions also upgrade the earlier Python-worker queue, if installed.
alter table public.price_alert_emails
    add column if not exists lease_id uuid,
    add column if not exists first_attempt_at timestamptz,
    add column if not exists recipient text,
    add column if not exists failed_at timestamptz,
    add column if not exists last_error text;
create index if not exists price_alert_emails_pending on public.price_alert_emails (next_attempt_at)
    where sent_at is null;
alter table public.price_alert_emails enable row level security;
revoke all on public.price_alert_emails from public, anon, authenticated;

create or replace function public.queue_price_alert_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    insert into public.price_alert_emails (notification_id) values (new.id);
    return new;
end;
$$;
revoke all on function public.queue_price_alert_email() from public, anon, authenticated;
drop trigger if exists price_notification_email on public."Price_Notifications";
create trigger price_notification_email after insert on public."Price_Notifications"
    for each row execute function public.queue_price_alert_email();

create or replace function public.claim_price_alert_emails()
returns table (notification_id uuid, lease_id uuid, recipient text,
    item_name text, price numeric, target_price numeric)
language plpgsql security definer set search_path = '' as $$
begin
    -- Stop before Resend's 24-hour idempotency window expires, even after outages.
    update public.price_alert_emails q set failed_at = now(), last_error = 'retry_limit'
    where q.sent_at is null and q.failed_at is null and q.next_attempt_at <= now()
      and (q.attempts >= 12 or q.first_attempt_at < now() - interval '23 hours');
    return query
    with pending as (
        select q.notification_id, u.email
        from public.price_alert_emails q
        join public."Price_Notifications" n on n.id = q.notification_id
        join auth.users u on u.id = n.user_id
        where q.sent_at is null and q.failed_at is null and q.next_attempt_at <= now()
          and nullif(u.email, '') is not null and u.email_confirmed_at is not null
          and (q.recipient is null or q.recipient = u.email)
        order by q.next_attempt_at
        limit 5 for update of q skip locked
    ), claimed as (
        update public.price_alert_emails q
        set lease_id = gen_random_uuid(), attempts = q.attempts + 1,
            first_attempt_at = coalesce(q.first_attempt_at, now()),
            recipient = p.email, next_attempt_at = now() + interval '5 minutes'
        from pending p where q.notification_id = p.notification_id
        returning q.notification_id, q.lease_id, q.recipient
    )
    select c.notification_id, c.lease_id, c.recipient, n.item_name, n.price, n.target_price
    from claimed c join public."Price_Notifications" n on n.id = c.notification_id;
end;
$$;

create or replace function public.finish_price_alert_email(
    p_notification_id uuid, p_lease_id uuid, p_error text default null)
returns void language sql security definer set search_path = '' as $$
    update public.price_alert_emails
    set sent_at = case when p_error is null then now() else null end,
        last_error = left(p_error, 100)
    where notification_id = p_notification_id and lease_id = p_lease_id and sent_at is null;
$$;
revoke all on function public.claim_price_alert_emails(),
    public.finish_price_alert_email(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_price_alert_emails(),
    public.finish_price_alert_email(uuid, uuid, text) to service_role;
commit;
