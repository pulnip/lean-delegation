export const meta = {
  name: 'lean-unit',
  description: 'Lean delegated unit: Haiku code map, baton-passing Sonnet implementers, Haiku gate + one Opus reviewer on the patch (+ optional critic), one fix round, final gate',
  phases: [
    { title: 'Map', detail: 'lean-finder code map', model: 'haiku' },
    { title: 'Implement', detail: 'lean-implementer per owner, baton handoff' },
    { title: 'Verify', detail: 'patch, Haiku gate, one Opus reviewer, optional critic' },
    { title: 'Fix', detail: 'one lean-fixer owning every file' },
    { title: 'Final gate', detail: 'Haiku gate', model: 'haiku' },
  ],
}

// args: {
//   repo: '/abs/path', unit: 'name',
//   sp: '/abs/path/.lean/<run>',  // run folder: git-excluded and readable by a new session
//   ctx: 'shared context: spec file/section, user-decided numbers, domain checklist, read-only rules',
//   mapQ: 'what the code map must cover',
//   impl: [{ key: 'core', own: 'files you may edit, with their tests and build/registration files', task: 'what to build + tests + done-when' }],
//   gate: 'commands to run, one line per check',
//   review: 'unit-specific correctness concerns',
//   critic: 'optional visual/UX lens prompt',
//   criticAfterGate: false,       // true when the critic judges artefacts the gate produces
//   patchPaths: 'src tests',      // paths the patch covers; the unit's owned paths when units are not committed one by one
//   agents: { finder, implementer, gate, reviewer, fixer },  // optional overrides, e.g. project-specific agents
//   ns: 'lean-delegation:',       // agent name prefix; the plugin's default. '' for agents installed as plain files
//   effort: { fixer: 'xhigh' },   // optional per-role effort, only when the user asked or for the step-7 retry
// }
const A = args
const NS = A.ns ?? 'lean-delegation:'
const AG = Object.assign({ finder: NS + 'lean-finder', implementer: NS + 'lean-implementer', gate: NS + 'lean-gate', reviewer: NS + 'lean-reviewer', fixer: NS + 'lean-fixer' }, A.agents || {})
const EFFORT = A.effort || {}
const MAX_BATONS = 3
const PATHS = A.patchPaths || '.'
const BASE = [
  'Repository: ' + A.repo + '. Run folder SP = ' + A.sp + '.',
  'Never change git state (no add, commit, push, reset, checkout, restore, stash or clean). The orchestrator owns project docs and commits.',
  'Only the agent told it may build/test/launch does so; everyone else is read-only and must not touch build output.',
].join('\n')
const CTX = BASE + '\n\nUNIT ' + A.unit + ':\n' + A.ctx

const IMPL = { type: 'object', properties: { status: { type: 'string', enum: ['done', 'handoff', 'blocked'] }, summary: { type: 'string' }, filesChanged: { type: 'array', items: { type: 'string' } }, verification: { type: 'string' }, openIssues: { type: 'array', items: { type: 'string' } } }, required: ['status', 'summary', 'filesChanged', 'verification', 'openIssues'] }
const GATE = { type: 'object', properties: { pass: { type: 'boolean' }, checks: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, ok: { type: 'boolean' }, detail: { type: 'string' } }, required: ['name', 'ok', 'detail'] } } }, required: ['pass', 'checks'] }
const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, file: { type: 'string' }, summary: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['id', 'severity', 'file', 'summary', 'evidence', 'fix'] } } }, required: ['findings'] }
const MAP = { type: 'object', properties: { map: { type: 'string' } }, required: ['map'] }
const PATCH = { type: 'object', properties: { lines: { type: 'number' }, files: { type: 'array', items: { type: 'string' } } }, required: ['lines', 'files'] }

const run = (role, prompt, opts) => agent(prompt, Object.assign({ agentType: AG[role] }, EFFORT[role] ? { effort: EFFORT[role] } : {}, opts))

phase('Map')
const mapRes = await run('finder', CTX + '\n\nBuild a CODE MAP for this unit, at most 180 lines, in the `map` field: file:startLine-endLine — symbol — what is there / what changes. grep -n and line ranges only. Cover:\n' + A.mapQ, { label: 'code map', phase: 'Map', schema: MAP })
const CODEMAP = mapRes ? mapRes.map : '(no code map: locate things with grep -n)'

phase('Implement')
const impl = {}
for (const im of A.impl) {
  const runs = []
  for (let n = 1; n <= MAX_BATONS; n++) {
    const baton = A.sp + '/handoff-' + A.unit + '-' + im.key + '-' + n + '.md'
    const prev = n > 1 ? A.sp + '/handoff-' + A.unit + '-' + im.key + '-' + (n - 1) + '.md' : null
    const resume = prev ? 'CONTINUE a previous implementer: read ' + prev + ' first, then `git diff --stat` and only the hunks you need. Do not redo finished work.\n' : ''
    const r = await run('implementer', CTX + '\n\nYou are the ' + im.key.toUpperCase() + ' implementer. OWN: ' + im.own + '\nYou may build/test now (earlier owners finished; later ones wait).\nHANDOFF FILE: ' + baton + '\n' + resume + '\nCODE MAP (line numbers are hints: confirm with grep -n before editing):\n' + CODEMAP + '\n\nTASK:\n' + im.task, { label: 'impl ' + im.key + ' #' + n, phase: 'Implement', schema: IMPL })
    runs.push(r)
    if (!r || r.status !== 'handoff') break
  }
  impl[im.key] = runs
  // Half-done work is not reviewed: a blocked, failed or endless implementer stops the unit
  const last = runs[runs.length - 1]
  if (!last || last.status !== 'done') {
    const stopped = 'impl ' + im.key + ': ' + (!last ? 'no result' : last.status === 'handoff' ? 'still handing off after ' + MAX_BATONS + ' batons' : 'blocked')
    log('stopped: ' + stopped)
    return { unit: A.unit, stopped, impl }
  }
}

phase('Verify')
const patchFile = A.sp + '/diff-' + A.unit + '.patch'
const newFiles = 'git ls-files --others --exclude-standard -- ' + PATHS
const patchCmd = 'cd ' + A.repo + ' && { git diff HEAD --stat -- ' + PATHS + '; ' + newFiles + ' | sed "s/^/ new: /"; git diff HEAD -U10 -- ' + PATHS + '; ' + newFiles + ' | while read f; do git diff --no-index /dev/null "$f"; done; } > ' + patchFile + '; wc -l < ' + patchFile + '; git status --porcelain'
const patch = await run('gate', 'Repository ' + A.repo + '. Write the unit patch and nothing else. Run exactly:\n' + patchCmd + '\nReturn the line count and changed/new files.', { label: 'patch', phase: 'Verify', schema: PATCH })
const notes = Object.entries(impl).map(([key, runs]) => key + ': ' + runs.filter(Boolean).map(r => r.summary + (r.openIssues.length ? '\nOpen issues and decisions: ' + r.openIssues.join('; ') : '')).join('\n')).join('\n\n')
const patchNote = patch ? patch.lines + ' lines; read it first, once, in 2,000-line chunks if longer' : 'line count unknown; if the file is missing, read `git diff HEAD -U10 -- ' + PATHS + '` instead'
const reviewPrompt = CTX + '\n\nREVIEW this unit. Patch: ' + patchFile + ' (' + patchNote + ').\nImplementer notes (a deviation justified here is not a finding):\n' + notes + '\n\n' + (A.review || '')
const criticPrompt = CTX + '\n\nCRITIC lens. ' + (A.critic || '')
const gatePrompt = (round) => CTX + '\n\nGATE (round ' + round + '). ' + A.gate + '\nSave each check\'s full output as ' + A.sp + '/gate' + round + '-<check>.log.'
const thunks = [
  () => run('gate', gatePrompt(1), { label: 'gate 1', phase: 'Verify', schema: GATE }),
  () => run('reviewer', reviewPrompt, { label: 'review', phase: 'Verify', schema: FINDINGS }),
]
if (A.critic && !A.criticAfterGate) thunks.push(() => run('reviewer', criticPrompt, { label: 'critic', phase: 'Verify', schema: FINDINGS }))
const [gate1, review, criticBeside] = await parallel(thunks)
const critic = A.critic && A.criticAfterGate ? await run('reviewer', criticPrompt, { label: 'critic', phase: 'Verify', schema: FINDINGS }) : criticBeside

// A lens that returned nothing did not run: it is unverified, never clean
const unverified = []
if (!patch) unverified.push('patch')
if (!gate1) unverified.push('gate 1')
if (!review) unverified.push('review')
if (A.critic && !critic) unverified.push('critic')

const issues = []
if (gate1 && !gate1.pass) for (const c of gate1.checks.filter(c => !c.ok)) issues.push({ id: 'gate:' + c.name, severity: 'blocker', file: '', summary: 'Gate check failed: ' + c.name, evidence: c.detail })
for (const [lens, r] of [['review', review], ['critic', critic]]) if (r) for (const f of r.findings) issues.push({ ...f, id: lens + ':' + f.id })
log('verify: gate ' + (gate1 ? (gate1.pass ? 'pass' : 'FAIL') : 'not run') + ', findings ' + issues.length + (unverified.length ? ', unverified: ' + unverified.join(', ') : ''))

let fix = null
let gate2 = null
if (issues.length > 0) {
  phase('Fix')
  fix = await run('fixer', CTX + '\n\nYou own every file of this unit and alone may build/test now. Patch: ' + patchFile + ' (use it to find the code each finding points at).\nFindings (not adversarially checked; verify each first; do not apply one that contradicts the brief or a user decision):\n' + JSON.stringify(issues, null, 1), { label: 'fix', phase: 'Fix', schema: IMPL })
  phase('Final gate')
  gate2 = await run('gate', gatePrompt(2), { label: 'gate 2', phase: 'Final gate', schema: GATE })
  if (!fix) unverified.push('fix')
  if (!gate2) unverified.push('gate 2')
  else if (!gate2.pass) log('final gate FAIL: the orchestrator runs one more fix limited to the failing checks at effort xhigh, then stops')
}
return { unit: A.unit, stopped: null, codemapLines: CODEMAP.split('\n').length, impl, patch, gate1, review, critic, issues, fix, gate2, unverified }
