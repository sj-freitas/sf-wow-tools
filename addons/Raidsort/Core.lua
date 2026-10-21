-- Raidsort: everything that doesn't touch the game. Reads a pasted raid setup, matches it to the
-- people in the raid, and works out which groups they go to and what to do to get them there.
-- Kept apart from the game API so it can be tested outside WoW (addons/dev/Raidsort).

local _, ns = ...
local Core = {}
ns.Core = Core

Core.MAX_GROUPS = 8
Core.GROUP_SIZE = 5

-- Raid target icons, by name and by the number SetRaidTarget takes.
Core.MARKS = {
    STAR = 1, CIRCLE = 2, DIAMOND = 3, TRIANGLE = 4,
    MOON = 5, SQUARE = 6, CROSS = 7, SKULL = 8,
}

-- What a player entry can say besides its name.
local FLAGS = { "leader", "assist", "masterLooter", "mainTank", "mainAssist" }
local ENTRY_KEYS = { name = true, mark = true }
for _, flag in ipairs(FLAGS) do ENTRY_KEYS[flag] = true end

-- Setup-wide keys: one player for leader and master looter, lists for the rest.
local SINGLE_KEYS = { leader = "leader", masterLooter = "masterLooter" }
local LIST_KEYS = { assists = "assist", mainTanks = "mainTank", mainAssists = "mainAssist" }

-- Text pasted from documents and chat often has curly quotes, which Lua doesn't read.
local QUOTES = {
    ["\226\128\156"] = '"', ["\226\128\157"] = '"',
    ["\226\128\152"] = "'", ["\226\128\153"] = "'",
}

local function compile(source)
    -- Run with an empty environment: the text can only build a table, not call anything.
    if setfenv then
        local chunk, err = loadstring(source, "=setup")
        if chunk then setfenv(chunk, {}) end
        return chunk, err
    end
    return load(source, "=setup", "t", {})
end

local function cleanError(err)
    return (tostring(err):gsub("^setup:%d+: ", ""))
end

--- A name as compared: lower case, without spaces, dashes, apostrophes or underscores.
function Core.key(name)
    return (name:lower():gsub("[%s%-'_]", ""))
end

--- The first word of a name, lower case ("dark" for "Dark Shivan" and "Dark-Realm").
function Core.firstWord(name)
    return name:lower():match("^[^%s%-]+") or name:lower()
end

local function markOf(value)
    if type(value) == "number" and value >= 1 and value <= 8 and value == math.floor(value) then
        return value
    end
    if type(value) == "string" then return Core.MARKS[value:upper()] end
    return nil
end

--- Reads a pasted setup. Returns the setup, or nil and what is wrong with it.
---
--- The text is a Lua table of up to 8 groups of up to 5 players. A player is a name, or a table
--- with the name and what they do in the raid:
---   { { "Dark Shivan", { name = "Wwolf Test", assist = true, mark = "skull" } }, { "Some Name" } }
--- Flags: leader, assist, masterLooter, mainTank, mainAssist (true/false); mark: a raid target
--- ("skull", "cross", … or 1-8). The same can be said for the whole setup instead:
---   leader = "Name", masterLooter = "Name", assists = { … }, mainTanks = { … }, mainAssists = { … }
--- and `event = "Name"` names it (Guild Assistant's "Export for addon" writes exactly this format).
--- `startsAt` and `invitesAt` (Unix seconds, from the same export) are when the raid starts and
--- when invites start: Auto-Invite invites from one until the other.
function Core.read(text)
    for from, to in pairs(QUOTES) do text = text:gsub(from, to) end
    if not text:find("%S") then return nil, "Paste a raid setup first." end

    local chunk, err = compile("return " .. text)
    if not chunk then return nil, "That isn't a Lua table: " .. cleanError(err) end
    local ok, value = pcall(chunk)
    if not ok then return nil, "That isn't a Lua table: " .. cleanError(value) end
    if type(value) ~= "table" then return nil, "The setup must be a table: { { ... }, { ... } }." end

    -- `event`: the event's name, from Guild Assistant's export (shown, nothing else).
    local setup = { groups = {}, members = {}, event = type(value.event) == "string" and value.event or nil }
    -- `startsAt`, `invitesAt`: Unix seconds (Auto-Invite).
    for _, key in ipairs({ "startsAt", "invitesAt" }) do
        local at = value[key]
        if at ~= nil then
            if type(at) ~= "number" or at ~= math.floor(at) or at < 0 then
                return nil, key .. " must be a time (Unix seconds)."
            end
            setup[key] = at
        end
    end
    if setup.startsAt and setup.invitesAt and setup.invitesAt >= setup.startsAt then
        return nil, "invitesAt must be before startsAt."
    end
    local byKey = {}

    local function add(group, raw)
        local entry = type(raw) == "string" and { name = raw } or raw
        if type(entry) ~= "table" then
            return ("Group %d: a player is a name or a table, not %s."):format(group, type(raw))
        end
        if entry.name == nil and type(entry[1]) == "string" then entry.name = entry[1] end
        local name = entry.name
        if type(name) ~= "string" or not name:find("%S") then
            return ("Group %d: a player has no name."):format(group)
        end
        name = name:match("^%s*(.-)%s*$")
        for k in pairs(entry) do
            if k ~= 1 and not ENTRY_KEYS[k] then
                return ("%s: unknown setting %q."):format(name, tostring(k))
            end
        end
        local key = Core.key(name)
        if byKey[key] then return ("%s is in the setup twice."):format(name) end
        local member = { name = name, key = key, first = Core.firstWord(name), group = group }
        for _, flag in ipairs(FLAGS) do
            local v = entry[flag]
            if v ~= nil and type(v) ~= "boolean" then
                return ("%s: %s must be true or false."):format(name, flag)
            end
            member[flag] = v == true
        end
        if entry.mark ~= nil then
            member.mark = markOf(entry.mark)
            if not member.mark then
                return ("%s: %q isn't a raid mark (skull, cross, square, moon, triangle, diamond, circle, star or 1-8).")
                    :format(name, tostring(entry.mark))
            end
        end
        byKey[key] = member
        setup.members[#setup.members + 1] = member
        table.insert(setup.groups[group], member)
        return nil
    end

    local groups = 0
    for k in pairs(value) do
        if type(k) == "number" then
            if k < 1 or k > Core.MAX_GROUPS or k ~= math.floor(k) then
                return nil, ("A raid has at most %d groups."):format(Core.MAX_GROUPS)
            end
            groups = math.max(groups, k)
        elseif k == "event" then
            if type(value.event) ~= "string" then return nil, "event must be the event's name." end
        elseif k == "startsAt" or k == "invitesAt" then
            -- Checked above.
        elseif not SINGLE_KEYS[k] and not LIST_KEYS[k] then
            return nil, ("Unknown setting %q."):format(tostring(k))
        end
    end
    for g = 1, Core.MAX_GROUPS do
        setup.groups[g] = {}
        local group = value[g]
        if group ~= nil then
            if type(group) ~= "table" then return nil, ("Group %d must be a table of players."):format(g) end
            if group.name ~= nil then
                return nil, ('Group %d: put each player in its own braces: { { name = "%s", ... } }.')
                    :format(g, tostring(group.name))
            end
            local count = 0
            for _ in pairs(group) do count = count + 1 end
            if count > Core.GROUP_SIZE then
                return nil, ("Group %d has %d players; a group holds %d."):format(g, count, Core.GROUP_SIZE)
            end
            for i = 1, count do
                if group[i] == nil then return nil, ("Group %d has a gap in it."):format(g) end
                local problem = add(g, group[i])
                if problem then return nil, problem end
            end
        end
    end
    if #setup.members == 0 then return nil, "The setup has no players." end

    local function find(name, setting)
        if type(name) ~= "string" then return nil, ("%s must be a player's name."):format(setting) end
        local member = byKey[Core.key(name)]
        if not member then return nil, ("%s: %s isn't in any group."):format(setting, name) end
        return member
    end
    for setting, flag in pairs(SINGLE_KEYS) do
        if value[setting] ~= nil then
            local member, problem = find(value[setting], setting)
            if not member then return nil, problem end
            member[flag] = true
        end
    end
    for setting, flag in pairs(LIST_KEYS) do
        local list = value[setting]
        if list ~= nil then
            if type(list) ~= "table" then return nil, ("%s must be a list of names."):format(setting) end
            for _, name in ipairs(list) do
                local member, problem = find(name, setting)
                if not member then return nil, problem end
                member[flag] = true
            end
        end
    end

    for _, flag in ipairs({ "leader", "masterLooter" }) do
        local count = 0
        for _, member in ipairs(setup.members) do
            if member[flag] then count = count + 1 end
        end
        if count > 1 then return nil, ("Only one player can be %s."):format(flag) end
    end
    return setup
end

--- Auto-Invite's next step at `now` (Unix seconds), with `missing` people of the setup not in the
--- group: "started" (the raid started: stop), "everyone" (all in: stop), "wait" (invites haven't
--- started yet) or "invite".
function Core.autoInviteStep(setup, now, missing)
    if setup.startsAt and now >= setup.startsAt then return "started" end
    if missing == 0 then return "everyone" end
    if setup.invitesAt and now < setup.invitesAt then return "wait" end
    return "invite"
end

--- How many groups and players a setup has, for showing it.
function Core.describe(setup)
    local groups = 0
    for g = 1, Core.MAX_GROUPS do
        if #setup.groups[g] > 0 then groups = groups + 1 end
    end
    local text = ("%d group%s, %d player%s"):format(groups, groups == 1 and "" or "s",
        #setup.members, #setup.members == 1 and "" or "s")
    if setup.event and setup.event:find("%S") then text = setup.event .. ": " .. text end
    return text
end

--- Pairs the people in the raid (`roster`, each with a `name`) with the setup's players: same
--- name ignoring case, spaces and dashes; failing that, the same first word when that is unique
--- on both sides (a name shown with a realm, "Name-Realm", still matches "Name").
--- Returns member by roster position.
function Core.match(setup, roster)
    local matched, used = {}, {}
    local byKey = {}
    for _, member in ipairs(setup.members) do byKey[member.key] = member end
    for i, person in ipairs(roster) do
        local member = byKey[Core.key(person.name)]
        if member and not used[member] then
            matched[i], used[member] = member, true
        end
    end

    local members, people = {}, {}
    for _, member in ipairs(setup.members) do
        if not used[member] then
            local list = members[member.first] or {}
            list[#list + 1] = member
            members[member.first] = list
        end
    end
    for i, person in ipairs(roster) do
        if not matched[i] then
            local first = Core.firstWord(person.name)
            local list = people[first] or {}
            list[#list + 1] = i
            people[first] = list
        end
    end
    for first, list in pairs(people) do
        local candidates = members[first]
        if #list == 1 and candidates and #candidates == 1 then
            matched[list[1]] = candidates[1]
        end
    end
    return matched
end

--- Where everyone in the raid should be. The setup's players go to their group; people who aren't
--- in the setup stay where they are if there is room, otherwise fill the free places from the
--- last group back. Returns { desired = group by roster position, missing = setup players not in
--- the raid, extras = names of people not in the setup }.
function Core.plan(setup, roster, matched)
    local desired, room, extras = {}, {}, {}
    for g = 1, Core.MAX_GROUPS do room[g] = Core.GROUP_SIZE end
    local present = {}
    for i in ipairs(roster) do
        local member = matched[i]
        if member then
            desired[i] = member.group
            room[member.group] = room[member.group] - 1
            present[member] = true
        end
    end
    local waiting = {}
    for i, person in ipairs(roster) do
        if not matched[i] then
            extras[#extras + 1] = person.name
            if room[person.group] and room[person.group] > 0 then
                desired[i] = person.group
                room[person.group] = room[person.group] - 1
            else
                waiting[#waiting + 1] = i
            end
        end
    end
    for _, i in ipairs(waiting) do
        for g = Core.MAX_GROUPS, 1, -1 do
            if room[g] > 0 then
                desired[i] = g
                room[g] = room[g] - 1
                break
            end
        end
    end
    local missing = {}
    for _, member in ipairs(setup.members) do
        if not present[member] then missing[#missing + 1] = member.name end
    end
    return { desired = desired, missing = missing, extras = extras }
end

--- The moves that put everyone where `desired` says, given where they are now (`roster`, each
--- with a `group`): { op = "move", i = position, group = g } into a group with room, or
--- { op = "swap", i = position, j = position } with someone in a full group who doesn't belong
--- there. Worked out one after the other on a copy, as the game will apply them.
function Core.moves(roster, desired)
    local at, count = {}, {}
    for g = 1, Core.MAX_GROUPS do count[g] = 0 end
    for i, person in ipairs(roster) do
        at[i] = person.group
        count[person.group] = count[person.group] + 1
    end
    local moves = {}
    for i in ipairs(roster) do
        local target = desired[i]
        if target and at[i] ~= target then
            if count[target] < Core.GROUP_SIZE then
                moves[#moves + 1] = { op = "move", i = i, group = target }
                count[at[i]] = count[at[i]] - 1
                count[target] = count[target] + 1
                at[i] = target
            else
                -- Someone in the full group who should be elsewhere; best, where i is now.
                local other
                for j in ipairs(roster) do
                    if at[j] == target and desired[j] ~= target then
                        if desired[j] == at[i] then other = j break end
                        other = other or j
                    end
                end
                if other then
                    moves[#moves + 1] = { op = "swap", i = i, j = other }
                    at[i], at[other] = target, at[i]
                end
            end
        end
    end
    return moves
end

--- What to change about raid roles (assist, main tank and assist, marks, master looter, leader)
--- to match the setup. `roster` entries say what each person has now (rank 2 leader, 1 assist,
--- mainTank, mainAssist, mark, isMe); `me` what the one sorting may do (leader, assist), and
--- `lootMaster` who is master looter now (nil when it isn't master loot). Returns the actions, the
--- leader change last (it takes away the right to do the rest), and what couldn't be done.
function Core.roleActions(roster, matched, me, lootMaster)
    local actions, skipped = {}, {}
    local canManage = me.leader or me.assist
    local newLeader
    for i, person in ipairs(roster) do
        local member = matched[i]
        if member then
            if member.assist and (person.rank or 0) < 1 then
                if me.leader then
                    actions[#actions + 1] = { op = "assist", i = i }
                else
                    skipped[#skipped + 1] = "assist for " .. person.name
                end
            end
            for _, flag in ipairs({ "mainTank", "mainAssist" }) do
                if member[flag] and not person[flag] then
                    if canManage then
                        actions[#actions + 1] = { op = flag, i = i }
                    else
                        skipped[#skipped + 1] = flag .. " for " .. person.name
                    end
                end
            end
            if member.mark and person.mark ~= member.mark then
                actions[#actions + 1] = { op = "mark", i = i, mark = member.mark }
            end
            if member.masterLooter and not (lootMaster and Core.key(lootMaster) == Core.key(person.name)) then
                if me.leader then
                    actions[#actions + 1] = { op = "masterLooter", i = i }
                else
                    skipped[#skipped + 1] = "master looter " .. person.name
                end
            end
            if member.leader and (person.rank or 0) < 2 then newLeader = i end
        end
    end
    if newLeader then
        if me.leader then
            actions[#actions + 1] = { op = "leader", i = newLeader }
        else
            skipped[#skipped + 1] = "leader " .. roster[newLeader].name
        end
    end
    return actions, skipped
end
