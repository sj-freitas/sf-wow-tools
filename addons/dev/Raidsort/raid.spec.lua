-- Tests of Raidsort/Raid.lua against a fake raid (the game's raid API, timers and events).
-- Run with `npm test` in addons/ (or any Lua 5.1+ from addons/: lua dev/Raidsort/raid.spec.lua).

local raid, timers, later, calls, printed = {}, {}, {}, {}, {}
local function reset(members)
    raid, timers, later, calls, printed = {}, {}, {}, {}, {}
    for i, m in ipairs(members) do raid[i] = { name = m[1], group = m[2], rank = m[3] or 0 } end
end

-- The game API Raid.lua uses -------------------------------------------------------------------
MAX_RAID_MEMBERS = 40
-- Long timers (giving up after minutes) wait in `later`, for a test to fire them.
C_Timer = {
    After = function(delay, fn)
        local queue = delay >= 60 and later or timers
        queue[#queue + 1] = fn
    end,
}
function GetNumGroupMembers() return #raid end
function InviteUnit(name) calls[#calls + 1] = "InviteUnit:" .. name end
function print(text) printed[#printed + 1] = text end
function IsInRaid() return true end
function IsInGroup() return true end
function InCombatLockdown() return false end
function UnitIsGroupLeader() return raid[1].rank == 2 end
function UnitIsGroupAssistant() return raid[1].rank == 1 end
function UnitIsUnit(unit, other) return unit == "raid1" and other == "player" end
function GetRaidRosterInfo(i)
    local m = raid[i]
    if m then return m.name, m.rank, m.group end
end
function GetRaidTargetIndex() return nil end
function GetPartyAssignment() return false end
function GetLootMethod() return "group" end
local function count(g)
    local n = 0
    for _, m in ipairs(raid) do if m.group == g then n = n + 1 end end
    return n
end
function SetRaidSubgroup(i, g)
    calls[#calls + 1] = "move"
    if count(g) < 5 then raid[i].group = g end -- the game ignores a move into a full group
end
function SwapRaidSubgroup(i, j)
    calls[#calls + 1] = "swap"
    raid[i].group, raid[j].group = raid[j].group, raid[i].group
end
for _, name in ipairs({ "PromoteToAssistant", "PromoteToLeader", "SetPartyAssignment", "SetRaidTarget" }) do
    _G[name] = function(...) calls[#calls + 1] = name .. ":" .. table.concat({ ... }, ",") end
end
function SetLootMethod(method, name) calls[#calls + 1] = "SetLootMethod:" .. method .. "," .. name end

local ns = {}
assert(loadfile("Raidsort/Core.lua"))("Raidsort", ns)
assert(loadfile("Raidsort/Raid.lua"))("Raidsort", ns)
local Core, Raid = ns.Core, ns.Raid

-- Runs what is waiting, as the game would: the raid updates after moves, then timers fire.
local function runGame()
    for _ = 1, 50 do
        if #timers == 0 then return end
        Raid.onRosterUpdate()
        local due = timers
        timers = {}
        for _, fn in ipairs(due) do fn() end
    end
    error("never finished")
end

local passed, failed = 0, 0
local function it(name, fn)
    local ok, err = pcall(fn)
    if ok then passed = passed + 1 else failed = failed + 1; io.write("FAIL ", name, "\n     ", tostring(err), "\n") end
end
local function has(list, text)
    for _, item in ipairs(list) do if item:find(text, 1, true) then return true end end
    error(("no %q in:\n  %s"):format(text, table.concat(list, "\n  ")), 2)
end

it("sorts a raid over rounds and then hands out the roles", function()
    reset({ { "Me", 1, 2 }, { "Tank", 2 }, { "Healer", 2 }, { "Loot", 3 }, { "Dps", 1 }, { "Stranger", 1 } })
    local setup = assert(Core.read([[{
        { "Me", { name = "Tank", mainTank = true, mark = "skull" } },
        { { name = "Healer", assist = true }, "Dps", "Loot" },
        masterLooter = "Loot", leader = "Healer",
    }]]))
    Raid.sort(setup)
    runGame()
    local where = {}
    for _, m in ipairs(raid) do where[m.name] = m.group end
    assert(where.Me == 1 and where.Tank == 1, "group 1")
    assert(where.Healer == 2 and where.Dps == 2, "group 2")
    has(printed, "Raid sorted.")
    has(printed, "Not in the setup (put in the free places): Stranger")
    has(calls, "PromoteToAssistant:raid3")
    has(calls, "SetPartyAssignment:MAINTANK,raid2")
    has(calls, "SetRaidTarget:raid2,8")
    has(calls, "SetLootMethod:master,Loot")
    assert(calls[#calls] == "PromoteToLeader:raid3", "the leader changes last, got " .. calls[#calls])
end)

it("only changes the loot when the master looter is in the raid", function()
    reset({ { "Me", 1, 2 }, { "Other", 1 } })
    Raid.sort(assert(Core.read('{ { "Me", "Other", "Looter" }, masterLooter = "Looter", assists = { "Other" } }')))
    runGame()
    has(printed, "Not in the raid: Looter")
    has(calls, "PromoteToAssistant:raid2")
    for _, call in ipairs(calls) do assert(not call:find("SetLootMethod"), "loot changed: " .. call) end
end)

it("says so when the game has no master loot", function()
    reset({ { "Me", 1, 2 }, { "Looter", 1 } })
    local real = SetLootMethod
    SetLootMethod = function() error("no master loot here") end
    assert(loadfile("Raidsort/Raid.lua"))("Raidsort", ns) -- picks up the client's functions again
    Raid = ns.Raid
    Raid.sort(assert(Core.read('{ { "Me", "Looter" }, masterLooter = "Looter" }')))
    runGame()
    has(printed, "Raid sorted.")
    has(printed, "Couldn't set master loot")
    SetLootMethod = real
end)

it("refuses to sort for someone who isn't leader or assistant", function()
    reset({ { "Me", 1, 0 }, { "Other", 2, 2 } })
    Raid.sort(assert(Core.read('{ { "Other" } }')))
    has(printed, "Only the raid leader or an assistant")
    assert(#calls == 0, "nothing moved")
end)

it("Invite & Sort invites who is missing and sorts again as they join", function()
    reset({ { "Me", 2, 2 }, { "Tank", 1 } })
    Raid.inviteAndSort(assert(Core.read('{ { "Me", "Tank", "Healer" } }')))
    has(calls, "InviteUnit:Healer")
    runGame()
    has(printed, "Sorted; waiting for: Healer")
    assert(raid[1].group == 1, "sorted before everyone is in")
    raid[3] = { name = "Healer", group = 4, rank = 0 }
    Raid.onRosterUpdate()
    runGame()
    assert(raid[3].group == 1, "the one who joined is sorted too")
    has(printed, "Raid sorted.")
    assert(not printed[#printed]:find("Not in the raid"), "everyone is in")
end)

it("Invite & Sort stops waiting after a while, with a last full sort", function()
    reset({ { "Me", 1, 2 } })
    Raid.inviteAndSort(assert(Core.read('{ { "Me", "Late" } }')))
    runGame()
    for _, fn in ipairs(later) do fn() end
    runGame()
    has(printed, "Stopped waiting for invites")
    has(printed, "Not in the raid: Late")
end)

io.write(("%d passed, %d failed\n"):format(passed, failed))
if failed > 0 then error(failed .. " failed", 0) end
