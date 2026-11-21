-- GuildAssistant Professions: what a recipe item's tooltip says about the guild. A recipe that
-- doesn't bind when picked up can be handed on, and this addon knows who has which recipes and at
-- what skill, so the tooltip gets a line for the characters that already know it ("Know this
-- recipe") and one for those who could learn it ("Can use this recipe"). Nothing is said in the
-- chat; /ga-prof tooltip off stops it (Main.lua), and nothing else about the addon changes.
--
-- A recipe item's tooltip doesn't say which recipe it teaches, so it is worked out from the spell
-- the game says the item casts, matched against the profession's recipes (Recipes.lua), and from
-- names when a client gives no spell. Where none of that answers, no lines are added: better
-- nothing than the wrong names.

local _, ns = ...
local Core = ns.Core
local Tooltip = {}
ns.Tooltip = Tooltip

local RECIPE_CLASS = 9 -- the game's item class for recipes (plans, patterns, formulas…)

-- The lines, as the player reads them: what they already know in green, what they could learn in
-- cyan -- the gold it was first is what a tooltip's own lines (and other addons') are already full
-- of, so it didn't stand out, and on a near-black tooltip a light colour beats a deep one.
local KNOW, CAN_USE = "Know this recipe:", "Can use this recipe:"
-- And when the addon could tell which recipe it is but nobody wants it: said plainly, so "nobody"
-- is never mistaken for the addon not having looked. Named by the guild, which is whose answer it
-- mostly is (your own characters are in it too).
local NOBODY_TAIL = " can use this recipe."
local GREEN = { 0.1, 1, 0.1 }
local CYAN = { 0.3, 0.9, 1 }
local GREY = { 0.6, 0.6, 0.6 }

-- What each client calls the functions this needs.
local function itemInfoInstant(id)
    local fn = (C_Item and C_Item.GetItemInfoInstant) or GetItemInfoInstant
    if not fn then return nil end
    return fn(id)
end

local function itemSpell(id)
    local fn = (C_Item and C_Item.GetItemSpell) or GetItemSpell
    if not fn then return nil end
    return fn(id)
end

local function spellName(id)
    if C_Spell and C_Spell.GetSpellInfo then
        local info = C_Spell.GetSpellInfo(id)
        return info and info.name
    end
    return GetSpellInfo and (GetSpellInfo(id))
end

-- The game's "Requires …" lines as patterns, in whatever language the client is in: the skill the
-- recipe takes to learn ("Requires Blacksmithing (250)", ITEM_MIN_SKILL) and anything else it
-- requires ("Requires Armorsmith", ITEM_REQ_SKILL -- a specialization, for a recipe that needs one).
local patterns
local function requirements()
    if not patterns then
        local function pattern(template, fallback)
            return "^" .. (template or fallback):gsub("[%^%$%(%)%.%[%]%*%+%-%?%%]", "%%%0")
                :gsub("%%%%s", "(.+)"):gsub("%%%%d", "(%%d+)") .. "$"
        end
        patterns = {
            skill = pattern(ITEM_MIN_SKILL, "Requires %s (%d)"),
            other = pattern(ITEM_REQ_SKILL, "Requires %s"),
        }
    end
    return patterns
end

-- Each profession's recipes from Recipes.lua, by spell id, and (only when a client makes it
-- necessary) by the name the game gives the spell. Kept once read: a few hundred ids each.
local indexes = {}

local function index(profession)
    local ids = ns.Recipes and ns.Recipes.professions and ns.Recipes.professions[profession]
    if not ids then return nil end
    local found = indexes[profession]
    if not found then
        found = { ids = {} }
        for id in ids:gmatch("%d+") do found.ids[tonumber(id)] = true end
        indexes[profession] = found
    end
    return found
end

local function namedRecipes(found)
    if not found.named then
        found.named = {}
        for id in pairs(found.ids) do
            local name = spellName(id)
            if name then found.named[name:lower()] = id end
        end
    end
    return found.named
end

-- The profession's specializations by the name the game gives their spell ("Weaponsmith"), so a
-- "Requires Weaponsmith" line becomes the spell a character has to know for the plans to be of use.
local specializations = {}

local function specializationKey(profession, name)
    local ids = ns.Recipes and ns.Recipes.specializations and ns.Recipes.specializations[profession]
    if not (ids and name) then return nil end
    local known = specializations[profession]
    if not known then
        known = {}
        for id in ids:gmatch("%d+") do
            local spell = spellName(tonumber(id))
            if spell then known[spell:lower()] = "spell:" .. id end
        end
        specializations[profession] = known
    end
    return known[name:lower()]
end

--- Which recipe the item teaches, as this addon records recipes ("spell:9972"): the spell the game
--- says the item casts, when it is one of the profession's recipes, else the profession's recipe of
--- that name -- the spell's, or what the item's own name says after its kind ("Plans: Mithril
--- Spurs"). Nil when none of them answers.
function Tooltip.recipeKey(profession, id, itemName)
    local found = index(profession)
    if not found then return nil end
    local spell, spellId = itemSpell(id)
    if type(spellId) == "number" and found.ids[spellId] then return "spell:" .. spellId end
    local taught = type(spell) == "string" and namedRecipes(found)[spell:lower()]
    if not taught then
        local made = type(itemName) == "string" and itemName:match("^[^:]+:%s*(.+)$")
        taught = made and namedRecipes(found)[made:lower()]
    end
    return taught and ("spell:" .. taught) or nil
end

-- The item the tooltip is showing: what the client's own tooltip data says (the modern callback
-- gives it), else the link the tooltip holds. On WoW Forever a value can be secret while addons are
-- restricted -- it can be passed on but not read -- and then there is nothing to show.
local function secret(value)
    return issecretvalue and issecretvalue(value) == true
end

-- "Nobody in Dark Horizon can use this recipe." -- or, until the game says which guild this
-- character is in (at login it often hasn't) or when it is in none, who the addon knows.
local function nobody()
    local name = IsInGuild and IsInGuild() and GetGuildInfo and GetGuildInfo("player")
    if secret(name) or type(name) ~= "string" or name == "" then
        return "Nobody you know" .. NOBODY_TAIL
    end
    return "Nobody in " .. name .. NOBODY_TAIL
end

local function itemOf(tooltip, id)
    if not secret(id) and type(id) == "number" then return id end
    if not tooltip.GetItem then return nil end
    local _, link = tooltip:GetItem()
    if secret(link) or type(link) ~= "string" then return nil end
    return tonumber(link:match("item:(%d+)"))
end

--- The tooltip's lines, left side: `data`'s when the client's callback brought them, else the
--- tooltip's own text.
function Tooltip.lines(tooltip, data)
    local out = {}
    if type(data) == "table" and type(data.lines) == "table" then
        for _, line in ipairs(data.lines) do
            if type(line.leftText) == "string" then out[#out + 1] = line.leftText end
        end
        if #out > 0 then return out end
    end
    local name = tooltip.GetName and tooltip:GetName()
    for i = 1, (tooltip.NumLines and tooltip:NumLines() or 0) do
        local label = name and _G[name .. "TextLeft" .. i]
        local text = label and label.GetText and label:GetText()
        if type(text) == "string" then out[#out + 1] = text end
    end
    return out
end

--- What the tooltip's lines say about the recipe item: `bound` (it binds when picked up, so nobody
--- else can have it), `mine` (these lines are on it already, as the same tooltip's item can be set
--- more than once), the `profession` and `skill` to learn it, and whatever else it `requires`.
function Tooltip.read(lines)
    local found = { requires = {} }
    local matches = requirements()
    for i, text in ipairs(lines) do
        if i > 1 and (text:find(KNOW, 1, true) == 1 or text:find(CAN_USE, 1, true) == 1
            or text:find(NOBODY_TAIL, 1, true)) then
            found.mine = true
        elseif text == (ITEM_BIND_ON_PICKUP or "Binds when picked up")
            or text == (ITEM_SOULBOUND or "Soulbound") then
            found.bound = true
        else
            local profession, skill = text:match(matches.skill)
            if profession then
                found.profession, found.skill = profession, tonumber(skill)
            else
                local other = text:match(matches.other)
                if other then found.requires[#found.requires + 1] = other end
            end
        end
    end
    return found
end

--- Whether the lines are shown: on unless /ga-prof tooltip off turned them off (saved per account).
function Tooltip.enabled()
    return not (ns.db and ns.db.tooltip == false)
end

--- Turns them on or off for the account; returns whether they are on now.
function Tooltip.setEnabled(on)
    on = on == true
    if ns.db then ns.db.tooltip = on or false end
    return on
end

--- Adds the lines to a tooltip showing a recipe item, and says whether it did. `id` is the item
--- when the client's callback gives it, `data` its tooltip data; both nil on a client without them.
function Tooltip.show(tooltip, id, data)
    if not (Tooltip.enabled() and ns.db and tooltip and tooltip.AddLine) then return false end
    id = itemOf(tooltip, id)
    if not id or select(6, itemInfoInstant(id)) ~= RECIPE_CLASS then return false end
    local lines = Tooltip.lines(tooltip, data)
    local found = Tooltip.read(lines)
    if found.mine or found.bound then return false end
    -- What the tooltip says it takes, else the profession the item's own kind says (the game's
    -- subclass for a recipe) at no skill.
    local profession = found.profession or select(3, itemInfoInstant(id))
    local key = profession and Tooltip.recipeKey(profession, id, lines[1])
    if not key then return false end
    local specialization
    for _, name in ipairs(found.requires) do
        specialization = specialization or specializationKey(profession, name)
    end
    local interest = Core.recipeInterest(ns.db, {
        profession = profession, skill = found.skill or 0, key = key, specialization = specialization })
    local realm = Core.realmName(GetRealmName and GetRealmName())
    local know = Core.recipeNames(interest.know, realm)
    local canUse = Core.recipeNames(interest.canUse, realm)
    if know then tooltip:AddLine(KNOW .. " " .. know, GREEN[1], GREEN[2], GREEN[3], true) end
    if canUse then tooltip:AddLine(CAN_USE .. " " .. canUse, CYAN[1], CYAN[2], CYAN[3], true) end
    if not (know or canUse) then tooltip:AddLine(nobody(), GREY[1], GREY[2], GREY[3], true) end
    -- The tooltip is already up: it has to be told to make room for the lines.
    if tooltip.Show then tooltip:Show() end
    return true
end

--- Starts showing the lines, every way this client does tooltips: the modern callback, which covers
--- every tooltip at once, and the script of the two frames that show items, which older clients use.
--- Both where there are both -- which of them an item tooltip goes through differs between clients,
--- and whichever comes second finds the lines already there (Tooltip.read's `mine`). Returns how
--- many ways were hooked.
function Tooltip.start()
    if Tooltip.started then return 0 end
    local hooked = 0
    local processor = TooltipDataProcessor
    if processor and processor.AddTooltipPostCall and Enum and Enum.TooltipDataType
        and Enum.TooltipDataType.Item then
        local ok = pcall(processor.AddTooltipPostCall, Enum.TooltipDataType.Item, function(tooltip, data)
            ns.safely(Tooltip.show, tooltip, data and data.id, data)
        end)
        hooked = hooked + (ok and 1 or 0)
    end
    for _, frame in pairs({ game = GameTooltip, ref = ItemRefTooltip }) do
        -- A client that has done away with the script raises an error for its name.
        if frame.HookScript and pcall(frame.HookScript, frame, "OnTooltipSetItem",
            function(self) ns.safely(Tooltip.show, self) end) then
            hooked = hooked + 1
        end
    end
    Tooltip.started = hooked
    return hooked
end

-- Reading an item's tooltip without showing one: a tooltip of this addon's own, for the command
-- below (what the player hovers is the game's own, already written).
local scanner

function Tooltip.scan(link)
    if not scanner then
        if not CreateFrame then return {} end
        local ok, frame = pcall(CreateFrame, "GameTooltip", "GuildAssistantProfessionsScanner",
            UIParent, "GameTooltipTemplate")
        if not ok or not frame then return {} end
        scanner = frame
    end
    scanner:SetOwner(UIParent or scanner, "ANCHOR_NONE")
    scanner:ClearLines()
    scanner:SetHyperlink(link)
    local lines = Tooltip.lines(scanner)
    scanner:Hide()
    return lines
end

--- Says what this addon makes of a recipe item, step by step, through `say`: for
--- "/ga-prof tooltip <a recipe>" when the lines don't come and the reason is the game's answer
--- rather than the guild's data. `lines` is its tooltip (Tooltip.scan's, unless the caller has them).
function Tooltip.describe(link, say, lines)
    local id = type(link) == "string" and tonumber(link:match("item:(%d+)"))
    if not id then return say("that isn't an item: type /ga-prof tooltip and shift-click one.") end
    local name = link:match("%[(.-)%]") or ("item " .. id)
    say(("%s (item %d)."):format(name, id))
    local _, _, subType, _, _, class = itemInfoInstant(id)
    if class ~= RECIPE_CLASS then
        return say(("  The game calls it class %s, not a recipe (%d): no lines for it."):format(
            tostring(class), RECIPE_CLASS))
    end
    lines = lines or Tooltip.scan(link)
    local found = Tooltip.read(lines)
    say(("  A recipe, %s. Its tooltip: %d lines, %s%s."):format(tostring(subType), #lines,
        found.profession and ("%s (%s)"):format(found.profession, tostring(found.skill))
            or "no skill line",
        found.bound and ", binds when picked up -- nothing is said of those" or ""))
    local profession = found.profession or subType
    local spell, spellId = itemSpell(id)
    local listed = index(profession)
    say(("  The game's spell for it: %s (%s); %s"):format(tostring(spell), tostring(spellId),
        not listed and ("this addon has no recipes for " .. tostring(profession) .. ".")
            or (type(spellId) == "number" and listed.ids[spellId] and "one of its recipes." or "not one of its recipes.")))
    local key = Tooltip.recipeKey(profession, id, lines[1] or name)
    if not key then
        return say("  Which recipe it teaches: not known, so nothing is said of it.")
    end
    say("  The recipe it teaches: " .. key .. ".")
    local specialization
    for _, needed in ipairs(found.requires) do
        specialization = specialization or specializationKey(profession, needed)
    end
    if specialization then say("  It requires " .. specialization .. ".") end
    local interest = Core.recipeInterest(ns.db, { profession = profession, skill = found.skill or 0,
        key = key, specialization = specialization })
    local realm = Core.realmName(GetRealmName and GetRealmName())
    local have, highest = 0, 0
    for _, character in pairs(ns.db.characters) do
        local theirs = character.source ~= "link" and character.professions[profession]
        if theirs then
            have = have + 1
            highest = math.max(highest, theirs.rank or 0)
        end
    end
    say(("  %d character(s) have %s, the highest at %d."):format(have, profession, highest))
    say("  Know it: " .. (Core.recipeNames(interest.know, realm) or "nobody"))
    say("  Could learn it: " .. (Core.recipeNames(interest.canUse, realm) or "nobody"))
end
