# Documentation

Ordered by what you are trying to do, not alphabetically.

## I want to understand what this is

1. [`../ABOUT.md`](../ABOUT.md) — the loss class and why per-transaction scoring cannot see it.
   Two minutes.
2. [`algorithm.md`](algorithm.md) — the actual contribution. Graph construction, Louvain, and the
   corroboration ceiling that took precision from 41.7% to 100% without losing recall. Read the
   "bug we found and fixed" section even if you skip the rest; it is the whole argument.
3. [`../Architecture.md`](../Architecture.md) — components, data model, the two detector engines,
   environment.

## I want to check whether the numbers are real

[`metrics.md`](metrics.md). Every figure quoted anywhere in this repo, the JSON file that holds it,
and the command that regenerates it. Six of the seven measurement files reproduce byte for byte.

It also lists the numbers that deliberately do not exist, and why inventing them would cost more
than the gap does.

## I want to run it

[`running.md`](running.md). Three processes and a database, the ports they expect, how to seed data
through the live agent rather than around it, and how to send a signed webhook by hand.

Read the traps section at the bottom first. Every item in it has already cost someone hours.

## I want to know if it works

[`testing.md`](testing.md). 103 tests across two runners, what each file covers, and the ten that
**skip silently** without a Postgres so a green run can mislead you.

[`verification.md`](verification.md) records an end-to-end verification pass: every endpoint, the
webhook signature matrix, the hold state machine, and what could not be verified.

## I want to change something

[`principles.md`](principles.md). Nine constraints the code cites by number, and the database
constraint, call-graph isolation or test that enforces each. If a change would break one of these,
that is the conversation to have first.

[`api.md`](api.md) for the HTTP contract as implemented. The live spec is always
`GET /api/openapi.json`; this file is the readable version.

## I am presenting this

[`../Design.md`](../Design.md) for the console screens and what each one is arguing.
[`demo-script.md`](demo-script.md) for a five-minute run.
[`submission-draft.md`](submission-draft.md) for prepared form answers.

---

## The one-paragraph version

Coordinated multi-account abuse is invisible per transaction and only exists in the relationships
between accounts. The hard part is that families are connected too: a shared address, a shared card
and orders at the same hour describe a fraud ring and a household equally well. This scores
corroboration rather than connection density, caps any group whose every link has an ordinary
household explanation below the flagging threshold, and holds funds by declining to capture rather
than by cancelling anything. A human makes every final call, and the agent's only power is to not
act.
