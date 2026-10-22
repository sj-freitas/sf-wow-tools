# GuildAssistant RaidSort

## 2.2.1

- Renamed GuildAssistant RaidSort (it was Raid Sort), like Guild Assistant's other addons. Same
  addon, same commands (`/ga-rs`).

## 2.2.0

- The command is now `/ga-rs` (also `/garaidsort` and `/ga-raidsort`), alongside Guild Assistant's
  other addons (`/ga-prof`). `/raidsort` no longer works.

## 2.1.0

- Auto-Invite: for a setup from a Guild Assistant event with an invite time, a checkbox (or
  `/raidsort auto`) invites everyone missing every minute from the invite time until the raid
  starts or everyone is in.
- Reads `startsAt` and `invitesAt` from Guild Assistant's export.

## 2.0.0

- Rewritten for WoW Forever (and Classic Era).
- New windows: Upload Config, then Invite & Sort (invites everyone, makes a raid, sorts as they join).
- Sorting works in rounds until everyone is in place, swapping people when groups are full.
- Raid roles from the setup: leader, assists, master looter, main tanks and assists, raid marks.
- Reads Guild Assistant's "Export for addon" as is.
