
--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]
-- Lua Library inline imports
local function __TS__ObjectAssign(target, ...)
    local sources = {...}
    for i = 1, #sources do
        local source = sources[i]
        for key in pairs(source) do
            target[key] = source[key]
        end
    end
    return target
end

local function __TS__ArrayFilter(self, callbackfn, thisArg)
    local result = {}
    local len = 0
    for i = 1, #self do
        if callbackfn(thisArg, self[i], i - 1, self) then
            len = len + 1
            result[len] = self[i]
        end
    end
    return result
end

local function __TS__ArrayFindIndex(self, callbackFn, thisArg)
    for i = 1, #self do
        if callbackFn(thisArg, self[i], i - 1, self) then
            return i - 1
        end
    end
    return -1
end

local function __TS__ArrayMap(self, callbackfn, thisArg)
    local result = {}
    for i = 1, #self do
        result[i] = callbackfn(thisArg, self[i], i - 1, self)
    end
    return result
end

local function __TS__ArrayFind(self, predicate, thisArg)
    for i = 1, #self do
        local elem = self[i]
        if predicate(thisArg, elem, i - 1, self) then
            return elem
        end
    end
    return nil
end

local function __TS__ArrayIsArray(value)
    return type(value) == "table" and (value[1] ~= nil or next(value) == nil)
end

local function __TS__ArrayFlatMap(self, callback, thisArg)
    local result = {}
    local len = 0
    for i = 1, #self do
        local value = callback(thisArg, self[i], i - 1, self)
        if __TS__ArrayIsArray(value) then
            for j = 1, #value do
                len = len + 1
                result[len] = value[j]
            end
        else
            len = len + 1
            result[len] = value
        end
    end
    return result
end
-- End of Lua Library inline imports

-- Function to test goes here:
function GetCurrentRaidInfo()
    local currRaidInfo = {}
    do
        local currRaidIndex = 1
        while currRaidIndex <= MAX_RAID_MEMBERS do
            local playerName, _, groupId = GetRaidRosterInfo(currRaidIndex)
            if playerName ~= nil then
                currRaidInfo[#currRaidInfo + 1] = {playerName = playerName, raidId = currRaidIndex, groupId = groupId}
            end
            currRaidIndex = currRaidIndex + 1
        end
    end
    return currRaidInfo
end
function getGroupIdFromRaidId(raidIdIndex)
    return math.floor((raidIdIndex - 1) / MAX_GROUP_SIZE) + 1
end
function FindAFreeGroup(raidInfo)
    do
        local i = 0
        while i < MAX_RAID_SIZE do
            local allMembersAssignedToGroup = __TS__ArrayFilter(
                raidInfo,
                function(____, t) return t.groupId == i + 1 end
            )
            if #allMembersAssignedToGroup < MAX_GROUP_SIZE then
                return i + 1
            end
            i = i + 1
        end
    end
    -- TODO There is a fix, just find whoever is in the wrong spot and swap them
    print("If the raid is full this will not work...")
    return -1
end
function SolvePlayerPosition(player, directive)
    local raidInfo = GetCurrentRaidInfo()
    local destinationGroupId = player.destinationGroupId
    local currentStatusOfPlayer = __TS__ArrayFind(
        raidInfo,
        function(____, t) return t.playerName == player.playerName end
    )
    if not currentStatusOfPlayer then
        print(("Unpexted player not found " .. player.playerName) .. ", skipping, but this should never happen.")
    end
    local existingCurrentPlayer = currentStatusOfPlayer
    if existingCurrentPlayer.groupId == destinationGroupId then
        return
    end

    local destinationGroup = __TS__ArrayFilter(
        raidInfo,
        function(____, t) return t.groupId == destinationGroupId end
    )
    if #destinationGroup >= MAX_GROUP_SIZE then
        local wronglyPlacedPlayer = __TS__ArrayFind(
            destinationGroup,
            function(____, currPlayer)
                local directivePlayer = __TS__ArrayFind(
                    directive,
                    function(____, t) return t.playerName == currPlayer.playerName end
                )
                return (directivePlayer and directivePlayer.destinationGroupId) ~= destinationGroupId
            end
        )
        if not wronglyPlacedPlayer then
            print("WE HAVE A PROBLEM!")
        end
        SetRaidSubgroup(
            wronglyPlacedPlayer.raidId,
            FindAFreeGroup(raidInfo)
        )
    end
    SetRaidSubgroup(existingCurrentPlayer.raidId, destinationGroupId)
end
function SortRaid(raid)
    local sortState = {unknownPlayers = {}, preSortState = {}}
    local flatRaid = __TS__ArrayFlatMap(
        __TS__ArrayMap(
            raid,
            function(____, t, gIdx) return __TS__ArrayMap(
                t,
                function(____, x, sIdx) return {destinationIndex = gIdx * MAX_GROUP_SIZE + sIdx + 1, name = x} end
            ) end
        ),
        function(____, t) return t end
    )
    do
        local currRaidIndex = 1
        while currRaidIndex <= MAX_RAID_MEMBERS do
            local currPlayer, _, currPlayerGroup = GetRaidRosterInfo(currRaidIndex)
            if currPlayer ~= nil then
                local foundPlayer = __TS__ArrayFind(
                    flatRaid,
                    function(____, t) return t.name == currPlayer end
                )
                if not foundPlayer then
                    local ____sortState_unknownPlayers_2 = sortState.unknownPlayers
                    ____sortState_unknownPlayers_2[#____sortState_unknownPlayers_2 + 1] = {currentIndex = currRaidIndex, playerName = currPlayer}
                else
                    local ____sortState_preSortState_3 = sortState.preSortState
                    ____sortState_preSortState_3[#____sortState_preSortState_3 + 1] = {
                        currentIndex = currRaidIndex,
                        destinationGroupId = getGroupIdFromRaidId(foundPlayer.destinationIndex),
                        playerName = currPlayer
                    }
                end
            end
            currRaidIndex = currRaidIndex + 1
        end
    end
    for ____, curr in ipairs(sortState.unknownPlayers) do
        local groupWithSmallestCount = 1
        local currSmallestCount = MAX_GROUP_SIZE
        do
            local i = 0
            while i < MAX_RAID_SIZE do
                local allMembersAssignedToGroup = __TS__ArrayFilter(
                    sortState.preSortState,
                    function(____, t) return t.destinationGroupId == i + 1 end
                )
                if #allMembersAssignedToGroup < currSmallestCount then
                    currSmallestCount = #allMembersAssignedToGroup
                    groupWithSmallestCount = i + 1
                end
                i = i + 1
            end
        end
        local ____sortState_preSortState_4 = sortState.preSortState
        ____sortState_preSortState_4[#____sortState_preSortState_4 + 1] = {currentIndex = curr.currentIndex, destinationGroupId = groupWithSmallestCount, playerName = curr.playerName}
    end
    for ____, curr in ipairs(sortState.preSortState) do
        SolvePlayerPosition(curr, sortState.preSortState)
    end
end

-- Simulate a WoW Raid and WoW API
function setWowRaidSimulation(initialValues)
    if initialValues == nil then
        initialValues = {}
    end
    do
        local i = 0
        while i < MAX_RAID_SIZE do
            local currGroup = {groupId = i + 1, group = {}}
            wowRaid[i + 1] = currGroup
            do
                local j = 0
                while j < MAX_GROUP_SIZE do
                    do
                        if initialValues[i + 1] ~= nil and initialValues[i + 1][j + 1] ~= nil then
                            currGroup.group[j + 1] = {slotId = j + 1, slotValue = initialValues[i + 1][j + 1] or nil}
                            goto __continue4
                        end
                        local currSlot = {slotId = j + 1, slotValue = nil}
                        currGroup.group[j + 1] = currSlot
                    end
                    ::__continue4::
                    j = j + 1
                end
            end
            i = i + 1
        end
    end
end
function readjustRaid()
    local flattenArray = __TS__ArrayMap(
        wowRaid,
        function(____, t) return __TS__ArrayFilter(
            __TS__ArrayMap(
                __TS__ArrayFilter(
                    t.group,
                    function(____, x) return x.slotValue ~= nil end
                ),
                function(____, x) return x.slotValue end
            ),
            function(____, x) return x ~= nil end
        ) end
    )
    setWowRaidSimulation(flattenArray)
end
MAX_RAID_SIZE = 8
MAX_GROUP_SIZE = 5
wowRaid = {}
raid = {{"Darkshivan", "Tearyn"}, {
    "Milfred",
    "Asti",
    "Boomstronk",
    "Ciridia",
    "Verylongname"
}}
function findElementInRaid(raidIndex)
    if raidIndex > MAX_GROUP_SIZE * MAX_RAID_SIZE then
        return nil
    end
    local groupIndex = math.floor((raidIndex - 1) / MAX_GROUP_SIZE)
    local slotIndex = math.floor((raidIndex - 1) % MAX_GROUP_SIZE)
    local existing = wowRaid[groupIndex + 1].group[slotIndex + 1]
    if not existing then
        return nil
    end
    return __TS__ObjectAssign({}, existing, {groupNumber = groupIndex + 1, slotNumber = slotIndex + 1})
end
function SetRaidSubgroup(raidIndex, groupIndex)
    local element = findElementInRaid(raidIndex)
    if element == nil or element.slotValue == nil then
        print(("No player found with index " .. tostring(raidIndex)) .. ".")
        return
    end
    local group = wowRaid[groupIndex].group
    local isFull = #__TS__ArrayFilter(
        group,
        function(____, t) return t.slotValue ~= nil end
    ) == MAX_GROUP_SIZE
    if isFull then
        print(("Group " .. tostring(groupIndex)) .. " is full! Cannot move player.")
        return
    end
    local freeSlotIndex = __TS__ArrayFindIndex(
        group,
        function(____, t) return t.slotValue == nil end
    )
    local freeSlot = group[freeSlotIndex + 1]
    freeSlot.slotValue = element.slotValue
    wowRaid[element.groupNumber].group[element.slotId].slotValue = nil
    readjustRaid()
end
function SwapRaidSubgroup(raidIndex, targetIndex)
    local elementA = findElementInRaid(raidIndex)
    local elementB = findElementInRaid(targetIndex)
    if raidIndex == targetIndex then
        return
    end
    if elementA == nil or elementA.slotValue == nil or elementB == nil or elementB.slotValue == nil then
        print("At least one of the indexes does not point to a valid slot, fail silently")
        return
    end
    wowRaid[elementA.groupNumber].group[elementA.slotId].slotValue = elementB.slotValue
    wowRaid[elementB.groupNumber].group[elementB.slotId].slotValue = elementA.slotValue
    readjustRaid()
end
function GetRaidRosterInfo(raidIndex)
    local element = findElementInRaid(raidIndex)
    if element == nil then
        return nil, 0, 0
    end
    return element.slotValue, 0, element.groupNumber
end
function printRaid()
    for ____, currGroup in ipairs(wowRaid) do
        print(("Group " .. tostring(currGroup.groupId)) .. "\n")
        for ____, currSlot in ipairs(currGroup.group) do
            print(((" - [" .. tostring((currGroup.groupId - 1) * MAX_GROUP_SIZE + currSlot.slotId)) .. "]: ") .. tostring(currSlot.slotValue))
        end
    end
end


-- BEGIN TEST
MAX_RAID_MEMBERS = 40;

function runTest()
    local initialRaid = {
        {"Darkshivan", "Wwolf", "Svajone", "Datoliina", "Goodina"},
        {"Tearyn", "Boomstronk", "Bibimbap", "Lutaryon", "Krint"},
        {"Kimepo", "Mich", "Paynex", "Snace", "Ashgiver"},
        {"Barakary", "Vysha","Libriyum","Pignose"},
        {"Dirkwarlock","Verylongname","Milfred","Wolfsun","Eyvor"},
        {"Zugpriest","Justhealing","Lockfel", "Grumbus"}
    }
    -- Initialize the raid with the following group
    setWowRaidSimulation(initialRaid);

    local raidInput = {
        {"Tearyn","Wwolf","Kimepo","Eyvor","Pignose"},
        {"Vysha","Krint","Wolfsun","Libriyum","Lockfel"},
        {"Bibimbap","Barakary","Justhealing","Zugpriest","Milfred"},
        {"Datoliina","Goodina","Grumbus","Verylongname","Dirkwarlock"},
        {"Mich","Lutaryon"},
        {"Paynex","Ashgiver"},
        {"Boomstronk","Svajone"},
        {"Snace","Darkshivan"}
    }

    -- Do test stuff here
    SortRaid(raidInput);

    -- Check the results
    printRaid();
end

runTest()
