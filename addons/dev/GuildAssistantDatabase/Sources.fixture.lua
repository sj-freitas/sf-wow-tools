-- A sources companion, as an addon that adds where recipes come from would load it (the format is in
-- GuildAssistantDatabase/Core.lua, "Sources companions"). Written by hand for the specs, for the
-- recipes of Data.fixture.lua; complete, like the seed: it vouches for all of them but Ironforge
-- Gauntlets, which is hidden then.

GuildAssistantDatabaseSources = GuildAssistantDatabaseSources or {}
table.insert(GuildAssistantDatabaseSources, {
    name = "Test notes",
    fetched = "2026-11-11",
    complete = true,
    recipes = [[
2660
2662	6	50
2667	2;21
3503	5
9972
10003	6	13500
7418	6	10
14807	6	200]],
    items = [[
2881				D40=Defias Renegade Mage
6047				V440=Krinkle Goodsteel
7975				Q0=Ornate Mithril Armor
7935			463 Armor, +14 Critical Strike Rating, +12 Dodge Rating
11083	Soul Dust	1		]],
})
