-- GuildAssistant Database: the window. A search box, level/skill limits and a Filter button (slots,
-- armor types, binds on pickup, only your guild's) along the top; the professions on the left, with how many recipes of each match
-- the search; the matching recipes in the middle (only the visible rows exist, reused as the list
-- scrolls); the chosen recipe's details on the right: what it makes, its reagents, how to learn it
-- and who can craft it. The Skill and Level titles above the list sort it, each with a chevron
-- saying which way: the column clicked, then the other breaking its ties. A profession's data is
-- only read the first time it's needed, one profession per frame, so opening the window never
-- stalls the game.
--
-- With GuildAssistant Professions, three tabs under the window: Recipes (the above), Guild and
-- Attunements. Guild: the professions on the left with how many guildmates have each, the
-- guildmates in the middle ("Shivan Darkwhisp  190  Blacksmithing - Weaponsmith"), sorted by the
-- Name, Skill and Profession titles above them as Recipes' list is sorted by Skill and Level, and a
-- click on one lists what they can make, whose details show as Recipes' do. Attunements: the raids
-- on the left with how many guildmates are attuned to each, the guildmates in the middle with a
-- tick per raid, and a click on one shows their attunements, raid by raid, as the details. Its
-- Name title sorts them A to Z, and a raid's icon above its column sorts by who is attuned to it,
-- one of the two at a time; it comes sorted by the first raid, the attuned first. The search box
-- searches whichever is listed.

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
-- The Guild tab's rows: the name, the skill (right-aligned, ending here), the profession from here.
-- The name takes what a long one needs ("Shivan Darkwhisp (you)"), and the gap between the two
-- holds the Skill title's chevron.
local MEMBER_SKILL_RIGHT, MEMBER_PROFESSION_LEFT = 186, 200
-- The Attunements tab's rows: the guildmate's name, then a column per raid with its mark. The
-- columns sit at the right-hand end of the row and the name takes every pixel they leave, so with
-- one raid even a long name is read whole. This many columns fit; with more raids than that, the
-- rest show on a guildmate's own page (and picking one on the left brings it into view).
local ATTUNE_COLUMN_WIDTH, MAX_ATTUNE_COLUMNS = 40, 5
-- Between the longest name and the first mark.
local ATTUNE_NAME_GAP = 8
-- The raid's own icon, which heads its column (the tooltip there says which raid it is).
local ATTUNE_ICON = 20
local SIDEBAR_ROWS = 14
local MAX_REAGENTS, MAX_RECIPE_ITEMS, MAX_CRAFTERS = 8, 3, 15
local QUESTION_MARK = "Interface\\Icons\\INV_Misc_QuestionMark"
local GUILD_CHOICE = "Only guild"
local HIGHLIGHT = "Interface\\QuestFrame\\UI-QuestTitleHighlight"
-- The game's own sort arrow, as it comes pointing down (highest first) and flipped for lowest first.
local SORT_ARROW = "Interface\\Buttons\\UI-SortArrow"
-- The attunement marks: the game's tick, a dash for looked at and not attuned, and a question mark
-- for a character no addon has looked at (not the same as not attuned).
local ATTUNED_MARK = "|TInterface\\Buttons\\UI-CheckBox-Check:18:18|t"
local NOT_ATTUNED_MARK = "|cff808080-|r"
local UNKNOWN_MARK = "|cff808080?|r"
local CHEVRON_DOWN, CHEVRON_UP = { 0, 0.5625, 0, 1 }, { 0, 0.5625, 1, 0 }
local CHEVRON_SIZE = 10

local frame
local searchBox, placeholder, clearButton, minLevelBox, maxLevelBox, minSkillBox, maxSkillBox, unknownCheck, resetButton
local filterButton, filterPopup, filterChecks
local sidebarButtons, rows, slider, statusText, statusHover, versionText, columnSkill, columnLevel
-- The titles that sort the list they're above, each with the chevron saying how: the recipes' Skill
-- and Level, the Guild tab's Name, Skill and Profession, and the Attunements tab's Name (its raids'
-- icons sort too, and are headers of the same kind).
local sortHeaders, memberHeaders, attuneName, attuneHeaders
local details
-- The tabs, what only Recipes shows (the limits, the Filter, Not known yet), and the Guild tab's own:
-- the guildmates' rows and the line above the list (Back, whose recipes).
local tabs, recipeControls, recipeColumns, memberRows, backButton, crumb
-- The Attunements tab's rows and its column titles (one per raid shown).
local attuneRows, attuneColumns
local ATTUNE_HINT = "Click a guildmate to see which raids they are attuned to.\n\nYour guildmates who use GuildAssistant Professions, with a tick for each raid they are attuned to, a dash where they aren't, and a question mark where no one's addon has looked yet. The attuned come first; click Name or a raid's icon above the list to sort it another way. Pick a raid on the left for the guildmates attuned to it, or search by name."
local GUILD_HINT = "Click a guildmate to see what they can make.\n\nYour guildmates who use GuildAssistant Professions, each profession with its skill and specialization. Search by name, profession or specialization (weaponsmith), and click Name, Skill or Profession above the list to sort it."
local RECIPE_HINT = "Pick a recipe to see its reagents, how to learn it and who can craft it.\n\nShift-click a recipe to link it in the chat, or the item at the top of its details for the item's link; ctrl-click to try it on. Click a name under Who can craft it to whisper them.\n\nShift-click an item anywhere (your bags, a link in the chat) with the chat box closed to search for it."

local state = {
    profession = nil, -- the profession picked on the left, nil for all
    unknownOnly = false, -- only your professions' recipes you don't know yet
    results = {},
    offset = 0,
    selected = nil, -- the recipe whose details are shown
    loadingScheduled = false,
    mine = {}, -- Game.myProfessions() at the last refresh
    slots = {}, armor = {}, binding = {}, -- the Filter's choices, by name (Core.SLOTS, Core.ARMOR_TYPES, Core.BINDINGS)
    guild = {}, -- the Filter's "Only guild" ({ [GUILD_CHOICE] = true } when ticked)
    showUnvouched = false, -- "Show unknown recipes": also those no source knows (saved: showUnknown)
    counts = nil, -- with a search: how many recipes of each profession match ({ [name] = n })
    total = 0, -- how many match in all the listed professions
    tab = "recipes", -- or "guild"
    -- The columns clicked above the list (Core.toggleOrder), empty until one is; and the order the
    -- list is in now, those columns or, with none, the order it comes in (Core.defaultOrder).
    order = {}, listOrder = Core.BROWSE_ORDER,
    -- The same for the Guild tab's guildmates (Name, Skill and Profession): the columns clicked,
    -- and the order they're in now (Core.MEMBER_ORDER until one is).
    memberOrder = {}, memberListOrder = Core.MEMBER_ORDER,
    -- The Guild tab: every guildmate row (Core.guildMembers), those listed, the one whose recipes are
    -- listed instead (nil: the guildmates are), and what to go back to (the search, the place).
    allMembers = {}, members = {}, member = nil, back = nil,
    -- The Attunements tab: every guildmate (Core.guildAttunements), those listed, the raid picked
    -- on the left, the guildmate whose attunements are shown, the raids known and those with a
    -- column of their own.
    allAttuned = {}, attuned = {}, raid = nil, attunedMember = nil, raids = {}, attuneColumns = {},
    -- The Attunements tab's sorting: the column clicked (Name or a raid's key, one at a time, empty
    -- until one is), the order the list is in now (those, or the one the tab comes in,
    -- Core.attunementOrder), and the columns the raids known make (Core.attunementList).
    attuneOrder = {}, attuneListOrder = {}, attuneList = Core.attunementList(nil),
}
-- Each tab's search, profession, place in the list and pick, kept while the other is shown.
local memory = { recipes = {}, guild = {}, attunements = {} }

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

--- The guild whose recipes only are listed: yours, when "Only guild" is ticked and you're in one.
local function onlyGuild()
    return state.guild[GUILD_CHOICE] and Game.guildName() or nil
end

local function query()
    local guild = onlyGuild()
    local include
    if state.unknownOnly then
        include = function(recipe)
            local profession = state.mine[recipe.profession]
            return profession ~= nil and not profession.knows(recipe)
        end
    end
    local slots, armor, binding = Core.filterSets(state.slots, state.armor, state.binding)
    return {
        terms = Core.terms(searchBox:GetText()),
        minLevel = Core.limit(minLevelBox:GetText()), maxLevel = Core.limit(maxLevelBox:GetText()),
        minSkill = Core.limit(minSkillBox:GetText()), maxSkill = Core.limit(maxSkillBox:GetText()),
        slots = slots, armor = armor, binding = binding, include = include,
        known = guild and Core.guildRecipes(Game.professionsDB(), guild) or nil,
        vouchedOnly = Game.hidesUnvouched() and not state.showUnvouched,
        order = state.order,
    }
end

--- The order the list is in: the columns clicked, or, with none, the order it comes in -- by skill
--- while you're only looking at a profession, by level once `matched` (a search, a limit or a
--- filter) has narrowed it down.
local function listOrder(matched)
    return #state.order > 0 and state.order or Core.defaultOrder(matched)
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

-- The Guild tab's left column: all professions, then each one a guildmate has (the data's first, in
-- its order, then the others: Herbalism…), with how many guildmates have it (with a search, how
-- many match, in gold).
local function drawGuildSidebar()
    local searching = #Core.terms(searchBox:GetText()) > 0 and not state.member
    local function count(n) return searching and matchCount(n) or Core.thousands(n or 0) end
    local items = { { name = nil, text = "All professions", right = count(state.guildTotal) } }
    for _, name in ipairs(state.guildProfessions or {}) do
        items[#items + 1] = { name = name, text = name, right = count((state.guildCounts or {})[name]) }
    end
    for i, button in ipairs(sidebarButtons) do
        local item = items[i]
        if item then
            button.profession, button.raid = item.name, nil
            button.text:SetText(item.text)
            button.right:SetText(item.right or "")
            if item.name == state.profession then button.selected:Show() else button.selected:Hide() end
            button:Show()
        else
            button:Hide()
        end
    end
end

-- The Attunements tab's left column: all the guildmates, then each raid with how many of them are
-- attuned to it (with a search, of those the search keeps).
local function drawAttunementSidebar()
    local items = { { raid = nil, text = "All guildmates", right = Core.thousands(state.attunedTotal or 0) } }
    for _, raid in ipairs(state.raids) do
        items[#items + 1] = { raid = raid.key, text = Core.attunementLabel(raid),
            right = Core.thousands((state.attunedCounts or {})[raid.key] or 0) }
    end
    for i, button in ipairs(sidebarButtons) do
        local item = items[i]
        if item then
            button.profession, button.raid = nil, item.raid
            button.text:SetText(item.text)
            button.right:SetText(item.right or "")
            if item.raid == state.raid then button.selected:Show() else button.selected:Hide() end
            button:Show()
        else
            button:Hide()
        end
    end
end

local function drawSidebar()
    if state.tab == "attunements" then return drawAttunementSidebar() end
    if state.tab == "guild" then return drawGuildSidebar() end
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
            button.profession, button.raid = item.name, nil
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
    if not state.unknownOnly or state.tab ~= "recipes" then return "ffffd100" end
    local mine = state.mine[recipe.profession]
    -- Learnable now (green), or not yet (red).
    return (mine and mine.rank >= recipe.skill) and "ff40ff40" or "ffff5050"
end

-- The Guild tab lists guildmates, until one is picked (then their recipes, as Recipes lists them).
local function listingMembers()
    return state.tab == "guild" and state.member == nil
end

local function sourceSuffix(member)
    if member.you then return " |cff808080(you)|r" end
    return member.source == "own" and " |cff808080(alt)|r" or ""
end

local function updateSlider(count)
    local maxOffset = math.max(0, count - ROWS)
    state.offset = math.min(math.max(state.offset, 0), maxOffset)
    slider:SetMinMaxValues(0, maxOffset)
    slider:SetValue(state.offset)
    if maxOffset > 0 then slider:Show() else slider:Hide() end
end

local function drawMembers()
    local members = state.members
    updateSlider(#members)
    for i, row in ipairs(memberRows) do
        local member = members[state.offset + i]
        if member then
            row.member = member
            row.name:SetText(("|c%s%s|r%s"):format(Game.classHex(member.class), member.name, sourceSuffix(member)))
            row.skill:SetText(member.rank > 0 and tostring(member.rank) or "")
            row.profession:SetText(Core.professionLine(member))
            row:Show()
        else
            row.member = nil
            row:Hide()
        end
    end
end

--- `label` in bold, or back as it came: the game ships no bold face, so its own UI thickens text
--- with an outline, and that is what this does. A client that won't take the font keeps it as it is.
local function setBold(label, bold)
    if not label.font or label.bold == bold then return end
    if label:SetFont(label.font, label.size, bold and "OUTLINE" or "") == false then return end
    label.bold = bold
end

--- The mark for an attunement: attuned, looked at and not attuned, or never looked at.
local function attunementMark(attuned)
    if attuned == true then return ATTUNED_MARK end
    return attuned == false and NOT_ATTUNED_MARK or UNKNOWN_MARK
end

local function drawAttunedRows()
    local members = state.attuned
    updateSlider(#members)
    for i, row in ipairs(attuneRows) do
        local member = members[state.offset + i]
        if member then
            row.member = member
            -- Your own characters are in bold, with no "(you)" after them: this list is yours to
            -- read, and the name needs the room more than the label.
            row.name:SetText(("|c%s%s|r"):format(Game.classHex(member.class), member.name))
            setBold(row.name, member.source == "own")
            for column, mark in ipairs(row.marks) do
                local raid = state.attuneColumns[column]
                mark:SetText(raid and attunementMark(member.states[raid.key]) or "")
                mark:SetShown(raid ~= nil)
            end
            if member == state.attunedMember then row.selected:Show() else row.selected:Hide() end
            row:Show()
        else
            row.member = nil
            row:Hide()
        end
    end
end

local function drawRecipeRows()
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

--- The columns a title sorts: the Attunements tab's are the raids known right now, so its titles
--- read them from the state rather than holding a set of their own.
local function headerList(header)
    if header.attunements then return state.attuneList end
    return header.list
end

--- The order the list a title sorts is in now: the guildmates' for the Guild tab's titles, the
--- attuned guildmates' for the Attunements tab's, the recipes' for Skill and Level.
local function headerOrder(header)
    if header.attunements then return state.attuneListOrder end
    return header.list == Core.MEMBER_LIST and state.memberListOrder or state.listOrder
end

--- How the list a title sorts is read now and what a click would do, as tooltip lines after `first`
--- (what the title itself is).
local function sortLines(header, first)
    local list, order = headerList(header), headerOrder(header)
    local lines = first
    local words = Core.orderWords(order, list)
    if words then lines[#lines + 1] = words end
    lines[#lines + 1] = Core.clickWords(order, header.column, list)
    return lines
end

-- What hovering a column's title says: what it is (its own hint), how the list is sorted now, and
-- what a click does.
local function showSortTooltip(header)
    Game.showTextTooltip(header, header.title:GetText(), sortLines(header, { header.hint }))
end

-- Hovering a raid's icon above its column: which raid it is, what the three marks mean, how the
-- guildmates are sorted now and what a click would do.
local function showRaidTooltip(header)
    if not header.raid then return end
    Game.showTextTooltip(header, header.raid.raid, sortLines(header, {
        "Who in your guild is attuned to it.",
        "A tick is attuned, - not attuned, ? not known yet.",
    }))
end

--- The chevron beside each of `headers`: how their list is sorted. The column it's sorted by in
--- gold, the one breaking its ties in grey, and none on a column the order doesn't use.
local function drawSortHeaders(headers)
    for _, header in ipairs(headers or {}) do
        local direction, sorting = Core.orderOf(headerOrder(header), header.column)
        if direction then
            local chevron = direction == "ascending" and CHEVRON_UP or CHEVRON_DOWN
            header.chevron:SetTexCoord(chevron[1], chevron[2], chevron[3], chevron[4])
            if sorting then
                header.chevron:SetVertexColor(1, 0.82, 0)
            else
                header.chevron:SetVertexColor(0.5, 0.5, 0.5)
            end
            header.chevron:Show()
        else
            header.chevron:Hide()
        end
    end
end

-- How many raid columns the rows are laid out for, so they're only moved when that changes.
local placedColumns

--- Puts `count` raid columns at the right-hand end of the rows, in their order, and gives the name
--- beside them everything they leave: one raid, and a long name is read whole. Each column's title
--- sits above the first row, so it lines up with the marks under it however many there are.
local function placeAttuneColumns(count)
    if placedColumns == count then return end
    placedColumns = count
    for i, header in ipairs(attuneColumns) do
        header:ClearAllPoints()
        header:SetPoint("BOTTOMRIGHT", attuneRows[1], "TOPRIGHT", -(count - i) * ATTUNE_COLUMN_WIDTH, 5)
    end
    for _, row in ipairs(attuneRows) do
        for i, mark in ipairs(row.marks) do
            mark:ClearAllPoints()
            mark:SetPoint("RIGHT", row, "RIGHT", -(count - i) * ATTUNE_COLUMN_WIDTH, 0)
        end
        row.name:ClearAllPoints()
        row.name:SetPoint("LEFT", row, "LEFT", 6, 0)
        row.name:SetPoint("RIGHT", row, "RIGHT", -count * ATTUNE_COLUMN_WIDTH - ATTUNE_NAME_GAP, 0)
    end
end

--- The list: guildmates with their attunements, guildmates with their professions, or recipes; the
--- column titles that go with it.
local function drawRows()
    local attunements = state.tab == "attunements"
    local members = listingMembers()
    if attunements then placeAttuneColumns(#state.attuneColumns) end
    for _, region in ipairs(memberHeaders) do region:SetShown(members) end
    for _, region in ipairs(recipeColumns) do region:SetShown(not members and not attunements) end
    attuneName:SetShown(attunements)
    for i, header in ipairs(attuneColumns) do
        local raid = attunements and state.attuneColumns[i] or nil
        if raid then
            -- The raid's own icon heads its column; its short name where the data has no icon.
            header.icon:SetTexture(raid.icon)
            header.icon:SetShown(raid.icon ~= nil)
            header.title:SetText(raid.icon and "" or (raid.short or raid.raid))
        end
        header.raid, header.column = raid, raid and raid.key or nil
        header:SetShown(raid ~= nil)
    end
    local function hideRecipes()
        for _, row in ipairs(rows) do
            row.recipe, row.hyperlink = nil, nil
            row:Hide()
        end
    end
    local function hideMembers()
        for _, row in ipairs(memberRows) do
            row.member = nil
            row:Hide()
        end
    end
    local function hideAttuned()
        for _, row in ipairs(attuneRows) do
            row.member = nil
            row:Hide()
        end
    end
    if attunements then
        -- The Name title and each raid's icon: both sort the guildmates, one at a time.
        drawSortHeaders(attuneHeaders)
        hideRecipes()
        hideMembers()
        return drawAttunedRows()
    end
    hideAttuned()
    if members then
        drawSortHeaders(memberHeaders)
        hideRecipes()
        return drawMembers()
    end
    drawSortHeaders(sortHeaders)
    hideMembers()
    drawRecipeRows()
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
    -- The specialization its plans require, as their tooltip says it: "Requires Armorsmith".
    if recipe.specialization then lines[#lines + 1] = ("Requires %s"):format(recipe.specialization) end
    local item = recipe.creates
    if item then
        -- As the item's tooltip says it: what you make is yours alone.
        if item.bonding == Core.BIND_ON_PICKUP then lines[#lines + 1] = "Binds when picked up" end
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

-- Who a guildmate is: their name in their class's colour, and whether they're you, your alt or a
-- guildmate.
local function whoLines(member)
    local who = member.you and "You" or member.source == "own" and "Your alt" or "Guildmate"
    return { ("|c%s%s|r"):format(Game.classHex(member.class), member.name), "|cff808080" .. who .. "|r", "" }
end

-- A guildmate's attunements, raid by raid: attuned, not attuned, or not known (nobody with the
-- addon has looked at that character). On their page in the Guild tab as well as the Attunements
-- tab's details, so it is wherever they are.
local function attunementLines(member)
    local rows = Core.attunementRows(member, state.raids)
    if #rows == 0 then return {} end
    local lines = { "|cffffd100Attunements|r" }
    local unknown = false
    for _, row in ipairs(rows) do
        local said = row.attuned == true and "|cff40ff40Attuned|r"
            or row.attuned == false and "|cff808080Not attuned|r" or "|cff808080Not known|r"
        if row.attuned == nil then unknown = true end
        lines[#lines + 1] = ("%s: %s"):format(Core.attunementLabel(row), said)
    end
    if unknown then
        lines[#lines + 1] = "|cff808080Not known: their GuildAssistant Professions hasn't looked (or is older than 1.6.0).|r"
    end
    return lines
end

-- A guildmate, when no recipe of theirs is picked: who they are, each profession they have with its
-- skill and specialization, and which raids they are attuned to.
local function memberSummary(member)
    local lines = whoLines(member)
    for _, other in ipairs(state.allMembers) do
        if other.key == member.key then
            local skill = other.rank > 0 and (other.max and ("%d/%d "):format(other.rank, other.max) or (other.rank .. " ")) or ""
            lines[#lines + 1] = skill .. Core.professionLine(other)
        end
    end
    local attuned
    for _, row in ipairs(state.allAttuned) do
        if row.key == member.key then attuned = row end
    end
    if attuned then
        lines[#lines + 1] = ""
        for _, line in ipairs(attunementLines(attuned)) do lines[#lines + 1] = line end
    end
    lines[#lines + 1] = ""
    lines[#lines + 1] = "|cff808080Click a recipe for its details.|r"
    return table.concat(lines, "\n")
end

-- A guildmate on the Attunements tab: who they are, then every raid.
local function attunementSummary(member)
    local lines = whoLines(member)
    for _, line in ipairs(attunementLines(member)) do lines[#lines + 1] = line end
    return table.concat(lines, "\n")
end

local function drawDetails()
    local recipe = state.selected
    local d = details
    if not recipe then
        for _, region in ipairs(d.regions) do region[1]:Hide() end
        d.learnHover:Hide()
        local summary
        if state.tab == "guild" and state.member then
            summary = memberSummary(state.member)
        elseif state.tab == "attunements" and state.attunedMember then
            summary = attunementSummary(state.attunedMember)
        end
        if summary then
            d.hint:Hide()
            d.summary:SetText(summary)
            d.summary:Show()
            return
        end
        d.summary:Hide()
        d.hint:SetText(state.tab == "attunements" and ATTUNE_HINT
            or state.tab == "guild" and GUILD_HINT or RECIPE_HINT)
        d.hint:Show()
        return
    end
    d.summary:Hide()
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
    if state.total == 0 and onlyGuild() then
        -- What the guild can craft comes from GuildAssistant Professions, theirs and yours.
        line = ("%s  |cffffd100%s|r"):format(line, Game.professionsDB()
            and "Only guildmates who use GuildAssistant Professions are known."
            or "Install GuildAssistant Professions to know what your guild can craft.")
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

-- The Guild tab ----------------------------------------------------------------------------------

--- The line above the Guild and Attunements tabs' lists: your guild, or Back and whose recipes are
--- listed.
local function drawCrumb()
    local guildTab = state.tab == "guild"
    backButton:SetShown(guildTab and state.member ~= nil)
    crumb:SetShown(guildTab or state.tab == "attunements")
    if state.tab == "recipes" then return end
    crumb:ClearAllPoints()
    local member = guildTab and state.member or nil
    if member then
        crumb:SetPoint("LEFT", backButton, "RIGHT", 10, 0)
        crumb:SetText(("|c%s%s|r  %s%s"):format(Game.classHex(member.class), member.name,
            member.rank > 0 and (member.rank .. " ") or "", Core.professionLine(member)))
        return
    end
    crumb:SetPoint("TOPLEFT", frame, "TOPLEFT", 20, -64)
    local guild = Game.guildName()
    if not guild then return crumb:SetText("") end
    crumb:SetText(guildTab
        and ("|cffffd100%s|r: guildmates who use GuildAssistant Professions"):format(guild)
        or ("|cffffd100%s|r: which raids each guildmate is attuned to"):format(guild))
end

local function guildStatus(pending, total, guild, byName)
    if pending > 0 then return ("Reading recipes... %d of %d professions"):format(total - pending, total) end
    if not guild then return "You're not in a guild: this tab lists your guildmates' professions." end
    if #state.allMembers == 0 then
        return ("No one in %s is known yet: guildmates who use GuildAssistant Professions show here."):format(guild)
    end
    local member = state.member
    if member then
        if not byName[member.profession] then return ("Nothing to make with %s."):format(member.profession) end
        local count = #state.results
        if count == 0 then return "No recipes match." end
        return ("%s can make %s recipe%s%s."):format(member.name, Core.thousands(count), count == 1 and "" or "s",
            #Core.terms(searchBox:GetText()) > 0 and " that match" or "")
    end
    local people = {}
    local count = 0
    for _, row in ipairs(state.members) do
        if not people[row.key] then people[row.key], count = true, count + 1 end
    end
    if count == 0 then return "No guildmates match." end
    return ("%s guildmate%s"):format(Core.thousands(count), count == 1 and "" or "s")
end

--- The Guild tab, up to date: its guildmates (each profession they have, read one per frame for
--- the specializations their recipes tell), those the search and the profession picked keep, or
--- what the one picked can make.
local function refreshGuild()
    local guild = Game.guildName()
    local byName = {}
    for _, entry in ipairs(ns.Data and ns.Data.professions or {}) do byName[entry.name] = entry end
    local all = Core.guildMembers(Game.professionsDB(), guild, byName, Game.playerKey())
    local wanted, seen, professions, known = {}, {}, {}, {}
    for _, member in ipairs(all) do
        local entry = byName[member.profession]
        if entry and not seen[entry] then seen[entry], wanted[#wanted + 1] = true, entry end
        known[member.profession] = true
    end
    -- The data's professions first, in its order, then the others (Herbalism…), by name.
    for _, entry in ipairs(ns.Data and ns.Data.professions or {}) do
        if known[entry.name] then professions[#professions + 1], known[entry.name] = entry.name, nil end
    end
    local others = {}
    for name in pairs(known) do others[#others + 1] = name end
    table.sort(others)
    for _, name in ipairs(others) do professions[#professions + 1] = name end
    local pending = loadPending(wanted)
    state.allMembers, state.guildProfessions = all, professions
    -- The attunements too: a guildmate's page shows them under their professions.
    local db = Game.professionsDB()
    state.allAttuned, state.raids = Core.guildAttunements(db, guild, Game.playerKey()), Core.attunementRaids(db)
    if state.member then
        -- As read now (a newer skill, a specialization its recipes tell once read); gone: back.
        local again
        for _, member in ipairs(all) do
            if member.key == state.member.key and member.profession == state.member.profession then again = member end
        end
        state.member = again
        if not again then state.selected, state.back = nil, nil end
    end
    local terms = Core.terms(searchBox:GetText())
    state.listOrder = listOrder(#terms > 0)
    state.memberListOrder = #state.memberOrder > 0 and state.memberOrder or Core.MEMBER_ORDER
    local found = Core.findMembers(all, state.member and {} or terms)
    state.guildCounts = {}
    for _, member in ipairs(found) do
        state.guildCounts[member.profession] = (state.guildCounts[member.profession] or 0) + 1
    end
    state.guildTotal = #found
    if state.member then
        local entry = byName[state.member.profession]
        state.results = entry and entry.loaded and Core.memberRecipes(entry.loaded, state.member.record, terms, state.order) or {}
        state.members = {}
    else
        state.members = Core.findMembers(all, terms, state.profession, state.memberListOrder)
        state.results = {}
    end
    if state.selected then
        local listed = false
        for _, recipe in ipairs(state.results) do listed = listed or recipe == state.selected end
        if not listed then state.selected = nil end
    end
    drawSidebar()
    drawRows()
    drawDetails()
    drawCrumb()
    statusText:SetText(guildStatus(pending, #wanted, guild, byName))
    statusHover:SetWidth(math.min(statusText:GetStringWidth(), STATUS_WIDTH))
end

local function attunementStatus(guild)
    if not guild then return "You're not in a guild: this tab lists your guildmates' attunements." end
    if #state.allAttuned == 0 then
        return ("No one in %s is known yet: guildmates who use GuildAssistant Professions show here."):format(guild)
    end
    local count = #state.attuned
    if count == 0 then
        if state.raid then
            local raid = state.raid
            for _, entry in ipairs(state.raids) do
                if entry.key == state.raid then raid = entry.raid end
            end
            return ("No one known is attuned to %s yet."):format(raid)
        end
        return "No guildmates match."
    end
    local line = ("%s guildmate%s"):format(Core.thousands(count), count == 1 and "" or "s")
    local hidden = #state.raids - #state.attuneColumns
    if hidden > 0 then
        line = ("%s  |cffffd100%d more raid%s: click a guildmate, or pick one on the left.|r"):format(
            line, hidden, hidden == 1 and "" or "s")
    end
    return line
end

--- The Attunements tab, up to date: every guildmate GuildAssistant Professions knows with the raids
--- they are attuned to, those the search and the raid picked keep, and the one whose raids are shown.
local function refreshAttunements()
    local guild = Game.guildName()
    local db = Game.professionsDB()
    local all = Core.guildAttunements(db, guild, Game.playerKey())
    state.allAttuned, state.raids = all, Core.attunementRaids(db)
    -- A raid picked on the left that isn't there any more: all of them.
    if state.raid then
        local listed = false
        for _, raid in ipairs(state.raids) do listed = listed or raid.key == state.raid end
        if not listed then state.raid = nil end
    end
    state.attuneColumns = Core.attunementColumns(state.raids, state.raid, MAX_ATTUNE_COLUMNS)
    -- The columns to sort by are the raids known now; one the data no longer has takes the list
    -- back to the order it opens in.
    state.attuneList = Core.attunementList(state.raids)
    local clicked = state.attuneOrder[1]
    if clicked and not state.attuneList.columns[clicked.column] then state.attuneOrder = {} end
    -- With no title clicked the tab comes sorted by its first raid, the attuned first.
    state.attuneListOrder = #state.attuneOrder > 0 and state.attuneOrder
        or Core.attunementOrder(state.attuneColumns)
    local matched = Core.findAttuned(all, Core.terms(searchBox:GetText()), nil)
    state.attunedCounts, state.attunedTotal = Core.attunedCounts(matched), #matched
    state.attuned = state.raid and Core.findAttuned(matched, nil, state.raid) or matched
    state.attuned = Core.sortAttunements(state.attuned, state.attuneListOrder, state.attuneList)
    -- The guildmate whose raids are shown, as read now; gone from the guild: none.
    if state.attunedMember then
        local again
        for _, member in ipairs(all) do
            if member.key == state.attunedMember.key then again = member end
        end
        state.attunedMember = again
    end
    state.results, state.members = {}, {}
    drawSidebar()
    drawRows()
    drawDetails()
    drawCrumb()
    statusText:SetText(attunementStatus(guild))
    statusHover:SetWidth(math.min(statusText:GetStringWidth(), STATUS_WIDTH))
end

-- The tabs, in order, and what the search box says it searches on each.
local TAB_KEYS = { "recipes", "guild", "attunements" }
local SEARCH_HINTS = {
    recipes = "Search: name, stat, slot, reagent",
    guild = "Search: name, profession, specialization",
    attunements = "Search: a guildmate's name",
}

-- Which tab shows: its own controls (Recipes: the limits, the Filter and Not known yet), the search
-- box's hint, and the tabs drawn picked or not.
local function drawTabs()
    local recipeTab = state.tab == "recipes"
    for _, control in ipairs(recipeControls) do control:SetShown(recipeTab) end
    if not recipeTab then filterPopup:Hide() end
    placeholder:SetText(SEARCH_HINTS[state.tab] or SEARCH_HINTS.recipes)
    for i, tab in ipairs(tabs) do
        local picked = TAB_KEYS[i] == state.tab
        if tab.panel and PanelTemplates_SelectTab and PanelTemplates_DeselectTab then
            if picked then PanelTemplates_SelectTab(tab) else PanelTemplates_DeselectTab(tab) end
        else
            tab:SetEnabled(not picked)
        end
    end
    if recipeTab then
        backButton:Hide()
        crumb:Hide()
    end
end

--- Shows tab `to` ("recipes", "guild", "attunements") as it was left: its search, what was picked
--- on the left, its place in the list and its pick.
local function switchTab(to)
    if state.tab == to then return end
    memory[state.tab] = { search = searchBox:GetText(), profession = state.profession, offset = state.offset,
        selected = state.selected, member = state.member, back = state.back,
        raid = state.raid, attunedMember = state.attunedMember }
    state.tab = to
    local kept = memory[to] or {}
    state.profession, state.offset, state.selected = kept.profession, kept.offset or 0, kept.selected
    state.member, state.back = kept.member, kept.back
    state.raid, state.attunedMember = kept.raid, kept.attunedMember
    state.results, state.members, state.attuned = {}, {}, {}
    searchBox:SetText(kept.search or "")
    drawTabs()
end

--- Lists what `member` can make (their profession's recipes they know); Back returns to the
--- guildmates as they were (the search too).
local function openMember(member)
    state.back = { search = searchBox:GetText(), offset = state.offset }
    state.member, state.selected, state.offset = member, nil, 0
    searchBox:SetText("")
    UI.refresh()
end

local function closeMember()
    local back = state.back or {}
    state.member, state.selected, state.back = nil, nil, nil
    searchBox:SetText(back.search or "")
    state.offset = back.offset or 0
    UI.refresh()
end

--- Brings everything up to date with the filters: which professions, the results, the details.
function UI.refresh()
    if not frame or not frame:IsShown() then return end
    -- The tabs only with GuildAssistant Professions: the Guild tab is what it saved.
    local hasProfessions = Game.professionsDB() ~= nil
    for _, tab in ipairs(tabs) do tab:SetShown(hasProfessions) end
    if not hasProfessions and state.tab ~= "recipes" then switchTab("recipes") end
    drawTabs()
    placeholder:SetShown(searchBox:GetText() == "" and not searchBox:HasFocus())
    if state.tab == "attunements" then return refreshAttunements() end
    if state.tab == "guild" then return refreshGuild() end
    state.mine = state.unknownOnly and Game.myProfessions() or {}
    -- A profession picked before that isn't listed now (switching to yours only): all of them.
    if state.profession then
        local listed = false
        for _, entry in ipairs(listedEntries()) do listed = listed or entry.name == state.profession end
        if not listed then state.profession = nil end
    end
    local q = query()
    state.listOrder = listOrder(Core.isQuery(q))
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
        state.order, state.memberOrder, state.attuneOrder = {}, {}, {}
        if state.tab == "guild" then
            -- The Guild tab's: its search, the profession picked, the guildmate.
            searchBox:SetText("")
            searchBox:ClearFocus()
            state.profession, state.member, state.selected, state.back, state.offset = nil, nil, nil, nil, 0
            UI.refresh()
            return
        end
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
    recipeControls = { levelLabel, minLevelBox, dash, maxLevelBox, skillLabel, minSkillBox, dash2, maxSkillBox, unknownCheck }
end

-- The Filter button and its panel: armor types, slots and binding to tick (any of those ticked in a
-- group; every group that has some), and only what your guild can craft.
local function updateFilterButton()
    local picked = 0
    for _, group in ipairs({ state.slots, state.armor, state.binding, state.guild }) do
        for _ in pairs(group) do picked = picked + 1 end
    end
    filterButton:SetText(picked > 0 and ("Filter (%d)"):format(picked) or "Filter")
end

--- Unticks every armor type, slot and binding, and Only guild. "Show unknown recipes" is a saved
--- preference: it stays.
function UI.clearFilter()
    state.slots, state.armor, state.binding, state.guild = {}, {}, {}, {}
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
    recipeControls[#recipeControls + 1] = filterButton

    local slotColumns, slotRows = 3, math.ceil(#Core.SLOTS / 3)
    -- The first column: the armor types, then Binding (its title and choices), then Who can craft
    -- (while you're in a guild): the panel is as tall as the longer of it and the slots.
    local bindingRow = #Core.ARMOR_TYPES
    local guildRow = bindingRow + 1 + #Core.BINDINGS
    local function rowsShown(inGuild) return math.max(slotRows, inGuild and guildRow + 2 or guildRow) end
    filterPopup = CreateFrame("Frame", nil, frame)
    filterPopup:SetFrameStrata("DIALOG")
    filterPopup:SetSize(20 + (1 + slotColumns) * FILTER_COLUMN, 30 + rowsShown(false) * FILTER_ROW + 88)
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

    -- Under the armor types: Binding, only the recipes whose item binds when picked up (to whoever
    -- makes it, as the game's data says).
    local bindingTitle = fontString(filterPopup, "GameFontNormal")
    bindingTitle:SetPoint("TOPLEFT", filterPopup, "TOPLEFT", 12, -30 - bindingRow * FILTER_ROW - 4)
    bindingTitle:SetText("Binding")
    for i, choice in ipairs(Core.BINDINGS) do
        local check = filterCheck("binding", choice.name, 0, bindingRow + i)
        check:SetScript("OnEnter", function(self)
            Game.showTextTooltip(self, "Binds when picked up", { "Recipes whose item binds to whoever makes it." })
        end)
        check:SetScript("OnLeave", Game.hideTooltip)
    end

    -- Under those, while you're in a guild: Only guild, the recipes someone in it can craft
    -- (GuildAssistant Professions knows who: your characters there and the guildmates it heard from).
    local guildTitle = fontString(filterPopup, "GameFontNormal")
    guildTitle:SetPoint("TOPLEFT", filterPopup, "TOPLEFT", 12, -30 - guildRow * FILTER_ROW - 4)
    guildTitle:SetText("Who can craft")
    local guildCheck = filterCheck("guild", GUILD_CHOICE, 0, guildRow + 1)
    guildCheck:SetScript("OnEnter", function(self)
        Game.showTextTooltip(self, GUILD_CHOICE, { ("Recipes someone in %s can craft."):format(Game.guildName() or "your guild"),
            "Your characters there, and guildmates who use GuildAssistant Professions." })
    end)
    guildCheck:SetScript("OnLeave", Game.hideTooltip)

    -- Its own section, under a line: "Show unknown recipes", those no source knows (unreleased,
    -- removed, or not found yet), hidden otherwise. A saved preference (showUnknown): it stays ticked
    -- across sessions, and Clear and Reset leave it. Only there when a complete source is (the seed).
    local section = CreateFrame("Frame", nil, filterPopup)
    local function placeSection(rows)
        section:ClearAllPoints()
        section:SetPoint("TOPLEFT", filterPopup, "TOPLEFT", 0, -30 - rows * FILTER_ROW - 4)
        section:SetPoint("RIGHT", filterPopup, "RIGHT", 0, 0)
    end
    placeSection(rowsShown(false))
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
    filterPopup.guildTitle, filterPopup.guildCheck, filterPopup.bindingTitle = guildTitle, guildCheck, bindingTitle
    filterPopup:SetScript("OnShow", function(self)
        self.unknownSection:SetShown(Game.hidesUnvouched())
        local inGuild = Game.guildName() ~= nil
        self.guildTitle:SetShown(inGuild)
        self.guildCheck:SetShown(inGuild)
        -- Who can craft takes two more rows, under Binding.
        local rows = rowsShown(inGuild)
        placeSection(rows)
        self:SetHeight(30 + rows * FILTER_ROW + 88)
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
            if state.tab == "attunements" then
                state.raid, state.offset = self.raid, 0
                return UI.refresh()
            end
            if state.tab == "guild" and state.member then
                -- Back to the guildmates (their search), of the profession picked.
                local back = state.back or {}
                state.member, state.selected, state.back = nil, nil, nil
                searchBox:SetText(back.search or "")
            end
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

    -- Column titles, just above the list, which sort it: a click sorts the list by that column (the
    -- others left to break its ties), a click on the one it's sorted by turns it around. `spec` is
    -- the column of `list` (Core.RECIPE_LIST, Core.MEMBER_LIST), what its tooltip says it is
    -- (`hint`), how wide the title's button is, and where it sits: `right` ends it that far from
    -- the list's `from` corner (the chevron at its right, the title before it), `left` starts it
    -- there (the title first, the chevron after it). The chevron sits in the same place whether it
    -- shows or not, so nothing moves.
    local columnName = fontString(frame, "GameFontNormalSmall")
    columnName:SetPoint("BOTTOMLEFT", list, "TOPLEFT", 30, 3)
    columnName:SetText("Recipe")
    local function sortHeader(spec)
        local button = CreateFrame("Button", nil, frame)
        button:SetSize(spec.width or 56, 16)
        button:SetHighlightTexture(HIGHLIGHT, "ADD")
        button.column, button.list, button.hint = spec.column, spec.list or Core.RECIPE_LIST, spec.hint
        -- The Attunements tab's titles sort the raids known right now (headerList), not this set,
        -- which is only here for the title's own words.
        button.attunements = spec.attunements
        button.chevron = button:CreateTexture(nil, "ARTWORK")
        button.chevron:SetSize(CHEVRON_SIZE, CHEVRON_SIZE)
        button.chevron:SetTexture(SORT_ARROW)
        button.chevron:Hide()
        button.title = fontString(button, "GameFontNormalSmall", spec.left and "LEFT" or "RIGHT")
        button.title:SetText(button.list.columns[spec.column].title)
        if spec.left then
            button:SetPoint("BOTTOMLEFT", list, spec.from or "TOPLEFT", spec.left, 1)
            button.title:SetPoint("LEFT", button, "LEFT", 0, -1)
            button.chevron:SetPoint("LEFT", button.title, "RIGHT", 1, 1)
        else
            button:SetPoint("BOTTOMRIGHT", list, spec.from or "TOPRIGHT", spec.right, 1)
            button.chevron:SetPoint("RIGHT", button, "RIGHT", 0, 1)
            button.title:SetPoint("RIGHT", button.chevron, "LEFT", -1, -1)
        end
        button:SetScript("OnClick", function(self)
            if self.attunements then
                state.attuneOrder = Core.toggleOrder(state.attuneListOrder, self.column, state.attuneList)
            elseif self.list == Core.MEMBER_LIST then
                state.memberOrder = Core.toggleOrder(state.memberListOrder, self.column, Core.MEMBER_LIST)
            else
                state.order = Core.toggleOrder(state.listOrder, self.column)
            end
            state.offset = 0
            UI.refresh()
            showSortTooltip(self)
        end)
        button:SetScript("OnEnter", showSortTooltip)
        button:SetScript("OnLeave", Game.hideTooltip)
        return button
    end
    columnLevel = sortHeader({ column = "level", right = -10, hint = "The level the item it makes requires." })
    columnSkill = sortHeader({ column = "skill", right = -58,
        hint = "The profession skill it takes to learn the recipe." })
    sortHeaders = { columnSkill, columnLevel }
    recipeColumns = { columnName, columnLevel, columnSkill }

    -- The Guild tab's, which sort the guildmates: a guildmate's name, the profession's skill, the
    -- profession and specialization.
    local memberName = sortHeader({ column = "name", list = Core.MEMBER_LIST, left = 10, width = 42,
        hint = "The guildmate's name, your own characters in the guild among them." })
    local memberSkill = sortHeader({ column = "skill", list = Core.MEMBER_LIST, from = "TOPLEFT",
        right = MEMBER_SKILL_RIGHT + 2, hint = "Their skill in the profession." })
    local memberProfession = sortHeader({ column = "profession", list = Core.MEMBER_LIST,
        left = MEMBER_PROFESSION_LEFT + 2, width = 72,
        hint = "The profession, with the specialization they have in it." })
    memberHeaders = { memberName, memberSkill, memberProfession }
    for _, header in ipairs(memberHeaders) do header:Hide() end

    -- The Attunements tab's Name title, above the guildmates and in the same place as the Guild
    -- tab's. Its list is only here for the word "Name": the raids it sorts beside are read from the
    -- state as they come and go (headerList).
    attuneName = sortHeader({ column = "name", list = Core.attunementList(nil), attunements = true,
        left = 10, width = 42,
        hint = "The guildmate's name, your own characters in the guild among them." })
    attuneName:Hide()

    memberRows = {}
    for i = 1, ROWS do
        local row = CreateFrame("Button", nil, list)
        row:SetSize(LIST_WIDTH - 18, ROW_HEIGHT)
        row:SetPoint("TOPLEFT", list, "TOPLEFT", 2, -4 - (i - 1) * (ROW_HEIGHT + 1))
        highlightTextures(row)
        row.name = fontString(row, "GameFontHighlight")
        row.name:SetPoint("LEFT", row, "LEFT", 6, 0)
        row.name:SetWidth(MEMBER_SKILL_RIGHT - 36)
        row.name:SetWordWrap(false)
        row.skill = fontString(row, "GameFontHighlightSmall", "RIGHT")
        row.skill:SetPoint("RIGHT", row, "LEFT", MEMBER_SKILL_RIGHT, 0)
        row.skill:SetWidth(28)
        row.profession = fontString(row, "GameFontHighlightSmall")
        row.profession:SetPoint("LEFT", row, "LEFT", MEMBER_PROFESSION_LEFT, 0)
        row.profession:SetPoint("RIGHT", row, "RIGHT", -4, 0)
        row.profession:SetWordWrap(false)
        row:SetScript("OnClick", function(self)
            if self.member then openMember(self.member) end
        end)
        row:SetScript("OnEnter", function(self)
            local member = self.member
            if not member then return end
            Game.showTextTooltip(self, member.name, { Core.professionLine(member), "Click to see what they can make" })
        end)
        row:SetScript("OnLeave", Game.hideTooltip)
        row:Hide()
        memberRows[i] = row
    end

    -- The Attunements tab's column titles, one per raid shown: the raid's icon over its column
    -- (its short name where the data has none), the full name and what the marks mean on hover.
    -- placeAttuneColumns puts them above the marks they title, however many raids there are. The
    -- icon is the column's title, so clicking it sorts the guildmates by who is attuned to that
    -- raid, with the chevron at the column's right-hand edge saying which way -- the icon stays
    -- over the middle of its marks whether the chevron shows or not, so nothing moves.
    attuneColumns = {}
    for i = 1, MAX_ATTUNE_COLUMNS do
        local header = CreateFrame("Button", nil, frame)
        header:SetSize(ATTUNE_COLUMN_WIDTH, ATTUNE_ICON)
        header:SetHighlightTexture(HIGHLIGHT, "ADD")
        header.title = fontString(header, "GameFontNormalSmall", "CENTER")
        header.title:SetAllPoints(header)
        header.title:SetWordWrap(false)
        header.icon = header:CreateTexture(nil, "ARTWORK")
        header.icon:SetSize(ATTUNE_ICON, ATTUNE_ICON)
        header.icon:SetPoint("CENTER", header, "CENTER", 0, 0)
        header.icon:Hide()
        header.chevron = header:CreateTexture(nil, "OVERLAY")
        header.chevron:SetSize(CHEVRON_SIZE, CHEVRON_SIZE)
        header.chevron:SetTexture(SORT_ARROW)
        header.chevron:SetPoint("RIGHT", header, "RIGHT", 0, 0)
        header.chevron:Hide()
        -- The raids it sorts are those known right now, so its order comes from the state.
        header.attunements = true
        header:EnableMouse(true)
        header:SetScript("OnClick", function(self)
            if not self.raid then return end
            state.attuneOrder = Core.toggleOrder(state.attuneListOrder, self.column, state.attuneList)
            state.offset = 0
            UI.refresh()
            showRaidTooltip(self)
        end)
        header:SetScript("OnEnter", showRaidTooltip)
        -- The column's own tooltip answers "which raid is that icon?" above the list; the icon
        -- itself is inside the header, so hovering it is hovering the header.
        header:SetScript("OnLeave", Game.hideTooltip)
        header:Hide()
        attuneColumns[i] = header
    end
    attuneHeaders = { attuneName }
    for _, header in ipairs(attuneColumns) do attuneHeaders[#attuneHeaders + 1] = header end

    -- The Attunements tab's rows: the guildmate, then their mark for each raid shown.
    attuneRows = {}
    for i = 1, ROWS do
        local row = CreateFrame("Button", nil, list)
        row:SetSize(LIST_WIDTH - 18, ROW_HEIGHT)
        row:SetPoint("TOPLEFT", list, "TOPLEFT", 2, -4 - (i - 1) * (ROW_HEIGHT + 1))
        highlightTextures(row)
        row.name = fontString(row, "GameFontHighlight")
        row.name:SetWordWrap(false)
        -- The font as the game gave it, so a name of your own can be the same one in bold.
        row.name.font, row.name.size = row.name:GetFont()
        row.marks = {}
        for column = 1, MAX_ATTUNE_COLUMNS do
            local mark = fontString(row, "GameFontHighlight", "CENTER")
            mark:SetWidth(ATTUNE_COLUMN_WIDTH)
            mark:Hide()
            row.marks[column] = mark
        end
        row:SetScript("OnClick", function(self)
            if not self.member then return end
            state.attunedMember = self.member
            drawRows()
            drawDetails()
        end)
        row:SetScript("OnEnter", function(self)
            local member = self.member
            if not member then return end
            local lines = {}
            for _, entry in ipairs(Core.attunementRows(member, state.raids)) do
                lines[#lines + 1] = ("%s %s"):format(attunementMark(entry.attuned), Core.attunementLabel(entry))
            end
            lines[#lines + 1] = "Click for their attunements"
            Game.showTextTooltip(self, member.name, lines)
        end)
        row:SetScript("OnLeave", Game.hideTooltip)
        row:Hide()
        attuneRows[i] = row
    end
    -- Somewhere to start: the draw puts them where the raids shown need them.
    placeAttuneColumns(MAX_ATTUNE_COLUMNS)

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
    d.hint:SetText(RECIPE_HINT)
    -- The Guild tab's guildmate, before one of their recipes is picked.
    d.summary = fontString(d, "GameFontHighlight")
    d.summary:SetPoint("TOPLEFT", d, "TOPLEFT", 10, -10)
    d.summary:SetWidth(width)
    d.summary:SetSpacing(3)
    d.summary:Hide()

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

-- The tabs under the window, as the game's own windows have them (its tab template; a plain button
-- where the client lacks it), shown only with GuildAssistant Professions.
local function buildTabs()
    tabs = {}
    for i, text in ipairs({ "Recipes", "Guild", "Attunements" }) do
        local name = "GuildAssistantDatabaseFrameTab" .. i
        local ok, tab = pcall(CreateFrame, "Button", name, frame, "PanelTabButtonTemplate")
        -- The template's textures: by key on newer clients, by name on older ones.
        if ok and tab and (rawget(tab, "Left") or rawget(_G, name .. "Left")) then
            tab.panel = true
        else
            tab = CreateFrame("Button", name .. "Button", frame, "UIPanelButtonTemplate")
            tab:SetSize(90, 22)
        end
        tab:SetText(text)
        if tab.panel and PanelTemplates_TabResize then PanelTemplates_TabResize(tab, 0) end
        if i == 1 then
            tab:SetPoint("TOPLEFT", frame, "BOTTOMLEFT", 10, 2)
        else
            -- Older clients' tabs overlap by their transparent edges; newer ones sit side by side.
            tab:SetPoint("LEFT", tabs[i - 1], "RIGHT", (tab.panel and not rawget(tab, "LeftActive")) and -15 or 4, 0)
        end
        local key = TAB_KEYS[i]
        tab:SetScript("OnClick", function()
            switchTab(key)
            UI.refresh()
        end)
        tab:Hide()
        tabs[i] = tab
    end

    -- Above the Guild tab's list, where Not known yet is in Recipes: Back (from a guildmate's
    -- recipes) and whose they are, or your guild's name.
    backButton = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
    backButton:SetSize(64, 20)
    backButton:SetPoint("TOPLEFT", frame, "TOPLEFT", 16, -60)
    backButton:SetText("Back")
    backButton:SetScript("OnClick", closeMember)
    backButton:Hide()
    crumb = fontString(frame, "GameFontHighlight")
    crumb:SetWidth(WIDTH - 140)
    crumb:SetWordWrap(false)
    crumb:Hide()
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
    -- An item shift-clicked while the window is open (and the chat box isn't): its name is searched,
    -- and a stack's split box doesn't open.
    Game.onItemLinked(searchBox, function(name)
        if not frame:IsShown() then return end
        Game.closeStackSplit()
        switchTab("recipes")
        searchBox:SetText(name)
        searchBox:ClearFocus()
        state.offset = 0
        UI.refresh()
    end)
    buildSidebar()
    buildList()
    buildDetails()
    buildTabs()

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

--- Opens the window (built the first time), with `search` typed in when given ("" clears it).
function UI.show(search)
    if not frame then build() end
    if search then
        switchTab("recipes")
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
        tabs = tabs, memberRows = memberRows, backButton = backButton, crumb = crumb,
        attuneRows = attuneRows, attuneColumns = attuneColumns, attuneName = attuneName,
        columnSkill = columnSkill, columnLevel = columnLevel, memberHeaders = memberHeaders,
        state = state,
    }
end
