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

--- The realm as saved: on WoW Forever the game's name also says which server of it the character
--- is on ("CAMWOW EU4 Realm 10 RP"), which can change; only its rule set ("RP") is kept, the realm
--- as Guild Assistant knows it. Any other name is kept as it is.
function Core.realmName(realm)
    return realm and realm:match("Realm %d+ (.+)$") or realm
end

--- Saved data from 1.0.2 and earlier: realms as the game named them, renamed (Core.realmName).
--- Two entries that become one keep the more recently updated.
function Core.migrate(db)
    local renamed = {}
    for key, character in pairs(db.characters) do
        if Core.realmName(character.realm) ~= character.realm then renamed[#renamed + 1] = key end
    end
    table.sort(renamed)
    for _, key in ipairs(renamed) do
        local character = db.characters[key]
        db.characters[key] = nil
        character.realm = Core.realmName(character.realm)
        local newKey = character.name .. "-" .. character.realm
        local other = db.characters[newKey]
        if not other or (character.updated or 0) > (other.updated or 0) then
            db.characters[newKey] = character
        end
    end
end

--- This player's name from UnitName("player"): WoW Forever gives the last name as its second value
--- ("Shivan", "Darkwhisp"), joined here as the game shows it; Classic Era gives none.
function Core.playerName(first, last)
    if last and last ~= "" then return first .. " " .. last end
    return first
end

--- Whether `name` is this player's: the full name, or the first name alone (as 1.0.2 and earlier
--- saved it on WoW Forever).
function Core.isOwnName(name, first, last)
    return name == first or name == Core.playerName(first, last)
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
        -- A guildmate's 1.0.2 or earlier says the realm as the game names it.
        local name, realm = key:match("^([^-]+)-(.+)$")
        if name then key = name .. "-" .. Core.realmName(realm) end
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
        -- Not heard of for long enough to be forgotten (Core.prune): not taken back either.
        if now and now - received.updated > Core.GUILD_TTL then return false end
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

-- Forgetting -------------------------------------------------------------------------------------
-- What is kept would otherwise only grow: every guildmate ever received (gone from the guild since,
-- or their character deleted) and every link ever opened. A character's `updated` says how recent
-- it is: each player's addon restamps its own character at login when it is older than
-- Core.HEARTBEAT (Core.heartbeat), and that travels like any change, so a character still played
-- stays recent everywhere. One not heard of for Core.GUILD_TTL goes, and so do links after
-- Core.LINK_TTL; the account's own are always kept. Guild Assistant keeps what it imported.

local DAY = 24 * 60 * 60
Core.HEARTBEAT, Core.GUILD_TTL, Core.LINK_TTL = 30 * DAY, 90 * DAY, 60 * DAY
--- At most this many characters kept per guild (the most recent): the guild summary of that many
--- still fits in one message (Core.newAssembler takes 200 pieces).
Core.MAX_GUILD = 1000

--- This player's own character, at login: restamped `now` when it is older than Core.HEARTBEAT,
--- so guildmates keep it. Returns whether it was. One with nothing recorded yet isn't shared.
function Core.heartbeat(character, now)
    if character.updated and now - character.updated > Core.HEARTBEAT then
        character.updated = now
        return true
    end
    return false
end

--- Forgets the guild's characters not heard of for Core.GUILD_TTL, links not changed for
--- Core.LINK_TTL, and a guild's oldest beyond Core.MAX_GUILD. Returns how many went.
function Core.prune(db, now)
    local removed, byGuild = 0, {}
    for _, key in ipairs(sortedKeys(db.characters)) do
        local character = db.characters[key]
        local age = now - (character.updated or 0)
        if character.source == "guild" and age > Core.GUILD_TTL
            or character.source == "link" and age > Core.LINK_TTL then
            db.characters[key], removed = nil, removed + 1
        elseif character.source == "guild" then
            local list = byGuild[character.guild or ""] or {}
            byGuild[character.guild or ""] = list
            list[#list + 1] = key
        end
    end
    for _, keys in pairs(byGuild) do
        if #keys > Core.MAX_GUILD then
            table.sort(keys, function(a, b)
                local ua, ub = db.characters[a].updated or 0, db.characters[b].updated or 0
                if ua ~= ub then return ua > ub end
                return a < b
            end)
            for i = Core.MAX_GUILD + 1, #keys do
                db.characters[keys[i]], removed = nil, removed + 1
            end
        end
    end
    return removed
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

--- A message whose next piece hasn't come for this long (seconds) is given up: a piece was lost,
--- or its sender logged out. A sender sends one message at a time (Sync.lua's queue), so only this
--- many of theirs are kept unfinished; a new one forgets their oldest.
Core.PIECE_TIMEOUT, Core.OPEN_PER_SENDER = 60, 2

--- Puts pieces back together, per sender: `add` returns the kind and the whole payload once the
--- last piece of one arrives, nil until then (or for a message that isn't one of these). `clock`
--- (seconds) times out unfinished ones (Core.PIECE_TIMEOUT, Core.OPEN_PER_SENDER).
function Core.newAssembler(clock)
    clock = clock or time or os.time
    local partial = {}
    local assembler = {}
    local function forget(key)
        local entry = partial[key]
        partial[key] = nil
        local open = assembler.open[entry.sender] - 1
        assembler.open[entry.sender] = open > 0 and open or nil
    end
    --- How many unfinished messages each sender has (for the tests).
    assembler.open = {}
    function assembler.add(sender, message)
        local kind, id, i, n, part = message:match("^(%a)([^\t]+)\t(%d+)\t(%d+)\t(.*)$")
        i, n = tonumber(i), tonumber(n)
        if not kind or not i or not n or n < 1 or n > 200 or i < 1 or i > n then return nil end
        local at = clock()
        for key, entry in pairs(partial) do
            if at - entry.at > Core.PIECE_TIMEOUT then forget(key) end
        end
        local key = sender .. "/" .. kind .. id
        local entry = partial[key]
        if not entry then
            if (assembler.open[sender] or 0) >= Core.OPEN_PER_SENDER then
                local oldest
                for other, e in pairs(partial) do
                    if e.sender == sender and (not oldest or e.at < partial[oldest].at) then oldest = other end
                end
                if oldest then forget(oldest) end
            end
            entry = { n = n, parts = {}, have = 0, sender = sender }
            partial[key] = entry
            assembler.open[sender] = (assembler.open[sender] or 0) + 1
        end
        entry.at = at
        if entry.n ~= n then return nil end
        if not entry.parts[i] then entry.have = entry.have + 1 end
        entry.parts[i] = part
        if entry.have < n then return nil end
        forget(key)
        return kind, table.concat(entry.parts)
    end
    return assembler
end

-- Recipe sources ---------------------------------------------------------------------------------
-- What the game shows of how recipes are obtained, kept for GuildAssistant Database (which reads it
-- from the saved data, Core.professionsSources there): where recipe items (plans, patterns,
-- formulas…) are sold, dropped, fished or given by quests, and which trainers teach which recipes
-- and for how much. db.sources = { items = { [item id] = { [entry] = last seen } }, recipes = {
-- [recipe] = { cost, trainers = { ["<zone>=<trainer>"] = last seen } } } }; an entry is
-- "<kind>[:<zone>]=<who>" (V vendor, D drop, O object, F fishing, Q quest), a recipe "item:<id>"
-- (the item it makes) or "name:<recipe name>". Not exported, not shared with the guild (yet).

--- At most this many places per recipe item, and trainers per recipe: enough to say where to go.
Core.MAX_SOURCES = 12

local function clean(text) return (tostring(text or ""):gsub("[\t\n\r;=]", " ")) end

local function countKeys(map)
    local n = 0
    for _ in pairs(map) do n = n + 1 end
    return n
end

--- Records that recipe item `itemId` comes from `kind` ("V", "D", "O", "F", "Q") in `zone`, by
--- `who` (a vendor, a creature, a quest's title; "" when not known), seen `now`. Returns whether it
--- was new.
function Core.recordItemSource(db, itemId, kind, zone, who, now)
    db.sources = db.sources or {}
    db.sources.items = db.sources.items or {}
    local entries = db.sources.items[itemId] or {}
    zone = clean(zone)
    local entry = kind .. (zone ~= "" and (":" .. zone) or "") .. "=" .. clean(who)
    local new = entries[entry] == nil
    if new and countKeys(entries) >= Core.MAX_SOURCES then return false end
    entries[entry] = now
    db.sources.items[itemId] = entries
    return new
end

--- Records that trainer `who` in `zone` teaches `recipe` ("item:<id>" or "name:<name>") for `cost`
--- (copper), seen `now`. Returns whether it was new.
function Core.recordTrainer(db, recipe, cost, zone, who, now)
    db.sources = db.sources or {}
    db.sources.recipes = db.sources.recipes or {}
    local known = db.sources.recipes[recipe] or { trainers = {} }
    local entry = clean(zone) .. "=" .. clean(who)
    local new = known.trainers[entry] == nil
    if new and countKeys(known.trainers) >= Core.MAX_SOURCES then return false end
    known.trainers[entry] = now
    known.cost = cost and cost > 0 and cost or known.cost
    db.sources.recipes[recipe] = known
    return new
end

--- "12 recipe items' sources, 30 trainer recipes": what is recorded, for /ga-prof status.
function Core.describeSources(db)
    local sources = db.sources or {}
    local items, recipes = countKeys(sources.items or {}), countKeys(sources.recipes or {})
    return ("%d recipe %s sources, %d trainer recipe%s"):format(items, items == 1 and "item's" or "items'",
        recipes, recipes == 1 and "" or "s")
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
