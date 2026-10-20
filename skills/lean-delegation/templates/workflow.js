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
//   repo: '/abs/path', sp: '/abs/scratch', unit: 'name',
//   ctx: 'shared context: spec file/section, user-decided numbers, domain checklist, read-only rules',
//   mapQ: 'what the code map must cover',
//   impl: [{ key: 'core', own: 'files you may edit', task: 'what to build + tests + done-when', match: ['path substrings'] }],
//   gate: 'commands to run, one line per check',
//   review: 'unit-specific correctness concerns',
//   critic: 'optional visual/UX lens prompt',
//   patchPaths: 'src tests',      // dirs whose new files belong in the patch
//   agents: { finder, implementer, gate, reviewer, fixer }  // optional overrides, e.g. project-specific agents
// }
const A = args
const AG = Object.assign({ finder: 'lean-finder', implementer: 'lean-implementer', gate: 'lean-gate', reviewer: 'lean-reviewer', fixer: 'lean-fixer' }, A.agents || {})
const MAX_BATONS = 3
const BASE = [
  'Repository: ' + A.repo + '. Scratch dir SP = ' + A.sp + '.',
  'Never git add/commit/push/reset/checkout/stash. The orchestrator owns docs and commits.',
  'Only the agent told it may build/test/launch does so; everyone else is read-only and must not touch build output.',
].join('\n')
const CTX = BASE + '\n\nUNIT ' + A.unit + ':\n' + A.ctx

const IMPL = { type: 'object', properties: { status: { type: 'string', enum: ['done', 'handoff', 'blocked'] }, summary: { type: 'string' }, filesChanged: { type: 'array', items: { type: 'string' } }, verification: { type: 'string' }, openIssues: { type: 'array', items: { type: 'string' } } }, required: ['status', 'summary', 'filesChanged', 'verification', 'openIssues'] }
const GATE = { type: 'object', properties: { pass: { type: 'boolean' }, checks: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, ok: { type: 'boolean' }, detail: { type: 'string' } }, required: ['name', 'ok', 'detail'] } } }, required: ['pass', 'checks'] }
const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, file: { type: 'string' }, summary: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['id', 'severity', 'file', 'summary', 'evidence', 'fix'] } } }, required: ['findings'] }
const MAP = { type: 'object', properties: { map: { type: 'string' } }, required: ['map'] }
const PATCH = { type: 'object', properties: { lines: { type: 'number' }, files: { type: 'array', items: { type: 'string' } } }, required: ['lines', 'files'] }

phase('Map')
const mapRes = await agent(CTX + '\n\nBuild a CODE MAP for this unit, at most 180 lines, in the `map` field: file:startLine-endLine — symbol — what is there / what changes. grep -n and line ranges only. Cover:\n' + A.mapQ, { label: 'code map', phase: 'Map', agentType: AG.finder, schema: MAP })
const CODEMAP = mapRes ? mapRes.map : '(no code map: locate things with grep -n)'

phase('Implement')
const impl = {}
for (const im of A.impl) {
  const runs = []
  for (let n = 1; n <= MAX_BATONS; n++) {
    const baton = A.sp + '/handoff-' + A.unit + '-' + im.key + '-' + n + '.md'
    const prev = n > 1 ? A.sp + '/handoff-' + A.unit + '-' + im.key + '-' + (n - 1) + '.md' : null
    const resume = prev ? 'CONTINUE a previous implementer: read ' + prev + ' first, then `git diff --stat` and only the hunks you need. Do not redo finished work.\n' : ''
    const r = await agent(CTX + '\n\nYou are the ' + im.key.toUpperCase() + ' implementer. OWN: ' + im.own + '\nYou may build/test now (earlier owners finished; later ones wait).\nHANDOFF FILE: ' + baton + '\n' + resume + '\nCODE MAP (verify line numbers before editing):\n' + CODEMAP + '\n\nTASK:\n' + im.task, { label: 'impl ' + im.key + ' #' + n, phase: 'Implement', agentType: AG.implementer, schema: IMPL })
    runs.push(r)
    if (!r || r.status !== 'handoff') break
  }
  impl[im.key] = runs
}

phase('Verify')
const patchFile = A.sp + '/diff-' + A.unit + '.patch'
const patch = await agent('Repository ' + A.repo + '. Write the unit patch and nothing else. Run exactly:\ncd ' + A.repo + ' && { git diff --stat; git diff -U10; git ls-files --others --exclude-standard -- ' + (A.patchPaths || '.') + ' | while read f; do git diff --no-index /dev/null "$f"; done; } > ' + patchFile + '; wc -l < ' + patchFile + '; git status --porcelain\nReturn the line count and changed/new files.', { label: 'patch', phase: 'Verify', agentType: AG.gate, schema: PATCH })
const thunks = [
  () => agent(CTX + '\n\nGATE (round 1). ' + A.gate, { label: 'gate 1', phase: 'Verify', agentType: AG.gate, schema: GATE }),
  () => agent(CTX + '\n\nREVIEW this unit. Patch: ' + patchFile + ' (read it first). ' + (A.review || ''), { label: 'review', phase: 'Verify', agentType: AG.reviewer, schema: FINDINGS }),
]
if (A.critic) thunks.push(() => agent(CTX + '\n\nCRITIC lens. ' + A.critic, { label: 'critic', phase: 'Verify', agentType: AG.reviewer, schema: FINDINGS }))
const [gate1, review, critic] = await parallel(thunks)

const issues = []
if (!gate1 || !gate1.pass) {
  const failed = gate1 ? gate1.checks.filter(c => !c.ok) : [{ name: 'gate', detail: 'gate agent returned nothing' }]
  for (const c of failed) issues.push({ id: 'gate:' + c.name, severity: 'blocker', file: '', summary: 'Gate check failed: ' + c.name, evidence: c.detail })
}
for (const [lens, r] of [['review', review], ['critic', critic]]) if (r) for (const f of r.findings) issues.push({ ...f, id: lens + ':' + f.id })
log('verify: gate ' + (gate1 && gate1.pass ? 'pass' : 'FAIL') + ', findings ' + issues.length)

let fix = null
let gate2 = null
if (issues.length > 0) {
  phase('Fix')
  fix = await agent(CTX + '\n\nYou own every file of this unit and alone may build/test now. Patch: ' + patchFile + ' (read it instead of re-exploring).\nFindings (not adversarially checked; verify each first):\n' + JSON.stringify(issues, null, 1), { label: 'fix', phase: 'Fix', agentType: AG.fixer, schema: IMPL })
  phase('Final gate')
  gate2 = await agent(CTX + '\n\nGATE (round 2, after fixes). ' + A.gate, { label: 'gate 2', phase: 'Final gate', agentType: AG.gate, schema: GATE })
}
return { unit: A.unit, codemapLines: CODEMAP.split('\n').length, impl, patch, gate1, review, critic, issues, fix, gate2 }
