-- Tests of GuildAssistantProfessions (Core.lua, and Scan.lua against a fake game), outside WoW.
-- Run with `npm test` in addons/ (or any Lua 5.1+ from addons/:
-- lua dev/GuildAssistantProfessions/core.spec.lua).

local ns = {}
assert(loadfile("GuildAssistantProfessions/Core.lua"))("GuildAssistantProfessions", ns)
local Core = ns.Core

local function read(path)
    if readfile then return readfile(path) end
    local file = assert(io.open(path))
    local text = file:read("*a")
    file:close()
    return text
end

local specPrint = print -- the spec's own output: the scan tests silence the addon's
local passed, failed = 0, 0
local function it(name, fn)
    local ok, err = pcall(fn)
    _G.print = specPrint
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

-- Links --------------------------------------------------------------------------------------

it("reads a recipe's spell from its link, else the item it makes", function()
    local spell = Core.recipeFromLink("|cffffd000|Henchant:20034|h[Enchant Weapon - Crusader]|h|r")
    eq(spell.kind, "spell"); eq(spell.id, 20034)
    eq(Core.recipeFromLink("|cffffd000|Hspell:3275|h[Linen Bandage]|h|r").id, 3275)
    local item = Core.recipeFromLink("|cff1eff00|Hitem:14146:0:0:0|h[Gloves of Spell Mastery]|h|r")
    eq(item.kind, "item"); eq(item.id, 14146)
    eq(Core.recipeFromLink(nil), nil)
    eq(Core.recipeFromLink("plain text"), nil)
end)

-- Recording ----------------------------------------------------------------------------------

it("keeps the professions the skill list shows and drops unlearned ones", function()
    local db = Core.newDB()
    local luna = Core.character(db, "Luna", "Wild Growth", "MAGE")
    Core.setProfessions(luna, {
        { name = "Tailoring", rank = 280, max = 300 },
        { name = "Enchanting", rank = 300, max = 300 },
    })
    Core.addRecipes(luna, "Tailoring", nil, nil, { { kind = "spell", id = 3915 } })
    Core.setProfessions(luna, { { name = "Tailoring", rank = 285, max = 300 } })
    eq(luna.professions.Enchanting, nil, "unlearned Enchanting")
    eq(luna.professions.Tailoring.rank, 285)
    eq(luna.professions.Tailoring.recipes["spell:3915"], true, "recipes kept")
end)

it("only ever adds recipes, and counts the new ones", function()
    local luna = Core.character(Core.newDB(), "Luna", "Wild Growth", "MAGE")
    eq(Core.addRecipes(luna, "Enchanting", 300, 300, {
        { kind = "spell", id = 20034 }, { kind = "spell", id = 13890 },
    }), 2)
    -- A filtered window shows fewer: nothing is lost, one is new.
    eq(Core.addRecipes(luna, "Enchanting", 300, 300, {
        { kind = "spell", id = 20034 }, { kind = "spell", id = 20025 },
    }), 1)
    local count = 0
    for _ in pairs(luna.professions.Enchanting.recipes) do count = count + 1 end
    eq(count, 3)
end)

it("replaces a profession's recipes with a full list, saying whether it changed", function()
    local luna = Core.character(Core.newDB(), "Luna", "Wild Growth", "MAGE")
    -- Recorded wrongly before: Cooking's 2538 under Blacksmithing.
    Core.addRecipes(luna, "Blacksmithing", 25, 75, { { kind = "spell", id = 2538 }, { kind = "spell", id = 2660 } }, 100)
    eq(Core.setRecipes(luna, "Blacksmithing", 25, 75, { { kind = "spell", id = 2660 } }, 200), true)
    eq(luna.professions.Blacksmithing.recipes["spell:2538"], nil, "the wrong one is gone")
    eq(luna.updated, 200)
    eq(Core.setRecipes(luna, "Blacksmithing", 25, 75, { { kind = "spell", id = 2660 } }, 300), false, "same list")
    eq(luna.updated, 200)
    eq(Core.setRecipes(luna, "Blacksmithing", 26, 75, {
        { kind = "spell", id = 2660 }, { kind = "spell", id = 2662 },
    }, 400), true, "one more")
end)

it("drops an unlearned profession with its recipes and says which, but not on an empty list", function()
    local luna = Core.character(Core.newDB(), "Luna", "Wild Growth", "MAGE")
    Core.setProfessions(luna, {
        { name = "Tailoring", rank = 280, max = 300 },
        { name = "Enchanting", rank = 300, max = 300 },
        { name = "Cooking", rank = 150, max = 225 },
    }, 100)
    Core.addRecipes(luna, "Tailoring", nil, nil, { { kind = "spell", id = 3915 } }, 100)
    -- The game lists nothing yet (at login): nothing is dropped.
    local changed, dropped = Core.setProfessions(luna, {}, 200)
    eq(changed, false, "empty list")
    eq(#dropped, 0)
    eq(luna.professions.Tailoring.recipes["spell:3915"], true, "kept")
    -- Tailoring unlearned.
    changed, dropped = Core.setProfessions(luna, {
        { name = "Enchanting", rank = 300, max = 300 },
        { name = "Cooking", rank = 150, max = 225 },
    }, 300)
    eq(changed, true)
    eq(table.concat(dropped, ","), "Tailoring")
    eq(luna.professions.Tailoring, nil, "gone, recipes and all")
    eq(luna.updated, 300)
end)

it("marks a character updated when something new is recorded, not otherwise", function()
    local luna = Core.character(Core.newDB(), "Luna", "Wild Growth", "MAGE")
    eq(Core.setProfessions(luna, { { name = "Tailoring", rank = 280, max = 300 } }, 100), true)
    eq(luna.updated, 100)
    eq(Core.setProfessions(luna, { { name = "Tailoring", rank = 280, max = 300 } }, 200), false)
    eq(luna.updated, 100, "nothing changed")
    Core.addRecipes(luna, "Tailoring", nil, nil, { { kind = "spell", id = 3915 } }, 300)
    eq(luna.updated, 300, "new recipe")
    Core.addRecipes(luna, "Tailoring", nil, nil, { { kind = "spell", id = 3915 } }, 400)
    eq(luna.updated, 300, "known recipe")
end)

it("keeps a character seen through a link apart, until it turns out to be one's own", function()
    local db = Core.newDB()
    eq(Core.character(db, "Mira", "Wild Growth", nil, "link").source, "link")
    eq(Core.character(db, "Mira", "Wild Growth", "PRIEST", "own").source, "own", "logged in with it")
    eq(Core.character(db, "Mira", "Wild Growth", nil, "link").source, "own", "stays own")
end)

-- Export -------------------------------------------------------------------------------------

local function sampleDB()
    local db = Core.newDB()
    local luna = Core.character(db, "Luna", "Wild Growth", "MAGE")
    Core.setProfessions(luna, {
        { name = "Enchanting", rank = 300, max = 300 },
        { name = "Tailoring", rank = 280, max = 300 },
    })
    Core.addRecipes(luna, "Enchanting", 300, 300, {
        { kind = "spell", id = 20034 }, { kind = "spell", id = 13890 },
    })
    Core.addRecipes(luna, "Tailoring", 280, 300, {
        { kind = "spell", id = 18560 }, { kind = "item", id = 14146 },
    })
    local bob = Core.character(db, "Bob", "Wild Growth", "WARRIOR")
    Core.setProfessions(bob, { { name = "First Aid", rank = 300, max = 300 } })
    Core.addRecipes(bob, "First Aid", 300, 300, { { kind = "spell", id = 18630 } })
    local mira = Core.character(db, "Mira", "Wild Growth", nil, "link")
    Core.addRecipes(mira, "Alchemy", 250, 300, { { kind = "spell", id = 11459 } }, 1792000000)
    return db
end

it("exports every character, sorted, with recipe ids sorted", function()
    local json = Core.toJSON(Core.exportData(sampleDB()))
    eq(json:sub(1, 60), '{"addon":"GuildAssistantProfessions","characters":[{"class":', "start")
    assert(json:find('"name":"Bob"', 1, true) < json:find('"name":"Luna"', 1, true), "Bob before Luna")
    assert(json:find('"spells":[13890,20034]', 1, true), "spells sorted: " .. json)
    assert(json:find('"items":[14146]', 1, true), "item fallback kept")
    assert(json:find('"spells":[18560]', 1, true), "tailoring spells")
end)

it("writes empty lists as [] and escapes text", function()
    eq(Core.toJSON({ spells = {} }), '{"spells":[]}')
    eq(Core.toJSON({ name = 'Dark "Shiv"\\\n' }), '{"name":"Dark \\"Shiv\\"\\\\\\n"}')
end)

it("matches the fixture the API's import test reads", function()
    local expected = read("dev/GuildAssistantProfessions/export.fixture.json"):gsub("%s+$", "")
    eq(Core.toJSON(Core.exportData(sampleDB())), expected, "export.fixture.json")
end)

it("describes an export", function()
    eq(Core.describe(Core.exportData(sampleDB())), "3 characters, 4 professions, 6 recipes")
end)

it("keeps the export in the saved data", function()
    local db = sampleDB()
    Core.refreshExport(db, 1792000000)
    eq(db.export, Core.toJSON(Core.exportData(db)))
    eq(db.updated, 1792000000)
    assert(db.export:find('"name":"Mira","professions":', 1, true), "linked character exported")
    assert(db.export:find('"source":"link","updated":1792000000', 1, true), "its source: " .. db.export)
end)

-- Scan (fake game) ---------------------------------------------------------------------------

_G.time = os.time -- the game's time()

it("records skills under the profession headers and the open window's recipes", function()
    local skills = {
        { "Class Skills", true }, { "Fire", false, 300, 300 },
        { "Professions", true }, { "Enchanting", false, 300, 300 },
        { "Secondary Skills", true }, { "Cooking", false, 150, 225 },
        { "Weapon Skills", true }, { "Staves", false, 300, 300 },
    }
    _G.UnitClass = function() return "Mage", "MAGE" end
    _G.UnitName = function() return "Luna" end
    _G.GetRealmName = function() return "Wild Growth" end
    _G.GetNumSkillLines = function() return #skills end
    _G.GetSkillLineInfo = function(i)
        local s = skills[i]
        return s[1], s[2], nil, s[3], nil, nil, s[4]
    end
    local crafts = {
        { "Weapon", "header" },
        { "Enchant Weapon - Crusader", "optimal", "|Henchant:20034|h[Enchant Weapon - Crusader]|h" },
    }
    _G.GetNumCrafts = function() return #crafts end
    _G.GetCraftDisplaySkillLine = function() return "Enchanting", 300, 300 end
    _G.GetCraftInfo = function(i) return crafts[i][1], nil, crafts[i][2] end
    _G.GetCraftItemLink = function(i) return crafts[i][3] end
    local realPrint = print
    _G.print = function() end

    local game = { Core = Core, db = Core.newDB() }
    assert(loadfile("GuildAssistantProfessions/Scan.lua"))("GuildAssistantProfessions", game)
    game.Scan.skills()
    game.Scan.crafts()
    local luna = game.db.characters["Luna-Wild Growth"]
    eq(luna.class, "MAGE")
    eq(luna.professions.Enchanting.rank, 300)
    eq(luna.professions.Cooking.max, 225)
    eq(luna.professions.Fire, nil, "class skills aren't professions")
    eq(luna.professions.Staves, nil, "weapon skills aren't professions")
    _G.print = realPrint
    eq(luna.professions.Enchanting.recipes["spell:20034"], true)
end)

it("reads professions and recipes with the modern API (WoW Forever's client)", function()
    for _, name in ipairs({ "GetNumSkillLines", "GetSkillLineInfo", "GetNumCrafts",
        "GetCraftDisplaySkillLine", "GetNumTradeSkills" }) do
        _G[name] = nil
    end
    _G.UnitClass = function() return "Priest", "PRIEST" end
    _G.UnitName = function() return "Sol" end
    _G.GetRealmName = function() return "Wild Growth" end
    -- Primary, primary, archaeology, fishing, cooking: unlearned slots are nil.
    _G.GetProfessions = function() return 1, nil, nil, nil, 5 end
    local professions = { [1] = { "Tailoring", 280, 300 }, [5] = { "Cooking", 75, 150 } }
    _G.GetProfessionInfo = function(index)
        local p = professions[index]
        return p[1], "icon", p[2], p[3]
    end
    local linked = false
    local recipes = { [18560] = true, [3915] = true, [12088] = false } -- spell id: learned
    _G.C_TradeSkillUI = {
        GetAllRecipeIDs = function() return { 3915, 12088, 18560 } end,
        GetRecipeInfo = function(id) return { recipeID = id, learned = recipes[id] } end,
        GetBaseProfessionInfo = function() return { professionName = "Tailoring", skillLevel = 280, maxSkillLevel = 300 } end,
        IsTradeSkillLinked = function() return linked ~= false, linked or nil end,
    }
    local realPrint = print
    _G.print = function() end

    local game = { Core = Core, db = Core.newDB() }
    assert(loadfile("GuildAssistantProfessions/Scan.lua"))("GuildAssistantProfessions", game)
    game.Scan.skills()
    local sol = game.db.characters["Sol-Wild Growth"]
    eq(sol.professions.Tailoring.rank, 280)
    eq(sol.professions.Cooking.max, 150)
    game.Scan.tradeSkills()
    eq(sol.professions.Tailoring.recipes["spell:18560"], true, "learned recipe")
    eq(sol.professions.Tailoring.recipes["spell:3915"], true, "learned recipe")
    eq(sol.professions.Tailoring.recipes["spell:12088"], nil, "unlearned recipe")

    -- Switching to Cooking: its name comes first, with Tailoring's list still there. Not Cooking's.
    local cooking = false
    C_TradeSkillUI.GetBaseProfessionInfo = function()
        if cooking then return { professionName = "Cooking", skillLevel = 75, maxSkillLevel = 150 } end
        return { professionName = "Tailoring", skillLevel = 280, maxSkillLevel = 300 }
    end
    cooking = true
    eq(game.Scan.tradeSkills(), false, "stale list")
    eq(next(sol.professions.Cooking.recipes), nil, "nothing recorded for Cooking")
    C_TradeSkillUI.GetAllRecipeIDs = function() return { 2538 } end
    recipes[2538] = true
    eq(game.Scan.tradeSkills(), true, "Cooking's own list")
    eq(sol.professions.Cooking.recipes["spell:2538"], true)
    cooking = false
    C_TradeSkillUI.GetAllRecipeIDs = function() return { 3915, 12088, 18560 } end

    linked, recipes[12088] = "Mira-Other Realm", true
    game.Scan.tradeSkills()
    eq(sol.professions.Tailoring.recipes["spell:12088"], nil, "not Sol's")
    local mira = game.db.characters["Mira-Other Realm"]
    eq(mira.source, "link")
    eq(mira.professions.Tailoring.recipes["spell:12088"], true, "recorded as Mira's")
    linked = "Kai"
    game.Scan.tradeSkills()
    eq(game.db.characters["Kai-Wild Growth"].source, "link", "no realm in the link: ours")

    -- Sol's own link, with the full name a link carries: Sol's, and an earlier entry as someone
    -- else's goes.
    game.db.characters["Sol Dawnward-Wild Growth"] = { name = "Sol Dawnward", realm = "Wild Growth", professions = {}, source = "link" }
    linked, recipes[12088] = "Sol Dawnward", true
    game.Scan.tradeSkills()
    eq(game.db.characters["Sol Dawnward-Wild Growth"], nil, "not someone else")
    eq(sol.professions.Tailoring.recipes["spell:12088"], true, "recorded as Sol's")
    linked = "Solveig"
    game.Scan.tradeSkills()
    eq(game.db.characters["Solveig-Wild Growth"].source, "link", "a name that only starts like Sol's")
    _G.print = realPrint
    eq(table.concat(game.Scan.client(), ","),
        "GetProfessions,GetProfessionInfo,C_TradeSkillUI.GetAllRecipeIDs,C_TradeSkillUI.GetRecipeInfo,"
        .. "C_TradeSkillUI.GetBaseProfessionInfo,C_TradeSkillUI.IsTradeSkillLinked", "functions found")
    _G.C_TradeSkillUI, _G.GetProfessions, _G.GetProfessionInfo = nil, nil, nil
end)

print(("%d passed, %d failed"):format(passed, failed))
if failed > 0 then error(failed .. " failed") end
