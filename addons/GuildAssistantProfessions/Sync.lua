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

Sync.stats = { sent = 0, received = 0 }

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

-- The queue of pieces to send, paced (INTERVAL, BURST). A message's pieces go together: whether it
-- still goes is decided once, at its first piece (`skip`: someone sent it meanwhile).
local queue, pumping, burst = {}, false, BURST
local function pump()
    if #queue == 0 then
        pumping, burst = false, BURST
        return
    end
    pumping = true
    local item = table.remove(queue, 1)
    if item.group.go == nil then item.group.go = not (item.group.skip and item.group.skip()) end
    if item.group.go then sendRaw(item.message) end
    if burst > 0 then
        burst = burst - 1
        pump()
    else
        after(INTERVAL, pump)
    end
end
local function enqueue(messages, skip)
    local group = { skip = skip }
    for _, message in ipairs(messages) do queue[#queue + 1] = { message = message, group = group } end
    if not pumping then pump() end
end

local counter = 0
local function nextId()
    counter = counter + 1
    return Core.toBase36(counter) .. Core.toBase36(math.random(0, 1295))
end

-- Answers to someone's summary, waiting (key -> { updated }): one is cancelled when someone else
-- sends that character, as new as ours, first.
local answering = {}

local function sendCharacter(key, answer)
    local db, g = ns.db, guild()
    local character = db and db.characters[key]
    if not character or not Core.shareable(character, g) then return end
    if answer and answer.cancelled then return end
    enqueue(Core.pieces("C", nextId(), Core.encodeCharacter(character)), function()
        return answer ~= nil and answer.cancelled
    end)
    Sync.stats.sent = Sync.stats.sent + 1
    Sync.stats.lastSent = now()
end

--- This character's professions changed: send them to the guild (once things settle).
local ownPending = 0
function Sync.ownChanged()
    ownPending = ownPending + 1
    local this = ownPending
    after(OWN_DELAY, function()
        if this ~= ownPending or not ns.Scan then return end
        local character = ns.Scan.current()
        if guild() then sendCharacter(character.name .. "-" .. character.realm) end
    end)
end

--- Tells the guild who this addon knows; the others answer with what it lacks.
function Sync.hello()
    local g = guild()
    if not g or not ns.db then return false end
    enqueue(Core.pieces("H", nextId(), Core.digest(ns.db, g)))
    -- This character's own professions too: the others may not have them yet.
    local character = ns.Scan and ns.Scan.current()
    if character then sendCharacter(character.name .. "-" .. character.realm) end
    Sync.stats.helloAt = now()
    return true
end

local assembler = Core.newAssembler()

local function onDigest(sender, payload)
    local g = guild()
    if not g then return end
    for _, key in ipairs(Core.newerThan(ns.db, g, Core.parseDigest(payload))) do
        if not answering[key] then
            local answer = { updated = ns.db.characters[key].updated or 0 }
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

local function onCharacter(sender, payload)
    local g = guild()
    local received = g and Core.decodeCharacter(payload)
    if not received then return end
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
    if name == UnitName("player") then return end
    local kind, payload = assembler.add(sender or "?", message)
    if kind == "H" then
        onDigest(sender, payload)
    elseif kind == "C" then
        onCharacter(sender, payload)
    end
end

--- At login: listen, then say hello once the guild is known (retried once if it isn't yet).
function Sync.start()
    local register = (C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix) or RegisterAddonMessagePrefix
    if register then register(PREFIX) end
    after(HELLO_DELAY, function()
        if not Sync.hello() then after(HELLO_DELAY, Sync.hello) end
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
    return ("Guild sharing (%s): %d guild character%s received so far. This session: %d received (last %s), %d sent (last %s)."):format(
        g, known, known == 1 and "" or "s", s.received, when(s.lastReceived), s.sent, when(s.lastSent))
end
