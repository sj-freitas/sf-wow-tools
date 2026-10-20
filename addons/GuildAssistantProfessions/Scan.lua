-- Guild Assistant Professions: reading the game. At login (and when skills change) the character's
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

function Scan.say(text, ...)
    print("|cff7c5cffGuild Assistant Professions|r: " .. text:format(...))
end

--- This character's saved entry.
function Scan.current()
    local _, class = UnitClass("player")
    return Core.character(ns.db, UnitName("player"), GetRealmName(), class, "own")
end

--- The saved entry of someone whose profession link is open ("Name" or "Name-Realm"). A link
--- carries the full name ("Shivan Nightpath" in WoW Forever) where UnitName gives the first one, so
--- a link to one's own profession is this character, not someone else.
local function linked(fullName)
    local name, realm = fullName:match("^([^-]+)-(.+)$")
    name, realm = name or fullName, realm or GetRealmName()
    local own = UnitName("player")
    if realm == GetRealmName() and (name == own or name:sub(1, #own + 1) == own .. " ") then
        ns.db.characters[name .. "-" .. realm] = nil -- recorded as someone else's before
        return Scan.current()
    end
    return Core.character(ns.db, name, realm, nil, "link")
end

--- Which of the game functions the scan can use this client has, kept in the saved data so a
--- client that reads nothing can be told apart from one that has no recipes yet.
function Scan.client()
    local found = {}
    for _, name in ipairs({ "GetNumSkillLines", "GetProfessions", "GetProfessionInfo",
        "GetNumTradeSkills", "GetNumCrafts" }) do
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
    return Core.setProfessions(Scan.current(), skills, time())
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
        changed = Core.setRecipes(character, professionName, rank, max, recipes, time())
    else
        changed = Core.addRecipes(character, professionName, rank, max, recipes, time()) > 0
    end
    local key = character.name .. "-" .. character.realm .. ":" .. professionName
    if changed and not announced[key] then
        announced[key] = true
        local count = 0
        for _ in pairs(character.professions[professionName].recipes) do count = count + 1 end
        local whose = character.source == "link" and (" of %s (from their link)"):format(character.name) or ""
        Scan.say("recorded %s%s: %d recipes. Type /ga-prof log to write it to the file.",
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
