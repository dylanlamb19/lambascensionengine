-- Place ID is the Google identity for a discovered business.
-- Internal prospect UID remains the lascengine row identity.
-- Partial unique index so overlapping searches cannot insert a second
-- row for the same Google Place ID for the same owner.
create unique index if not exists prospects_user_place_uniq
  on prospects (user_id, provider_place_id)
  where provider_place_id is not null and provider_place_id <> '';
