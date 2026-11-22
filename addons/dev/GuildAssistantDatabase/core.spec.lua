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
    eq(entry.count, 8)
    local loaded = Core.load(entry)
    eq(#loaded.recipes, 8)
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
        "Copper Chain Pants, Rough Sharpening Stone, Runed Copper Breastplate, Golden Scale Coif, Ironforge Gauntlets, The Shatterer, Ornate Mithril Breastplate, Stonevault Greatsword")
end)

it("reads the specialization a recipe's plans require, and finds the recipe by it", function()
    local loaded = Core.load(profession("Blacksmithing"))
    local sword = recipeNamed(loaded, "Stonevault Greatsword")
    eq(table.concat(sword.specializations, ", "), "Weaponsmith, Master Swordsmith")
    eq(sword.specialization, "Master Swordsmith", "the narrowest")
    eq(#recipeNamed(loaded, "Ornate Mithril Breastplate").specializations, 0, "plans anyone can learn")
    eq(recipeNamed(loaded, "Ornate Mithril Breastplate").specialization, nil)
    -- A Master Swordsmith's recipe is a Weaponsmith's too.
    eq(names(Core.search(all(), { terms = Core.terms("Weaponsmith") })), "Stonevault Greatsword")
    eq(names(Core.search(all(), { terms = Core.terms("master swordsmith") })), "Stonevault Greatsword")
    eq(names(Core.search(all(), { terms = Core.terms("armorsmith") })), "")
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
    -- A filter narrows the list down, so it comes by level (see "the order the list is in" below).
    eq(filtered({ Chest = true }, {}), "Runed Copper Breastplate, Ornate Mithril Breastplate")
    eq(filtered({}, { Plate = true }), "Ironforge Gauntlets, Runed Copper Breastplate, Ornate Mithril Breastplate")
    eq(filtered({}, { Mail = true, Plate = true }),
        "Ironforge Gauntlets, Copper Chain Pants, Runed Copper Breastplate, Golden Scale Coif, Ornate Mithril Breastplate")
    eq(filtered({ Head = true }, { Plate = true }), "")
    eq(filtered({ Head = true, Legs = true }, { Mail = true }), "Copper Chain Pants, Golden Scale Coif")
    -- One-Hand takes main-hand weapons too; Ranged takes wands.
    eq(filtered({ ["One-Hand"] = true, Ranged = true }, {}), "Greater Magic Wand, The Shatterer")
    local slots, armor, binding = Core.filterSets({}, {})
    eq(slots, nil); eq(armor, nil); eq(binding, nil)
end)

it("keeps to the recipes whose item binds when picked up, when that's picked", function()
    -- The game's data: Stonevault Greatsword binds when picked up; the others when equipped, or not at
    -- all (Rough Sharpening Stone), and an enchant makes no item.
    local function filtered(slotNames, armorNames, bindingNames)
        local slots, armor, binding = Core.filterSets(slotNames, armorNames, bindingNames)
        return names(Core.search(all(), { slots = slots, armor = armor, binding = binding }))
    end
    local pickup = { ["On pickup"] = true }
    eq(filtered({}, {}, pickup), "Stonevault Greatsword")
    eq(filtered({ ["Two-Hand"] = true }, {}, pickup), "Stonevault Greatsword", "and a slot")
    eq(filtered({}, { Plate = true }, pickup), "", "and an armor type")
    eq(select(3, Core.filterSets({}, {}, pickup))[Core.BIND_ON_PICKUP], true)
    local loaded = Core.load(profession("Blacksmithing"))
    eq(recipeNamed(loaded, "Stonevault Greatsword").creates.bonding, Core.BIND_ON_PICKUP)
    eq(recipeNamed(loaded, "Ornate Mithril Breastplate").creates.bonding, 2, "when equipped")
    eq(recipeNamed(loaded, "Rough Sharpening Stone").creates.bonding, 0, "it doesn't")
    eq(Core.isQuery({ terms = {}, binding = { [Core.BIND_ON_PICKUP] = true } }), true)
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

-- The order the list is in -------------------------------------------------------------------------
-- The fixture's recipes, by the skill they take and the level their item needs (an item that needs
-- none counts as level 1): Enchant Bracer 1/1, Copper Chain Pants 15/4, Rough Sharpening Stone
-- 15/1, Runed Copper Breastplate 55/13, Greater Magic Wand 70/8, Golden Scale Coif 190/33,
-- Ironforge Gauntlets 200/1, The Shatterer 235/42, Ornate Mithril Breastplate 240/43, Stonevault
-- Greatsword 300/55.

local BY_SKILL = "Enchant Bracer - Minor Health, Copper Chain Pants, Rough Sharpening Stone, Runed Copper Breastplate, "
    .. "Greater Magic Wand, Golden Scale Coif, Ironforge Gauntlets, The Shatterer, Ornate Mithril Breastplate, Stonevault Greatsword"

it("lists a profession by skill, and a search or a filter by level, ties by skill", function()
    -- Nothing narrowed down: by skill, as it has always been.
    eq(names(Core.search(all(), { terms = {} })), BY_SKILL)
    eq(Core.defaultOrder(false), Core.BROWSE_ORDER); eq(Core.defaultOrder(true), Core.MATCHED_ORDER)
    -- A filter: by the level the item needs, and items of the same level by skill. Ironforge
    -- Gauntlets needs no level, so it comes first although it takes skill 200.
    local slots, armor = Core.filterSets({}, { Plate = true })
    eq(names(Core.search(all(), { slots = slots, armor = armor })),
        "Ironforge Gauntlets, Runed Copper Breastplate, Ornate Mithril Breastplate")
    -- A search the same way, the recipes whose own name matches still first (Ironforge Gauntlets
    -- only matches as plate).
    eq(names(Core.search(all(), { terms = Core.terms("plate") })),
        "Runed Copper Breastplate, Ornate Mithril Breastplate, Ironforge Gauntlets")
    -- A limit narrows it down too.
    eq(names(Core.search(all(), { terms = {}, minSkill = 1 })),
        "Enchant Bracer - Minor Health, Rough Sharpening Stone, Ironforge Gauntlets, Copper Chain Pants, "
        .. "Greater Magic Wand, Runed Copper Breastplate, Golden Scale Coif, The Shatterer, Ornate Mithril Breastplate, Stonevault Greatsword")
end)

it("sorts the whole matched list by the column clicked, the other breaking its ties", function()
    local function sorted(order) return names(Core.search(all(), { terms = Core.terms("plate"), order = order })) end
    -- A column clicked sorts everything that matched: the names that match no longer come first.
    local bySkill = Core.toggleOrder({}, "skill")
    eq(sorted(bySkill), "Runed Copper Breastplate, Ironforge Gauntlets, Ornate Mithril Breastplate")
    -- Clicking it again turns that column around.
    eq(sorted(Core.toggleOrder(bySkill, "skill")), "Ornate Mithril Breastplate, Ironforge Gauntlets, Runed Copper Breastplate")
    eq(sorted(Core.toggleOrder(bySkill, "level")), "Ironforge Gauntlets, Runed Copper Breastplate, Ornate Mithril Breastplate")
    eq(sorted({}), "Runed Copper Breastplate, Ornate Mithril Breastplate, Ironforge Gauntlets", "no column: the order it comes in")
    -- Recipes of the same skill come out in the other column's order: Copper Chain Pants and Rough
    -- Sharpening Stone both take skill 15, and the stone needs no level.
    eq(names(Core.search(all(), { terms = {}, order = bySkill })),
        "Enchant Bracer - Minor Health, Rough Sharpening Stone, Copper Chain Pants, Runed Copper Breastplate, "
        .. "Greater Magic Wand, Golden Scale Coif, Ironforge Gauntlets, The Shatterer, Ornate Mithril Breastplate, Stonevault Greatsword")
end)

it("compounds the two orders: the column clicked sorts, the other breaks its ties", function()
    -- Skill highest first, then level lowest first (in the window: the chevron on Skill down, the
    -- one on Level up).
    local order = Core.toggleOrder(Core.toggleOrder(Core.toggleOrder({}, "level"), "skill"), "skill")
    eq(#order, 2)
    eq(order[1].column, "skill"); eq(order[1].descending, true)
    eq(order[2].column, "level"); eq(order[2].descending, false)
    eq(Core.orderWords(order), "Sorted by skill, highest first, then by level, lowest first.")
    local direction, first = Core.orderOf(order, "skill")
    eq(direction, "descending"); eq(first, true)
    direction, first = Core.orderOf(order, "level")
    eq(direction, "ascending"); eq(first, false)
    eq(Core.orderOf({}, "level"), nil, "no order: no chevron")
    eq(Core.orderWords({}), nil)
    -- Clicking the column that breaks the ties makes it the one sorted by, the other as it was.
    local swapped = Core.toggleOrder(order, "level")
    eq(swapped[1].column, "level"); eq(swapped[1].descending, false)
    eq(swapped[2].column, "skill"); eq(swapped[2].descending, true)
    eq(Core.orderWords(swapped), "Sorted by level, lowest first, then by skill, highest first.")
    eq(order[1].column, "skill", "the order given is left as it was")
end)

it("sorts a list of recipes on its own, the same way every time", function()
    local recipes = Core.load(profession("Blacksmithing")).recipes
    local sorted = Core.sortRecipes(recipes, Core.toggleOrder({}, "level"))
    eq(#sorted, #recipes); eq(recipes[1].name, "Copper Chain Pants", "the list given is left as it is")
    local out = {}
    for _, recipe in ipairs(sorted) do out[#out + 1] = recipe.name end
    eq(table.concat(out, ", "),
        "Rough Sharpening Stone, Ironforge Gauntlets, Copper Chain Pants, Runed Copper Breastplate, "
        .. "Golden Scale Coif, The Shatterer, Ornate Mithril Breastplate, Stonevault Greatsword")
    -- The same level and the same skill: by name, so two runs never come out differently.
    local a = { name = "B", skill = 10, level = 5, profession = "P", id = 2 }
    local b = { name = "A", skill = 10, level = 5, profession = "P", id = 1 }
    eq(Core.before(b, a, Core.MATCHED_ORDER), true)
    eq(Core.before(a, b, Core.MATCHED_ORDER), false)
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

-- The guild (the Guild tab) -----------------------------------------------------------------------

it("reads a profession's specializations, and which a character has: the spell, or a recipe that needs it", function()
    local entry = profession("Blacksmithing")
    local specs = Core.specializationsOf(entry)
    eq(#specs.list, 2)
    eq(specs.byId[9787].name, "Weaponsmith"); eq(specs.byId[17039].parent, 9787)
    eq(Core.specializationsOf(entry), specs, "read once")
    eq(#Core.specializationsOf(profession("Enchanting")).list, 0)
    local loaded = Core.load(entry)
    local function has(recipes, withLoaded)
        local names, shown = Core.memberSpecializations(entry, { recipes = recipes }, withLoaded and loaded or nil)
        return table.concat(names, ", ") .. " / " .. table.concat(shown, ", ")
    end
    eq(has({ ["spell:2662"] = true }, true), " / ", "none")
    eq(has({ ["spell:9787"] = true }), "Weaponsmith / Weaponsmith", "the spell (GuildAssistant Professions 1.5.0)")
    eq(has({ ["spell:17039"] = true }), "Weaponsmith, Master Swordsmith / Master Swordsmith", "a Master is a Weaponsmith")
    eq(has({ ["spell:99003"] = true }, true), "Weaponsmith, Master Swordsmith / Master Swordsmith", "from a recipe that needs it")
    eq(has({ ["spell:99003"] = true }), " / ", "not before the recipes are read")
    local _, shown = Core.memberSpecializations(nil, nil)
    eq(#shown, 0, "a profession without recipes, nothing saved")
end)

-- A Guild tab row, as Core.guildMembers makes it (what sorting one needs of it).
local function memberRow(name, profession, rank, realm)
    return { name = name, realm = realm or "RP", profession = profession, rank = rank }
end

local function memberLine(list)
    local out = {}
    for i, member in ipairs(list) do out[i] = ("%s %d %s"):format(member.name, member.rank, member.profession) end
    return table.concat(out, " | ")
end

it("sorts the guildmates by name, skill or profession, the other columns breaking the ties", function()
    local members = {
        memberRow("Luna", "Blacksmithing", 120), memberRow("Ana", "Blacksmithing", 300),
        memberRow("Ana", "Herbalism", 225), memberRow("Bo", "Blacksmithing", 300),
    }
    -- No column clicked: by profession, each profession's highest skill first, as the tab has
    -- always listed them.
    eq(memberLine(Core.sortMembers(members)),
        "Ana 300 Blacksmithing | Bo 300 Blacksmithing | Luna 120 Blacksmithing | Ana 225 Herbalism")
    eq(members[1].name, "Luna", "the list given is left as it is")
    -- Name: A to Z, one character's rows by profession, and the other columns still behind it.
    local byName = Core.toggleOrder(Core.MEMBER_ORDER, "name", Core.MEMBER_LIST)
    eq(#byName, 3); eq(byName[1].column, "name"); eq(byName[1].descending, false)
    eq(Core.MEMBER_ORDER[1].column, "profession", "the order given is left as it was")
    eq(memberLine(Core.sortMembers(members, byName)),
        "Ana 300 Blacksmithing | Ana 225 Herbalism | Bo 300 Blacksmithing | Luna 120 Blacksmithing")
    eq(Core.orderWords(byName, Core.MEMBER_LIST),
        "Sorted by name, A to Z, then by profession, A to Z, then by skill, highest first.")
    eq(Core.clickWords(byName, "name", Core.MEMBER_LIST), "Click to list them Z to A.")
    eq(Core.clickWords(byName, "skill", Core.MEMBER_LIST), "Click to sort the list by it.")
    -- Z to A, the names the same way, their professions still A to Z.
    local backwards = Core.toggleOrder(byName, "name", Core.MEMBER_LIST)
    eq(memberLine(Core.sortMembers(members, backwards)),
        "Luna 120 Blacksmithing | Bo 300 Blacksmithing | Ana 300 Blacksmithing | Ana 225 Herbalism")
    eq(Core.orderWords(backwards, Core.MEMBER_LIST),
        "Sorted by name, Z to A, then by profession, A to Z, then by skill, highest first.")
    -- Skill: the highest first, as the tab lists a profession's; clicked again, the lowest.
    local bySkill = Core.toggleOrder(Core.MEMBER_ORDER, "skill", Core.MEMBER_LIST)
    eq(memberLine(Core.sortMembers(members, bySkill)),
        "Ana 300 Blacksmithing | Bo 300 Blacksmithing | Ana 225 Herbalism | Luna 120 Blacksmithing")
    eq(Core.orderWords(bySkill, Core.MEMBER_LIST),
        "Sorted by skill, highest first, then by profession, A to Z, then by name, A to Z.")
    eq(Core.clickWords(bySkill, "skill", Core.MEMBER_LIST), "Click to list the lowest first.")
    eq(memberLine(Core.sortMembers(members, Core.toggleOrder(bySkill, "skill", Core.MEMBER_LIST))),
        "Luna 120 Blacksmithing | Ana 225 Herbalism | Ana 300 Blacksmithing | Bo 300 Blacksmithing")
    -- Profession: clicking the one it's sorted by turns it around, the skill still highest first.
    local byProfession = Core.toggleOrder(Core.MEMBER_ORDER, "profession", Core.MEMBER_LIST)
    eq(memberLine(Core.sortMembers(members, byProfession)),
        "Ana 225 Herbalism | Ana 300 Blacksmithing | Bo 300 Blacksmithing | Luna 120 Blacksmithing")
    -- The search keeps whatever order it's in.
    local found = Core.findMembers(
        { memberRow("Luna", "Blacksmithing", 120), memberRow("Ana", "Blacksmithing", 300) }, {}, nil, byName)
    eq(memberLine(found), "Ana 300 Blacksmithing | Luna 120 Blacksmithing")
end)

it("writes a profession with its specializations, without saying the profession twice", function()
    eq(Core.professionLine({ profession = "Blacksmithing", shown = { "Weaponsmith" } }), "Blacksmithing - Weaponsmith")
    eq(Core.professionLine({ profession = "Leatherworking", shown = { "Dragonscale Leatherworking" } }), "Leatherworking - Dragonscale")
    eq(Core.professionLine({ profession = "Engineering", shown = { "Goblin Engineer" } }), "Engineering - Goblin Engineer")
    eq(Core.professionLine({ profession = "Herbalism", shown = {} }), "Herbalism")
end)

it("lists the guild's members, a row per profession, best first, and what each can make", function()
    local db = { characters = {
        ["Luna-RP"] = { name = "Luna", realm = "RP", class = "MAGE", source = "own", guild = "G",
            professions = { Blacksmithing = { rank = 120, recipes = { ["spell:2662"] = true } } } },
        ["Ana-RP"] = { name = "Ana", realm = "RP", source = "guild", guild = "G",
            professions = { Blacksmithing = { rank = 300, max = 300, recipes = { ["spell:9787"] = true, ["spell:9972"] = true } },
                Herbalism = { rank = 225, recipes = {} } } },
        ["Bo-RP"] = { name = "Bo", realm = "RP", source = "link", guild = "G", professions = { Blacksmithing = { recipes = {} } } },
        ["Cy-RP"] = { name = "Cy", realm = "RP", source = "guild", guild = "Other", professions = { Blacksmithing = { recipes = {} } } },
    } }
    local entries = { Blacksmithing = profession("Blacksmithing") }
    local members = Core.guildMembers(db, "G", entries, "Luna-RP")
    local function line(list)
        local out = {}
        for i, m in ipairs(list) do out[i] = ("%s %d %s%s"):format(m.name, m.rank, Core.professionLine(m), m.you and " (you)" or "") end
        return table.concat(out, " | ")
    end
    eq(line(members), "Ana 300 Blacksmithing - Weaponsmith | Luna 120 Blacksmithing (you) | Ana 225 Herbalism", "not a link, not another guild")
    eq(#Core.guildMembers(db, nil, entries), 0, "no guild")
    eq(line(Core.findMembers(members, Core.terms("weaponsmith"))), "Ana 300 Blacksmithing - Weaponsmith")
    eq(line(Core.findMembers(members, Core.terms("ana"), "Herbalism")), "Ana 225 Herbalism")
    eq(line(Core.findMembers(members, {}, "Blacksmithing")), "Ana 300 Blacksmithing - Weaponsmith | Luna 120 Blacksmithing (you)")
    -- What Ana can make: her recipes, not her specialization's spell; with a search, those that match.
    local loaded = Core.load(profession("Blacksmithing"))
    eq(names(Core.memberRecipes(loaded, members[1].record, {})), "Ornate Mithril Breastplate")
    eq(names(Core.memberRecipes(loaded, members[1].record, Core.terms("pants"))), "")
end)

it("knows what a guild can craft: its characters on this account and the guildmates heard from", function()
    local db = { characters = {
        ["Luna-RP"] = { name = "Luna", source = "own", guild = "Order",
            professions = { Blacksmithing = { recipes = { ["spell:2662"] = true } } } },
        ["Ana-RP"] = { name = "Ana", source = "guild", guild = "Order",
            professions = { Blacksmithing = { recipes = { ["spell:2667"] = true } }, Cooking = { recipes = { ["item:1"] = true } } } },
        ["Bo-RP"] = { name = "Bo", source = "own", -- an alt in no guild
            professions = { Blacksmithing = { recipes = { ["spell:3503"] = true } } } },
        ["Zed-RP"] = { name = "Zed", source = "link", guild = "Order",
            professions = { Blacksmithing = { recipes = { ["spell:9972"] = true } } } },
        ["Cid-RP"] = { name = "Cid", source = "guild", guild = "Other",
            professions = { Blacksmithing = { recipes = { ["spell:10003"] = true } } } },
    } }
    local known = Core.guildRecipes(db, "Order")
    local keys = {}
    for key in pairs(known.Blacksmithing.recipes) do keys[#keys + 1] = key end
    table.sort(keys)
    eq(table.concat(keys, ", "), "spell:2662, spell:2667")
    eq(known.Cooking.recipes["item:1"], true)
    eq(next(Core.guildRecipes(nil, "Order")), nil, "no saved data, nothing")

    local recipes = Core.load(profession("Blacksmithing")).recipes
    local function names(query)
        local out = {}
        for _, recipe in ipairs(Core.search({ { recipes = recipes } }, query)) do out[#out + 1] = recipe.name end
        return table.concat(out, ", ")
    end
    eq(names({ terms = {}, known = known }), "Copper Chain Pants, Runed Copper Breastplate")
    eq(names({ terms = { "breastplate" }, known = known }), "Runed Copper Breastplate")
    eq(names({ terms = {}, known = {} }), "", "a guild that knows nothing")
    eq(Core.isQuery({ terms = {}, known = known }), true, "it narrows the list")
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

it("takes what a trainer said a recipe requires as its specialization, after its plans'", function()
    local function loadWith(providers)
        local ns = {}
        assert(loadfile("GuildAssistantDatabase/Core.lua"))("GuildAssistantDatabase", ns)
        assert(loadfile("dev/GuildAssistantDatabase/Data.fixture.lua"))("GuildAssistantDatabase", ns)
        return ns.Core, ns.Core.load(ns.Data.professions[1], providers)
    end
    -- A companion's line: its 5th field (Found.lua writes it).
    local core, blacksmithing = loadWith({ { name = "Found", recipes = "item:7954\t6\t\tIronforge=Bengus Deepforge\tWeaponsmith\n"
        .. "99003\t6\t\t\tMaster Swordsmith;Armorsmith" } })
    local shatterer = recipeNamed(blacksmithing, "The Shatterer")
    eq(shatterer.specialization, "Weaponsmith")
    eq(names(core.search({ blacksmithing }, { terms = core.terms("weaponsmith") })), "The Shatterer, Stonevault Greatsword")
    -- Its plans' first, then what the trainer adds, once each.
    eq(table.concat(recipeNamed(blacksmithing, "Stonevault Greatsword").specializations, ", "),
        "Weaponsmith, Master Swordsmith, Armorsmith")
    eq(#recipeNamed(blacksmithing, "Copper Chain Pants").specializations, 0)

    -- GuildAssistant Professions' saved data (1.5.0): `requires` with each trainer recipe.
    local provider = core.professionsSources({ sources = { recipes = {
        ["item:7954"] = { cost = 20000, trainers = { ["Ironforge=Bengus Deepforge"] = 100 }, requires = { Weaponsmith = 100 } },
    } } })
    eq(provider.recipes, "item:7954\t6\t20000\tIronforge=Bengus Deepforge\tWeaponsmith")
    core, blacksmithing = loadWith({ provider })
    eq(recipeNamed(blacksmithing, "The Shatterer").specialization, "Weaponsmith")
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
    eq(Core.describe(Data), "10 recipes")
    eq(Core.thousands(1234567), "1,234,567"); eq(Core.thousands(12), "12")
    eq(Core.describe({ professions = { { count = 1 } } }), "1 recipe")
end)

-- Attunements --------------------------------------------------------------------------------------

-- GuildAssistant Professions' saved data: Luna (yours) attuned to Onyxia, Ana (a guildmate) looked
-- at and not, Di (your alt there) never looked at, Bo seen through a link and Cy in another guild.
local function attunementsDB()
    return {
        characters = {
            ["Luna-Test Realm"] = { name = "Luna", realm = "Test Realm", class = "MAGE", source = "own",
                guild = "Test Guild", attunements = { ony = true } },
            ["Ana-Test Realm"] = { name = "Ana", realm = "Test Realm", class = "PRIEST", source = "guild",
                guild = "Test Guild", attunements = { ony = false } },
            ["Di-Test Realm"] = { name = "Di", realm = "Test Realm", source = "own", guild = "Test Guild" },
            ["Bo-Test Realm"] = { name = "Bo", realm = "Test Realm", source = "link",
                attunements = { ony = true } },
            ["Cy-Test Realm"] = { name = "Cy", realm = "Test Realm", source = "guild", guild = "Other Guild",
                attunements = { ony = true } },
        },
    }
end

it("lists your guild's characters with what each is attuned to, yours first", function()
    local db = attunementsDB()
    local members = Core.guildAttunements(db, "Test Guild", "Luna-Test Realm")
    local names = {}
    for _, member in ipairs(members) do names[#names + 1] = member.name end
    eq(table.concat(names, ", "), "Luna, Di, Ana",
        "your own first, then the guild by name; not the link's nor another guild's")
    eq(members[1].you, true); eq(members[1].states.ony, true); eq(members[1].attuned, 1)
    eq(members[2].source, "own", "your alt, above the guildmates")
    eq(members[2].states.ony, nil, "never looked at")
    eq(members[3].states.ony, false, "looked at, not attuned")
    eq(#Core.guildAttunements(db, nil, "Luna-Test Realm"), 0, "not in a guild")
    eq(#Core.guildAttunements(nil, "Test Guild", "Luna-Test Realm"), 0, "without the addon")
end)

it("names the raids it knows, and keeps one a newer addon recorded", function()
    local db = attunementsDB()
    eq(#Core.attunementRaids(db), 1)
    eq(Core.attunementRaids(db)[1].raid, "Onyxia's Lair")
    eq(Core.attunementRaids(db)[1].icon, 134154, "the game's icon for the raid")
    eq(Core.attunementLabel(Core.attunementRaids(db)[1]), "|T134154:16:16|t Onyxia's Lair")
    eq(Core.attunementLabel({ key = "mc", raid = "mc" }), "mc", "no icon: its name alone")
    db.characters["Luna-Test Realm"].attunements.mc = true
    local raids = Core.attunementRaids(db)
    eq(#raids, 2)
    eq(raids[2].key, "mc"); eq(raids[2].raid, "mc", "under its key until this addon knows it")
end)

it("shows a column per raid, at most so many, the one picked among them", function()
    local raids = { { key = "a" }, { key = "b" }, { key = "c" } }
    local shown = Core.attunementColumns(raids, nil, 2)
    eq(#shown, 2); eq(shown[1].key, "a")
    shown = Core.attunementColumns(raids, "c", 2)
    eq(#shown, 2); eq(shown[1].key, "c", "the one picked is first"); eq(shown[2].key, "a")
    eq(#Core.attunementColumns(raids, nil, 6), 3, "fewer raids than columns")
end)

it("finds the guildmates a search or a raid keeps, and counts who is attuned", function()
    local members = Core.guildAttunements(attunementsDB(), "Test Guild", "Luna-Test Realm")
    eq(#Core.findAttuned(members, nil, nil), 3)
    eq(#Core.findAttuned(members, Core.terms("an"), nil), 1, "Ana")
    local attuned = Core.findAttuned(members, nil, "ony")
    eq(#attuned, 1); eq(attuned[1].name, "Luna")
    eq(Core.attunedCounts(members).ony, 1)
    local rows = Core.attunementRows(members[2], Core.attunementRaids(attunementsDB()))
    eq(#rows, 1); eq(rows[1].raid, "Onyxia's Lair"); eq(rows[1].attuned, nil, "Di: not known")
end)

-- The guildmates as the Attunements tab reads them: the name and each raid's mark.
local function attunedLine(members, raids)
    local out = {}
    for i, member in ipairs(members) do
        local marks = {}
        for _, raid in ipairs(raids or { "ony" }) do
            local state = member.states[raid]
            marks[#marks + 1] = state == true and "tick" or (state == false and "-" or "?")
        end
        out[i] = ("%s %s"):format(member.name, table.concat(marks, " "))
    end
    return table.concat(out, " | ")
end

it("sorts the guildmates by name, or by who is attuned to a raid, one title at a time", function()
    local db = attunementsDB()
    db.characters["Em-Test Realm"] = { name = "Em", realm = "Test Realm", source = "guild",
        guild = "Test Guild", attunements = { ony = true } }
    local members = Core.guildAttunements(db, "Test Guild", "Luna-Test Realm")
    local list = Core.attunementList(Core.attunementRaids(db))
    eq(list.columns.name.title, "Name")
    eq(list.columns.ony.title, "Onyxia", "the raid's short name, where its icon can't be shown")
    eq(list.single, true, "one column sorts this list at a time")

    -- No title clicked: the tab comes sorted by its first raid, the attuned first, which is what
    -- Reset goes back to. Who can walk into the raid is what the tab is read for.
    local opens = Core.attunementOrder(Core.attunementRaids(db))
    eq(#opens, 1); eq(opens[1].column, "ony"); eq(opens[1].descending, nil)
    eq(attunedLine(Core.sortAttunements(members, opens, list)), "Em tick | Luna tick | Ana - | Di ?")
    eq(Core.orderWords(opens, list), "Sorted by Onyxia's Lair, attuned first.")
    eq(#Core.attunementOrder({}), 0, "no raid at all: nothing to sort by")
    -- And with no order, the guildmates stay as Core.guildAttunements gave them: your own first.
    eq(attunedLine(Core.sortAttunements(members, {}, list)), "Luna tick | Di ? | Ana - | Em tick")
    eq(members[1].name, "Luna", "the list given is left as it is")
    eq(Core.orderWords({}, list), nil, "no chevron with no order at all")

    -- Name: A to Z, your own characters no longer held at the top; clicked again, Z to A.
    local byName = Core.toggleOrder(opens, "name", list)
    eq(#byName, 1); eq(byName[1].column, "name"); eq(byName[1].descending, false)
    eq(attunedLine(Core.sortAttunements(members, byName, list)), "Ana - | Di ? | Em tick | Luna tick")
    eq(Core.orderWords(byName, list), "Sorted by name, A to Z.")
    eq(Core.clickWords(byName, "name", list), "Click to list them Z to A.")
    local backwards = Core.toggleOrder(byName, "name", list)
    eq(attunedLine(Core.sortAttunements(members, backwards, list)), "Luna tick | Em tick | Di ? | Ana -")
    eq(Core.orderWords(backwards, list), "Sorted by name, Z to A.")

    -- The raid's icon: the attuned first, then those who aren't, and the question marks last;
    -- guildmates the raid reads the same way fall back to their names.
    local attunedFirst = Core.toggleOrder(backwards, "ony", list)
    eq(#attunedFirst, 1, "the Name title's chevron goes out: one sorts the list at a time")
    eq(attunedLine(Core.sortAttunements(members, attunedFirst, list)), "Em tick | Luna tick | Ana - | Di ?")
    eq(Core.orderWords(attunedFirst, list), "Sorted by Onyxia's Lair, attuned first.")
    eq(Core.clickWords(attunedFirst, "ony", list), "Click to list the attuned last.")
    eq(Core.clickWords(attunedFirst, "name", list), "Click to list them A to Z.")

    -- Clicked again: the attuned at the bottom, those who aren't on top, and the question marks
    -- still last -- nobody having looked says nothing about the raid either way.
    local attunedLast = Core.toggleOrder(attunedFirst, "ony", list)
    eq(attunedLast[1].descending, true)
    eq(attunedLine(Core.sortAttunements(members, attunedLast, list)), "Ana - | Em tick | Luna tick | Di ?")
    eq(Core.orderWords(attunedLast, list), "Sorted by Onyxia's Lair, attuned last.")
    eq(Core.clickWords(attunedLast, "ony", list), "Click to list the attuned first.")
    -- Back to the Name title, and a raid the data no longer has is no column to sort by.
    eq(#Core.toggleOrder(attunedLast, "name", list), 1)
    eq(Core.toggleOrder(attunedLast, "mc", list), attunedLast, "a raid this list hasn't got")
end)

it("sorts a second raid's column on its own, the names breaking its ties", function()
    local db = attunementsDB()
    db.characters["Luna-Test Realm"].attunements.mc = true
    db.characters["Ana-Test Realm"].attunements.mc = false
    local members = Core.guildAttunements(db, "Test Guild", "Luna-Test Realm")
    local list = Core.attunementList(Core.attunementRaids(db))
    eq(list.columns.mc.title, "mc", "a raid only the newer addon knows: under its key")
    local byMC = Core.toggleOrder({}, "mc", list)
    eq(attunedLine(members, { "mc" }), "Luna tick | Di ? | Ana -", "as they come")
    eq(attunedLine(Core.sortAttunements(members, byMC, list), { "mc" }), "Luna tick | Ana - | Di ?")
    eq(Core.orderWords(byMC, list), "Sorted by mc, attuned first.")
end)

print(("%d passed, %d failed"):format(passed, failed))
if failed > 0 then error(failed .. " failed") end
