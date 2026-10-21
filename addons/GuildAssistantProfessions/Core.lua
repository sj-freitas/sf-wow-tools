-- Guild Assistant Professions: everything that doesn't touch the game. Keeps what each character
-- knows (professions, skill, recipes): the account's own, and others' seen through a profession
-- link. Turns it into the JSON Guild Assistant imports. Kept apart from the game API so it can be tested outside WoW
-- (addons/dev/GuildAssistantProfessions).

local _, ns = ...
local Core = {}
ns.Core = Core

--- Saved data, account wide: { characters = { ["Name-Realm"] = character }, export = JSON,
--- updated = time }. `export` is what Guild Assistant reads from the saved variables file.
function Core.newDB()
    return { characters = {} }
end

--- The character's entry (created on first use): name, realm, class, its professions, `source`
--- ("own": one of the account's, "link": someone else's, seen through a profession link) and
--- `updated` (the last time anything new was recorded). Once seen as "own" it stays "own".
function Core.character(db, name, realm, class, source)
    local key = name .. "-" .. realm
    local character = db.characters[key]
    if not character then
        character = { name = name, realm = realm, professions = {} }
        db.characters[key] = character
    end
    character.class = class or character.class
    if character.source ~= "own" then character.source = source or "own" end
    return character
end

--- Keeps the character's professions as the game lists them: { { name, rank, max } }. One it no
--- longer has (unlearned, "dropped") goes, with its recipes. `now` (time()) marks the character
--- updated when anything changed; returns whether it did, and the names of the dropped ones.
function Core.setProfessions(character, skills, now)
    local known, changed, dropped = {}, false, {}
    for _, skill in ipairs(skills) do
        known[skill.name] = true
        local profession = character.professions[skill.name]
        if not profession then
            profession, changed = { recipes = {} }, true
            character.professions[skill.name] = profession
        end
        if profession.rank ~= skill.rank or profession.max ~= skill.max then changed = true end
        profession.rank, profession.max = skill.rank, skill.max
    end
    -- An empty list is the game not having them ready yet (at login), not every profession
    -- unlearned at once: nothing is dropped then.
    if #skills > 0 then
        for name in pairs(character.professions) do
            if not known[name] then
                character.professions[name], changed = nil, true
                dropped[#dropped + 1] = name
            end
        end
    end
    table.sort(dropped)
    if changed then character.updated = now end
    return changed, dropped
end

--- Adds the recipes seen in the profession's window. Recipes are only ever added: the window can
--- hide some (filters), and a recipe is only lost by unlearning the whole profession. Returns how
--- many were new; `now` (time()) marks the character updated when there were any.
function Core.addRecipes(character, professionName, rank, max, recipes, now)
    local profession = character.professions[professionName] or { recipes = {} }
    character.professions[professionName] = profession
    if rank then profession.rank, profession.max = rank, max end
    local added = 0
    for _, recipe in ipairs(recipes) do
        local key = recipe.kind .. ":" .. recipe.id
        if not profession.recipes[key] then
            profession.recipes[key] = true
            added = added + 1
        end
    end
    if added > 0 then character.updated = now end
    return added
end

--- Replaces the profession's recipes with `recipes`: for a window that lists every recipe whatever
--- its filters (the modern API), so wrong ones recorded before go too. Returns whether anything
--- changed; `now` (time()) marks the character updated when it did.
function Core.setRecipes(character, professionName, rank, max, recipes, now)
    local profession = character.professions[professionName] or { recipes = {} }
    character.professions[professionName] = profession
    if rank then profession.rank, profession.max = rank, max end
    local new, count = {}, 0
    for _, recipe in ipairs(recipes) do
        local key = recipe.kind .. ":" .. recipe.id
        if not new[key] then new[key], count = true, count + 1 end
    end
    local changed = false
    for key in pairs(profession.recipes) do
        if not new[key] then changed = true end
        count = count - (new[key] and 1 or 0)
    end
    changed = changed or count ~= 0
    profession.recipes = new
    if changed then character.updated = now end
    return changed
end

--- A recipe's id from the game's link: its spell ("enchant:20034", "spell:…"), else the item it
--- makes ("item:16224"). Nil when the link has neither.
function Core.recipeFromLink(link)
    if type(link) ~= "string" then return nil end
    local spell = link:match("|H?enchant:(%d+)") or link:match("|H?spell:(%d+)")
    if spell then return { kind = "spell", id = tonumber(spell) } end
    local item = link:match("|H?item:(%d+)")
    if item then return { kind = "item", id = tonumber(item) } end
    return nil
end

local function sortedKeys(map)
    local keys = {}
    for key in pairs(map) do keys[#keys + 1] = key end
    table.sort(keys)
    return keys
end

--- What Guild Assistant imports: every character with its professions, recipe ids sorted.
function Core.exportData(db)
    local characters = {}
    for _, key in ipairs(sortedKeys(db.characters)) do
        local character = db.characters[key]
        local professions = {}
        for _, name in ipairs(sortedKeys(character.professions)) do
            local profession = character.professions[name]
            local spells, items = {}, {}
            for recipe in pairs(profession.recipes) do
                local kind, id = recipe:match("^(%a+):(%d+)$")
                if kind == "spell" then spells[#spells + 1] = tonumber(id) end
                if kind == "item" then items[#items + 1] = tonumber(id) end
            end
            table.sort(spells)
            table.sort(items)
            professions[#professions + 1] = {
                name = name, skill = profession.rank, max = profession.max,
                spells = spells, items = items,
            }
        end
        characters[#characters + 1] = {
            name = character.name, realm = character.realm, class = character.class,
            source = character.source or "own", updated = character.updated,
            professions = professions,
        }
    end
    return { addon = "GuildAssistantProfessions", format = 1, characters = characters }
end

--- Rebuilds the export kept in the saved data (`db.export`, JSON), stamped `now`: the game writes
--- it to the saved variables file on logout or /reload, and Guild Assistant reads it from there.
function Core.refreshExport(db, now)
    db.export = Core.toJSON(Core.exportData(db))
    db.updated = now
end

-- JSON --------------------------------------------------------------------------------------------

local ESCAPES = { ['"'] = '\\"', ["\\"] = "\\\\", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }

local function encodeString(text)
    return '"' .. text:gsub('[%c"\\]', function(c)
        return ESCAPES[c] or ("\\u%04x"):format(c:byte())
    end) .. '"'
end

-- A table with only 1..n keys (or none, when `asArray`) is a JSON array; anything else an object.
local function isArray(value)
    local count = 0
    for _ in pairs(value) do count = count + 1 end
    for i = 1, count do
        if value[i] == nil then return false end
    end
    return true
end

local ARRAY_FIELDS = { characters = true, professions = true, spells = true, items = true }

local function encode(value, field)
    local kind = type(value)
    if kind == "string" then return encodeString(value) end
    if kind == "number" then
        return value == math.floor(value) and ("%d"):format(value) or tostring(value)
    end
    if kind == "boolean" then return tostring(value) end
    if kind ~= "table" then return "null" end
    local parts = {}
    if ARRAY_FIELDS[field] or (next(value) ~= nil and isArray(value)) then
        for i, item in ipairs(value) do parts[i] = encode(item) end
        return "[" .. table.concat(parts, ",") .. "]"
    end
    for _, key in ipairs(sortedKeys(value)) do
        parts[#parts + 1] = encodeString(tostring(key)) .. ":" .. encode(value[key], key)
    end
    return "{" .. table.concat(parts, ",") .. "}"
end

--- `value` as compact JSON, keys sorted (the same data always gives the same text).
function Core.toJSON(value)
    return encode(value)
end

--- "2 characters, 5 professions, 312 recipes".
function Core.describe(data)
    local professions, recipes = 0, 0
    for _, character in ipairs(data.characters) do
        for _, profession in ipairs(character.professions) do
            professions = professions + 1
            recipes = recipes + #profession.spells + #profession.items
        end
    end
    local function count(n, word) return ("%d %s%s"):format(n, word, n == 1 and "" or "s") end
    return ("%s, %s, %s"):format(count(#data.characters, "character"), count(professions, "profession"), count(recipes, "recipe"))
end
