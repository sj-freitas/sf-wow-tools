-- Raidsort: the two windows. The main one ("Raid Sort") uploads a setup and, once one is loaded,
-- sorts the raid; the upload one takes the pasted setup. Both are standard Blizzard frames and
-- buttons, move by dragging the title, and close with Escape.

local _, ns = ...
local Core = ns.Core
local UI = {}
ns.UI = UI

local BUTTON_HEIGHT = 24
local BUTTON_GAP = 10
local PLACEHOLDER = 'Paste the raid setup here. For example:\n\n'
    .. '{\n  { "Dark Shivan", "Wwolf Test" },\n  { "Some Name", { name = "Other Name", assist = true } },\n'
    .. '  masterLooter = "Some Name",\n}\n\n'
    .. 'Players can also have leader, mainTank, mainAssist and mark = "skull".'

--- A movable dialog window with a title bar and a close (X) button, closed by Escape.
local function newWindow(name, width, height)
    local frame = CreateFrame("Frame", name, UIParent, "BasicFrameTemplateWithInset")
    frame:SetSize(width, height)
    frame:SetPoint("CENTER")
    frame:SetFrameStrata("DIALOG")
    frame:SetToplevel(true)
    frame:SetClampedToScreen(true)
    frame:EnableMouse(true)
    frame:SetMovable(true)
    frame:RegisterForDrag("LeftButton")
    frame:SetScript("OnDragStart", frame.StartMoving)
    frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
    frame:Hide()

    local title = frame.TitleText
    if not title then
        title = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
        title:SetPoint("CENTER", frame.TitleBg or frame, frame.TitleBg and "CENTER" or "TOP", 0, frame.TitleBg and 0 or -12)
    end
    frame.title = title

    tinsert(UISpecialFrames, name)
    return frame
end

local function newButton(parent, text, onClick)
    local button = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    button:SetText(text)
    button:SetHeight(BUTTON_HEIGHT)
    button:SetWidth(math.max(100, button:GetFontString():GetStringWidth() + 32))
    button:SetScript("OnClick", onClick)
    return button
end

--- Shows only `buttons`, side by side and centred along the bottom of `frame`.
local function layoutButtons(frame, all, buttons)
    for _, button in ipairs(all) do button:Hide() end
    local width = -BUTTON_GAP
    for _, button in ipairs(buttons) do width = width + button:GetWidth() + BUTTON_GAP end
    local x = -width / 2
    for _, button in ipairs(buttons) do
        button:ClearAllPoints()
        button:SetPoint("BOTTOMLEFT", frame, "BOTTOM", x, 14)
        button:Show()
        x = x + button:GetWidth() + BUTTON_GAP
    end
    frame:SetWidth(math.max(300, width + 48))
end

-- The main window ------------------------------------------------------------------------------

local main, mainButtons, summary
local uploadButton, reuploadButton, sortButton, closeButton

local function buildMain()
    main = newWindow("RaidsortFrame", 320, 104)

    summary = main:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    summary:SetPoint("TOP", main, "TOP", 0, -38)

    uploadButton = newButton(main, "Upload Config", function() UI.showUpload() end)
    reuploadButton = newButton(main, "Re-upload Config", function() UI.showUpload() end)
    sortButton = newButton(main, "Sort", function() ns.Raid.sort(ns.setup) end)
    closeButton = newButton(main, CLOSE or "Close", function() main:Hide() end)
    mainButtons = { uploadButton, reuploadButton, sortButton, closeButton }
end

--- Brings the main window up to date with the loaded setup (or its absence).
function UI.refresh()
    if not main then return end
    if ns.setup then
        main.title:SetText("Raid Sort (Config Loaded)")
        summary:SetText(Core.describe(ns.setup))
        layoutButtons(main, mainButtons, { reuploadButton, sortButton, closeButton })
    else
        main.title:SetText("Raid Sort")
        summary:SetText("No raid setup loaded yet.")
        layoutButtons(main, mainButtons, { uploadButton, closeButton })
    end
end

function UI.showMain()
    if not main then buildMain() end
    UI.refresh()
    main:Show()
end

function UI.toggleMain()
    if main and main:IsShown() then main:Hide() else UI.showMain() end
end

-- The upload window ----------------------------------------------------------------------------

local upload, editBox, placeholder, problem

local function buildUpload()
    upload = newWindow("RaidsortUploadFrame", 480, 400)
    upload.title:SetText("Raid Sort")

    -- The text area: a dark, bordered box like the chat's, scrolling when the setup is long.
    local area = CreateFrame("Frame", nil, upload, BackdropTemplateMixin and "BackdropTemplate" or nil)
    area:SetPoint("TOPLEFT", upload, "TOPLEFT", 14, -32)
    area:SetPoint("BOTTOMRIGHT", upload, "BOTTOMRIGHT", -14, 66)
    area:SetBackdrop({
        bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
        edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
        tile = true, tileSize = 16, edgeSize = 16,
        insets = { left = 4, right = 4, top = 4, bottom = 4 },
    })
    area:SetBackdropColor(0, 0, 0, 0.75)
    area:SetBackdropBorderColor(0.6, 0.6, 0.6, 1)
    area:EnableMouse(true)

    local scroll = CreateFrame("ScrollFrame", "RaidsortUploadScroll", area, "UIPanelScrollFrameTemplate")
    scroll:SetPoint("TOPLEFT", area, "TOPLEFT", 8, -8)
    scroll:SetPoint("BOTTOMRIGHT", area, "BOTTOMRIGHT", -28, 8)

    editBox = CreateFrame("EditBox", nil, scroll)
    editBox:SetMultiLine(true)
    editBox:SetAutoFocus(false)
    editBox:SetFontObject(ChatFontNormal)
    editBox:SetMaxLetters(0)
    editBox:SetWidth(400)
    editBox:SetHeight(200)
    scroll:SetScrollChild(editBox)
    scroll:SetScript("OnSizeChanged", function(_, width) editBox:SetWidth(width) end)
    area:SetScript("OnMouseDown", function() editBox:SetFocus() end)
    editBox:SetScript("OnEscapePressed", editBox.ClearFocus)

    placeholder = area:CreateFontString(nil, "OVERLAY", "GameFontDisable")
    placeholder:SetPoint("TOPLEFT", scroll, "TOPLEFT", 2, -2)
    placeholder:SetPoint("RIGHT", scroll, "RIGHT", 0, 0)
    placeholder:SetJustifyH("LEFT")
    placeholder:SetJustifyV("TOP")
    placeholder:SetText(PLACEHOLDER)

    -- Keep the cursor in view while typing (Blizzard's own helpers, where the client has them).
    if ScrollingEdit_OnCursorChanged then
        editBox:SetScript("OnCursorChanged", ScrollingEdit_OnCursorChanged)
        editBox:SetScript("OnUpdate", function(self, elapsed) ScrollingEdit_OnUpdate(self, elapsed, scroll) end)
    end
    editBox:SetScript("OnTextChanged", function(self)
        if ScrollingEdit_OnTextChanged then ScrollingEdit_OnTextChanged(self, scroll) end
        placeholder:SetShown(self:GetText() == "")
        problem:SetText("")
    end)

    problem = upload:CreateFontString(nil, "OVERLAY", "GameFontRedSmall")
    problem:SetPoint("BOTTOMLEFT", upload, "BOTTOMLEFT", 18, 46)
    problem:SetPoint("BOTTOMRIGHT", upload, "BOTTOMRIGHT", -18, 46)
    problem:SetJustifyH("LEFT")

    local save = newButton(upload, SAVE or "Save", function() UI.save() end)
    save:SetWidth(160)
    save:SetPoint("BOTTOMLEFT", upload, "BOTTOMLEFT", 14, 14)
    local close = newButton(upload, CLOSE or "Close", function() UI.closeUpload() end)
    close:SetWidth(160)
    close:SetPoint("BOTTOMRIGHT", upload, "BOTTOMRIGHT", -14, 14)
    upload:SetScript("OnHide", function()
        editBox:ClearFocus()
        if not (main and main:IsShown()) and upload.reopenMain then UI.showMain() end
        upload.reopenMain = nil
    end)
end

function UI.showUpload()
    if not upload then buildUpload() end
    if main then main:Hide() end
    editBox:SetText(ns.setupText or "")
    placeholder:SetShown(editBox:GetText() == "")
    problem:SetText("")
    upload.reopenMain = true
    upload:Show()
    editBox:SetFocus()
    editBox:HighlightText()
end

function UI.closeUpload()
    upload:Hide()
end

--- Reads the pasted setup; keeps it and goes back to the main window, or says what is wrong.
function UI.save()
    local text = editBox:GetText()
    local setup, err = Core.read(text)
    if not setup then
        problem:SetText(err)
        return
    end
    ns.setup, ns.setupText = setup, text
    ns.Raid.say("Raid setup loaded: %s.", Core.describe(setup))
    upload:Hide()
end
