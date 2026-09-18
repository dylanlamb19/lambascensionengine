-- Owner image gallery metadata on visual_assets (generated + uploaded).

alter table visual_assets add column if not exists favorite boolean not null default false;
alter table visual_assets add column if not exists kind text not null default 'image';
alter table visual_assets add column if not exists saved boolean not null default true;
