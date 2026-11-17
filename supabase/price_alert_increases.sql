-- Apply after price_alerts.sql, as the database owner, before updating the app.
begin;

-- Existing alerts continue to watch for decreases.
alter table public."Price_Alerts"
    add column direction text not null default 'decrease'
    check (direction in ('increase', 'decrease'));

-- Keep the RPC signature and product-before-alert lock order unchanged.
create or replace function public.set_price_alert(p_clothes_id bigint, p_target_price numeric)
returns public."Price_Alerts"
language plpgsql security definer set search_path = '' as $$
declare
    caller uuid := auth.uid();
    current_price numeric;
    saved public."Price_Alerts";
begin
    if caller is null then
        raise exception 'Sign in again to set a price alert.';
    end if;
    if p_target_price is null or p_target_price <= 0 or p_target_price >= 100000000
        or p_target_price <> trunc(p_target_price, 2) then
        raise exception 'Enter a positive USD price with at most two decimal places.';
    end if;
    select public.price_alert_usd(item_price) into current_price
        from public."Clothing" where item_id = p_clothes_id for update;
    if not found then
        raise exception 'This item is no longer available.';
    end if;
    if current_price is null or current_price >= 100000000 then
        raise exception 'This item does not have a supported USD price.';
    end if;
    if p_target_price = current_price then
        raise exception 'Choose a target above or below the current catalog price.';
    end if;
    insert into public."Price_Alerts" (user_id, clothes_id, target_price, direction)
        values (caller, p_clothes_id, p_target_price,
            case when p_target_price > current_price then 'increase' else 'decrease' end)
        on conflict (user_id, clothes_id) do update
        set target_price = excluded.target_price, direction = excluded.direction,
            active = true, triggered_at = null
        returning * into saved;
    return saved;
end;
$$;

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
        returning user_id, target_price
    )
    insert into public."Price_Notifications" (user_id, clothes_id, item_name, price, target_price)
        select user_id, new.item_id, coalesce(new.item_name, 'Clothing item'), next_price, target_price
        from matched;
    return new;
end;
$$;

commit;
