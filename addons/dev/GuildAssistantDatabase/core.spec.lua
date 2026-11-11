-- Tests of GuildAssistantDatabase's Core.lua, outside WoW, on Data.fixture.lua (what the database
-- job builds from gamedata.fixture.mjs; scripts/database/database.test.mjs keeps the two in step)
-- and, for what a sources companion adds, Sources.fixture.lua.
-- Run with `npm test` in addons/ (or any Lua 5.1+ from addons/: lua dev/GuildAssistantDatabase/core.spec.lua).

local function loadData()
    local ns = {}
    assert(loadfile("GuildAssistantDatabase/Core.lua"))("GuildAssistantDatabase", ns)
    assert(loadfile("dev/GuildAssistantDatabase/Data.fixture.lua"))("GuildAssistantDatabase", ns)
    return ns.Core, ns.Data
end
local Core, Data = loadData()

-- A sources companion, as GuildAssistantDatabaseSources holds it once loaded.
local function loadSources()
    local saved = _G.GuildAssistantDatabaseSources
    _G.GuildAssistantDatabaseSources = nil
    assert(loadfile("dev/GuildAssistantDatabase/Sources.fixture.lua"))()
    local list = _G.GuildAssistantDatabaseSources
    _G.GuildAssistantDatabaseSources = saved
    return list
end

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

local function names(recipes)
    local out = {}
    for i, recipe in ipairs(recipes) do out[i] = recipe.name end
    return table.concat(out, ", ")
end

local function profession(name)
    for _, entry in ipairs(Data.professions) do
        if entry.name == name then return entry end
    end
end

local function recipeNamed(loaded, name)
    for _, recipe in ipairs(loaded.recipes) do
        if recipe.name == name then return recipe end
    end
end

-- Reading the data ---------------------------------------------------------------------------------

it("splits keeping empty fields", function()
    local parts = Core.split("a\t\tb\t", "\t")
    eq(#parts, 4); eq(parts[1], "a"); eq(parts[2], ""); eq(parts[3], "b"); eq(parts[4], "")
end)

it("reads a profession only when first asked, then keeps it", function()
    local entry = profession("Blacksmithing")
    eq(entry.loaded, nil, "not read at load")
    eq(entry.count, 7)
    local loaded = Core.load(entry)
    eq(#loaded.recipes, 7)
    eq(Core.load(entry), loaded, "read once")
    eq(profession("Enchanting").loaded, nil, "the others still not read")
end)

it("reads a recipe: what it makes, its reagents, skill, colours and how it's learned", function()
    local loaded = Core.load(profession("Blacksmithing"))
    local breastplate = recipeNamed(loaded, "Runed Copper Breastplate")
    eq(breastplate.id, 2667)
    eq(breastplate.profession, "Blacksmithing")
    eq(breastplate.skill, 55)
    eq(breastplate.colors[1], 95); eq(breastplate.colors[3], 135)
    eq(breastplate.creates.name, "Runed Copper Breastplate")
    eq(breastplate.creates.level, 13)
    eq(breastplate.level, 13)
    eq(breastplate.makes[1], 1)
    eq(#breastplate.reagents, 3)
    eq(breastplate.reagents[1].item.name, "Copper Bar"); eq(breastplate.reagents[1].count, 12)
    eq(breastplate.recipeItems[1].name, "Plans: Runed Copper Breastplate")
    eq(breastplate.recipeItems[1].skill, 55)
    eq(#breastplate.recipeItems[1].sources, 0, "where it drops isn't in the game's data")
    eq(breastplate.creates.icon, 132738)
    eq(breastplate.creates.summary, "Chest (Plate), Strength, Spirit")
    eq(breastplate.creates.classID, 4); eq(breastplate.creates.subclassID, 4)
    eq(breastplate.acquire, 0)
    eq(breastplate.vouched, nil, "no companion to vouch for it")
    eq(recipeNamed(loaded, "The Shatterer").trainingCost, 0)
    eq(recipeNamed(loaded, "Rough Sharpening Stone").acquire, 1)
    eq(recipeNamed(loaded, "Rough Sharpening Stone").acquireSkill, 15)
end)

it("reads an enchant, which makes no item", function()
    local loaded = Core.load(profession("Enchanting"))
    local enchant = recipeNamed(loaded, "Enchant Bracer - Minor Health")
    eq(enchant.creates, nil)
    eq(enchant.level, 0)
    eq(enchant.reagents[1].item.name, "Strange Dust")
end)

it("marks an item the game's tables lack, to be named in game", function()
    local wand = recipeNamed(Core.load(profession("Enchanting")), "Greater Magic Wand")
    local soulDust = wand.reagents[2].item
    eq(soulDust.id, 11083)
    eq(soulDust.missing, true)
    eq(soulDust.name, "Item 11083")
    eq(wand.creates.missing, false)
    -- An item made but lacking: named after its recipe by the job.
    local gauntlets = recipeNamed(Core.load(profession("Blacksmithing")), "Ironforge Gauntlets")
    eq(gauntlets.creates.name, "Ironforge Gauntlets"); eq(gauntlets.creates.summary, "Hands (Plate)")
end)

-- Searching ----------------------------------------------------------------------------------------

local function all()
    return { Core.load(profession("Blacksmithing")), Core.load(profession("Enchanting")) }
end

it("splits a search into lowercase words", function()
    local terms = Core.terms("  Plate  STAMINA ")
    eq(#terms, 2); eq(terms[1], "plate"); eq(terms[2], "stamina")
    eq(#Core.terms(nil), 0)
end)

it("finds recipes by name, stat, slot and reagent, every word", function()
    eq(names(Core.search(all(), { terms = Core.terms("breastplate") })), "Runed Copper Breastplate, Ornate Mithril Breastplate")
    eq(names(Core.search(all(), { terms = Core.terms("critical") })), "Ornate Mithril Breastplate")
    eq(names(Core.search(all(), { terms = Core.terms("head stamina") })), "Golden Scale Coif")
    eq(names(Core.search(all(), { terms = Core.terms("agility") })), "Golden Scale Coif")
    eq(names(Core.search(all(), { terms = Core.terms("maces") })), "The Shatterer")
    eq(names(Core.search(all(), { terms = Core.terms("strange dust") })), "Enchant Bracer - Minor Health")
    eq(names(Core.search(all(), { terms = Core.terms("enchanting") })), "Enchant Bracer - Minor Health, Greater Magic Wand")
    eq(#Core.search(all(), { terms = Core.terms("breastplate stamina") }), 0, "every word must match")
end)

it("lists those whose name matches first, then by skill", function()
    -- "copper" is in two names, and is a reagent of others.
    eq(names(Core.search(all(), { terms = Core.terms("copper") })), "Copper Chain Pants, Runed Copper Breastplate")
    eq(names(Core.search(all(), { terms = Core.terms("mithril") })), "Ornate Mithril Breastplate, Ironforge Gauntlets, The Shatterer")
    -- No words: everything, by skill.
    eq(names(Core.search({ Core.load(profession("Blacksmithing")) }, { terms = {} })),
        "Copper Chain Pants, Rough Sharpening Stone, Runed Copper Breastplate, Golden Scale Coif, Ironforge Gauntlets, The Shatterer, Ornate Mithril Breastplate")
end)

it("keeps the level and skill within the limits given", function()
    eq(names(Core.search(all(), { minLevel = 30, maxLevel = 42 })), "Golden Scale Coif, The Shatterer")
    -- Something that needs no level counts as level 1.
    eq(names(Core.search(all(), { maxLevel = 1 })), "Enchant Bracer - Minor Health, Rough Sharpening Stone, Ironforge Gauntlets")
    eq(names(Core.search(all(), { minSkill = 200, maxSkill = 239 })), "Ironforge Gauntlets, The Shatterer")
    eq(names(Core.search(all(), { minSkill = 1, maxSkill = 15, minLevel = 2 })), "Copper Chain Pants")
end)

it("keeps to the slots and armor types picked", function()
    -- The game's data: Runed Copper Breastplate, Ornate Mithril Breastplate and Ironforge Gauntlets
    -- are plate, Golden Scale Coif and Copper Chain Pants mail.
    local function filtered(slotNames, armorNames)
        local slots, armor = Core.filterSets(slotNames, armorNames)
        return names(Core.search(all(), { slots = slots, armor = armor }))
    end
    eq(filtered({ Chest = true }, {}), "Runed Copper Breastplate, Ornate Mithril Breastplate")
    eq(filtered({}, { Plate = true }), "Runed Copper Breastplate, Ironforge Gauntlets, Ornate Mithril Breastplate")
    eq(filtered({}, { Mail = true, Plate = true }),
        "Copper Chain Pants, Runed Copper Breastplate, Golden Scale Coif, Ironforge Gauntlets, Ornate Mithril Breastplate")
    eq(filtered({ Head = true }, { Plate = true }), "")
    eq(filtered({ Head = true, Legs = true }, { Mail = true }), "Copper Chain Pants, Golden Scale Coif")
    -- One-Hand takes main-hand weapons too; Ranged takes wands.
    eq(filtered({ ["One-Hand"] = true, Ranged = true }, {}), "Greater Magic Wand, The Shatterer")
    local slots, armor = Core.filterSets({}, {})
    eq(slots, nil); eq(armor, nil)
end)

it("tells a search from listing everything, and counts matches per profession", function()
    eq(Core.isQuery({ terms = {} }), false)
    eq(Core.isQuery({ terms = {}, include = function() return true end }), false, "not known yet is a mode")
    eq(Core.isQuery({ terms = { "x" } }), true)
    eq(Core.isQuery({ terms = {}, maxLevel = 10 }), true)
    eq(Core.isQuery({ terms = {}, slots = { [1] = true } }), true)
    -- Strange Dust; Soul Dust has no name in the game's tables (named in game).
    local counts = Core.countByProfession(Core.search(all(), { terms = Core.terms("dust") }))
    eq(counts.Enchanting, 1); eq(counts.Blacksmithing, nil)
end)

it("leaves out what `include` says no to", function()
    local results = Core.search(all(), { include = function(recipe) return recipe.profession == "Enchanting" end })
    eq(names(results), "Enchant Bracer - Minor Health, Greater Magic Wand")
end)

it("reads the number typed in a limit box", function()
    eq(Core.limit("40"), 40); eq(Core.limit(" 7 "), 7); eq(Core.limit(""), nil); eq(Core.limit("x"), nil); eq(Core.limit(nil), nil)
end)

-- How to learn it ---------------------------------------------------------------------------------

local zones = { [40] = "Westfall", [440] = "Tanaris" }
local function zoneName(id) return zones[id] end

local function learn(loaded, name) return table.concat(Core.howToLearn(recipeNamed(loaded, name), zoneName), " | ") end

it("says how a recipe is learned from what the game's data says", function()
    local blacksmithing, enchanting = Core.load(profession("Blacksmithing")), Core.load(profession("Enchanting"))
    eq(learn(blacksmithing, "Rough Sharpening Stone"), "Learned automatically at skill 15")
    eq(learn(enchanting, "Enchant Bracer - Minor Health"), "Learned with the profession")
    eq(learn(blacksmithing, "Runed Copper Breastplate"), "From the item below")
    eq(learn(blacksmithing, "Copper Chain Pants"), "A trainer or a quest: the game's files don't say which")
end)

-- A fresh copy of the data, read with a sources companion.
local function withSources()
    local ns = {}
    assert(loadfile("GuildAssistantDatabase/Core.lua"))("GuildAssistantDatabase", ns)
    assert(loadfile("dev/GuildAssistantDatabase/Data.fixture.lua"))("GuildAssistantDatabase", ns)
    local providers = loadSources()
    local loaded = {}
    for _, entry in ipairs(ns.Data.professions) do loaded[entry.name] = ns.Core.load(entry, providers) end
    return loaded, providers, ns.Core
end

it("adds what a sources companion says: trainer, drop, vendor, quest", function()
    local loaded = withSources()
    local blacksmithing, enchanting = loaded.Blacksmithing, loaded.Enchanting
    eq(learn(blacksmithing, "Copper Chain Pants"), "Trainer (50c)")
    eq(learn(blacksmithing, "The Shatterer"), "Trainer (1g 35s)")
    -- The companion says drop and pickpocketing; the plans' drop says where.
    eq(learn(blacksmithing, "Runed Copper Breastplate"), "Drop: Defias Renegade Mage (Westfall) | Pickpocketing")
    eq(learn(blacksmithing, "Golden Scale Coif"), "Vendor: Krinkle Goodsteel (Tanaris)")
    eq(learn(blacksmithing, "Ornate Mithril Breastplate"), "Quest: Ornate Mithril Armor")
    -- The game's own word wins over a companion's.
    eq(learn(enchanting, "Enchant Bracer - Minor Health"), "Learned with the profession")
    -- One no companion lists.
    eq(learn(blacksmithing, "Ironforge Gauntlets"), "No known source: unreleased, removed, or not recorded yet")
    -- Without zone names, the zone is left out.
    eq(Core.howToLearn(recipeNamed(blacksmithing, "Golden Scale Coif"))[1], "Vendor: Krinkle Goodsteel")
end)

it("vouches for the recipes a companion lists, and hides the others when asked", function()
    local loaded = withSources()
    local blacksmithing = loaded.Blacksmithing
    eq(recipeNamed(blacksmithing, "Copper Chain Pants").vouched, true)
    eq(recipeNamed(blacksmithing, "Ironforge Gauntlets").vouched, false)
    eq(blacksmithing.vouchedCount, 6)
    eq(names(Core.search({ blacksmithing }, { terms = Core.terms("mithril"), vouchedOnly = true })), "Ornate Mithril Breastplate, The Shatterer")
    eq(names(Core.search({ blacksmithing }, { terms = Core.terms("gauntlets") })), "Ironforge Gauntlets", "shown when not asked to hide")
end)

it("knows a recipe when a source says where its plans come from, even if none lists the recipe", function()
    -- A complete source that lists no recipe, and a drop of the Golden Scale Coif's plans.
    local complete = { name = "Seed", complete = true, recipes = "", items = "6047\t\t\t\tD:Badlands=Some Ogre" }
    local ns = {}
    assert(loadfile("GuildAssistantDatabase/Core.lua"))("GuildAssistantDatabase", ns)
    assert(loadfile("dev/GuildAssistantDatabase/Data.fixture.lua"))("GuildAssistantDatabase", ns)
    local blacksmithing = ns.Core.load(ns.Data.professions[1], { complete })
    local coif = recipeNamed(blacksmithing, "Golden Scale Coif")
    eq(coif.vouched, true, "its plans' drop vouches for it")
    eq(table.concat(ns.Core.howToLearn(coif), " | "), "Drop: Some Ogre (Badlands)", "no 'No known source'")
    eq(recipeNamed(blacksmithing, "Copper Chain Pants").vouched, false, "nothing known of this one")
    eq(blacksmithing.vouchedCount, 1)
end)

it("takes a companion's stats with values and the names the game's tables lack", function()
    local loaded = withSources()
    local ornate = recipeNamed(loaded.Blacksmithing, "Ornate Mithril Breastplate")
    eq(ornate.creates.summary, "Chest (Plate), 463 Armor, +14 Critical Strike Rating, +12 Dodge Rating")
    eq(ornate.search:find("463 armor", 1, true) ~= nil, true, "values are searched")
    local soulDust = recipeNamed(loaded.Enchanting, "Greater Magic Wand").reagents[2].item
    eq(soulDust.name, "Soul Dust"); eq(soulDust.missing, false)
end)

it("merges the companions installed, once, and names them", function()
    local _, providers, core = withSources()
    local merged = core.sources(providers)
    eq(merged.names[1], "Test notes (2026-11-11)")
    eq(core.sources(providers), merged, "read once")
    eq(merged.recipes[10003].cost, 13500)
    eq(core.sources({}), nil, "none installed")
    eq(core.sources(nil), nil)
end)

it("caps the sources it lists", function()
    local sources = {}
    for i = 1, 9 do sources[i] = { kind = "drop", name = "Mob " .. i, zone = 0 } end
    local recipe = { sources = { 2 }, trainingCost = 0, recipeItems = { { sources = sources } } }
    local lines = Core.howToLearn(recipe)
    eq(#lines, 7); eq(lines[6], "Drop: Mob 6"); eq(lines[7], "and 3 more")
end)

it("writes money as the game does", function()
    eq(Core.money(13500), "1g 35s"); eq(Core.money(50), "50c"); eq(Core.money(0), "0c"); eq(Core.money(10001), "1g 1c")
end)

-- Who can craft it --------------------------------------------------------------------------------

-- GuildAssistant Professions' saved data, as it keeps it.
local professionsDB = {
    characters = {
        ["Luna-RP"] = { name = "Luna", realm = "RP", class = "MAGE", source = "own",
            professions = { Blacksmithing = { rank = 120, max = 150, recipes = { ["spell:2662"] = true, ["spell:2667"] = true } } } },
        ["Ana-RP"] = { name = "Ana", realm = "RP", class = "PRIEST", source = "guild",
            professions = { Blacksmithing = { rank = 300, max = 300, recipes = { ["spell:2667"] = true } } } },
        ["Bo-RP"] = { name = "Bo", realm = "RP", class = "WARRIOR", source = "own",
            professions = { Blacksmithing = { rank = 60, max = 75, recipes = { ["item:2864"] = true } } } },
        ["Zed-RP"] = { name = "Zed", realm = "RP", source = "link",
            professions = { Blacksmithing = { recipes = { ["spell:2667"] = true } } } },
        ["Cid-RP"] = { name = "Cid", realm = "RP", source = "guild",
            professions = { Tailoring = { recipes = { ["spell:2667"] = true } } } },
    },
}

it("finds who knows a recipe: you first, then your alts, the guild, links", function()
    local breastplate = recipeNamed(Core.load(profession("Blacksmithing")), "Runed Copper Breastplate")
    local crafters = Core.crafters(professionsDB, breastplate, "Luna-RP")
    local list = {}
    for i, crafter in ipairs(crafters) do list[i] = crafter.name .. ":" .. crafter.source .. (crafter.you and ":you" or "") end
    -- Bo knows it by the item it makes (Classic Era's window gave no spell); Cid's isn't Blacksmithing.
    eq(table.concat(list, ", "), "Luna:own:you, Bo:own, Ana:guild, Zed:link")
    eq(crafters[3].rank, 300)
    eq(#Core.crafters(nil, breastplate, "Luna-RP"), 0, "no saved data, nobody")
end)

it("counts how many times a recipe can be made from your bags, and what's short", function()
    local bar, stone = { id = 2840 }, { id = 2836 }
    local recipe = { reagents = { { item = bar, count = 12 }, { item = stone, count = 2 } } }
    local bags = { [2840] = 30, [2836] = 5 }
    local times, missing = Core.craftable(recipe, function(id) return bags[id] end)
    eq(times, 2); eq(#missing, 0)
    bags[2840] = 7
    times, missing = Core.craftable(recipe, function(id) return bags[id] end)
    eq(times, 0); eq(#missing, 1); eq(missing[1].item, bar); eq(missing[1].short, 5)
    eq(Core.craftable({ reagents = {} }, function() return 0 end), 1, "no reagents: always")
end)

it("whispers a crafter by name, with the realm only when it isn't this one", function()
    local realm = "CAMWOW EU4 Realm 10 RP"
    eq(Core.whisperTarget({ name = "Shivan Darkwhisp", realm = "RP" }, realm), "Shivan Darkwhisp", "the whole name")
    eq(Core.whisperTarget({ name = "Ana", realm = "Test Realm" }, "Test Realm"), "Ana")
    eq(Core.whisperTarget({ name = "Ana" }, realm), "Ana", "no realm saved")
    eq(Core.whisperTarget({ name = "Brom", realm = "Argent Dawn" }, realm), "Brom-ArgentDawn", "another realm")
    eq(Core.whisperTarget({ name = "Brom", realm = "Azjol-Nerub" }, realm), "Brom-AzjolNerub")
    eq(Core.whisperTarget({ name = "Luna", realm = "RP", you = true }, realm), nil, "not yourself")
end)

it("keys this player as GuildAssistant Professions does", function()
    eq(Core.playerKey("Shivan", "Darkwhisp", "CAMWOW EU4 Realm 10 RP"), "Shivan Darkwhisp-RP")
    eq(Core.playerKey("Luna", nil, "Test Realm"), "Luna-Test Realm")
    eq(Core.playerKey("Luna", "", "Test Realm"), "Luna-Test Realm")
end)

it("tells known recipes by spell or by the item they make", function()
    local loaded = Core.load(profession("Blacksmithing"))
    local pants, breastplate = recipeNamed(loaded, "Copper Chain Pants"), recipeNamed(loaded, "Runed Copper Breastplate")
    local luna = professionsDB.characters["Luna-RP"].professions.Blacksmithing
    local bo = professionsDB.characters["Bo-RP"].professions.Blacksmithing
    eq(Core.knows(luna, pants), true); eq(Core.knows(bo, pants), false); eq(Core.knows(bo, breastplate), true)
    eq(Core.knows(nil, pants), false)
end)

it("places the minimap button by its angle, and finds the angle of a point", function()
    local x, y = Core.minimapOffset(0, 80)
    eq(x, 80); eq(math.floor(y + 0.5), 0)
    x, y = Core.minimapOffset(90, 80)
    eq(math.floor(x + 0.5), 0); eq(y, 80)
    eq(Core.angleTo(10, 0), 0); eq(Core.angleTo(0, 10), 90); eq(Core.angleTo(-10, 0), 180)
    eq(Core.angleTo(0, -10), 270, "never negative")
end)

it("reads where a source says an item comes from: area ids, zone names, nothing", function()
    local source = Core.parseSource("V440=Krinkle Goodsteel")
    eq(source.kind, "vendor"); eq(source.zone, 440); eq(source.name, "Krinkle Goodsteel")
    source = Core.parseSource("D:Westfall=Defias Pillager")
    eq(source.kind, "drop"); eq(source.zoneName, "Westfall"); eq(source.zone, nil)
    source = Core.parseSource("F:Stranglethorn Vale=")
    eq(source.kind, "fishing"); eq(source.name, "")
    eq(Core.parseSource("X1=Nope"), nil); eq(Core.parseSource("Vnope=Nope"), nil); eq(Core.parseSource("garbage"), nil)
end)

it("turns what GuildAssistant Professions knows into a source that only adds", function()
    local db = {
        characters = {
            ["Luna-RP"] = { professions = { Blacksmithing = { recipes = { ["spell:2662"] = true, ["item:2864"] = true } } } },
            ["Ana-RP"] = { professions = { Blacksmithing = { recipes = { ["spell:2662"] = true } } } },
        },
        sources = {
            items = { [6047] = { ["V:Booty Bay=Narkk"] = 100, ["V440=Krinkle Goodsteel"] = 90 } },
            recipes = { ["item:7954"] = { cost = 20000, trainers = { ["Ironforge=Bengus Deepforge"] = 100 } },
                ["name:enchant bracer - minor health"] = { cost = 10, trainers = { ["=Somebody"] = 1 } } },
        },
    }
    local provider = Core.professionsSources(db)
    eq(provider.complete, nil, "it only adds")
    eq(provider.recipes, "2662\t\t\nitem:2864\t\t\nitem:7954\t6\t20000\tIronforge=Bengus Deepforge\nname:enchant bracer - minor health\t6\t10\t=Somebody")
    eq(provider.items, "6047\t\t\t\tV440=Krinkle Goodsteel;V:Booty Bay=Narkk")
    eq(Core.professionsSources({ characters = {} }), nil, "nothing known")
    eq(Core.professionsSources(nil), nil)

    -- Read with the data: the trainer matches by the item made, and by the recipe's name.
    local ns = {}
    assert(loadfile("GuildAssistantDatabase/Core.lua"))("GuildAssistantDatabase", ns)
    assert(loadfile("dev/GuildAssistantDatabase/Data.fixture.lua"))("GuildAssistantDatabase", ns)
    local loaded = {}
    for _, entry in ipairs(ns.Data.professions) do loaded[entry.name] = ns.Core.load(entry, { provider }) end
    local shatterer = recipeNamed(loaded.Blacksmithing, "The Shatterer")
    eq(table.concat(ns.Core.howToLearn(shatterer), " | "), "Trainer (2g): Bengus Deepforge (Ironforge)")
    eq(shatterer.vouched, true)
    eq(recipeNamed(loaded.Blacksmithing, "Ironforge Gauntlets").vouched, nil, "not hidden: no complete source")
    eq(recipeNamed(loaded.Enchanting, "Enchant Bracer - Minor Health").vouched, true, "matched by name")
    eq(recipeNamed(loaded.Blacksmithing, "Runed Copper Breastplate").vouched, true, "known by the item it makes")
end)

it("adds what several sources say of one recipe together", function()
    local complete = { name = "Seed", complete = true, recipes = "10003\t6\t13500", items = "" }
    local seen = { name = "Seen", recipes = "item:7954\t6\t\tIronforge=Bengus Deepforge", items = "" }
    local ns = {}
    assert(loadfile("GuildAssistantDatabase/Core.lua"))("GuildAssistantDatabase", ns)
    assert(loadfile("dev/GuildAssistantDatabase/Data.fixture.lua"))("GuildAssistantDatabase", ns)
    local blacksmithing = ns.Core.load(ns.Data.professions[1], { complete, seen })
    eq(table.concat(ns.Core.howToLearn(recipeNamed(blacksmithing, "The Shatterer")), " | "), "Trainer (1g 35s): Bengus Deepforge (Ironforge)")
    eq(recipeNamed(blacksmithing, "Copper Chain Pants").vouched, false, "the complete one doesn't list it")
end)

it("counts the data's recipes", function()
    eq(Core.describe(Data), "9 recipes")
    eq(Core.thousands(1234567), "1,234,567"); eq(Core.thousands(12), "12")
    eq(Core.describe({ professions = { { count = 1 } } }), "1 recipe")
end)

print(("%d passed, %d failed"):format(passed, failed))
if failed > 0 then error(failed .. " failed") end
