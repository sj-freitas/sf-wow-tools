---
name: ui-rules
description: Use whenever building or changing anything people see in the backoffice (discord/assistant-backoffice) — a page, table, form, drawer, dropdown, tooltip, message or loading state — from a board task or a chat request. Sérgio's four UX rules: always responsive, never a horizontal scroll, nothing that appears (tooltips, search results, messages, spinners) changes a row's or the layout's height, and no emojis (the site's own icons instead). Covers how to meet each with the backoffice's own pieces, and what to check before calling it done.
---

# The backoffice's UX rules

Every page, old or new, follows these four rules. They aren't nice-to-haves: a change that breaks
one isn't done. I can't see the UI myself, so I meet them by construction (the patterns below) and
list them in the test ticket for Sérgio to check (the **ui-test-ticket** skill).

## 1. Always responsive

It works at every width, from a 320px phone to a wide desktop, and with touch as well as a mouse.

- **Tables** stack into one card per row under 720px: put them in `.table-wrap` and give every
  `<td>` a `data-label` (the label each card line shows). The Roster and Import from armory do this.
- **Sections and tabs** become a dropdown on a phone (`GuildShell`'s `view-tabs` and
  `view-tabs-select`). Forms are one column there. Use `.wide-only` / `.phone-only` for anything
  that has to differ.
- **Nothing is hover-only.** A tooltip (`title`) can't be the only way to read something: on a
  phone, a tap must get to it too. Show it on a click as a toast (`showToast`), as `DiscordName`
  and the import page's errors do, or show it outright.
- Fields stay at 16px or more on phones (already global in `index.css`), so iOS doesn't zoom in.

## 2. No horizontal scrolling, ever

Neither the page, nor a table, nor a drawer, nor a dropdown scrolls sideways, at any width.

- **Long text** wraps, or is cut short with … and the whole text goes in its tooltip (and is
  reachable by a tap, rule 1). Examples are `.name-truncate` / `DiscordName`, and the import page's
  one-line status under a name (`max-width`, `overflow: hidden`, `text-overflow: ellipsis`).
- **Tables** fit their container. Let cells wrap, and keep `white-space: nowrap` for short things
  only: a class icon with its name, a rank, a button. Never rely on `.table-wrap`'s
  `overflow-x: auto`: it's a safety net, not a design.
- **Widths** come from `max-width: 100%`, `minmax(0, 1fr)`, `min()` and `flex-wrap`, not from a fixed
  width wider than a phone. A `min-width` on a column (a search box) is dropped under 720px.

## 3. Nothing that appears moves the layout

Tooltips, search results, autocomplete, "no match" notes, validation and error messages, loading
spinners, hover and selected states: none of them changes a row's height, a column's width, or
pushes what's below.

- **Put it over the page, not in it.** Search results and "No player matches" go in a
  `.dropdown-menu` (absolute, over the rows below; `PlayerPicker` with `compact` does this).
  Passing notes and long errors go in a toast (`showToast`). Panels go in a `Drawer`.
- **Overlays mustn't be cut off.** No ancestor of an overlay may have `overflow` set (`auto`,
  `hidden`, `scroll`), or the overlay is clipped or scrolls inside it. That's why
  `.table-wrap.armory-import-table` has `overflow: visible`.
- **States that alternate have the same size.** A picked player and the search box are both
  `--control-height`. A row's status under its name is always there and always one line ("Not on
  the roster", or the error cut short). A marker goes inline in what's already there ("(guess)"
  inside the picked box), not on a new line under it.
- **Buttons keep their size.** Their label stays on one line (`white-space: nowrap`), and a
  spinner goes inside the button (`InlineSpinner`), not next to it.
- When something must take space (a form's hint, a banner), the space is always reserved, or it
  appears where it pushes nothing: the top of a page, or a drawer.

Content that is long by nature, such as a long character name, may still wrap onto a second line:
better than a sideways scroll. What must never happen is a size change caused by hovering,
typing, clicking or loading.

## 4. No emojis: the site's own icons

Anything the backoffice shows as a symbol is one of its own line icons (`Icons.tsx`), in the
colour of what it means. That includes a status, a verdict, a close or search button, or a check
mark in a toast. It is never an emoji or a symbol character (✅ ⚠️ ❌ ✕ 🔍 ✓ ⏱ 🛡️). A
game-config image (`ClassMark`, `RoleMark`) also counts as one of the site's icons.

- **Use what's there:** `CheckCircleIcon`, `AlertTriangleIcon`, `XCircleIcon`, `HelpCircleIcon`,
  `ClockIcon`, `CalendarIcon` and the rest of `Icons.tsx`.
- **A new symbol gets a new icon there,** in the same style:
  - a 24×24 `viewBox`, a 2px stroke, `currentColor`;
  - `inline` (1em, `.icon-inline`) inside text, `base` (16px) in an icon-only button, which also
    gets a label.
- **Its colour says what it means:** `--success` for done or yes, `--gold` for a warning or
  waiting, `--danger` for no or a failure, `--accent` for unsure. The colour goes on the icon, not
  the text, through a class (`StatusIcon`, `.battlenet-verdict-<tone>`).
- **Beside text that wraps,** the icon sits in a flex row with the text in its own `<span>`, so a
  second line doesn't run under the icon (`BattleNetResultPage`'s verdict).
- **Except Discord's own content,** which stays as Discord shows it: reactions a post adds
  ("👍 👎"), a message's text (a honeypot's warning), a channel name, and the Discord posts
  themselves.
- **Emojis still left** in the backoffice are listed on GA-87. Touching one of those places means
  replacing it, and ticking it off there.

## Before calling it done

- Read the change against the four rules, in the code: every new `title` has a tap route, every
  new message appears over the page or in reserved space, every table cell can wrap or is short,
  no overlay sits inside an `overflow` container, and no emoji or symbol character stands in for
  an icon.
- `npx tsc -b`, `npm run lint` and `npm run build` pass in `discord/assistant-backoffice`.
- The test ticket's **Also check** (ui-test-ticket skill) asks Sérgio for a phone width (no
  sideways scroll, tables as cards) and for the interactions that might move things (search, pick,
  error, loading), with rows staying put.
