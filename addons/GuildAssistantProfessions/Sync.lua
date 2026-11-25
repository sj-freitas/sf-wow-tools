-- GuildAssistant Professions: sharing with the guild. The addons of a guild's players send each
-- other what they know over the game's hidden addon channel, so one player's upload to Guild
-- Assistant carries everyone's professions. Quietly, nothing in the chat: /ga-prof status says what
-- was shared and received.
--
--   * After a scan finds something new, this character's professions are sent to the guild.
--   * At login, a summary of who this addon knows and how recent ("digest") is sent. Anyone who
--     knows a character better (newer, or not in the summary) sends it, after a random wait: the
--     whole guild hears the first answer, and the others then don't send theirs.
--   * A character received is kept unless it is one of this account's (its own data wins), or what
--     is kept is as new. Only characters of the same guild are shared.
--   * How recipes are obtained (Sources.lua: vendors, trainers, loot, quests) goes the same way, as
--     records: each new finding is sent; at login a summary of the records ("D"), answered with
--     the records ("R") the sender lacks or has older. Records are merged, never replaced.
--   * Which raids each character is attuned to (Attunements.lua) goes as one message holding every
--     character's -- it is small enough to be its own summary. At login the table is offered ("A",
--     after the hello, so characters heard of for the first time are already kept): whoever holds
--     more answers with theirs ("B"), after a random wait, and the others then don't. An answer is
--     never answered, so a login costs one round. This character's own change goes as a "B" too:
--     nobody can know better than its own addon.
-- The pure parts (the messages, what to send, what to keep) are in Core.lua.

local _, ns = ...
local Core = ns.Core
local Sync = {}
ns.Sync = Sync

local PREFIX = "GAProf"
-- The game drops addon messages sent too fast (and can disconnect): one every this many seconds,
-- after a few at once.
local INTERVAL, BURST = 1.0, 4
local HELLO_DELAY = 20 -- seconds after login: the guild's roster and the chat are ready by then
local OWN_DELAY = 10 -- seconds after a scan: a window being browsed changes several times
-- Seconds after the hello before the attunements go: by then the characters it asked for have
-- arrived, so they are there to be attuned.
local ATTUNEMENTS_DELAY = 15

Sync.stats = { sent = 0, received = 0, sourcesSent = 0, sourcesReceived = 0,
    attunementsSent = 0, attunementsReceived = 0 }

local function now() return ns.now() end
local function after(seconds, fn)
    if C_Timer and C_Timer.After then C_Timer.After(seconds, fn) else fn() end
end

local function guild()
    return IsInGuild and IsInGuild() and GetGuildInfo and GetGuildInfo("player") or nil
end

local function sendRaw(message)
    local send = (C_ChatInfo and C_ChatInfo.SendAddonMessage) or SendAddonMessage
    if send then send(PREFIX, message, "GUILD") end
end

-- The queue of messages to send, paced. Each is made when its turn comes (`build`
-- returns its pieces, or nil when it shouldn't go any more), so a character goes as it is then, and
-- whether it still goes is decided then too (`skip`: someone sent it meanwhile). One with a `key`
-- (a character) is queued once: asked for again while it waits, it isn't queued twice.
-- The pacing: BURST messages can go at once, and the allowance comes back one every INTERVAL
-- (whether or not the queue emptied meanwhile: answers arriving one by one are paced too).
local queue, queued, tokens, refilling = {}, {}, BURST, false
local pump
local function refill()
    tokens = math.min(BURST, tokens + 1)
    if tokens < BURST then after(INTERVAL, refill) else refilling = false end
    pump()
end
function pump()
    while tokens > 0 and queue[1] do
        local group = queue[1]
        if not group.pieces then
            if group.key then queued[group.key] = nil end
            group.pieces = not (group.skip and group.skip()) and group.build() or {}
            group.next = 1
        end
        local message = group.pieces[group.next]
        group.next = group.next + 1
        if group.next > #group.pieces then table.remove(queue, 1) end
        -- Nothing sent when it didn't go: on to the next one, the allowance untouched.
        if message then
            sendRaw(message)
            tokens = tokens - 1
            if not refilling then
                refilling = true
                after(INTERVAL, refill)
            end
        end
    end
end
local function enqueue(key, build, skip)
    local waiting = key and queued[key]
    if waiting then
        -- Asked for unconditionally now: it goes even if the earlier answer is cancelled.
        if not skip then waiting.skip = nil end
        return
    end
    local group = { key = key, build = build, skip = skip }
    if key then queued[key] = group end
    queue[#queue + 1] = group
    pump()
end

local counter = 0
local function nextId()
    counter = counter + 1
    return Core.toBase36(counter) .. Core.toBase36(math.random(0, 1295))
end

-- Answers to someone's summary, waiting (key -> { updated }): one is cancelled when someone else
-- sends that character, as new as ours, first.
local answering = {}

-- What was last sent of each character (key -> { updated, at }): an answer to someone who asked
-- before that copy reached them needn't go again.
local lastSent = {}
local CROSSED = 5 -- seconds: a copy sent this shortly before someone asked was on its way to them

local function sendCharacter(key, answer)
    if answer and answer.cancelled then return end
    enqueue("C" .. key, function()
        local db, g = ns.db, guild()
        local character = db and db.characters[key]
        if not character or not Core.shareable(character, g) then return nil end
        Sync.stats.sent = Sync.stats.sent + 1
        Sync.stats.lastSent = now()
        lastSent[key] = { updated = character.updated or 0, at = now() }
        return Core.pieces("C", nextId(), Core.encodeCharacter(character))
    end, answer and function()
        local copy = lastSent[key]
        return answer.cancelled
            or (copy ~= nil and copy.updated >= answer.updated and copy.at >= answer.asked - CROSSED)
    end)
end

-- A record of sources (Core.encodeSourceRecord), sent as it is when its turn comes.
local function sendSourceRecord(record, answer)
    if answer and answer.cancelled then return end
    enqueue("R" .. record, function()
        local payload = ns.db and guild() and Core.encodeSourceRecord(ns.db, record)
        if not payload then return nil end
        Sync.stats.sourcesSent = Sync.stats.sourcesSent + 1
        lastSent["R" .. record] = { updated = ns.db.sources.stamps[record], at = now() }
        return Core.pieces("R", nextId(), payload)
    end, answer and function()
        local copy = lastSent["R" .. record]
        return answer.cancelled
            or (copy ~= nil and copy.updated >= answer.updated and copy.at >= answer.asked - CROSSED)
    end)
end

--- Something new was found of how a recipe is obtained (Sources.lua): send its record.
function Sync.sourceChanged(record)
    if guild() then sendSourceRecord(record) end
end

-- What the guild has shown of the attunements since someone last asked for them, and what this
-- addon has sent (Core.heardAttunements): an answer needn't go once everything this addon holds is
-- out there. A message holding less than this addon does starts it again from what that one showed:
-- whoever answers first, the others hear it and don't.
local attunementsHeard = {}
local attunementsAnswering = false

--- Tells the guild the attunements of every character this addon knows (Core.encodeAttunements):
--- `kind` "A" offers them at login (whoever holds more answers), "B" only tells. Queued once:
--- asked for again while it waits, it still goes once, as it is then.
function Sync.sendAttunements(kind, answer)
    if not (guild() and ns.db) then return end
    enqueue("A", function()
        local current = guild()
        if not current then return nil end
        local payload = Core.encodeAttunements(ns.db, current)
        Sync.stats.attunementsSent = Sync.stats.attunementsSent + 1
        -- Everyone has heard what we hold now: nothing to answer until something new turns up.
        Core.heardAttunements(attunementsHeard, Core.parseAttunements(payload))
        return Core.pieces(kind, nextId(), payload)
    end, answer and function()
        return not Core.attunementsMore(ns.db, guild(), attunementsHeard)
    end)
end

--- This character's attunements changed (Attunements.lua): tell the guild. Nobody knows this
--- character better, so no answer is wanted.
function Sync.attunementsChanged()
    Sync.sendAttunements("B")
end

--- This character's professions changed: send them to the guild (once things settle). While the
--- login hello is still to come they wait for it: it sends this character too (what was recorded at
--- login, with it).
local ownPending = 0
function Sync.ownChanged()
    ownPending = ownPending + 1
    local this = ownPending
    after(OWN_DELAY, function()
        if this ~= ownPending or not ns.Scan or Sync.helloPending then return end
        local character = ns.Scan.current()
        if character and guild() then sendCharacter(character.name .. "-" .. character.realm) end
    end)
end

--- Tells the guild who this addon knows; the others answer with what it lacks.
function Sync.hello()
    local g = guild()
    if not g or not ns.db then return false end
    enqueue("H", function()
        local current = guild()
        return current and Core.pieces("H", nextId(), Core.digest(ns.db, current)) or nil
    end)
    -- And of the records of sources: anyone with more answers.
    enqueue("D", function()
        return guild() and Core.pieces("D", nextId(), Core.sourcesDigest(ns.db)) or nil
    end)
    -- This character's own professions too: the others may not have them yet. Restamped when old,
    -- so guildmates don't forget a character still played (Core.heartbeat).
    local character = ns.Scan and ns.Scan.current()
    if character then
        if Core.heartbeat(character, now()) and Sync.onOwnRestamped then Sync.onOwnRestamped() end
        sendCharacter(character.name .. "-" .. character.realm)
    end
    -- And the attunements of every character known, once the hello's answers have come in: whoever
    -- knows more answers.
    after(ATTUNEMENTS_DELAY, function() Sync.sendAttunements("A") end)
    Sync.stats.helloAt = now()
    return true
end

local assembler = Core.newAssembler(now)

local function onDigest(sender, payload)
    local g = guild()
    if not g then return end
    for _, key in ipairs(Core.newerThan(ns.db, g, Core.parseDigest(payload))) do
        if not answering[key] then
            local answer = { updated = ns.db.characters[key].updated or 0, asked = now() }
            answering[key] = answer
            -- A random wait: whoever answers first, the others hear it and don't send.
            after(2 + math.random() * 8, function()
                answering[key] = nil
                sendCharacter(key, answer)
            end)
        end
    end
    Sync.stats.peers = (Sync.stats.peers or 0) + 1
end

local function onSourcesDigest(sender, payload)
    if not guild() then return end
    for _, record in ipairs(Core.sourcesNewerThan(ns.db, Core.parseSourcesDigest(payload))) do
        local key = "R" .. record
        if not answering[key] then
            local answer = { updated = ns.db.sources.stamps[record], asked = now() }
            answering[key] = answer
            after(2 + math.random() * 8, function()
                answering[key] = nil
                sendSourceRecord(record, answer)
            end)
        end
    end
end

local function onSourceRecord(sender, payload)
    local received = guild() and Core.decodeSourceRecord(payload)
    if not received then return end
    local answer = answering["R" .. received.record]
    if answer and received.stamp >= answer.updated then answer.cancelled = true end
    local changed, more = Core.receiveSourceRecord(ns.db, received, now())
    if changed then Sync.stats.sourcesReceived = Sync.stats.sourcesReceived + 1 end
    -- Holding more than the sender: send the whole record back, so both have it all now (the other
    -- side then has nothing more, so it stops there).
    if more then sendSourceRecord(received.record) end
end

--- Someone's attunements: `offered` for a login's table ("A"), which is answered when this addon
--- holds more, against an answer ("B"), which never is.
local function onAttunements(sender, payload, offered)
    local g = guild()
    if not g or not ns.db then return end
    local shown = Core.parseAttunements(payload)
    local changed = Core.receiveAttunements(ns.db, g, shown)
    if changed > 0 then
        Sync.stats.attunementsReceived = Sync.stats.attunementsReceived + changed
        if Sync.onReceived then Sync.onReceived() end
    end
    if not offered or not Core.attunementsMore(ns.db, g, shown) then
        -- They hold everything this addon does: an answer of ours waiting needn't go.
        Core.heardAttunements(attunementsHeard, shown)
        return
    end
    -- Holding what they don't: ours goes, after a random wait, from what they showed -- unless
    -- someone else's answer carries it all first.
    attunementsHeard = shown
    if not attunementsAnswering then
        attunementsAnswering = true
        after(2 + math.random() * 8, function()
            attunementsAnswering = false
            Sync.sendAttunements("B", true)
        end)
    end
end

local function onCharacter(sender, payload)
    local g = guild()
    local received = g and Core.decodeCharacter(payload)
    if not received then return end
    received.realm = Core.realmName(received.realm) -- from a guildmate's 1.0.2 or earlier
    -- This character as a guildmate still holds it from 1.0.2 and earlier (the first name alone):
    -- it is saved under the full name now, and the old name shouldn't come back.
    local here = Core.realmOf(ns.db, ns.Scan.realmName(), Core.playerName(UnitName("player")))
    if received.realm == here and received.name ~= Core.playerName(UnitName("player"))
        and Core.isOwnName(received.name, UnitName("player")) then
        return
    end
    local key = received.name .. "-" .. received.realm
    -- Someone sent it: unless ours is newer, our answer needn't go.
    local answer = answering[key]
    if answer and received.updated >= answer.updated then answer.cancelled = true end
    if Core.receive(ns.db, g, received, now()) then
        Sync.stats.received = Sync.stats.received + 1
        Sync.stats.lastReceived = now()
        if Sync.onReceived then Sync.onReceived(received) end
    end
end

--- An addon message (CHAT_MSG_ADDON): ours from someone in the guild, never our own echo.
function Sync.onMessage(prefix, message, channel, sender)
    if prefix ~= PREFIX or channel ~= "GUILD" or not ns.db then return end
    local name = sender and sender:match("^([^-]+)") or sender
    if Core.isOwnName(name, UnitName("player")) then return end
    local kind, payload = assembler.add(sender or "?", message)
    if kind == "H" then
        onDigest(sender, payload)
    elseif kind == "C" then
        onCharacter(sender, payload)
    elseif kind == "D" then
        onSourcesDigest(sender, payload)
    elseif kind == "R" then
        onSourceRecord(sender, payload)
    elseif kind == "A" or kind == "B" then
        onAttunements(sender, payload, kind == "A")
    end
end

--- At login: listen, then say hello once the guild is known (retried once if it isn't yet).
function Sync.start()
    local register = (C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix) or RegisterAddonMessagePrefix
    if register then register(PREFIX) end
    Sync.helloPending = true
    after(HELLO_DELAY, function()
        if Sync.hello() then
            Sync.helloPending = false
        else
            after(HELLO_DELAY, function()
                Sync.helloPending = false
                Sync.hello()
            end)
        end
    end)
end

--- For /ga-prof status: "Guild sharing (Relic Hunters): 12 guild characters known; …".
function Sync.describe(db, when)
    local g = guild()
    if not g then return "Guild sharing: not in a guild, nothing is shared." end
    local known = 0
    for _, character in pairs(db.characters) do
        if character.source == "guild" and character.guild == g then known = known + 1 end
    end
    local s = Sync.stats
    return ("Guild sharing (%s): %d guild character%s received so far. This session: %d received (last %s), %d sent (last %s); recipe sources: %d received, %d sent; attunements: %d received, %d sent."):format(
        g, known, known == 1 and "" or "s", s.received, when(s.lastReceived), s.sent, when(s.lastSent),
        s.sourcesReceived, s.sourcesSent, s.attunementsReceived, s.attunementsSent)
end
