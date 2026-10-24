---
name: lean-delegation
description: Cost-disciplined way to delegate multi-step coding work to subagents (implement, verify, fix) without losing quality. Use when implementation work will be split across subagents or a stage workflow, when the user asks to cut token use or time of agent runs, or before writing a Workflow script that spawns implementers and reviewers. Not for a single lookup or read-only research.
---

# Lean delegation

Subagent cost is mostly **cache reads ≈ tool calls × context size at each call**; output tokens are a small share. At API prices, cache reads cost the same on Sonnet and Opus and about 20× less on Haiku (check the claude-api skill for current prices), so switching models alone barely changes cost. Subscription usage limits may weight models differently, so there model choice can matter more. To cut cost, **keep every agent's context small and its call count low**, and hold the quality gates fixed.

Measured on one stage of a TypeScript project, against a stage twice its size: wall clock 160 → 60 min (−25% per 1k changed lines), cache reads −90%, estimated agent cost $62 → $8 (−74% per 1k lines). Quality gates stayed the same, and the single reviewer still found a real major issue.

## When to delegate

- Delegate work that would fill your own context (many files, long test output) or that can run while you do something else.
- Do a change yourself when it takes a few tool calls: every agent first pays its starting context (16–30k with these agents).
- Not for single lookups or read-only research (use one agent directly), and not for design decisions: settle those, with the user if needed, before writing briefs.

## The pipeline for one unit of work

SP is the run folder (see "Rules for you, the orchestrator"). The agents load from this plugin as `lean-delegation:<name>`, e.g. `lean-delegation:lean-finder`; the names below leave the prefix out.

| Step | Agent | Effort | Notes |
|---|---|---|---|
| 1. Code map | `lean-finder` (Haiku) | low | ≤ 180 lines: `file:start-end`, symbol, what changes. grep and line ranges only. Line numbers are hints; implementers confirm them with grep. |
| 2. Implement | `lean-implementer` (Sonnet), one per owner, in order | high | The brief includes the code map and a handoff path. After ~60 calls, write the handoff file and stop; a fresh implementer continues (≤ 3 batons). If an implementer reports `blocked`, returns nothing, or still hands off after the third baton, stop the unit and report: do not review half-done work. |
| 3. Patch | you, or `lean-gate` in a workflow | low | Write `git diff HEAD --stat`, the new-file list, `git diff HEAD -U10` and each new file to `SP/diff-<unit>.patch`. Ten context lines let the reviewer judge hunks without opening the files. |
| 4a. Gate | `lean-gate` (Haiku) | low | The project's pre-commit checks (unit tests, type check, the slow suite), once. One line per check, judged by exit code. |
| 4b. Review | `lean-reviewer` (Opus), in parallel with 4a | high | Give it the patch path, its line count and the implementers' reported decisions. It reads the patch first; outside it, one focused check per named risk. Spec checklist plus correctness in one pass. Do not add open-ended asks like "check all uses" without a concrete reason. **One** reviewer by default; add a second only for a named high-risk area (security, persistence, concurrency), limited to that area. |
| 4c. Optional critic | `lean-reviewer` with a visual or UX lens | high | Only when there is art or UI to judge. It judges artefacts that exist when it starts (e.g. the implementer's last captures); if it needs the gate's artefacts, start it after the gate. |
| 5. Fix | `lean-fixer` (Sonnet), **one** that owns all files | high | Verifies each finding before fixing it; reports, and does not apply, findings that contradict the brief or a user decision. One round. |
| 6. Final gate | `lean-gate` | low | Rerun what the fix touched, or the full set if unsure. |
| 7. Orchestrator check | you | — | If the final gate fails: one more fix limited to the failing checks, at effort `xhigh`; if that fails too, stop and report. Then see "Before you finish a unit" below. |

**Effort.** Each agent's definition sets its default: low for gate and finder, medium for explorer, high for implementer, fixer and reviewer. Raise it only when the user asks, or to `xhigh` for the one retry in step 7.

**Size.** Keep a unit's patch under about 3,000 lines at `-U10`. Split a bigger unit by owner or file group, each part with its own patch and review.

**Small changes.** If you delegate one at all: no code map, batons or patch file; one implementer, then the gate and review.

**Batch same-shape work.** Several small edits of one kind, such as the same rename, type alias or attribute repeated across files, are one unit: one brief listing every file and its change, one implementer, one review of one diff. Ten one-line tasks as ten units pay ten starting contexts. Keep work that needs its own judgment or its own tests as separate units.

## Brief template (keep it short; agents reread it on every call)

```
UNIT <name>: <one-paragraph goal>
SP: <run folder>
SPEC: <file/section to quote as a checklist>; user-decided numbers: <...>
OWN: <files/dirs this agent may edit, with their tests and any build or registration files the unit needs>; everything else read-only
CODE MAP: <pasted from the finder; line numbers are hints>
DOMAIN CHECKLIST: <the project's interrupt/edge matrix, e.g. cancel, retry, concurrent edit, resource vanishes>
DONE WHEN: <tests to add with thresholds>; the affected slow/integration checks (3× at the end for checks that can flake)
HANDOFF FILE: SP/handoff-<unit>-<owner>-<n>.md
Change an existing assertion only where this brief says the behaviour it checks changes; any other conflict with a test: stop and report it.
```

The code map is the one long part; it saves more exploration than it costs.

`templates/workflow.js` runs the whole pipeline with the Workflow tool. Use it **only when the user opted into workflows**. Otherwise run the same steps one by one with the Agent tool (`subagent_type: lean-delegation:lean-…`): wait for each step's result before starting the next (Agent runs in the background by default), and never start a builder while another runs. Effort comes from each agent definition.

## Rules for you, the orchestrator

- Your own context is the biggest one. Batch independent tool calls, filter long output, read agent results as summaries, and delegate big reads to `lean-finder` or `lean-explorer` (in plan mode, to the agent types plan mode allows).
- **SP** is the run folder for briefs, patches, logs, handoffs and the ledger. Put it where git ignores it and a new session can read it: `<repo>/.lean/<run>/`, with `.lean/` in `.git/info/exclude`. A session scratchpad does not work: each session gets its own.
- Start long multi-unit runs in a **fresh session** with a short handoff file in SP. Agent definitions you change load only in a new session.
- **Keep a progress ledger** at `SP/progress.md` for any run with more than one unit or phase. Write one line as each finishes, e.g. `Unit <name>: complete (patch SP/diff-<name>.patch, gate pass, 1 fix round)` or `Phase design: complete (workflow wf_…, result SP/design.md)`. A check that did not run (usage limit, crash, timeout) is written as `unverified: <check>`, never as a pass. After a compaction, trust the ledger and `git status` over your memory, and resume at the first unit without a line. Re-dispatching finished units is the most expensive failure of a long run. Inside one workflow the script already holds this state; the ledger covers the gaps between workflows and Agent-tool runs. You write it, not the agents.
- **Commits.** At the start of a multi-unit run, ask the user whether to commit each unit locally on a branch (not the default branch). Per-unit commits keep each patch to its own unit and give rollback points. Without them, build each patch from the unit's owned paths. Agents never commit.
- Only one agent builds or runs tests at a time. Readers never touch build output. A reader that must execute code builds an isolated copy of the working tree; a git worktree starts from the last commit, without the unit's uncommitted changes.
- Project docs (README, changelog, design docs) are yours; code comments and docstrings belong to the code.

## Before you finish a unit (quality gates that stay fixed)

1. Rerun the unit tests yourself (summary line) and the slow checks for this unit.
2. List the test lines the unit removed: `git diff HEAD -U0 -- <test paths> | grep '^-' | grep -v '^---'`. Every removed or weakened check needs a brief line or a finding that requires it.
3. Look at one artefact yourself (a screenshot, the output, or the diff of a generated file).
4. Update the project docs, write the ledger line, and commit if the user agreed to per-unit commits.

## Project prerequisites (do once per project)

- **Quiet test output by default:** one summary line per suite plus failures, with a `--verbose` flag. Agents otherwise pull hundreds of passing lines into context.
- **Project facts belong in the project:** `CLAUDE.md` holds commands and rules, and the domain checklist goes in the brief. Keep the user-level `~/.claude/CLAUDE.md` short: every agent loads it too, on every call.
- **Split huge files** (over about 2,000 lines) that every unit reads, if the user agrees. Integration scenarios work well one file each.
- **Project-specific agents** (e.g. `<project>-implementer`) may override these. Copy the generic one, add the project's rules, and pass the names to the template through `args.agents`.

## Measuring

Run `python3 <this skill's folder>/profile_agents.py <subagents or workflow transcript dir>`. It prints per agent:
- calls;
- context at start and end;
- cache reads and writes;
- output;
- estimated $;
- time per tool.

First reference values, from one TypeScript project (a brief may set others): starting context 16–30k, implementers ending under ~200k, about 60 calls or fewer per agent. Record each unit's numbers and lessons in a git-excluded log in the project, and apply the lessons to the next brief. Profile right after a run: transcripts go when their session is deleted.

Not measured yet, worth trying: an Opus implementer on a subtle unit (same cache-read price, possibly fewer calls); effort changes alone; whether the `-U10` patch lowers what the reviewer finds.
