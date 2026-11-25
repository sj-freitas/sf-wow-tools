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
--- is on ("CAMWOW EU4 Realm 10 RP"), which can change; only its rule set ("RP", "PvP", "RP-PVP",
--- "Normal", "Hardcore") is kept, the realm as Guild Assistant knows it. The same name without its
--- spaces, as GetNormalizedRealmName gives it ("CAMWOWEU4Realm10RP"), comes to the same rule set,
--- so it doesn't matter which of the game's functions answered. Any other name is kept as it is.
function Core.realmName(realm)
    return realm and realm:match("Realm%s*%d+%s*(.+)$") or realm
end

--- The realm this character is on: what the game answers (Core.realmName) when it has an answer,
--- and otherwise the last realm it did name, kept in the saved data. WoW Forever's client says ""
--- until a login is through, and a character keyed without a realm ("Shivan Bank-") is a second
--- copy of one already saved -- listed, shared and exported as if it were somebody else. nil when
--- the game has never named one (a first login on such a client).
function Core.realm(db, named)
    local realm = Core.realmName(named)
    if realm and realm ~= "" and realm ~= db.realm then
        db.realm = realm
        -- Known for the first time (the client answered at last, or this character is on another
        -- realm): what was saved while it wasn't belongs to a character on one.
        Core.mergeRealmless(db)
    end
    return db.realm
end

--- Saved data from a version that keyed characters differently: realms as the game named them
--- (1.0.2 and earlier, renamed by Core.realmName), and entries keyed without a realm at all
--- (Core.mergeRealmless). Two entries that become one keep the more recently updated.
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
    Core.dropNameAsRealm(db)
    Core.mergeRealmless(db)
    Core.dropOldFirstNames(db)
end

--- Which realm a copy saved without one belongs to: the one the character's own entry is on,
--- whichever that is -- the same character, saved properly before or since. The key of that entry,
--- or nil when the character has no other.
local function twinOf(db, name)
    local found
    for key, character in pairs(db.characters) do
        if character.name == name and character.realm and character.realm ~= ""
            and (found == nil or key < found) then
            found = key
        end
    end
    return found
end

--- One entry of this character folded into another: both are its own, and the copy saved before
--- the client named the realm holds less rather than newer truth (one written at login, before the
--- game said what the character has, holds nothing at all). So everything each of them has is
--- kept: every profession and recipe, the higher skill, the later dates. A profession really
--- unlearned goes at the next scan, which reads them all (Core.setProfessions).
local function foldInto(into, character)
    for name, profession in pairs(character.professions) do
        local kept = into.professions[name]
        if not kept then
            into.professions[name] = profession
        else
            for recipe in pairs(profession.recipes) do kept.recipes[recipe] = true end
            if (profession.rank or 0) > (kept.rank or 0) then kept.rank = profession.rank end
            if (profession.max or 0) > (kept.max or 0) then kept.max = profession.max end
            for _, field in ipairs({ "learned", "updated" }) do
                if (profession[field] or 0) > (kept[field] or 0) then kept[field] = profession[field] end
            end
        end
    end
    into.class = into.class or character.class
    into.guild = into.guild or character.guild
    into.source = "own" -- this account's, whatever the entry it is folded into was
    into.updated = math.max(into.updated or 0, character.updated or 0)
    Core.setAttunements(into, character.attunements or {})
end

--- Characters keyed without a realm ("Shivan Bank-"), saved by 1.7.0 and 1.7.1 when the client
--- hadn't named the realm at login: each is a second copy of a character already saved. One of
--- this account's is folded into that character's own entry (foldInto: everything either of them
--- held is kept), or, where the character has no other entry, renamed to the realm now known. One with neither waits where it is: it is all that
--- character has, and the fold happens as soon as some realm is named (Core.realm). A guildmate's
--- goes: which character it is can't be known, and it comes again from them. Returns how many were
--- folded in or dropped.
function Core.mergeRealmless(db)
    local realmless, done = {}, 0
    for key, character in pairs(db.characters) do
        if not character.realm or character.realm == "" then realmless[#realmless + 1] = key end
    end
    table.sort(realmless)
    for _, key in ipairs(realmless) do
        local character = db.characters[key]
        if character.source ~= "own" then
            db.characters[key] = nil
            done = done + 1
        else
            local other = twinOf(db, character.name)
            local realm = other and db.characters[other].realm or db.realm
            if realm and realm ~= "" then
                db.characters[key] = nil
                character.realm = realm
                local into = db.characters[character.name .. "-" .. realm]
                if not into then
                    db.characters[character.name .. "-" .. realm] = character
                else
                    foldInto(into, character)
                end
                done = done + 1
            end
        end
    end
    return done
end

--- The realm to key `name` by: the one the game named (Core.realm) and, where it names none and
--- none is remembered, the realm this character is already saved on. A client that says nothing
--- still left the entries it saved when it did, and they say where this character is -- without
--- which the addon would record nothing at all of a player whose client has gone quiet. nil for a
--- character nothing knows yet.
function Core.realmOf(db, named, name)
    local realm = Core.realm(db, named)
    if realm and realm ~= "" then return realm end
    local key = twinOf(db, name)
    return key and db.characters[key].realm or nil
end

--- Whether this entry's realm is really part of its own name, which 1.7.3 saved when it asked
--- UnitFullName for the realm and WoW Forever's client answered with the character's last name:
--- "Shivan Darkwhisp-Darkwhisp". No realm is a character's own last name, and names on a client
--- that has no second part can't be mistaken for one.
local function nameAsRealm(character)
    return character.name:find(" ") ~= nil and character.realm ~= nil
        and character.realm == character.name:match("([^ ]+)$")
end

--- Characters 1.7.3 keyed by their own last name instead of a realm (nameAsRealm): this account's
--- are made realmless again, for Core.mergeRealmless to put back where they belong, a guildmate's
--- -- shared by someone whose addon did the same -- are dropped, and a realm remembered from that
--- mistake is forgotten. Returns how many were put right.
function Core.dropNameAsRealm(db)
    local wrong = {}
    for key, character in pairs(db.characters) do
        if nameAsRealm(character) then wrong[#wrong + 1] = key end
    end
    table.sort(wrong)
    for _, key in ipairs(wrong) do
        local character = db.characters[key]
        if db.realm == character.realm then db.realm = nil end
        db.characters[key] = nil
        if character.source == "own" then
            character.realm = ""
            local waiting = db.characters[character.name .. "-"]
            if waiting then
                foldInto(waiting, character)
            else
                db.characters[character.name .. "-"] = character
            end
        end
    end
    return #wrong
end

--- Whether `name` is one of this account's characters under its first name alone, as 1.0.2 and
--- earlier saved it on WoW Forever ("Shivan" where this account has "Shivan Darkwhisp" on the same
--- realm). A guildmate whose addon still holds that copy goes on sharing it, and it would be
--- listed and counted as another player. Classic Era's names have no second part, so nothing there
--- can match.
function Core.oldFirstName(db, name, realm)
    if name:find(" ") then return false end
    for _, character in pairs(db.characters) do
        if character.source == "own" and character.realm == realm
            and character.name:sub(1, #name + 1) == name .. " " then
            return true
        end
    end
    return false
end

--- Copies of this account's characters under their first name alone, received from a guildmate
--- still holding 1.0.2's data (Core.oldFirstName). Returns how many went.
function Core.dropOldFirstNames(db)
    local old = {}
    for key, character in pairs(db.characters) do
        if character.source ~= "own" and Core.oldFirstName(db, character.name, character.realm) then
            old[#old + 1] = key
        end
    end
    for _, key in ipairs(old) do db.characters[key] = nil end
    return #old
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

--- The recipes of `ids` (a profession's list in Recipes.lua: spell ids, in any separators) that
--- `knows(id)` says this character has, as a window's scan gives them: { { kind = "spell", id } }.
function Core.knownRecipes(ids, knows)
    local recipes = {}
    for text in (ids or ""):gmatch("%d+") do
        local id = tonumber(text)
        if knows(id) then recipes[#recipes + 1] = { kind = "spell", id = id } end
    end
    return recipes
end

-- Specializations ------------------------------------------------------------------------------
-- A character's specialization (Weaponsmith, Goblin Engineer) is a spell it knows, kept with its
-- profession's recipes as one ("spell:9787"): guild sharing carries it like a recipe, and versions
-- before 1.5.0 pass it on untouched. Recipes.lua says which spells they are; the profession window
-- doesn't list them, and the export gives them apart from the recipes.

--- Whether `key` ("spell:9787") is a specialization's spell, not a recipe.
function Core.isSpecialization(key)
    local list = ns.Recipes and ns.Recipes.specializations
    if not list then return false end
    if not Core.specializationSpells then
        Core.specializationSpells = {}
        for _, ids in pairs(list) do
            for id in ids:gmatch("%d+") do Core.specializationSpells["spell:" .. id] = true end
        end
    end
    return Core.specializationSpells[key] == true
end

--- Replaces the profession's recipes with `recipes`: for a window that lists every recipe whatever
--- its filters (the modern API), so wrong ones recorded before go too. Specializations stay: the
--- window doesn't list them. Returns whether anything changed; `now` (time()) marks the character
--- updated when it did.
function Core.setRecipes(character, professionName, rank, max, recipes, now)
    local profession = character.professions[professionName] or { recipes = {}, learned = now }
    character.professions[professionName] = profession
    if rank then profession.rank, profession.max = rank, max end
    local new, count = {}, 0
    for _, recipe in ipairs(recipes) do
        local key = recipe.kind .. ":" .. recipe.id
        if not new[key] then new[key], count = true, count + 1 end
    end
    for key in pairs(profession.recipes) do
        if Core.isSpecialization(key) and not new[key] then new[key], count = true, count + 1 end
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

-- The characters the export carries: Guild Assistant knows a character by its name and realm, so
-- one saved without a realm is a copy of one that has it (Core.mergeRealmless), not a character.
local function exportable(db)
    local keys = {}
    for _, key in ipairs(sortedKeys(db.characters)) do
        local character = db.characters[key]
        if character.realm and character.realm ~= "" then keys[#keys + 1] = key end
    end
    return keys
end

--- What Guild Assistant imports: every character with its professions, recipe ids sorted.
function Core.exportData(db)
    local characters = {}
    for _, key in ipairs(exportable(db)) do
        local character = db.characters[key]
        local professions = {}
        for _, name in ipairs(sortedKeys(character.professions)) do
            local profession = character.professions[name]
            local spells, items, specializations = {}, {}, {}
            for recipe in pairs(profession.recipes) do
                local kind, id = recipe:match("^(%a+):(%d+)$")
                if Core.isSpecialization(recipe) then
                    specializations[#specializations + 1] = tonumber(id)
                elseif kind == "spell" then
                    spells[#spells + 1] = tonumber(id)
                elseif kind == "item" then
                    items[#items + 1] = tonumber(id)
                end
            end
            table.sort(spells)
            table.sort(items)
            table.sort(specializations)
            professions[#professions + 1] = {
                name = name, skill = profession.rank, max = profession.max,
                learned = profession.learned, updated = profession.updated,
                spells = spells, items = items,
                -- 1.5.0: its specializations' spells (Weaponsmith 9787), only when it has some.
                specializations = #specializations > 0 and specializations or nil,
            }
        end
        local attunements = Core.attunementsOf(character)
        characters[#characters + 1] = {
            name = character.name, realm = character.realm, class = character.class,
            source = character.source or "own", updated = character.updated,
            professions = professions,
            -- 1.6.0: which raids it is attuned to, only when any was looked at.
            attunements = #attunements > 0 and attunements or nil,
        }
    end
    -- Format 2 (1.0): characters and professions dated by the game server's clock, which Guild
    -- Assistant needs to tell the newer data; it leaves format 1's characters out.
    local export = { addon = "GuildAssistantProfessions", format = 2, characters = characters }
    export.sources = Core.exportSources(db)
    return export
end

--- How recipes are obtained, as recorded (1.3.0 and later), for Guild Assistant to gather into
--- GuildAssistant Database: { items = { { id, entries } }, trainers = { { recipe, cost, entries,
--- requires } } } (entries as kept, sorted; requires only when the trainer said some: { "Goblin
--- Engineer" }), nil when nothing is recorded.
function Core.exportSources(db)
    local sources = db.sources
    if not sources then return nil end
    local items, trainers = {}, {}
    for _, id in ipairs(sortedKeys(sources.items or {})) do
        local entries = sortedKeys(sources.items[id])
        if #entries > 0 then items[#items + 1] = { id = id, entries = entries } end
    end
    for _, recipe in ipairs(sortedKeys(sources.recipes or {})) do
        local known = sources.recipes[recipe]
        local entries, requires = sortedKeys(known.trainers or {}), sortedKeys(known.requires or {})
        if #entries > 0 or #requires > 0 then
            trainers[#trainers + 1] = { recipe = recipe, cost = known.cost, entries = entries,
                requires = #requires > 0 and requires or nil }
        end
    end
    if #items == 0 and #trainers == 0 then return nil end
    return { items = items, trainers = trainers }
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
--- Others seen through a profession link aren't shared (their own player's addon shares them), and
--- neither is one saved without a realm: a guildmate can't tell which character that is.
function Core.shareable(character, guild)
    return guild ~= nil and character.guild == guild
        and character.realm ~= nil and character.realm ~= ""
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
    -- Without a realm there is no telling which character it is, and keeping it would be a second
    -- entry of one already saved (Core.mergeRealmless). A guildmate on 1.7.1 still sends them.
    if not received.realm or received.realm == "" then return false end
    -- Nor one of this account's characters under its first name alone, which a guildmate still on
    -- 1.0.2's data goes on sharing: the same character, an old copy of it (Core.oldFirstName).
    if Core.oldFirstName(db, received.name, received.realm) then return false end
    -- Nor a character keyed by its own last name, which a guildmate on 1.7.3 shares until they
    -- update: that realm is a name (nameAsRealm).
    if nameAsRealm(received) then return false end
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
-- and for how much, and what else they require (a specialization: "Goblin Engineer", as the
-- trainer's window says it). db.sources = { items = { [item id] = { [entry] = last seen } }, recipes
-- = { [recipe] = { cost, trainers = { ["<zone>=<trainer>"] = last seen }, requires = { [name] = last
-- seen } } } }; an entry is "<kind>[:<zone>]=<who>" (V vendor, D drop, O object, F fishing, Q
-- quest), a recipe "item:<id>" (the item it makes) or "name:<recipe name>". Each recipe item's
-- sources, each trainer recipe and what each requires is a record ("i<item id>", "r<recipe>",
-- "q<recipe>"), stamped when it last changed (db.sources.stamps): the guild shares records like
-- characters (Sync.lua), and the export carries them for Guild Assistant. The requirement is a record
-- of its own so that 1.4.0 and earlier, which don't know it, take the trainers and leave it.

--- At most this many places per recipe item, and trainers per recipe: enough to say where to go.
Core.MAX_SOURCES = 12
--- At most this many requirements per recipe (one, in the game: a specialization).
Core.MAX_REQUIRES = 3

local function clean(text) return (tostring(text or ""):gsub("[\t\n\r;=]", " ")) end

local function countKeys(map)
    local n = 0
    for _ in pairs(map) do n = n + 1 end
    return n
end

--- The record of a recipe item's sources, of a trainer recipe, and of what that recipe requires.
function Core.itemRecord(itemId) return "i" .. itemId end
function Core.trainerRecord(recipe) return "r" .. recipe end
function Core.requiresRecord(recipe) return "q" .. recipe end

local function stamp(db, record, now)
    db.sources.stamps = db.sources.stamps or {}
    db.sources.stamps[record] = math.max(now, db.sources.stamps[record] or 0)
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
    if new then stamp(db, Core.itemRecord(itemId), now) end
    return new
end

--- Records that trainer `who` in `zone` teaches `recipe` ("item:<id>" or "name:<name>") for `cost`
--- (copper), and that it requires `requires` (names, as the window says them: { "Goblin Engineer" };
--- nil or empty for nothing), seen `now`. Returns whether the trainer was new, and whether a
--- requirement was.
function Core.recordTrainer(db, recipe, cost, zone, who, now, requires)
    db.sources = db.sources or {}
    db.sources.recipes = db.sources.recipes or {}
    local known = db.sources.recipes[recipe] or { trainers = {} }
    db.sources.recipes[recipe] = known
    local newRequirement = false
    for _, name in ipairs(requires or {}) do
        name = clean(name)
        known.requires = known.requires or {}
        if name ~= "" and (known.requires[name] or countKeys(known.requires) < Core.MAX_REQUIRES) then
            newRequirement = newRequirement or known.requires[name] == nil
            known.requires[name] = now
        end
    end
    if newRequirement then stamp(db, Core.requiresRecord(recipe), now) end
    local entry = clean(zone) .. "=" .. clean(who)
    local new = known.trainers[entry] == nil
    if new and countKeys(known.trainers) >= Core.MAX_SOURCES then return false, newRequirement end
    known.trainers[entry] = now
    local costChanged = cost and cost > 0 and cost ~= known.cost
    known.cost = cost and cost > 0 and cost or known.cost
    if new or costChanged then stamp(db, Core.trainerRecord(recipe), now) end
    return new, newRequirement
end

--- The summary of the records of sources this addon has, for the guild: "i6047=<stamp>;…".
function Core.sourcesDigest(db)
    local parts = {}
    for record, at in pairs(db.sources and db.sources.stamps or {}) do
        parts[#parts + 1] = record .. "=" .. Core.toBase36(at)
    end
    table.sort(parts)
    return table.concat(parts, ";")
end

function Core.parseSourcesDigest(text)
    local known = {}
    for record, at in (text or ""):gmatch("([^;=]+)=([0-9a-z]+)") do known[record] = Core.fromBase36(at) end
    return known
end

--- The records to send someone whose summary is `theirs`: those they lack, or have older.
function Core.sourcesNewerThan(db, theirs)
    local records = {}
    for record, at in pairs(db.sources and db.sources.stamps or {}) do
        if at > (theirs[record] or -1) then records[#records + 1] = record end
    end
    table.sort(records)
    return records
end

--- A record as text: "<record>\t<stamp>\t<cost>\t<entry>\t…" (numbers in base 36; cost only
--- for a trainer recipe; entries as kept: a requirement's are the names). Nil when this addon
--- doesn't have it.
function Core.encodeSourceRecord(db, record)
    local sources = db.sources or {}
    local at = sources.stamps and sources.stamps[record]
    if not at then return nil end
    local entries, cost = {}, ""
    local itemId = tonumber(record:match("^i(%d+)$") or "")
    if itemId then
        for entry in pairs(sources.items and sources.items[itemId] or {}) do entries[#entries + 1] = entry end
    else
        local known = sources.recipes and sources.recipes[record:sub(2)]
        if not known then return nil end
        if record:sub(1, 1) == "q" then
            for name in pairs(known.requires or {}) do entries[#entries + 1] = name end
        else
            for entry in pairs(known.trainers) do entries[#entries + 1] = entry end
            cost = known.cost and Core.toBase36(known.cost) or ""
        end
    end
    table.sort(entries)
    local fields = { record, Core.toBase36(at), cost }
    for _, entry in ipairs(entries) do fields[#fields + 1] = entry end
    return table.concat(fields, "\t")
end

local ITEM_ENTRY = "^[VDOFQ][^=\t;]*=[^\t;]*$"
local TRAINER_ENTRY = "^[^=\t;]*=[^=\t;]+$"
local REQUIREMENT = "^[^=\t;]+$"
local RECIPE_KEY = { "^%aitem:%d+$", "^%aname:[^=;]+$" }

local function isRecipeRecord(record, kind)
    if record:sub(1, 1) ~= kind then return false end
    return record:match(RECIPE_KEY[1]) ~= nil or record:match(RECIPE_KEY[2]) ~= nil
end

--- A record from `encodeSourceRecord`'s text, checked (anyone in the guild can send anything):
--- { record, stamp, cost, entries }, nil when it isn't one.
function Core.decodeSourceRecord(text)
    if type(text) ~= "string" then return nil end
    local fields = {}
    for field in (text .. "\t"):gmatch("([^\t]*)\t") do fields[#fields + 1] = field end
    local record, at = fields[1], Core.fromBase36(fields[2])
    local isItem = record and record:match("^i%d+$") ~= nil
    local isTrainer = record and isRecipeRecord(record, "r")
    local isRequirement = record and isRecipeRecord(record, "q")
    local most = isRequirement and Core.MAX_REQUIRES or Core.MAX_SOURCES
    if not at or not (isItem or isTrainer or isRequirement) or #fields - 3 > most or #fields < 4 then return nil end
    local decoded = { record = record, stamp = at, cost = Core.fromBase36(fields[3]), entries = {} }
    local pattern = isItem and ITEM_ENTRY or isTrainer and TRAINER_ENTRY or REQUIREMENT
    for i = 4, #fields do
        local entry = fields[i]
        if #entry > (isRequirement and 60 or 120) or not entry:match(pattern) then return nil end
        decoded.entries[#decoded.entries + 1] = entry
    end
    return decoded
end

--- Merges a record received from the guild into what is kept: its entries are added (at most
--- Core.MAX_SOURCES; a requirement's, Core.MAX_REQUIRES), a trainer's cost taken. Holding more than received, the record is restamped
--- newer, so those who only have what was received ask for it. Returns whether anything changed,
--- and whether what is kept has more than what was received (worth sending back).
function Core.receiveSourceRecord(db, received, now)
    db.sources = db.sources or {}
    db.sources.stamps = db.sources.stamps or {}
    local itemId = tonumber(received.record:match("^i(%d+)$") or "")
    local entries, most = nil, Core.MAX_SOURCES
    if itemId then
        db.sources.items = db.sources.items or {}
        entries = db.sources.items[itemId] or {}
        db.sources.items[itemId] = entries
    else
        db.sources.recipes = db.sources.recipes or {}
        local known = db.sources.recipes[received.record:sub(2)] or { trainers = {} }
        db.sources.recipes[received.record:sub(2)] = known
        if received.record:sub(1, 1) == "q" then
            known.requires = known.requires or {}
            entries, most = known.requires, Core.MAX_REQUIRES
        else
            entries = known.trainers
            if received.cost and received.cost > 0 and received.cost ~= known.cost then
                known.cost = received.cost
            end
        end
    end
    local changed, incoming = false, {}
    for _, entry in ipairs(received.entries) do
        incoming[entry] = true
        if entries[entry] == nil and countKeys(entries) < most then
            entries[entry], changed = received.stamp, true
        end
    end
    local more = false
    for entry in pairs(entries) do
        if not incoming[entry] then more = true end
    end
    local current = db.sources.stamps[received.record] or 0
    local at = math.max(current, received.stamp)
    if more and received.stamp >= current then at = math.max(at + 1, now or 0) end
    if at ~= current then db.sources.stamps[received.record], changed = at, true end
    return changed, more
end

--- "12 recipe items' sources, 30 trainer recipes": what is recorded, for /ga-prof status.
function Core.describeSources(db)
    local sources = db.sources or {}
    local items, recipes = countKeys(sources.items or {}), countKeys(sources.recipes or {})
    return ("%d recipe %s sources, %d trainer recipe%s"):format(items, items == 1 and "item's" or "items'",
        recipes, recipes == 1 and "" or "s")
end

-- Attunements ------------------------------------------------------------------------------------
-- Which raids a character may walk into. Each attunement is a quest the game says is complete or
-- not (Attunements.lua asks it), one per faction. What the game says is kept with the character,
-- { [key] = true/false }: true attuned, false looked at and not attuned, and a key missing means no
-- addon that knew that raid has looked at this character yet -- so GuildAssistant Database can tell
-- "not attuned" from "not known". Attuning is for good (a completed quest never uncompletes), so
-- everything merges the same way: keys are added, and `true` wins. The guild shares every
-- character's at once (Sync.lua, "A"), summary and answer in one message: there is no payload
-- bigger than the summary to ask for, as there is for characters and recipe sources.

--- The factions an attunement quest can be for, as the game names them (UnitFactionGroup).
Core.FACTIONS = { "Alliance", "Horde" }

--- The raids with an attunement: the quest each faction completes for it, and the game's icon for
--- the raid (a file id), which GuildAssistantDatabase shows in its window and Guild Assistant on
--- the website -- each has its own copy of this list, and this is the one a new raid is added to
--- first. `key` is what is saved, shared and exported, so it is never renamed: guildmates' addons
--- and Guild Assistant hold it.
Core.ATTUNEMENTS = {
    { key = "ony", raid = "Onyxia's Lair", icon = 134154, quests = { Alliance = 6502, Horde = 6602 } },
}

--- At most this many attunements per character in a message: more is someone else's doing.
Core.MAX_ATTUNEMENTS = 20

--- Whether `key` is one an attunement can have: short, lower case letters and digits. Anyone in the
--- guild can send anything, and a key this addon doesn't know yet is still kept and passed on.
function Core.isAttunementKey(key)
    return type(key) == "string" and #key <= 12 and key:match("^[a-z0-9]+$") ~= nil
end

--- The quests to ask about for `attunement` on a character of `faction`: that faction's, or, when
--- the game doesn't say which it is ("Neutral", before one is picked), every one of them -- only
--- the character's own can be complete.
function Core.attunementQuests(attunement, faction)
    local quests = attunement.quests or {}
    if faction and quests[faction] then return { quests[faction] } end
    local ids = {}
    for _, name in ipairs(Core.FACTIONS) do
        if quests[name] then ids[#ids + 1] = quests[name] end
    end
    return ids
end

--- Records attunements of the character (`states`: { [key] = whether it is attuned }), from the
--- game or from a guildmate. Keys are only added and only ever gain: `false` never replaces `true`.
--- Returns whether anything changed. `now` (server time) marks the character updated when something
--- did: the scan of this character's own passes it, so a character with no professions recorded is
--- stamped and so shared with the guild (Core.receive leaves an unstamped one); what a guildmate
--- sent doesn't, so their own copy stays the newer one.
function Core.setAttunements(character, states, now)
    local changed = false
    for key, attuned in pairs(states) do
        if Core.isAttunementKey(key) then
            local known = character.attunements and character.attunements[key]
            local merged = known == true or attuned == true
            if known == nil or known ~= merged then
                character.attunements = character.attunements or {}
                character.attunements[key], changed = merged, true
            end
        end
    end
    if changed and now then character.updated = math.max(now, character.updated or 0) end
    return changed
end

--- A character's attunements as the export and the sharing write them: { { key, attuned } }, by
--- key. Empty when none has been looked at.
function Core.attunementsOf(character)
    local list = {}
    for _, key in ipairs(sortedKeys(character.attunements or {})) do
        list[#list + 1] = { key = key, attuned = character.attunements[key] == true }
    end
    return list
end

--- Every shareable character's attunements as text: "Name-Realm=ony+;Other-Realm=ony-" (+ attuned,
--- - looked at and not). Empty when nothing is known of any of them, which is still worth sending:
--- whoever holds more hears that this addon lacks it.
function Core.encodeAttunements(db, guild)
    local parts = {}
    for _, key in ipairs(sortedKeys(db.characters)) do
        local character = db.characters[key]
        if Core.shareable(character, guild) then
            local states = {}
            for _, entry in ipairs(Core.attunementsOf(character)) do
                states[#states + 1] = entry.key .. (entry.attuned and "+" or "-")
            end
            if #states > 0 then parts[#parts + 1] = key .. "=" .. table.concat(states) end
        end
    end
    return table.concat(parts, ";")
end

--- The attunements from `encodeAttunements`' text, checked (anyone in the guild can send anything):
--- { ["Name-Realm"] = { [key] = attuned } }.
function Core.parseAttunements(text)
    local received = {}
    for key, states in (text or ""):gmatch("([^;=]+)=([a-z0-9%+%-]+)") do
        -- A guildmate's 1.0.2 or earlier says the realm as the game names it.
        local name, realm = key:match("^([^-]+)-(.+)$")
        if name then
            local parsed, count = {}, 0
            for raid, mark in states:gmatch("([a-z0-9]+)([%+%-])") do
                count = count + 1
                if count <= Core.MAX_ATTUNEMENTS and Core.isAttunementKey(raid) then
                    parsed[raid] = mark == "+"
                end
            end
            if next(parsed) then received[name .. "-" .. Core.realmName(realm)] = parsed end
        end
    end
    return received
end

--- Merges attunements received from the guild into the characters that are kept. One this addon
--- doesn't know yet is left alone: the character itself travels on its own (the hello's answers),
--- and the attunements come again. Returns how many characters changed.
function Core.receiveAttunements(db, guild, received)
    local changed = 0
    for key, states in pairs(received) do
        local character = db.characters[key]
        if character and Core.shareable(character, guild) and Core.setAttunements(character, states) then
            changed = changed + 1
        end
    end
    return changed
end

--- Remembers in `heard` what a guildmate's message showed of the attunements, so this addon's own
--- answer needn't go when someone else's already carried everything it holds (Sync.lua).
function Core.heardAttunements(heard, shown)
    for key, states in pairs(shown) do
        heard[key] = heard[key] or {}
        for raid, attuned in pairs(states) do
            heard[key][raid] = heard[key][raid] == true or attuned == true
        end
    end
    return heard
end

--- Whether this addon holds attunements that `heard` (what the guild has shown, and what this addon
--- has already sent) doesn't: a character it doesn't list, a raid it lacks of one, or one it says
--- isn't attuned that this addon knows is. Nothing to answer when it doesn't.
function Core.attunementsMore(db, guild, heard)
    for key, character in pairs(db.characters) do
        if Core.shareable(character, guild) then
            local theirs = heard[key] or {}
            for raid, attuned in pairs(character.attunements or {}) do
                local known = theirs[raid]
                if known == nil or (attuned == true and known ~= true) then return true end
            end
        end
    end
    return false
end

--- "Onyxia's Lair: 2 of 3 characters", for /ga-prof status: of the characters looked at, how many
--- are attuned to each raid this addon knows.
function Core.describeAttunements(db)
    local parts = {}
    for _, attunement in ipairs(Core.ATTUNEMENTS) do
        local attuned, looked = 0, 0
        for _, character in pairs(db.characters) do
            local state = character.attunements and character.attunements[attunement.key]
            if state ~= nil then
                looked = looked + 1
                if state then attuned = attuned + 1 end
            end
        end
        parts[#parts + 1] = ("%s: %d of %d character%s"):format(attunement.raid, attuned, looked,
            looked == 1 and "" or "s")
    end
    return #parts > 0 and table.concat(parts, ", ") or "none known"
end

-- Who wants a recipe found in the world ------------------------------------------------------------
-- A recipe item that doesn't bind when picked up can be handed on, and this addon already knows who
-- has which recipes and at what skill: enough to say, in the item's own tooltip (Tooltip.lua), who
-- already knows it and who could learn it.

--- At most this many names per line, the rest counted ("and 4 more"): a tooltip is not a list.
Core.MAX_RECIPE_NAMES = 8

--- Who would want a recipe item: `know`, the characters that have the recipe already, and `canUse`,
--- those with its profession at the skill it takes (and the specialization it requires) but not the
--- recipe. `recipe` is { profession = "Blacksmithing", skill = 250, key = "spell:9972",
--- specialization = "spell:9787" or nil }. Characters seen through a profession link are left out:
--- their own player's addon shares them, and they needn't be in the guild. Your own characters come
--- first, then by name. Each entry is { name, realm, own }.
function Core.recipeInterest(db, recipe)
    local know, canUse = {}, {}
    for _, character in pairs(db.characters or {}) do
        local profession = character.source ~= "link" and character.professions[recipe.profession]
        if profession then
            local entry = { name = character.name, realm = character.realm, own = character.source == "own" }
            if recipe.key and profession.recipes[recipe.key] then
                know[#know + 1] = entry
            elseif (profession.rank or 0) >= (recipe.skill or 0)
                -- A plan that requires a specialization ("Requires Armorsmith") is no use to
                -- anyone without it. One recorded by an addon before 1.5.0, which didn't record
                -- them, isn't listed for such a plan: it isn't known that they have it.
                and (not recipe.specialization or profession.recipes[recipe.specialization]) then
                canUse[#canUse + 1] = entry
            end
        end
    end
    local function first(a, b)
        if a.own ~= b.own then return a.own end
        if a.name ~= b.name then return a.name < b.name end
        return a.realm < b.realm
    end
    table.sort(know, first)
    table.sort(canUse, first)
    return { know = know, canUse = canUse }
end

--- One tooltip line's names: "Felbane Dir, Svajone", another realm's with its realm ("Dir (Other
--- Realm)"), at most Core.MAX_RECIPE_NAMES of them and "and 3 more" for the rest. Nil for nobody.
function Core.recipeNames(entries, realm)
    if #entries == 0 then return nil end
    local names = {}
    for i = 1, math.min(#entries, Core.MAX_RECIPE_NAMES) do
        local entry = entries[i]
        names[i] = entry.realm ~= realm and ("%s (%s)"):format(entry.name, entry.realm) or entry.name
    end
    local rest = #entries - #names
    if rest > 0 then return ("%s and %d more"):format(table.concat(names, ", "), rest) end
    return table.concat(names, ", ")
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

local ARRAY_FIELDS = { characters = true, professions = true, spells = true, items = true, trainers = true,
    entries = true, requires = true, specializations = true, attunements = true }

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
