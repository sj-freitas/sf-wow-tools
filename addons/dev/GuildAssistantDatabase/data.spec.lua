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

print(("%d passed, %d failed"):format(passed, failed))
if failed > 0 then error(failed .. " failed") end
