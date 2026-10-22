-- GuildAssistant Professions: everything that doesn't touch the game. Keeps what each character
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
--- longer has (unlearned, "dropped") goes, with its recipes. `now` (server time) marks the
--- character updated when anything changed; returns whether it did, and the names of the dropped
--- ones. Each profession keeps its history: `learned` (when it was first seen on the character;
--- learned again after being unlearned, it's the new date) and `updated` (its last change), which
--- Guild Assistant uses to tell a profession learned again from an old copy of a dropped one.
function Core.setProfessions(character, skills, now)
    local known, changed, dropped = {}, false, {}
    for _, skill in ipairs(skills) do
        known[skill.name] = true
        local profession = character.professions[skill.name]
        if not profession then
            profession, changed = { recipes = {}, learned = now, updated = now }, true
            character.professions[skill.name] = profession
        end
        if profession.rank ~= skill.rank or profession.max ~= skill.max then
            changed, profession.updated = true, now
        end
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
    local profession = character.professions[professionName] or { recipes = {}, learned = now }
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
    if added > 0 then character.updated, profession.updated = now, now end
    return added
end

--- Replaces the profession's recipes with `recipes`: for a window that lists every recipe whatever
--- its filters (the modern API), so wrong ones recorded before go too. Returns whether anything
--- changed; `now` (time()) marks the character updated when it did.
function Core.setRecipes(character, professionName, rank, max, recipes, now)
    local profession = character.professions[professionName] or { recipes = {}, learned = now }
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
    if changed then character.updated, profession.updated = now, now end
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
                learned = profession.learned, updated = profession.updated,
                spells = spells, items = items,
            }
        end
        characters[#characters + 1] = {
            name = character.name, realm = character.realm, class = character.class,
            source = character.source or "own", updated = character.updated,
            professions = professions,
        }
    end
    -- Format 2 (1.0): characters and professions dated by the game server's clock, which Guild
    -- Assistant needs to tell the newer data; it leaves format 1's characters out.
    return { addon = "GuildAssistantProfessions", format = 2, characters = characters }
end

--- Rebuilds the export kept in the saved data (`db.export`, JSON), stamped `now`: the game writes
--- it to the saved variables file on logout or /reload, and Guild Assistant reads it from there.
function Core.refreshExport(db, now)
    db.export = Core.toJSON(Core.exportData(db))
    db.updated = now
end

-- Guild sharing -----------------------------------------------------------------------------------
-- What the addons of a guild send each other over the game's hidden addon channel (Sync.lua does
-- the sending): a summary of who each one knows ("digest"), and characters' professions. Messages
-- are at most 255 bytes, so a payload goes in numbered pieces. Recipe ids are written in base 36.

local DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"

function Core.toBase36(n)
    n = math.floor(n)
    if n == 0 then return "0" end
    local out = ""
    while n > 0 do
        local d = n % 36
        out = DIGITS:sub(d + 1, d + 1) .. out
        n = (n - d) / 36
    end
    return out
end

function Core.fromBase36(text)
    return text and text:match("^[0-9a-z]+$") and tonumber(text, 36) or nil
end

--- A character shared with the guild: one of this account's in the guild, or one received from it.
--- Others seen through a profession link aren't shared (their own player's addon shares them).
function Core.shareable(character, guild)
    return guild ~= nil and character.guild == guild
        and (character.source == "own" or character.source == "guild")
end

--- A character's professions as text: "name;realm;class;updated;profession;…", each profession
--- "name,skill,max,learned,updated,spells,items", numbers in base 36 and recipe ids separated by
--- dots.
function Core.encodeCharacter(character)
    local parts = { character.name, character.realm, character.class or "",
        Core.toBase36(character.updated or 0) }
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
        for i, id in ipairs(spells) do spells[i] = Core.toBase36(id) end
        for i, id in ipairs(items) do items[i] = Core.toBase36(id) end
        parts[#parts + 1] = table.concat({ name, Core.toBase36(profession.rank or 0),
            Core.toBase36(profession.max or 0), Core.toBase36(profession.learned or 0),
            Core.toBase36(profession.updated or 0), table.concat(spells, "."), table.concat(items, ".") }, ",")
    end
    return table.concat(parts, ";")
end

local MAX_PROFESSIONS, MAX_RECIPES = 20, 3000

--- The character from `encodeCharacter`'s text; nil when it isn't one (anyone in the guild can
--- send anything, so it is checked).
function Core.decodeCharacter(text)
    if type(text) ~= "string" then return nil end
    local fields = {}
    for field in (text .. ";"):gmatch("([^;]*);") do fields[#fields + 1] = field end
    local name, realm, class, updated = fields[1], fields[2], fields[3], Core.fromBase36(fields[4])
    if not name or name == "" or not realm or realm == "" or not updated or #fields - 4 > MAX_PROFESSIONS then
        return nil
    end
    local character = { name = name, realm = realm, class = class ~= "" and class or nil,
        updated = updated, professions = {} }
    for i = 5, #fields do
        local pname, rank, max, learned, updatedAt, spells, items = fields[i]:match(
            "^([^,]+),([0-9a-z]+),([0-9a-z]+),([0-9a-z]+),([0-9a-z]+),([0-9a-z.]*),([0-9a-z.]*)$")
        if not pname then return nil end
        local recipes, count = {}, 0
        for kind, list in pairs({ spell = spells, item = items }) do
            for id in list:gmatch("[0-9a-z]+") do
                recipes[kind .. ":" .. Core.fromBase36(id)] = true
                count = count + 1
                if count > MAX_RECIPES then return nil end
            end
        end
        local r, m = Core.fromBase36(rank), Core.fromBase36(max)
        local l, u = Core.fromBase36(learned), Core.fromBase36(updatedAt)
        character.professions[pname] = { rank = r ~= 0 and r or nil, max = m ~= 0 and m or nil,
            learned = l ~= 0 and l or nil, updated = u ~= 0 and u or nil, recipes = recipes }
    end
    return character
end

--- The guild summary: every shareable character's key and when it was last updated,
--- "Name-Realm=updated;…".
function Core.digest(db, guild)
    local parts = {}
    for _, key in ipairs(sortedKeys(db.characters)) do
        local character = db.characters[key]
        if Core.shareable(character, guild) then
            parts[#parts + 1] = key .. "=" .. Core.toBase36(character.updated or 0)
        end
    end
    return table.concat(parts, ";")
end

function Core.parseDigest(text)
    local known = {}
    for key, updated in (text or ""):gmatch("([^;=]+)=([0-9a-z]+)") do
        known[key] = Core.fromBase36(updated)
    end
    return known
end

--- What to send someone whose summary is `theirs`: the keys of the shareable characters they
--- don't have, or have older.
function Core.newerThan(db, guild, theirs)
    local keys = {}
    for _, key in ipairs(sortedKeys(db.characters)) do
        local character = db.characters[key]
        if Core.shareable(character, guild) and (character.updated or 0) > (theirs[key] or -1) then
            keys[#keys + 1] = key
        end
    end
    return keys
end

--- Merges a character received from the guild into what is kept. Whoever it came from, the more
--- recent copy (the character's `updated`) wins on which professions the character has: a newer
--- copy without one drops it (unlearned since), unless that profession was learned or changed after
--- the copy; an older copy can't bring back one this copy no longer has. Within a profession both
--- have, recipes are only ever added and skill keeps the higher. `now` (server time) restamps a
--- merge that holds more than what was received, so the guildmates who only have that still ask
--- for it. Returns whether anything changed.
function Core.receive(db, guild, received, now)
    local key = received.name .. "-" .. received.realm
    local current = db.characters[key]
    if not current then
        db.characters[key] = { name = received.name, realm = received.realm, class = received.class,
            source = "guild", guild = guild, updated = received.updated, professions = received.professions }
        return true
    end
    local newer = received.updated > (current.updated or 0)
    local changed, more = false, false
    if newer then
        for name, profession in pairs(current.professions) do
            if not received.professions[name] and (profession.learned or 0) <= received.updated
                and (profession.updated or 0) <= received.updated then
                current.professions[name], changed = nil, true
            end
        end
    end
    for name, incoming in pairs(received.professions) do
        local profession = current.professions[name]
        -- One an older copy has and this one doesn't: unlearned since, not brought back.
        if not profession and newer then
            profession, changed = { recipes = {} }, true
            current.professions[name] = profession
        end
        if profession then
            for recipe in pairs(incoming.recipes) do
                if not profession.recipes[recipe] then profession.recipes[recipe], changed = true, true end
            end
            if (incoming.rank or 0) > (profession.rank or 0) then profession.rank, changed = incoming.rank, true end
            if (incoming.max or 0) > (profession.max or 0) then profession.max, changed = incoming.max, true end
            -- The later of each date: learned again after being unlearned beats an old copy.
            for _, field in ipairs({ "learned", "updated" }) do
                if (incoming[field] or 0) > (profession[field] or 0) then
                    profession[field], changed = incoming[field], true
                end
            end
        end
    end
    for name, profession in pairs(current.professions) do
        local incoming = received.professions[name]
        if not incoming then more = true else
            for recipe in pairs(profession.recipes) do
                if not incoming.recipes[recipe] then more = true end
            end
        end
    end
    -- Seen through a link before: now it's the guild's, shared like the others. One of this
    -- account's stays its own.
    if current.source == "link" then current.source, current.guild, changed = "guild", guild, true end
    current.class = current.class or received.class
    -- Holding more than received, but not stamped newer: those with only that wouldn't ask for it.
    local updated = math.max(current.updated or 0, received.updated)
    if more and received.updated >= (current.updated or 0) then updated = math.max(updated + 1, now or 0) end
    if updated ~= current.updated then current.updated, changed = updated, true end
    return changed
end

--- A payload in numbered pieces that each fit in one addon message: "<kind><id>\t<i>\t<n>\t<part>".
function Core.pieces(kind, id, payload, size)
    size = size or 230
    local list, count = {}, math.max(1, math.ceil(#payload / size))
    for i = 1, count do
        list[i] = ("%s%s\t%d\t%d\t%s"):format(kind, id, i, count, payload:sub((i - 1) * size + 1, i * size))
    end
    return list
end

--- Puts pieces back together, per sender: `add` returns the kind and the whole payload once the
--- last piece of one arrives, nil until then (or for a message that isn't one of these).
function Core.newAssembler()
    local partial = {}
    local assembler = {}
    function assembler.add(sender, message)
        local kind, id, i, n, part = message:match("^(%a)([^\t]+)\t(%d+)\t(%d+)\t(.*)$")
        i, n = tonumber(i), tonumber(n)
        if not kind or not i or not n or n < 1 or n > 200 or i < 1 or i > n then return nil end
        local key = sender .. "/" .. kind .. id
        local entry = partial[key] or { n = n, parts = {}, have = 0 }
        partial[key] = entry
        if entry.n ~= n then return nil end
        if not entry.parts[i] then entry.have = entry.have + 1 end
        entry.parts[i] = part
        if entry.have < n then return nil end
        partial[key] = nil
        return kind, table.concat(entry.parts)
    end
    return assembler
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
