---
name: lean-delegation
description: Cost-disciplined way to delegate multi-step coding work to subagents (implement, verify, fix) without losing quality. Use whenever a task will be split across subagents or a stage workflow, when the user asks to cut token use or time of agent runs, or before writing a Workflow script that spawns implementers and reviewers.
---

# Lean delegation

Subagent cost is mostly **cache reads ≈ tool calls × context size at each call**. Output tokens are a small share. Cache-read prices are the same on Sonnet and Opus, so switching models alone barely changes cost; Haiku reads are about 20× cheaper. To cut cost, **keep every agent's context small and its call count low**, and hold the quality gates fixed.

Measured on a real stage: wall clock 160 → 60 min, cache reads −90%, estimated agent cost $62 → $8. Quality gates stayed the same, and the single reviewer still found a real major issue.

## The pipeline for one unit of work

| Step | Agent (from `~/.claude/agents`) | Effort | Notes |
|---|---|---|---|
| 1. Code map | `lean-finder` (Haiku) | low | ≤ 180 lines: `file:start-end`, symbol, what changes. grep and line ranges only. |
| 2. Implement | `lean-implementer` (Sonnet), one per owner, in order | high | The brief includes the code map and a handoff path. After ~60 calls, write the handoff file and stop; a fresh implementer continues (≤ 3 batons). |
| 3. Patch | `lean-gate` | low | Write the unit's diff, including new files, to `SP/diff-<unit>.patch`. |
| 4a. Gate | `lean-gate` (Haiku) | low | Full test suite plus the slow/integration suite, once. One line per check. |
| 4b. Review | `lean-reviewer` (Opus), **one**, in parallel with 4a | high | Reads the patch first and opens files only where needed. Spec checklist plus correctness in one pass. |
| 4c. Optional critic | `lean-reviewer` with a visual or UX lens | high | Only when there is art or UI to judge. |
| 5. Fix | `lean-fixer` (Sonnet), **one** that owns all files | high | Verifies each finding before fixing it. One round. |
| 6. Final gate | `lean-gate` | low | Rerun what the fix touched, or the full set if unsure. |
| 7. Orchestrator check | you | — | See "Before you commit" below. |

**Effort:** low for mechanical work (gate, finder), medium for mapping and measuring, high for implementing, fixing and reviewing. Use **xhigh only as an exception**: a fix that failed twice, or a hard design call.

**Skip steps** for small changes: a one-file fix needs no code map, no batons and no patch file. Use one implementer, then the gate and review.

## Brief template (keep it short; agents reread it on every call)

```
UNIT <name>: <one-paragraph goal>
SPEC: <file/section to quote as a checklist>; user-decided numbers: <...>
OWN: <files/dirs this agent may edit>; everything else read-only
CODE MAP: <pasted from the finder>
DOMAIN CHECKLIST: <the project's interrupt/edge matrix, e.g. cancel, retry, concurrent edit, resource vanishes>
DONE WHEN: <tests to add with thresholds>; run only the affected slow/integration checks (3× at the end)
HANDOFF FILE: SP/handoff-<unit>-<owner>-<n>.md
Never change an existing test's assertion to make it pass: stop and report the conflict.
```

`templates/workflow.js` runs the whole pipeline with the Workflow tool. Use it **only when the user opted into workflows**. Otherwise run the same steps one by one with the Agent tool (`subagent_type: lean-…`); effort comes from each agent definition.

## Rules for you, the orchestrator

- Your own context is the biggest one. Batch independent tool calls, filter long output (`| tail`, `| grep`), read agent results as summaries, and delegate big reads to `lean-finder` or `lean-explorer`.
- Start long multi-unit runs in a **fresh session** with a short handoff file. Agent definitions are also only loaded at session start.
- Only one agent builds or runs tests at a time. Readers never touch build output. A reader that must execute code builds an isolated copy.
- Docs and commits are yours. Agents never commit.

## Before you commit (quality gates that stay fixed)

1. Run the test suite yourself and the slow checks for this unit.
2. Run `git diff <tests> | grep -E '^-\s+(assert|expect)'` and justify every removed assertion.
3. Look at one artefact yourself (a screenshot, the output, or the diff of a generated file).
4. Update the docs, then commit.

## Project prerequisites (do once per project)

- **Quiet test output by default:** one summary line per suite plus failures, with a `--verbose` flag. Agents otherwise pull hundreds of passing lines into context.
- **Project facts belong in the project:** `CLAUDE.md` holds commands and rules, and the domain checklist goes in the brief. Keep the user-level `~/.claude/CLAUDE.md` short, because it is injected into every agent call.
- **Split huge files** (over about 2,000 lines) that every unit reads. Integration scenarios work well one file each.
- **Project-specific agents** (e.g. `<project>-implementer`) may override these. Copy the generic one and add the project's rules.

## Measuring

Run `python3 ~/.claude/skills/lean-delegation/profile_agents.py <subagents or workflow transcript dir>`. It prints per agent:
- calls;
- context at start and end;
- cache reads and writes;
- output;
- estimated $;
- time per tool.

Healthy numbers: starting context 16–30k, implementers ending under ~200k, about 60 calls or fewer per agent. Record each unit's numbers and lessons in a git-excluded log in the project, and apply the lessons to the next brief.
