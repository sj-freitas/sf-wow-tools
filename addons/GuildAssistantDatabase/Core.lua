-- GuildAssistant Database: everything that doesn't touch the game. Reads the recipe data (Data.lua,
-- built from the game's own data tables by `npm run database`) and what sources companions add
-- (GuildAssistantDatabaseSources), searches it, says how a recipe is learned, and who can craft it
-- from what GuildAssistant Professions saved. Kept apart from the game API so it can be tested
-- outside WoW (addons/dev/GuildAssistantDatabase).

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

local SOURCE_KINDS = { D = "drop", V = "vendor", Q = "quest", O = "object", F = "fishing" }

local function number(text) return tonumber(text) or 0 end
local function text(value) return value ~= nil and value ~= "" and value or nil end

local function joined(...)
    local parts = {}
    for i = 1, select("#", ...) do
        local part = select(i, ...)
        if part and part ~= "" then parts[#parts + 1] = part end
    end
    return table.concat(parts, ", ")
end

-- An item: id, name, quality, level, slot, icon (file id), kind, stats, skill, class, subclass. One
-- the game's tables have no row for has no name: `missing`, named "Item <id>" until the game (or a
-- sources companion) says better.
local function decodeItem(line)
    local f = Core.split(line, "\t")
    local id = number(f[1])
    local item = {
        id = id, name = text(f[2]) or ("Item " .. id), missing = text(f[2]) == nil,
        quality = tonumber(f[3]) or 1, level = number(f[4]), slot = number(f[5]), icon = tonumber(f[6]),
        kind = f[7] or "", stats = f[8] or "", skill = number(f[9]), classID = tonumber(f[10]),
        subclassID = tonumber(f[11]), sources = {},
    }
    item.summary = joined(item.kind, item.stats)
    return item
end

local function unknownItem(id)
    return { id = id, name = "Item " .. id, missing = true, quality = 1, level = 0, slot = 0, kind = "", stats = "",
        summary = "", skill = 0, sources = {} }
end

-- Sources companions ---------------------------------------------------------------------------------
-- The game's data doesn't say how a recipe is obtained (its servers know, not its files), nor how
-- much of a stat an item has. Sources add that: the seed shipped with the addon (Seed.lua), what
-- GuildAssistant Professions saw in game (Core.professionsSources), and any companion addon. Each is
-- { name, fetched, complete, recipes = text, items = text } in GuildAssistantDatabaseSources;
-- `complete` says it lists every recipe it knows can be learned (the seed does), so with one
-- installed, recipes no source lists are hidden unless asked for. One that only adds (what players
-- saw) isn't complete: a recipe it lists shows, none is hidden because of it.
--   recipe lines: which recipe (its spell id; or "item:<id>", the recipe that makes that item; or
--     "name:<recipe name>"), source codes (SOURCE_WORDS below: 2 drop, 4 quest, 5 vendor, 6
--     trainer…), trainer's cost in copper, trainers ("<zone>=<name>;…"). Listing a recipe vouches
--     that it can be learned.
--   item lines: id, name, quality, stats with values, where it comes from ("D40=Mob;V:Tanaris=Vendor;
--     Q0=Quest"): a kind (D drop, V vendor, Q quest, O object, F fishing), the zone as the game's area
--     id or ":" and its name, and who or what (empty when not known).

local SOURCE_CODES_EMPTY = {}

--- One "where it comes from" entry: { kind, zone (area id) or zoneName, name }, nil when it isn't one.
function Core.parseSource(entry)
    local kind, where, name = entry:match("^(%a)([^=]*)=(.*)$")
    if not kind or not SOURCE_KINDS[kind] then return nil end
    local source = { kind = SOURCE_KINDS[kind], name = name }
    if where:match("^%d+$") then
        source.zone = tonumber(where)
    elseif where:sub(1, 1) == ":" and #where > 1 then
        source.zoneName = where:sub(2)
    elseif where ~= "" then
        return nil
    end
    return source
end

--- What the sources say, merged: { names = { "known as of November 2026" }, complete (one of them
--- is), recipes = { [spell id]
--- = recipe }, byItem = { [item id] = recipe }, byName = { [lowercase name] = recipe }, items = { [id]
--- = { name, quality, stats, sources } } }, a recipe { codes, cost, trainers = { { zoneName, name } } };
--- nil without any source. Read once per list.
function Core.sources(providers)
    if type(providers) ~= "table" or #providers == 0 then return nil end
    if providers.merged and providers.mergedCount == #providers then return providers.merged end
    local merged = { names = {}, recipes = {}, byItem = {}, byName = {}, items = {}, complete = false }
    local function recipeFor(key)
        local spell = tonumber(key)
        local map, id = merged.recipes, spell
        if not spell then
            local kind, value = key:match("^(%a+):(.+)$")
            if kind == "item" then map, id = merged.byItem, tonumber(value) end
            if kind == "name" then map, id = merged.byName, value:lower() end
        end
        if not id then return nil end
        map[id] = map[id] or { codes = {}, cost = 0, trainers = {} }
        return map[id]
    end
    for _, provider in ipairs(providers) do
        if type(provider) == "table" then
            merged.names[#merged.names + 1] = provider.fetched and ("%s (%s)"):format(provider.name or "?", provider.fetched)
                or (provider.name or "?")
            merged.complete = merged.complete or provider.complete == true
            for line in (type(provider.recipes) == "string" and provider.recipes or ""):gmatch("[^\n]+") do
                local f = Core.split(line, "\t")
                local recipe = recipeFor(f[1])
                if recipe then
                    for code in (f[2] or ""):gmatch("%d+") do recipe.codes[#recipe.codes + 1] = tonumber(code) end
                    recipe.cost = math.max(recipe.cost, number(f[3]))
                    for trainer in (f[4] or ""):gmatch("[^;]+") do
                        local zone, name = trainer:match("^([^=]*)=(.+)$")
                        if name then recipe.trainers[#recipe.trainers + 1] = { zoneName = text(zone), name = name } end
                    end
                end
            end
            for line in (type(provider.items) == "string" and provider.items or ""):gmatch("[^\n]+") do
                local f = Core.split(line, "\t")
                local id = tonumber(f[1])
                if id then
                    local item = merged.items[id] or { sources = {} }
                    merged.items[id] = item
                    item.name = item.name or text(f[2])
                    item.quality = item.quality or tonumber(f[3])
                    item.stats = item.stats or text(f[4])
                    for entry in (f[5] or ""):gmatch("[^;]+") do
                        local source = Core.parseSource(entry)
                        if source then item.sources[#item.sources + 1] = source end
                    end
                end
            end
        end
    end
    providers.merged, providers.mergedCount = merged, #providers
    return merged
end

-- What several sources say of one recipe, together (nil when none says anything).
local function combined(...)
    local found = {}
    for i = 1, select("#", ...) do
        local known = select(i, ...)
        if known then found[#found + 1] = known end
    end
    if #found <= 1 then return found[1] end
    local all = { codes = {}, cost = 0, trainers = {} }
    for _, known in ipairs(found) do
        for _, code in ipairs(known.codes) do all.codes[#all.codes + 1] = code end
        for _, trainer in ipairs(known.trainers) do all.trainers[#all.trainers + 1] = trainer end
        all.cost = math.max(all.cost, known.cost)
    end
    return all
end

--- What GuildAssistant Professions knows, as a source (nil when it knows nothing): every recipe a
--- character it knows has learned (so it can be learned: it shows even if no complete source lists
--- it), and what it saw in game (its saved `sources`): where recipe items are sold, dropped,
--- fished or given by quests, and which trainers teach which recipes and for how much.
function Core.professionsSources(db)
    if type(db) ~= "table" then return nil end
    local recipes, items, known = {}, {}, {}
    for _, character in pairs(type(db.characters) == "table" and db.characters or {}) do
        for _, profession in pairs(type(character.professions) == "table" and character.professions or {}) do
            for key in pairs(type(profession.recipes) == "table" and profession.recipes or {}) do
                local kind, id = tostring(key):match("^(%a+):(%d+)$")
                if kind == "spell" then known[id] = true elseif kind == "item" then known["item:" .. id] = true end
            end
        end
    end
    for key in pairs(known) do recipes[#recipes + 1] = key .. "\t\t" end
    local seen = type(db.sources) == "table" and db.sources or {}
    for key, trainer in pairs(type(seen.recipes) == "table" and seen.recipes or {}) do
        local where = {}
        for entry in pairs(type(trainer.trainers) == "table" and trainer.trainers or {}) do where[#where + 1] = entry end
        table.sort(where)
        recipes[#recipes + 1] = table.concat({ key, "6", tostring(trainer.cost or ""), table.concat(where, ";") }, "\t")
    end
    for id, entries in pairs(type(seen.items) == "table" and seen.items or {}) do
        local list = {}
        for entry in pairs(type(entries) == "table" and entries or {}) do list[#list + 1] = entry end
        table.sort(list)
        if #list > 0 then items[#items + 1] = table.concat({ tostring(id), "", "", "", table.concat(list, ";") }, "\t") end
    end
    if #recipes == 0 and #items == 0 then return nil end
    table.sort(recipes)
    table.sort(items)
    return { name = "seen by GuildAssistant Professions", recipes = table.concat(recipes, "\n"),
        items = table.concat(items, "\n") }
end

--- The profession's recipes and items as tables, decoded from its text the first time (then kept),
--- with what the sources companions (`providers`, GuildAssistantDatabaseSources) add.
--- Returns { name, skill, recipes = { recipe… }, items = { [id] = item }, vouchedCount }; a recipe
--- is { id, name, profession, skill, colors = { yellow, green, grey }, creates (item or nil),
--- makes = { min, max }, reagents = { { item, count } }, acquire (0 trainer or recipe item, 1 at a
--- skill, 2 with the profession), acquireSkill, recipeItems = { item… }, sources = { code… } and
--- trainingCost (from companions), vouched (a companion lists it; nil without companions), level (of
--- the item it makes, 0 when none), search (lowercase text) }.
function Core.load(entry, providers)
    if entry.loaded then return entry.loaded end
    local sources = Core.sources(providers)
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
    -- What the companions know of the items: names the game's tables lack, stats with values, and
    -- where recipe items come from.
    if sources then
        for id, known in pairs(items) do
            local extra = sources.items[id]
            if extra then
                if known.missing and extra.name then
                    known.name, known.missing = extra.name, false
                    known.quality = extra.quality or known.quality
                end
                if extra.stats then known.summary = joined(known.kind, extra.stats) end
                known.sources = extra.sources
            end
        end
    end
    local recipes, vouched = {}, 0
    for line in (entry.recipes or ""):gmatch("[^\n]+") do
        local f = Core.split(line, "\t")
        local yellow, green, grey = (f[4] or ""):match("^(%d+),(%d+),(%d+)$")
        local id = number(f[1])
        local recipe = {
            id = id, name = f[2] or "", profession = entry.name, skill = number(f[3]),
            colors = { number(yellow), number(green), number(grey) }, reagents = {}, recipeItems = {}, level = 0,
            acquire = number(f[7]), acquireSkill = number(f[8]), sources = SOURCE_CODES_EMPTY, trainingCost = 0,
        }
        local created, min, max = (f[5] or ""):match("^(%d+),(%d+),(%d+)$")
        if created then
            recipe.creates = item(created)
            recipe.makes = { tonumber(min), tonumber(max) }
            recipe.level = recipe.creates.level
        end
        for reagentId, count in (f[6] or ""):gmatch("(%d+):(%d+)") do
            recipe.reagents[#recipe.reagents + 1] = { item = item(reagentId), count = tonumber(count) }
        end
        for itemId in (f[9] or ""):gmatch("%d+") do recipe.recipeItems[#recipe.recipeItems + 1] = item(itemId) end
        if sources then
            -- By its spell, by the item it makes, by its name (what a trainer window shows): all of them.
            local known = combined(sources.recipes[id], recipe.creates and sources.byItem[recipe.creates.id],
                sources.byName[recipe.name:lower()])
            -- A source saying where its plans (pattern, formula…) come from vouches for it too: a drop
            -- found for a recipe nobody listed makes it known.
            local taught = false
            for _, recipeItem in ipairs(recipe.recipeItems) do
                if #recipeItem.sources > 0 then taught = true end
            end
            -- Unvouched (false) only when a complete source would have listed it.
            if known or taught then
                recipe.vouched = true
                if known then
                    recipe.sources, recipe.trainingCost, recipe.trainers = known.codes, known.cost, known.trainers
                end
                vouched = vouched + 1
            elseif sources.complete then
                recipe.vouched = false
            end
        end

        local words = { recipe.name, entry.name }
        if recipe.creates then
            words[#words + 1] = recipe.creates.name
            words[#words + 1] = recipe.creates.summary
        end
        for _, reagent in ipairs(recipe.reagents) do words[#words + 1] = reagent.item.name end
        recipe.search = table.concat(words, " "):lower()
        recipe.nameSearch = (recipe.name .. " " .. (recipe.creates and recipe.creates.name or "")):lower()
        recipes[#recipes + 1] = recipe
    end
    entry.loaded = { name = entry.name, skill = entry.skill, recipes = recipes, items = items,
        vouchedCount = sources and vouched or #recipes }
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
-- the game's data); armor types the game's armor subclasses (the item's class and subclass).
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
--- its armor type in `query.armor` (sets; nil: any), not unvouched when `query.vouchedOnly` (no
--- sources companion lists it), known by `query.known` when given (Core.guildRecipes: someone in
--- your guild can craft it), and, when `query.include` is given, that it says yes.
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
    if query.vouchedOnly and recipe.vouched == false then return false end
    if query.known and not Core.knows(query.known[recipe.profession], recipe) then return false end
    if query.include and not query.include(recipe) then return false end
    return hasAll(recipe.search, query.terms or {})
end

--- Whether the query narrows anything down (words, limits, filters), as opposed to listing all.
--- `include` (not known yet) is a mode, not a query.
function Core.isQuery(query)
    return #(query.terms or {}) > 0 or query.minLevel ~= nil or query.maxLevel ~= nil
        or query.minSkill ~= nil or query.maxSkill ~= nil or query.slots ~= nil or query.armor ~= nil
        or query.known ~= nil
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

-- The source codes a companion gives a recipe (the numbering WoW databases commonly use).
local SOURCE_WORDS = {
    [1] = "Crafted", [2] = "World drop", [3] = "PvP", [4] = "Quest", [5] = "Vendor", [6] = "Trainer",
    [7] = "Discovery", [8] = "Redemption", [9] = "Talent", [10] = "Learned with the profession",
    [11] = "World event", [12] = "Achievement", [15] = "Disenchanting", [16] = "Fishing",
    [17] = "Gathering", [18] = "Milling", [19] = "Mining", [20] = "Prospecting",
    [21] = "Pickpocketing", [22] = "Salvage", [23] = "Skinning", [24] = "In-game store",
}
local KIND_WORDS = { drop = "Drop", vendor = "Vendor", quest = "Quest", object = "Found in", fishing = "Fishing" }
-- Which code a recipe item's source of each kind explains (so it isn't said again in general).
local KIND_CODES = { drop = 2, vendor = 5, quest = 4, fishing = 16 }

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

--- How the recipe is learned, as lines to show. From the game's data: "Learned with the
--- profession", "Learned automatically at skill 125". From the sources companions: "Trainer
--- (1g 35s)", "Drop: Defias Renegade Mage (Westfall)", "Vendor: Krinkle Goodsteel (Tanaris)",
--- "Quest: Ornate Mithril Armor", "Fishing". When nothing says: what can be told (its recipe item,
--- shown below it; a trainer or a quest; not known to any companion). `zoneName(id)` names a zone
--- (in game, the client does; nil leaves it out).
function Core.howToLearn(recipe, zoneName)
    local lines, seen, explained = {}, {}, {}
    local function add(line)
        if not seen[line] then
            seen[line] = true
            lines[#lines + 1] = line
        end
    end
    if recipe.vouched == false then add("No known source: unreleased, removed, or not recorded yet") end
    -- The game's own word wins: learned with the profession, or at a skill.
    if recipe.acquire == 2 or (recipe.acquire == 1 and recipe.acquireSkill <= 1) then
        add("Learned with the profession")
        return lines
    elseif recipe.acquire == 1 then
        add(("Learned automatically at skill %d"):format(recipe.acquireSkill))
        return lines
    end
    local hasCode = {}
    for _, code in ipairs(recipe.sources) do hasCode[code] = true end
    local trainers = recipe.trainers or {}
    if hasCode[6] or recipe.trainingCost > 0 or #trainers > 0 then
        local line = recipe.trainingCost > 0 and ("Trainer (%s)"):format(Core.money(recipe.trainingCost)) or "Trainer"
        -- The trainers seen teaching it: "Trainer (50c): Grimand Elmore (Stormwind City)".
        local names = {}
        for i, trainer in ipairs(trainers) do
            if i > 3 then break end
            names[#names + 1] = trainer.name .. (trainer.zoneName and (" (" .. trainer.zoneName .. ")") or "")
        end
        add(#names > 0 and (line .. ": " .. table.concat(names, ", ")) or line)
    end
    explained[6] = true
    local more = 0
    for _, recipeItem in ipairs(recipe.recipeItems) do
        for _, source in ipairs(recipeItem.sources) do
            if KIND_CODES[source.kind] then explained[KIND_CODES[source.kind]] = true end
            local zone = source.zoneName or (source.zone and source.zone > 0 and zoneName and zoneName(source.zone))
            local where = zone and (" (" .. zone .. ")") or ""
            local line = source.name ~= "" and ("%s: %s%s"):format(KIND_WORDS[source.kind], source.name, where)
                or (KIND_WORDS[source.kind] .. where)
            if #lines < MAX_SOURCES then add(line) elseif not seen[line] then more = more + 1 end
        end
    end
    for _, code in ipairs(recipe.sources) do
        if not explained[code] and SOURCE_WORDS[code] then add(SOURCE_WORDS[code]) end
    end
    if more > 0 then add(("and %d more"):format(more)) end
    if #lines == 0 or (#lines == 1 and recipe.vouched == false) then
        if #recipe.recipeItems > 0 then
            add(#recipe.recipeItems == 1 and "From the item below" or "From the items below")
        elseif recipe.vouched == nil then
            add("A trainer or a quest: the game's files don't say which")
        end
    end
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

--- What the characters in `guild` know, from GuildAssistant Professions' saved data: this account's
--- there and the guildmates' it heard from (not those seen through a link: who knows their guild).
--- By profession, as Core.knows reads one: { [profession] = { recipes = { ["spell:<id>"] = true } } }.
--- Empty without the data.
function Core.guildRecipes(db, guild)
    local known = {}
    for _, character in pairs(db and db.characters or {}) do
        if character.guild == guild and (character.source == "own" or character.source == "guild") then
            for name, profession in pairs(character.professions or {}) do
                known[name] = known[name] or { recipes = {} }
                for key, has in pairs(profession.recipes or {}) do
                    if has then known[name].recipes[key] = true end
                end
            end
        end
    end
    return known
end

--- How many times the recipe can be made from what you carry (`countOf(itemId)`), and the reagents
--- short of one: { { item, short } }. A recipe without reagents can always be made (once at a time).
function Core.craftable(recipe, countOf)
    if #recipe.reagents == 0 then return 1, {} end
    local times, missing = math.huge, {}
    for _, reagent in ipairs(recipe.reagents) do
        local have = countOf(reagent.item.id) or 0
        times = math.min(times, math.floor(have / reagent.count))
        if have < reagent.count then missing[#missing + 1] = { item = reagent.item, short = reagent.count - have } end
    end
    return times, missing
end

--- Who to whisper to reach a crafter: the name, with the realm (as the game writes it in a name,
--- no spaces or dashes) when it isn't `realm`, this character's as the game names it ("Realm 12
--- Grim" is "Grim", as GuildAssistant Professions saves it). Nil for this character.
function Core.whisperTarget(crafter, realm)
    if crafter.you then return nil end
    local own = realm and realm:match("Realm %d+ (.+)$") or realm
    if not crafter.realm or crafter.realm == "" or crafter.realm == own then return crafter.name end
    return crafter.name .. "-" .. (crafter.realm:gsub("[%s%-]", ""))
end

-- The minimap button ------------------------------------------------------------------------------

--- Where the minimap button sits from the minimap's centre: `angle` degrees counter-clockwise from
--- its right, `radius` away.
function Core.minimapOffset(angle, radius)
    local rad = math.rad(angle)
    return math.cos(rad) * radius, math.sin(rad) * radius
end

--- The angle (degrees, 0 to 360) of a point `dx`, `dy` from the minimap's centre.
function Core.angleTo(dx, dy)
    local atan2 = math.atan2 or math.atan -- the game's Lua 5.1 has atan2; 5.3's atan takes two
    return math.deg(atan2(dy, dx)) % 360
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
