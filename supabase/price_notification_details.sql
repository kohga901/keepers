-- Apply after price_alert_increases.sql and price_alert_emails.sql, before updating the app/email function.
begin;

alter table public."Price_Notifications"
    add column direction text check (direction in ('increase', 'decrease')),
    add column item_img text;

-- Recover historical directions only when the saved event or threshold proves them.
update public."Price_Notifications" n
set direction = coalesce(
    (select a.direction from public."Price_Alerts" a
        where a.user_id = n.user_id and a.clothes_id = n.clothes_id
            and a.target_price = n.target_price and a.triggered_at = n.created_at),
    case when n.price > n.target_price then 'increase'
         when n.price < n.target_price then 'decrease' end),
    item_img = (select c.item_img from public."Clothing" c where c.item_id = n.clothes_id);

create or replace function public.notify_price_alerts() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
    next_price numeric := public.price_alert_usd(new.item_price);
begin
    if next_price is null or next_price >= 100000000 then
        return new;
    end if;
    with matched as (
        update public."Price_Alerts" set active = false, triggered_at = now()
        where clothes_id = new.item_id and active
            and ((direction = 'decrease' and next_price <= target_price)
                or (direction = 'increase' and next_price >= target_price))
        returning user_id, target_price, direction
    )
    insert into public."Price_Notifications"
        (user_id, clothes_id, item_name, price, target_price, direction, item_img)
        select user_id, new.item_id, coalesce(new.item_name, 'Clothing item'), next_price,
            target_price, direction, new.item_img
        from matched;
    return new;
end;
$$;

-- The return shape changes; queue rows and existing leases are retained.
drop function public.claim_price_alert_emails();
create function public.claim_price_alert_emails()
returns table (notification_id uuid, lease_id uuid, recipient text,
    item_name text, price numeric, target_price numeric, direction text, item_img text)
language plpgsql security definer set search_path = '' as $$
begin
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
    select c.notification_id, c.lease_id, c.recipient, n.item_name, n.price, n.target_price,
        n.direction, n.item_img
    from claimed c join public."Price_Notifications" n on n.id = c.notification_id;
end;
$$;
revoke all on function public.claim_price_alert_emails() from public, anon, authenticated;
grant execute on function public.claim_price_alert_emails() to service_role;

commit;
