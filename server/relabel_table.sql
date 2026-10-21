-- Run once in the Supabase SQL editor. One row per item that has been relabeled
-- on static/relabel.html, so the page never serves the same item twice.
create table if not exists "Relabeled_Clothing" (
    clothes_id  bigint primary key references "Clothing"(item_id) on delete cascade,
    relabeled_at timestamptz not null default now()
);
