# Profile Claude Code subagent transcripts: calls, context growth, cache traffic, time per tool, estimated cost.
# Usage: python3 profile_agents.py <dir-with-agent-*.jsonl> [more dirs...]
# profile_agents.ps1 is the PowerShell port; keep their output identical.
import glob
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime

# $ per 1M tokens: (input, cache write 5m, cache read, output), from the claude-api skill pricing table
PRICES = {
    'opus': (4.0, 5.0, 0.20, 20.0),
    'sonnet': (2.0, 2.5, 0.20, 10.0),
    'haiku': (0.10, 0.125, 0.01, 0.50),
}


def family(model):
    for name in PRICES:
        if name in (model or ''):
            return name
    return 'opus'


def ts(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def kind_of(name, tool_input):
    if name not in ('Bash', 'bash', 'PowerShell'):
        return name
    cmd = (tool_input or {}).get('command', '')
    if 'npm test' in cmd or 'node --test' in cmd:
        return name + ':test'
    if 'e2e' in cmd:
        return name + ':e2e'
    if 'tsc' in cmd:
        return name + ':tsc'
    if re.search(r'\bnode\b', cmd):
        return name + ':node'
    if 'python' in cmd:
        return name + ':python'
    if re.search(r'\b(grep|rg|sed|cat|head|tail|wc|ls|find|Get-Content|Select-String|Get-ChildItem|Select-Object)\b', cmd):
        return name + ':read'
    return name + ':other'


def profile(path):
    calls = 0
    ctx = []
    usage = Counter()
    model = None
    pending = {}
    seconds = defaultdict(float)
    chars = Counter()
    stamps = []
    for line in open(path):
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if entry.get('timestamp'):
            stamps.append(entry['timestamp'])
        message = entry.get('message')
        if not isinstance(message, dict):
            continue
        if message.get('role') == 'assistant' and message.get('usage'):
            u = message['usage']
            model = message.get('model', model)
            for key in ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'):
                usage[key] += u.get(key, 0)
            ctx.append(u.get('input_tokens', 0) + u.get('cache_creation_input_tokens', 0) + u.get('cache_read_input_tokens', 0))
            for block in message.get('content') or []:
                if isinstance(block, dict) and block.get('type') == 'tool_use':
                    calls += 1
                    pending[block.get('id')] = (kind_of(block.get('name'), block.get('input')), entry.get('timestamp'))
        if message.get('role') == 'user' and isinstance(message.get('content'), list):
            for block in message['content']:
                if isinstance(block, dict) and block.get('type') == 'tool_result':
                    started = pending.pop(block.get('tool_use_id'), None)
                    if not started:
                        continue
                    if started[1] and entry.get('timestamp'):
                        seconds[started[0]] += (ts(entry['timestamp']) - ts(started[1])).total_seconds()
                    chars[started[0]] += len(json.dumps(block.get('content') or ''))
    if not ctx:
        return None
    p = PRICES[family(model)]
    cost = (usage['input_tokens'] * p[0] + usage['cache_creation_input_tokens'] * p[1]
            + usage['cache_read_input_tokens'] * p[2] + usage['output_tokens'] * p[3]) / 1e6
    stamps.sort()
    minutes = (ts(stamps[-1]) - ts(stamps[0])).total_seconds() / 60 if len(stamps) > 1 else 0
    return {
        'agent': os.path.basename(path)[6:-6], 'model': family(model), 'calls': calls,
        'ctx0': ctx[0], 'ctx_end': ctx[-1], 'reads': usage['cache_read_input_tokens'],
        'writes': usage['cache_creation_input_tokens'], 'out': usage['output_tokens'],
        'cost': cost, 'minutes': minutes,
        'top_time': sorted(seconds.items(), key=lambda kv: -kv[1])[:3],
        'top_chars': chars.most_common(3),
    }


def main():
    rows = []
    for folder in sys.argv[1:]:
        for path in sorted(glob.glob(os.path.join(folder, '**', 'agent-*.jsonl'), recursive=True)):
            row = profile(path)
            if row:
                rows.append(row)
    print(f"{'agent':18} {'model':6} {'calls':>5} {'ctx0':>6} {'ctxEnd':>7} {'reads':>7} {'writes':>6} {'out':>6} {'$':>6} {'min':>5}")
    total = Counter()
    for r in rows:
        print(f"{r['agent'][:18]:18} {r['model']:6} {r['calls']:5} {r['ctx0'] // 1000:5}k {r['ctx_end'] // 1000:6}k "
              f"{r['reads'] / 1e6:6.1f}M {r['writes'] / 1e6:5.2f}M {r['out'] // 1000:5}k {r['cost']:6.2f} {r['minutes']:5.1f}")
        print(f"{'':18}   time {[(k, round(v / 60, 1)) for k, v in r['top_time']]}  chars {[(k, v // 1000) for k, v in r['top_chars']]}")
        for key in ('reads', 'writes', 'out', 'cost', 'calls'):
            total[key] += r[key]
    print(f"TOTAL calls={total['calls']} reads={total['reads'] / 1e6:.1f}M writes={total['writes'] / 1e6:.2f}M "
          f"out={total['out'] // 1000}k est=${total['cost']:.2f}")


if __name__ == '__main__':
    main()
