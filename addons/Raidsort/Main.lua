-- Raidsort: the slash command and the game events. The setup lives only while the game runs
-- (ns.setup, ns.setupText): nothing is saved between sessions.

local addonName, ns = ...
local Raid, UI = ns.Raid, ns.UI

local function needsSetup()
    if ns.setup then return false end
    Raid.say("Upload a raid setup first: /raidsort")
    UI.showUpload()
    return true
end

SLASH_RAIDSORT1 = "/raidsort"
SlashCmdList.RAIDSORT = function(message)
    local command = (message or ""):match("^%s*(%S*)"):lower()
    if command == "" then
        UI.toggleMain()
    elseif command == "upload" then
        UI.showUpload()
    elseif command == "sort" then
        if not needsSetup() then Raid.sort(ns.setup) end
    elseif command == "invite" then
        if not needsSetup() then Raid.invite(ns.setup) end
    elseif command == "auto" then
        if not needsSetup() then Raid.setAutoInvite(ns.setup, not Raid.autoInviting()) end
        UI.refresh()
    else
        Raid.say("Commands:")
        print("  /raidsort - open the Raid Sort window")
        print("  /raidsort upload - paste a raid setup")
        print("  /raidsort sort - sort the raid by the setup")
        print("  /raidsort invite - invite everyone in the setup")
        print("  /raidsort auto - Auto-Invite on or off: every minute from the invite time to the start")
    end
end

local events = CreateFrame("Frame")
events:RegisterEvent("ADDON_LOADED")
events:RegisterEvent("GROUP_ROSTER_UPDATE")
events:SetScript("OnEvent", function(self, event, arg)
    if event == "ADDON_LOADED" and arg == addonName then
        self:UnregisterEvent("ADDON_LOADED")
        Raid.say("Loaded. Type /raidsort to open it.")
    elseif event == "GROUP_ROSTER_UPDATE" then
        Raid.onRosterUpdate()
    end
end)
