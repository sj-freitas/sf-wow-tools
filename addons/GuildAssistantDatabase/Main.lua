-- GuildAssistant Database: the slash command and the game events. Nothing is saved: the data is
-- the addon's own (Data.lua), and who knows what comes from GuildAssistant Professions' saved data
-- when that addon is installed.

local addonName, ns = ...
local Core, Game, UI = ns.Core, ns.Game, ns.UI

local function runCommand(message)
    local text = (message or ""):match("^%s*(.-)%s*$")
    local command = text:lower()
    if command == "help" or command == "?" then
        Game.say("commands:")
        print("  /gadb - open or close the window")
        print("  /gadb <words> - open it searching for them (a name, a stat, a slot, a reagent)")
        return
    end
    if text == "" then UI.toggle() else UI.show(text) end
end

SLASH_GADB1 = "/gadb"
SLASH_GADB2 = "/ga-db"
SlashCmdList.GADB = function(message) ns.safely(runCommand, message) end

local function onEvent(self, event, arg)
    if event == "ADDON_LOADED" and arg == addonName then
        self:UnregisterEvent("ADDON_LOADED")
        local data = ns.Data
        if not data or not data.professions or #data.professions == 0 then
            Game.say("no recipe data in this copy of the addon (Data.lua).")
            return
        end
        Game.say("%s from Wowhead, %s. Type /gadb to search them.", Core.describe(data), data.fetched or "?")
    end
end

local events = CreateFrame("Frame")
events:SetScript("OnEvent", function(...) ns.safely(onEvent, ...) end)
events:RegisterEvent("ADDON_LOADED")
