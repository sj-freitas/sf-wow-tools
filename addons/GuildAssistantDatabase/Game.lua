-- GuildAssistant Database: what it asks the game. Your professions and skill (read live, both
-- clients' ways), which recipes you know (GuildAssistant Professions' record of this character, else
-- the game's IsPlayerSpell), zone names, item types, links and tooltips. Everything is checked
-- before it's called: WoW Forever's client and Classic Era's don't have the same functions.

local _, ns = ...
local Core = ns.Core
local Game = {}
ns.Game = Game

function Game.say(text, ...)
    print("|cff7c5cffGuildAssistant Database|r: " .. text:format(...))
end

-- Lua errors are hidden unless scriptErrors is on, which makes a failure look like the addon doing
-- nothing: they're said in the chat instead (each once, as some fire often).
local reported = {}
function ns.safely(fn, ...)
    local ok, err = pcall(fn, ...)
    if not ok and not reported[tostring(err)] then
        reported[tostring(err)] = true
        print("|cff7c5cffGuildAssistant Database|r: |cffff5050something went wrong:|r " .. tostring(err))
    end
    return ok
end

--- GuildAssistant Professions' saved data, when that addon is installed and loaded.
function Game.professionsDB()
    local db = rawget(_G, "GuildAssistantProfessionsDB")
    return type(db) == "table" and type(db.characters) == "table" and db or nil
end

--- This character as GuildAssistant Professions keys it ("Name-Realm").
function Game.playerKey()
    local first, last = UnitName("player")
    return Core.playerKey(first, last, GetRealmName and GetRealmName() or "")
end

-- The skill list's headers for professions (localized by the game; English when it has none).
local PROFESSION_HEADERS = {
    [TRADE_SKILLS or "Professions"] = true,
    [SECONDARY_SKILLS or "Secondary Skills"] = true,
    ["Professions"] = true,
    ["Secondary Skills"] = true,
}

--- This character's professions: { [name] = { rank, max } }, read from the game.
function Game.liveProfessions()
    local skills = {}
    if GetProfessions and GetProfessionInfo then
        for _, index in pairs({ GetProfessions() }) do
            local name, _, rank, max = GetProfessionInfo(index)
            if name then skills[name] = { rank = rank, max = max } end
        end
    elseif GetNumSkillLines and GetSkillLineInfo then
        local inProfessions = false
        for i = 1, GetNumSkillLines() do
            local name, isHeader, _, rank, _, _, max = GetSkillLineInfo(i)
            if isHeader then
                inProfessions = PROFESSION_HEADERS[name] == true
            elseif inProfessions and name then
                skills[name] = { rank = rank, max = max }
            end
        end
    end
    return skills
end

--- This character's professions that the data has recipes for, by name: { name, rank, max,
--- recorded (GuildAssistant Professions has its recipes), knows(recipe) }. Live from the game,
--- else what GuildAssistant Professions saved for this character.
function Game.myProfessions()
    local db = Game.professionsDB()
    local saved = db and db.characters[Game.playerKey()]
    local live = Game.liveProfessions()
    if next(live) == nil and saved then
        for name, profession in pairs(saved.professions or {}) do
            live[name] = { rank = profession.rank, max = profession.max }
        end
    end
    local mine = {}
    for name, skill in pairs(live) do
        local record = saved and saved.professions and saved.professions[name]
        local recorded = record ~= nil and next(record.recipes or {}) ~= nil
        mine[name] = {
            name = name, rank = skill.rank or 0, max = skill.max or 0, recorded = recorded,
            knows = function(recipe)
                if recorded then return Core.knows(record, recipe) end
                return IsPlayerSpell ~= nil and IsPlayerSpell(recipe.id) == true
            end,
        }
    end
    return mine
end

--- A zone's name from its id (the game's area id, as sources give it), or nil.
function Game.zoneName(id)
    if C_Map and C_Map.GetAreaInfo then
        local ok, name = pcall(C_Map.GetAreaInfo, id)
        if ok and type(name) == "string" and name ~= "" then return name end
    end
    return nil
end

--- The account's saved settings (GuildAssistantDatabaseDB): the minimap button's place, whether
--- unknown recipes are shown.
function Game.savedSettings()
    GuildAssistantDatabaseDB = type(GuildAssistantDatabaseDB) == "table" and GuildAssistantDatabaseDB or {}
    return GuildAssistantDatabaseDB
end

local providers
--- The sources: those in GuildAssistantDatabaseSources (the seed, Seed.lua, and any companion), and
--- what GuildAssistant Professions saw, as it was the first time they were asked for (what it sees
--- later shows after a /reload). A list, empty without any.
function Game.sourceProviders()
    if providers then return providers end
    providers = {}
    local list = rawget(_G, "GuildAssistantDatabaseSources")
    for _, provider in ipairs(type(list) == "table" and list or {}) do providers[#providers + 1] = provider end
    local professions = Core.professionsSources(Game.professionsDB())
    if professions then providers[#providers + 1] = professions end
    return providers
end

--- Whether a complete source is installed (the seed is): then recipes no source lists are hidden
--- unless asked for.
function Game.hidesUnvouched()
    local merged = Core.sources(Game.sourceProviders())
    return merged ~= nil and merged.complete
end

--- An item's name and quality: the data's, or, for one the game's tables lacked, what the game says
--- in play (asked for when it doesn't know yet, so it does next time).
function Game.itemName(item)
    if not item.missing then return item.name, item.quality end
    local info = (C_Item and C_Item.GetItemInfo) or GetItemInfo
    local name, _, quality = nil, nil, nil
    if info then name, _, quality = info(item.id) end
    if name then return name, quality or item.quality end
    if C_Item and C_Item.RequestLoadItemDataByID then C_Item.RequestLoadItemDataByID(item.id) end
    return item.name, item.quality
end

local QUALITY_HEX = { [0] = "ff9d9d9d", [1] = "ffffffff", [2] = "ff1eff00", [3] = "ff0070dd", [4] = "ffa335ee", [5] = "ffff8000" }
local SPELL_HEX = "ff71d5ff"

--- "ff1eff00": the colour of an item of this quality, as the game has it.
function Game.qualityHex(quality)
    local colors = ITEM_QUALITY_COLORS and ITEM_QUALITY_COLORS[quality]
    if colors and colors.hex then return (colors.hex:gsub("^|c", "")) end
    return QUALITY_HEX[quality] or QUALITY_HEX[1]
end

--- The recipe's name as shown: the item's colour when it makes one, the spell colour when not.
function Game.coloredName(recipe)
    local item = recipe.creates
    if not item then return ("|c%s%s|r"):format(SPELL_HEX, recipe.name) end
    local name, quality = Game.itemName(item)
    return ("|c%s%s|r"):format(Game.qualityHex(quality), name)
end

function Game.coloredItem(item)
    local name, quality = Game.itemName(item)
    return ("|c%s%s|r"):format(Game.qualityHex(quality), name)
end

--- What a tooltip shows for: the item, or the recipe's spell (an enchant).
function Game.hyperlink(recipe)
    if recipe.creates then return "item:" .. recipe.creates.id end
    return "spell:" .. recipe.id
end

--- A link to put in the chat: the game's own (it checks links sent in the chat), nil when the
--- game doesn't have the item yet (asked for, so it does next time). A recipe's is its crafting
--- spell's, as a profession window links it; an item's, the item's.
function Game.chatLink(itemOrRecipe, isRecipe)
    if isRecipe then
        local spellLink = (C_Spell and C_Spell.GetSpellLink) or GetSpellLink
        return spellLink and spellLink(itemOrRecipe.id) or nil
    end
    local id = itemOrRecipe.id
    local info = (C_Item and C_Item.GetItemInfo) or GetItemInfo
    local link = info and select(2, info(id))
    if not link and C_Item and C_Item.RequestLoadItemDataByID then C_Item.RequestLoadItemDataByID(id) end
    return link
end

--- Puts a link in the chat box being typed in (shift-click), as the game's own windows do.
function Game.insertLink(link)
    if not link then
        Game.say("the game doesn't have that item yet: shift-click it again in a moment.")
        return
    end
    if ChatEdit_InsertLink then ChatEdit_InsertLink(link) end
end

--- Tries the item on in the dressing room (ctrl-click), as the game's own windows do: the game
--- opens it only for what can be worn, not a potion or a bag.
function Game.dressUp(item)
    if DressUpItemLink then DressUpItemLink(Game.chatLink(item, false) or ("item:" .. item.id)) end
end

--- Who to whisper to reach someone who can craft a recipe (Core.crafters), nil for this character.
function Game.whisperTarget(crafter)
    return Core.whisperTarget(crafter, GetRealmName and GetRealmName() or nil)
end

--- Opens the chat box whispering `target`, as the game's own "Whisper" does. It takes the name
--- whole: WoW Forever's "Shivan Nightpath" too, which "/w" typed by hand would cut at the space.
function Game.whisper(target)
    if ChatFrame_SendTell then
        ChatFrame_SendTell(target)
    elseif ChatFrame_OpenChat then
        ChatFrame_OpenChat("/w " .. target .. " ")
    end
end

function Game.showTooltip(owner, hyperlink)
    if not GameTooltip then return end
    GameTooltip:SetOwner(owner, "ANCHOR_RIGHT")
    GameTooltip:SetHyperlink(hyperlink)
    GameTooltip:Show()
end

--- A tooltip of plain text: `title`, then each of `lines` in white.
function Game.showTextTooltip(owner, title, lines)
    if not GameTooltip then return end
    GameTooltip:SetOwner(owner, "ANCHOR_RIGHT")
    GameTooltip:AddLine(title)
    for _, line in ipairs(lines) do GameTooltip:AddLine(line, 1, 1, 1) end
    GameTooltip:Show()
end

function Game.hideTooltip()
    if GameTooltip then GameTooltip:Hide() end
end

--- The class's colour ("ffc69b6d"), white when unknown.
function Game.classHex(class)
    local color = class and RAID_CLASS_COLORS and RAID_CLASS_COLORS[class]
    if not color then return "ffffffff" end
    if color.colorStr then return color.colorStr end
    local function byte(value) return math.floor((value or 1) * 255 + 0.5) end
    return ("ff%02x%02x%02x"):format(byte(color.r), byte(color.g), byte(color.b))
end

--- Runs `fn` on the next frame (or now, without timers): spreads work so no frame takes long.
function Game.soon(fn, delay)
    if C_Timer and C_Timer.After then
        C_Timer.After(delay or 0, fn)
    else
        fn()
    end
end
