-- Run once in the Supabase SQL editor. One row per item a user has asked to have
-- added to the app (POST /requests). A request stays here after it is approved or
-- rejected so the user can see its status; approving it on static/requests.html
-- inserts the item into "Clothing" and records its id in clothes_id.
create table if not exists "Item_Requests" (
    id               bigint generated always as identity primary key,
    user_id          uuid not null references auth.users(id) on delete cascade,
    item_name        text not null check (char_length(item_name) between 1 and 200),
    item_img         text not null check (item_img like 'https://%' and char_length(item_img) <= 2000),
    item_web_listing text check (item_web_listing is null or (item_web_listing like 'https://%' and char_length(item_web_listing) <= 2000)),
    item_price       text check (char_length(item_price) <= 50),
    item_gender      text check (char_length(item_gender) <= 20),
    status           text not null default 'pending'
                     check (status in ('pending', 'approved', 'rejected', 'error')),
    clothes_id       bigint references "Clothing"(item_id),   -- set once approved
    admin_note       text,                                    -- rejection reason or upload error
    seen_by_user     boolean not null default false,          -- the app flips this once it has shown the result
    created_at       timestamptz not null default now()
);

create index if not exists item_requests_user_idx on "Item_Requests"(user_id, status);

-- Only the server (its secret key bypasses RLS) reads or writes this table. With no
-- policies, the app's anon/authenticated keys can't touch it directly.
alter table "Item_Requests" enable row level security;
