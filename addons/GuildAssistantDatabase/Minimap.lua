-- GuildAssistant Database: the minimap button, GuildAssistant's clip. Click it to open or close
-- the window (as /gadb does); drag it around the minimap's edge. Where it sits, and whether it's
-- shown (/gadb minimap), is saved for the account (GuildAssistantDatabaseDB). Laid out like the
-- game's own minimap buttons (the tracking button's round border and background).

local _, ns = ...
local Core, UI = ns.Core, ns.UI
local MinimapButton = {}
ns.MinimapButton = MinimapButton

local ICON = "Interface\\AddOns\\GuildAssistantDatabase\\Media\\Icon"
local DEFAULT_ANGLE = 210 -- degrees from the minimap's right, counter-clockwise: lower left

local button

--- The saved settings of the button: { angle, hidden }.
local function settings()
    GuildAssistantDatabaseDB = type(GuildAssistantDatabaseDB) == "table" and GuildAssistantDatabaseDB or {}
    local db = GuildAssistantDatabaseDB
    if type(db.minimap) ~= "table" then db.minimap = {} end
    db.minimap.angle = tonumber(db.minimap.angle) or DEFAULT_ANGLE
    return db.minimap
end

-- Just outside the minimap's round edge.
local function place()
    local radius = (Minimap:GetWidth() or 140) / 2 + 10
    local x, y = Core.minimapOffset(settings().angle, radius)
    button:ClearAllPoints()
    button:SetPoint("CENTER", Minimap, "CENTER", x, y)
end

-- While dragging: the angle from the minimap's centre to the cursor.
local function follow()
    local centerX, centerY = Minimap:GetCenter()
    local cursorX, cursorY = GetCursorPosition()
    local scale = Minimap:GetEffectiveScale()
    settings().angle = Core.angleTo(cursorX / scale - centerX, cursorY / scale - centerY)
    place()
end

local function showTooltip(self)
    if not GameTooltip then return end
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    GameTooltip:AddLine("GuildAssistant Database")
    GameTooltip:AddLine("Click to open or close it.", 1, 1, 1)
    GameTooltip:AddLine("Drag to move it around the minimap.", 1, 1, 1)
    GameTooltip:AddLine("/gadb minimap hides it.", 0.6, 0.6, 0.6)
    GameTooltip:Show()
end

--- Makes the button (once), where it was left, unless it was hidden.
function MinimapButton.create()
    if button or not Minimap then return end
    button = CreateFrame("Button", "GuildAssistantDatabaseMinimapButton", Minimap)
    button:SetSize(31, 31)
    button:SetFrameStrata("MEDIUM")
    button:SetFrameLevel(8)
    button:RegisterForClicks("AnyUp")
    button:RegisterForDrag("LeftButton")
    button:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight")
    local background = button:CreateTexture(nil, "BACKGROUND")
    background:SetSize(20, 20)
    background:SetTexture("Interface\\Minimap\\UI-Minimap-Background")
    background:SetPoint("TOPLEFT", button, "TOPLEFT", 7, -5)
    local icon = button:CreateTexture(nil, "ARTWORK")
    icon:SetSize(19, 19)
    icon:SetTexture(ICON)
    icon:SetPoint("TOPLEFT", button, "TOPLEFT", 6, -5)
    button.icon = icon
    local border = button:CreateTexture(nil, "OVERLAY")
    border:SetSize(53, 53)
    border:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
    border:SetPoint("TOPLEFT", button, "TOPLEFT", 0, 0)

    button:SetScript("OnClick", function() ns.safely(UI.toggle) end)
    button:SetScript("OnDragStart", function(self)
        if GameTooltip then GameTooltip:Hide() end
        self:SetScript("OnUpdate", function() ns.safely(follow) end)
    end)
    button:SetScript("OnDragStop", function(self) self:SetScript("OnUpdate", nil) end)
    button:SetScript("OnEnter", showTooltip)
    button:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
    place()
    if settings().hidden then button:Hide() end
end

--- Shows the button if hidden, hides it if shown (remembered). Returns whether it's shown now.
function MinimapButton.toggle()
    if not button then MinimapButton.create() end
    if not button then return false end
    local hidden = button:IsShown()
    settings().hidden = hidden
    if hidden then button:Hide() else button:Show() end
    return not hidden
end
