-- Wowhead names were looked up in Wowhead's Classic data only, so WoW Forever's own spells (e.g.
-- 1245287, "Copper Rod") were marked missing and never asked again. Lookups now use the guild's
-- game version: let those be looked up again.
UPDATE "wowhead_entries" SET "missing" = false, "fetched_at" = NULL WHERE "missing" = true;
