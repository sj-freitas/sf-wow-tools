-- Tests of GuildAssistantDatabase's Core.lua, outside WoW, on Data.fixture.lua (what the database
-- job builds from wowhead.fixture.mjs; scripts/database/database.test.mjs keeps the two in step).
-- Run with `npm test` in addons/ (or any Lua 5.1+ from addons/: lua dev/GuildAssistantDatabase/core.spec.lua).

local function loadData()
    local ns = {}
    assert(loadfile("GuildAssistantDatabase/Core.lua"))("GuildAssistantDatabase", ns)
    assert(loadfile("dev/GuildAssistantDatabase/Data.fixture.lua"))("GuildAssistantDatabase", ns)
    return ns.Core, ns.Data
end
local Core, Data = loadData()

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
    eq(entry.count, 6)
    local loaded = Core.load(entry)
    eq(#loaded.recipes, 6)
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
    eq(breastplate.recipeItems[1].sources[1].kind, "drop")
    eq(breastplate.recipeItems[1].sources[1].zone, 40)
    eq(breastplate.recipeItems[1].sources[1].name, "Defias Renegade Mage")
    eq(recipeNamed(loaded, "The Shatterer").trainingCost, 13500)
end)

it("reads an enchant, which makes no item", function()
    local loaded = Core.load(profession("Enchanting"))
    local enchant = recipeNamed(loaded, "Enchant Bracer - Minor Health")
    eq(enchant.creates, nil)
    eq(enchant.level, 0)
    eq(enchant.reagents[1].item.name, "Strange Dust")
end)

it("adds what the game knows of an item made: words searched, and its class", function()
    local entry = { name = "Test", recipes = "1\tThing\t5\t1,2,3\t99,1,1\t\t\t\t", items = "99\tThing\t2\t10\t5\t\tChest\t\t" }
    local asked = 0
    local loaded = Core.load(entry, function(id)
        asked = asked + 1
        if id == 99 then return "Armor Plate", 4, 4 end
    end)
    eq(loaded.recipes[1].search:find("plate", 1, true) ~= nil, true, "its type is searched")
    eq(loaded.recipes[1].creates.summary, "Chest")
    eq(loaded.recipes[1].creates.classID, 4); eq(loaded.recipes[1].creates.subclassID, 4)
    eq(asked, 1)
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
    eq(names(Core.search(all(), { terms = Core.terms("fire resistance") })), "Golden Scale Coif")
    eq(names(Core.search(all(), { terms = Core.terms("strange dust") })), "Enchant Bracer - Minor Health")
    eq(names(Core.search(all(), { terms = Core.terms("enchanting") })), "Enchant Bracer - Minor Health, Greater Magic Wand")
    eq(#Core.search(all(), { terms = Core.terms("breastplate stamina") }), 0, "every word must match")
end)

it("lists those whose name matches first, then by skill", function()
    -- "copper" is in two names, and is a reagent of others.
    eq(names(Core.search(all(), { terms = Core.terms("copper") })), "Copper Chain Pants, Runed Copper Breastplate")
    eq(names(Core.search(all(), { terms = Core.terms("mithril") })), "Ornate Mithril Breastplate, The Shatterer")
    -- No words: everything, by skill.
    eq(names(Core.search({ Core.load(profession("Blacksmithing")) }, { terms = {} })),
        "Copper Chain Pants, Rough Sharpening Stone, Runed Copper Breastplate, Golden Scale Coif, The Shatterer, Ornate Mithril Breastplate")
end)

it("keeps the level and skill within the limits given", function()
    eq(names(Core.search(all(), { minLevel = 30, maxLevel = 42 })), "Golden Scale Coif, The Shatterer")
    -- Something that needs no level counts as level 1.
    eq(names(Core.search(all(), { maxLevel = 1 })), "Enchant Bracer - Minor Health, Rough Sharpening Stone")
    eq(names(Core.search(all(), { minSkill = 200, maxSkill = 239 })), "The Shatterer")
    eq(names(Core.search(all(), { minSkill = 1, maxSkill = 15, minLevel = 2 })), "Copper Chain Pants")
end)

it("keeps to the slots and armor types picked", function()
    -- What the game would say: Runed Copper Breastplate and Ornate Mithril Breastplate are plate,
    -- Golden Scale Coif and Copper Chain Pants mail.
    local classes = { [2864] = 4, [7935] = 4, [3837] = 3, [2852] = 3 }
    for _, profession in ipairs(all()) do
        for _, item in pairs(profession.items) do
            if classes[item.id] then item.classID, item.subclassID = 4, classes[item.id] end
        end
    end
    local function filtered(slotNames, armorNames)
        local slots, armor = Core.filterSets(slotNames, armorNames)
        return names(Core.search(all(), { slots = slots, armor = armor }))
    end
    eq(filtered({ Chest = true }, {}), "Runed Copper Breastplate, Ornate Mithril Breastplate")
    eq(filtered({}, { Plate = true }), "Runed Copper Breastplate, Ornate Mithril Breastplate")
    eq(filtered({}, { Mail = true, Plate = true }), "Copper Chain Pants, Runed Copper Breastplate, Golden Scale Coif, Ornate Mithril Breastplate")
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
    local counts = Core.countByProfession(Core.search(all(), { terms = Core.terms("dust") }))
    eq(counts.Enchanting, 2); eq(counts.Blacksmithing, nil)
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

it("says how a recipe is learned: trainer, drop, vendor, quest", function()
    local loaded = Core.load(profession("Blacksmithing"))
    eq(table.concat(Core.howToLearn(recipeNamed(loaded, "Copper Chain Pants"), zoneName), " | "), "Trainer (50c)")
    eq(table.concat(Core.howToLearn(recipeNamed(loaded, "The Shatterer"), zoneName), " | "), "Trainer (1g 35s)")
    -- Wowhead says drop and pickpocketing; the plans' drop says where.
    eq(table.concat(Core.howToLearn(recipeNamed(loaded, "Runed Copper Breastplate"), zoneName), " | "),
        "Drop: Defias Renegade Mage (Westfall) | Pickpocketing")
    eq(table.concat(Core.howToLearn(recipeNamed(loaded, "Golden Scale Coif"), zoneName), " | "), "Vendor: Krinkle Goodsteel (Tanaris)")
    eq(table.concat(Core.howToLearn(recipeNamed(loaded, "Ornate Mithril Breastplate"), zoneName), " | "), "Quest: Ornate Mithril Armor")
    eq(table.concat(Core.howToLearn(recipeNamed(loaded, "Rough Sharpening Stone"), zoneName), " | "), "Not listed on Wowhead")
    -- Without zone names, the zone is left out.
    eq(Core.howToLearn(recipeNamed(loaded, "Golden Scale Coif"))[1], "Vendor: Krinkle Goodsteel")
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

it("counts the data's recipes", function()
    eq(Core.describe(Data), "8 recipes")
    eq(Core.thousands(1234567), "1,234,567"); eq(Core.thousands(12), "12")
    eq(Core.describe({ professions = { { count = 1 } } }), "1 recipe")
end)

print(("%d passed, %d failed"):format(passed, failed))
if failed > 0 then error(failed .. " failed") end
