-- GuildAssistant Database: everything that doesn't touch the game. Reads the recipe data (Data.lua,
-- built from Wowhead by `npm run database`), searches it, says how a recipe is learned, and who
-- can craft it from what GuildAssistant Professions saved. Kept apart from the game API so it can
-- be tested outside WoW (addons/dev/GuildAssistantDatabase).

local _, ns = ...
local Core = {}
ns.Core = Core

-- Reading the data ---------------------------------------------------------------------------------
-- Data.lua keeps each profession as text, one line per recipe and per item, fields separated by
-- tabs (scripts/database/lua.mjs writes it; keep the two in step). A profession is only turned into
-- tables the first time it is looked at (Core.load), so professions nobody opens cost nothing but
-- their text.

--- `text` cut at each `sep` (plain), empty fields kept: ("a\t\tb", "\t") -> { "a", "", "b" }.
function Core.split(text, sep)
    local out, from = {}, 1
    while true do
        local at = text:find(sep, from, true)
        if not at then
            out[#out + 1] = text:sub(from)
            return out
        end
        out[#out + 1] = text:sub(from, at - 1)
        from = at + 1
    end
end

local SOURCE_KINDS = { D = "drop", V = "vendor", Q = "quest", O = "object" }

local function number(text) return tonumber(text) or 0 end
local function text(value) return value ~= nil and value ~= "" and value or nil end

local function decodeItem(line)
    local f = Core.split(line, "\t")
    local item = {
        id = number(f[1]), name = f[2] or "", quality = tonumber(f[3]) or 1, level = number(f[4]),
        slot = number(f[5]), icon = text(f[6]), summary = f[7] or "", skill = number(f[8]), sources = {},
    }
    for source in (f[9] or ""):gmatch("[^;]+") do
        local kind, zone, name = source:match("^(%a)(%d+)=(.*)$")
        if kind and SOURCE_KINDS[kind] then
            item.sources[#item.sources + 1] = { kind = SOURCE_KINDS[kind], zone = tonumber(zone), name = name }
        end
    end
    return item
end

local function unknownItem(id)
    return { id = id, name = "Item " .. id, quality = 1, level = 0, slot = 0, summary = "", skill = 0, sources = {} }
end

--- The profession's recipes and items as tables, decoded from its text the first time (then kept).
--- `describe(itemId)`, when given, says what the game knows of an item made, without asking the
--- server: words for its search text (its type, "Armor Plate", "Weapon One-Handed Maces"), and its
--- class and subclass ids (what the armor type filter reads: Core.ARMOR_TYPES).
--- Returns { name, skill, recipes = { recipe… }, items = { [id] = item } }; a recipe is
--- { id, name, profession, skill, colors = { yellow, green, grey }, creates (item or nil),
--- makes = { min, max }, reagents = { { item, count } }, sources = { code… }, trainingCost,
--- recipeItems = { item… }, level (of the item it makes, 0 when none), search (lowercase text) }.
function Core.load(entry, describe)
    if entry.loaded then return entry.loaded end
    local items = {}
    for line in (entry.items or ""):gmatch("[^\n]+") do
        local item = decodeItem(line)
        items[item.id] = item
    end
    local function item(id)
        id = tonumber(id)
        items[id] = items[id] or unknownItem(id)
        return items[id]
    end
    local recipes = {}
    for line in (entry.recipes or ""):gmatch("[^\n]+") do
        local f = Core.split(line, "\t")
        local yellow, green, grey = (f[4] or ""):match("^(%d+),(%d+),(%d+)$")
        local recipe = {
            id = number(f[1]), name = f[2] or "", profession = entry.name, skill = number(f[3]),
            colors = { number(yellow), number(green), number(grey) }, reagents = {}, sources = {},
            trainingCost = number(f[8]), recipeItems = {}, level = 0,
        }
        local created, min, max = (f[5] or ""):match("^(%d+),(%d+),(%d+)$")
        if created then
            recipe.creates = item(created)
            recipe.makes = { tonumber(min), tonumber(max) }
            recipe.level = recipe.creates.level
        end
        for id, count in (f[6] or ""):gmatch("(%d+):(%d+)") do
            recipe.reagents[#recipe.reagents + 1] = { item = item(id), count = tonumber(count) }
        end
        for code in (f[7] or ""):gmatch("%d+") do recipe.sources[#recipe.sources + 1] = tonumber(code) end
        for id in (f[9] or ""):gmatch("%d+") do recipe.recipeItems[#recipe.recipeItems + 1] = item(id) end

        local words = { recipe.name, entry.name }
        if recipe.creates then
            words[#words + 1] = recipe.creates.name
            words[#words + 1] = recipe.creates.summary
            local made = recipe.creates
            if describe and not made.described then
                made.described = true
                made.words, made.classID, made.subclassID = describe(made.id)
            end
            words[#words + 1] = made.words
        end
        for _, reagent in ipairs(recipe.reagents) do words[#words + 1] = reagent.item.name end
        recipe.search = table.concat(words, " "):lower()
        recipe.nameSearch = (recipe.name .. " " .. (recipe.creates and recipe.creates.name or "")):lower()
        recipes[#recipes + 1] = recipe
    end
    entry.loaded = { name = entry.name, skill = entry.skill, recipes = recipes, items = items }
    return entry.loaded
end

-- Searching ----------------------------------------------------------------------------------------

--- The words of a search, lowercase: "  Plate  STAMINA " -> { "plate", "stamina" }.
function Core.terms(search)
    local terms = {}
    for term in (search or ""):lower():gmatch("%S+") do terms[#terms + 1] = term end
    return terms
end

local function hasAll(haystack, terms)
    for _, term in ipairs(terms) do
        if not haystack:find(term, 1, true) then return false end
    end
    return true
end

-- The Filter button's choices. Slots are the game's inventory types (the data's `slot`, from
-- Wowhead); armor types the game's armor subclasses (Core.load's `describe`).
Core.SLOTS = {
    { name = "Head", slots = { 1 } }, { name = "Neck", slots = { 2 } }, { name = "Shoulder", slots = { 3 } },
    { name = "Back", slots = { 16 } }, { name = "Chest", slots = { 5, 20 } }, { name = "Wrist", slots = { 9 } },
    { name = "Hands", slots = { 10 } }, { name = "Waist", slots = { 6 } }, { name = "Legs", slots = { 7 } },
    { name = "Feet", slots = { 8 } }, { name = "Finger", slots = { 11 } }, { name = "Trinket", slots = { 12 } },
    { name = "One-Hand", slots = { 13, 21 } }, { name = "Two-Hand", slots = { 17 } },
    { name = "Off Hand", slots = { 22, 23 } }, { name = "Shield", slots = { 14 } },
    { name = "Ranged", slots = { 15, 25, 26 } }, { name = "Bag", slots = { 18 } },
}
Core.ARMOR_CLASS = 4
Core.ARMOR_TYPES = {
    { name = "Cloth", subclass = 1 }, { name = "Leather", subclass = 2 },
    { name = "Mail", subclass = 3 }, { name = "Plate", subclass = 4 },
}

--- The query's slot and armor type sets from the names picked: { slots = { [inventory type] = true }
--- or nil, armor = { [subclass] = true } or nil } (nil: no filter of that kind).
function Core.filterSets(slotNames, armorNames)
    local slots, armor
    for _, choice in ipairs(Core.SLOTS) do
        if slotNames[choice.name] then
            slots = slots or {}
            for _, slot in ipairs(choice.slots) do slots[slot] = true end
        end
    end
    for _, choice in ipairs(Core.ARMOR_TYPES) do
        if armorNames[choice.name] then
            armor = armor or {}
            armor[choice.subclass] = true
        end
    end
    return slots, armor
end

--- Whether `recipe` matches `query`: every term somewhere in its text (name, the item it makes and
--- its stats and slot, its reagents, the profession), the level the item needs within
--- minLevel..maxLevel (an item with none counts as level 1, a recipe that makes no item too), its
--- skill within minSkill..maxSkill (any of them nil: no limit), the item's slot in `query.slots` and
--- its armor type in `query.armor` (sets; nil: any), and, when `query.include` is given, that it
--- says yes.
function Core.matches(recipe, query)
    local level = math.max(recipe.level or 0, 1)
    if query.minLevel and level < query.minLevel then return false end
    if query.maxLevel and level > query.maxLevel then return false end
    if query.minSkill and recipe.skill < query.minSkill then return false end
    if query.maxSkill and recipe.skill > query.maxSkill then return false end
    local item = recipe.creates
    if query.slots and not (item and query.slots[item.slot]) then return false end
    if query.armor and not (item and item.classID == Core.ARMOR_CLASS and query.armor[item.subclassID]) then
        return false
    end
    if query.include and not query.include(recipe) then return false end
    return hasAll(recipe.search, query.terms or {})
end

--- Whether the query narrows anything down (words, limits, filters), as opposed to listing all.
--- `include` (not known yet) is a mode, not a query.
function Core.isQuery(query)
    return #(query.terms or {}) > 0 or query.minLevel ~= nil or query.maxLevel ~= nil
        or query.minSkill ~= nil or query.maxSkill ~= nil or query.slots ~= nil or query.armor ~= nil
end

--- How many of `recipes` each profession has: { [profession] = n }.
function Core.countByProfession(recipes)
    local counts = {}
    for _, recipe in ipairs(recipes) do counts[recipe.profession] = (counts[recipe.profession] or 0) + 1 end
    return counts
end

--- The recipes of `professions` (loaded ones) that match `query`, best first: those whose own
--- name (or the item's) has every term, then the others; each by skill, then name.
function Core.search(professions, query)
    local results = {}
    local terms = query.terms or {}
    for _, profession in ipairs(professions) do
        for _, recipe in ipairs(profession.recipes) do
            if Core.matches(recipe, query) then
                results[#results + 1] = { recipe = recipe, byName = #terms > 0 and hasAll(recipe.nameSearch, terms) }
            end
        end
    end
    table.sort(results, function(a, b)
        if a.byName ~= b.byName then return a.byName end
        local ra, rb = a.recipe, b.recipe
        if ra.skill ~= rb.skill then return ra.skill < rb.skill end
        if ra.name ~= rb.name then return ra.name < rb.name end
        if ra.profession ~= rb.profession then return ra.profession < rb.profession end
        return ra.id < rb.id
    end)
    for i, result in ipairs(results) do results[i] = result.recipe end
    return results
end

--- A number typed in a box: nil when empty or not a number.
function Core.limit(typed)
    local n = tonumber((typed or ""):match("^%s*(%d+)%s*$"))
    return n
end

-- How a recipe is learned --------------------------------------------------------------------------

-- Wowhead's source codes, those a recipe can have.
local SOURCE_WORDS = {
    [1] = "Crafted", [2] = "World drop", [3] = "PvP", [4] = "Quest", [5] = "Vendor", [6] = "Trainer",
    [7] = "Discovery", [8] = "Redemption", [9] = "Talent", [10] = "Learned with the profession",
    [11] = "World event", [12] = "Achievement", [15] = "Disenchanting", [16] = "Fishing",
    [17] = "Gathering", [18] = "Milling", [19] = "Mining", [20] = "Prospecting",
    [21] = "Pickpocketing", [22] = "Salvage", [23] = "Skinning", [24] = "In-game store",
}
local KIND_WORDS = { drop = "Drop", vendor = "Vendor", quest = "Quest", object = "Found in" }
-- Which code a recipe item's source of each kind explains (so it isn't said again in general).
local KIND_CODES = { drop = 2, vendor = 5, quest = 4 }

--- Copper as the game writes money: 13500 -> "1g 35s".
function Core.money(copper)
    copper = math.floor(copper or 0)
    local parts = {}
    local gold, silver, rest = math.floor(copper / 10000), math.floor(copper / 100) % 100, copper % 100
    if gold > 0 then parts[#parts + 1] = gold .. "g" end
    if silver > 0 then parts[#parts + 1] = silver .. "s" end
    if rest > 0 or #parts == 0 then parts[#parts + 1] = rest .. "c" end
    return table.concat(parts, " ")
end

local MAX_SOURCES = 6

--- How the recipe is learned, as lines to show: "Trainer (1g 35s)", "Drop: Defias Renegade Mage
--- (Westfall)", "Vendor: Krinkle Goodsteel (Tanaris)", "Quest: Ornate Mithril Armor", "Fishing".
--- `zoneName(id)` names a zone (in game, the client does; nil leaves it out).
function Core.howToLearn(recipe, zoneName)
    local lines, seen, explained = {}, {}, {}
    local function add(line)
        if not seen[line] then
            seen[line] = true
            lines[#lines + 1] = line
        end
    end
    local hasCode = {}
    for _, code in ipairs(recipe.sources) do hasCode[code] = true end
    if hasCode[6] or recipe.trainingCost > 0 then
        add(recipe.trainingCost > 0 and ("Trainer (%s)"):format(Core.money(recipe.trainingCost)) or "Trainer")
    end
    explained[6] = true
    local more = 0
    for _, recipeItem in ipairs(recipe.recipeItems) do
        for _, source in ipairs(recipeItem.sources) do
            if KIND_CODES[source.kind] then explained[KIND_CODES[source.kind]] = true end
            local zone = source.zone and source.zone > 0 and zoneName and zoneName(source.zone)
            local line = ("%s: %s%s"):format(KIND_WORDS[source.kind], source.name, zone and (" (" .. zone .. ")") or "")
            if #lines < MAX_SOURCES then add(line) elseif not seen[line] then more = more + 1 end
        end
    end
    for _, code in ipairs(recipe.sources) do
        if not explained[code] and SOURCE_WORDS[code] then add(SOURCE_WORDS[code]) end
    end
    if more > 0 then add(("and %d more"):format(more)) end
    if #lines == 0 then add("Not listed on Wowhead") end
    return lines
end

-- Who can craft it (GuildAssistant Professions) ----------------------------------------------------
-- GuildAssistant Professions saves every character it knows (GuildAssistantProfessionsDB): the
-- account's own, guildmates' received from their addon, and profession links opened. Each
-- profession keeps its recipes as "spell:<id>" (the recipe's spell) or "item:<id>" (the item it
-- makes, when the game gave no spell).

--- How GuildAssistant Professions keys this player: the full name (WoW Forever gives the last name
--- as UnitName's second value) and the realm's rule set ("CAMWOW EU4 Realm 10 RP" -> "RP").
function Core.playerKey(first, last, realm)
    local name = (last and last ~= "") and (first .. " " .. last) or first
    return name .. "-" .. (realm and realm:match("Realm %d+ (.+)$") or realm or "")
end

--- Whether a character's profession (as GuildAssistant Professions saved it) has the recipe.
function Core.knows(profession, recipe)
    local recipes = profession and profession.recipes
    if not recipes then return false end
    return recipes["spell:" .. recipe.id] == true or (recipe.creates ~= nil and recipes["item:" .. recipe.creates.id] == true)
end

local SOURCE_ORDER = { own = 1, guild = 2, link = 3 }

--- The characters that know the recipe, from GuildAssistant Professions' saved data: { name,
--- realm, class, source ("own", "guild", "link"), rank, you (this character) }, this character
--- first, then the account's, the guild's and the links', each by name. `you` is Core.playerKey's.
function Core.crafters(db, recipe, you)
    local found = {}
    for key, character in pairs(db and db.characters or {}) do
        local profession = character.professions and character.professions[recipe.profession]
        if Core.knows(profession, recipe) then
            found[#found + 1] = {
                name = character.name, realm = character.realm, class = character.class,
                source = character.source or "own", rank = profession.rank, you = key == you,
            }
        end
    end
    table.sort(found, function(a, b)
        if a.you ~= b.you then return a.you end
        local oa, ob = SOURCE_ORDER[a.source] or 4, SOURCE_ORDER[b.source] or 4
        if oa ~= ob then return oa < ob end
        if a.name ~= b.name then return a.name < b.name end
        return (a.realm or "") < (b.realm or "")
    end)
    return found
end

--- "1,234".
function Core.thousands(n)
    local text = tostring(math.floor(n))
    while true do
        local replaced, count = text:gsub("^(%d+)(%d%d%d)", "%1,%2")
        text = replaced
        if count == 0 then return text end
    end
end

--- How many recipes the data has, all professions: "2,345 recipes".
function Core.describe(data)
    local count = 0
    for _, entry in ipairs(data and data.professions or {}) do count = count + (entry.count or 0) end
    return ("%s recipe%s"):format(Core.thousands(count), count == 1 and "" or "s")
end
