-- Tests of Raidsort/Core.lua, outside the game.
-- Run with `npm test` in addons/ (or any Lua 5.1+ from addons/: lua dev/Raidsort/core.spec.lua).

local ns = {}
assert(loadfile("Raidsort/Core.lua"))("Raidsort", ns)
local Core = ns.Core

-- `readfile` when run by npm test (fengari has no io.open), io.open in a real Lua.
local function read(path)
    if readfile then return readfile(path) end
    local file = assert(io.open(path))
    local text = file:read("*a")
    file:close()
    return text
end

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

local function fails(text, pattern)
    local setup, err = Core.read(text)
    eq(setup, nil, "setup of " .. text)
    if not err:find(pattern, 1, true) then error(("%q doesn't mention %q"):format(err, pattern), 2) end
end

-- Reading ---------------------------------------------------------------------------------------

it("reads plain names into groups", function()
    local setup = assert(Core.read('{ { "Dark Shivan", "Wwolf Test" }, { "Some Name" } }'))
    eq(#setup.members, 3, "members")
    eq(setup.groups[1][2].name, "Wwolf Test")
    eq(setup.groups[2][1].group, 2)
    eq(#setup.groups[8], 0, "group 8")
    eq(Core.describe(setup), "2 groups, 3 players")
end)

it("reads curly quotes as pasted from documents", function()
    local setup = assert(Core.read("{{\226\128\156Dark Shivan\226\128\157, \226\128\156Wwolf Test\226\128\157}, {\226\128\156Some Name\226\128\157}}"))
    eq(setup.members[3].name, "Some Name")
end)

it("reads raid roles on players and for the whole setup", function()
    local setup = assert(Core.read([[{
        { "Lead", { name = "Tank", mainTank = true, mark = "skull" }, { "Healer", assist = true } },
        { { name = "Looter", mark = 7 } },
        masterLooter = "looter", assists = { "Tank" }, leader = "Lead", mainAssists = { "Healer" },
    }]]))
    local by = {}
    for _, m in ipairs(setup.members) do by[m.name] = m end
    eq(by.Lead.leader, true, "leader")
    eq(by.Tank.mainTank, true, "main tank")
    eq(by.Tank.assist, true, "assist from the list")
    eq(by.Tank.mark, 8, "skull")
    eq(by.Healer.assist, true, "assist on the player")
    eq(by.Healer.mainAssist, true, "main assist")
    eq(by.Looter.masterLooter, true, "master looter, matched ignoring case")
    eq(by.Looter.mark, 7, "cross by number")
    eq(by.Healer.leader, false, "flags default to false")
end)

it("refuses what isn't a setup, saying why", function()
    fails("", "Paste a raid setup")
    fails("{ { 'A' }", "isn't a Lua table")
    fails("42", "must be a table")
    fails("{}", "no players")
    fails("{ {'A','B','C','D','E','F'} }", "Group 1 has 6 players")
    fails("{ {'A'}, [9] = {'B'} }", "at most 8 groups")
    fails("{ {'A'}, {'a'} }", "twice")
    fails("{ { { name = 'A', asist = true } } }", 'unknown setting "asist"')
    fails("{ { { name = 'A', assist = 'yes' } } }", "assist must be true or false")
    fails("{ { { name = 'A', mark = 'banana' } } }", "isn't a raid mark")
    fails("{ {'A'}, leader = 'B' }", "B isn't in any group")
    fails("{ { { name = 'A', leader = true }, { name = 'B', leader = true } } }", "Only one player can be leader")
    fails("{ {'A'}, colour = 'red' }", 'Unknown setting "colour"')
    fails("{ { name = 'A' } }", "its own braces")
end)

it("can't run code from the pasted text", function()
    fails("{ { print('hi') } }", "isn't a Lua table")
    fails("{ { os.exit() } }", "isn't a Lua table")
end)

it("reads Guild Assistant's export (export.fixture.lua, written by the backoffice's addonExport.ts)", function()
    local setup = assert(Core.read(read("dev/Raidsort/export.fixture.lua")))
    eq(setup.event, "Molten Core", "event")
    eq(Core.describe(setup), "Molten Core: 2 groups, 4 players")
    eq(#setup.groups[1], 3, "group 1")
    eq(#setup.groups[2], 0, "group 2 is empty")
    eq(setup.groups[3][1].name, 'Some "Quoted" Name')
    eq(setup.groups[1][1].leader, true, "leader")
    eq(setup.groups[1][2].assist, true, "assist")
    eq(setup.groups[3][1].masterLooter, true, "master looter")
    eq(setup.startsAt, 1792519200, "start")
    eq(setup.invitesAt, 1792518300, "invites")
end)

it("refuses an event that isn't a name", function()
    fails("{ {'A'}, event = 5 }", "event must be")
end)

it("reads when the raid and its invites start, and refuses times that make no sense", function()
    local setup = assert(Core.read("{ {'A'}, startsAt = 2000, invitesAt = 1100 }"))
    eq(setup.startsAt, 2000)
    eq(setup.invitesAt, 1100)
    eq(assert(Core.read("{ {'A'} }")).invitesAt, nil, "both optional")
    fails("{ {'A'}, startsAt = 'tonight' }", "startsAt must be a time")
    fails("{ {'A'}, startsAt = 1000, invitesAt = 1000 }", "invitesAt must be before startsAt")
end)

it("works out Auto-Invite's step: wait, invite, or stop when all in or started", function()
    local setup = { startsAt = 2000, invitesAt = 1100 }
    eq(Core.autoInviteStep(setup, 1000, 3), "wait", "before invites")
    eq(Core.autoInviteStep(setup, 1100, 3), "invite", "from the invite time")
    eq(Core.autoInviteStep(setup, 1500, 0), "everyone", "everyone in")
    eq(Core.autoInviteStep(setup, 2000, 3), "started", "the raid started")
    eq(Core.autoInviteStep({ invitesAt = 1100 }, 9999, 1), "invite", "no start: until all in")
end)

-- Matching --------------------------------------------------------------------------------------

it("matches names ignoring case, spaces and dashes, then by a unique first word", function()
    local setup = assert(Core.read('{ { "Dark Shivan", "Wwolf", "Kim", "Kimepo" } }'))
    local roster = {
        { name = "dark-shivan" },   -- same name, written differently
        { name = "Wwolf-Realm" },   -- shown with a realm
        { name = "Kim" },
        { name = "Stranger" },
    }
    local matched = Core.match(setup, roster)
    eq(matched[1] and matched[1].name, "Dark Shivan")
    eq(matched[2] and matched[2].name, "Wwolf")
    eq(matched[3] and matched[3].name, "Kim", "exact name wins over Kimepo")
    eq(matched[4], nil, "stranger")
end)

it("doesn't guess when a first word is ambiguous", function()
    local setup = assert(Core.read('{ { "Dark Shivan", "Dark Moon" } }'))
    local matched = Core.match(setup, { { name = "Dark-Realm" } })
    eq(matched[1], nil)
end)

-- Planning and moving ---------------------------------------------------------------------------

-- Applies moves as the game does, failing on one it wouldn't allow (a move into a full group).
local function apply(roster, moves)
    local count = {}
    for g = 1, 8 do count[g] = 0 end
    for _, p in ipairs(roster) do count[p.group] = count[p.group] + 1 end
    for _, move in ipairs(moves) do
        if move.op == "move" then
            local p = roster[move.i]
            assert(count[move.group] < 5, "moved into a full group " .. move.group)
            count[p.group] = count[p.group] - 1
            count[move.group] = count[move.group] + 1
            p.group = move.group
        else
            local a, b = roster[move.i], roster[move.j]
            assert(a.group ~= b.group, "swap within a group")
            a.group, b.group = b.group, a.group
        end
    end
    for g = 1, 8 do assert(count[g] <= 5, "group " .. g .. " overfull") end
end

local function sortOnce(setup, roster)
    local matched = Core.match(setup, roster)
    local plan = Core.plan(setup, roster, matched)
    local moves = Core.moves(roster, plan.desired)
    apply(roster, moves)
    for i, p in ipairs(roster) do eq(p.group, plan.desired[i], p.name .. "'s group") end
    eq(#Core.moves(roster, plan.desired), 0, "moves after sorting")
    return plan, moves
end

it("sorts a full raid in one round, with swaps where groups are full", function()
    local lines, roster = {}, {}
    for g = 1, 8 do
        local names = {}
        for s = 1, 5 do
            local name = ("P%d_%d"):format(g, s)
            names[#names + 1] = ("%q"):format(name)
            -- Everyone starts in the "wrong" group: reversed.
            roster[#roster + 1] = { name = name, group = 9 - g }
        end
        lines[#lines + 1] = "{" .. table.concat(names, ",") .. "}"
    end
    local setup = assert(Core.read("{" .. table.concat(lines, ",") .. "}"))
    local _, moves = sortOnce(setup, roster)
    for _, m in ipairs(moves) do eq(m.op, "swap", "full raid moves") end
end)

it("keeps people who aren't in the setup where they are when there is room", function()
    local setup = assert(Core.read('{ { "A", "B" } }'))
    local roster = { { name = "A", group = 3 }, { name = "X", group = 2 }, { name = "B", group = 1 } }
    local plan = sortOnce(setup, roster)
    eq(roster[2].group, 2, "X stays")
    eq(plan.extras[1], "X")
end)

it("moves people who aren't in the setup out of a group the setup fills, to the back", function()
    local setup = assert(Core.read('{ { "A", "B", "C", "D", "E" } }'))
    local roster = {
        { name = "X", group = 1 }, { name = "A", group = 1 }, { name = "B", group = 2 },
        { name = "C", group = 2 }, { name = "D", group = 3 }, { name = "E", group = 3 },
    }
    sortOnce(setup, roster)
    eq(roster[1].group, 8, "X goes to the last group")
end)

it("lists who in the setup isn't in the raid", function()
    local setup = assert(Core.read('{ { "A", "Gone" }, { "Away" } }'))
    local plan = sortOnce(setup, { { name = "A", group = 4 } })
    eq(table.concat(plan.missing, ","), "Gone,Away")
end)

it("sorts random raids correctly", function()
    math.randomseed(7)
    for _ = 1, 300 do
        -- A setup of up to 40 players in random groups, and a raid with some of them and others.
        local groups, names = {}, {}
        for g = 1, 8 do groups[g] = {} end
        local size = math.random(1, 40)
        for n = 1, size do
            local g
            repeat g = math.random(1, 8) until #groups[g] < 5
            groups[g][#groups[g] + 1] = ("%q"):format("N" .. n)
            names[#names + 1] = "N" .. n
        end
        local parts = {}
        for g = 1, 8 do parts[g] = "{" .. table.concat(groups[g], ",") .. "}" end
        local setup = assert(Core.read("{" .. table.concat(parts, ",") .. "}"))

        local roster, count = {}, {}
        for g = 1, 8 do count[g] = 0 end
        local function join(name)
            local g
            repeat g = math.random(1, 8) until count[g] < 5
            count[g] = count[g] + 1
            roster[#roster + 1] = { name = name, group = g }
        end
        for _, name in ipairs(names) do
            if math.random() < 0.8 and #roster < 40 then join(name) end
        end
        for e = 1, math.random(0, 6) do
            if #roster < 40 then join("Extra" .. e) end
        end
        sortOnce(setup, roster)
    end
end)

-- Raid roles ------------------------------------------------------------------------------------

it("works out raid roles, leader last, skipping what an assistant can't do", function()
    local setup = assert(Core.read([[{ {
        { name = "Lead", leader = true }, { name = "Tank", mainTank = true, mark = "skull" },
        { name = "Loot", masterLooter = true, assist = true }, "Me",
    } }]]))
    local roster = {
        { name = "Me", rank = 2, isMe = true }, { name = "Lead", rank = 0 },
        { name = "Tank", rank = 0, mark = 8 }, { name = "Loot", rank = 1 },
    }
    local matched = Core.match(setup, roster)

    local actions, skipped = Core.roleActions(roster, matched, { leader = true }, nil)
    local ops = {}
    for _, a in ipairs(actions) do ops[#ops + 1] = a.op .. ":" .. roster[a.i].name end
    eq(table.concat(ops, " "), "mainTank:Tank masterLooter:Loot leader:Lead", "leader's actions")
    eq(#skipped, 0, "nothing skipped")

    actions, skipped = Core.roleActions(roster, matched, { assist = true }, "Loot")
    ops = {}
    for _, a in ipairs(actions) do ops[#ops + 1] = a.op .. ":" .. roster[a.i].name end
    eq(table.concat(ops, " "), "mainTank:Tank", "assistant's actions")
    eq(table.concat(skipped, ", "), "leader Lead", "assistant can't change the leader")
end)

print(("%d passed, %d failed"):format(passed, failed))
if failed > 0 then error(failed .. " failed", 0) end
