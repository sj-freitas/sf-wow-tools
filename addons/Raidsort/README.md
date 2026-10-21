# Raid Sort

Paste a raid setup and Raid Sort puts everyone in the raid into their groups, then hands out the
raid roles: leader, assists, master looter, main tanks, main assists and raid marks.

Made for WoW Forever; works on Classic Era too.

## Quick start

1. Plan the raid in Guild Assistant: open the event's **Setup** tab and press **Export for addon**,
   then **Copy**. (Or write a setup by hand, see [The setup](#the-setup).)
2. In game, type `/raidsort` and press **Upload Config**.
3. Paste the setup and press **Save**.
4. Press **Invite & Sort**: it invites everyone, makes the group a raid and sorts it as they join.

The setup stays loaded until you close the game or upload another one. Nothing is saved between
sessions.

## Commands

| Command            | What it does                                                         |
| ------------------ | -------------------------------------------------------------------- |
| `/raidsort`        | Opens (or closes) the Raid Sort window                               |
| `/raidsort upload` | Opens the window to paste a setup                                    |
| `/raidsort sort`   | Sorts the raid by the loaded setup                                   |
| `/raidsort invite` | Invites everyone in the setup who isn't in your group yet            |
| `/raidsort auto`   | Turns [Auto-Invite](#auto-invite) on or off                          |
| `/raidsort help`   | Lists the commands                                                   |

`sort`, `invite` and `auto` open the upload window when no setup is loaded.

## The windows

**Raid Sort**, with no setup loaded:

- **Upload Config**: opens the upload window.
- **Close**.

**Raid Sort (Config Loaded)**, once a setup is loaded. It shows the event's name and how many
groups and players the setup has.

- **Re-upload Config**: opens the upload window with the current setup in it, to change or replace.
- **Invite & Sort**: invites everyone in the setup who isn't in the group, turns the party into a
  raid, and sorts it (see [Invite & Sort](#invite--sort)).
- **Close**.

**Upload window**: paste the setup into the text box.

- **Save**: loads it. If something is wrong with it, a red line under the box says what, and
  nothing is loaded.
- **Close**: goes back without changing anything.

Drag a window by its title bar. Escape closes it.

## Invite & Sort

**Invite & Sort** does the whole thing: it invites everyone in the setup who isn't in your group
(see [Inviting](#inviting)), then sorts the raid. If you're already in a raid it sorts right away,
and again each time someone joins, with a short "Sorted; waiting for: …" while people are still
missing. Once everyone is in, you get the full report below. It stops waiting after 2 minutes,
sorting one last time; press it again for anyone joining later.

## Sorting

`/raidsort sort` only sorts, without inviting. You need to be the raid leader or an assistant, out of
combat.

- Everyone in the setup goes to their group. Moving players takes the game a moment, so Raid Sort
  moves them in rounds and checks the raid after each one, until everyone is in place.
- Full groups are handled: players are swapped.
- People in the raid who aren't in the setup stay in their group if it has room. Otherwise they
  move to the free places, filling from group 8 back.
- Then it hands out the raid roles, and says in chat:
  - "Raid sorted."
  - who in the setup isn't in the raid;
  - who in the raid isn't in the setup;
  - anything it couldn't set (see below).

### Raid roles

Roles are only set for people who are in the raid, and only added: Raid Sort never takes assist,
a main tank or a mark away from anyone.

| Role         | Who can set it            | Notes                                                    |
| ------------ | ------------------------- | -------------------------------------------------------- |
| Assist       | Raid leader               | Given to anyone in the setup with assist who lacks it    |
| Main tank    | Raid leader or assistant  |                                                          |
| Main assist  | Raid leader or assistant  |                                                          |
| Raid mark    | Raid leader or assistant  |                                                          |
| Master loot  | Raid leader               | Only changed when the master looter is in the raid       |
| Leader       | Raid leader               | Done last, as it hands your leader rights over           |

If you're an assistant, Raid Sort sorts the raid and sets what it can, then lists what only the
leader can set. WoW Forever may not have master loot. If it doesn't, Raid Sort says
"Couldn't set master loot: this game doesn't seem to have it" and carries on.

## Inviting

`/raidsort invite` invites everyone in the setup who isn't in your group. A party only holds 5,
so it invites 4 first. When someone joins, it turns the party into a raid (if you're the
leader) and invites the rest. You need to be the leader or an assistant if you're already in a
group.

## Auto-Invite

When the setup comes from a Guild Assistant event with an **invite time**, the window shows an
**Auto-Invite (from 19:45)** checkbox (or use `/raidsort auto`). While it's on, from the invite
time it invites everyone in the setup who isn't in your group, once a minute, until the raid
starts or everyone is in; then it turns itself off and says why. Before the invite time it just
waits. Loading another setup turns it off. Times are the realm's clock.

## The setup

A setup is up to 8 groups of up to 5 players. Each player is written as their name:

```lua
{
  { "Dark Shivan", "Wwolf Test", "Tearyn" },   -- Group 1
  { "Some Name", "Other Name" },               -- Group 2
}
```

Leave a group empty with `{}`. Names are matched ignoring upper/lower case, spaces and dashes
("Dark Shivan" is "dark-shivan"). If no name matches exactly, a name also matches by its first
word when only one player has that first word.

### Adding raid roles

Write a player as `{ name = "…", … }` to give them roles:

```lua
{
  { "Dark Shivan", { name = "Wwolf Test", mainTank = true, mark = "skull" } },
  { { name = "Some Name", assist = true }, "Other Name" },
}
```

Or list roles for the whole setup, after the groups:

```lua
{
  { "Dark Shivan", "Wwolf Test" },
  { "Some Name", "Other Name" },
  leader = "Dark Shivan",
  masterLooter = "Some Name",
  assists = { "Wwolf Test", "Other Name" },
  mainTanks = { "Wwolf Test" },
}
```

| On a player              | For the whole setup        | Means                                     |
| ------------------------ | -------------------------- | ----------------------------------------- |
| `leader = true`          | `leader = "Name"`          | Raid leader (one player)                  |
| `assist = true`          | `assists = { "Name", … }`  | Raid assistant                            |
| `masterLooter = true`    | `masterLooter = "Name"`    | Master looter (one player)                |
| `mainTank = true`        | `mainTanks = { … }`        | Main tank                                 |
| `mainAssist = true`      | `mainAssists = { … }`      | Main assist                               |
| `mark = "skull"`         |                            | Raid mark: `skull`, `cross`, `square`, `moon`, `triangle`, `diamond`, `circle`, `star`, or 1-8 |

Everyone named in a role must be in one of the groups.

`event = "Molten Core"` names the setup; it's shown in the window. Guild Assistant's export adds
it, along with a comment line at the top (`-- …`), which is fine to keep.

### What Guild Assistant exports

The event's groups (not the bench), the leader, the master looter and the assists, as long as they're in
a group, and when the event and its invites start (`startsAt`, `invitesAt`, Unix time, for
Auto-Invite). The export window says if anything was left out.

## When Save says something is wrong

| Message                                   | Fix                                                        |
| ----------------------------------------- | ---------------------------------------------------------- |
| That isn't a Lua table: …                 | A missing `}`, `"` or `,`. Compare with the examples above |
| Group 3 has 6 players; a group holds 5    | Move someone to another group                              |
| A raid has at most 8 groups               | Remove the extra groups                                    |
| Name is in the setup twice                | Keep them in one group only                                |
| Name: unknown setting "asist"             | A typo in a role name: see the table above                 |
| Name: assist must be true or false        | Write `assist = true`, without quotes                      |
| "banana" isn't a raid mark                | Use one of the mark names, or 1-8                          |
| leader: Name isn't in any group           | Put them in a group, or remove the role                    |
| Only one player can be leader             | One leader and one master looter at most                   |
| Group 1: put each player in its own braces | Write `{ { name = "A", assist = true } }`, not `{ name = "A", assist = true }` |

Quotes pasted from documents or chat (“ ”) are fine. The pasted text can only describe a setup:
it can't run anything.
