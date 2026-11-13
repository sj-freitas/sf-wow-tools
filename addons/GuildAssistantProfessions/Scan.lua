-- GuildAssistant Professions: reading the game. At login (and when skills change) the character's
-- professions and skill are read; recipes can only be read while a profession's window is open, so
-- they are recorded each time one opens: the character's own, and someone else's opened from a
-- profession link (recorded under their name, as "link"). Two APIs: Classic Era's (skill list, trade skill and craft
-- windows) and the modern one WoW Forever's client has (GetProfessions, C_TradeSkillUI).

local _, ns = ...
local Core = ns.Core
local Scan = {}
ns.Scan = Scan

-- The skill list's headers for professions (localized by the game; English when it has none).
local PROFESSION_HEADERS = {
    [TRADE_SKILLS or "Professions"] = true,
    [SECONDARY_SKILLS or "Secondary Skills"] = true,
    ["Professions"] = true,
    ["Secondary Skills"] = true,
}

--- Now, by the server's clock when the client has it: when a character was last updated is
--- compared between players (guild sharing keeps the newer), so not by each one's own clock.
function ns.now()
    return (GetServerTime and GetServerTime()) or time()
end

function Scan.say(text, ...)
    print("|cff7c5cffGuildAssistant Professions|r: " .. text:format(...))
end

--- This character's saved entry (with its guild: only characters of the same guild are shared),
--- under the full name. One saved under the first name alone (1.0.2 and earlier) is renamed.
function Scan.current()
    local _, class = UnitClass("player")
    local first, last = UnitName("player")
    local name, realm = Core.playerName(first, last), Core.realmName(GetRealmName())
    local old = ns.db.characters[first .. "-" .. realm]
    if name ~= first and old then
        ns.db.characters[first .. "-" .. realm] = nil
        if not ns.db.characters[name .. "-" .. realm] then
            old.name = name
            ns.db.characters[name .. "-" .. realm] = old
        end
    end
    local character = Core.character(ns.db, name, realm, class, "own")
    local guild = IsInGuild and IsInGuild() and GetGuildInfo and GetGuildInfo("player") or nil
    if guild then character.guild = guild end
    return character
end

--- The saved entry of someone whose profession link is open ("Name" or "Name-Realm"). A link
--- carries the full name ("Shivan Nightpath" in WoW Forever), so a link to one's own profession
--- (full name, or the first name followed by any last name) is this character, not someone else.
local function linked(fullName)
    local name, realm = fullName:match("^([^-]+)-(.+)$")
    name, realm = name or fullName, Core.realmName(realm or GetRealmName())
    local first, last = UnitName("player")
    local own = Core.isOwnName(name, first, last) or name:sub(1, #first + 1) == first .. " "
    if realm == Core.realmName(GetRealmName()) and own then
        if name ~= Core.playerName(first, last) then
            ns.db.characters[name .. "-" .. realm] = nil -- recorded as someone else's before
        end
        return Scan.current()
    end
    return Core.character(ns.db, name, realm, nil, "link")
end

--- Which of the game functions the scan can use this client has, kept in the saved data so a
--- client that reads nothing can be told apart from one that has no recipes yet.
function Scan.client()
    local found = {}
    for _, name in ipairs({ "GetNumSkillLines", "GetProfessions", "GetProfessionInfo",
        "GetNumTradeSkills", "GetNumCrafts", "IsPlayerSpell" }) do
        if _G[name] then found[#found + 1] = name end
    end
    for _, name in ipairs({ "GetAllRecipeIDs", "GetRecipeInfo", "GetBaseProfessionInfo",
        "GetTradeSkillLine", "IsTradeSkillLinked" }) do
        if C_TradeSkillUI and C_TradeSkillUI[name] then found[#found + 1] = "C_TradeSkillUI." .. name end
    end
    return found
end

-- Classic Era: the skill list, professions under their headers (all headers opened first).
local function skillListProfessions()
    if ExpandSkillHeader then ExpandSkillHeader(0) end
    local skills, inProfessions = {}, false
    for i = 1, GetNumSkillLines() do
        local name, isHeader, _, rank, _, _, max = GetSkillLineInfo(i)
        if isHeader then
            inProfessions = PROFESSION_HEADERS[name] == true
        elseif inProfessions and name then
            skills[#skills + 1] = { name = name, rank = rank, max = max }
        end
    end
    return skills
end

-- Modern: GetProfessions gives the spellbook's profession slots (primary, secondary), some empty.
local function spellbookProfessions()
    local skills = {}
    for _, index in pairs({ GetProfessions() }) do
        local name, _, rank, max = GetProfessionInfo(index)
        if name then skills[#skills + 1] = { name = name, rank = rank, max = max } end
    end
    return skills
end

--- The character's professions and their skill. Returns whether anything changed.
function Scan.skills()
    local skills
    if GetNumSkillLines and GetSkillLineInfo then
        skills = skillListProfessions()
    elseif GetProfessions and GetProfessionInfo then
        skills = spellbookProfessions()
    else
        return false
    end
    local changed, dropped = Core.setProfessions(Scan.current(), skills, ns.now())
    for _, name in ipairs(dropped) do
        Scan.say("%s was unlearned: dropped from what is saved. Type /ga-prof save to write it to the file (it reloads the screen).", name)
    end
    return changed
end

--- Whether this client tells which recipes a character knows without their windows open: WoW
--- Forever's does (its window lists recipes by spell, as Recipes.lua does, and IsPlayerSpell answers
--- for a recipe's spell with the window closed: tried against what the window recorded).
function Scan.knowsWithoutWindow()
    return ns.Recipes ~= nil and IsPlayerSpell ~= nil and C_TradeSkillUI ~= nil
        and C_TradeSkillUI.GetAllRecipeIDs ~= nil
end

--- Records the recipes this character knows of each of its professions, no window needed: each
--- recipe the game's tables have of it (Recipes.lua), asked of the game (IsPlayerSpell). Only ever
--- added, as a window's are (one the tables lack still comes from its window). Says what was new;
--- returns whether anything was.
function Scan.knownRecipes()
    if not Scan.knowsWithoutWindow() then return false end
    local character = Scan.current()
    local names = {}
    for name in pairs(character.professions) do names[#names + 1] = name end
    table.sort(names)
    local news = {}
    for _, name in ipairs(names) do
        local ids = ns.Recipes.professions[name]
        if ids then
            local recipes = Core.knownRecipes(ids, function(id) return IsPlayerSpell(id) == true end)
            local added = #recipes > 0 and Core.addRecipes(character, name, nil, nil, recipes, ns.now()) or 0
            if added > 0 then news[#news + 1] = ("%s (%d new)"):format(name, added) end
        end
    end
    if #news == 0 then return false end
    Scan.say("recorded your recipes without opening their windows: %s. Type /ga-prof save to write them to the file (it reloads the screen).",
        table.concat(news, ", "))
    return true
end

local announced = {}
local lastWindow -- the modern window last read: { name, list }

-- Records the window's recipes for `character`: replacing the profession's (`replace`, for a
-- window that lists them all) or adding to them. Returns whether anything changed.
local function record(character, professionName, rank, max, recipes, replace)
    if not character or not professionName or professionName == "UNKNOWN" or #recipes == 0 then
        return false
    end
    local changed
    if replace then
        changed = Core.setRecipes(character, professionName, rank, max, recipes, ns.now())
    else
        changed = Core.addRecipes(character, professionName, rank, max, recipes, ns.now()) > 0
    end
    local key = character.name .. "-" .. character.realm .. ":" .. professionName
    if changed and not announced[key] then
        announced[key] = true
        local count = 0
        for _ in pairs(character.professions[professionName].recipes) do count = count + 1 end
        local whose = character.source == "link" and (" of %s (from their link)"):format(character.name) or ""
        Scan.say("recorded %s%s: %d recipes. Type /ga-prof save to write it to the file (it reloads the screen).",
            professionName, whose, count)
    end
    return changed
end

-- Modern: whose the open window is: this character's, someone's linked one, or nil for a guild's
-- or an NPC's list.
local function modernOwner()
    local ui = C_TradeSkillUI
    for _, other in ipairs({ "IsTradeSkillGuild", "IsNPCCrafting" }) do
        if ui[other] and ui[other]() then return nil end
    end
    if ui.IsTradeSkillLinked then
        local isLinked, playerName = ui.IsTradeSkillLinked()
        if isLinked then return playerName and playerName ~= "" and linked(playerName) or nil end
    end
    return Scan.current()
end

-- Modern: the open window's profession and skill.
local function modernTradeSkill()
    local ui = C_TradeSkillUI
    if ui.GetBaseProfessionInfo then
        local info = ui.GetBaseProfessionInfo()
        if info and info.professionName and info.professionName ~= "" then
            return info.professionName, info.skillLevel, info.maxSkillLevel
        end
    end
    if ui.GetTradeSkillLine then
        local _, name, rank, max = ui.GetTradeSkillLine()
        return name, rank, max
    end
    return nil
end

-- Modern: the learned recipes of the open window; a recipe's id is its spell.
local function modernRecipes()
    local ui = C_TradeSkillUI
    local recipes = {}
    for _, id in ipairs(ui.GetAllRecipeIDs() or {}) do
        local info = ui.GetRecipeInfo and ui.GetRecipeInfo(id)
        if not info or info.learned then recipes[#recipes + 1] = { kind = "spell", id = id } end
    end
    return recipes
end

--- The open trade skill window's recipes (all categories opened first). Returns whether anything
--- changed.
function Scan.tradeSkills()
    if C_TradeSkillUI and C_TradeSkillUI.GetAllRecipeIDs then
        local character = modernOwner()
        if not character then return false end
        local name, rank, max = modernTradeSkill()
        local recipes = modernRecipes()
        -- Switching windows, the profession changes before its recipe list does: the previous
        -- profession's list under the new name isn't this profession's (Main also waits for the
        -- window to settle).
        local ids = {}
        for i, recipe in ipairs(recipes) do ids[i] = recipe.id end
        table.sort(ids)
        local list = table.concat(ids, ",")
        if lastWindow and lastWindow.list == list and lastWindow.name ~= name then return false end
        if name then lastWindow = { name = name, list = list } end
        return record(character, name, rank, max, recipes, true)
    end
    if not GetNumTradeSkills then return false end
    if ExpandTradeSkillSubClass then ExpandTradeSkillSubClass(0) end
    local name, rank, max = GetTradeSkillLine()
    local recipes = {}
    for i = 1, GetNumTradeSkills() do
        local _, kind = GetTradeSkillInfo(i)
        if kind ~= "header" and kind ~= "subheader" then
            local recipe = Core.recipeFromLink(GetTradeSkillRecipeLink and GetTradeSkillRecipeLink(i))
                or Core.recipeFromLink(GetTradeSkillItemLink and GetTradeSkillItemLink(i))
            if recipe then recipes[#recipes + 1] = recipe end
        end
    end
    return record(Scan.current(), name, rank, max, recipes)
end

--- The open craft window's recipes (Enchanting in Classic; Beast Training has no skill line).
--- Returns whether any were new.
function Scan.crafts()
    if not (GetNumCrafts and GetCraftDisplaySkillLine) then return false end
    local name, rank, max = GetCraftDisplaySkillLine()
    if not name then return false end
    local recipes = {}
    for i = 1, GetNumCrafts() do
        local _, _, kind = GetCraftInfo(i)
        if kind ~= "header" then
            local recipe = Core.recipeFromLink(GetCraftRecipeLink and GetCraftRecipeLink(i))
                or Core.recipeFromLink(GetCraftItemLink and GetCraftItemLink(i))
            if recipe then recipes[#recipes + 1] = recipe end
        end
    end
    return record(Scan.current(), name, rank, max, recipes)
end
