-- Forever's Skyborne are now two races, one per faction: High Order Skyborne (Alliance) and
-- Windshaper Skyborne (Horde). Existing Skyborne characters take the one of their stored faction.
UPDATE "characters" SET "race" = 'High Order Skyborne'
  WHERE "game_version" = 'Forever' AND "race" = 'Skyborne' AND "faction" = 'ALLIANCE';
UPDATE "characters" SET "race" = 'Windshaper Skyborne'
  WHERE "game_version" = 'Forever' AND "race" = 'Skyborne' AND "faction" = 'HORDE';
