// INTERNAL TOOLING
function print(str: unknown): void {
  console.log(str);
}

type WoWGroupSlot = {
  slotId: number;
  slotValue: string | null;
};
type WoWGroup = {
  groupId: number;
  group: WoWGroupSlot[];
};

type WoWRaid = WoWGroup[];
type Raid = string[][];

const MAX_RAID_SIZE = 8;
const MAX_GROUP_SIZE = 5;
const MAX_RAID_MEMBERS = MAX_RAID_SIZE * MAX_GROUP_SIZE;

let wowRaid: WoWRaid = [];

const raid: Raid = [
    ["Darkshivan", "Wwolf", "Svajone", "Datoliina", "Goodina"],
    ["Tearyn", "Boomstronk", "Bibimbap", "Lutaryon", "Krint"],
    ["Kimepo", "Mich", "Paynex", "Snace", "Ashgiver"],
    ["Barakary", "Vysha","Libriyum","Pignose"],
    ["Dirkwarlock","Verylongname","Milfred","Wolfsun","Eyvor"],
    ["Zugpriest","Justhealing","Lockfel", "Grumbus","Somedude"]
];

function setWowRaidSimulation(initialValues: Raid = []) {
  for (let i = 0; i < MAX_RAID_SIZE; i++) {
    const currGroup: WoWGroup = {
      groupId: i + 1,
      group: [],
    };

    wowRaid[i] = currGroup;

    for (let j = 0; j < MAX_GROUP_SIZE; j++) {
      if (initialValues[i] !== undefined && initialValues[i][j] !== undefined) {
        currGroup.group[j] =  {
            slotId: j + 1,
            slotValue: initialValues[i][j] ?? null,
        };
        continue;
      }

      const currSlot = {
        slotId: j + 1,
        slotValue: null,
      };

      currGroup.group[j] = currSlot;
    }
  }
}

function findElementInRaid(raidIndex: number) : (WoWGroupSlot & { groupNumber: number, slotNumber: number }) | null {
  if (raidIndex > MAX_GROUP_SIZE * MAX_RAID_SIZE) {
    return null;
  }

  const groupIndex = Math.floor((raidIndex - 1) / MAX_GROUP_SIZE);
  const slotIndex = Math.floor((raidIndex - 1) % MAX_GROUP_SIZE);
  const existing = wowRaid[groupIndex].group[slotIndex];
  
  if (!existing) {
    return null;
  }

  return {
    ...existing,
    groupNumber: groupIndex + 1,
    slotNumber: slotIndex + 1,
  };
}

function SetRaidSubgroup(raidIndex: number, groupIndex: number): void {
    const element = findElementInRaid(raidIndex);

    if (element === null || element.slotValue === null) {
        print(`No player found with index ${raidIndex}.`)
        return;
    }

    const group = wowRaid[groupIndex - 1].group;
    const isFull = group.filter((t) => t.slotValue !== null).length === MAX_GROUP_SIZE;

    if (isFull) {
        print(`Group ${groupIndex} is full! Cannot move player.`)
        return;
    }

    const freeSlotIndex = group.findIndex((t) => t.slotValue === null);
    const freeSlot = group[freeSlotIndex];

    freeSlot.slotValue = element.slotValue;
    wowRaid[element.groupNumber - 1].group[element.slotId - 1].slotValue = null;

    readjustRaid()
}

function SwapRaidSubgroup(raidIndex: number, targetIndex: number): void {
  const elementA = findElementInRaid(raidIndex);
  const elementB = findElementInRaid(targetIndex);

  if (raidIndex === targetIndex) {
    // Nothing to do, skipping for performance kekw
    return;
  }

  if (elementA === null || elementA.slotValue === null || elementB === null || elementB.slotValue === null) {
    print("At least one of the indexes does not point to a valid slot, fail silently");
    return;
  }

   wowRaid[elementA.groupNumber - 1].group[elementA.slotId - 1].slotValue = elementB.slotValue;
   wowRaid[elementB.groupNumber - 1].group[elementB.slotId - 1].slotValue = elementA.slotValue;

    // Probably not needed
   readjustRaid()
}

type RosterInfo = [targetName: string | null, rank: number, groupNumber: number];

function GetRaidRosterInfo(raidIndex: number): RosterInfo {
  const element = findElementInRaid(raidIndex);

  if (element === null) {
    return [null as (string | null), 0, 0];
  }

  return [element.slotValue, 0, element.groupNumber];
}

function readjustRaid(): void {
    const flattenArray: Raid = wowRaid
        .map((t) => t.group
            .filter((x) => x.slotValue !== null)
            .map((x) => x.slotValue)
            .filter((x): x is string => x !== null)
        );

    setWowRaidSimulation(flattenArray);
}

function printRaid(): void {
    for (const currGroup of wowRaid) {
        print(`Group ${currGroup.groupId}\n`);

        for (const currSlot of currGroup.group) {
            print(` - [${(currGroup.groupId - 1) * MAX_GROUP_SIZE + currSlot.slotId }]: ${currSlot.slotValue}`);
        }
    }
}

// SORT RAID
type PlayerPreSortState = {
    currentIndex: number;
    destinationGroupId: number;
    playerName: string;
}

type UnknownPlayer = {
    currentIndex: number;
    playerName: string;
}

type SortState = {
    unknownPlayers: UnknownPlayer[];
    preSortState: PlayerPreSortState[];
}

type RaidInfo = {
    playerName: string;
    raidId: number;
    groupId: number;
}

function getGroupIdFromRaidId(raidIdIndex: number): number {
    return Math.floor((raidIdIndex - 1) / MAX_GROUP_SIZE) + 1;
}

// This approach currently finds a group that has a slot
// Ideally we could find a player to swap the current one with:
// 1. A player that wants to come to this group
// 2. If no player wants to come to this group, we can try to move
// the player to its destination (?)
function findAFreeGroup(raidInfo: RaidInfo[]): number {
    for (let i = 0; i < MAX_RAID_SIZE; i++) {
        const allMembersAssignedToGroup = raidInfo.filter((t) => t.groupId === i + 1);

        if (allMembersAssignedToGroup.length < MAX_GROUP_SIZE) {
            print(`Group ${i + 1} has free slots!`);
            return i + 1;
        }
    }

    print(`WE HAVE A PROBLEM! RAID HAS 40 people, cannot solve!`);
    return -1;
}

function SolvePlayerPosition(player: PlayerPreSortState, directive: PlayerPreSortState[]) {
    const raidInfo = GetCurrentRaidInfo();
    const destinationGroupId = player.destinationGroupId;
    const currentStatusOfPlayer = raidInfo.find((t) => t.playerName === player.playerName);

    if (!currentStatusOfPlayer) {
        print(`Unpexted player not found ${player.playerName}, skipping, but this should never happen.`);
    }

    const existingCurrentPlayer = currentStatusOfPlayer!;
    if (existingCurrentPlayer.groupId === destinationGroupId) {
        // Nothing to do all good.
        return;
    }

    print(`Moving player ${player.playerName}(${player.currentIndex}) to group ${player.destinationGroupId}.`)
    const destinationGroup = raidInfo.filter((t) => t.groupId === destinationGroupId);

    if (destinationGroup.length >= MAX_GROUP_SIZE) {
        print(`Group ${destinationGroupId} is full. Need to move someone out.`)
        // Need to swap someone
        // Find who should not be there first
        const wronglyPlacedPlayer = destinationGroup
            // .map((currPlayer) => directive.find((t) => t.playerName === currPlayer.playerName))
            // .filter((currPlayerDirective): currPlayerDirective is PlayerPreSortState => currPlayerDirective !== undefined)
            .find((currPlayer) => {
                const directivePlayer = directive.find((t) => t.playerName === currPlayer.playerName);
                
                return directivePlayer?.destinationGroupId !== destinationGroupId
            });

        print(wronglyPlacedPlayer!.playerName)

        if (!wronglyPlacedPlayer) {
            print(`WE HAVE A PROBLEM!`);
        }

        // Need to find a spot for this player, recursively
        // We can try to find a free slot and move this player there?
        // SolvePlayerPosition(wronglyPlacedPlayer!, directive);
        SetRaidSubgroup(wronglyPlacedPlayer!.raidId, findAFreeGroup(raidInfo))
    }

    SetRaidSubgroup(existingCurrentPlayer.raidId, destinationGroupId)

    // Check if the player is in the right group
    // If YES: Do nothing
    // If NOT: Check if the group is free
    //      If YES: Move player to group
    //      If NOT: Find who shouldn't be there. Move that player until the slot is free! Recursive
}

function GetCurrentRaidInfo(): RaidInfo[] {
    const currRaidInfo: RaidInfo[] = [];
    for (let currRaidIndex = 1; currRaidIndex <= MAX_RAID_MEMBERS; currRaidIndex++) {
        const [playerName, _, groupId] = GetRaidRosterInfo(currRaidIndex);

        if (playerName !== null) {
            currRaidInfo.push({
                playerName,
                raidId: currRaidIndex,
                groupId,
            });
        }
    }
    return currRaidInfo;
}

function SortRaid(raid: Raid) {
    const sortState: SortState = {
        unknownPlayers: [] as UnknownPlayer[],
        preSortState: [] as PlayerPreSortState[],
    }

    const flatRaid = raid
        .map((t, gIdx) => t.map((x, sIdx) => ({ destinationIndex: gIdx * MAX_GROUP_SIZE + sIdx + 1, name: x })))
        .flatMap((t) => t);
        
    for (let currRaidIndex = 1; currRaidIndex <= MAX_RAID_MEMBERS; currRaidIndex++) {
        const [currPlayer, _, currPlayerGroup] = GetRaidRosterInfo(currRaidIndex);
        // Slot is empty, that's fine. We can move the player freely to this position
        // Maybe we add that is sort of metadata? We can figure it out later
        if (currPlayer !== null) {
            const foundPlayer = flatRaid.find((t) => t.name === currPlayer);

            if (!foundPlayer) {
                // We will add these players to any free slots as we find them,
                // After we finish sorting them
                sortState.unknownPlayers.push({
                    currentIndex: currRaidIndex,
                    playerName: currPlayer,
                });
            } else {
                sortState.preSortState.push({
                    currentIndex: currRaidIndex,
                    destinationGroupId: getGroupIdFromRaidId(foundPlayer!.destinationIndex),
                    playerName: currPlayer,
                });
            }
        }
    }

    // Find a destination for unknown players
    // We can change this to find a place for the group with less players instead of the last one
    for (const curr of sortState.unknownPlayers) {
        let groupWithSmallestCount = 1;
        let currSmallestCount = MAX_GROUP_SIZE;
        for (let i = 0; i < MAX_RAID_SIZE; i++) {
            const allMembersAssignedToGroup = sortState.preSortState.filter((t) => t.destinationGroupId === i + 1);

            if (allMembersAssignedToGroup.length < currSmallestCount) {
                currSmallestCount = allMembersAssignedToGroup.length;
                groupWithSmallestCount = i + 1;
            }
        }
        
        sortState.preSortState.push({
            currentIndex: curr.currentIndex,
            destinationGroupId: groupWithSmallestCount,
            playerName: curr.playerName,
        });
    }

    for (const curr of sortState.preSortState) {
        // We go one by one to make sure each player goes to the correct position
        SolvePlayerPosition(curr, sortState.preSortState);
    }
}


// START SETUP
setWowRaidSimulation(raid);

const targetRaid = [
    ["Tearyn","Wwolf","Kimepo","Eyvor","Pignose"],
    ["Vysha","Krint","Wolfsun","Libriyum","Lockfel"],
    ["Bibimbap","Barakary","Justhealing","Zugpriest","Milfred"],
    ["Datoliina","Goodina","Grumbus","Verylongname","Dirkwarlock"],
    ["Mich","Lutaryon"],
    ["Paynex","Ashgiver"],
    ["Boomstronk","Svajone"],
    ["Snace","Darkshivan"],
];

SortRaid(targetRaid);

printRaid()
