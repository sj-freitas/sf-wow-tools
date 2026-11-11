-- GuildAssistant Professions: what the game shows of how recipes are obtained, recorded quietly for
-- GuildAssistant Database (Core.recordItemSource, Core.recordTrainer): the recipe items a vendor
-- sells (its window opens), those looted from a creature, an object or fishing, those a quest gives,
-- and what a profession trainer teaches and for how much. Nothing is said in the chat.

local _, ns = ...
local Core = ns.Core
local Sources = {}
ns.Sources = Sources

local RECIPE_CLASS = 9 -- the game's item class for recipes (plans, patterns, formulas…)

local function itemId(link)
    return type(link) == "string" and tonumber(link:match("item:(%d+)")) or nil
end

local function isRecipe(id)
    local instant = (C_Item and C_Item.GetItemInfoInstant) or GetItemInfoInstant
    if not id or not instant then return false end
    return select(6, instant(id)) == RECIPE_CLASS
end

local function zone()
    return GetRealZoneText and GetRealZoneText() or ""
end

-- Tells the guild about a new finding (Sync.lua), and says whether it was new.
local function shared(isNew, record)
    if isNew and ns.Sync and ns.Sync.sourceChanged then ns.Sync.sourceChanged(record) end
    return isNew
end

local function record(id, kind, who)
    return shared(Core.recordItemSource(ns.db, id, kind, zone(), who or "", ns.now()), Core.itemRecord(id))
end

--- A vendor's window: the recipe items it sells. Returns how many sources were new.
function Sources.merchant()
    if not (GetMerchantNumItems and GetMerchantItemLink) then return 0 end
    local vendor = UnitName("npc")
    if not vendor then return 0 end
    local new = 0
    for i = 1, GetMerchantNumItems() do
        local id = itemId(GetMerchantItemLink(i))
        if isRecipe(id) and record(id, "V", vendor) then new = new + 1 end
    end
    return new
end

--- A profession trainer's window: what it teaches (by the item a recipe makes, else its name) and
--- its cost. Class trainers are left alone. Returns how many were new.
function Sources.trainer()
    if not (GetNumTrainerServices and GetTrainerServiceInfo) then return 0 end
    if IsTradeskillTrainer and not IsTradeskillTrainer() then return 0 end
    local trainer = UnitName("npc")
    if not trainer then return 0 end
    local new = 0
    for i = 1, GetNumTrainerServices() do
        local name, _, category = GetTrainerServiceInfo(i)
        if name and name ~= "" and category ~= "header" then
            local id = itemId(GetTrainerServiceItemLink and GetTrainerServiceItemLink(i))
            local recipe = id and ("item:" .. id) or ("name:" .. name:lower())
            local cost = GetTrainerServiceCost and GetTrainerServiceCost(i) or 0
            local isNew = Core.recordTrainer(ns.db, recipe, cost, zone(), trainer, ns.now())
            if shared(isNew, Core.trainerRecord(recipe)) then new = new + 1 end
        end
    end
    return new
end

-- Who a loot slot came from: the creature targeted or under the mouse when it's the one looted.
local function lootedFrom(slot)
    local guid = GetLootSourceInfo and GetLootSourceInfo(slot)
    if type(guid) ~= "string" then return "D", "" end
    local kind = guid:match("^GameObject") and "O" or "D"
    for _, unit in ipairs({ "target", "mouseover" }) do
        if UnitGUID and UnitGUID(unit) == guid then return kind, UnitName(unit) or "" end
    end
    return kind, ""
end

--- A loot window: the recipe items in it, from a creature (drop), an object or fishing. Returns how
--- many sources were new.
function Sources.loot()
    if not (GetNumLootItems and GetLootSlotLink) then return 0 end
    local fishing = IsFishingLoot and IsFishingLoot()
    local new = 0
    for slot = 1, GetNumLootItems() do
        local id = itemId(GetLootSlotLink(slot))
        if isRecipe(id) then
            local kind, who = "F", ""
            if not fishing then kind, who = lootedFrom(slot) end
            if record(id, kind, who) then new = new + 1 end
        end
    end
    return new
end

--- A quest's rewards, as it is being completed: the recipe items among them. Returns how many
--- sources were new.
function Sources.questRewards()
    if not GetQuestItemLink then return 0 end
    local title = GetTitleText and GetTitleText() or ""
    local new = 0
    local counts = {
        choice = GetNumQuestChoices and GetNumQuestChoices() or 0,
        reward = GetNumQuestRewards and GetNumQuestRewards() or 0,
    }
    for kind, count in pairs(counts) do
        for i = 1, count do
            local id = itemId(GetQuestItemLink(kind, i))
            -- A quest is the same wherever it's handed in: no zone.
            local isNew = isRecipe(id) and Core.recordItemSource(ns.db, id, "Q", "", title, ns.now())
            if isNew and shared(isNew, Core.itemRecord(id)) then new = new + 1 end
        end
    end
    return new
end
