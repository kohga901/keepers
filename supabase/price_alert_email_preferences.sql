-- Apply after price_alert_emails.sql. Existing accounts keep email delivery enabled.
begin;
create table public.price_alert_email_preferences (
    user_id uuid primary key references auth.users(id) on delete cascade,
    enabled boolean not null default true
);
alter table public.price_alert_email_preferences enable row level security;
revoke all on public.price_alert_email_preferences from public, anon, authenticated;
grant select on public.price_alert_email_preferences to authenticated;
create policy email_preferences_own_read on public.price_alert_email_preferences
    for select to authenticated using ((select auth.uid()) = user_id);

create function public.get_price_alert_email_enabled() returns boolean
language plpgsql security definer set search_path = '' as $$
begin
    if auth.uid() is null then raise exception 'Sign in to manage email notifications.'; end if;
    return coalesce((select enabled from public.price_alert_email_preferences where user_id = auth.uid()), true);
end;
$$;
create function public.set_price_alert_email_enabled(p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
    if caller is null then raise exception 'Sign in to manage email notifications.'; end if;
    if p_enabled is null then raise exception 'Choose whether email notifications are enabled.'; end if;
    insert into public.price_alert_email_preferences (user_id, enabled) values (caller, p_enabled)
    on conflict (user_id) do update set enabled = excluded.enabled;
    if not p_enabled then
        delete from public.price_alert_emails q using public."Price_Notifications" n
        where q.notification_id = n.id and n.user_id = caller and q.sent_at is null;
    end if;
end;
$$;

create or replace function public.queue_price_alert_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare email_enabled boolean;
begin
    -- Serialize queue creation with preference changes, including the first opt-out.
    insert into public.price_alert_email_preferences (user_id) values (new.user_id)
        on conflict (user_id) do nothing;
    select enabled into email_enabled from public.price_alert_email_preferences
        where user_id = new.user_id for share;
    if email_enabled then
        insert into public.price_alert_emails (notification_id) values (new.id);
    end if;
    return new;
end;
$$;

-- Recheck just before calling the provider: an opt-out can delete a claimed job.
create function public.price_alert_email_allowed(p_notification_id uuid, p_lease_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.price_alert_emails q
        join public."Price_Notifications" n on n.id = q.notification_id
        left join public.price_alert_email_preferences p on p.user_id = n.user_id
        where q.notification_id = p_notification_id and q.lease_id = p_lease_id
            and q.sent_at is null and coalesce(p.enabled, true)
    );
$$;
revoke all on function public.get_price_alert_email_enabled(),
    public.set_price_alert_email_enabled(boolean), public.price_alert_email_allowed(uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.get_price_alert_email_enabled(),
    public.set_price_alert_email_enabled(boolean) to authenticated;
grant execute on function public.price_alert_email_allowed(uuid, uuid) to service_role;
commit;
