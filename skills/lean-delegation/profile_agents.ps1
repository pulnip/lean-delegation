# Profile Claude Code subagent transcripts: calls, context growth, cache traffic, time per tool, estimated cost.
# Usage: .\profile_agents.ps1 <dir-with-agent-*.jsonl> [more dirs...]
# PowerShell port of profile_agents.py; keep their output identical. Runs on Windows PowerShell 5.1 and PowerShell 7.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Dirs)

[System.Threading.Thread]::CurrentThread.CurrentCulture = [cultureinfo]::InvariantCulture

# $ per 1M tokens: (input, cache write 5m, cache read, output), from the claude-api skill pricing table
$Prices = @{
    opus   = @(4.0, 5.0, 0.20, 20.0)
    sonnet = @(2.0, 2.5, 0.20, 10.0)
    haiku  = @(0.10, 0.125, 0.01, 0.50)
}
$UsageKeys = @('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens')

function Get-Family([string]$Model) {
    foreach ($name in 'opus', 'sonnet', 'haiku') {
        if ($Model -and $Model.Contains($name)) { return $name }
    }
    return 'opus'
}

function Get-Stamp([string]$Value) {
    return [datetimeoffset]::Parse($Value, [cultureinfo]::InvariantCulture)
}

function Get-Kind([string]$Name, $ToolInput) {
    if ($Name -ne 'Bash' -and $Name -ne 'bash' -and $Name -ne 'PowerShell') { return $Name }
    $cmd = ''
    if ($ToolInput -and $ToolInput.command) { $cmd = [string]$ToolInput.command }
    if ($cmd.Contains('npm test') -or $cmd.Contains('node --test')) { return "${Name}:test" }
    if ($cmd.Contains('e2e')) { return "${Name}:e2e" }
    if ($cmd.Contains('tsc')) { return "${Name}:tsc" }
    if ($cmd -match '\bnode\b') { return "${Name}:node" }
    if ($cmd.Contains('python')) { return "${Name}:python" }
    if ($cmd -match '\b(grep|rg|sed|cat|head|tail|wc|ls|find|Get-Content|Select-String|Get-ChildItem|Select-Object)\b') { return "${Name}:read" }
    return "${Name}:other"
}

function Get-AgentProfile([string]$Path) {
    $calls = 0
    $ctx = New-Object System.Collections.Generic.List[long]
    $usage = @{}
    foreach ($key in $UsageKeys) { $usage[$key] = [long]0 }
    $model = $null
    $pending = @{}
    $seconds = @{}
    $chars = @{}
    $stamps = New-Object System.Collections.Generic.List[string]
    foreach ($line in [System.IO.File]::ReadLines($Path)) {
        try { $entry = $line | ConvertFrom-Json } catch { continue }
        if ($null -eq $entry) { continue }
        if ($entry.timestamp) { $stamps.Add([string]$entry.timestamp) }
        $message = $entry.message
        if ($null -eq $message -or $message -is [string]) { continue }
        if ($message.role -eq 'assistant' -and $message.usage) {
            $u = $message.usage
            if ($message.model) { $model = [string]$message.model }
            foreach ($key in $UsageKeys) { $usage[$key] += [long]$u.$key }
            $ctx.Add([long]$u.input_tokens + [long]$u.cache_creation_input_tokens + [long]$u.cache_read_input_tokens)
            foreach ($block in @($message.content)) {
                if ($null -ne $block -and $block.type -eq 'tool_use') {
                    $calls++
                    $pending[[string]$block.id] = @((Get-Kind $block.name $block.input), [string]$entry.timestamp)
                }
            }
        }
        if ($message.role -eq 'user' -and $message.content -is [array]) {
            foreach ($block in $message.content) {
                if ($null -eq $block -or $block.type -ne 'tool_result') { continue }
                $id = [string]$block.tool_use_id
                $started = $pending[$id]
                if (-not $started) { continue }
                $pending.Remove($id)
                if ($started[1] -and $entry.timestamp) {
                    $seconds[$started[0]] += ((Get-Stamp $entry.timestamp) - (Get-Stamp $started[1])).TotalSeconds
                }
                $content = $block.content
                if ($null -eq $content -or $content -eq '') { $json = '""' } else { $json = $content | ConvertTo-Json -Compress -Depth 20 }
                $chars[$started[0]] += $json.Length
            }
        }
    }
    if ($ctx.Count -eq 0) { return $null }
    $p = $Prices[(Get-Family $model)]
    $cost = ($usage['input_tokens'] * $p[0] + $usage['cache_creation_input_tokens'] * $p[1] + $usage['cache_read_input_tokens'] * $p[2] + $usage['output_tokens'] * $p[3]) / 1e6
    $minutes = 0
    if ($stamps.Count -gt 1) {
        $sorted = $stamps | Sort-Object
        $minutes = ((Get-Stamp $sorted[-1]) - (Get-Stamp $sorted[0])).TotalSeconds / 60
    }
    $name = [System.IO.Path]::GetFileName($Path)
    $name = $name.Substring(6, $name.Length - 12)
    $topTime = @($seconds.GetEnumerator() | Sort-Object { -$_.Value } | Select-Object -First 3)
    $topChars = @($chars.GetEnumerator() | Sort-Object { -$_.Value } | Select-Object -First 3)
    return @{
        agent = $name; model = (Get-Family $model); calls = $calls
        ctx0 = $ctx[0]; ctx_end = $ctx[$ctx.Count - 1]; reads = $usage['cache_read_input_tokens']
        writes = $usage['cache_creation_input_tokens']; out = $usage['output_tokens']
        cost = $cost; minutes = $minutes; top_time = $topTime; top_chars = $topChars
    }
}

function Format-Pairs($Pairs, [scriptblock]$Value) {
    $items = foreach ($pair in $Pairs) { "('{0}', {1})" -f $pair.Key, (& $Value $pair.Value) }
    return '[' + ($items -join ', ') + ']'
}

$rows = @()
foreach ($folder in $Dirs) {
    foreach ($file in Get-ChildItem -Path $folder -Recurse -File -Filter 'agent-*.jsonl' | Sort-Object FullName) {
        $row = Get-AgentProfile $file.FullName
        if ($row) { $rows += , $row }
    }
}
'{0,-18} {1,-6} {2,5} {3,6} {4,7} {5,7} {6,6} {7,6} {8,6} {9,5}' -f 'agent', 'model', 'calls', 'ctx0', 'ctxEnd', 'reads', 'writes', 'out', '$', 'min'
$total = @{ reads = [long]0; writes = [long]0; out = [long]0; cost = 0.0; calls = 0 }
foreach ($r in $rows) {
    $agent = $r.agent
    if ($agent.Length -gt 18) { $agent = $agent.Substring(0, 18) }
    '{0,-18} {1,-6} {2,5} {3,5}k {4,6}k {5,6:F1}M {6,5:F2}M {7,5}k {8,6:F2} {9,5:F1}' -f $agent, $r.model, $r.calls, [math]::Floor($r.ctx0 / 1000), [math]::Floor($r.ctx_end / 1000), ($r.reads / 1e6), ($r.writes / 1e6), [math]::Floor($r.out / 1000), $r.cost, $r.minutes
    $time = Format-Pairs $r.top_time { param($v) [math]::Round($v / 60, 1) }
    $chars = Format-Pairs $r.top_chars { param($v) [math]::Floor($v / 1000) }
    '{0,-18}   time {1}  chars {2}' -f '', $time, $chars
    foreach ($key in 'reads', 'writes', 'out', 'cost', 'calls') { $total[$key] += $r[$key] }
}
'TOTAL calls={0} reads={1:F1}M writes={2:F2}M out={3}k est=${4:F2}' -f $total.calls, ($total.reads / 1e6), ($total.writes / 1e6), [math]::Floor($total.out / 1000), $total.cost
