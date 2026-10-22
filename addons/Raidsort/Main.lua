-- Raidsort: the slash command and the game events. The setup lives only while the game runs
-- (ns.setup, ns.setupText): nothing is saved between sessions.

local addonName, ns = ...
local Raid, UI = ns.Raid, ns.UI

local function needsSetup()
    if ns.setup then return false end
    Raid.say("Upload a raid setup first: /ga-rs")
    UI.showUpload()
    return true
end

-- Under Guild Assistant's prefix since 2.2.0 (it was /raidsort, which no longer works).
SLASH_RAIDSORT1 = "/ga-rs"
SLASH_RAIDSORT2 = "/garaidsort"
SLASH_RAIDSORT3 = "/ga-raidsort"
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
        print("  /ga-rs - open the GuildAssistant RaidSort window")
        print("  /ga-rs upload - paste a raid setup")
        print("  /ga-rs sort - sort the raid by the setup")
        print("  /ga-rs invite - invite everyone in the setup")
        print("  /ga-rs auto - Auto-Invite on or off: every minute from the invite time to the start")
    end
end

local events = CreateFrame("Frame")
events:RegisterEvent("ADDON_LOADED")
events:RegisterEvent("GROUP_ROSTER_UPDATE")
events:SetScript("OnEvent", function(self, event, arg)
    if event == "ADDON_LOADED" and arg == addonName then
        self:UnregisterEvent("ADDON_LOADED")
        Raid.say("Loaded. Type /ga-rs to open it.")
    elseif event == "GROUP_ROSTER_UPDATE" then
        Raid.onRosterUpdate()
    end
end)
