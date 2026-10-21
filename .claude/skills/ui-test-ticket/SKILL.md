---
name: ui-test-ticket
description: Use after making a UI change that Sérgio asked for ad hoc in chat (not as a board task) — anything he'll see in the backoffice (discord/assistant-backoffice), in Discord posts or messages, or in an addon's windows — to create the Botlog ticket that has him test it by hand.
---

# A UI test ticket for an ad-hoc request

I can build, type-check and lint the UI, but I can't look at it. So when Sérgio asks in chat for
a UI change (a page, a layout, a button, a drawer, wording, a Discord post's look, an addon
window) and I've made it, he gets a ticket to try it.

Not for changes that came from a board task: that task is already his to check.

## The ticket

Once the change is done and its checks pass (`npx tsc -b`, `npm run lint`, `npm run build`), create
one Botlog task (project GA, `create_task`):

- **assignee** Sérgio: `user:a9f2ac22-c8eb-4216-880d-74e8fc6df1fc`
- **status** todo, **type** improvement, **label** `UX UI` (plus the feature's label when there
  is one, e.g. `Professions`), and the epic the feature belongs to
- **title**: `Test: <what changed, in his words>` (e.g. `Test: View Characters as text with a chevron`)
- **description**, short and concrete:
  - **What changed**: one or two sentences.
  - **Where**: the page and how to get there (e.g. `…/guilds/<guild>/professions`, open a
    profession), and who sees it if it depends on the role (owner, Officer, member).
  - **Try**: numbered steps, each with what should happen.
  - **Also check**: the edge cases that matter (a phone-width window, light/dark, nothing to show,
    a long name, someone without the right).
  - **Needs first**, when it does: a deploy, `npm run prisma:deploy`, `npm run commands:register`.

## One ticket per feature

Several requests about the same feature in one conversation (a fix, then a tweak, then another)
go in **one** ticket: if a test ticket for it was created earlier in this conversation and is
still in To do, update its description (`update_task`) with the new steps instead of creating
another. A different feature gets its own.

Name the ticket (`GA-<n>`) in the reply to Sérgio.
