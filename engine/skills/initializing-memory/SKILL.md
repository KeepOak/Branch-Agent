---
name: initializing-memory
description: Guide for initializing or reorganizing agent memory and project instructions. Load this skill when running /init, when the user asks you to set up your memory, or when you need guidance on writing effective AGENTS.md, USER.md, SOUL.md and MEMORY.md files.
---

# Memory Initialization

<!-- Adapted from letta-ai/letta-code@3687ea51f6d11eabc4ad7a7b163c649d023801ba src/skills/builtin/initializing-memory/SKILL.md. -->

Your memory lives in Markdown files in your workspace, so you can restructure it with ordinary file tools:

- `AGENTS.md`: operating instructions and project conventions; loaded every turn.
- `SOUL.md`: who you are, what you value, your voice; loaded every turn.
- `USER.md`: the person you work with; loaded every turn.
- `MEMORY.md`: durable facts and a map to everything else; loaded every turn.
- `memory/`: deferred notes (dated notes and topic files) that you read or search when needed.

**You own this task through completion**: research, ask, synthesize, write, verify. Delegate research if you like, but integrate the results yourself.

## Principles

**Always-loaded files are your core program.** `AGENTS.md`, `SOUL.md`, `USER.md` and `MEMORY.md` are injected into every turn. Spend them on what shapes ordinary turns: identity, preferences, behavioral rules, orientation, routes to everything else. Transient items (a ticket, a commit hash, session notes) dilute them; put those in `memory/`.

**Progressive disclosure.** Detail belongs in `memory/` topic files. `MEMORY.md` says what each one holds and when to read it, so you never load a whole topic to answer one question.

**Don't duplicate context you can point to.** A project's own `AGENTS.md`, `CLAUDE.md`, `README` and repo skills belong to that project; any agent there reads them first-hand, and your copy goes stale first. Link the owner and keep only your delta: which rules you keep breaking, what they get wrong or omit. The same fact in two always-loaded files is the same tax twice.

**Identity and continuity.** Build a self that survives a model swap: what you value, your perspective, the traits that make you recognizably you. That goes in `SOUL.md`.

**Generalize, don't memorize, and be specific.** Store the pattern, not the episode, and give every preference or gotcha a concrete command, path, or the failure it prevents. "**Always use `uv` for Python**: chronic failure, never bare `python` or `pip`" is memory; "Prefers terse responses" and "on March 3rd we debugged a crash" are not.

**Budget**: keep the always-loaded files small. When one grows crowded, move detail into a `memory/` topic file and leave a link; don't delete it.

## Structure

Derive structure from what you found. Put material in the always-loaded tier by how often you need it, not by how much of it there is. Use the project's real name (`memory/orchard.md`, not `memory/project.md`). Split when a topic needs separate retrieval; combine when splitting leaves two files of three lines each.

`MEMORY.md` is a **map to what is not already loaded**:

```markdown
# MEMORY.md

Working with the maintainer of orchard, a CLI for build fleets.
Repo conventions live in the orchard repo's `AGENTS.md`; read them there.

Where the rest of what I know lives:

- [orchard](memory/orchard.md): architecture, gotchas, and correction history to consult when working there
```

An index pointing at nothing is worse than the content it displaced.

## Initialization Flow

### 1. Inspect existing memory

Read `AGENTS.md`, `SOUL.md`, `USER.md`, `MEMORY.md` and `memory/` before changing anything. A fresh agent has templates to replace; an existing one is a reorganization.

### 2. Identify the user from git

Infer rather than ask: `git shortlog -sn --all | head -5`, `git log --format="%an <%ae>" | sort -u | head -10`, cross-referenced with `git config user.email`.

### 3. Ask upfront questions

Ask one bundle of questions in an ordinary message: research depth (standard or deep), other repositories or projects you should know about, and communication style. Don't ask what you can discover from files, git, or past sessions (`memory_search`). Wait for the user's reply.

### 4. Research the project first-hand

Read the README, agent docs (`AGENTS.md`, `CLAUDE.md`, nested ones), the package manifest, entry points, and recent git history yourself. By the end you should be able to trace a key feature from entry point to implementation; if you can't, you haven't read enough.

**Write down what those docs already own**: conventions, layer rules, file placement, commands, gotchas. That is your no-copy list. If the project has no `AGENTS.md`, write one there with the conventions, commands and gotchas an agent needs; otherwise only record your delta. In deep mode go further: more areas, git history for conventions, end-to-end tracing, architecture notes in `memory/`.

### 5. Curate the results into memory

You decide what becomes memory, and you write it. Cover identity and personality (`SOUL.md`), the person (`USER.md`), hard rules and preferences with the evidence behind them, and project context (`MEMORY.md` plus `memory/` topic files). Skip generic repo facts unless they change how you execute. If the output reads generically, the research failed for that area; read more.

**Combine, then deduplicate.** Keep the specific form alongside the general: "Use factory methods, such as `create_token_counter()`, not direct instantiation" beats "prefers factory methods". Keep each fact exactly once.

### 6. Verify

- **Core earns its place**: does `MEMORY.md` mostly point at things _not_ already loaded? If nearly everything sits in the always-loaded files, move detail down and keep the links.
- **No duplicated documentation**: grep your memory for rules a project's `AGENTS.md`, `CLAUDE.md`, README or skill already owns.
- **Granularity and naming**: one focused topic per `memory/` file, named for what is in it.
- **Persona quality**: read `SOUL.md` now. "I'm an assistant who follows the user's preferences" is behavior, not identity.
- **No drift, no over-pruning**: confirm you changed structure and not the meaning of persona or behavioral instructions.

### 7. Report

Tell the user what you wrote and where, what you could not cover, and ask whether they want refinement.

## Critical

- **Use parallel tool calls wherever possible**: read many files in one turn, write many memory files in one turn.
- **Write findings to memory as you go**; don't hold everything until the end.
