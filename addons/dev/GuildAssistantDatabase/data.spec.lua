-- Checks the data GuildAssistantDatabase ships (Data.lua, built from the game's tables by
-- `npm run database`): every profession reads, and every recipe has what the window shows. Run with `npm test` in addons/ (or
-- lua dev/GuildAssistantDatabase/data.spec.lua).

local ns = {}
assert(loadfile("GuildAssistantDatabase/Core.lua"))("GuildAssistantDatabase", ns)
assert(loadfile("GuildAssistantDatabase/Data.lua"))("GuildAssistantDatabase", ns)
local Core, Data = ns.Core, ns.Data

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

local function check(condition, what)
    if not condition then error(what, 2) end
end

it("says where it's from", function()
    check(Data.version == "forever", "version " .. tostring(Data.version))
    check(Data.format == 2, "format " .. tostring(Data.format))
    check(tostring(Data.build):match("^1%.60%.%d+%.%d+$"), "build " .. tostring(Data.build))
    check(tostring(Data.fetched):match("^%d%d%d%d%-%d%d%-%d%d$"), "fetched " .. tostring(Data.fetched))
    check(#Data.professions >= 9, #Data.professions .. " professions")
end)

it("reads every profession, with what the window shows for each recipe", function()
    local total, missingReagents = 0, {}
    for _, entry in ipairs(Data.professions) do
        local loaded = Core.load(entry)
        check(#loaded.recipes == entry.count, ("%s: %d recipes, count says %d"):format(entry.name, #loaded.recipes, entry.count))
        for _, recipe in ipairs(loaded.recipes) do
            local what = ("%s %d (%s)"):format(entry.name, recipe.id, recipe.name)
            check(recipe.id > 0 and recipe.name ~= "", what .. ": no id or name")
            check(#recipe.reagents > 0, what .. ": no reagents")
            -- A reagent the game's tables lack is named in game (Game.itemName): only counted here.
            for _, reagent in ipairs(recipe.reagents) do
                if reagent.item.missing then missingReagents[reagent.item.id] = true end
                check(reagent.count > 0, what .. ": reagent count")
            end
            if recipe.creates then
                check(not recipe.creates.missing, what .. ": makes item " .. recipe.creates.id .. " with no name")
            end
            for _, item in ipairs(recipe.recipeItems) do
                check(not item.name:match("^Item %d+$"), what .. ": recipe item " .. item.id .. " with no data")
            end
            check(#Core.howToLearn(recipe) > 0, what .. ": how to learn")
        end
        total = total + #loaded.recipes
    end
    check(total > 2000, total .. " recipes")
    local missing = 0
    for _ in pairs(missingReagents) do missing = missing + 1 end
    check(missing < 200, missing .. " reagents without a name")
end)

it("finds well-known recipes", function()
    local all = {}
    for _, entry in ipairs(Data.professions) do all[#all + 1] = Core.load(entry) end
    for _, search in ipairs({ "copper chain pants", "minor healing potion", "linen bandage", "smelt copper", "enchant bracer",
        "plate chest", "one-handed maces" }) do
        check(#Core.search(all, { terms = Core.terms(search) }) > 0, "nothing for " .. search)
    end
end)

it("knows the specializations recipes need, from their plans and patterns", function()
    local all = {}
    for _, entry in ipairs(Data.professions) do all[#all + 1] = Core.load(entry) end
    -- Each profession's, by spell (GuildAssistant Professions asks the game about them).
    local names = {}
    for _, entry in ipairs(Data.professions) do
        for _, spec in ipairs(Core.specializationsOf(entry).list) do names[#names + 1] = spec.id .. " " .. spec.name end
    end
    check(table.concat(names, ", ") == "9787 Weaponsmith, 9788 Armorsmith, 17039 Master Swordsmith, 17040 Master Hammersmith, "
        .. "17041 Master Axesmith, 20219 Gnomish Engineer, 20222 Goblin Engineer, 10656 Dragonscale Leatherworking, "
        .. "10658 Elemental Leatherworking, 10660 Tribal Leatherworking", table.concat(names, ", "))
    local helm = Core.search(all, { terms = Core.terms("dark iron helm") })[1]
    check(helm and helm.specialization == "Armorsmith", "Dark Iron Helm: " .. tostring(helm and helm.specialization))
    -- Each specialization finds its own recipes, and only those (the Master *smiths' are a Weaponsmith's).
    for _, name in ipairs({ "Weaponsmith", "Armorsmith", "Master Swordsmith", "Tribal Leatherworking",
        "Dragonscale Leatherworking", "Elemental Leatherworking", "Gnomish Engineer", "Goblin Engineer" }) do
        local found = Core.search(all, { terms = { name:lower() } })
        check(#found > 0, "nothing for " .. name)
        for _, recipe in ipairs(found) do
            local needs = false
            for _, specialization in ipairs(recipe.specializations) do needs = needs or specialization == name end
            check(needs, ("%s: %s doesn't need it"):format(name, recipe.name))
        end
    end
end)

it("knows which items bind when picked up, from the game's data", function()
    local all, bound = {}, 0
    for _, entry in ipairs(Data.professions) do all[#all + 1] = Core.load(entry) end
    local found = Core.search(all, { binding = { [Core.BIND_ON_PICKUP] = true } })
    for _, recipe in ipairs(found) do
        check(recipe.creates and recipe.creates.bonding == Core.BIND_ON_PICKUP, recipe.name .. " doesn't bind on pickup")
        bound = bound + 1
    end
    check(bound > 300, bound .. " recipes whose item binds on pickup")
    local helm = Core.search(all, { terms = Core.terms("lionheart helm") })[1]
    check(helm and helm.creates.bonding == 2, "Lionheart Helm binds when equipped")
end)

it("ships the seed of known sources, complete, and it matches the data", function()
    _G.GuildAssistantDatabaseSources = nil
    assert(loadfile("GuildAssistantDatabase/Seed.lua"))("GuildAssistantDatabase", {})
    local providers = _G.GuildAssistantDatabaseSources
    check(type(providers) == "table" and #providers == 1, "the seed registers itself")
    check(providers[1].complete == true, "the seed is complete")
    local fresh = {}
    assert(loadfile("GuildAssistantDatabase/Core.lua"))("GuildAssistantDatabase", fresh)
    assert(loadfile("GuildAssistantDatabase/Data.lua"))("GuildAssistantDatabase", fresh)
    local vouched, withSources = 0, 0
    for _, entry in ipairs(fresh.Data.professions) do
        local loaded = fresh.Core.load(entry, providers)
        vouched = vouched + loaded.vouchedCount
        for _, recipe in ipairs(loaded.recipes) do
            for _, recipeItem in ipairs(recipe.recipeItems) do
                if #recipeItem.sources > 0 then withSources = withSources + 1 end
            end
        end
    end
    check(vouched > 2000, vouched .. " recipes vouched for")
    check(withSources > 400, withSources .. " recipe items with sources")
    _G.GuildAssistantDatabaseSources = nil
end)

print(("%d passed, %d failed"):format(passed, failed))
if failed > 0 then error(failed .. " failed") end
