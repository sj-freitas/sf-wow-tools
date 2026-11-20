-- Tests of GuildAssistantDatabase's window (UI.lua), slash command (Main.lua) and game calls
-- (Game.lua) against a fake game, outside WoW, on Data.fixture.lua. The fake has only the methods
-- the addon uses: calling any other is an error here, so a typo or a method the game lacks shows up.
-- Run with `npm test` in addons/ (or lua dev/GuildAssistantDatabase/ui.spec.lua).

local specPrint = print
local passed, failed = 0, 0
local chat, linked, timers, created, dressed, told, opened, bags
local function it(name, fn)
    local ok, err = pcall(fn)
    _G.print = specPrint
    for _, line in ipairs(chat or {}) do
        if line:find("something went wrong", 1, true) then ok, err = false, tostring(err or "") .. "\n     " .. line end
    end
    if ok then
        passed = passed + 1
    else
        failed = failed + 1
        specPrint("FAIL " .. name .. "\n     " .. tostring(err))
    end
end

local function eq(actual, expected, what)
    if actual ~= expected then
        error(("%s: expected %s, got %s"):format(what or "value", tostring(expected), tostring(actual)), 2)
    end
end

local function has(text, part, what)
    if not tostring(text):find(part, 1, true) then
        error(("%s: %q not in %q"):format(what or "text", part, tostring(text)), 2)
    end
end

-- The fake game -----------------------------------------------------------------------------------

local Region = {}
Region.__index = function(_, key)
    local method = Region[key]
    if method then return method end
    if type(key) == "string" and key:match("^[A-Z]") and not key:match("Text$") then
        error("the fake game has no method " .. key, 2)
    end
    return nil
end

local function region(kind, parent)
    -- The fake's own fields start with "_": the addon puts its own on frames (button.text…).
    return setmetatable({ _kind = kind, _parent = parent, _shown = true, _text = "", _scripts = {}, _checked = false }, Region)
end

local function noop() end
for _, name in ipairs({ "SetPoint", "SetFrameStrata", "SetToplevel", "SetClampedToScreen", "EnableMouse",
    "SetMovable", "RegisterForDrag", "StartMoving", "StopMovingOrSizing", "SetWidth", "EnableMouseWheel",
    "ClearAllPoints", "SetAllPoints", "SetAutoFocus", "SetNumeric", "SetMaxLetters", "SetHighlightTexture",
    "SetOrientation", "SetThumbTexture", "SetValueStep", "SetObeyStepOnDrag", "SetJustifyH", "SetWordWrap",
    "SetSpacing", "SetColorTexture", "SetBlendMode", "UnregisterEvent", "SetTextInsets", "SetAlpha",
    "SetFrameLevel", "RegisterForClicks" }) do
    Region[name] = noop
end
-- Only where a frame was last put matters to the specs (the minimap button's place).
local setPoint = Region.SetPoint
function Region:SetPoint(...) self._point = { ... }; return setPoint(self, ...) end
function Region:GetWidth() return self._width or 140 end
-- The height it was given (the Filter panel's grows with what it shows).
function Region:SetHeight(height) self._height = height end
function Region:SetSize(_, height) self._height = height end
function Region:GetHeight() return self._height or 0 end
function Region:GetCenter() return 1000, 500 end
function Region:GetEffectiveScale() return 1 end
function Region:RegisterEvent(event) self._events = self._events or {}; self._events[event] = true end
function Region:SetScript(name, fn) self._scripts[name] = fn end
function Region:GetScript(name) return self._scripts[name] end
function Region:Fire(name, ...) if self._scripts[name] then return self._scripts[name](self, ...) end end
function Region:Show()
    if not self._shown then
        self._shown = true
        self:Fire("OnShow")
    end
end
function Region:Hide()
    if self._shown then
        self._shown = false
        self:Fire("OnHide")
    end
end
function Region:IsShown() return self._shown end
function Region:SetShown(shown) if shown then self:Show() else self:Hide() end end
function Region:SetText(text)
    self._text = text or ""
    if self._kind == "EditBox" then self:Fire("OnTextChanged", false) end
end
function Region:GetText() return self._text end
-- 6 pixels a letter, colour codes left out.
function Region:GetStringWidth() return #self._text:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "") * 6 end
function Region:SetTexture(texture) self._texture = texture end
-- A chevron's: which way it points (the arrow is flipped for lowest first) and its colour.
function Region:SetTexCoord(_, _, top, bottom) self._flipped = top > bottom end
function Region:SetVertexColor(r, g, b) self._color = { r, g, b } end
-- One box has the focus at a time, as in the game: focusing one takes it from the other.
local focused
function Region:HasFocus() return self._focus == true end
function Region:SetFocus()
    if focused and focused ~= self then focused:ClearFocus() end
    focused = self
    self._focus = true
    self:Fire("OnEditFocusGained")
end
function Region:ClearFocus()
    if focused == self then focused = nil end
    if self._focus then self._focus = false; self:Fire("OnEditFocusLost") end
end
function Region:HighlightText() self._highlighted = true end
function Region:SetEnabled(enabled) self._enabled = enabled and true or false end
function Region:IsEnabled() return self._enabled ~= false end
function Region:SetChecked(checked) self._checked = checked and true or false end
function Region:GetChecked() return self._checked end
function Region:SetMinMaxValues(min, max) self._min, self._max = min, max end
function Region:SetValue(value)
    if value ~= self._value then
        self._value = value
        self:Fire("OnValueChanged", value)
    end
end
function Region:Click()
    if self._kind == "CheckButton" then self._checked = not self._checked end
    self:Fire("OnClick", "LeftButton")
end
function Region:CreateFontString() return region("FontString", self) end
function Region:CreateTexture() return region("Texture", self) end

local function said(text)
    for _, line in ipairs(chat) do
        if line:find(text, 1, true) then return true end
    end
    return false
end

local function runTimers()
    while #timers > 0 do table.remove(timers, 1)() end
end

-- GuildAssistant Professions' saved data: Luna (this character) knows two Blacksmithing recipes.
local function professionsDB()
    return {
        characters = {
            ["Luna-Test Realm"] = { name = "Luna", realm = "Test Realm", class = "MAGE", source = "own",
                professions = { Blacksmithing = { rank = 120, max = 150, recipes = { ["spell:2662"] = true, ["spell:2667"] = true } } } },
            ["Ana-Test Realm"] = { name = "Ana", realm = "Test Realm", class = "PRIEST", source = "guild",
                professions = { Blacksmithing = { rank = 300, max = 300, recipes = { ["spell:2667"] = true } } } },
        },
    }
end

-- `options`: professionsAddon (GuildAssistant Professions installed), timers (C_Timer: run with
-- runTimers()), knownSpells (what IsPlayerSpell says yes to), saved (GuildAssistantDatabaseDB as
-- the game loaded it), noSources (no sources companion installed; by default the test one is,
-- Sources.fixture.lua), itemNames (what GetItemInfo knows beyond Copper Chain Pants), guild (the
-- guild this character is in; none by default), oldChat (the older client's ChatEdit_InsertLink
-- instead of WoW Forever's ChatFrameUtil.InsertLink).
local function loadAddon(options)
    options = options or {}
    chat, linked, timers, created, dressed, told, opened, bags = {}, {}, {}, {}, {}, {}, {}, {}
    focused = nil
    _G.print = function(text) chat[#chat + 1] = tostring(text) end
    _G.SlashCmdList = {}
    _G.UISpecialFrames = {}
    _G.tinsert = table.insert
    _G.UIParent = region("Frame")
    _G.CreateFrame = function(kind, name, parent, template)
        local frame = region(kind, parent)
        frame._template = template
        created[#created + 1] = frame
        if template == "BasicFrameTemplateWithInset" then frame.TitleText = region("FontString", frame) end
        if template == "UICheckButtonTemplate" then frame.Text = region("FontString", frame) end
        if name then _G[name] = frame end
        return frame
    end
    -- The last call, and the lines added since it was last owned.
    _G.GameTooltip = setmetatable({ lines = {} }, { __index = function(t, key)
        return function(_, ...)
            t.last = { key, ... }
            if key == "SetOwner" then t.lines = {} end
            if key == "AddLine" then t.lines[#t.lines + 1] = (...) end
        end
    end })
    _G.C_Timer = options.timers and { After = function(_, fn) timers[#timers + 1] = fn end } or nil
    _G.UnitName = function() return "Luna" end
    _G.IsInGuild = function() return options.guild ~= nil end
    _G.GetGuildInfo = function(unit)
        if unit == "player" and options.guild then return options.guild, "Member", 3 end
    end
    _G.GetRealmName = function() return "Test Realm" end
    _G.GetProfessions = function() return 1, nil, 3 end
    _G.GetProfessionInfo = function(index)
        if index == 1 then return "Blacksmithing", "icon", 120, 150, 0, 0, 164 end
        if index == 3 then return "Cooking", "icon", 40, 75, 0, 0, 185 end
    end
    _G.GetNumSkillLines, _G.GetSkillLineInfo = nil, nil
    _G.IsPlayerSpell = function(id) return (options.knownSpells or {})[id] == true end
    -- itemID, type, subtype, equip location, icon, class id, subclass id.
    _G.GetItemInfoInstant = function(id) return id, "Trade Goods", "Trade Goods", "", 136000 + id % 1000, 7, 0 end
    _G.GetItemInfo = function(id)
        if id == 2852 then return "Copper Chain Pants", "|cff1eff00|Hitem:2852::::::::4:::::::|h[Copper Chain Pants]|h|r", 2 end
        local name = (options.itemNames or {})[id]
        if name then return name, "|cffffffff|Hitem:" .. id .. "|h[" .. name .. "]|h|r", 1 end
    end
    _G.GetSpellTexture = function() return 135913 end
    _G.GetSpellLink = function(id) return "|cff71d5ff|Hspell:" .. id .. "|h[Enchant]|h|r" end
    _G.C_Map = { GetAreaInfo = function(id) return ({ [40] = "Westfall", [440] = "Tanaris" })[id] end }
    _G.RAID_CLASS_COLORS = { MAGE = { r = 0.25, g = 0.78, b = 0.92, colorStr = "ff3fc7eb" }, PRIEST = { r = 1, g = 1, b = 1 } }
    _G.IsShiftKeyDown = function() return options.shift == true end
    _G.IsModifiedClick = nil
    -- Where a shift-click puts a link in (the chat box, when it's open): WoW Forever's, or the older one.
    local function insertLink(link) linked[#linked + 1] = link end
    _G.ChatFrameUtil = not options.oldChat and { InsertLink = insertLink } or nil
    _G.ChatEdit_InsertLink = options.oldChat and insertLink or nil
    _G.C_ChatInfo = { InChatMessagingLockdown = function() return false end }
    _G.GetCurrentKeyBoardFocus = function() return focused end
    _G.StackSplitFrame = region("Frame")
    StackSplitFrame:Hide()
    -- The game's: `fn` runs after the function (a global's, or a table's), with its arguments.
    _G.hooksecurefunc = function(owner, name, fn)
        if type(owner) == "string" then owner, name, fn = _G, owner, name end
        local original = owner[name]
        owner[name] = function(...)
            local result = original(...)
            fn(...)
            return result
        end
    end
    _G.IsControlKeyDown = function() return options.ctrl == true end
    _G.DressUpItemLink = function(link) dressed[#dressed + 1] = link end
    _G.ChatFrame_SendTell = function(name) told[#told + 1] = name end
    _G.C_AddOns = nil
    -- options.tradeSkill: what the game has to open a profession window ("recipe": both, "profession":
    -- OpenTradeSkill alone); none by default.
    _G.C_TradeSkillUI = options.tradeSkill and {
        OpenRecipe = options.tradeSkill == "recipe" and function(id) opened[#opened + 1] = "recipe " .. id end or nil,
        OpenTradeSkill = function(skillLine) opened[#opened + 1] = "profession " .. skillLine end,
        CraftRecipe = options.tradeSkill == "recipe" and function(id, times) opened[#opened + 1] = ("craft %d x%d"):format(id, times) end or nil,
    } or nil
    _G.GetItemCount = function(id) return bags[id] or 0 end
    _G.GetAddOnMetadata = function(name, field)
        if name == "GuildAssistantDatabase" and field == "Version" and not options.noVersion then return "9.9.9" end
    end
    _G.ChatFrame_OpenChat = nil
    _G.GuildAssistantProfessionsDB = options.professionsAddon and professionsDB() or nil
    _G.GuildAssistantDatabaseDB = options.saved
    _G.GuildAssistantDatabaseMinimapButton = nil
    _G.Minimap = region("Frame")
    _G.GetCursorPosition = function() return 1100, 500 end -- right of the minimap's centre
    _G.GuildAssistantDatabaseSources = nil
    if not options.noSources then assert(loadfile("dev/GuildAssistantDatabase/Sources.fixture.lua"))() end

    local ns = {}
    for _, file in ipairs({ "GuildAssistantDatabase/Core.lua", "dev/GuildAssistantDatabase/Data.fixture.lua",
        "GuildAssistantDatabase/Game.lua", "GuildAssistantDatabase/UI.lua", "GuildAssistantDatabase/Minimap.lua",
        "GuildAssistantDatabase/Main.lua" }) do
        assert(loadfile(file))("GuildAssistantDatabase", ns)
    end
    return ns
end

local function shownRows(ns)
    local names = {}
    for _, row in ipairs(ns.UI.parts().rows) do
        if row:IsShown() then names[#names + 1] = row.recipe.name end
    end
    return table.concat(names, ", ")
end

local function sidebar(ns)
    local out = {}
    for _, button in ipairs(ns.UI.parts().sidebarButtons) do
        if button:IsShown() then out[#out + 1] = button.text:GetText() .. (button.right:GetText() ~= "" and (" " .. button.right:GetText()) or "") end
    end
    return table.concat(out, " | ")
end

-- Who can craft it, as it reads: the names shown, then how many more.
local function crafterLine(d)
    local out = {}
    for _, button in ipairs(d.crafterNames.names) do
        if button:IsShown() then out[#out + 1] = button.text:GetText() end
    end
    if d.crafterNames.more:IsShown() then out[#out + 1] = d.crafterNames.more:GetText() end
    return table.concat(out, " ")
end

local function rowNamed(ns, name)
    for _, row in ipairs(ns.UI.parts().rows) do
        if row:IsShown() and row.recipe.name == name then return row end
    end
end

-- Loading and the command -------------------------------------------------------------------------

it("says what it has once loaded, and nothing for another addon", function()
    local ns = loadAddon()
    local events
    for _, f in ipairs(created) do if f._events and f._events.ADDON_LOADED then events = f end end
    eq(ns.UI.isShown(), false)
    eq(#chat, 0, "nothing said before ADDON_LOADED")
    eq(events ~= nil, true, "has an event frame")
    events:Fire("OnEvent", "ADDON_LOADED", "Bagnon")
    eq(#chat, 0, "not for another addon")
    events:Fire("OnEvent", "ADDON_LOADED", "GuildAssistantDatabase")
    eq(said("10 recipes from the game's data (1.60.1.70888). Type /gadb (or click the clip on the minimap) to search them."), true, "says what it has")
end)

local function loaded(options)
    local ns = loadAddon(options)
    for _, f in ipairs(created) do
        if f._events and f._events.ADDON_LOADED then f:Fire("OnEvent", "ADDON_LOADED", "GuildAssistantDatabase") end
    end
    return ns, _G.GuildAssistantDatabaseMinimapButton
end

-- The minimap button --------------------------------------------------------------------------------

it("puts the clip on the minimap's edge once loaded, and opens and closes the window", function()
    local ns, button = loaded()
    eq(button ~= nil, true, "made")
    eq(button._parent, Minimap)
    eq(button.icon._texture, "Interface\\AddOns\\GuildAssistantDatabase\\Media\\Icon")
    eq(button:IsShown(), true)
    -- Lower left by default, just outside the edge (radius 70 + 10).
    local x, y = button._point[4], button._point[5]
    eq(x < 0 and y < 0, true, "lower left")
    eq(math.floor(math.sqrt(x * x + y * y) + 0.5), 80)
    button:Click()
    eq(ns.UI.isShown(), true, "opens")
    button:Click()
    eq(ns.UI.isShown(), false, "closes")
    button:Fire("OnEnter")
    eq(GameTooltip.last[1], "Show")
end)

it("moves around the minimap while dragged, and remembers where", function()
    local _, button = loaded()
    button:Fire("OnDragStart")
    button:Fire("OnUpdate") -- the cursor is right of the centre
    button:Fire("OnDragStop")
    eq(button:GetScript("OnUpdate"), nil, "stops following")
    eq(math.floor(GuildAssistantDatabaseDB.minimap.angle + 0.5) % 360, 0)
    eq(math.floor(button._point[4] + 0.5), 80); eq(math.floor(button._point[5] + 0.5), 0)
    -- Next session, it's where it was left.
    local _, again = loaded({ saved = { minimap = { angle = 90 } } })
    eq(math.floor(again._point[4] + 0.5), 0); eq(math.floor(again._point[5] + 0.5), 80)
end)

it("hides and shows with /gadb minimap, and stays hidden next time", function()
    local _, button = loaded()
    SlashCmdList.GADB("minimap")
    eq(button:IsShown(), false)
    eq(GuildAssistantDatabaseDB.minimap.hidden, true)
    eq(said("/gadb minimap brings it back"), true)
    local _, again = loaded({ saved = { minimap = { angle = 90, hidden = true } } })
    eq(again:IsShown(), false, "still hidden")
    SlashCmdList.GADB("minimap")
    eq(again:IsShown(), true)
    eq(said("the minimap button is back."), true)
end)

it("copes with saved data it doesn't understand", function()
    local _, button = loaded({ saved = { minimap = "nonsense" } })
    eq(button:IsShown(), true)
    eq(GuildAssistantDatabaseDB.minimap.angle, 210)
end)

it("opens and closes with /gadb, and reads no profession before it opens", function()
    local ns = loadAddon()
    for _, entry in ipairs(ns.Data.professions) do eq(entry.loaded, nil, entry.name .. " read at load") end
    SlashCmdList.GADB("")
    eq(ns.UI.isShown(), true, "open")
    eq(shownRows(ns), "Enchant Bracer - Minor Health, Copper Chain Pants, Rough Sharpening Stone, Runed Copper Breastplate, "
        .. "Greater Magic Wand, Golden Scale Coif, The Shatterer, Ornate Mithril Breastplate")
    eq(ns.UI.parts().statusText:GetText(), "8 recipes")
    eq(sidebar(ns), "All professions 8 | Blacksmithing 6 | Enchanting 2")
    eq(_G.GuildAssistantDatabaseFrame.TitleText:GetText(), "GuildAssistant Database")
    SlashCmdList.GADB("")
    eq(ns.UI.isShown(), false, "closed")
end)

it("opens searching for what follows /gadb, and lists its commands on help", function()
    local ns = loadAddon()
    SlashCmdList.GADB("Mithril")
    eq(ns.UI.parts().searchBox:GetText(), "Mithril")
    eq(shownRows(ns), "Ornate Mithril Breastplate, The Shatterer")
    SlashCmdList.GADB("help")
    eq(said("/gadb <words>"), true)
end)

-- Searching and filtering -------------------------------------------------------------------------

it("searches as you type, and by the item's type the game knows", function()
    local ns = loadAddon()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.searchBox:SetText("breastplate")
    eq(shownRows(ns), "Runed Copper Breastplate, Ornate Mithril Breastplate")
    parts.searchBox:SetText("plate chest")
    eq(shownRows(ns), "Runed Copper Breastplate, Ornate Mithril Breastplate")
    parts.searchBox:SetText("maces")
    eq(shownRows(ns), "The Shatterer")
    parts.searchBox:SetText("nothing like this")
    eq(shownRows(ns), "")
    eq(parts.statusText:GetText(), "No recipes match.")
end)

it("keeps the level and skill within the boxes' limits", function()
    local ns = loadAddon()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.minLevelBox:SetText("30")
    parts.maxLevelBox:SetText("42")
    eq(shownRows(ns), "Golden Scale Coif, The Shatterer")
    parts.minLevelBox:SetText("")
    parts.maxLevelBox:SetText("")
    parts.minSkillBox:SetText("200")
    eq(shownRows(ns), "The Shatterer, Ornate Mithril Breastplate")
end)

it("moves between the boxes with Tab, and back with Shift-Tab, round all five", function()
    local ns = loadAddon()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    local boxes = { parts.searchBox, parts.minLevelBox, parts.maxLevelBox, parts.minSkillBox, parts.maxSkillBox }
    -- Which box has the focus (only ever one).
    local function at()
        local found = {}
        for i, box in ipairs(boxes) do if box:HasFocus() then found[#found + 1] = i end end
        eq(#found, 1, "boxes with the focus")
        return found[1]
    end
    parts.searchBox:SetFocus()
    local visited = {}
    for _ = 1, 5 do
        boxes[at()]:Fire("OnTabPressed")
        visited[#visited + 1] = at()
    end
    eq(table.concat(visited, " "), "2 3 4 5 1", "forwards, and from the last back to the search")
    _G.IsShiftKeyDown = function() return true end
    visited = {}
    for _ = 1, 5 do
        boxes[at()]:Fire("OnTabPressed")
        visited[#visited + 1] = at()
    end
    eq(table.concat(visited, " "), "5 4 3 2 1", "backwards, and from the search to the last")
    eq(parts.maxLevelBox._highlighted, true, "its text selected, so typing replaces it")
end)

it("shows one profession when it's picked on the left, and Reset clears it all", function()
    local ns = loadAddon()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.sidebarButtons[3]:Click() -- Enchanting
    eq(shownRows(ns), "Enchant Bracer - Minor Health, Greater Magic Wand")
    eq(parts.sidebarButtons[3].selected:IsShown(), true, "marked as picked")
    parts.searchBox:SetText("wand")
    eq(shownRows(ns), "Greater Magic Wand")
    parts.sidebarButtons[1]:Click() -- All
    eq(shownRows(ns), "Greater Magic Wand")
    parts.sidebarButtons[3]:Click()
    parts.maxLevelBox:SetText("5")
    parts.unknownCheck:Click()
    parts.resetButton:Click()
    eq(parts.searchBox:GetText(), ""); eq(parts.maxLevelBox:GetText(), "")
    eq(parts.unknownCheck:GetChecked(), false)
    eq(parts.state.profession, nil)
    eq(#parts.state.results, 8)
end)

it("reads one profession per frame when the game has timers, saying so meanwhile", function()
    local ns = loadAddon({ timers = true })
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    eq(parts.statusText:GetText(), "Reading recipes... 0 of 2 professions")
    eq(#timers, 1, "one profession at a time")
    table.remove(timers, 1)()
    eq(parts.statusText:GetText(), "Reading recipes... 1 of 2 professions")
    eq(shownRows(ns), "Copper Chain Pants, Rough Sharpening Stone, Runed Copper Breastplate, Golden Scale Coif, The Shatterer, Ornate Mithril Breastplate")
    runTimers()
    eq(parts.statusText:GetText(), "8 recipes")
    -- Typing waits for a pause before searching.
    parts.searchBox:SetText("wand")
    eq(shownRows(ns):find("Copper") ~= nil, true, "not yet")
    runTimers()
    eq(shownRows(ns), "Greater Magic Wand")
end)

-- How many match, per profession -----------------------------------------------------------------

local GOLD = "|cffffd100"

it("says how many recipes of each profession match a search, in gold, and none for those without", function()
    local ns = loadAddon()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.searchBox:SetText("breastplate")
    eq(sidebar(ns), "All professions " .. GOLD .. "2|r | Blacksmithing " .. GOLD .. "2|r | Enchanting")
    parts.searchBox:SetText("dust")
    eq(sidebar(ns), "All professions " .. GOLD .. "2|r | Blacksmithing | Enchanting " .. GOLD .. "2|r")
    -- The limits count as a search too.
    parts.searchBox:SetText("")
    parts.maxLevelBox:SetText("8")
    eq(sidebar(ns), "All professions " .. GOLD .. "4|r | Blacksmithing " .. GOLD .. "2|r | Enchanting " .. GOLD .. "2|r")
    parts.maxLevelBox:SetText("")
    eq(sidebar(ns), "All professions 8 | Blacksmithing 6 | Enchanting 2", "back to the totals, in grey")
end)

it("counts every profession while one is picked, and says where the matches are when it has none", function()
    local ns = loadAddon()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.sidebarButtons[3]:Click() -- Enchanting
    eq(ns.Data.professions[1].loaded ~= nil, true, "all read: none picked at first")
    parts.searchBox:SetText("breastplate")
    eq(shownRows(ns), "")
    eq(parts.statusText:GetText(), "None in Enchanting; 2 in other professions.")
    eq(sidebar(ns), "All professions " .. GOLD .. "2|r | Blacksmithing " .. GOLD .. "2|r | Enchanting")
    parts.sidebarButtons[2]:Click()
    eq(shownRows(ns), "Runed Copper Breastplate, Ornate Mithril Breastplate")
end)

it("reads only the profession picked until there's a search, then the others for their counts", function()
    local ns = loadAddon({ timers = true })
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.sidebarButtons[3]:Click() -- Enchanting, before anything is read
    runTimers()
    eq(ns.Data.professions[2].loaded ~= nil, true, "Enchanting read")
    eq(ns.Data.professions[1].loaded, nil, "Blacksmithing not needed")
    eq(shownRows(ns), "Enchant Bracer - Minor Health, Greater Magic Wand")
    parts.searchBox:SetText("wand")
    runTimers()
    eq(ns.Data.professions[1].loaded ~= nil, true, "Blacksmithing read for its count")
    eq(sidebar(ns), "All professions " .. GOLD .. "1|r | Blacksmithing | Enchanting " .. GOLD .. "1|r")
end)

-- Clearing the search and the Filter ----------------------------------------------------------------

it("clears the search with the cross, shown only while there's something to clear", function()
    local ns = loadAddon()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    eq(parts.clearButton:IsShown(), false, "nothing to clear")
    parts.searchBox:SetText("wand")
    eq(parts.clearButton:IsShown(), true)
    parts.clearButton:Click()
    eq(parts.searchBox:GetText(), "")
    eq(parts.clearButton:IsShown(), false)
    eq(#parts.state.results, 8)
end)

it("filters by armor type and slot from the Filter panel", function()
    local ns = loadAddon()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    eq(parts.filterPopup:IsShown(), false)
    parts.filterButton:Click()
    eq(parts.filterPopup:IsShown(), true, "opens")
    parts.filterChecks.Plate:Click()
    eq(shownRows(ns), "Runed Copper Breastplate, Ornate Mithril Breastplate")
    eq(parts.filterButton:GetText(), "Filter (1)")
    eq(sidebar(ns), "All professions " .. GOLD .. "2|r | Blacksmithing " .. GOLD .. "2|r | Enchanting", "a filter counts")
    -- Two armor types: either; a slot as well: both.
    parts.filterChecks.Mail:Click()
    eq(shownRows(ns), "Copper Chain Pants, Runed Copper Breastplate, Golden Scale Coif, Ornate Mithril Breastplate")
    parts.filterChecks.Head:Click()
    eq(shownRows(ns), "Golden Scale Coif")
    eq(parts.filterButton:GetText(), "Filter (3)")
    -- A slot alone: weapons too.
    parts.filterPopup.clear:Click()
    eq(parts.filterButton:GetText(), "Filter")
    eq(parts.filterChecks.Plate:GetChecked(), false)
    parts.filterChecks["One-Hand"]:Click()
    eq(shownRows(ns), "The Shatterer")
    parts.filterChecks.Ranged:Click()
    eq(shownRows(ns), "Greater Magic Wand, The Shatterer")
    -- With words too.
    parts.searchBox:SetText("wand")
    eq(shownRows(ns), "Greater Magic Wand")
    parts.filterPopup.done:Click()
    eq(parts.filterPopup:IsShown(), false, "Done closes it")
    eq(parts.filterButton:GetText(), "Filter (2)", "and keeps the filter")
end)

it("filters to what binds when picked up from the Filter panel, and says so in the details", function()
    local ns = loadAddon({ noSources = true })
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.filterButton:Click()
    eq(parts.filterPopup.bindingTitle:GetText(), "Binding")
    local pickup = parts.filterChecks["On pickup"]
    pickup:Fire("OnEnter")
    eq(GameTooltip.lines[1], "Binds when picked up")
    eq(GameTooltip.lines[2], "Recipes whose item binds to whoever makes it.")
    pickup:Click()
    eq(shownRows(ns), "Stonevault Greatsword")
    eq(parts.filterButton:GetText(), "Filter (1)")
    rowNamed(ns, "Stonevault Greatsword"):Click()
    has(parts.details.info:GetText(), "Requires Master Swordsmith\nBinds when picked up\nTwo-Hand (Two-Handed Swords)")
    -- With an armor type too: both.
    parts.filterChecks.Plate:Click()
    eq(shownRows(ns), "")
    eq(parts.filterButton:GetText(), "Filter (2)")
    parts.filterPopup.clear:Click()
    eq(pickup:GetChecked(), false, "Clear unticks it")
    eq(parts.filterButton:GetText(), "Filter")
    -- What binds when equipped doesn't say it.
    rowNamed(ns, "Ornate Mithril Breastplate"):Click()
    eq(parts.details.info:GetText():find("Binds", 1, true), nil)
end)

-- Luna and Ana in Test Guild, as GuildAssistant Professions saves them; Di, Luna's alt there, knows
-- the wand by the item it makes; Bo (a link) and Cy (another guild) don't count.
local function guildDB()
    local db = GuildAssistantProfessionsDB
    db.characters["Luna-Test Realm"].guild = "Test Guild"
    db.characters["Ana-Test Realm"].guild = "Test Guild"
    db.characters["Ana-Test Realm"].professions.Blacksmithing.recipes["spell:9972"] = true
    db.characters["Di-Test Realm"] = { name = "Di", realm = "Test Realm", source = "own", guild = "Test Guild",
        professions = { Enchanting = { recipes = { ["item:11288"] = true } } } }
    db.characters["Bo-Test Realm"] = { name = "Bo", realm = "Test Realm", source = "link",
        professions = { Blacksmithing = { recipes = { ["spell:3503"] = true } } } }
    db.characters["Cy-Test Realm"] = { name = "Cy", realm = "Test Realm", source = "guild", guild = "Other Guild",
        professions = { Enchanting = { recipes = { ["spell:7418"] = true } } } }
end

it("lists only what your guild can craft with Only guild in the Filter, while you're in one", function()
    local ns = loadAddon({ professionsAddon = true, guild = "Test Guild" })
    guildDB()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.filterButton:Click()
    local only = parts.filterChecks["Only guild"]
    eq(only:IsShown(), true, "in a guild")
    eq(parts.filterPopup.guildTitle:GetText(), "Who can craft")
    only:Fire("OnEnter")
    eq(GameTooltip.lines[1], "Only guild")
    eq(GameTooltip.lines[2], "Recipes someone in Test Guild can craft.")
    only:Click()
    -- A filter narrows the list down, so it comes by the level the item needs (Greater Magic Wand 8,
    -- Runed Copper Breastplate 13), not by skill.
    eq(shownRows(ns), "Copper Chain Pants, Greater Magic Wand, Runed Copper Breastplate, Ornate Mithril Breastplate")
    eq(parts.filterButton:GetText(), "Filter (1)")
    eq(sidebar(ns), "All professions " .. GOLD .. "4|r | Blacksmithing " .. GOLD .. "3|r | Enchanting " .. GOLD .. "1|r", "it counts")
    -- With the rest: plate, then only your professions' recipes you don't know.
    parts.filterChecks.Plate:Click()
    eq(shownRows(ns), "Runed Copper Breastplate, Ornate Mithril Breastplate")
    parts.filterChecks.Plate:Click()
    parts.unknownCheck:Click()
    eq(shownRows(ns), "Ornate Mithril Breastplate", "Ana knows it, Luna doesn't")
    parts.unknownCheck:Click()
    -- Clear unticks it, and so does Reset.
    parts.filterPopup.clear:Click()
    eq(only:GetChecked(), false)
    eq(parts.filterButton:GetText(), "Filter")
    eq(#parts.state.results, 8)
    only:Click()
    parts.resetButton:Click()
    eq(only:GetChecked(), false, "Reset")
    eq(#parts.state.results, 8)
end)

it("doesn't offer Only guild outside a guild, and says why the guild has none", function()
    local ns = loadAddon({ professionsAddon = true })
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.filterButton:Click()
    eq(parts.filterChecks["Only guild"]:IsShown(), false, "not in a guild")
    eq(parts.filterPopup.guildTitle:IsShown(), false)
    local height = parts.filterPopup:GetHeight()
    eq(parts.filterChecks["On pickup"]:IsShown(), true, "Binding is there all the same")
    -- In a guild no one shared anything with: nothing, and why.
    ns = loadAddon({ professionsAddon = true, guild = "Test Guild" })
    SlashCmdList.GADB("")
    parts = ns.UI.parts()
    parts.filterButton:Click()
    eq(parts.filterPopup:GetHeight(), height + 2 * 22, "Who can craft makes the panel two rows taller")
    parts.filterChecks["Only guild"]:Click()
    eq(shownRows(ns), "")
    has(parts.statusText:GetText(), "Only guildmates who use GuildAssistant Professions are known.")
    -- Without GuildAssistant Professions.
    ns = loadAddon({ guild = "Test Guild" })
    SlashCmdList.GADB("")
    parts = ns.UI.parts()
    parts.filterButton:Click()
    parts.filterChecks["Only guild"]:Click()
    eq(shownRows(ns), "")
    has(parts.statusText:GetText(), "Install GuildAssistant Professions to know what your guild can craft.")
end)

it("Reset clears the Filter too, and closes its panel", function()
    local ns = loadAddon()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.filterButton:Click()
    parts.filterChecks.Plate:Click()
    parts.resetButton:Click()
    eq(parts.filterPopup:IsShown(), false)
    eq(parts.filterButton:GetText(), "Filter")
    eq(parts.filterChecks.Plate:GetChecked(), false)
    eq(#parts.state.results, 8)
end)

it("says where the recipes come from on hovering the count, and its version in the corner", function()
    local ns = loadAddon({ professionsAddon = true })
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    eq(parts.statusText:GetText(), "8 recipes", "just the count")
    eq(parts.versionText:GetText(), "v9.9.9")
    parts.statusHover:Fire("OnEnter")
    eq(table.concat(GameTooltip.lines, " | "), "10 recipes from the game's data | Build 1.60.1.70888 | |cffffd100Sources|r"
        .. " | Test notes (2026-11-11) | Seen by GuildAssistant Professions")
    eq(GameTooltip.last[1], "Show")
    parts.statusHover:Fire("OnLeave")
    eq(GameTooltip.last[1], "Hide")
    -- No sources: the data alone. A game without the version: nothing in the corner.
    local ns2 = loadAddon({ noSources = true, noVersion = true })
    SlashCmdList.GADB("")
    ns2.UI.parts().statusHover:Fire("OnEnter")
    eq(table.concat(GameTooltip.lines, " | "), "10 recipes from the game's data | Build 1.60.1.70888")
    eq(ns2.UI.parts().versionText:GetText(), "")
end)

it("keeps the last search on /gadb, and clears it on /gadb *", function()
    local ns = loadAddon()
    SlashCmdList.GADB("mithril")
    local parts = ns.UI.parts()
    eq(parts.searchBox:GetText(), "mithril")
    SlashCmdList.GADB("")
    eq(ns.UI.isShown(), false)
    SlashCmdList.GADB("")
    eq(parts.searchBox:GetText(), "mithril", "opened again: the same search")
    SlashCmdList.GADB("")
    SlashCmdList.GADB("*")
    eq(ns.UI.isShown(), true)
    eq(parts.searchBox:GetText(), "", "cleared")
    eq(parts.statusText:GetText(), "8 recipes")
    SlashCmdList.GADB("mithril")
    SlashCmdList.GADB("*")
    eq(ns.UI.isShown(), true, "already open: stays open")
    eq(parts.searchBox:GetText(), "")
end)

-- The order the list is in ---------------------------------------------------------------------------

-- A column's chevron as it reads: which way it points and whether it's the gold one (what the list
-- is sorted by) or the grey one (what breaks its ties). "none" when the order doesn't use it.
local function chevron(header)
    if not header.chevron:IsShown() then return "none" end
    local color = header.chevron._color or {}
    return ("%s %s"):format(header.chevron._flipped and "up" or "down", color[1] == 1 and color[2] == 0.82 and "gold" or "grey")
end

local ALL_BY_SKILL = "Enchant Bracer - Minor Health, Copper Chain Pants, Rough Sharpening Stone, Runed Copper Breastplate, "
    .. "Greater Magic Wand, Golden Scale Coif, Ironforge Gauntlets, The Shatterer, Ornate Mithril Breastplate, Stonevault Greatsword"

it("shows the order the list is in above it: by skill while you're only looking", function()
    local ns = loadAddon({ noSources = true })
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    eq(parts.columnSkill.title:GetText(), "Skill"); eq(parts.columnLevel.title:GetText(), "Level")
    eq(chevron(parts.columnSkill), "up gold", "sorted by skill, lowest first")
    eq(chevron(parts.columnLevel), "none", "the order doesn't use it")
    eq(shownRows(ns), ALL_BY_SKILL)
    parts.columnSkill:Fire("OnEnter")
    eq(GameTooltip.lines[1], "Skill")
    eq(GameTooltip.lines[2], "The profession skill it takes to learn the recipe.")
    eq(GameTooltip.lines[3], "Sorted by skill, lowest first.")
    eq(GameTooltip.lines[4], "Click to list the highest first.")
end)

it("sorts a search by the level the item needs, ties by skill, until a column is clicked", function()
    local ns = loadAddon({ noSources = true })
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.searchBox:SetText("plate")
    -- The recipes whose own name matches first, then Ironforge Gauntlets (plate too).
    eq(shownRows(ns), "Runed Copper Breastplate, Ornate Mithril Breastplate, Ironforge Gauntlets")
    eq(chevron(parts.columnLevel), "up gold"); eq(chevron(parts.columnSkill), "up grey")
    -- A click on the column it's sorted by turns it around, and sorts the whole matched list by it:
    -- the recipes whose own name matches no longer come first.
    parts.columnLevel:Click()
    eq(shownRows(ns), "Ornate Mithril Breastplate, Runed Copper Breastplate, Ironforge Gauntlets")
    eq(chevron(parts.columnLevel), "down gold"); eq(chevron(parts.columnSkill), "up grey")
    eq(GameTooltip.lines[3], "Sorted by level, highest first, then by skill, lowest first.", "the tooltip says so after the click")
    eq(GameTooltip.lines[4], "Click to list the lowest first.")
    -- And again, back to the lowest first.
    parts.columnLevel:Click()
    eq(shownRows(ns), "Ironforge Gauntlets, Runed Copper Breastplate, Ornate Mithril Breastplate")
    eq(chevron(parts.columnLevel), "up gold")
    -- Skill: Runed Copper Breastplate 55, Ironforge Gauntlets 200, Ornate Mithril Breastplate 240.
    parts.columnSkill:Click()
    eq(shownRows(ns), "Runed Copper Breastplate, Ironforge Gauntlets, Ornate Mithril Breastplate")
    eq(chevron(parts.columnSkill), "up gold"); eq(chevron(parts.columnLevel), "up grey")
    -- The columns clicked stay once the search is cleared: it doesn't go back to the skill it
    -- comes in until Reset.
    parts.searchBox:SetText("")
    eq(chevron(parts.columnSkill), "up gold"); eq(chevron(parts.columnLevel), "up grey")
    -- By skill, and the same skill by the lowest level (Rough Sharpening Stone needs none), where
    -- the order it comes in would have gone by name.
    eq(shownRows(ns), "Enchant Bracer - Minor Health, Rough Sharpening Stone, Copper Chain Pants, Runed Copper Breastplate, "
        .. "Greater Magic Wand, Golden Scale Coif, Ironforge Gauntlets, The Shatterer, Ornate Mithril Breastplate, Stonevault Greatsword")
end)

it("compounds the two: recipes the column can't tell apart come out the other's way", function()
    local ns = loadAddon({ noSources = true })
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    -- Copper Chain Pants and Rough Sharpening Stone both take skill 15; the stone needs no level.
    parts.columnLevel:Click() -- by level now, skill breaking its ties
    parts.columnSkill:Click() -- by skill again, level breaking its ties
    eq(chevron(parts.columnSkill), "up gold"); eq(chevron(parts.columnLevel), "up grey")
    has(shownRows(ns), "Rough Sharpening Stone, Copper Chain Pants", "the lowest level first")
    -- Level turned around, skill back in front: by skill, and the same skill by the highest level.
    parts.columnLevel:Click()
    parts.columnLevel:Click()
    parts.columnSkill:Click()
    eq(chevron(parts.columnSkill), "up gold"); eq(chevron(parts.columnLevel), "down grey")
    has(shownRows(ns), "Copper Chain Pants, Rough Sharpening Stone", "the highest level first")
    eq(GameTooltip.lines[3], "Sorted by skill, lowest first, then by level, highest first.")
    -- Reset puts it back to the order the list comes in.
    parts.resetButton:Click()
    eq(chevron(parts.columnSkill), "up gold"); eq(chevron(parts.columnLevel), "none")
    eq(shownRows(ns), ALL_BY_SKILL)
end)

it("keeps the recipe picked when the order changes, and scrolls back to the top", function()
    local ns = loadAddon({ noSources = true })
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    rowNamed(ns, "Copper Chain Pants"):Click()
    eq(parts.state.selected.name, "Copper Chain Pants")
    parts.state.offset = 2
    parts.columnLevel:Click()
    eq(parts.state.selected.name, "Copper Chain Pants", "still picked")
    eq(rowNamed(ns, "Copper Chain Pants").selected:IsShown(), true, "still marked in the list")
    has(parts.details.name.text:GetText(), "Copper Chain Pants", "its details still shown")
    eq(parts.state.offset, 0, "at the top of the new order")
end)

-- The details -------------------------------------------------------------------------------------

it("shows a recipe's details: the item, reagents, how to learn it and who can craft it", function()
    local ns = loadAddon({ professionsAddon = true })
    SlashCmdList.GADB("breastplate")
    local d = ns.UI.parts().details
    eq(d.hint:IsShown(), true, "a hint before picking one")
    eq(d.learnHover:IsShown(), false, "nothing to hover")
    rowNamed(ns, "Runed Copper Breastplate"):Click()
    eq(d.hint:IsShown(), false)
    has(d.name.text:GetText(), "Runed Copper Breastplate")
    has(d.info:GetText(), "Blacksmithing, skill 55, requires level 13")
    has(d.info:GetText(), "Chest (Plate), Strength, Spirit")
    eq(d.reagents[1].text:GetText(), "12 x |cffffffffCopper Bar|r")
    eq(d.reagents[3]:IsShown(), true); eq(d.reagents[4]:IsShown(), false)
    eq(d.learn:GetText(), "Drop: Defias Renegade Mage (Westfall)\nPickpocketing")
    -- The sources, on hovering "How to learn it". GuildAssistant Professions is installed: what it
    -- knows is a source too.
    eq(d.learnHover:IsShown(), true)
    d.learnHover:Fire("OnEnter")
    eq(table.concat(GameTooltip.lines, " | "), "Sources | Test notes (2026-11-11) | Seen by GuildAssistant Professions")
    eq(GameTooltip.last[1], "Show")
    d.learnHover:Fire("OnLeave")
    eq(GameTooltip.last[1], "Hide")
    has(d.recipeItems[1].text:GetText(), "Plans: Runed Copper Breastplate")
    has(d.recipeItems[1].text:GetText(), "(skill 55)")
    eq(d.recipeItems[2]:IsShown(), false)
    eq(crafterLine(d), "|cff3fc7ebLuna|r (you), |cffffffffAna|r")
    eq(d.crafters:IsShown(), false, "no message")
    eq(ns.UI.parts().rows[1].selected:IsShown(), true, "the row is marked")
end)

it("whispers someone who can craft it on a click on their name, all of it", function()
    local ns = loadAddon({ professionsAddon = true })
    local characters = GuildAssistantProfessionsDB.characters
    local smithing = { rank = 300, max = 300, recipes = { ["spell:2667"] = true } }
    characters["Shivan Nightpath-Test Realm"] = { name = "Shivan Nightpath", realm = "Test Realm", class = "MAGE", source = "guild", professions = { Blacksmithing = smithing } }
    characters["Bromwellington-Argent Dawn"] = { name = "Bromwellington", realm = "Argent Dawn", source = "link", professions = { Blacksmithing = smithing } }
    SlashCmdList.GADB("breastplate")
    rowNamed(ns, "Runed Copper Breastplate"):Click()
    local d = ns.UI.parts().details
    eq(crafterLine(d), "|cff3fc7ebLuna|r (you), |cffffffffAna|r, |cff3fc7ebShivan Nightpath|r, |cffffffffBromwellington|r (link)")
    local names = d.crafterNames.names
    -- Yours: nothing to click.
    eq(names[1].whisper, nil)
    names[1]:Click()
    eq(#told, 0)
    names[2]:Fire("OnEnter")
    eq(table.concat(GameTooltip.lines, " | "), "Ana | Click to whisper")
    names[2]:Click()
    eq(told[1], "Ana")
    names[3]:Click()
    eq(told[2], "Shivan Nightpath", "the whole name")
    names[4]:Click()
    eq(told[3], "Bromwellington-ArgentDawn", "another realm's, with it")
    -- The names wrap: at 6 pixels a letter, the fourth doesn't fit in the 300 after the others.
    eq(d.crafterNames.width, 300)
    eq(names[3]._point[4], 6 * #"Luna (you)," + 4 + 6 * #"Ana," + 4)
    eq(names[4]._point[4], 0); eq(names[4]._point[5], -14, "on the next line")
    -- Past 15, how many more.
    for i = 1, 20 do
        characters["Alt" .. i .. "-Test Realm"] = { name = "Alt" .. i, realm = "Test Realm", source = "own", professions = { Blacksmithing = smithing } }
    end
    SlashCmdList.GADB("breastplate")
    rowNamed(ns, "Runed Copper Breastplate"):Click()
    eq(d.crafterNames.more:IsShown(), true)
    has(crafterLine(d), "(alt), and 9 more")
end)

it("says who can craft it only with GuildAssistant Professions", function()
    local ns = loadAddon()
    SlashCmdList.GADB("breastplate")
    rowNamed(ns, "Ornate Mithril Breastplate"):Click()
    has(ns.UI.parts().details.crafters:GetText(), "Install GuildAssistant Professions")
    local ns2 = loadAddon({ professionsAddon = true })
    SlashCmdList.GADB("coif")
    rowNamed(ns2, "Golden Scale Coif"):Click()
    has(ns2.UI.parts().details.crafters:GetText(), "Nobody you know of yet.")
    has(ns2.UI.parts().details.learn:GetText(), "Vendor: Krinkle Goodsteel (Tanaris)")
end)

it("shows an enchant (no item) by its spell", function()
    local ns = loadAddon()
    SlashCmdList.GADB("bracer")
    local row = rowNamed(ns, "Enchant Bracer - Minor Health")
    eq(row.hyperlink, "spell:7418")
    eq(row.icon._texture, 135913)
    row:Click()
    has(ns.UI.parts().details.learn:GetText(), "Learned with the profession")
end)

it("says which specialization a recipe needs, as its plans do, and finds it by that", function()
    local ns = loadAddon({ noSources = true })
    SlashCmdList.GADB("weaponsmith")
    eq(shownRows(ns), "Stonevault Greatsword")
    rowNamed(ns, "Stonevault Greatsword"):Click()
    local parts = ns.UI.parts()
    has(parts.details.info:GetText(), "Blacksmithing, skill 300, requires level 55\nRequires Master Swordsmith\n")
    has(parts.details.info:GetText(), "\nTwo-Hand (Two-Handed Swords), Speed 3.60, Strength")
    parts.searchBox:SetText("breastplate")
    rowNamed(ns, "Runed Copper Breastplate"):Click()
    eq(parts.details.info:GetText():find("Requires", 1, true), nil, "none for plans anyone can learn")
end)

it("links a recipe or item in the chat on shift-click, and shows its tooltip on hover", function()
    local ns = loadAddon()
    SlashCmdList.GADB("pants")
    local row = rowNamed(ns, "Copper Chain Pants")
    row:Fire("OnEnter")
    eq(GameTooltip.last[1], "Show")
    row:Click()
    local d = ns.UI.parts().details
    _G.IsShiftKeyDown = function() return true end
    -- A recipe in the list: the recipe, to craft it (its spell's link, as the game makes it).
    row:Click()
    eq(linked[1], "|cff71d5ff|Hspell:" .. row.recipe.id .. "|h[Enchant]|h|r")
    -- The item at the top of its details: the item.
    d.name:Click()
    eq(linked[2], "|cff1eff00|Hitem:2852::::::::4:::::::|h[Copper Chain Pants]|h|r")
    eq(ns.UI.parts().state.selected.name, "Copper Chain Pants", "shift-click links, doesn't pick another")
    -- An item the game doesn't have yet: said, nothing linked.
    SlashCmdList.GADB("breastplate")
    _G.IsShiftKeyDown = function() return false end
    rowNamed(ns, "Runed Copper Breastplate"):Click()
    _G.IsShiftKeyDown = function() return true end
    d.name:Click()
    eq(#linked, 2)
    eq(said("doesn't have that item yet"), true)
    -- An enchant makes no item: the top of its details links the recipe too.
    SlashCmdList.GADB("bracer")
    _G.IsShiftKeyDown = function() return false end
    rowNamed(ns, "Enchant Bracer - Minor Health"):Click()
    _G.IsShiftKeyDown = function() return true end
    d.name:Click()
    eq(linked[3], "|cff71d5ff|Hspell:7418|h[Enchant]|h|r")
end)

local COPPER_BAR = "|cffffffff|Hitem:2840::::::::20:::::::|h[Copper Bar]|h|r"

-- A shift-click outside the window (the bags, a link in the chat): the game puts its link in.
local function gameLinks(link)
    if ChatFrameUtil then ChatFrameUtil.InsertLink(link) else ChatEdit_InsertLink(link) end
end

it("searches for an item shift-clicked anywhere while the window is open and the chat box isn't", function()
    local ns = loadAddon()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    -- From the bags (the game puts its link in through ChatFrameUtil.InsertLink): what uses it.
    gameLinks(COPPER_BAR)
    eq(parts.searchBox:GetText(), "Copper Bar")
    eq(shownRows(ns), "Copper Chain Pants, Runed Copper Breastplate")
    -- A stack's: the game's split box, opened after the link, is closed.
    StackSplitFrame:Show()
    gameLinks(COPPER_BAR)
    eq(StackSplitFrame:IsShown(), false, "split box closed")
    -- A quality icon in its text (the game's newer links): the game's name for it.
    gameLinks("|cffffffff|Hitem:2836::::::::20:::::::|h[Coarse Stone |A:Professions-ChatIcon-Quality-Tier1:17:15::1|a]|h|r")
    eq(parts.searchBox:GetText(), "Coarse Stone ")
    _G.GetItemInfo = function(link) if tostring(link):find("item:2836", 1, true) then return "Coarse Stone" end end
    gameLinks("|cffffffff|Hitem:2836::::::::20:::::::|h[Coarse Stone |A:Professions-ChatIcon-Quality-Tier1:17:15::1|a]|h|r")
    eq(parts.searchBox:GetText(), "Coarse Stone")
    -- Plans: the recipe they teach.
    gameLinks("|cff1eff00|Hitem:2881::::::::20:::::::|h[Plans: Runed Copper Breastplate]|h|r")
    eq(shownRows(ns), "Runed Copper Breastplate")
    -- A recipe's link is a spell's, not an item's: the search stays.
    gameLinks("|cff71d5ff|Hspell:7418|h[Enchant]|h|r")
    eq(parts.searchBox:GetText(), "Plans: Runed Copper Breastplate")
    -- While typing in the search box: it takes the item's name, and leaves the box.
    parts.searchBox:SetFocus()
    gameLinks(COPPER_BAR)
    eq(parts.searchBox:GetText(), "Copper Bar")
    eq(parts.searchBox:HasFocus(), false)
    -- While typing in another box: nothing (it's not this window's).
    parts.minLevelBox:SetFocus()
    gameLinks("|cff1eff00|Hitem:2881::::::::20:::::::|h[Plans: Runed Copper Breastplate]|h|r")
    eq(parts.searchBox:GetText(), "Copper Bar")
    parts.minLevelBox:ClearFocus()
    -- A reagent in the details, shift-clicked: searched too.
    rowNamed(ns, "Runed Copper Breastplate"):Click()
    _G.IsShiftKeyDown = function() return true end
    _G.GetItemInfo = function(id)
        if id == 3470 then return "Rough Grinding Stone", "|cffffffff|Hitem:3470::::::::20:::::::|h[Rough Grinding Stone]|h|r", 1 end
    end
    parts.details.reagents[3]:Click()
    eq(parts.searchBox:GetText(), "Rough Grinding Stone")
    eq(shownRows(ns), "Runed Copper Breastplate")
    _G.IsShiftKeyDown = function() return false end
    -- The window closed: nothing.
    SlashCmdList.GADB("")
    eq(ns.UI.isShown(), false)
    gameLinks(COPPER_BAR)
    eq(parts.searchBox:GetText(), "Rough Grinding Stone")
end)

it("links a shift-clicked item in the chat when the chat box is open, and searches nothing", function()
    local ns = loadAddon()
    SlashCmdList.GADB("pants")
    local chatBox = region("EditBox")
    chatBox:SetFocus() -- the chat box, open, is being typed in
    gameLinks(COPPER_BAR)
    eq(linked[1], COPPER_BAR)
    eq(ns.UI.parts().searchBox:GetText(), "pants")
    -- And from the window: its link too, not a search.
    rowNamed(ns, "Copper Chain Pants"):Click()
    _G.IsShiftKeyDown = function() return true end
    ns.UI.parts().details.name:Click()
    _G.IsShiftKeyDown = function() return false end
    eq(linked[2], "|cff1eff00|Hitem:2852::::::::4:::::::|h[Copper Chain Pants]|h|r")
    eq(ns.UI.parts().searchBox:GetText(), "pants")
end)

it("on an older client, links and searches through ChatEdit_InsertLink", function()
    local ns = loadAddon({ oldChat = true })
    SlashCmdList.GADB("")
    gameLinks(COPPER_BAR)
    eq(ns.UI.parts().searchBox:GetText(), "Copper Bar")
    rowNamed(ns, "Copper Chain Pants"):Click()
    _G.IsShiftKeyDown = function() return true end
    ns.UI.parts().details.name:Click()
    _G.IsShiftKeyDown = function() return false end
    eq(linked[#linked], "|cff1eff00|Hitem:2852::::::::4:::::::|h[Copper Chain Pants]|h|r")
    eq(ns.UI.parts().searchBox:GetText(), "Copper Chain Pants", "nothing typed in: searched too")
end)

it("opens your profession at a recipe you know on a click on the item at the top of its details", function()
    local ns = loadAddon({ professionsAddon = true, tradeSkill = "recipe" })
    SlashCmdList.GADB("breastplate")
    rowNamed(ns, "Runed Copper Breastplate"):Click()
    local d = ns.UI.parts().details
    d.name:Fire("OnEnter")
    eq(GameTooltip.lines[1], "Click to open it in Blacksmithing", "said under the item's tooltip")
    d.name:Click()
    eq(opened[1], "recipe 2667", "at the recipe")
    -- Shift-click links it, as before (this item isn't loaded yet: said), and opens nothing.
    _G.IsShiftKeyDown = function() return true end
    d.name:Click()
    eq(#opened, 1); eq(said("doesn't have that item yet"), true)
    _G.IsShiftKeyDown = function() return false end
    -- One this character doesn't know: no hint, and a click does nothing.
    rowNamed(ns, "Ornate Mithril Breastplate"):Click()
    d.name:Fire("OnEnter")
    eq(#GameTooltip.lines, 0)
    d.name:Click()
    eq(#opened, 1)
    -- A game that can only open the profession: its window, by its skill line.
    local ns2 = loadAddon({ professionsAddon = true, tradeSkill = "profession" })
    SlashCmdList.GADB("breastplate")
    rowNamed(ns2, "Runed Copper Breastplate"):Click()
    ns2.UI.parts().details.name:Click()
    eq(opened[1], "profession 164")
    -- One that can't: said.
    local ns3 = loadAddon({ professionsAddon = true })
    SlashCmdList.GADB("breastplate")
    rowNamed(ns3, "Runed Copper Breastplate"):Click()
    ns3.UI.parts().details.name:Click()
    eq(said("the game doesn't let addons open your Blacksmithing window."), true)
end)

it("crafts a recipe you know from the Craft button above it, when your bags hold the reagents", function()
    local ns = loadAddon({ professionsAddon = true, tradeSkill = "recipe" })
    SlashCmdList.GADB("breastplate")
    rowNamed(ns, "Runed Copper Breastplate"):Click()
    local d, recipe = ns.UI.parts().details, ns.UI.parts().state.selected
    eq(d.craft:IsShown(), true, "you know it")
    eq(d.craft:IsEnabled(), false, "nothing in your bags")
    d.craft:Fire("OnEnter")
    eq(GameTooltip.lines[1], "Missing reagents")
    eq(GameTooltip.lines[2], "12 x |cffffffffCopper Bar|r")
    d.craft:Click()
    eq(#opened, 0)
    -- The bags fill (twice the reagents): it says so, and crafts one.
    for _, reagent in ipairs(recipe.reagents) do bags[reagent.item.id] = reagent.count * 2 end
    d.craft:Fire("OnEvent", "BAG_UPDATE_DELAYED")
    eq(d.craft:IsEnabled(), true)
    d.craft:Fire("OnEnter")
    eq(table.concat(GameTooltip.lines, " | "), "Craft Runed Copper Breastplate | You have the reagents for 2.")
    d.craft:Click()
    eq(table.concat(opened, ", "), "recipe 2667, craft 2667 x1", "the window opened at it, then crafted")
    -- One this character doesn't know: no button.
    rowNamed(ns, "Ornate Mithril Breastplate"):Click()
    eq(d.craft:IsShown(), false)
    -- A game that doesn't let addons craft: none either.
    local ns2 = loadAddon({ professionsAddon = true, tradeSkill = "profession" })
    SlashCmdList.GADB("breastplate")
    rowNamed(ns2, "Runed Copper Breastplate"):Click()
    eq(ns2.UI.parts().details.craft:IsShown(), false)
end)

it("tries an item on in the dressing room on ctrl-click: a recipe's, the item it makes", function()
    local ns = loadAddon({ ctrl = true })
    SlashCmdList.GADB("pants")
    rowNamed(ns, "Copper Chain Pants"):Click()
    eq(dressed[1], "|cff1eff00|Hitem:2852::::::::4:::::::|h[Copper Chain Pants]|h|r", "the game's link")
    eq(ns.UI.parts().state.selected, nil, "ctrl-click tries it on, doesn't pick")
    -- An enchant makes no item: a plain click.
    SlashCmdList.GADB("bracer")
    rowNamed(ns, "Enchant Bracer - Minor Health"):Click()
    eq(#dressed, 1)
    eq(ns.UI.parts().state.selected.name, "Enchant Bracer - Minor Health")
    -- A reagent or plans: the item itself; one the game hasn't loaded, by its id.
    SlashCmdList.GADB("breastplate")
    _G.IsControlKeyDown = function() return false end
    rowNamed(ns, "Runed Copper Breastplate"):Click()
    _G.IsControlKeyDown = function() return true end
    ns.UI.parts().details.recipeItems[1]:Click()
    eq(dressed[2], "item:2881")
    ns.UI.parts().details.name:Click()
    eq(#dressed, 3, "the recipe's own name in the details too")
end)

-- Not known yet -----------------------------------------------------------------------------------

it("lists your professions' recipes you don't know yet, from GuildAssistant Professions", function()
    local ns = loadAddon({ professionsAddon = true })
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.unknownCheck:Click()
    -- Luna knows Copper Chain Pants and Runed Copper Breastplate; Cooking has no data here.
    eq(shownRows(ns), "Rough Sharpening Stone, Golden Scale Coif, The Shatterer, Ornate Mithril Breastplate")
    eq(sidebar(ns), "All my professions | Blacksmithing 120/150")
    -- Learnable at 120 skill (green), or not yet (red).
    eq(rowNamed(ns, "Rough Sharpening Stone").skill:GetText(), "|cff40ff4015|r")
    eq(rowNamed(ns, "The Shatterer").skill:GetText(), "|cffff5050235|r")
    eq(parts.statusText:GetText(), "4 recipes")
    parts.unknownCheck:Click()
    eq(#parts.state.results, 8, "all of them again")
end)

it("asks to open a profession's window when GuildAssistant Professions hasn't recorded it", function()
    local ns = loadAddon({ professionsAddon = true })
    GuildAssistantProfessionsDB.characters["Luna-Test Realm"].professions.Blacksmithing.recipes = {}
    SlashCmdList.GADB("")
    ns.UI.parts().unknownCheck:Click()
    has(ns.UI.parts().statusText:GetText(), "Blacksmithing: open its window once to record what you know.")
    eq(#ns.UI.parts().state.results, 6, "nothing known")
end)

it("without GuildAssistant Professions, goes by what the game says you know", function()
    local ns = loadAddon({ knownSpells = { [2660] = true } })
    SlashCmdList.GADB("")
    ns.UI.parts().unknownCheck:Click()
    eq(shownRows(ns), "Copper Chain Pants, Runed Copper Breastplate, Golden Scale Coif, The Shatterer, Ornate Mithril Breastplate")
    has(ns.UI.parts().statusText:GetText(), "known ones are what the game says")
end)

it("a profession picked before isn't kept when only yours are listed", function()
    local ns = loadAddon({ professionsAddon = true })
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.sidebarButtons[3]:Click() -- Enchanting
    parts.unknownCheck:Click()
    eq(parts.state.profession, nil)
    eq(sidebar(ns), "All my professions | Blacksmithing 120/150")
end)

it("works with Classic Era's skill list instead of GetProfessions", function()
    local ns = loadAddon({ professionsAddon = true })
    _G.GetProfessions, _G.GetProfessionInfo = nil, nil
    local lines = { { "Professions", true }, { "Enchanting", false, nil, 80, nil, nil, 150 }, { "Weapon Skills", true }, { "Swords", false, nil, 5, nil, nil, 300 } }
    _G.GetNumSkillLines = function() return #lines end
    _G.GetSkillLineInfo = function(i) return (table.unpack or unpack)(lines[i], 1, 7) end
    SlashCmdList.GADB("")
    ns.UI.parts().unknownCheck:Click()
    eq(sidebar(ns), "All my professions | Enchanting 80/150")
    eq(shownRows(ns), "Enchant Bracer - Minor Health, Greater Magic Wand")
end)

-- Sources companions -------------------------------------------------------------------------------

it("without a sources companion, lists every recipe the game has, and says what it can of each", function()
    local ns = loadAddon({ noSources = true })
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    eq(#parts.state.results, 10)
    eq(sidebar(ns), "All professions 10 | Blacksmithing 8 | Enchanting 2")
    eq(_G.GuildAssistantDatabaseFrame ~= nil, true)
    parts.searchBox:SetText("pants")
    rowNamed(ns, "Copper Chain Pants"):Click()
    eq(parts.details.learn:GetText(), "A trainer or a quest: the game's files don't say which")
    eq(parts.details.learnHover:IsShown(), false, "no sources to hover")
    parts.searchBox:SetText("gauntlets")
    eq(shownRows(ns), "Ironforge Gauntlets")
    parts.filterButton:Click()
    eq(parts.filterPopup.unknownSection:IsShown(), false, "nothing to tick without a companion")
end)

it("with a complete source, hides unknown recipes until 'Show unknown recipes' is ticked", function()
    local ns = loadAddon()
    SlashCmdList.GADB("gauntlets")
    local parts = ns.UI.parts()
    eq(shownRows(ns), "")
    parts.filterButton:Click()
    eq(parts.filterPopup.unknownSection:IsShown(), true)
    eq(parts.filterPopup.unvouched:GetChecked(), false, "unticked at first")
    parts.filterPopup.unvouched:Click()
    eq(shownRows(ns), "Ironforge Gauntlets")
    eq(parts.filterButton:GetText(), "Filter", "not counted as a filter")
    rowNamed(ns, "Ironforge Gauntlets"):Click()
    has(parts.details.learn:GetText(), "No known source: unreleased, removed, or not recorded yet")
    parts.searchBox:SetText("")
    eq(sidebar(ns), "All professions 10 | Blacksmithing 8 | Enchanting 2", "counted too")
    -- A preference, not a filter: Clear and Reset leave it.
    parts.filterPopup.clear:Click()
    parts.resetButton:Click()
    eq(parts.filterPopup.unvouched:GetChecked(), true)
    eq(sidebar(ns), "All professions 10 | Blacksmithing 8 | Enchanting 2")
    -- Unticked again: hidden again.
    parts.filterPopup.unvouched:Click()
    eq(sidebar(ns), "All professions 8 | Blacksmithing 6 | Enchanting 2")
end)

it("remembers 'Show unknown recipes' in the saved data, across sessions", function()
    local ns = loadAddon()
    SlashCmdList.GADB("")
    ns.UI.parts().filterPopup.unvouched:Click()
    eq(GuildAssistantDatabaseDB.showUnknown, true, "saved")
    -- Next session: still ticked, and unknown recipes show from the start.
    local again = loadAddon({ saved = { showUnknown = true } })
    SlashCmdList.GADB("")
    eq(again.UI.parts().filterPopup.unvouched:GetChecked(), true)
    eq(#again.UI.parts().state.results, 10)
    again.UI.parts().filterPopup.unvouched:Click()
    eq(GuildAssistantDatabaseDB.showUnknown, false, "unticked: saved too")
end)

it("names an item the game's tables lack: the game's name in play, or the companion's", function()
    local ns = loadAddon({ noSources = true, itemNames = { [11083] = "Soul Dust" } })
    SlashCmdList.GADB("wand")
    rowNamed(ns, "Greater Magic Wand"):Click()
    eq(ns.UI.parts().details.reagents[2].text:GetText(), "1 x |cffffffffSoul Dust|r")
    local unknown = loadAddon({ noSources = true })
    SlashCmdList.GADB("wand")
    rowNamed(unknown, "Greater Magic Wand"):Click()
    eq(unknown.UI.parts().details.reagents[2].text:GetText(), "1 x |cffffffffItem 11083|r", "until the game knows it")
    local withCompanion = loadAddon()
    SlashCmdList.GADB("wand")
    rowNamed(withCompanion, "Greater Magic Wand"):Click()
    eq(withCompanion.UI.parts().details.reagents[2].text:GetText(), "1 x |cffffffffSoul Dust|r")
end)

it("shows the companion's stat values, and the icons from the game's data", function()
    local ns = loadAddon()
    SlashCmdList.GADB("ornate")
    local row = rowNamed(ns, "Ornate Mithril Breastplate")
    eq(row.icon._texture, 132745)
    row:Click()
    has(ns.UI.parts().details.info:GetText(), "Chest (Plate), 463 Armor, +14 Critical Strike Rating, +12 Dodge Rating")
end)

it("shows what GuildAssistant Professions saw: a vendor, a trainer, and a recipe the seed lacks", function()
    local ns = loadAddon({ professionsAddon = true })
    local db = GuildAssistantProfessionsDB
    -- A guildmate knows Ironforge Gauntlets, which the complete source doesn't list.
    db.characters["Ana-Test Realm"].professions.Blacksmithing.recipes["spell:99001"] = true
    db.sources = {
        items = { [6047] = { ["V:Booty Bay=Narkk"] = 1 } },
        recipes = { ["item:7954"] = { cost = 20000, trainers = { ["Ironforge=Bengus Deepforge"] = 1 } } },
    }
    SlashCmdList.GADB("gauntlets")
    eq(shownRows(ns), "Ironforge Gauntlets", "known by a guildmate: shown")
    ns.UI.parts().searchBox:SetText("coif")
    rowNamed(ns, "Golden Scale Coif"):Click()
    eq(ns.UI.parts().details.learn:GetText():match("^[^\n]*\n[^\n]*"), "Vendor: Krinkle Goodsteel (Tanaris)\nVendor: Narkk (Booty Bay)")
    ns.UI.parts().searchBox:SetText("shatterer")
    rowNamed(ns, "The Shatterer"):Click()
    has(ns.UI.parts().details.learn:GetText(), "Trainer (2g): Bengus Deepforge (Ironforge)")
end)

-- The Guild tab ----------------------------------------------------------------------------------

-- The Guild tab's rows as they read, colours left out: "Ana 300 Blacksmithing - Weaponsmith".
local function memberRows(ns)
    local out = {}
    for _, row in ipairs(ns.UI.parts().memberRows) do
        if row:IsShown() then
            local text = ("%s %s %s"):format(row.name:GetText(), row.skill:GetText(), row.profession:GetText())
            out[#out + 1] = (text:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("  +", " "))
        end
    end
    return table.concat(out, " | ")
end

-- guildDB, and: Ana is a Weaponsmith (the spell: GuildAssistant Professions 1.5.0 records it), Kael
-- knows a Master Swordsmith's recipe (so he's one, and a Weaponsmith) and is an herbalist.
local function guildWithSpecializations()
    guildDB()
    local db = GuildAssistantProfessionsDB
    db.characters["Ana-Test Realm"].professions.Blacksmithing.recipes["spell:9787"] = true
    db.characters["Kael-Test Realm"] = { name = "Kael", realm = "Test Realm", class = "MAGE", source = "guild",
        guild = "Test Guild", professions = {
            Blacksmithing = { rank = 300, max = 300, recipes = { ["spell:99003"] = true } },
            Herbalism = { rank = 225, max = 300, recipes = {} },
        } }
end

it("shows the Guild tab only with GuildAssistant Professions, and Recipes' own controls only there", function()
    local ns = loadAddon()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    eq(parts.tabs[1]:IsShown(), false, "no tabs without it"); eq(parts.tabs[2]:IsShown(), false)
    ns = loadAddon({ professionsAddon = true, guild = "Test Guild" })
    SlashCmdList.GADB("")
    parts = ns.UI.parts()
    eq(parts.tabs[1]:GetText(), "Recipes"); eq(parts.tabs[2]:GetText(), "Guild")
    eq(parts.tabs[1]:IsShown(), true)
    eq(parts.tabs[1]:IsEnabled(), false, "Recipes picked"); eq(parts.tabs[2]:IsEnabled(), true)
    parts.searchBox:SetText("breastplate")
    parts.tabs[2]:Click()
    eq(parts.state.tab, "guild")
    eq(parts.tabs[2]:IsEnabled(), false, "Guild picked")
    for _, control in ipairs({ parts.minLevelBox, parts.maxSkillBox, parts.filterButton, parts.unknownCheck }) do
        eq(control:IsShown(), false, "Recipes' own")
    end
    eq(parts.searchBox:GetText(), "", "each tab its own search")
    eq(parts.crumb:GetText(), "|cffffd100Test Guild|r: guildmates who use GuildAssistant Professions")
    eq(parts.details.hint:GetText():sub(1, 44), "Click a guildmate to see what they can make.")
    parts.tabs[1]:Click()
    eq(parts.searchBox:GetText(), "breastplate", "Recipes' search kept")
    eq(parts.minLevelBox:IsShown(), true)
    eq(parts.crumb:IsShown(), false)
    eq(shownRows(ns), "Runed Copper Breastplate, Ornate Mithril Breastplate")
end)

it("lists the guildmates by profession, with their skill and specialization, and finds them", function()
    local ns = loadAddon({ professionsAddon = true, guild = "Test Guild" })
    guildWithSpecializations()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.tabs[2]:Click()
    eq(memberRows(ns), "Ana 300 Blacksmithing - Weaponsmith | Kael 300 Blacksmithing - Master Swordsmith"
        .. " | Luna (you) 120 Blacksmithing | Di (alt) Enchanting | Kael 225 Herbalism")
    eq(sidebar(ns), "All professions 5 | Blacksmithing 3 | Enchanting 1 | Herbalism 1")
    eq(parts.statusText:GetText(), "4 guildmates")
    -- By specialization: Kael's a Master Swordsmith, so a Weaponsmith too.
    parts.searchBox:SetText("weaponsmith")
    eq(memberRows(ns), "Ana 300 Blacksmithing - Weaponsmith | Kael 300 Blacksmithing - Master Swordsmith")
    eq(sidebar(ns), "All professions " .. GOLD .. "2|r | Blacksmithing " .. GOLD .. "2|r | Enchanting | Herbalism", "counted in gold")
    parts.searchBox:SetText("kael")
    eq(memberRows(ns), "Kael 300 Blacksmithing - Master Swordsmith | Kael 225 Herbalism")
    parts.searchBox:SetText("")
    parts.sidebarButtons[3]:Click()
    eq(memberRows(ns), "Di (alt) Enchanting", "one profession")
    eq(parts.statusText:GetText(), "1 guildmate")
    parts.resetButton:Click()
    eq(parts.state.profession, nil, "Reset")
    eq(#parts.state.members, 5)
end)

it("lists what a guildmate can make on a click, with their details, and goes back as it was", function()
    local ns = loadAddon({ professionsAddon = true, guild = "Test Guild" })
    guildWithSpecializations()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.tabs[2]:Click()
    parts.searchBox:SetText("blacksmithing")
    parts.memberRows[1]:Fire("OnEnter")
    eq(GameTooltip.lines[1], "Ana"); eq(GameTooltip.lines[3], "Click to see what they can make")
    parts.memberRows[1]:Click()
    eq(parts.state.member.name, "Ana")
    eq(parts.searchBox:GetText(), "", "her recipes, all of them")
    eq(shownRows(ns), "Runed Copper Breastplate, Ornate Mithril Breastplate")
    eq(parts.memberRows[1]:IsShown(), false)
    eq(parts.backButton:IsShown(), true)
    eq(parts.crumb:GetText(), "|cffffffffAna|r  300 Blacksmithing - Weaponsmith")
    eq(parts.statusText:GetText(), "Ana can make 2 recipes.")
    local summary = parts.details.summary
    eq(summary:IsShown(), true); eq(parts.details.hint:IsShown(), false)
    has(summary:GetText(), "Guildmate"); has(summary:GetText(), "300/300 Blacksmithing - Weaponsmith")
    -- Her recipes searched, and one picked: its details, as in Recipes.
    parts.searchBox:SetText("ornate")
    eq(shownRows(ns), "Ornate Mithril Breastplate")
    eq(parts.statusText:GetText(), "Ana can make 1 recipe that match.")
    rowNamed(ns, "Ornate Mithril Breastplate"):Click()
    eq(summary:IsShown(), false)
    has(parts.details.name.text:GetText(), "Ornate Mithril Breastplate")
    -- Back: the guildmates, as searched before.
    parts.backButton:Click()
    eq(parts.state.member, nil)
    eq(parts.searchBox:GetText(), "blacksmithing")
    eq(memberRows(ns), "Ana 300 Blacksmithing - Weaponsmith | Kael 300 Blacksmithing - Master Swordsmith | Luna (you) 120 Blacksmithing")
    -- An herbalist makes nothing; a profession picked on the left goes back too.
    parts.searchBox:SetText("herbalism")
    parts.memberRows[1]:Click()
    eq(parts.statusText:GetText(), "Nothing to make with Herbalism.")
    has(parts.details.summary:GetText(), "300/300 Blacksmithing - Master Swordsmith")
    has(parts.details.summary:GetText(), "225/300 Herbalism")
    parts.sidebarButtons[2]:Click()
    eq(parts.state.member, nil)
    eq(parts.state.profession, "Blacksmithing")
end)

it("sorts a guildmate's recipes the same way, the titles only above a list of recipes", function()
    local ns = loadAddon({ professionsAddon = true, guild = "Test Guild" })
    guildDB()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.tabs[2]:Click()
    eq(parts.columnSkill:IsShown(), false, "the guildmates have their own titles")
    parts.memberRows[1]:Click()
    eq(parts.state.member.name, "Ana")
    eq(parts.columnSkill:IsShown(), true, "her recipes have Skill and Level")
    -- What she can make, as Recipes lists it: by skill while nothing has narrowed it down.
    eq(shownRows(ns), "Runed Copper Breastplate, Ornate Mithril Breastplate")
    eq(chevron(parts.columnSkill), "up gold"); eq(chevron(parts.columnLevel), "none")
    -- By level, highest first (Ornate Mithril Breastplate 43, Runed Copper Breastplate 13).
    parts.columnLevel:Click()
    parts.columnLevel:Click()
    eq(chevron(parts.columnLevel), "down gold"); eq(chevron(parts.columnSkill), "up grey")
    eq(shownRows(ns), "Ornate Mithril Breastplate, Runed Copper Breastplate")
    -- Back to the guildmates: their own titles again, and Reset puts the order back.
    parts.backButton:Click()
    eq(parts.columnLevel:IsShown(), false)
    parts.memberRows[1]:Click()
    eq(shownRows(ns), "Ornate Mithril Breastplate, Runed Copper Breastplate", "kept")
    parts.resetButton:Click()
    eq(parts.state.member, nil)
    parts.memberRows[1]:Click()
    eq(shownRows(ns), "Runed Copper Breastplate, Ornate Mithril Breastplate")
    eq(chevron(parts.columnLevel), "none")
end)

-- A Guild tab title, by the column it sorts.
local function memberHeader(parts, column)
    for _, header in ipairs(parts.memberHeaders) do
        if header.column == column then return header end
    end
end

local BY_PROFESSION = "Ana 300 Blacksmithing - Weaponsmith | Kael 300 Blacksmithing - Master Swordsmith"
    .. " | Luna (you) 120 Blacksmithing | Di (alt) Enchanting | Kael 225 Herbalism"

it("sorts the guildmates by Name, Skill or Profession, with the same chevrons", function()
    local ns = loadAddon({ professionsAddon = true, guild = "Test Guild" })
    guildWithSpecializations()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.tabs[2]:Click()
    local name, skill, profession = memberHeader(parts, "name"), memberHeader(parts, "skill"),
        memberHeader(parts, "profession")
    eq(name.title:GetText(), "Name"); eq(skill.title:GetText(), "Skill")
    eq(profession.title:GetText(), "Profession")
    -- As the tab has always listed them: by profession, each profession's highest skill first.
    eq(chevron(profession), "up gold"); eq(chevron(skill), "down grey"); eq(chevron(name), "none")
    eq(memberRows(ns), BY_PROFESSION)
    -- By name, A to Z: one character's rows (Kael's two professions) stay together.
    name:Click()
    eq(chevron(name), "up gold"); eq(chevron(profession), "up grey"); eq(chevron(skill), "down grey")
    eq(memberRows(ns), "Ana 300 Blacksmithing - Weaponsmith | Di (alt) Enchanting"
        .. " | Kael 300 Blacksmithing - Master Swordsmith | Kael 225 Herbalism | Luna (you) 120 Blacksmithing")
    eq(GameTooltip.lines[1], "Name", "the tooltip says so after the click")
    eq(GameTooltip.lines[2], "The guildmate's name, your own characters in the guild among them.")
    eq(GameTooltip.lines[3], "Sorted by name, A to Z, then by profession, A to Z, then by skill, highest first.")
    eq(GameTooltip.lines[4], "Click to list them Z to A.")
    -- And again, Z to A.
    name:Click()
    eq(chevron(name), "down gold")
    eq(memberRows(ns), "Luna (you) 120 Blacksmithing | Kael 300 Blacksmithing - Master Swordsmith"
        .. " | Kael 225 Herbalism | Di (alt) Enchanting | Ana 300 Blacksmithing - Weaponsmith")
    -- Reset puts the order back, and Skill lists the highest first (Di's Enchanting has none).
    parts.resetButton:Click()
    eq(chevron(profession), "up gold"); eq(chevron(name), "none")
    eq(memberRows(ns), BY_PROFESSION)
    skill:Click()
    eq(chevron(skill), "down gold"); eq(chevron(profession), "up grey"); eq(chevron(name), "up grey")
    eq(memberRows(ns), "Ana 300 Blacksmithing - Weaponsmith | Kael 300 Blacksmithing - Master Swordsmith"
        .. " | Kael 225 Herbalism | Luna (you) 120 Blacksmithing | Di (alt) Enchanting")
    skill:Fire("OnEnter")
    eq(GameTooltip.lines[2], "Their skill in the profession.")
    eq(GameTooltip.lines[4], "Click to list the lowest first.")
    skill:Click()
    eq(memberRows(ns), "Di (alt) Enchanting | Luna (you) 120 Blacksmithing | Kael 225 Herbalism"
        .. " | Ana 300 Blacksmithing - Weaponsmith | Kael 300 Blacksmithing - Master Swordsmith")
    -- Profession again, the skill it left behind now lowest first.
    profession:Click()
    eq(chevron(profession), "up gold"); eq(chevron(skill), "up grey")
    eq(memberRows(ns), "Luna (you) 120 Blacksmithing | Ana 300 Blacksmithing - Weaponsmith"
        .. " | Kael 300 Blacksmithing - Master Swordsmith | Di (alt) Enchanting | Kael 225 Herbalism")
end)

it("keeps the guildmates' order through a search, a guildmate and the other tab", function()
    local ns = loadAddon({ professionsAddon = true, guild = "Test Guild" })
    guildWithSpecializations()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.tabs[2]:Click()
    memberHeader(parts, "name"):Click()
    parts.searchBox:SetText("blacksmithing")
    eq(memberRows(ns), "Ana 300 Blacksmithing - Weaponsmith | Kael 300 Blacksmithing - Master Swordsmith"
        .. " | Luna (you) 120 Blacksmithing", "what matched, by name")
    eq(parts.state.offset, 0)
    -- A guildmate's recipes have Skill and Level above them instead; Back, and the names again.
    parts.memberRows[1]:Click()
    for _, header in ipairs(parts.memberHeaders) do eq(header:IsShown(), false, "the guildmates' titles") end
    eq(parts.columnSkill:IsShown(), true)
    parts.backButton:Click()
    eq(memberHeader(parts, "name"):IsShown(), true); eq(parts.columnSkill:IsShown(), false)
    eq(chevron(memberHeader(parts, "name")), "up gold", "kept")
    -- And kept while Recipes is shown.
    parts.tabs[1]:Click()
    eq(memberHeader(parts, "name"):IsShown(), false)
    parts.tabs[2]:Click()
    eq(chevron(memberHeader(parts, "name")), "up gold")
    eq(memberRows(ns), "Ana 300 Blacksmithing - Weaponsmith | Kael 300 Blacksmithing - Master Swordsmith"
        .. " | Luna (you) 120 Blacksmithing")
end)

it("switches to Recipes for a search from /gadb or a shift-click, and says when you're in no guild", function()
    local ns = loadAddon({ professionsAddon = true })
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.tabs[2]:Click()
    eq(parts.statusText:GetText(), "You're not in a guild: this tab lists your guildmates' professions.")
    eq(memberRows(ns), "")
    SlashCmdList.GADB("pants")
    eq(parts.state.tab, "recipes")
    eq(parts.searchBox:GetText(), "pants")
    eq(shownRows(ns), "Copper Chain Pants")
end)

it("doesn't hide anything because of GuildAssistant Professions alone", function()
    local ns = loadAddon({ noSources = true, professionsAddon = true })
    SlashCmdList.GADB("")
    eq(#ns.UI.parts().state.results, 10, "only a complete source hides recipes")
    ns.UI.parts().filterButton:Click()
    eq(ns.UI.parts().filterPopup.unknownSection:IsShown(), false)
end)

-- The Attunements tab -----------------------------------------------------------------------------

local TICK = "|TInterface\\Buttons\\UI-CheckBox-Check:18:18|t"

-- The rows as they read: the name, then each raid's mark.
local function attuneRows(ns)
    local out = {}
    for _, row in ipairs(ns.UI.parts().attuneRows) do
        if row:IsShown() then
            local marks = {}
            for _, mark in ipairs(row.marks) do
                if mark:IsShown() then marks[#marks + 1] = mark:GetText() end
            end
            out[#out + 1] = row.name:GetText() .. " " .. table.concat(marks, " ")
        end
    end
    return table.concat(out, " | ")
end

-- Luna (you) attuned to Onyxia, Ana (a guildmate) looked at and not, Di (your alt) never looked at.
local function attunementsDB()
    local db = GuildAssistantProfessionsDB
    db.characters["Luna-Test Realm"].guild = "Test Guild"
    db.characters["Luna-Test Realm"].attunements = { ony = true }
    db.characters["Ana-Test Realm"].guild = "Test Guild"
    db.characters["Ana-Test Realm"].attunements = { ony = false }
    db.characters["Di-Test Realm"] = { name = "Di", realm = "Test Realm", source = "own",
        guild = "Test Guild", professions = {} }
end

it("lists every guildmate with a tick for each raid they are attuned to", function()
    local ns = loadAddon({ professionsAddon = true, guild = "Test Guild" })
    attunementsDB()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    eq(parts.tabs[3]:GetText(), "Attunements")
    parts.tabs[3]:Click()
    eq(parts.state.tab, "attunements")
    eq(parts.tabs[3]:IsEnabled(), false, "picked")
    eq(parts.crumb:GetText(), "|cffffd100Test Guild|r: which raids each guildmate is attuned to")
    eq(attuneRows(ns), ("|cff3fc7ebLuna|r |cff808080(you)|r %s | |cffffffffAna|r |cff808080-|r"
        .. " | |cffffffffDi|r |cff808080(alt)|r |cff808080?|r"):format(TICK))
    eq(parts.attuneColumns[1]:IsShown(), true)
    eq(parts.attuneColumns[1].title:GetText(), "Onyxia")
    eq(parts.attuneColumns[2]:IsShown(), false, "only the raids there are")
    parts.attuneColumns[1]:Fire("OnEnter")
    eq(GameTooltip.lines[1], "Onyxia's Lair")
    eq(GameTooltip.lines[2], "Who in your guild is attuned to it.")
    eq(parts.statusText:GetText(), "3 guildmates")
    -- The raids on the left, with how many are attuned to each.
    eq(sidebar(ns), "All guildmates 3 | Onyxia's Lair 1")
    -- Recipes' own controls are away, as on the Guild tab.
    for _, control in ipairs({ parts.minLevelBox, parts.filterButton, parts.unknownCheck }) do
        eq(control:IsShown(), false, "Recipes' own")
    end
    eq(parts.details.hint:GetText():sub(1, 57), "Click a guildmate to see which raids they are attuned to.")
end)

it("shows a guildmate's raids one by one when you click them, and says what isn't known", function()
    local ns = loadAddon({ professionsAddon = true, guild = "Test Guild" })
    attunementsDB()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.tabs[3]:Click()
    parts.attuneRows[1]:Click()
    local summary = parts.details.summary
    eq(summary:IsShown(), true)
    has(summary:GetText(), "|cff3fc7ebLuna|r")
    has(summary:GetText(), "Onyxia's Lair: |cff40ff40Attuned|r")
    eq(parts.attuneRows[1].selected:IsShown(), true, "the row is marked")
    parts.attuneRows[2]:Click()
    has(parts.details.summary:GetText(), "Onyxia's Lair: |cff808080Not attuned|r")
    parts.attuneRows[3]:Click()
    has(parts.details.summary:GetText(), "Onyxia's Lair: |cff808080Not known|r")
    has(parts.details.summary:GetText(), "hasn't looked")
    -- Hovering a row says the same, shorter.
    parts.attuneRows[1]:Fire("OnEnter")
    eq(GameTooltip.lines[1], "Luna")
    eq(GameTooltip.lines[2], TICK .. " Onyxia's Lair")
    eq(GameTooltip.lines[3], "Click for their attunements")
end)

it("keeps a raid picked on the left, the search and the pick while another tab shows", function()
    local ns = loadAddon({ professionsAddon = true, guild = "Test Guild" })
    attunementsDB()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.tabs[3]:Click()
    parts.sidebarButtons[2]:Click() -- Onyxia's Lair
    eq(parts.state.raid, "ony")
    eq(attuneRows(ns), "|cff3fc7ebLuna|r |cff808080(you)|r " .. TICK, "only those attuned")
    parts.searchBox:SetText("di")
    ns.UI.refresh()
    eq(attuneRows(ns), "", "Di isn't attuned")
    eq(parts.statusText:GetText(), "No one known is attuned to Onyxia's Lair yet.")
    parts.sidebarButtons[1]:Click() -- all of them
    eq(attuneRows(ns), "|cffffffffDi|r |cff808080(alt)|r |cff808080?|r")
    eq(sidebar(ns), "All guildmates 1 | Onyxia's Lair 0", "counted among those the search keeps")
    -- Recipes, and back: its own search, and the raid picked.
    parts.tabs[1]:Click()
    eq(parts.attuneRows[1]:IsShown(), false)
    eq(parts.attuneColumns[1]:IsShown(), false)
    eq(parts.searchBox:GetText(), "")
    parts.tabs[3]:Click()
    eq(parts.searchBox:GetText(), "di", "the tab's own search")
end)

it("shows a guildmate's attunements on their page in the Guild tab too", function()
    local ns = loadAddon({ professionsAddon = true, guild = "Test Guild" })
    attunementsDB()
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.tabs[2]:Click()
    parts.memberRows[1]:Click() -- Ana: a guildmate with Blacksmithing
    local summary = parts.details.summary
    has(summary:GetText(), "300/300 Blacksmithing", "her profession")
    has(summary:GetText(), "|cffffd100Attunements|r")
    has(summary:GetText(), "Onyxia's Lair: |cff808080Not attuned|r")
end)

it("says when you're in no guild, and shows nothing of attunements without the addon", function()
    local ns = loadAddon({ professionsAddon = true })
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.tabs[3]:Click()
    eq(parts.statusText:GetText(), "You're not in a guild: this tab lists your guildmates' attunements.")
    eq(attuneRows(ns), "")
    -- Without GuildAssistant Professions there are no tabs at all.
    ns = loadAddon({ guild = "Test Guild" })
    SlashCmdList.GADB("")
    eq(ns.UI.parts().tabs[3]:IsShown(), false)
end)

it("brings a raid picked on the left into view when there are more than the columns", function()
    local ns = loadAddon({ professionsAddon = true, guild = "Test Guild" })
    attunementsDB()
    local attunements = GuildAssistantProfessionsDB.characters["Luna-Test Realm"].attunements
    for i = 1, 6 do attunements["r" .. i] = i == 6 end
    SlashCmdList.GADB("")
    local parts = ns.UI.parts()
    parts.tabs[3]:Click()
    local titles = {}
    for _, header in ipairs(parts.attuneColumns) do
        if header:IsShown() then titles[#titles + 1] = header.title:GetText() end
    end
    eq(table.concat(titles, " "), "Onyxia r1 r2 r3 r4", "five columns, the sixth raid left out")
    has(parts.statusText:GetText(), "2 more raids: click a guildmate, or pick one on the left.")
    -- Picking the one left out brings it first.
    for _, button in ipairs(parts.sidebarButtons) do
        if button:IsShown() and button.text:GetText() == "r6" then button:Click() end
    end
    eq(parts.attuneColumns[1].title:GetText(), "r6")
    eq(attuneRows(ns), "|cff3fc7ebLuna|r |cff808080(you)|r " .. TICK .. " " .. TICK
        .. " |cff808080-|r |cff808080-|r |cff808080-|r")
end)

print(("%d passed, %d failed"):format(passed, failed))
if failed > 0 then error(failed .. " failed") end
