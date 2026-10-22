-- Tests of Raidsort's Main.lua (the slash command) against a fake game, outside WoW.
-- Run with `npm test` in addons/ (or lua dev/Raidsort/main.spec.lua).

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

-- Just enough of the game, and of the addon's other files, for Main.lua.
local calls
local function loadMain()
    calls = {}
    local env = setmetatable({ SlashCmdList = {} }, { __index = _G })
    env.print = function() end
    env.CreateFrame = function()
        return { RegisterEvent = function() end, UnregisterEvent = function() end, SetScript = function() end }
    end
    local ns = {
        Raid = { say = function() end },
        UI = {
            toggleMain = function() calls[#calls + 1] = "toggleMain" end,
            showUpload = function() calls[#calls + 1] = "showUpload" end,
        },
    }
    assert(loadfile("Raidsort/Main.lua", "t", env))("Raidsort", ns)
    return env
end

it("answers to /ga-rs, /garaidsort and /ga-raidsort, no longer /raidsort", function()
    local env = loadMain()
    local names = {}
    for i = 1, 5 do
        local name = env["SLASH_RAIDSORT" .. i]
        if name then names[#names + 1] = name end
    end
    eq(table.concat(names, " "), "/ga-rs /garaidsort /ga-raidsort", "slash commands")
    env.SlashCmdList.RAIDSORT("")
    env.SlashCmdList.RAIDSORT("upload")
    eq(table.concat(calls, ","), "toggleMain,showUpload", "the command still works")
end)

print(("%d passed, %d failed"):format(passed, failed))
if failed > 0 then error(failed .. " failed") end
