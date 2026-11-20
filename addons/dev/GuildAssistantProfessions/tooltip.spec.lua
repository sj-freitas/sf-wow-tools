-- Tests of GuildAssistantProfessions' Tooltip.lua (what a recipe item's tooltip says about the
-- guild) against a fake game, outside WoW. Run with `npm test` in addons/ (or
-- lua dev/GuildAssistantProfessions/tooltip.spec.lua).

local passed, failed = 0, 0
local function it(name, fn)
    local ok, err = pcall(fn)
    if ok then
        passed = passed + 1
    else
        failed = failed + 1
        print("FAIL " .. name .. "\n     " .. tostring(err))
    end
end

local function eq(actual, expected, what)
    if actual ~= expected then
        error(("%s: expected %s, got %s"):format(what or "value", tostring(expected), tostring(actual)), 2)
    end
end

-- The game, just enough for Tooltip.lua: the texts it reads its patterns from, an item it can ask
-- about, and the spell names of the fixture's recipes.
local ns, Core, Tooltip

-- A recipe item: its class (9 for a recipe), the profession its kind says, and the spell the game
-- says it casts. `spell` nil for a client that gives none.
local item

local function loadAddon()
    _G.ITEM_MIN_SKILL, _G.ITEM_REQ_SKILL = "Requires %s (%d)", "Requires %s"
    _G.ITEM_BIND_ON_PICKUP, _G.ITEM_SOULBOUND = "Binds when picked up", "Soulbound"
    _G.GetRealmName = function() return "Test Realm" end
    _G.IsInGuild = function() return true end
    _G.GetGuildInfo = function(unit) return unit == "player" and "Dark Horizon" or nil end
    item = { class = 9, profession = "Blacksmithing", spell = { "Mithril Spurs", 9972 } }
    _G.GetItemInfoInstant = function(id)
        return id, "Recipe", item.profession, "", 0, item.class, 4
    end
    _G.GetItemSpell = function() return item.spell and item.spell[1], item.spell and item.spell[2] end
    -- The fixture's Blacksmithing recipes and specializations, as the game names their spells.
    local names = { [9972] = "Mithril Spurs", [10003] = "Dark Iron Pulverizer",
        [9787] = "Weaponsmith", [17039] = "Master Swordsmith" }
    _G.GetSpellInfo = function(id) return names[id] end
    ns = {}
    for _, file in ipairs({ "Core", "Recipes", "Tooltip" }) do
        local path = file == "Recipes" and "dev/GuildAssistantProfessions/Recipes.fixture.lua"
            or "GuildAssistantProfessions/" .. file .. ".lua"
        assert(loadfile(path))("GuildAssistantProfessions", ns)
    end
    Core, Tooltip = ns.Core, ns.Tooltip
    ns.safely = function(fn, ...) return assert(pcall(fn, ...)) end
    ns.db = Core.newDB()
    return ns.db
end

-- A tooltip showing those lines, read as the game's is (its own text, line by line).
local nextName = 0
local function showing(lines)
    nextName = nextName + 1
    local name = "FakeTooltip" .. nextName
    local frame = { added = {}, shown = 0 }
    function frame:GetName() return name end
    function frame:NumLines() return #lines end
    function frame:GetItem() return lines[1], "|cffffffff|Hitem:11288:0:0:0|h[" .. lines[1] .. "]|h|r" end
    function frame:AddLine(text, r, g, b, wrap)
        self.added[#self.added + 1] = { text = text, r = r, g = g, b = b, wrap = wrap }
        lines[#lines + 1] = text
    end
    function frame:Show() self.shown = self.shown + 1 end
    for i = 1, 30 do
        _G[name .. "TextLeft" .. i] = { GetText = function() return lines[i] end }
    end
    return frame
end

local function plans(requires)
    local lines = { "Plans: Mithril Spurs" }
    for _, line in ipairs(requires or { "Requires Blacksmithing (250)" }) do lines[#lines + 1] = line end
    lines[#lines + 1] = "Use: Teaches you how to make Mithril Spurs."
    return showing(lines)
end

-- A character with Blacksmithing at `rank`, knowing `recipes`.
local function crafter(db, name, source, rank, recipes)
    local character = Core.character(db, name, "Test Realm", "WARRIOR", source)
    Core.setProfessions(character, { { name = "Blacksmithing", rank = rank, max = 300 } }, 100)
    for _, id in ipairs(recipes or {}) do
        Core.addRecipes(character, "Blacksmithing", rank, 300, { { kind = "spell", id = id } }, 100)
    end
end

local function guild(db)
    crafter(db, "Luna", "own", 300, { 9972 })
    crafter(db, "Dir", "guild", 265)
    crafter(db, "Ana", "guild", 100)
end

it("says who knows the plans and who could learn them, in green and light blue", function()
    local db = loadAddon()
    guild(db)
    local tooltip = plans()
    eq(Tooltip.show(tooltip), true)
    eq(#tooltip.added, 2)
    eq(tooltip.added[1].text, "Know this recipe: Luna")
    eq(tooltip.added[1].g, 1, "green")
    eq(tooltip.added[1].r, 0.1, "green")
    eq(tooltip.added[1].wrap, true, "wraps: a long guild makes a long line")
    -- Ana's 100 Blacksmithing isn't the 250 the plans ask for.
    eq(tooltip.added[2].text, "Can use this recipe: Dir")
    eq(tooltip.added[2].b, 1, "light blue")
    eq(tooltip.added[2].r, 0.4, "light blue")
    eq(tooltip.shown, 1, "the tooltip is told to make room")
    -- The game can set the same tooltip's item again: the lines don't come twice.
    eq(Tooltip.show(tooltip), false, "already said")
    eq(#tooltip.added, 2)
end)

it("says so when nobody it knows wants the recipe, and not twice", function()
    local db = loadAddon()
    crafter(db, "Ana", "guild", 100) -- Blacksmithing, but nowhere near the 250 the plans ask for
    local tooltip = plans()
    eq(Tooltip.show(tooltip), true)
    eq(#tooltip.added, 1)
    eq(tooltip.added[1].text, "Nobody in Dark Horizon can use this recipe.")
    eq(tooltip.added[1].r, 0.6, "grey")
    eq(Tooltip.show(tooltip), false, "already said")
    eq(#tooltip.added, 1)
    -- Out of a guild, or before the game says which: nothing is named.
    _G.IsInGuild = function() return false end
    local alone = plans()
    eq(Tooltip.show(alone), true)
    eq(alone.added[1].text, "Nobody you know can use this recipe.")
    -- Nothing at all when it can't tell which recipe the plans teach: "nobody" would be a guess.
    item.spell = nil
    eq(Tooltip.show(showing({ "Plans: Unheard Of", "Requires Blacksmithing (250)" })), false)
end)

it("says nothing about plans that bind when picked up", function()
    local db = loadAddon()
    guild(db)
    for _, line in ipairs({ "Binds when picked up", "Soulbound" }) do
        local tooltip = plans({ line, "Requires Blacksmithing (250)" })
        eq(Tooltip.show(tooltip), false, line)
        eq(#tooltip.added, 0, line)
    end
end)

it("says nothing when it is turned off, and again once it is on", function()
    local db = loadAddon()
    guild(db)
    eq(Tooltip.setEnabled(false), false)
    eq(Tooltip.enabled(), false)
    eq(Tooltip.show(plans()), false)
    eq(Tooltip.setEnabled(true), true)
    eq(Tooltip.show(plans()), true)
end)

it("finds the recipe by name when the client gives no spell for the item", function()
    local db = loadAddon()
    guild(db)
    -- No spell at all: the plans' own name says what they teach ("Plans: Mithril Spurs").
    item.spell = nil
    local tooltip = plans()
    eq(Tooltip.show(tooltip), true)
    eq(tooltip.added[1].text, "Know this recipe: Luna")
    -- A spell that isn't one of the profession's recipes (the item's "Learning"): by its name.
    item.spell = { "Mithril Spurs", 483 }
    local byName = plans()
    eq(Tooltip.show(byName), true)
    eq(byName.added[1].text, "Know this recipe: Luna")
end)

it("says nothing of a recipe it can't place, or of anything that isn't a recipe item", function()
    local db = loadAddon()
    guild(db)
    item.spell = nil
    local unheard = showing({ "Plans: Unheard Of", "Requires Blacksmithing (250)" })
    eq(Tooltip.show(unheard), false, "a recipe this addon's tables don't have")
    eq(#unheard.added, 0)
    item.spell = { "Mithril Spurs", 9972 }
    item.class = 4 -- armour, say
    eq(Tooltip.show(plans()), false, "not a recipe item")
    item.class = 9
    item.profession = "Tailoring" -- nobody's, and the fixture has no such recipes
    eq(Tooltip.show(showing({ "Pattern: Mithril Spurs" })), false, "another profession")
end)

it("only lists who has the specialization the plans require", function()
    local db = loadAddon()
    crafter(db, "Luna", "own", 300, { 9787 })
    crafter(db, "Dir", "guild", 300, { 17039 })
    crafter(db, "Ana", "guild", 300)
    local tooltip = plans({ "Requires Blacksmithing (250)", "Requires Weaponsmith" })
    eq(Tooltip.show(tooltip), true)
    eq(#tooltip.added, 1)
    eq(tooltip.added[1].text, "Can use this recipe: Luna")
end)

it("takes the profession from the item's own kind when the tooltip doesn't say", function()
    local db = loadAddon()
    guild(db)
    local tooltip = plans({})
    eq(Tooltip.show(tooltip), true)
    -- No skill is asked for, so Ana's 100 is enough.
    eq(tooltip.added[2].text, "Can use this recipe: Ana, Dir")
end)

it("hooks the tooltips a client without the modern callback has", function()
    local db = loadAddon()
    guild(db)
    local hooked
    _G.GameTooltip = { HookScript = function(_, script, handler) hooked = script == "OnTooltipSetItem" and handler end }
    _G.ItemRefTooltip = nil
    eq(Tooltip.start(), 1, "one way hooked")
    eq(Tooltip.start(), 0, "only once")
    assert(hooked, "hooked OnTooltipSetItem")
    local tooltip = plans()
    hooked(tooltip)
    eq(tooltip.added[1].text, "Know this recipe: Luna")
end)

it("reads the lines the modern callback brings instead of the tooltip's own", function()
    local db = loadAddon()
    guild(db)
    local tooltip = showing({})
    eq(Tooltip.show(tooltip, 11288, { lines = {
        { leftText = "Plans: Mithril Spurs" }, { leftText = "Requires Blacksmithing (250)" },
    } }), true)
    eq(tooltip.added[1].text, "Know this recipe: Luna")
end)

-- What /ga-prof tooltip <a shift-clicked recipe> says.
local function described(link, lines)
    local said = {}
    Tooltip.describe(link, function(text) said[#said + 1] = text end, lines)
    return table.concat(said, "\n")
end

local LINK = "|cffffffff|Hitem:11288:0:0:0|h[Plans: Mithril Spurs]|h|r"

it("says what it makes of a recipe, step by step", function()
    local db = loadAddon()
    guild(db)
    local text = described(LINK, { "Plans: Mithril Spurs", "Requires Blacksmithing (250)" })
    assert(text:find("Plans: Mithril Spurs (item 11288).", 1, true), text)
    assert(text:find("A recipe, Blacksmithing. Its tooltip: 2 lines, Blacksmithing (250).", 1, true), text)
    assert(text:find("Mithril Spurs (9972); one of its recipes.", 1, true), text)
    assert(text:find("The recipe it teaches: spell:9972.", 1, true), text)
    assert(text:find("3 character(s) have Blacksmithing, the highest at 300.", 1, true), text)
    assert(text:find("Know it: Luna", 1, true), text)
    assert(text:find("Could learn it: Dir", 1, true), text)
end)

it("says where it stopped: not a recipe, no recipe known, nothing to read", function()
    local db = loadAddon()
    guild(db)
    eq(described("have a look at this"):find("that isn't an item", 1, true), 1)
    item.class = 4
    assert(described(LINK, {}):find("not a recipe (9): no lines for it.", 1, true), "class")
    item.class, item.spell = 9, nil
    local text = described("|Hitem:11288|h[Plans: Unheard Of]|h", { "Plans: Unheard Of" })
    assert(text:find("no skill line", 1, true), text)
    assert(text:find("Which recipe it teaches: not known", 1, true), text)
end)

it("reads an item's tooltip with one of its own when the lines aren't to hand", function()
    local db = loadAddon()
    guild(db)
    local scanner
    _G.UIParent = {}
    _G.CreateFrame = function()
        scanner = showing({ "Plans: Mithril Spurs", "Requires Blacksmithing (250)" })
        function scanner:SetOwner() self.owned = true end
        function scanner:ClearLines() end
        function scanner:SetHyperlink(link) self.link = link end
        function scanner:Hide() self.hidden = true end
        return scanner
    end
    local text = described(LINK)
    eq(scanner.link, LINK, "asked the game about it")
    eq(scanner.hidden, true, "and put its tooltip away")
    assert(text:find("The recipe it teaches: spell:9972.", 1, true), text)
end)

print(("%d passed, %d failed"):format(passed, failed))
if failed > 0 then error(failed .. " failed") end
