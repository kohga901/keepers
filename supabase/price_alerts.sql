-- Run once in the Supabase SQL editor, as the database owner.
-- Prices are USD; ambiguous currencies/ranges are deliberately ignored.
begin;

create table public."Price_Alerts" (
    user_id uuid not null references auth.users(id) on delete cascade,
    clothes_id bigint not null references public."Clothing"(item_id) on delete cascade,
    target_price numeric(10,2) not null check (target_price > 0 and target_price < 100000000),
    active boolean not null default true,
    triggered_at timestamptz,
    primary key (user_id, clothes_id)
);
create index price_alerts_active_item on public."Price_Alerts" (clothes_id) where active;

create table public."Price_Notifications" (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    clothes_id bigint not null references public."Clothing"(item_id) on delete cascade,
    item_name text not null,
    price numeric(10,2) not null,
    target_price numeric(10,2) not null,
    created_at timestamptz not null default now(),
    read_at timestamptz
);
create index price_notifications_user_date on public."Price_Notifications" (user_id, created_at desc, id);
create index price_notifications_unread on public."Price_Notifications" (user_id) where read_at is null;

alter table public."Price_Alerts" enable row level security;
alter table public."Price_Notifications" enable row level security;
revoke all on public."Price_Alerts", public."Price_Notifications" from public, anon, authenticated;
grant select, delete on public."Price_Alerts" to authenticated;
grant select on public."Price_Notifications" to authenticated;
grant update (read_at) on public."Price_Notifications" to authenticated;

create policy price_alerts_own_read on public."Price_Alerts" for select to authenticated
    using ((select auth.uid()) = user_id);
create policy price_alerts_own_delete on public."Price_Alerts" for delete to authenticated
    using ((select auth.uid()) = user_id);
create policy price_notifications_own_read on public."Price_Notifications" for select to authenticated
    using ((select auth.uid()) = user_id);
create policy price_notifications_own_update on public."Price_Notifications" for update to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create function public.price_alert_usd(value text) returns numeric
language sql immutable strict set search_path = '' as $$
    select case when length(value) <= 32 and btrim(value) ~
        '^(\$|USD[[:space:]]+)?([0-9]+|[0-9]{1,3}(,[0-9]{3})+)(\.[0-9]{1,2})?$'
    then replace(regexp_replace(btrim(value), '^(\$|USD[[:space:]]+)', ''), ',', '')::numeric
    else null end;
$$;

-- The RPC locks the product before the alert, matching the catalog update's lock order.
create function public.set_price_alert(p_clothes_id bigint, p_target_price numeric)
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
    if p_target_price >= current_price then
        raise exception 'Choose a target below the current catalog price.';
    end if;
    insert into public."Price_Alerts" (user_id, clothes_id, target_price)
        values (caller, p_clothes_id, p_target_price)
        on conflict (user_id, clothes_id) do update
        set target_price = excluded.target_price, active = true, triggered_at = null
        returning * into saved;
    return saved;
end;
$$;

create function public.notify_price_alerts() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
    next_price numeric := public.price_alert_usd(new.item_price);
begin
    if next_price is null or next_price >= 100000000 then
        return new;
    end if;
    -- Claim and notify in the same transaction: each saved alert fires once.
    with matched as (
        update public."Price_Alerts" set active = false, triggered_at = now()
        where clothes_id = new.item_id and active and target_price >= next_price
        returning user_id, target_price
    )
    insert into public."Price_Notifications" (user_id, clothes_id, item_name, price, target_price)
        select user_id, new.item_id, coalesce(new.item_name, 'Clothing item'), next_price, target_price
        from matched;
    return new;
end;
$$;

create trigger clothing_price_alerts after update of item_price on public."Clothing"
    for each row when (old.item_price is distinct from new.item_price)
    execute function public.notify_price_alerts();

revoke all on function public.price_alert_usd(text), public.notify_price_alerts(),
    public.set_price_alert(bigint, numeric) from public, anon, authenticated;
grant execute on function public.set_price_alert(bigint, numeric) to authenticated;

commit;
