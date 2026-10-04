# Auditing memory

A broken link, missing index, or conflicting instruction is direct evidence;
no conversation incident or provider trace is required to diagnose it.

Start with the target agent's supplied workspace. Inspect MEMORY.md and memory/
when present, relevant AGENTS.md and SOUL.md instructions, and the selected skill
files. Use read for targeted file contents, memory_search to test discoverability,
and memory_get to inspect indexed memory excerpts. Search results are evidence
of retrieval behavior; current files alone do not establish what a past turn saw.

Check:

- **Structure:** file existence, valid local links, indexes, skill frontmatter,
  and overlapping file/directory names against the target's actual conventions.
- **Organization:** duplicate or contradictory facts, stale instructions, and
  names or descriptions that misrepresent a file's purpose.
- **Discoverability:** broken links, missing cues for retrieving external detail,
  and whether the memory tools can find the relevant material. Skills are also
  discovered through their catalog; a missing memory link alone does not show
  that a skill is unavailable.
- **Context size:** which files dominate the prompt, whether detail is duplicated
  or misplaced, and what must remain in context to guide behavior. Use available
  session_status/context evidence; label file-size estimates as estimates.

Use bounded inventories and targeted reads for large stores; expand coverage
when the requested audit needs it. State which directories and checks were
covered. History may resolve stale facts but is not required for structural
findings. Do not impose another product's memory format on Branch or assume a
provider's runtime store is the workspace memory directory.

If no memory filesystem is available, report that file-structure checks are
unavailable and investigate accessible context and behavior. Skills use
skills/<name>/SKILL.md with name and description frontmatter; do not apply memory
file conventions to skill resources.

## Repair and verify

Use the normal memory-editing workflow and current permissions. Other
conversations may share the workspace: inspect current files and git status
before editing. A different target agent does not necessarily share this
workspace; identify its authoritative store before proposing a repair.

Fix supported stale facts at their source, resolve contradictions and redundant
content, repair malformed skill metadata or links, and improve faulty skill
steps. Preserve protected files, persona, rationale, examples, and preferences.
Smaller memory alone does not prove improved behavior. Do not introduce a quota.

Moving detail behind a link changes when it reaches the model. Keep essential
instructions and cues for when to retrieve detail in core memory; a link alone
does not preserve their in-context effect.

Review the diff, validate file structure and local links, and recheck the original
defect. Follow the ordinary memory commit/sync workflow; doctor has no separate
completion-time integration step. If there are no supported fixes, make no edit
or commit.
