-- Tests of GuildAssistantProfessions' Main.lua (the slash command and events) against a fake game,
-- outside WoW. Run with `npm test` in addons/ (or lua dev/GuildAssistantProfessions/main.spec.lua).

local realPrint = print -- the spec's own output; the addon's goes to the fake chat
local passed, failed = 0, 0
local function it(name, fn)
    local ok, err = pcall(fn)
    if ok then
        passed = passed + 1
    else
        failed = failed + 1
        realPrint("FAIL " .. name .. "\n     " .. tostring(err))
    end
end

local function eq(actual, expected, what)
    if actual ~= expected then
        error(("%s: expected %s, got %s"):format(what or "value", tostring(expected), tostring(actual)), 2)
    end
end

-- The game, just enough for Main.lua: one event frame, the slash commands and a chat to read.
local chat, frame
local function said(text)
    for _, line in ipairs(chat) do
        if line:find(text, 1, true) then return true end
    end
    return false
end

-- `unknownEvents`: events this client doesn't have; registering one raises an error, as newer
-- clients do.
local function loadAddon(unknownEvents)
    chat, frame = {}, nil
    _G.print = function(text) chat[#chat + 1] = tostring(text) end
    _G.SlashCmdList = {}
    _G.GuildAssistantProfessionsDB = nil
    _G.CreateFrame = function()
        frame = { events = {} }
        function frame:RegisterEvent(event)
            if unknownEvents and unknownEvents[event] then
                error('Attempt to register unknown event "' .. event .. '"')
            end
            self.events[event] = true
        end
        function frame:UnregisterEvent(event) self.events[event] = nil end
        function frame:SetScript(_, handler) self.onEvent = handler end
        return frame
    end
    _G.UnitClass = function() return "Mage", "MAGE" end
    _G.UnitName = function() return "Luna" end
    _G.GetRealmName = function() return "Wild Growth" end
    _G.time, _G.date = os.time, os.date -- the game's time() and date()
    _G.GetNumSkillLines = function() return 0 end
    _G.GetSkillLineInfo = function() end
    local ns = {}
    for _, file in ipairs({ "Core", "Scan", "Sync", "Main" }) do
        assert(loadfile("GuildAssistantProfessions/" .. file .. ".lua"))("GuildAssistantProfessions", ns)
    end
    return ns
end

local function fire(event, arg) frame.onEvent(frame, event, arg) end

it("says it's loaded, and only for its own ADDON_LOADED", function()
    loadAddon()
    fire("ADDON_LOADED", "Bagnon")
    eq(said("Loaded"), false, "loaded for another addon")
    fire("ADDON_LOADED", "GuildAssistantProfessions")
    eq(said("Guild Assistant Professions|r: Loaded."), true, "loaded message")
    eq(type(GuildAssistantProfessionsDB), "table", "saved data created")
end)

it("answers its slash commands", function()
    loadAddon()
    fire("ADDON_LOADED", "GuildAssistantProfessions")
    fire("PLAYER_LOGIN")
    SlashCmdList.GAPROF("")
    eq(said("/ga-prof status"), true, "lists the commands")
    eq(said("/ga-prof export"), false, "no export command: the file is the export")
    SlashCmdList.GAPROF("status")
    eq(said("1 character, 0 professions, 0 recipes saved."), true, "status")
    eq(said("Luna-Wild Growth: no professions. Updated never."), true, "status per character")
    eq(said("Last update: never."), true, "last update")
    eq(said("File: WTF/Account/<account>/SavedVariables/GuildAssistantProfessions.lua"), true, "file")
end)

it("keeps the export in the saved data up to date, and says when it was updated", function()
    loadAddon()
    _G.GetNumSkillLines = function() return 2 end
    _G.GetSkillLineInfo = function(i)
        if i == 1 then return "Professions", true end
        return "Tailoring", false, nil, 280, nil, nil, 300
    end
    fire("ADDON_LOADED", "GuildAssistantProfessions")
    local db = GuildAssistantProfessionsDB
    eq(db.export, '{"addon":"GuildAssistantProfessions","characters":[],"format":2}', "export at load")
    fire("PLAYER_LOGIN")
    assert(db.export:find('"name":"Tailoring"', 1, true), "export after a change: " .. db.export)
    SlashCmdList.GAPROF("status")
    eq(said("Last update: " .. os.date("%Y-%m-%d %H:%M", db.characters["Luna-Wild Growth"].updated)), true,
        "last update")
    db.export = nil
    fire("PLAYER_LOGOUT")
    assert(db.export, "export at logout")
end)

it("reports an error in the chat, once, instead of failing silently", function()
    loadAddon()
    fire("ADDON_LOADED", "GuildAssistantProfessions")
    _G.GetNumSkillLines = function() error("broken") end
    fire("SKILL_LINES_CHANGED")
    fire("SKILL_LINES_CHANGED")
    local errors = 0
    for _, line in ipairs(chat) do
        if line:find("something went wrong", 1, true) then errors = errors + 1 end
    end
    eq(errors, 1, "error lines")
end)

it("works on a client that lacks some events, and saves which", function()
    -- WoW Forever's client: no TRADE_SKILL_UPDATE (seen in its General.log) nor CRAFT_ events.
    loadAddon({ TRADE_SKILL_UPDATE = true, CRAFT_SHOW = true, CRAFT_UPDATE = true })
    eq(frame.events.TRADE_SKILL_LIST_UPDATE, true, "the other events are still registered")
    fire("ADDON_LOADED", "GuildAssistantProfessions")
    eq(said("Loaded."), true, "loaded message")
    eq(said("something went wrong"), false, "no error")
    local client = GuildAssistantProfessionsDB.client
    eq(table.concat(client.missingEvents, ","), "TRADE_SKILL_UPDATE,CRAFT_SHOW,CRAFT_UPDATE", "missing events")
    eq(client.functions[1], "GetNumSkillLines", "functions found")
    SlashCmdList.GAPROF("status")
    eq(said("1 character, 0 professions, 0 recipes saved."), false, "no login yet, so no character")
    eq(said("0 characters, 0 professions, 0 recipes saved."), true, "status")
end)

it("answers commands even if ADDON_LOADED never arrived", function()
    loadAddon()
    SlashCmdList.GAPROF("status")
    eq(said("something went wrong"), false, "no error")
    eq(said("0 characters, 0 professions, 0 recipes saved."), true, "status")
end)

it("drops an unlearned profession from the export, and says so", function()
    loadAddon()
    local skills = { { "Professions", true }, { "Tailoring", false, 280, 300 }, { "Mining", false, 200, 300 } }
    _G.GetNumSkillLines = function() return #skills end
    _G.GetSkillLineInfo = function(i)
        local s = skills[i]
        if s[2] then return s[1], true end
        return s[1], false, nil, s[3], nil, nil, s[4]
    end
    fire("ADDON_LOADED", "GuildAssistantProfessions")
    fire("PLAYER_LOGIN")
    local db = GuildAssistantProfessionsDB
    assert(db.export:find('"name":"Mining"', 1, true), "Mining recorded")
    table.remove(skills, 3) -- Mining unlearned
    fire("SKILL_LINES_CHANGED")
    eq(said("Mining was unlearned: dropped from what is saved."), true, "says so")
    assert(not db.export:find('"name":"Mining"', 1, true), "gone from the export: " .. db.export)
    assert(db.export:find('"name":"Tailoring"', 1, true), "the rest kept")
end)

it("/ga-prof log writes the file: the export, then a reload", function()
    loadAddon()
    fire("ADDON_LOADED", "GuildAssistantProfessions")
    local exportAtReload
    _G.ReloadUI = function() exportAtReload = GuildAssistantProfessionsDB.export end
    GuildAssistantProfessionsDB.export = nil
    SlashCmdList.GAPROF("log")
    assert(exportAtReload, "export refreshed before reloading")
end)

it("reads a profession window once it has settled", function()
    loadAddon()
    local timers, scans = {}, 0
    _G.C_Timer = { After = function(_, fn) timers[#timers + 1] = fn end }
    _G.C_TradeSkillUI = { GetAllRecipeIDs = function() scans = scans + 1; return {} end }
    fire("ADDON_LOADED", "GuildAssistantProfessions")
    fire("TRADE_SKILL_SHOW")
    fire("TRADE_SKILL_LIST_UPDATE")
    fire("TRADE_SKILL_DATA_SOURCE_CHANGED")
    eq(scans, 0, "not while events keep coming")
    for _, fn in ipairs(timers) do fn() end
    eq(scans, 1, "once, after the last")
    _G.C_Timer, _G.C_TradeSkillUI = nil, nil
end)

_G.print = realPrint
print(("%d passed, %d failed"):format(passed, failed))
if failed > 0 then error(failed .. " failed") end
