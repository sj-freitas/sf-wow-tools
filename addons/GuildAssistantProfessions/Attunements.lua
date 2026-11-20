-- GuildAssistant Professions: which raids this character is attuned to. An attunement is a quest
-- the game says is complete or not, one per faction (Core.ATTUNEMENTS); what it says is recorded
-- with the character, shared with the guild (Sync.lua) and exported for Guild Assistant, so
-- GuildAssistant Database can show who can walk in. Read at login, on entering the world and after
-- a quest is handed in -- a quest already complete never uncompletes, so what is recorded only ever
-- gains, and reading too early (before the game has the quest log) costs nothing.
-- Nothing is said in the chat.

local _, ns = ...
local Core = ns.Core
local Attunements = {}
ns.Attunements = Attunements

--- How this client answers whether a quest is complete: WoW Forever's (any modern client's)
--- C_QuestLog.IsQuestFlaggedCompleted, else Classic Era's global of the same name. Nil when it has
--- neither, and nothing is recorded.
function Attunements.completed()
    if C_QuestLog and C_QuestLog.IsQuestFlaggedCompleted then
        return C_QuestLog.IsQuestFlaggedCompleted
    end
    return IsQuestFlaggedCompleted
end

--- This character's faction as the attunements name it ("Alliance", "Horde"), or nil when the game
--- says something else ("Neutral"): then every faction's quest is asked about.
function Attunements.faction()
    local faction = UnitFactionGroup and UnitFactionGroup("player")
    for _, name in ipairs(Core.FACTIONS) do
        if faction == name then return name end
    end
    return nil
end

--- Asks the game about each raid's attunement for this character and records what it says. Returns
--- whether anything changed.
function Attunements.scan()
    local completed = Attunements.completed()
    if not completed or not ns.Scan then return false end
    local faction = Attunements.faction()
    local states = {}
    for _, attunement in ipairs(Core.ATTUNEMENTS) do
        local quests = Core.attunementQuests(attunement, faction)
        if #quests > 0 then
            local attuned = false
            for _, id in ipairs(quests) do
                if completed(id) == true then attuned = true end
            end
            states[attunement.key] = attuned
        end
    end
    if not next(states) then return false end
    return Core.setAttunements(ns.Scan.current(), states, ns.now())
end
