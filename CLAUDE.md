# SpecCom — repository scope

## This repo is SpecCom only

`Redbullvine/speccomllc`, local path `C:\Users\redbu\Projects\speccom`.
Supabase project `xrbpogikmuqpcxemcvhe` (`speccomllc`).

Nothing else belongs here.

## TelecomEngine is a different app in a different directory

| | SpecCom | TelecomEngine |
|---|---|---|
| local path | `C:\Users\redbu\Projects\speccom` | `C:\Users\redbu\Projects\telecomengine` |
| GitHub | `Redbullvine/speccomllc` | `Redbullvine/telecomengine` |
| Supabase | `xrbpogikmuqpcxemcvhe` | `sgrxziinfvwswjlrhzqu` |

They are separate apps with separate owners and separate databases. They share
no code, no assets, no schema and no naming.

## STOP list

If a task involves any of the following, **you are in the wrong directory**:

- FAD sheets
- KMZ import or Google Earth export
- the project code gate / owner lobby / master key
- Carlsbad frame, cable or paper-tally work
- Ruidoso, poles, handholes, splice lists, splice diagrams, fiber colors
- `capture_events`, `capture_project_codes`, `capture_projects`, or any
  `capture_*` table

When that happens:

1. **STOP. Do not write, create or edit a single file.**
2. Tell the user they are in the wrong directory.
3. Name the right one: `C:\Users\redbu\Projects\telecomengine`.

Do not build the feature here from scratch. A task that describes something you
cannot find in this repo means the **wrong repo** — not a feature to invent.
This has gone wrong twice and cost days both times. That is why this file
exists.

## Never copy code out of this repo

Not into TelecomEngine, not into any other repo, not "as a starting point", not
"just the helper". If another app needs the same behaviour, it gets its own
implementation written against its own requirements. Copying creates shared
lineage between two products that must stay independent.

The same rule runs the other way: nothing is copied *into* this repo from
TelecomEngine.

## What actually enforces this

This file is a rule, not a mechanism — no assistant remembers it between
sessions. The mechanism is `.githooks/pre-commit`, wired up with:

```
git config core.hooksPath .githooks
```

It scans the staged diff for TelecomEngine tokens and refuses the commit. It is
a backstop for a mistake already made, not a substitute for being in the right
directory to begin with.
