-- Tests of GuildAssistantProfessions' guild sharing (Sync.lua with Core, Scan and Main): several
-- players' addons, each in its own fake game, talking over a fake guild channel with a fake clock.
-- Run with `npm test` in addons/ (or lua dev/GuildAssistantProfessions/sync.spec.lua).

local realPrint = print
local passed, failed = 0, 0
local function it(name, fn)
    local ok, err = pcall(fn)
    if ok then
        passed = passed + 1
    else
        failed = failed + 1
        realPrint("FAIL " .. name .. "\n     " .. tostring(err))
    end
end
local function eq(actual, expected, what)
    if actual ~= expected then
        error(("%s: expected %s, got %s"):format(what or "value", tostring(expected), tostring(actual)), 2)
    end
end

-- The world: a clock with timers (C_Timer.After), and the guilds' addon channels.
local clock, timers, players, sent
local function reset()
    clock, timers, players, sent = 1792000000, {}, {}, {}
    math.randomseed(7)
end
local function run(seconds)
    local stop = clock + seconds
    while true do
        table.sort(timers, function(a, b) return a.at < b.at end)
        local next = timers[1]
        if not next or next.at > stop then break end
        table.remove(timers, 1)
        clock = math.max(clock, next.at)
        next.fn()
    end
    clock = stop
end

--- A player logged in with the addon: `guild` nil for none; `last` a last name (WoW Forever's);
--- `saved` the saved data it logs in with.
local function player(name, guild, last, saved)
    local env = setmetatable({}, { __index = _G })
    env.GuildAssistantProfessionsDB = saved
    local me = { name = name, guild = guild, env = env, chat = {} }
    env.print = function(text) me.chat[#me.chat + 1] = tostring(text) end
    env.CreateFrame = function()
        local frame = { events = {} }
        function frame:RegisterEvent(event) self.events[event] = true end
        function frame:UnregisterEvent(event) self.events[event] = nil end
        function frame:SetScript(_, handler) self.onEvent = handler end
        me.frame = frame
        return frame
    end
    env.SlashCmdList = {}
    env.UnitClass = function() return "Mage", "MAGE" end
    env.UnitName = function() return name, last end
    env.GetRealmName = function() return "Test Realm" end
    env.IsInGuild = function() return me.guild ~= nil end
    env.GetGuildInfo = function() return me.guild end
    env.GetServerTime = function() return clock end
    env.time, env.date = function() return clock end, os.date
    env.GetNumSkillLines = function() return 0 end
    env.GetSkillLineInfo = function() end
    env.C_Timer = { After = function(seconds, fn) timers[#timers + 1] = { at = clock + seconds, fn = fn } end }
    env.C_ChatInfo = {
        RegisterAddonMessagePrefix = function(prefix) me.prefix = prefix end,
        SendAddonMessage = function(prefix, message, channel)
            sent[#sent + 1] = { from = name, message = message }
            -- The guild channel: everyone else online in the same guild, who registered the prefix.
            for _, other in ipairs(players) do
                if other ~= me and other.online and other.guild == me.guild and other.prefix == prefix then
                    other.frame.onEvent(other.frame, "CHAT_MSG_ADDON", prefix, message, channel,
                        name .. "-Test Realm")
                end
            end
        end,
    }
    local ns = {}
    for _, file in ipairs({ "Core", "Scan", "Sync", "Main" }) do
        local chunk = assert(loadfile("GuildAssistantProfessions/" .. file .. ".lua", "t", env))
        chunk("GuildAssistantProfessions", ns)
    end
    me.ns, me.online = ns, true
    players[#players + 1] = me
    me.frame.onEvent(me.frame, "ADDON_LOADED", "GuildAssistantProfessions")
    return me
end

-- This character learned a profession with some recipes (as a scan would), then it is shared.
local function learn(p, profession, ...)
    local character = p.ns.Scan.current()
    local list = {}
    for _, id in ipairs({ ... }) do list[#list + 1] = { kind = "spell", id = id } end
    p.ns.Core.addRecipes(character, profession, 100, 300, list, clock)
    p.ns.Sync.ownChanged()
end

local function knows(p, name, profession, id)
    local character = p.ns.db.characters[name .. "-Test Realm"]
    if not character then return false end
    local entry = character.professions[profession]
    return entry ~= nil and (id == nil or entry.recipes["spell:" .. id] == true)
end

-- How many times `name` sent `whose` character (counting each message once, by its first piece).
local function sentBy(name, whose)
    local count = 0
    for _, s in ipairs(sent) do
        if s.from == name and s.message:match("^C[^\t]+\t1\t%d+\t" .. whose .. ";") then
            count = count + 1
        end
    end
    return count
end

it("sends a character's professions to the guild, quietly", function()
    reset()
    local luna = player("Luna", "Relic Hunters")
    local kael = player("Kael", "Relic Hunters")
    run(60)
    learn(luna, "Tailoring", 2387, 3914)
    run(30)
    eq(knows(kael, "Luna", "Tailoring", 3914), true, "Kael has Luna's Tailoring")
    eq(kael.ns.db.characters["Luna-Test Realm"].source, "guild", "as a guild character")
    assert(kael.ns.db.export:find('"name":"Luna"', 1, true), "and in Kael's export")
    for _, line in ipairs(kael.chat) do
        assert(not line:find("Luna", 1, true), "nothing said in Kael's chat: " .. line)
    end
end)

it("catches up a guildmate who logs in later, through anyone who has it", function()
    reset()
    local luna = player("Luna", "Relic Hunters")
    local kael = player("Kael", "Relic Hunters")
    run(60)
    learn(luna, "Tailoring", 2387)
    run(30)
    luna.online = false -- Luna logs out
    local mira = player("Mira", "Relic Hunters")
    run(120)
    eq(knows(mira, "Luna", "Tailoring", 2387), true, "Mira got Luna's through Kael")
    eq(knows(mira, "Kael", nil), false, "Kael has no professions: nothing to send")
end)

it("answers a newcomer once, not once per guildmate", function()
    reset()
    local luna = player("Luna", "Relic Hunters")
    local kael = player("Kael", "Relic Hunters")
    local sol = player("Sol", "Relic Hunters")
    run(60)
    learn(luna, "Tailoring", 2387)
    run(30)
    luna.online = false
    sent = {}
    player("Mira", "Relic Hunters")
    run(120)
    eq(sentBy("Kael", "Luna") + sentBy("Sol", "Luna"), 1, "Luna sent by one of them")
end)

it("doesn't share with another guild, or outside one", function()
    reset()
    local luna = player("Luna", "Relic Hunters")
    local other = player("Kael", "Other Guild")
    local none = player("Sol", nil)
    run(60)
    learn(luna, "Tailoring", 2387)
    run(30)
    eq(knows(other, "Luna", "Tailoring"), false, "another guild")
    eq(knows(none, "Luna", "Tailoring"), false, "no guild")
end)

it("spreads a profession being replaced: the newer copy wins in every addon", function()
    reset()
    local luna = player("Luna", "Relic Hunters")
    local kael = player("Kael", "Relic Hunters")
    run(60)
    learn(luna, "Blacksmithing", 2660)
    run(30)
    eq(knows(kael, "Luna", "Blacksmithing"), true, "Kael has Blacksmithing")
    -- Luna unlearns Blacksmithing and learns Engineering (what a login's skill list would say).
    run(60)
    local character = luna.ns.Scan.current()
    luna.ns.Core.setProfessions(character, { { name = "Engineering", rank = 1, max = 75 } }, clock)
    luna.ns.Sync.ownChanged()
    run(30)
    eq(knows(kael, "Luna", "Blacksmithing"), false, "Blacksmithing gone from Kael's copy too")
    eq(knows(kael, "Luna", "Engineering"), true, "Engineering instead")
end)

it("doesn't bring back a character's first-name entry from a guildmate's old copy", function()
    reset()
    local kael = player("Kael", "Relic Hunters")
    -- What Kael got from Luna's 1.0.2, which saved her under her first name alone.
    kael.ns.db.characters["Luna-Test Realm"] = { name = "Luna", realm = "Test Realm", class = "MAGE",
        source = "guild", guild = "Relic Hunters", updated = clock,
        professions = { Tailoring = { rank = 1, max = 75, recipes = { ["spell:2387"] = true } } } }
    local luna = player("Luna", "Relic Hunters", "Moonbrook")
    run(120)
    eq(luna.ns.db.characters["Luna-Test Realm"], nil, "not kept by Luna")
    learn(luna, "Tailoring", 2387)
    run(30)
    eq(knows(kael, "Luna Moonbrook", "Tailoring", 2387), true, "Luna shared under her full name")
end)

it("says what was shared and received in /ga-prof status", function()
    reset()
    local luna = player("Luna", "Relic Hunters")
    local kael = player("Kael", "Relic Hunters")
    run(60)
    learn(luna, "Tailoring", 2387)
    run(30)
    kael.env.SlashCmdList.GAPROF("status")
    local text = table.concat(kael.chat, "\n")
    assert(text:find("Guild sharing (Relic Hunters): 1 guild character received so far", 1, true), text)
    assert(not text:find("Luna-Test Realm:", 1, true), "guild characters aren't listed one by one")
end)

local DAY = 24 * 60 * 60

-- A guild character `name` as kept by a guildmate's addon, updated `updated`.
local function guildCharacter(name, updated)
    return { name = name, realm = "Test Realm", class = "MAGE", source = "guild", guild = "Relic Hunters",
        updated = updated, professions = { Tailoring = { rank = 1, max = 75, recipes = { ["spell:2387"] = true } } } }
end

it("sends a backlog's characters once, even when asked again while they wait", function()
    reset()
    local saved = { characters = {} }
    for i = 1, 120 do saved.characters["P" .. i .. "-Test Realm"] = guildCharacter("P" .. i, clock) end
    player("Kael", "Relic Hunters", nil, saved)
    run(60)
    sent = {}
    local mira = player("Mira", "Relic Hunters")
    run(35) -- Kael's answers are being sent, one a second
    assert(#sent < 100, "still sending when Mira asks again")
    mira.ns.Sync.hello()
    run(600)
    for i = 1, 120 do eq(sentBy("Kael", "P" .. i), 1, "P" .. i .. " sent once") end
    eq(knows(mira, "P120", "Tailoring", 2387), true, "Mira has them all")
end)

it("rebuilds the export once for a burst of characters received, not once each", function()
    reset()
    local saved = { characters = {} }
    for i = 1, 30 do saved.characters["P" .. i .. "-Test Realm"] = guildCharacter("P" .. i, clock) end
    player("Kael", "Relic Hunters", nil, saved)
    run(60)
    local mira = player("Mira", "Relic Hunters")
    local rebuilds, refresh = 0, mira.ns.Core.refreshExport
    mira.ns.Core.refreshExport = function(...)
        rebuilds = rebuilds + 1
        return refresh(...)
    end
    run(300)
    assert(rebuilds <= 6, "rebuilt " .. rebuilds .. " times for 30 characters")
    assert(mira.ns.db.export:find('"name":"P30"', 1, true), "all of them in the export")
end)

it("restamps a character still played, so guildmates don't forget it", function()
    reset()
    local old = clock - 40 * DAY
    local mine = guildCharacter("Luna", old)
    mine.source = "own"
    player("Kael", "Relic Hunters", nil, { characters = { ["Luna-Test Realm"] = guildCharacter("Luna", old) } })
    local luna = player("Luna", "Relic Hunters", nil, { characters = { ["Luna-Test Realm"] = mine } })
    run(120)
    eq(luna.ns.db.characters["Luna-Test Realm"].updated > old, true, "Luna's restamped")
    local kael = players[1]
    eq(kael.ns.db.characters["Luna-Test Realm"].updated, luna.ns.db.characters["Luna-Test Realm"].updated,
        "and Kael has the new stamp")
end)

it("forgets at login a guildmate not heard of for 90 days", function()
    reset()
    local kael = player("Kael", "Relic Hunters", nil,
        { characters = { ["Gone-Test Realm"] = guildCharacter("Gone", clock - 91 * DAY) } })
    eq(kael.ns.db.characters["Gone-Test Realm"], nil, "forgotten")
end)

realPrint(("%d passed, %d failed"):format(passed, failed))
if failed > 0 then error(failed .. " failed") end
