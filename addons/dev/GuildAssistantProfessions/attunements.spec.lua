-- Tests of the raid attunements GuildAssistantProfessions records (Core.lua's "Attunements", and
-- Attunements.lua against a fake game), outside WoW. Run with `npm test` in addons/ (or
-- lua dev/GuildAssistantProfessions/attunements.spec.lua).

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

-- The addon's Core, Scan and Attunements with a fake game. `game`: faction (UnitFactionGroup's
-- answer), done (the quests this character has completed), classic (Classic Era's global instead of
-- WoW Forever's C_QuestLog), noApi (a client with neither).
local function load(game)
    game = game or {}
    _G.UnitFactionGroup = function() return game.faction or "Alliance" end
    _G.UnitName = function() return "Luna" end
    _G.UnitClass = function() return "Mage", "MAGE" end
    _G.GetRealmName = function() return "Test Realm" end
    _G.IsInGuild = function() return game.guild ~= nil end
    _G.GetGuildInfo = function(unit) if unit == "player" then return game.guild end end
    _G.GetNumSkillLines, _G.GetSkillLineInfo, _G.GetProfessions = nil, nil, nil
    local function completed(id) return (game.done or {})[id] == true end
    _G.C_QuestLog = (not game.classic and not game.noApi) and { IsQuestFlaggedCompleted = completed } or nil
    _G.IsQuestFlaggedCompleted = game.classic and completed or nil
    local ns = {}
    for _, file in ipairs({ "Core", "Scan", "Attunements" }) do
        assert(loadfile("GuildAssistantProfessions/" .. file .. ".lua"))("GuildAssistantProfessions", ns)
    end
    ns.db = ns.Core.newDB()
    ns.now = function() return 1000 end
    return ns
end

-- Reading the game ---------------------------------------------------------------------------------

it("records the Onyxia attunement from the quest of this character's faction", function()
    local ns = load({ faction = "Alliance", done = { [6502] = true } })
    eq(ns.Attunements.scan(), true, "recorded")
    eq(ns.db.characters["Luna-Test Realm"].attunements.ony, true, "attuned")
    eq(ns.Attunements.scan(), false, "nothing new the second time")

    -- The Horde quest is a different id: an Alliance character's isn't read from it.
    ns = load({ faction = "Alliance", done = { [6602] = true } })
    eq(ns.Attunements.scan(), true, "looked")
    eq(ns.db.characters["Luna-Test Realm"].attunements.ony, false, "the other faction's quest doesn't count")

    ns = load({ faction = "Horde", done = { [6602] = true } })
    ns.Attunements.scan()
    eq(ns.db.characters["Luna-Test Realm"].attunements.ony, true, "Horde")
end)

it("asks about every faction's quest when the game doesn't say which this character is", function()
    local ns = load({ faction = "Neutral", done = { [6602] = true } })
    eq(ns.Attunements.faction(), nil, "no faction")
    ns.Attunements.scan()
    eq(ns.db.characters["Luna-Test Realm"].attunements.ony, true, "either faction's counts")
end)

it("reads Classic Era's global, and records nothing on a client with neither", function()
    local ns = load({ classic = true, done = { [6502] = true } })
    eq(ns.Attunements.scan(), true)
    eq(ns.db.characters["Luna-Test Realm"].attunements.ony, true)

    ns = load({ noApi = true, done = { [6502] = true } })
    eq(ns.Attunements.completed(), nil, "no way to ask")
    eq(ns.Attunements.scan(), false, "nothing recorded")
    eq(ns.db.characters["Luna-Test Realm"], nil, "the character isn't even made")
end)

it("never forgets an attunement, however the game answers later", function()
    local ns = load({ done = { [6502] = true } })
    ns.Attunements.scan()
    -- The game answers no while the quest log is still loading: what was recorded stands.
    ns.Attunements.completed = function() return function() return false end end
    eq(ns.Attunements.scan(), false, "nothing changed")
    eq(ns.db.characters["Luna-Test Realm"].attunements.ony, true, "still attuned")
end)

-- Keeping them -------------------------------------------------------------------------------------

it("tells an attunement not had from one never looked at, and only ever gains", function()
    local ns = load()
    local Core = ns.Core
    local luna = Core.character(ns.db, "Luna", "Test Realm", "MAGE")
    eq(luna.attunements, nil, "nothing looked at yet")
    eq(Core.setAttunements(luna, { ony = false }), true, "looked at, not attuned")
    eq(luna.attunements.ony, false)
    eq(Core.setAttunements(luna, { ony = false }), false, "the same answer isn't a change")
    eq(Core.setAttunements(luna, { ony = true }), true, "attuned since")
    eq(Core.setAttunements(luna, { ony = false }), false, "and never taken back")
    eq(luna.attunements.ony, true)
    -- A raid this version doesn't know is kept as it comes, and passed on.
    eq(Core.setAttunements(luna, { mc = true }), true, "a raid it doesn't know yet")
    eq(luna.attunements.mc, true)
    eq(Core.setAttunements(luna, { ["Not a key"] = true, [""] = true }), false, "nonsense is left out")
end)

it("exports a character's attunements, and leaves the field out without any", function()
    local ns = load()
    local Core, db = ns.Core, ns.db
    local luna = Core.character(db, "Luna", "Test Realm", "MAGE")
    local bob = Core.character(db, "Bob", "Test Realm", "WARRIOR")
    Core.setAttunements(luna, { ony = true, mc = false })
    local export = Core.exportData(db)
    local attunements
    for _, character in ipairs(export.characters) do
        if character.name == "Luna" then attunements = character.attunements end
        if character.name == "Bob" then eq(character.attunements, nil, "none looked at: no field") end
    end
    eq(#attunements, 2, "both, by key")
    eq(attunements[1].key, "mc"); eq(attunements[1].attuned, false)
    eq(attunements[2].key, "ony"); eq(attunements[2].attuned, true)
    local json = Core.toJSON(export)
    assert(json:find('"attunements":[{"attuned":false,"key":"mc"},{"attuned":true,"key":"ony"}]', 1, true),
        "in the export: " .. json)
    eq(bob.attunements, nil)
end)

it("says what is attuned for /ga-prof status", function()
    local ns = load()
    local Core, db = ns.Core, ns.db
    eq(Core.describeAttunements(db), "Onyxia's Lair: 0 of 0 characters")
    Core.setAttunements(Core.character(db, "Luna", "Test Realm", "MAGE"), { ony = true })
    Core.setAttunements(Core.character(db, "Bob", "Test Realm", "WARRIOR"), { ony = false })
    eq(Core.describeAttunements(db), "Onyxia's Lair: 1 of 2 characters")
end)

-- Sharing them -------------------------------------------------------------------------------------

local function shared(ns, guild)
    local Core, db = ns.Core, ns.db
    local luna = Core.character(db, "Luna", "Test Realm", "MAGE")
    luna.guild = guild
    local kael = Core.character(db, "Kael", "Test Realm", "PRIEST")
    kael.source, kael.guild = "guild", guild
    local mira = Core.character(db, "Mira", "Test Realm", nil, "link") -- someone else's, from a link
    Core.setAttunements(luna, { ony = true })
    Core.setAttunements(kael, { ony = false })
    Core.setAttunements(mira, { ony = true })
    return luna, kael, mira
end

it("writes every shared character's attunements as one message, and reads it back", function()
    local ns = load()
    local Core = ns.Core
    shared(ns, "Relic Hunters")
    local text = Core.encodeAttunements(ns.db, "Relic Hunters")
    eq(text, "Kael-Test Realm=ony-;Luna-Test Realm=ony+", "the link's isn't shared")
    local received = Core.parseAttunements(text)
    eq(received["Luna-Test Realm"].ony, true)
    eq(received["Kael-Test Realm"].ony, false)
    eq(Core.encodeAttunements(ns.db, nil), "", "not in a guild: nothing shared")
end)

it("takes a guildmate's attunements into the characters it keeps, and leaves the rest", function()
    local ns = load()
    local Core, db = ns.Core, ns.db
    local luna, kael = shared(ns, "Relic Hunters")
    local received = Core.parseAttunements(
        "Kael-Test Realm=ony+;Luna-Test Realm=ony-;Nobody-Test Realm=ony+;Mira-Test Realm=ony-")
    eq(Core.receiveAttunements(db, "Relic Hunters", received), 1, "only Kael changed")
    eq(kael.attunements.ony, true, "the guildmate's own addon knows better")
    eq(luna.attunements.ony, true, "ours is never taken back")
    eq(db.characters["Nobody-Test Realm"], nil, "a character it doesn't know isn't made up")
    eq(db.characters["Mira-Test Realm"].attunements.ony, true, "a link's is left alone")
end)

it("ignores nonsense in a message, and a message from no guild", function()
    local ns = load()
    local Core, db = ns.Core, ns.db
    shared(ns, "Relic Hunters")
    eq(next(Core.parseAttunements("rubbish")), nil, "not a message")
    eq(next(Core.parseAttunements(nil)), nil, "nothing")
    local many = {}
    for i = 1, 30 do many[#many + 1] = ("r%d+"):format(i) end
    local parsed = Core.parseAttunements("Luna-Test Realm=" .. table.concat(many))
    local count = 0
    for _ in pairs(parsed["Luna-Test Realm"]) do count = count + 1 end
    eq(count, Core.MAX_ATTUNEMENTS, "capped")
    eq(Core.receiveAttunements(db, nil, Core.parseAttunements("Luna-Test Realm=ony-")), 0, "no guild")
end)

it("answers only someone who holds less than it does", function()
    local ns = load()
    local Core, db = ns.Core, ns.db
    local luna = shared(ns, "Relic Hunters")
    local heard = {}
    eq(Core.attunementsMore(db, "Relic Hunters", heard), true, "nobody has shown anything")
    Core.heardAttunements(heard, Core.parseAttunements(Core.encodeAttunements(db, "Relic Hunters")))
    eq(Core.attunementsMore(db, "Relic Hunters", heard), false, "ours is out there now")
    -- Someone's message says Luna isn't attuned; we know she is, so ours still goes.
    local lesser = {}
    Core.heardAttunements(lesser, Core.parseAttunements("Luna-Test Realm=ony-"))
    eq(Core.attunementsMore(db, "Relic Hunters", lesser), true, "they say no, we know yes")
    Core.setAttunements(luna, { mc = true })
    eq(Core.attunementsMore(db, "Relic Hunters", heard), true, "something new since")
end)

print(("%d passed, %d failed"):format(passed, failed))
if failed > 0 then error(failed .. " failed") end
