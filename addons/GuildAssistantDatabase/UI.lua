-- GuildAssistant Database: the window. A search box, level/skill limits and a Filter button (slots,
-- armor types) along the top; the professions on the left, with how many recipes of each match
-- the search; the matching recipes in the middle (only the visible rows exist, reused as the list
-- scrolls); the chosen recipe's details on the right: what it makes, its reagents, how to learn it
-- and who can craft it. A profession's data is only read the first time it's needed, one
-- profession per frame, so opening the window never stalls the game.

local _, ns = ...
local Core, Game = ns.Core, ns.Game
local UI = {}
ns.UI = UI

local WIDTH, HEIGHT = 900, 540
local TOP, BOTTOM = -92, 34 -- the content area, below the filters and above the status line
local SIDEBAR_WIDTH, LIST_WIDTH = 168, 372
-- The status line at the bottom left, leaving room for the version on the right.
local STATUS_WIDTH = WIDTH - 32 - 80
local ROW_HEIGHT, ROWS = 22, 18
local SIDEBAR_ROWS = 14
local MAX_REAGENTS, MAX_RECIPE_ITEMS, MAX_CRAFTERS = 8, 3, 15
local QUESTION_MARK = "Interface\\Icons\\INV_Misc_QuestionMark"
local HIGHLIGHT = "Interface\\QuestFrame\\UI-QuestTitleHighlight"

local frame
local searchBox, placeholder, clearButton, minLevelBox, maxLevelBox, minSkillBox, maxSkillBox, unknownCheck, resetButton
local filterButton, filterPopup, filterChecks
local sidebarButtons, rows, slider, statusText, statusHover, versionText, columnSkill
local details

local state = {
    profession = nil, -- the profession picked on the left, nil for all
    unknownOnly = false, -- only your professions' recipes you don't know yet
    results = {},
    offset = 0,
    selected = nil, -- the recipe whose details are shown
    loadingScheduled = false,
    mine = {}, -- Game.myProfessions() at the last refresh
    slots = {}, armor = {}, -- the Filter's choices, by name (Core.SLOTS, Core.ARMOR_TYPES)
    showUnvouched = false, -- "Show unknown recipes": also those no source knows (saved: showUnknown)
    counts = nil, -- with a search: how many recipes of each profession match ({ [name] = n })
    total = 0, -- how many match in all the listed professions
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

-- Tooltip, shift-click (to the chat) and ctrl-click (the dressing room) for anything that shows an
-- item or a recipe.
local function linkable(button)
    button:SetScript("OnEnter", function(self)
        if self.hyperlink then Game.showTooltip(self, self.hyperlink) end
    end)
    button:SetScript("OnLeave", Game.hideTooltip)
end

-- Shift-click: its link in the chat, the item's when it shows one (a reagent, plans, the top of the
-- details), else the recipe's, to craft it (a row of the list), as the game's profession window
-- does. Ctrl-click: the item tried on in the dressing room (a recipe's: the item it makes).
-- Returns whether it was one of those rather than a plain click.
local function linkClicked(self)
    if IsModifiedClick and IsModifiedClick("CHATLINK") or (IsShiftKeyDown and IsShiftKeyDown()) then
        if self.item then
            Game.insertLink(Game.chatLink(self.item, false))
        elseif self.recipe then
            Game.insertLink(Game.chatLink(self.recipe, true))
        end
        return true
    end
    local item = self.item or (self.recipe and self.recipe.creates)
    if item and (IsModifiedClick and IsModifiedClick("DRESSUP") or (IsControlKeyDown and IsControlKeyDown())) then
        Game.dressUp(item)
        return true
    end
    return false
end

-- An item's icon: its file id (the game's data), else what the game says, else a question mark.
local function itemIcon(item)
    if item.icon and item.icon > 0 then return item.icon end
    local instant = (C_Item and C_Item.GetItemInfoInstant) or GetItemInfoInstant
    local icon = instant and select(5, instant(item.id))
    return icon or QUESTION_MARK
end

local function iconOf(recipe)
    if recipe.creates then return itemIcon(recipe.creates) end
    local texture = (C_Spell and C_Spell.GetSpellTexture) or GetSpellTexture
    return texture and texture(recipe.id) or QUESTION_MARK
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
    state.wanted = entries
    local pending = 0
    for _, entry in ipairs(entries) do
        if not entry.loaded then
            if not (C_Timer and C_Timer.After) then
                Core.load(entry, Game.sourceProviders())
            else
                pending = pending + 1
                if not state.loadingScheduled then
                    state.loadingScheduled = true
                    C_Timer.After(0, function()
                        state.loadingScheduled = false
                        -- What's needed by then: another profession may have been picked meanwhile.
                        for _, wanted in ipairs(state.wanted) do
                            if not wanted.loaded then
                                ns.safely(Core.load, wanted, Game.sourceProviders())
                                break
                            end
                        end
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
    local slots, armor = Core.filterSets(state.slots, state.armor)
    return {
        terms = Core.terms(searchBox:GetText()),
        minLevel = Core.limit(minLevelBox:GetText()), maxLevel = Core.limit(maxLevelBox:GetText()),
        minSkill = Core.limit(minSkillBox:GetText()), maxSkill = Core.limit(maxSkillBox:GetText()),
        slots = slots, armor = armor, include = include,
        vouchedOnly = Game.hidesUnvouched() and not state.showUnvouched,
    }
end

-- The left column ---------------------------------------------------------------------------------

-- With a search, each profession says how many of its recipes match, in gold (none: nothing);
-- without one, how many it has (or your skill in it), in grey.
local function matchCount(n)
    return (n or 0) > 0 and ("|cffffd100%s|r"):format(Core.thousands(n)) or ""
end

-- A profession's recipes: with a sources companion, those it vouches for (once read), unless
-- recipes with no known source are shown too.
local function total(entry)
    if entry.loaded and Game.hidesUnvouched() and not state.showUnvouched then return entry.loaded.vouchedCount end
    return entry.count or 0
end

local function drawSidebar()
    local entries = listedEntries()
    local all = ""
    if state.counts then
        all = matchCount(state.total)
    elseif not state.unknownOnly then
        local count = 0
        for _, entry in ipairs(entries) do count = count + total(entry) end
        all = Core.thousands(count)
    end
    local items = { { name = nil, text = state.unknownOnly and "All my professions" or "All professions", right = all } }
    for _, entry in ipairs(entries) do
        local mine = state.mine[entry.name]
        local right
        if state.counts then
            right = matchCount(state.counts[entry.name])
        elseif mine and state.unknownOnly then
            right = ("%d/%d"):format(mine.rank, mine.max)
        else
            right = Core.thousands(total(entry))
        end
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

-- The sources' names as tooltips list them ("Known as of November 2026", "Found by players"), or nil.
local function sourceNames()
    local sources = Core.sources(Game.sourceProviders())
    if not sources then return nil end
    local names = {}
    for i, name in ipairs(sources.names) do names[i] = (name:gsub("^%l", string.upper)) end
    return names
end

local function infoLines(recipe)
    local lines = {}
    local skill = ("%s, skill %d"):format(recipe.profession, recipe.skill)
    if recipe.level > 1 then skill = skill .. (", requires level %d"):format(recipe.level) end
    lines[#lines + 1] = skill
    local item = recipe.creates
    if item then
        -- "Chest (Plate), 463 Armor, …": slot and type, then its stats (with values when a sources
        -- companion knows them).
        if item.summary ~= "" then lines[#lines + 1] = item.summary end
        local min, max = recipe.makes[1], recipe.makes[2]
        if max > 1 then lines[#lines + 1] = min == max and ("Makes %d"):format(min) or ("Makes %d to %d"):format(min, max) end
    end
    local yellow, green, grey = recipe.colors[1], recipe.colors[2], recipe.colors[3]
    if grey > 0 then
        lines[#lines + 1] = ("Skill-ups: |cffff8040%d|r |cffffff00%d|r |cff40c040%d|r |cff808080%d|r"):format(recipe.skill, yellow, green, grey)
    end
    return table.concat(lines, "\n")
end

-- Who can craft it: a line of names that wraps ("Luna (you), Ana, Brom (alt), and 3 more"), each
-- name a button that whispers them on a click (not yours). `d.crafters` says why there are none.
local CRAFTER_LINE, CRAFTER_SPACE = 14, 4

local function drawCrafters(d, recipe)
    local box = d.crafterNames
    for _, button in ipairs(box.names) do button:Hide() end
    box.more:Hide()
    local db = Game.professionsDB()
    local crafters = db and Core.crafters(db, recipe, Game.playerKey()) or {}
    if #crafters == 0 then
        d.crafters:SetText(db and "|cff808080Nobody you know of yet.|r"
            or "|cff808080Install GuildAssistant Professions to see who in your guild can craft it.|r")
        d.crafters:Show()
        box:Hide()
        return
    end
    d.crafters:Hide()
    local x, line = 0, 0
    local function place(region, width)
        if x > 0 and x + width > box.width then x, line = 0, line + 1 end
        region:ClearAllPoints()
        region:SetPoint("TOPLEFT", box, "TOPLEFT", x, -line * CRAFTER_LINE)
        x = x + width + CRAFTER_SPACE
    end
    for i = 1, math.min(#crafters, MAX_CRAFTERS) do
        local crafter, button = crafters[i], box.names[i]
        local suffix = crafter.you and " (you)" or crafter.source == "own" and " (alt)"
            or crafter.source == "link" and " (link)" or ""
        local comma = i < #crafters and "," or ""
        button.text:SetText(("|c%s%s|r%s%s"):format(Game.classHex(crafter.class), crafter.name, suffix, comma))
        button.whisper = Game.whisperTarget(crafter)
        button:EnableMouse(button.whisper ~= nil)
        local width = button.text:GetStringWidth()
        button:SetSize(width, CRAFTER_LINE - 2)
        place(button, width)
        button:Show()
    end
    if #crafters > MAX_CRAFTERS then
        box.more:SetText(("and %d more"):format(#crafters - MAX_CRAFTERS))
        place(box.more, box.more:GetStringWidth())
        box.more:Show()
    end
    box:SetHeight((line + 1) * CRAFTER_LINE)
    box:Show()
end

-- The Craft button (shown for a recipe you know, when the game lets addons craft): enabled when
-- your bags hold the reagents, its tooltip says for how many or what's missing.
local function drawCraft()
    local button, recipe = details.craft, state.selected
    if not button:IsShown() or not recipe then return end
    button.times, button.missing = Core.craftable(recipe, Game.itemCount)
    button:SetEnabled(button.times > 0)
end

local function craftTooltip(button)
    local recipe = state.selected
    if not recipe then return end
    local lines = {}
    if button.times > 0 then
        lines[1] = ("You have the reagents for %d."):format(button.times)
        Game.showTextTooltip(button, "Craft " .. recipe.name, lines)
    else
        for i, missing in ipairs(button.missing) do
            lines[i] = ("%d x %s"):format(missing.short, Game.coloredItem(missing.item))
        end
        Game.showTextTooltip(button, "Missing reagents", lines)
    end
end

local function drawDetails()
    local recipe = state.selected
    local d = details
    if not recipe then
        d.hint:Show()
        for _, region in ipairs(d.regions) do region[1]:Hide() end
        d.learnHover:Hide()
        return
    end
    d.hint:Hide()
    -- The item it makes (its link on shift-click); an enchant, which makes none, links the recipe.
    d.name.recipe, d.name.item, d.name.hyperlink = recipe, recipe.creates, Game.hyperlink(recipe)
    local mine = Game.myProfessions()[recipe.profession]
    d.name.known = mine and mine.knows(recipe) and mine or nil
    d.craft:SetShown(d.name.known ~= nil and Game.canCraft())
    drawCraft()
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
    d.learnHover:SetShown(Core.sources(Game.sourceProviders()) ~= nil)
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
    drawCrafters(d, recipe)
    stack(d.regions)
end

-- Refreshing --------------------------------------------------------------------------------------

local function statusLine(pending, total)
    if pending > 0 then
        return ("Reading recipes... %d of %d professions"):format(total - pending, total)
    end
    local count = #state.results
    local line = count == 0 and "No recipes match." or ("%s recipe%s"):format(Core.thousands(count), count == 1 and "" or "s")
    if count == 0 and state.profession and state.total > 0 then
        -- The others have some: their counts are on the left.
        line = ("None in %s; %s in other professions."):format(state.profession, Core.thousands(state.total))
    end
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
    local q = query()
    -- With a search, every listed profession is searched, for its count on the left; without one,
    -- only the one picked (or all of them).
    local entries = Core.isQuery(q) and listedEntries() or searchedEntries()
    local pending = loadPending(entries)
    local loaded = {}
    for _, entry in ipairs(entries) do
        if entry.loaded then loaded[#loaded + 1] = entry.loaded end
    end
    local matches = Core.search(loaded, q)
    state.counts = Core.isQuery(q) and Core.countByProfession(matches) or nil
    state.total = #matches
    if state.profession then
        local picked = {}
        for _, recipe in ipairs(matches) do
            if recipe.profession == state.profession then picked[#picked + 1] = recipe end
        end
        matches = picked
    end
    state.results = matches
    drawSidebar()
    drawRows()
    drawDetails()
    statusText:SetText(statusLine(pending, #entries))
    statusHover:SetWidth(math.min(statusText:GetStringWidth(), STATUS_WIDTH))
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
    searchBox:SetTextInsets(0, 18, 0, 0) -- room for the clear button
    searchBox:SetScript("OnTextChanged", function()
        placeholder:SetShown(searchBox:GetText() == "" and not searchBox:HasFocus())
        clearButton:SetShown(searchBox:GetText() ~= "")
        UI.refreshSoon()
    end)
    searchBox:SetScript("OnEditFocusGained", function() placeholder:Hide() end)
    searchBox:SetScript("OnEditFocusLost", function() placeholder:SetShown(searchBox:GetText() == "") end)
    placeholder = fontString(searchBox, "GameFontDisable")
    placeholder:SetPoint("LEFT", searchBox, "LEFT", 2, 0)
    placeholder:SetText("Search: name, stat, slot, reagent")

    -- A cross at the end of the box, while there's something in it, to clear it.
    clearButton = CreateFrame("Button", nil, searchBox)
    clearButton:SetSize(14, 14)
    clearButton:SetPoint("RIGHT", searchBox, "RIGHT", -3, 0)
    local cross = clearButton:CreateTexture(nil, "ARTWORK")
    cross:SetAllPoints(clearButton)
    cross:SetTexture("Interface\\FriendsFrame\\ClearBroadcastIcon")
    cross:SetAlpha(0.6)
    clearButton:SetScript("OnEnter", function() cross:SetAlpha(1) end)
    clearButton:SetScript("OnLeave", function() cross:SetAlpha(0.6) end)
    clearButton:SetScript("OnClick", function()
        searchBox:SetText("")
        searchBox:ClearFocus()
        state.offset = 0
        UI.refresh()
    end)
    clearButton:Hide()

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

    -- Tab goes to the next box, Shift-Tab to the one before, round all five; the box's text is
    -- selected, so typing replaces it.
    local boxes = { searchBox, minLevelBox, maxLevelBox, minSkillBox, maxSkillBox }
    for i, box in ipairs(boxes) do
        box:SetScript("OnTabPressed", function()
            local back = IsShiftKeyDown and IsShiftKeyDown()
            local nextBox = boxes[(i + (back and -2 or 0)) % #boxes + 1]
            nextBox:SetFocus()
            nextBox:HighlightText()
        end)
    end

    resetButton = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
    resetButton:SetSize(70, 22)
    resetButton:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -14, -33)
    resetButton:SetText("Reset")
    resetButton:SetScript("OnClick", function()
        for _, box in ipairs(boxes) do
            box:SetText("")
            box:ClearFocus()
        end
        UI.clearFilter()
        filterPopup:Hide()
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

-- The Filter button and its panel: armor types and slots to tick (any of those ticked in a group;
-- both groups when both have some).
local function updateFilterButton()
    local picked = 0
    for _ in pairs(state.slots) do picked = picked + 1 end
    for _ in pairs(state.armor) do picked = picked + 1 end
    filterButton:SetText(picked > 0 and ("Filter (%d)"):format(picked) or "Filter")
end

--- Unticks every armor type and slot. "Show unknown recipes" is a saved preference: it stays.
function UI.clearFilter()
    state.slots, state.armor = {}, {}
    for _, check in pairs(filterChecks) do check:SetChecked(false) end
    updateFilterButton()
end

local FILTER_COLUMN, FILTER_ROW = 96, 22

local function filterCheck(group, name, column, row)
    local check = CreateFrame("CheckButton", nil, filterPopup, "UICheckButtonTemplate")
    check:SetSize(20, 20)
    check:SetPoint("TOPLEFT", filterPopup, "TOPLEFT", 10 + column * FILTER_COLUMN, -30 - row * FILTER_ROW)
    local text = check.text or check.Text or fontString(check, "GameFontHighlightSmall")
    text:ClearAllPoints()
    text:SetPoint("LEFT", check, "RIGHT", 1, 0)
    text:SetText(name)
    check:SetScript("OnClick", function(self)
        state[group][name] = self:GetChecked() and true or nil
        state.offset = 0
        updateFilterButton()
        UI.refresh()
    end)
    filterChecks[name] = check
    return check
end

local function buildFilterPopup()
    filterButton = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
    filterButton:SetSize(96, 22)
    filterButton:SetPoint("LEFT", maxSkillBox, "RIGHT", 20, 0)
    filterButton:SetText("Filter")
    filterButton:SetScript("OnClick", function()
        if filterPopup:IsShown() then filterPopup:Hide() else filterPopup:Show() end
    end)

    local slotColumns, slotRows = 3, math.ceil(#Core.SLOTS / 3)
    filterPopup = CreateFrame("Frame", nil, frame)
    filterPopup:SetFrameStrata("DIALOG")
    filterPopup:SetSize(20 + (1 + slotColumns) * FILTER_COLUMN, 30 + slotRows * FILTER_ROW + 88)
    filterPopup:SetPoint("TOPRIGHT", filterButton, "BOTTOMRIGHT", 0, -2)
    filterPopup:EnableMouse(true) -- clicks on it don't reach the list below
    local edge = filterPopup:CreateTexture(nil, "BACKGROUND")
    edge:SetPoint("TOPLEFT", filterPopup, "TOPLEFT", -1, 1)
    edge:SetPoint("BOTTOMRIGHT", filterPopup, "BOTTOMRIGHT", 1, -1)
    edge:SetColorTexture(0.55, 0.45, 0.2, 1)
    local fill = filterPopup:CreateTexture(nil, "BORDER")
    fill:SetAllPoints(filterPopup)
    fill:SetColorTexture(0.05, 0.05, 0.05, 0.96)
    filterPopup:Hide()

    local armorTitle = fontString(filterPopup, "GameFontNormal")
    armorTitle:SetPoint("TOPLEFT", filterPopup, "TOPLEFT", 12, -10)
    armorTitle:SetText("Armor type")
    local slotTitle = fontString(filterPopup, "GameFontNormal")
    slotTitle:SetPoint("TOPLEFT", filterPopup, "TOPLEFT", 12 + FILTER_COLUMN, -10)
    slotTitle:SetText("Slot")
    filterChecks = {}
    for i, choice in ipairs(Core.ARMOR_TYPES) do filterCheck("armor", choice.name, 0, i - 1) end
    for i, choice in ipairs(Core.SLOTS) do
        filterCheck("slots", choice.name, 1 + math.floor((i - 1) / slotRows), (i - 1) % slotRows)
    end

    -- Its own section, under a line: "Show unknown recipes", those no source knows (unreleased,
    -- removed, or not found yet), hidden otherwise. A saved preference (showUnknown): it stays ticked
    -- across sessions, and Clear and Reset leave it. Only there when a complete source is (the seed).
    local section = CreateFrame("Frame", nil, filterPopup)
    section:SetPoint("TOPLEFT", filterPopup, "TOPLEFT", 0, -30 - slotRows * FILTER_ROW - 4)
    section:SetPoint("RIGHT", filterPopup, "RIGHT", 0, 0)
    section:SetHeight(48)
    local line = section:CreateTexture(nil, "ARTWORK")
    line:SetHeight(1)
    line:SetPoint("TOPLEFT", section, "TOPLEFT", 10, 0)
    line:SetPoint("TOPRIGHT", section, "TOPRIGHT", -10, 0)
    line:SetColorTexture(0.55, 0.45, 0.2, 0.6)
    local unvouched = CreateFrame("CheckButton", nil, section, "UICheckButtonTemplate")
    unvouched:SetSize(20, 20)
    unvouched:SetPoint("TOPLEFT", section, "TOPLEFT", 10, -8)
    local unvouchedText = unvouched.text or unvouched.Text or fontString(unvouched, "GameFontHighlightSmall")
    unvouchedText:ClearAllPoints()
    unvouchedText:SetPoint("LEFT", unvouched, "RIGHT", 1, 0)
    unvouchedText:SetText("Show unknown recipes")
    local hint = fontString(section, "GameFontDisableSmall")
    hint:SetPoint("TOPLEFT", unvouched, "BOTTOMLEFT", 22, 0)
    hint:SetText("No known source: unreleased, removed, or not found yet")
    unvouched:SetChecked(state.showUnvouched)
    unvouched:SetScript("OnClick", function(self)
        state.showUnvouched, state.offset = self:GetChecked() and true or false, 0
        Game.savedSettings().showUnknown = state.showUnvouched
        UI.refresh()
    end)
    filterPopup.unvouched, filterPopup.unknownSection = unvouched, section
    filterPopup:SetScript("OnShow", function(self)
        self.unknownSection:SetShown(Game.hidesUnvouched())
    end)

    local clear = CreateFrame("Button", nil, filterPopup, "UIPanelButtonTemplate")
    clear:SetSize(70, 20)
    clear:SetPoint("BOTTOMLEFT", filterPopup, "BOTTOMLEFT", 10, 10)
    clear:SetText("Clear")
    clear:SetScript("OnClick", function()
        UI.clearFilter()
        state.offset = 0
        UI.refresh()
    end)
    local done = CreateFrame("Button", nil, filterPopup, "UIPanelButtonTemplate")
    done:SetSize(70, 20)
    done:SetPoint("BOTTOMRIGHT", filterPopup, "BOTTOMRIGHT", -10, 10)
    done:SetText("Done")
    done:SetScript("OnClick", function() filterPopup:Hide() end)
    filterPopup.clear, filterPopup.done = clear, done
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
    d.hint:SetText("Pick a recipe to see its reagents, how to learn it and who can craft it.\n\nShift-click a recipe to link it in the chat, or the item at the top of its details for the item's link; ctrl-click to try it on. Click a name under Who can craft it to whisper them.")

    d.craft = CreateFrame("Button", nil, d, "UIPanelButtonTemplate")
    d.craft:SetSize(90, 22)
    d.craft:SetText("Craft")
    d.craft:SetScript("OnClick", function(self)
        local recipe = state.selected
        if not recipe or not self:IsEnabled() then return end
        Game.craft(recipe)
    end)
    d.craft:SetScript("OnEnter", craftTooltip)
    d.craft:SetScript("OnLeave", Game.hideTooltip)
    d.craft:Hide()
    -- Your bags change (a craft, loot): whether you have the reagents too.
    d.craft:RegisterEvent("BAG_UPDATE_DELAYED")
    d.craft:SetScript("OnEvent", function() ns.safely(drawCraft) end)
    d.name = linkButton(d, 32)
    -- A plain click on it opens your profession at the recipe, when this character knows it.
    d.name:SetScript("OnClick", function(self)
        if linkClicked(self) or not self.known then return end
        if not Game.openRecipe(self.recipe, self.known) then
            Game.say("the game doesn't let addons open your %s window.", self.recipe.profession)
        end
    end)
    d.name:SetScript("OnEnter", function(self)
        Game.showTooltip(self, self.hyperlink, self.known and ("Click to open it in " .. self.recipe.profession) or nil)
    end)
    d.info = fontString(d, "GameFontHighlightSmall")
    d.info:SetWidth(width)
    d.info:SetSpacing(2)
    d.reagentsHeader = fontString(d, "GameFontNormal")
    d.reagentsHeader:SetText("Reagents")
    d.reagents = {}
    for i = 1, MAX_REAGENTS do d.reagents[i] = linkButton(d, 18) end
    d.learnHeader = fontString(d, "GameFontNormal")
    d.learnHeader:SetText("How to learn it")
    -- Hovering the heading names the sources it comes from (the window's last line does too).
    d.learnHover = CreateFrame("Frame", nil, d)
    d.learnHover:SetAllPoints(d.learnHeader)
    d.learnHover:EnableMouse(true)
    d.learnHover:SetScript("OnEnter", function(self)
        local names = sourceNames()
        if names then Game.showTextTooltip(self, "Sources", names) end
    end)
    d.learnHover:SetScript("OnLeave", Game.hideTooltip)
    d.learnHover:Hide()
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
    d.crafterNames = CreateFrame("Frame", nil, d)
    d.crafterNames:SetSize(width, CRAFTER_LINE)
    d.crafterNames.width = width
    d.crafterNames.names = {}
    for i = 1, MAX_CRAFTERS do
        local button = CreateFrame("Button", nil, d.crafterNames)
        button:SetHighlightTexture(HIGHLIGHT, "ADD")
        button.text = fontString(button, "GameFontHighlightSmall")
        button.text:SetPoint("LEFT", button, "LEFT", 0, 0)
        button:SetScript("OnClick", function(self)
            if self.whisper then Game.whisper(self.whisper) end
        end)
        button:SetScript("OnEnter", function(self)
            if self.whisper then Game.showTextTooltip(self, self.whisper, { "Click to whisper" }) end
        end)
        button:SetScript("OnLeave", Game.hideTooltip)
        button:Hide()
        d.crafterNames.names[i] = button
    end
    d.crafterNames.more = fontString(d.crafterNames, "GameFontHighlightSmall")

    d.regions = { { d.craft }, { d.name, 6 }, { d.info, 6 }, { d.reagentsHeader, 12 } }
    for _, button in ipairs(d.reagents) do d.regions[#d.regions + 1] = { button, 2 } end
    d.regions[#d.regions + 1] = { d.learnHeader, 12 }
    d.regions[#d.regions + 1] = { d.learn, 4 }
    for _, button in ipairs(d.recipeItems) do d.regions[#d.regions + 1] = { button, 2 } end
    d.regions[#d.regions + 1] = { d.craftersHeader, 12 }
    d.regions[#d.regions + 1] = { d.crafters, 4 }
    d.regions[#d.regions + 1] = { d.crafterNames, 4 }
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

    state.showUnvouched = Game.savedSettings().showUnknown == true
    buildFilters()
    buildFilterPopup()
    buildSidebar()
    buildList()
    buildDetails()

    statusText = fontString(frame, "GameFontHighlightSmall")
    statusText:SetPoint("BOTTOMLEFT", frame, "BOTTOMLEFT", 16, 13)
    statusText:SetWidth(STATUS_WIDTH)
    statusText:SetWordWrap(false)
    -- Hovering it (as wide as its text) says where the recipes come from: the game's data, its
    -- build, and the sources of how they're obtained.
    statusHover = CreateFrame("Frame", nil, frame)
    statusHover:SetPoint("BOTTOMLEFT", statusText, "BOTTOMLEFT", 0, -2)
    statusHover:SetSize(1, 16)
    statusHover:EnableMouse(true)
    statusHover:SetScript("OnEnter", function(self)
        local data = ns.Data or {}
        local lines = { "Build " .. (data.build or data.fetched or "?") }
        local names = sourceNames()
        if names then
            lines[#lines + 1] = "|cffffd100Sources|r"
            for _, name in ipairs(names) do lines[#lines + 1] = name end
        end
        Game.showTextTooltip(self, Core.describe(data) .. " from the game's data", lines)
    end)
    statusHover:SetScript("OnLeave", Game.hideTooltip)
    versionText = fontString(frame, "GameFontDisableSmall", "RIGHT")
    versionText:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -16, 13)
    local version = Game.version()
    versionText:SetText(version and ("v" .. version) or "")
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
        clearButton = clearButton, filterButton = filterButton, filterPopup = filterPopup, filterChecks = filterChecks,
        sidebarButtons = sidebarButtons, rows = rows, details = details, statusText = statusText,
        statusHover = statusHover, versionText = versionText,
        state = state,
    }
end
