---
summary: "Self-learning modes and the skills.workshop approval, autonomy, and size settings"
title: "Self-learning and approval settings"
read_when:
  - You are configuring Skill Workshop approval, autonomy, or limits
  - You want to understand where self-learning proposals are reviewed
  - You are scanning past sessions from the Control UI
---

## Self-learning

After substantial work, a detached background review can turn corrections and
successful procedures into reusable Workshop skills; see
[Self-learning](/tools/self-learning). Set `skills.workshop.autonomous.mode` to
`propose` to create pending proposals, or to `auto` to publish checked instruction-only
autonomous proposals. Script-backed tools always wait for approval. The Control UI Workshop tab shows
whether self-learning is on; use the config setting to choose all three modes.

### Scan past sessions

The Control UI can review older work without enabling autonomous self-learning.
Open **Plugins → Workshop** and select **Learn from past conversations**. A normal
session opens with the mining instructions, using the selected agent's configured
model, permitted tools, existing skills, and accessible conversation history.

The agent decides what to read and whether the evidence warrants a skill change.
It follows the current Workshop mode: `auto` permits direct improvements and
`propose` leaves suggestions for approval. No separate scanner selects transcripts
or limits the run to a fixed number of conversations or proposals.

Watch, steer, or stop the work in chat. The session keeps its instructions and
outcome instead of separate coverage counters. A manual request does not change
the self-learning setting. Normal session capacity, permissions, provider pricing,
and data-handling terms apply.

In `propose` and `auto` modes, Branch Agent can review one finished substantial turn
after the agent system becomes idle. It records the finished turn's boundary and
reads that turn's model context asynchronously with the same provider and model.
Review transcript and session metadata stay detached from foreground work.
Incognito turns are excluded from automatic experience review.
In both modes, only `skill_workshop` executes and the reviewer can stage one
pending mutation. The runtime publishes instruction-only autonomous proposals
after a successful `auto` review. Manual drafts and tools remain pending.
The review inherits source permissions; raw file and shell tools cannot bypass
the configured highest step. Failed reviews leave their drafts pending.

Weekly collection maintenance retains rooted directory listing and file reads
for its audit, but all mutations use `skill_workshop` proposals. Raw writes,
patches, and shell execution are unavailable in that scheduled review, so it
respects the same highest-step and tool-publication approval policy.

See [Self-learning](/tools/self-learning) for enablement, eligibility, privacy and cost details,
the proposal threshold, and troubleshooting.

## Approval and autonomy

```json5
{
  skills: {
    workshop: {
      autonomous: {
        mode: "auto",
      },
      approvalPolicy: "auto",
      highestStep: "tool",
      maxPending: 50,
      maxSkillBytes: 40000,
    },
  },
}
```

| Setting           | Default  | Effect                                                                                                                                                                                               |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `autonomous.mode` | `"auto"` | `"off"` disables autonomous capture, `"propose"` leaves drafts pending, and `"auto"` publishes checked instruction-only autonomous proposals.                                                        |
| `approvalPolicy`  | `"auto"` | Controls skill lifecycle prompts. Tool publication always requires approval of the exact revision, regardless of this setting.                                                                       |
| `highestStep`     | `"tool"` | `"skill"` permits instructions and document support files only. `"tool"` also permits script-backed skills, with approval before publication. The default preserves existing bundled-script support. |
| `maxPending`      | `50`     | Caps pending and quarantined proposals per agent (1-200).                                                                                                                                            |
| `maxSkillBytes`   | `40000`  | Caps proposal body size in bytes (1024-200000). Autonomous proposals also have a 10,000-character cap.                                                                                               |

The selected model reviews retained evidence before deciding whether a durable
procedure needs an update. Foreground work does not wait for that review. It
starts only when the foreground runtime reports its resolved model and actual
`skill_workshop` availability; restrictive or unknown tool policy fails closed.

Source deletion, replacement, or permission changes invalidate retained review
authority. Automatic publication retains the proposal scanner, exact-revision
binding, evaluator checks, and rollback metadata.

In `propose` mode, the reviewer can read or prepare an exact span before staging
one pending mutation. Existing-skill proposals retain read receipts, content-hash
binding, size validation, and normal apply-time scanning and rollback metadata.
Immediate foreground repair also retains the normal proposal apply path in
`auto` mode; tool-code changes still require approval.

## Highest step

Settings → Seasons → Skill learning shows the effective mode and highest step.
Selecting **A skill** writes the real configuration key:

```bash
branch config get skills.workshop.highestStep
branch config set skills.workshop.highestStep skill
```

The engine checks the limit when creating, revising, and publishing proposals,
including drafts created before the limit was lowered. **Its own tool** means
a skill with runnable support files under `scripts/`, invoked through the normal
execution tools and their execution approval policy. Publication approval is
single-use and bound to the exact proposal revision; denial or timeout leaves
the tool inactive. The operator can also review and explicitly apply a draft
through Workshop or `branch skills workshop apply`.

Budding does not install add-ons; use Seedbank. Branch-code changes are allowed
only through reviewed pull requests, never live self-modification. Neither is
an accepted `highestStep` value, and both choices are disabled with an explanation.

See [Self-learning](/tools/self-learning) for the complete autonomous review behavior and safety
model.

Proposal descriptions are always capped at 160 bytes, independent of
`maxSkillBytes`.
