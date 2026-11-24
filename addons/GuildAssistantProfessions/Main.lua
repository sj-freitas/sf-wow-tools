-- GuildAssistant Professions: the slash command and the game events. Data is saved per account
-- (GuildAssistantProfessionsDB), with the export for Guild Assistant kept up to date in it: the game
-- writes it to the saved variables file on logout or /reload (/ga-prof save), and that file is what
-- gets uploaded. Addons can't write files themselves.

local addonName, ns = ...
local Core, Scan, Sync, Sources = ns.Core, ns.Scan, ns.Sync, ns.Sources
local Attunements, Tooltip = ns.Attunements, ns.Tooltip

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
        print("|cff7c5cffGuildAssistant Professions|r: |cffff5050something went wrong:|r " .. tostring(err))
    end
end
-- The files that hook the game themselves report through it too (Tooltip.lua).
ns.safely = safely

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
-- A guildmate's character arrived: it goes in the export too, and anything too old to keep goes
-- (Core.prune). At most once every EXPORT_DELAY seconds: rebuilding the export goes through every
-- character, and a login can bring in hundreds of them, one after the other.
local EXPORT_DELAY = 10
local exportSoon = false
local function refreshExportSoon()
    if not (C_Timer and C_Timer.After) then
        Core.prune(db(), ns.now())
        return refreshExport()
    end
    if exportSoon then return end
    exportSoon = true
    C_Timer.After(EXPORT_DELAY, function()
        exportSoon = false
        safely(function()
            Core.prune(db(), ns.now())
            refreshExport()
        end)
    end)
end
Sync.onReceived = refreshExportSoon
Sync.onOwnRestamped = refreshExportSoon

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
    print("  Attunements: " .. Core.describeAttunements(db()) .. ".")
    print("  Seen for GuildAssistant Database: " .. Core.describeSources(db()) .. ".")
    print("  Recipe tooltips: " .. (Tooltip.enabled() and "on" or "off") .. ".")
    print("  File: " .. FILE .. " in the game's folder, written by /ga-prof save (or logging out).")
    print("  On Guild Assistant: Roster, Import professions, and drop it there.")
end

-- "/ga-prof tooltip on|off": whether a recipe item's tooltip says who knows that recipe and who
-- could learn it (Tooltip.lua). Without a word of its own it only says which it is, and with a
-- recipe shift-clicked after it, what the addon makes of that one (when its tooltip says nothing
-- and it isn't clear why).
local function tooltips(argument, rest)
    if rest and rest:find("Hitem:", 1, true) then
        local first = true
        return Tooltip.describe(rest, function(text)
            if first then
                first = false
                return Scan.say("%s", text)
            end
            print(text)
        end)
    end
    if argument ~= "" and argument ~= "on" and argument ~= "off" then
        return Scan.say("tooltip on, tooltip off, or tooltip and shift-click a recipe to see what I make of it.")
    end
    if argument ~= "" then
        db() -- it is saved there, and the commands work even without ADDON_LOADED
        Tooltip.setEnabled(argument == "on")
    end
    Scan.say("recipe tooltips are %s%s.", Tooltip.enabled() and "on" or "off",
        argument == "" and " (/ga-prof tooltip on, /ga-prof tooltip off)" or "")
end

local function runCommand(message)
    local first, second = (message or ""):match("^%s*(%S*)%s*(%S*)")
    local command, argument = first:lower(), second:lower()
    if command == "status" then
        status()
    elseif command == "tooltip" then
        tooltips(argument, (message or ""):match("^%s*%S*%s*(.-)%s*$"))
    elseif command == "save" or command == "log" then -- "log": its name before 1.0.1, still works
        -- The game only writes saved variables on logout or a reload.
        refreshExport()
        ReloadUI()
    else
        Scan.say("commands:")
        print("  /ga-prof save - write what is recorded to the file (reloads the screen)")
        print("  /ga-prof status - what is saved, when it was last updated, and where the file is")
        print("  /ga-prof tooltip on|off - say in a recipe's tooltip who knows it and who could learn it")
        if Scan.knowsWithoutWindow() then
            print("  Your recipes are recorded as you log in and learn them; open someone's profession link to record theirs.")
        else
            print("  Open each profession's window (yours, or a profession link) and it is recorded.")
        end
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

-- What this character has, asked of the game, no window needed: its professions and their skill
-- (Scan.skills), and the recipes it knows of each (Scan.knownRecipes, on a client that answers for
-- them). The two together: a profession is learned as a spell is, and its recipes can only be read
-- once the profession itself is recorded.
local function check()
    local changed = Scan.skills()
    if Scan.knownRecipes() then changed = true end
    if changed then ownChanged() end
end

-- A moment after the last of a burst of events (logging in, a skill-up, a profession or a rank of
-- recipes learned), once: a rank trains many spells at a time, each with an event of its own.
local BURST_DELAY = 2
local checkPending = 0
local function checkSoon()
    if not (C_Timer and C_Timer.After) then return check() end
    checkPending = checkPending + 1
    local this = checkPending
    C_Timer.After(BURST_DELAY, function()
        if this == checkPending then safely(check) end
    end)
end

-- Logging in: the game hasn't the professions ready when PLAYER_LOGIN fires (GetProfessions
-- answers with nothing until the spellbook has arrived), and on a client whose skill list addons
-- can't read (WoW Forever's) nothing said so afterwards, so a character whose profession windows
-- were never opened kept none of them. It is asked again, a few seconds apart, until it has them;
-- a character that really has none stops after the last try.
local LOGIN_TRIES = { 2, 5, 10, 20, 40 }
local function checkAfterLogin(try)
    local wait = LOGIN_TRIES[try]
    if not wait or not (C_Timer and C_Timer.After) then return end
    C_Timer.After(wait, function()
        safely(function()
            if Scan.hasProfessions() then return end
            checkSoon() -- through the same debounce: the login's own burst asks the game once
            checkAfterLogin(try + 1)
        end)
    end)
end

-- Which raids this character is attuned to, asked of the game (Attunements.lua): at login, on
-- entering the world, as the quest log arrives and after handing in a quest. A change goes in the
-- export and to the guild.
local ATTUNEMENTS_DELAY = 10 -- seconds after login: by then the game has sent the quests
local function checkAttunements()
    if Attunements.scan() then
        -- The character too: one whose professions were never recorded is only shared once
        -- something about it was, and the attunement is something (Core.setAttunements stamps it).
        ownChanged()
        Sync.attunementsChanged()
    end
end

--- And once more a little later. The quests this character has completed reach the client after the
--- login events on some of them, and QUEST_LOG_UPDATE (which says they have) isn't on every client.
local function checkAttunementsSoon()
    if not (C_Timer and C_Timer.After) then return end
    C_Timer.After(ATTUNEMENTS_DELAY, function() safely(checkAttunements) end)
end

local function onEvent(self, event, arg, ...)
    if event == "ADDON_LOADED" and arg == addonName then
        self:UnregisterEvent("ADDON_LOADED")
        Core.migrate(db())
        Core.prune(db(), ns.now())
        -- What this client offers (not exported): to tell why a client records nothing.
        db().client = {
            build = GetBuildInfo and select(4, GetBuildInfo()),
            functions = Scan.client(),
            missingEvents = self.missing,
        }
        refreshExport()
        Sync.start()
        Tooltip.start()
        if Scan.knowsWithoutWindow() then
            Scan.say("Loaded.") -- your recipes are recorded quietly, nothing to do
        else
            Scan.say("Loaded. Open your professions' windows (or someone's profession link) to record them.")
        end
    elseif not ns.db then
        return
    elseif event == "PLAYER_LOGOUT" then
        refreshExport()
    elseif event == "CHAT_MSG_ADDON" then
        Sync.onMessage(arg, ...)
    elseif event == "PLAYER_LOGIN" then
        -- The character is in the saved data from login (and one saved under its first name alone
        -- is renamed), whether or not the game has anything to say about it yet. What it has is
        -- read a moment later, and again until the game has it: nothing to open, nothing to type.
        Scan.current()
        checkSoon()
        checkAfterLogin(1)
        checkAttunements()
        checkAttunementsSoon()
    elseif event == "PLAYER_ENTERING_WORLD" or event == "QUEST_TURNED_IN"
        or event == "QUEST_LOG_UPDATE" then
        checkAttunements()
    elseif event == "SKILL_LINES_CHANGED" or event == "NEW_RECIPE_LEARNED"
        or event == "LEARNED_SPELL_IN_TAB" or event == "SPELLS_CHANGED" then
        -- A profession trained, a recipe learned, a skill-up: both are read again. Which of these
        -- a client has differs (LEARNED_SPELL_IN_TAB isn't on WoW Forever's), hence all of them.
        checkSoon()
    elseif event:find("^TRADE_SKILL_") then
        -- Several fire while a window opens or switches profession: read once it has settled.
        scanSoon()
    elseif event == "CRAFT_SHOW" or event == "CRAFT_UPDATE" then
        if Scan.crafts() then ownChanged() end
    elseif event == "MERCHANT_SHOW" or event == "MERCHANT_UPDATE" then
        Sources.merchant()
    elseif event == "TRAINER_SHOW" or event == "TRAINER_UPDATE" then
        Sources.trainer()
    elseif event == "LOOT_OPENED" then
        Sources.loot()
    elseif event == "QUEST_COMPLETE" then
        Sources.questRewards()
    end
end

local events = CreateFrame("Frame")
events:SetScript("OnEvent", function(...) safely(onEvent, ...) end)
-- Newer clients raise an error for an event they don't have, which stopped this file before the
-- handler was set: register each one on its own and remember the ones that are missing. Classic
-- Era has TRADE_SKILL_UPDATE and the CRAFT_ ones; the modern client the TRADE_SKILL_LIST_ ones.
events.missing = {}
for _, event in ipairs({ "ADDON_LOADED", "PLAYER_LOGIN", "PLAYER_LOGOUT", "SKILL_LINES_CHANGED", "CHAT_MSG_ADDON",
    -- A recipe learned (the modern client's event, Classic Era's, and either's spells changing).
    "NEW_RECIPE_LEARNED", "LEARNED_SPELL_IN_TAB", "SPELLS_CHANGED",
    -- The raids this character is attuned to (Attunements.lua). QUEST_LOG_UPDATE is how the game
    -- says this character's quests have reached the client, which login is too early for.
    "PLAYER_ENTERING_WORLD", "QUEST_TURNED_IN", "QUEST_LOG_UPDATE",
    "TRADE_SKILL_SHOW", "TRADE_SKILL_UPDATE", "TRADE_SKILL_LIST_UPDATE",
    "TRADE_SKILL_DATA_SOURCE_CHANGED", "CRAFT_SHOW", "CRAFT_UPDATE",
    -- How recipes are obtained, for GuildAssistant Database (Sources.lua).
    "MERCHANT_SHOW", "MERCHANT_UPDATE", "TRAINER_SHOW", "TRAINER_UPDATE", "LOOT_OPENED", "QUEST_COMPLETE" }) do
    if not pcall(events.RegisterEvent, events, event) then
        events.missing[#events.missing + 1] = event
    end
end
