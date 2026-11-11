-- Tests of what GuildAssistantProfessions records for GuildAssistant Database (Core.lua's "Recipe
-- sources", and Sources.lua against a fake game), outside WoW. Run with `npm test` in addons/ (or
-- lua dev/GuildAssistantProfessions/sources.spec.lua).

local passed, failed = 0, 0
local function it(name, fn)
    local ok, err = pcall(fn)
    if ok then
        passed = passed + 1
    else
        failed = failed + 1
        print("FAIL " .. name .. "\n     " .. tostring(err))
    end
end

local function eq(actual, expected, what)
    if actual ~= expected then
        error(("%s: expected %s, got %s"):format(what or "value", tostring(expected), tostring(actual)), 2)
    end
end

-- The addon's Core and Sources, with a fake game: items 2881, 6047 and 7975 are recipes (class 9).
local RECIPES = { [2881] = true, [6047] = true, [7975] = true }
local function load(game)
    for name, value in pairs(game or {}) do _G[name] = value end
    _G.GetItemInfoInstant = function(id) return id, "", "", "", 0, RECIPES[id] and 9 or 7, 0 end
    _G.GetRealZoneText = function() return game and game.zone or "Tanaris" end
    local ns = {}
    assert(loadfile("GuildAssistantProfessions/Core.lua"))("GuildAssistantProfessions", ns)
    assert(loadfile("GuildAssistantProfessions/Sources.lua"))("GuildAssistantProfessions", ns)
    ns.db = ns.Core.newDB()
    ns.now = function() return 1000 end
    return ns
end

local function link(id) return ("|cffffffff|Hitem:%d::::::::|h[Item]|h|r"):format(id) end

it("records where a recipe item comes from, once, and how many places at most", function()
    local ns = load()
    local db = ns.db
    eq(ns.Core.recordItemSource(db, 6047, "V", "Tanaris", "Krinkle Goodsteel", 10), true)
    eq(ns.Core.recordItemSource(db, 6047, "V", "Tanaris", "Krinkle Goodsteel", 20), false, "known: not new")
    eq(db.sources.items[6047]["V:Tanaris=Krinkle Goodsteel"], 20, "last seen")
    eq(ns.Core.recordItemSource(db, 7975, "Q", "", "Ornate; Mithril = Armor", 10), true)
    eq(next(db.sources.items[7975]), "Q=Ornate  Mithril   Armor", "no zone, separators taken out")
    for i = 1, 20 do ns.Core.recordItemSource(db, 2881, "D", "Zone " .. i, "Mob", 10) end
    local count = 0
    for _ in pairs(db.sources.items[2881]) do count = count + 1 end
    eq(count, ns.Core.MAX_SOURCES)
end)

it("records which trainer teaches a recipe and its cost", function()
    local ns = load()
    local db = ns.db
    eq(ns.Core.recordTrainer(db, "item:2852", 50, "Stormwind City", "Grimand Elmore", 10), true)
    eq(ns.Core.recordTrainer(db, "item:2852", 0, "Stormwind City", "Grimand Elmore", 20), false)
    eq(db.sources.recipes["item:2852"].cost, 50, "a cost of 0 doesn't erase the one seen")
    eq(db.sources.recipes["item:2852"].trainers["Stormwind City=Grimand Elmore"], 20)
    eq(ns.Core.describeSources(db), "0 recipe items' sources, 1 trainer recipe")
    ns.Core.recordItemSource(db, 6047, "V", "Tanaris", "Krinkle Goodsteel", 10)
    eq(ns.Core.describeSources(db), "1 recipe item's sources, 1 trainer recipe")
end)

it("records the recipe items a vendor sells, not the rest", function()
    local items = { 6047, 2840, 2881 }
    local ns = load({
        GetMerchantNumItems = function() return #items end,
        GetMerchantItemLink = function(i) return link(items[i]) end,
        UnitName = function(unit) return unit == "npc" and "Krinkle Goodsteel" or nil end,
    })
    eq(ns.Sources.merchant(), 2)
    eq(ns.db.sources.items[6047]["V:Tanaris=Krinkle Goodsteel"], 1000)
    eq(ns.db.sources.items[2840], nil, "not a recipe")
    eq(ns.Sources.merchant(), 0, "the second time, nothing new")
end)

it("records what a profession trainer teaches, by the item made or the name, and its cost", function()
    local services = {
        { "Blacksmithing", "header" },
        { "Copper Chain Pants", "available", 2852, 50 },
        { "Enchant Bracer - Minor Health", "available", nil, 10 },
    }
    local profession = true
    local ns = load({
        zone = "Stormwind City",
        IsTradeskillTrainer = function() return profession end,
        GetNumTrainerServices = function() return #services end,
        GetTrainerServiceInfo = function(i) return services[i][1], nil, services[i][2] end,
        GetTrainerServiceItemLink = function(i) return services[i][3] and link(services[i][3]) or nil end,
        GetTrainerServiceCost = function(i) return services[i][4] or 0 end,
        UnitName = function(unit) return unit == "npc" and "Grimand Elmore" or nil end,
    })
    eq(ns.Sources.trainer(), 2)
    eq(ns.db.sources.recipes["item:2852"].cost, 50)
    eq(ns.db.sources.recipes["item:2852"].trainers["Stormwind City=Grimand Elmore"], 1000)
    eq(ns.db.sources.recipes["name:enchant bracer - minor health"].cost, 10)
    eq(ns.db.sources.recipes["name:blacksmithing"], nil, "a header isn't a recipe")
    profession = false
    ns.db.sources = nil
    eq(ns.Sources.trainer(), 0, "a class trainer is left alone")
    eq(ns.db.sources, nil)
end)

it("records recipe items looted from a creature, an object, or fishing", function()
    local slots = { 2881, 2840, 6047 }
    local guids = { "Creature-0-1-2-3-450-0", "Creature-0-1-2-3-450-0", "GameObject-0-1-2-3-99-0" }
    local fishing = false
    local ns = load({
        zone = "Westfall",
        GetNumLootItems = function() return #slots end,
        GetLootSlotLink = function(slot) return link(slots[slot]) end,
        GetLootSourceInfo = function(slot) return guids[slot], 1 end,
        IsFishingLoot = function() return fishing end,
        UnitGUID = function(unit) return unit == "target" and "Creature-0-1-2-3-450-0" or nil end,
        UnitName = function(unit) return unit == "target" and "Defias Renegade Mage" or nil end,
    })
    eq(ns.Sources.loot(), 2)
    eq(ns.db.sources.items[2881]["D:Westfall=Defias Renegade Mage"], 1000)
    eq(ns.db.sources.items[6047]["O:Westfall="], 1000, "an object, unnamed")
    fishing = true
    eq(ns.Sources.loot(), 2)
    eq(ns.db.sources.items[2881]["F:Westfall="], 1000)
end)

it("records the recipe items a quest gives", function()
    local ns = load({
        GetTitleText = function() return "Ornate Mithril Armor" end,
        GetNumQuestChoices = function() return 2 end,
        GetNumQuestRewards = function() return 1 end,
        GetQuestItemLink = function(kind, i)
            if kind == "choice" then return link(i == 1 and 7975 or 2840) end
            return link(2881)
        end,
    })
    eq(ns.Sources.questRewards(), 2)
    eq(ns.db.sources.items[7975]["Q=Ornate Mithril Armor"], 1000)
    eq(ns.db.sources.items[2881]["Q=Ornate Mithril Armor"], 1000)
end)

it("does nothing on a client without those windows", function()
    local ns = load()
    _G.GetMerchantNumItems, _G.GetNumTrainerServices, _G.GetNumLootItems, _G.GetQuestItemLink = nil, nil, nil, nil
    eq(ns.Sources.merchant(), 0); eq(ns.Sources.trainer(), 0); eq(ns.Sources.loot(), 0); eq(ns.Sources.questRewards(), 0)
end)

-- What GuildAssistant Database reads from it: the two addons agree on the format.
it("is read by GuildAssistant Database as a source", function()
    local ns = load()
    ns.Core.recordItemSource(ns.db, 6047, "V", "Tanaris", "Krinkle Goodsteel", 10)
    ns.Core.recordTrainer(ns.db, "item:2852", 50, "Stormwind City", "Grimand Elmore", 10)
    local database = {}
    assert(loadfile("GuildAssistantDatabase/Core.lua"))("GuildAssistantDatabase", database)
    local provider = database.Core.professionsSources(ns.db)
    local merged = database.Core.sources({ provider })
    eq(merged.items[6047].sources[1].kind, "vendor")
    eq(merged.items[6047].sources[1].zoneName, "Tanaris")
    eq(merged.items[6047].sources[1].name, "Krinkle Goodsteel")
    eq(merged.byItem[2852].cost, 50)
    eq(merged.byItem[2852].trainers[1].name, "Grimand Elmore")
end)

print(("%d passed, %d failed"):format(passed, failed))
if failed > 0 then error(failed .. " failed") end
