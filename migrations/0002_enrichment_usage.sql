-- Server-authoritative daily counter for paid contact-enrichment (Hunter)
-- calls. The client must never be trusted to report how many enrichment
-- calls it has already made or what today's cap is — see
-- src/lib/research/usage.server.ts, which is the only code that reads or
-- writes this table.
--
-- user_id = '__global__' is the app-wide daily cap so extra accounts cannot
-- multiply API spend. Reservations happen BEFORE Hunter; failed Hunter
-- calls still consume a slot (no refund).
create table if not exists enrichment_usage (
  user_id text not null,
  day date not null,
  count integer not null default 0,
  primary key (user_id, day)
);
