-- GuildAssistant Database: the window. A search box and level/skill limits along the top; the
-- professions on the left; the matching recipes in the middle (only the visible rows exist, reused
-- as the list scrolls); the chosen recipe's details on the right: what it makes, its reagents, how
-- to learn it and who can craft it. A profession's data is only read the first time it's needed,
-- one profession per frame, so opening the window never stalls the game.

local _, ns = ...
local Core, Game = ns.Core, ns.Game
local UI = {}
ns.UI = UI

local WIDTH, HEIGHT = 900, 540
local TOP, BOTTOM = -92, 34 -- the content area, below the filters and above the status line
local SIDEBAR_WIDTH, LIST_WIDTH = 168, 372
local ROW_HEIGHT, ROWS = 22, 18
local SIDEBAR_ROWS = 14
local MAX_REAGENTS, MAX_RECIPE_ITEMS, MAX_CRAFTERS = 8, 3, 15
local QUESTION_MARK = "Interface\\Icons\\INV_Misc_QuestionMark"
local HIGHLIGHT = "Interface\\QuestFrame\\UI-QuestTitleHighlight"

local frame
local searchBox, placeholder, minLevelBox, maxLevelBox, minSkillBox, maxSkillBox, unknownCheck, resetButton
local sidebarButtons, rows, slider, statusText, dataText, columnSkill
local details

local state = {
    profession = nil, -- the profession picked on the left, nil for all
    unknownOnly = false, -- only your professions' recipes you don't know yet
    results = {},
    offset = 0,
    selected = nil, -- the recipe whose details are shown
    loadingScheduled = false,
    mine = {}, -- Game.myProfessions() at the last refresh
}

-- Building blocks ----------------------------------------------------------------------------------

local function fontString(parent, template, justify)
    local text = parent:CreateFontString(nil, "OVERLAY", template or "GameFontHighlight")
    text:SetJustifyH(justify or "LEFT")
    return text
end

local function background(parent, alpha)
    local texture = parent:CreateTexture(nil, "BACKGROUND")
    texture:SetAllPoints(parent)
    texture:SetColorTexture(0, 0, 0, alpha or 0.25)
    return texture
end

local function highlightTextures(button)
    button:SetHighlightTexture(HIGHLIGHT, "ADD")
    local selected = button:CreateTexture(nil, "BACKGROUND")
    selected:SetAllPoints(button)
    selected:SetTexture(HIGHLIGHT)
    selected:SetBlendMode("ADD")
    selected:Hide()
    button.selected = selected
end

local function numberBox(parent, width)
    local box = CreateFrame("EditBox", nil, parent, "InputBoxTemplate")
    box:SetSize(width, 20)
    box:SetAutoFocus(false)
    box:SetNumeric(true)
    box:SetMaxLetters(3)
    box:SetScript("OnEnterPressed", box.ClearFocus)
    box:SetScript("OnEscapePressed", box.ClearFocus)
    box:SetScript("OnTextChanged", function() UI.refreshSoon() end)
    return box
end

local function label(parent, text, anchor, relativeTo, x)
    local region = fontString(parent, "GameFontNormalSmall")
    region:SetText(text)
    region:SetPoint("LEFT", relativeTo, anchor, x, 0)
    return region
end

-- Tooltip and shift-click (to the chat) for anything that shows an item or a recipe.
local function linkable(button)
    button:SetScript("OnEnter", function(self)
        if self.hyperlink then Game.showTooltip(self, self.hyperlink) end
    end)
    button:SetScript("OnLeave", Game.hideTooltip)
end

local function linkClicked(self)
    if IsModifiedClick and IsModifiedClick("CHATLINK") or (IsShiftKeyDown and IsShiftKeyDown()) then
        if self.item then Game.insertLink(Game.chatLink(self.item, false)) end
        if self.recipe then Game.insertLink(Game.chatLink(self.recipe, true)) end
        return true
    end
    return false
end

local function iconOf(recipe)
    if recipe.creates and recipe.creates.icon then return "Interface\\Icons\\" .. recipe.creates.icon end
    local texture = (C_Spell and C_Spell.GetSpellTexture) or GetSpellTexture
    return texture and texture(recipe.id) or QUESTION_MARK
end

local function itemIcon(item)
    return item.icon and ("Interface\\Icons\\" .. item.icon) or QUESTION_MARK
end

-- What to search ----------------------------------------------------------------------------------

--- The data's professions shown on the left: all of them, or (not known yet) only yours.
local function listedEntries()
    local entries = {}
    for _, entry in ipairs(ns.Data and ns.Data.professions or {}) do
        if not state.unknownOnly or state.mine[entry.name] then entries[#entries + 1] = entry end
    end
    return entries
end

--- The professions to search: the one picked, or every listed one.
local function searchedEntries()
    local entries = {}
    for _, entry in ipairs(listedEntries()) do
        if not state.profession or entry.name == state.profession then entries[#entries + 1] = entry end
    end
    return entries
end

--- Reads the first profession not read yet, on the next frame, then refreshes (and so on, one per
--- frame). Without timers (the specs) they're all read now. Returns how many are still to read.
local function loadPending(entries)
    local pending = 0
    for _, entry in ipairs(entries) do
        if not entry.loaded then
            if not (C_Timer and C_Timer.After) then
                Core.load(entry, Game.itemWords)
            else
                pending = pending + 1
                if not state.loadingScheduled then
                    state.loadingScheduled = true
                    C_Timer.After(0, function()
                        state.loadingScheduled = false
                        ns.safely(Core.load, entry, Game.itemWords)
                        ns.safely(UI.refresh)
                    end)
                end
            end
        end
    end
    return pending
end

local function query()
    local include
    if state.unknownOnly then
        include = function(recipe)
            local profession = state.mine[recipe.profession]
            return profession ~= nil and not profession.knows(recipe)
        end
    end
    return {
        terms = Core.terms(searchBox:GetText()),
        minLevel = Core.limit(minLevelBox:GetText()), maxLevel = Core.limit(maxLevelBox:GetText()),
        minSkill = Core.limit(minSkillBox:GetText()), maxSkill = Core.limit(maxSkillBox:GetText()),
        include = include,
    }
end

-- The left column ---------------------------------------------------------------------------------

local function drawSidebar()
    local entries = listedEntries()
    local items = { { name = nil, text = state.unknownOnly and "All my professions" or "All professions" } }
    for _, entry in ipairs(entries) do
        local mine = state.mine[entry.name]
        local right = mine and state.unknownOnly and ("%d/%d"):format(mine.rank, mine.max) or Core.thousands(entry.count or 0)
        items[#items + 1] = { name = entry.name, text = entry.name, right = right }
    end
    for i, button in ipairs(sidebarButtons) do
        local item = items[i]
        if item then
            button.profession = item.name
            button.text:SetText(item.text)
            button.right:SetText(item.right or "")
            if item.name == state.profession then button.selected:Show() else button.selected:Hide() end
            button:Show()
        else
            button:Hide()
        end
    end
end

-- The list ----------------------------------------------------------------------------------------

local function skillColor(recipe)
    if not state.unknownOnly then return "ffffd100" end
    local mine = state.mine[recipe.profession]
    -- Learnable now (green), or not yet (red).
    return (mine and mine.rank >= recipe.skill) and "ff40ff40" or "ffff5050"
end

local function drawRows()
    local results = state.results
    local maxOffset = math.max(0, #results - ROWS)
    state.offset = math.min(math.max(state.offset, 0), maxOffset)
    for i, row in ipairs(rows) do
        local recipe = results[state.offset + i]
        if recipe then
            row.recipe = recipe
            row.hyperlink = Game.hyperlink(recipe)
            row.icon:SetTexture(iconOf(recipe))
            row.name:SetText(Game.coloredName(recipe))
            row.skill:SetText(("|c%s%d|r"):format(skillColor(recipe), recipe.skill))
            row.level:SetText(recipe.level > 0 and tostring(recipe.level) or "")
            if recipe == state.selected then row.selected:Show() else row.selected:Hide() end
            row:Show()
        else
            row.recipe, row.hyperlink = nil, nil
            row:Hide()
        end
    end
    slider:SetMinMaxValues(0, maxOffset)
    slider:SetValue(state.offset)
    if maxOffset > 0 then slider:Show() else slider:Hide() end
end

-- The details -------------------------------------------------------------------------------------

--- Anchors the shown regions one under the other, from the top of the details.
local function stack(regions)
    local previous
    for _, entry in ipairs(regions) do
        local region, gap = entry[1], entry[2] or 4
        if region:IsShown() then
            region:ClearAllPoints()
            if previous then
                region:SetPoint("TOPLEFT", previous, "BOTTOMLEFT", 0, -gap)
            else
                region:SetPoint("TOPLEFT", details, "TOPLEFT", 10, -10)
            end
            previous = region
        end
    end
end

local function infoLines(recipe)
    local lines = {}
    local skill = ("%s, skill %d"):format(recipe.profession, recipe.skill)
    if recipe.level > 1 then skill = skill .. (", requires level %d"):format(recipe.level) end
    lines[#lines + 1] = skill
    local item = recipe.creates
    if item then
        -- "Chest (Plate), 463 Armor, …": the slot (which the summary starts with) and the type.
        local summary, subtype = item.summary, Game.itemSubtype(item.id)
        if subtype and item.slot > 0 and summary ~= "" then
            summary = summary:gsub("^([^,]+)", "%1 (" .. subtype .. ")", 1)
        elseif subtype then
            summary = summary ~= "" and (subtype .. ", " .. summary) or subtype
        end
        if summary ~= "" then lines[#lines + 1] = summary end
        local min, max = recipe.makes[1], recipe.makes[2]
        if max > 1 then lines[#lines + 1] = min == max and ("Makes %d"):format(min) or ("Makes %d to %d"):format(min, max) end
    end
    local yellow, green, grey = recipe.colors[1], recipe.colors[2], recipe.colors[3]
    if grey > 0 then
        lines[#lines + 1] = ("Skill-ups: |cffff8040%d|r |cffffff00%d|r |cff40c040%d|r |cff808080%d|r"):format(recipe.skill, yellow, green, grey)
    end
    return table.concat(lines, "\n")
end

local function craftersText(recipe)
    local db = Game.professionsDB()
    if not db then return "|cff808080Install GuildAssistant Professions to see who in your guild can craft it.|r" end
    local crafters = Core.crafters(db, recipe, Game.playerKey())
    if #crafters == 0 then return "|cff808080Nobody you know of yet.|r" end
    local names = {}
    for i, crafter in ipairs(crafters) do
        if i > MAX_CRAFTERS then
            names[#names + 1] = ("and %d more"):format(#crafters - MAX_CRAFTERS)
            break
        end
        local suffix = crafter.you and " (you)" or crafter.source == "own" and " (alt)"
            or crafter.source == "link" and " (link)" or ""
        names[#names + 1] = ("|c%s%s|r%s"):format(Game.classHex(crafter.class), crafter.name, suffix)
    end
    return table.concat(names, ", ")
end

local function drawDetails()
    local recipe = state.selected
    local d = details
    if not recipe then
        d.hint:Show()
        for _, region in ipairs(d.regions) do region[1]:Hide() end
        return
    end
    d.hint:Hide()
    d.name.recipe, d.name.hyperlink = recipe, Game.hyperlink(recipe)
    d.name.icon:SetTexture(iconOf(recipe))
    d.name.text:SetText(Game.coloredName(recipe))
    d.name:Show()
    d.info:SetText(infoLines(recipe))
    d.info:Show()

    d.reagentsHeader:Show()
    for i, button in ipairs(d.reagents) do
        local reagent = recipe.reagents[i]
        if reagent then
            button.item, button.hyperlink = reagent.item, "item:" .. reagent.item.id
            button.icon:SetTexture(itemIcon(reagent.item))
            button.text:SetText(("%d x %s"):format(reagent.count, Game.coloredItem(reagent.item)))
            button:Show()
        else
            button:Hide()
        end
    end

    d.learnHeader:Show()
    d.learn:SetText(table.concat(Core.howToLearn(recipe, Game.zoneName), "\n"))
    d.learn:Show()
    for i, button in ipairs(d.recipeItems) do
        local item = recipe.recipeItems[i]
        if item then
            button.item, button.hyperlink = item, "item:" .. item.id
            button.icon:SetTexture(itemIcon(item))
            local skill = item.skill > 0 and (" |cff808080(skill %d)|r"):format(item.skill) or ""
            button.text:SetText(Game.coloredItem(item) .. skill)
            button:Show()
        else
            button:Hide()
        end
    end

    d.craftersHeader:Show()
    d.crafters:SetText(craftersText(recipe))
    d.crafters:Show()
    stack(d.regions)
end

-- Refreshing --------------------------------------------------------------------------------------

local function statusLine(pending, total)
    if pending > 0 then
        return ("Reading recipes... %d of %d professions"):format(total - pending, total)
    end
    local count = #state.results
    local line = count == 0 and "No recipes match." or ("%s recipe%s"):format(Core.thousands(count), count == 1 and "" or "s")
    if state.unknownOnly then
        if next(state.mine) == nil then return "You have no professions with recipes." end
        -- Your professions whose recipes GuildAssistant Professions hasn't recorded yet.
        local missing = {}
        for _, entry in ipairs(searchedEntries()) do
            local mine = state.mine[entry.name]
            if mine and not mine.recorded then missing[#missing + 1] = entry.name end
        end
        if #missing > 0 then
            local how = Game.professionsDB() and "open its window once to record what you know"
                or "known ones are what the game says (GuildAssistant Professions knows better)"
            line = ("%s  |cffffd100%s: %s.|r"):format(line, table.concat(missing, ", "), how)
        end
    end
    return line
end

--- Brings everything up to date with the filters: which professions, the results, the details.
function UI.refresh()
    if not frame or not frame:IsShown() then return end
    placeholder:SetShown(searchBox:GetText() == "" and not searchBox:HasFocus())
    state.mine = state.unknownOnly and Game.myProfessions() or {}
    -- A profession picked before that isn't listed now (switching to yours only): all of them.
    if state.profession then
        local listed = false
        for _, entry in ipairs(listedEntries()) do listed = listed or entry.name == state.profession end
        if not listed then state.profession = nil end
    end
    local entries = searchedEntries()
    local pending = loadPending(entries)
    local loaded = {}
    for _, entry in ipairs(entries) do
        if entry.loaded then loaded[#loaded + 1] = entry.loaded end
    end
    state.results = Core.search(loaded, query())
    drawSidebar()
    drawRows()
    drawDetails()
    statusText:SetText(statusLine(pending, #entries))
end

local refreshToken = 0
--- Refreshes a moment after the last change (typing), not on every key.
function UI.refreshSoon()
    refreshToken = refreshToken + 1
    local token = refreshToken
    Game.soon(function()
        if token == refreshToken then ns.safely(UI.refresh) end
    end, 0.2)
end

-- Building the window -----------------------------------------------------------------------------

local function buildFilters()
    searchBox = CreateFrame("EditBox", nil, frame, "InputBoxTemplate")
    searchBox:SetSize(300, 20)
    searchBox:SetPoint("TOPLEFT", frame, "TOPLEFT", 22, -34)
    searchBox:SetAutoFocus(false)
    searchBox:SetMaxLetters(80)
    searchBox:SetScript("OnEnterPressed", searchBox.ClearFocus)
    searchBox:SetScript("OnEscapePressed", searchBox.ClearFocus)
    searchBox:SetScript("OnTextChanged", function()
        placeholder:SetShown(searchBox:GetText() == "" and not searchBox:HasFocus())
        UI.refreshSoon()
    end)
    searchBox:SetScript("OnEditFocusGained", function() placeholder:Hide() end)
    searchBox:SetScript("OnEditFocusLost", function() placeholder:SetShown(searchBox:GetText() == "") end)
    placeholder = fontString(searchBox, "GameFontDisable")
    placeholder:SetPoint("LEFT", searchBox, "LEFT", 2, 0)
    placeholder:SetText("Search: name, stat, slot, reagent")

    local levelLabel = label(frame, "Level", "RIGHT", searchBox, 18)
    minLevelBox = numberBox(frame, 30)
    minLevelBox:SetPoint("LEFT", levelLabel, "RIGHT", 10, 0)
    local dash = label(frame, "-", "RIGHT", minLevelBox, 4)
    maxLevelBox = numberBox(frame, 30)
    maxLevelBox:SetPoint("LEFT", dash, "RIGHT", 8, 0)

    local skillLabel = label(frame, "Skill", "RIGHT", maxLevelBox, 18)
    minSkillBox = numberBox(frame, 34)
    minSkillBox:SetPoint("LEFT", skillLabel, "RIGHT", 10, 0)
    local dash2 = label(frame, "-", "RIGHT", minSkillBox, 4)
    maxSkillBox = numberBox(frame, 34)
    maxSkillBox:SetPoint("LEFT", dash2, "RIGHT", 8, 0)

    resetButton = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
    resetButton:SetSize(70, 22)
    resetButton:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -14, -33)
    resetButton:SetText("Reset")
    resetButton:SetScript("OnClick", function()
        for _, box in ipairs({ searchBox, minLevelBox, maxLevelBox, minSkillBox, maxSkillBox }) do
            box:SetText("")
            box:ClearFocus()
        end
        unknownCheck:SetChecked(false)
        state.unknownOnly, state.profession, state.offset = false, nil, 0
        UI.refresh()
    end)

    unknownCheck = CreateFrame("CheckButton", nil, frame, "UICheckButtonTemplate")
    unknownCheck:SetSize(24, 24)
    unknownCheck:SetPoint("TOPLEFT", frame, "TOPLEFT", 14, -58)
    local checkLabel = unknownCheck.text or unknownCheck.Text or fontString(unknownCheck, "GameFontHighlight")
    checkLabel:ClearAllPoints()
    checkLabel:SetPoint("LEFT", unknownCheck, "RIGHT", 2, 0)
    checkLabel:SetText("Not known yet: only my professions' recipes I don't know")
    unknownCheck:SetScript("OnClick", function(self)
        state.unknownOnly, state.offset = self:GetChecked() and true or false, 0
        UI.refresh()
    end)
end

local function buildSidebar()
    local sidebar = CreateFrame("Frame", nil, frame)
    sidebar:SetPoint("TOPLEFT", frame, "TOPLEFT", 12, TOP)
    sidebar:SetPoint("BOTTOMLEFT", frame, "BOTTOMLEFT", 12, BOTTOM)
    sidebar:SetWidth(SIDEBAR_WIDTH)
    background(sidebar)
    sidebarButtons = {}
    for i = 1, SIDEBAR_ROWS do
        local button = CreateFrame("Button", nil, sidebar)
        button:SetSize(SIDEBAR_WIDTH - 8, 22)
        button:SetPoint("TOPLEFT", sidebar, "TOPLEFT", 4, -4 - (i - 1) * 24)
        highlightTextures(button)
        button.text = fontString(button, "GameFontNormal")
        button.text:SetPoint("LEFT", button, "LEFT", 6, 0)
        button.right = fontString(button, "GameFontDisableSmall", "RIGHT")
        button.right:SetPoint("RIGHT", button, "RIGHT", -6, 0)
        button:SetScript("OnClick", function(self)
            state.profession, state.offset = self.profession, 0
            UI.refresh()
        end)
        sidebarButtons[i] = button
    end
end

local function buildList()
    local list = CreateFrame("Frame", nil, frame)
    list:SetPoint("TOPLEFT", frame, "TOPLEFT", 12 + SIDEBAR_WIDTH + 8, TOP)
    list:SetPoint("BOTTOMLEFT", frame, "BOTTOMLEFT", 12 + SIDEBAR_WIDTH + 8, BOTTOM)
    list:SetWidth(LIST_WIDTH)
    background(list)
    list:EnableMouseWheel(true)
    list:SetScript("OnMouseWheel", function(_, delta)
        state.offset = state.offset - delta * 3
        drawRows()
    end)

    -- Column titles, just above the list.
    local columnName = fontString(frame, "GameFontNormalSmall")
    columnName:SetPoint("BOTTOMLEFT", list, "TOPLEFT", 30, 3)
    columnName:SetText("Recipe")
    local columnLevel = fontString(frame, "GameFontNormalSmall", "RIGHT")
    columnLevel:SetPoint("BOTTOMRIGHT", list, "TOPRIGHT", -20, 3)
    columnLevel:SetText("Level")
    columnSkill = fontString(frame, "GameFontNormalSmall", "RIGHT")
    columnSkill:SetPoint("BOTTOMRIGHT", list, "TOPRIGHT", -62, 3)
    columnSkill:SetText("Skill")

    rows = {}
    for i = 1, ROWS do
        local row = CreateFrame("Button", nil, list)
        row:SetSize(LIST_WIDTH - 18, ROW_HEIGHT)
        row:SetPoint("TOPLEFT", list, "TOPLEFT", 2, -4 - (i - 1) * (ROW_HEIGHT + 1))
        highlightTextures(row)
        row.icon = row:CreateTexture(nil, "ARTWORK")
        row.icon:SetSize(ROW_HEIGHT - 4, ROW_HEIGHT - 4)
        row.icon:SetPoint("LEFT", row, "LEFT", 4, 0)
        row.level = fontString(row, "GameFontHighlightSmall", "RIGHT")
        row.level:SetPoint("RIGHT", row, "RIGHT", -4, 0)
        row.level:SetWidth(34)
        row.skill = fontString(row, "GameFontHighlightSmall", "RIGHT")
        row.skill:SetPoint("RIGHT", row.level, "LEFT", -8, 0)
        row.skill:SetWidth(34)
        row.name = fontString(row, "GameFontHighlight")
        row.name:SetPoint("LEFT", row.icon, "RIGHT", 6, 0)
        row.name:SetPoint("RIGHT", row.skill, "LEFT", -6, 0)
        row.name:SetWordWrap(false)
        linkable(row)
        row:SetScript("OnClick", function(self)
            if linkClicked(self) then return end
            state.selected = self.recipe
            drawRows()
            drawDetails()
        end)
        rows[i] = row
    end

    slider = CreateFrame("Slider", nil, list)
    slider:SetOrientation("VERTICAL")
    slider:SetPoint("TOPRIGHT", list, "TOPRIGHT", -2, -4)
    slider:SetPoint("BOTTOMRIGHT", list, "BOTTOMRIGHT", -2, 4)
    slider:SetWidth(12)
    background(slider, 0.4)
    slider:SetThumbTexture("Interface\\Buttons\\UI-ScrollBar-Knob")
    slider:SetMinMaxValues(0, 0)
    slider:SetValueStep(1)
    if slider.SetObeyStepOnDrag then slider:SetObeyStepOnDrag(true) end
    slider:SetScript("OnValueChanged", function(_, value)
        local offset = math.floor(value + 0.5)
        if offset ~= state.offset then
            state.offset = offset
            drawRows()
        end
    end)
end

local function linkButton(parent, height)
    local button = CreateFrame("Button", nil, parent)
    button:SetSize(330, height)
    button.icon = button:CreateTexture(nil, "ARTWORK")
    button.icon:SetSize(height - 2, height - 2)
    button.icon:SetPoint("LEFT", button, "LEFT", 0, 0)
    button.text = fontString(button, height > 24 and "GameFontNormalLarge" or "GameFontHighlightSmall")
    button.text:SetPoint("LEFT", button.icon, "RIGHT", 6, 0)
    button.text:SetPoint("RIGHT", button, "RIGHT", 0, 0)
    button.text:SetWordWrap(false)
    linkable(button)
    button:SetScript("OnClick", linkClicked)
    return button
end

local function buildDetails()
    local left = 12 + SIDEBAR_WIDTH + 8 + LIST_WIDTH + 8
    details = CreateFrame("Frame", nil, frame)
    details:SetPoint("TOPLEFT", frame, "TOPLEFT", left, TOP)
    details:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -12, BOTTOM)
    background(details)
    local d = details
    local width = WIDTH - left - 12 - 20

    d.hint = fontString(d, "GameFontDisable")
    d.hint:SetPoint("TOPLEFT", d, "TOPLEFT", 10, -10)
    d.hint:SetWidth(width)
    d.hint:SetText("Pick a recipe to see its reagents, how to learn it and who can craft it.\n\nShift-click a recipe or an item to link it in the chat.")

    d.name = linkButton(d, 32)
    d.info = fontString(d, "GameFontHighlightSmall")
    d.info:SetWidth(width)
    d.info:SetSpacing(2)
    d.reagentsHeader = fontString(d, "GameFontNormal")
    d.reagentsHeader:SetText("Reagents")
    d.reagents = {}
    for i = 1, MAX_REAGENTS do d.reagents[i] = linkButton(d, 18) end
    d.learnHeader = fontString(d, "GameFontNormal")
    d.learnHeader:SetText("How to learn it")
    d.learn = fontString(d, "GameFontHighlightSmall")
    d.learn:SetWidth(width)
    d.learn:SetSpacing(2)
    d.recipeItems = {}
    for i = 1, MAX_RECIPE_ITEMS do d.recipeItems[i] = linkButton(d, 18) end
    d.craftersHeader = fontString(d, "GameFontNormal")
    d.craftersHeader:SetText("Who can craft it")
    d.crafters = fontString(d, "GameFontHighlightSmall")
    d.crafters:SetWidth(width)
    d.crafters:SetSpacing(2)

    d.regions = { { d.name }, { d.info, 6 }, { d.reagentsHeader, 12 } }
    for _, button in ipairs(d.reagents) do d.regions[#d.regions + 1] = { button, 2 } end
    d.regions[#d.regions + 1] = { d.learnHeader, 12 }
    d.regions[#d.regions + 1] = { d.learn, 4 }
    for _, button in ipairs(d.recipeItems) do d.regions[#d.regions + 1] = { button, 2 } end
    d.regions[#d.regions + 1] = { d.craftersHeader, 12 }
    d.regions[#d.regions + 1] = { d.crafters, 4 }
end

local function build()
    frame = CreateFrame("Frame", "GuildAssistantDatabaseFrame", UIParent, "BasicFrameTemplateWithInset")
    frame:SetSize(WIDTH, HEIGHT)
    frame:SetPoint("CENTER")
    frame:SetFrameStrata("HIGH")
    frame:SetToplevel(true)
    frame:SetClampedToScreen(true)
    frame:EnableMouse(true)
    frame:SetMovable(true)
    frame:RegisterForDrag("LeftButton")
    frame:SetScript("OnDragStart", frame.StartMoving)
    frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
    frame:SetScript("OnShow", function() ns.safely(UI.refresh) end)
    frame:Hide()
    local title = frame.TitleText or fontString(frame, "GameFontHighlight", "CENTER")
    if not frame.TitleText then title:SetPoint("TOP", frame, "TOP", 0, -6) end
    title:SetText("GuildAssistant Database")
    tinsert(UISpecialFrames, "GuildAssistantDatabaseFrame")

    buildFilters()
    buildSidebar()
    buildList()
    buildDetails()

    statusText = fontString(frame, "GameFontHighlightSmall")
    statusText:SetPoint("BOTTOMLEFT", frame, "BOTTOMLEFT", 16, 13)
    statusText:SetWidth(560)
    statusText:SetWordWrap(false)
    dataText = fontString(frame, "GameFontDisableSmall", "RIGHT")
    dataText:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -16, 13)
    local data = ns.Data or {}
    dataText:SetText(("%s from Wowhead (%s), %s"):format(Core.describe(data), data.version or "?", data.fetched or "?"))
end

--- Opens the window (built the first time), with `search` typed in when given.
function UI.show(search)
    if not frame then build() end
    if search and search ~= "" then
        searchBox:SetText(search)
        state.offset = 0
    end
    -- Showing it refreshes it (OnShow); already shown, the new search needs one.
    if frame:IsShown() then UI.refresh() else frame:Show() end
end

function UI.toggle()
    if frame and frame:IsShown() then frame:Hide() else UI.show() end
end

function UI.isShown()
    return frame ~= nil and frame:IsShown()
end

--- For the specs: the window's parts.
function UI.parts()
    return {
        frame = frame, searchBox = searchBox, minLevelBox = minLevelBox, maxLevelBox = maxLevelBox,
        minSkillBox = minSkillBox, maxSkillBox = maxSkillBox, unknownCheck = unknownCheck, resetButton = resetButton,
        sidebarButtons = sidebarButtons, rows = rows, details = details, statusText = statusText,
        state = state,
    }
end
