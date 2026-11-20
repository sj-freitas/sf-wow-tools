-- GuildAssistant Professions: which raids this character is attuned to. An attunement is a quest
-- the game says is complete or not, one per faction (Core.ATTUNEMENTS); what it says is recorded
-- with the character, shared with the guild (Sync.lua) and exported for Guild Assistant, so
-- GuildAssistant Database can show who can walk in. Read at login, on entering the world, when the
-- quest log arrives and after a quest is handed in -- a quest already complete never uncompletes,
-- so what is recorded only ever gains, and reading again costs nothing. What the game hasn't sent
-- the client yet is not an answer: see Attunements.ready.
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

-- Whether the game has sent this character's completed quests, once it has (it never takes them
-- back, so the answer is kept).
local loaded = false

--- Whether the game can be believed when it says a quest isn't complete. A client is sent the
--- quests it has completed as it logs in, and until they arrive it says "not complete" about every
--- one of them -- read then, a character who is attuned is recorded as not attuned, and that is
--- what the guild and the website are told. A modern client can be asked for the whole list
--- (C_QuestLog.GetAllCompletedQuestIDs), and an empty one means it hasn't arrived yet; a client
--- without that function is taken at its word, as it was before.
function Attunements.ready()
    if loaded then return true end
    local all = C_QuestLog and C_QuestLog.GetAllCompletedQuestIDs
    if not all then return true end
    local ids = all()
    loaded = type(ids) == "table" and #ids > 0
    return loaded
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
            -- A yes is always right: the quest is complete, and it never uncompletes. A no is only
            -- recorded once the game has this character's quests, so "not attuned" is never
            -- written about a character the client simply hasn't been told about yet; it stays
            -- "nobody has looked" until the next read, a moment later.
            if attuned then
                states[attunement.key] = true
            elseif Attunements.ready() then
                states[attunement.key] = false
            end
        end
    end
    if not next(states) then return false end
    return Core.setAttunements(ns.Scan.current(), states, ns.now())
end
