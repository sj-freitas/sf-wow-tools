-- Guild Assistant Professions: the slash command and the game events. Data is saved per account
-- (GuildAssistantProfessionsDB), with the export for Guild Assistant kept up to date in it: the game
-- writes it to the saved variables file on logout or /reload (/ga-prof log), and that file is what
-- gets uploaded. Addons can't write files themselves.

local addonName, ns = ...
local Core, Scan, Sync = ns.Core, ns.Scan, ns.Sync

-- Where the game writes the saved data, from the game's folder (the account folder's name can't be
-- known from inside the game).
local FILE = "WTF/Account/<account>/SavedVariables/" .. addonName .. ".lua"

-- Lua errors are hidden unless scriptErrors is on, which made a failure look like the addon doing
-- nothing: say them in the chat instead (each once, as some events fire often). Plain print, so it
-- works even if another of the addon's files failed to load.
local reported = {}
local function safely(fn, ...)
    local ok, err = pcall(fn, ...)
    if not ok and not reported[tostring(err)] then
        reported[tostring(err)] = true
        print("|cff7c5cffGuild Assistant Professions|r: |cffff5050something went wrong:|r " .. tostring(err))
    end
end

-- The saved data, made on first use: commands work even if ADDON_LOADED never reached us.
local function db()
    GuildAssistantProfessionsDB = GuildAssistantProfessionsDB or Core.newDB()
    ns.db = GuildAssistantProfessionsDB
    return ns.db
end

local function refreshExport()
    Core.refreshExport(db(), time())
end

-- This character's professions changed: the export, and the guild (quietly, Sync.lua).
local function ownChanged()
    refreshExport()
    Sync.ownChanged()
end
-- A guildmate's character arrived: it goes in the export too.
Sync.onReceived = function() refreshExport() end

local function when(seconds)
    return seconds and date("%Y-%m-%d %H:%M", seconds) or "never"
end

local function status()
    local data = Core.exportData(db())
    Scan.say("%s saved.", Core.describe(data))
    local last
    for _, character in ipairs(data.characters) do
        -- The guild's characters are counted in the sharing line, not listed one by one.
        if character.source ~= "guild" then
            local parts = {}
            for _, profession in ipairs(character.professions) do
                parts[#parts + 1] = ("%s %s (%d recipes)"):format(
                    profession.name, profession.skill or "?", #profession.spells + #profession.items)
            end
            print(("  %s-%s%s: %s. Updated %s."):format(character.name, character.realm,
                character.source == "link" and " (from a link)" or "",
                #parts > 0 and table.concat(parts, ", ") or "no professions", when(character.updated)))
            if character.updated and (not last or character.updated > last) then last = character.updated end
        end
    end
    print("  Last update: " .. when(last) .. ".")
    print("  " .. Sync.describe(db(), when))
    print("  File: " .. FILE .. " in the game's folder, written by /ga-prof log (or logging out).")
    print("  On Guild Assistant: Roster, Import professions, and drop it there.")
end

local function runCommand(message)
    local command = (message or ""):match("^%s*(%S*)"):lower()
    if command == "status" then
        status()
    elseif command == "log" then
        -- The game only writes saved variables on logout or a reload.
        refreshExport()
        ReloadUI()
    else
        Scan.say("commands:")
        print("  /ga-prof log - write what is recorded to the file (reloads the interface)")
        print("  /ga-prof status - what is saved, when it was last updated, and where the file is")
        print("  Open each profession's window (yours, or a profession link) and it is recorded.")
    end
end

SLASH_GAPROF1 = "/ga-prof"
SLASH_GAPROF2 = "/gaprof"
SlashCmdList.GAPROF = function(message) safely(runCommand, message) end

local function scanTradeSkills()
    if Scan.tradeSkills() then ownChanged() end
end

local pending = 0
local function scanSoon()
    if not (C_Timer and C_Timer.After) then return scanTradeSkills() end
    pending = pending + 1
    local this = pending
    C_Timer.After(0.5, function()
        if this == pending then safely(scanTradeSkills) end
    end)
end

local function onEvent(self, event, arg, ...)
    if event == "ADDON_LOADED" and arg == addonName then
        self:UnregisterEvent("ADDON_LOADED")
        -- What this client offers (not exported): to tell why a client records nothing.
        db().client = {
            build = GetBuildInfo and select(4, GetBuildInfo()),
            functions = Scan.client(),
            missingEvents = self.missing,
        }
        refreshExport()
        Sync.start()
        Scan.say("Loaded. Open your professions' windows (or someone's profession link) to record them.")
    elseif not ns.db then
        return
    elseif event == "PLAYER_LOGOUT" then
        refreshExport()
    elseif event == "CHAT_MSG_ADDON" then
        Sync.onMessage(arg, ...)
    elseif event == "PLAYER_LOGIN" or event == "SKILL_LINES_CHANGED" then
        if Scan.skills() then ownChanged() end
    elseif event:find("^TRADE_SKILL_") then
        -- Several fire while a window opens or switches profession: read once it has settled.
        scanSoon()
    elseif event == "CRAFT_SHOW" or event == "CRAFT_UPDATE" then
        if Scan.crafts() then ownChanged() end
    end
end

local events = CreateFrame("Frame")
events:SetScript("OnEvent", function(...) safely(onEvent, ...) end)
-- Newer clients raise an error for an event they don't have, which stopped this file before the
-- handler was set: register each one on its own and remember the ones that are missing. Classic
-- Era has TRADE_SKILL_UPDATE and the CRAFT_ ones; the modern client the TRADE_SKILL_LIST_ ones.
events.missing = {}
for _, event in ipairs({ "ADDON_LOADED", "PLAYER_LOGIN", "PLAYER_LOGOUT", "SKILL_LINES_CHANGED", "CHAT_MSG_ADDON",
    "TRADE_SKILL_SHOW", "TRADE_SKILL_UPDATE", "TRADE_SKILL_LIST_UPDATE",
    "TRADE_SKILL_DATA_SOURCE_CHANGED", "CRAFT_SHOW", "CRAFT_UPDATE" }) do
    if not pcall(events.RegisterEvent, events, event) then
        events.missing[#events.missing + 1] = event
    end
end
