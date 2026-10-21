-- Raidsort: what is done in the game. Sorting moves people a batch at a time and waits for the
-- raid to update before looking again (moving is not instant), until everyone is in place; then
-- it hands out the raid roles. Inviting asks everyone in the setup who isn't in the group yet.
-- Invite & Sort does both: it invites, then sorts again each time someone joins.

local _, ns = ...
local Core = ns.Core
local Raid = {}
ns.Raid = Raid

-- Rounds of moves before giving up (each round fixes most of the raid; a few are plenty).
local MAX_ROUNDS = 10
-- How long to wait for the raid to update after a round of moves, at most.
local ROUND_TIMEOUT = 2
-- After an update, wait this long for more of them before looking again.
local SETTLE = 0.3
-- Invite & Sort keeps sorting as people join for this long (invites expire after a while too).
local FOLLOW_TIME = 120
-- Auto-Invite invites everyone missing this often, from invitesAt until startsAt.
local AUTO_EVERY = 60

-- Classic and newer clients name these differently; use whichever this one has.
local InviteUnit = (C_PartyInfo and C_PartyInfo.InviteUnit) or InviteUnit
local ConvertToRaid = (C_PartyInfo and C_PartyInfo.ConvertToRaid) or ConvertToRaid

-- Master loot. Classic has GetLootMethod/SetLootMethod with "master"; newer clients have them in
-- C_PartyInfo with Enum.LootMethod numbers. Forever's client is built on the newer one and its
-- master looter window was removed (1.60.1 API changes), so master loot may not exist there at
-- all: setting it is tried, and a client without it is told, not an error.
local MASTER = Enum and Enum.LootMethod and (Enum.LootMethod.Masterlooter or Enum.LootMethod.MasterLooter)
local GetLootMethod = GetLootMethod or (C_PartyInfo and C_PartyInfo.GetLootMethod)
local SetLootMethod = SetLootMethod or (C_PartyInfo and C_PartyInfo.SetLootMethod)
local function isMasterLoot(method) return method == "master" or (MASTER ~= nil and method == MASTER) end

--- Makes `name` master looter; false when this client can't.
local function setMasterLooter(name)
    if not SetLootMethod then return false end
    local method = (SetLootMethod == _G.SetLootMethod) and "master" or MASTER
    if method == nil then return false end
    return (pcall(SetLootMethod, method, name))
end

local function say(message, ...)
    print("|cff33ff99Raidsort|r: " .. message:format(...))
end
Raid.say = say

local function list(names)
    return table.concat(names, ", ")
end

--- Everyone in the raid, as Core works with them.
local function readRoster()
    local roster = {}
    for index = 1, MAX_RAID_MEMBERS or 40 do
        local name, rank, group = GetRaidRosterInfo(index)
        if name then
            local unit = "raid" .. index
            roster[#roster + 1] = {
                index = index,
                unit = unit,
                name = name,
                group = group,
                rank = rank,
                mainTank = GetPartyAssignment and GetPartyAssignment("MAINTANK", unit) or false,
                mainAssist = GetPartyAssignment and GetPartyAssignment("MAINASSIST", unit) or false,
                mark = GetRaidTargetIndex(unit),
                isMe = UnitIsUnit(unit, "player"),
            }
        end
    end
    return roster
end

--- Who is master looter now: nil unless the loot method is master loot.
local function currentLootMaster()
    if not GetLootMethod then return nil end
    local ok, method, partyIndex, raidIndex = pcall(GetLootMethod)
    if not ok or not isMasterLoot(method) then return nil end
    if raidIndex then
        local name = GetRaidRosterInfo(raidIndex)
        return name
    end
    if partyIndex == 0 then return UnitName("player") end
    if partyIndex then return UnitName("party" .. partyIndex) end
    return nil
end

local sorting -- { setup, rounds, token } while a sort runs
local following -- { setup, members, token } while Invite & Sort waits for people to join

local function finish(roster, matched, plan)
    local me = { leader = UnitIsGroupLeader("player"), assist = UnitIsGroupAssistant("player") }
    local actions, skipped = Core.roleActions(roster, matched, me, currentLootMaster())
    local noMasterLoot = false
    for _, action in ipairs(actions) do
        local person = roster[action.i]
        if action.op == "assist" then
            PromoteToAssistant(person.unit)
        elseif (action.op == "mainTank" or action.op == "mainAssist") and SetPartyAssignment then
            SetPartyAssignment(action.op == "mainTank" and "MAINTANK" or "MAINASSIST", person.unit)
        elseif action.op == "mark" then
            SetRaidTarget(person.unit, action.mark)
        elseif action.op == "masterLooter" then
            noMasterLoot = not setMasterLooter(person.name)
        elseif action.op == "leader" then
            PromoteToLeader(person.unit)
        end
    end

    if following and #plan.missing > 0 then
        -- Still waiting for some to join: a short line, the full report once everyone is in.
        return say("Sorted; waiting for: %s.", list(plan.missing))
    end
    following = nil
    say("Raid sorted.")
    if #plan.missing > 0 then say("Not in the raid: %s.", list(plan.missing)) end
    if #plan.extras > 0 then say("Not in the setup (put in the free places): %s.", list(plan.extras)) end
    if #skipped > 0 then say("Only the raid leader can set: %s.", list(skipped)) end
    if noMasterLoot then say("Couldn't set master loot: this game doesn't seem to have it.") end
end

local function round()
    if not sorting then return end
    if not IsInRaid() then
        sorting = nil
        return say("Stopped: you're no longer in a raid.")
    end
    local roster = readRoster()
    local matched = Core.match(sorting.setup, roster)
    local plan = Core.plan(sorting.setup, roster, matched)
    local moves = Core.moves(roster, plan.desired)
    if #moves == 0 then
        sorting = nil
        return finish(roster, matched, plan)
    end
    sorting.rounds = sorting.rounds + 1
    if sorting.rounds > MAX_ROUNDS then
        sorting = nil
        return say("Couldn't get everyone into place; press Invite & Sort again.")
    end
    for _, move in ipairs(moves) do
        if move.op == "move" then
            SetRaidSubgroup(roster[move.i].index, move.group)
        else
            SwapRaidSubgroup(roster[move.i].index, roster[move.j].index)
        end
    end
    -- Look again once the raid has updated, or after a while if no update comes.
    Raid.lookAgain(ROUND_TIMEOUT)
end

--- Looks at the raid again after `delay` seconds, unless something asks sooner.
function Raid.lookAgain(delay)
    if not sorting then return end
    sorting.token = sorting.token + 1
    local token = sorting.token
    C_Timer.After(delay, function()
        if sorting and sorting.token == token then round() end
    end)
end

function Raid.sort(setup)
    if not IsInRaid() then return say("You need to be in a raid to sort it.") end
    if not (UnitIsGroupLeader("player") or UnitIsGroupAssistant("player")) then
        return say("Only the raid leader or an assistant can sort the raid.")
    end
    if InCombatLockdown() then return say("You can't sort the raid in combat.") end
    sorting = { setup = setup, rounds = 0, token = 0 }
    round()
end

-- Inviting: a party holds 5, so invite 4, make it a raid once someone joins, then the rest.
local inviting -- names still to invite

local function groupNames()
    local names = {}
    if IsInRaid() then
        for index = 1, MAX_RAID_MEMBERS or 40 do
            local name = GetRaidRosterInfo(index)
            if name then names[#names + 1] = { name = name } end
        end
    else
        names[1] = { name = UnitName("player") }
        for index = 1, 4 do
            local name = UnitName("party" .. index)
            if name then names[#names + 1] = { name = name } end
        end
    end
    return names
end

local function sendInvites()
    if not inviting then return end
    local room = IsInRaid() and #inviting or math.max(0, 5 - math.max(GetNumGroupMembers(), 1))
    local sent = {}
    while #sent < room and #inviting > 0 do
        local name = table.remove(inviting, 1)
        InviteUnit(name)
        sent[#sent + 1] = name
    end
    if #inviting == 0 then inviting = nil end
    return sent
end

--- Invites everyone in the setup who isn't in the group: false when it can't.
function Raid.invite(setup)
    if IsInGroup() and not (UnitIsGroupLeader("player") or UnitIsGroupAssistant("player")) then
        say("Only the leader or an assistant can invite.")
        return false
    end
    local people = groupNames()
    local matched = Core.match(setup, people)
    local inGroup = {}
    for _, member in pairs(matched) do inGroup[member] = true end
    inviting = {}
    for _, member in ipairs(setup.members) do
        if not inGroup[member] then inviting[#inviting + 1] = member.name end
    end
    if #inviting == 0 then
        inviting = nil
        say("Everyone in the setup is already in the group.")
        return true
    end
    local total = #inviting
    local sent = sendInvites()
    if inviting then
        say("Invited %d of %d; the rest once the group becomes a raid.", #sent, total)
    else
        say("Invited %d: %s.", #sent, list(sent))
    end
    return true
end

-- Auto-Invite ---------------------------------------------------------------------------------

local auto -- { setup, token } while on

-- The realm's clock (Unix seconds), else this computer's.
local function now() return (GetServerTime and GetServerTime()) or time() end

local function missingCount(setup)
    local matched = Core.match(setup, groupNames())
    local inGroup = 0
    for _ in pairs(matched) do inGroup = inGroup + 1 end
    return #setup.members - inGroup
end

local function autoTick(token)
    if not auto or auto.token ~= token then return end
    local setup = auto.setup
    local step = Core.autoInviteStep(setup, now(), missingCount(setup))
    if step == "started" then
        auto = nil
        say("The raid has started: Auto-Invite is off.")
    elseif step == "everyone" then
        auto = nil
        say("Everyone in the setup is in the group: Auto-Invite is off.")
    else
        if step == "invite" and not InCombatLockdown() then Raid.invite(setup) end
        C_Timer.After(AUTO_EVERY, function() autoTick(token) end)
    end
    if ns.UI and ns.UI.refresh then ns.UI.refresh() end
end

--- Whether Auto-Invite is on.
function Raid.autoInviting() return auto ~= nil end

--- Turns Auto-Invite on or off for the setup: every minute from its invitesAt until its startsAt
--- (or until everyone is in), it invites everyone missing.
function Raid.setAutoInvite(setup, on)
    if not on then
        if auto then say("Auto-Invite is off.") end
        auto = nil
        return
    end
    if not (setup and setup.invitesAt) then
        say("This setup has no invite time: export it again from an event with one.")
        return
    end
    local token = (auto and auto.token or 0) + 1
    auto = { setup = setup, token = token }
    local until_ = setup.startsAt and (" until %s"):format(date("%H:%M", setup.startsAt)) or ""
    say("Auto-Invite is on: invites every minute from %s%s.", date("%H:%M", setup.invitesAt), until_)
    autoTick(token)
end

--- Invites everyone missing, makes the group a raid, and sorts it: now if it's a raid already,
--- and again each time someone joins, until everyone is in or FOLLOW_TIME runs out.
function Raid.inviteAndSort(setup)
    if InCombatLockdown() then return say("You can't sort the raid in combat.") end
    if not Raid.invite(setup) then return end
    local token = (following and following.token or 0) + 1
    following = { setup = setup, members = -1, token = token }
    C_Timer.After(FOLLOW_TIME, function()
        if following and following.token == token then
            following = nil
            say("Stopped waiting for invites; press Invite & Sort again for anyone joining later.")
            -- One last sort, for the full report of who is missing and what couldn't be set.
            if IsInRaid() and not sorting then Raid.sort(setup) end
        end
    end)
    Raid.followUp()
end

--- Invite & Sort: sorts when the raid has someone new (not on every change, as sorting causes
--- changes of its own).
function Raid.followUp()
    if not following or sorting or not IsInRaid() or InCombatLockdown() then return end
    local members = GetNumGroupMembers()
    if members == following.members then return end
    following.members = members
    Raid.sort(following.setup)
end

--- The group changed: carry on sorting or inviting.
function Raid.onRosterUpdate()
    if sorting then Raid.lookAgain(SETTLE) end
    if inviting then
        if IsInGroup() and not IsInRaid() then
            if UnitIsGroupLeader("player") then ConvertToRaid() end
        elseif IsInRaid() then
            local sent = sendInvites()
            if sent and #sent > 0 then say("Invited %d more: %s.", #sent, list(sent)) end
        end
    end
    -- Once a sort ends (or none runs), sort for whoever just joined.
    if following then C_Timer.After(SETTLE, Raid.followUp) end
end
