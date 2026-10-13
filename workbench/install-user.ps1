# install-user.ps1 — explicit, previewed user-scope installation; Windows PowerShell 5.1.
# Does not read or change MCP/settings/hooks/repositories. Persistent memory stays outside
# workbench, at <TargetRoot>/workbench-memory, which is never enumerated or overwritten here.
[CmdletBinding()]
param(
    [string]$TargetRoot,
    [string]$SourceRoot,
    [string]$GlobalContextPath,
    [switch]$IncludeAgents,
    [switch]$SetUserSystemPrompt,
    [switch]$PlanOnly,
    [string]$ExpectedPlanHash,
    [switch]$LibraryOnly
)
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 may not populate $PSScriptRoot during parameter default binding.
if (-not $SourceRoot) { $SourceRoot = $PSScriptRoot }
$script:WIUtf8 = New-Object Text.UTF8Encoding($false, $true)
$script:WIWindows = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
$script:WIComparison = [StringComparison]::Ordinal
if ($script:WIWindows) { $script:WIComparison = [StringComparison]::OrdinalIgnoreCase }

function Get-WIFullPath {
    param([string]$Path)
    if (-not $Path) { throw 'An explicit path is required' }
    $full = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetPathRoot($full)
    if ($full -eq $root) { return $full }
    return $full.TrimEnd([char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar))
}
function Test-WIWithin {
    param([string]$Path, [string]$Parent)
    return $Path.Equals($Parent, $script:WIComparison) -or $Path.StartsWith(($Parent.TrimEnd([char[]]'\/') + [IO.Path]::DirectorySeparatorChar), $script:WIComparison)
}
function Assert-WIPath {
    param([string]$Path, [switch]$Directory)
    $current = Get-WIFullPath $Path
    $leaf = $true
    while ($current) {
        $exists = $true
        try { $attributes = [IO.File]::GetAttributes($current) }
        catch [IO.FileNotFoundException] { $exists = $false }
        catch [IO.DirectoryNotFoundException] { $exists = $false }
        if ($exists) {
            if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw ('Symlink/junction/reparse path is not accepted: ' + $current) }
            if ((-not $leaf -or $Directory) -and ($attributes -band [IO.FileAttributes]::Directory) -eq 0) { throw ('A parent or required directory is a file: ' + $current) }
        }
        $leaf = $false
        $current = [IO.Path]::GetDirectoryName($current)
    }
}
function Get-WIHash {
    param([byte[]]$Bytes)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function Get-WIFileHash {
    param([string]$Path)
    if (-not [IO.File]::Exists($Path)) { return $null }
    return Get-WIHash ([IO.File]::ReadAllBytes($Path))
}
function Get-WIJsonBytes {
    param($Value)
    return ,$script:WIUtf8.GetBytes(($Value | ConvertTo-Json -Depth 32 -Compress))
}
function Get-WIPayload {
    param($Entry, [string]$Target)
    Assert-WIPath $Entry.source
    $bytes = [IO.File]::ReadAllBytes($Entry.source)
    if ($Entry.render_adapter) {
        $text = $script:WIUtf8.GetString($bytes)
        $installed = (Join-Path $Target 'workbench').Replace('\', '/') + '/'
        $bytes = $script:WIUtf8.GetBytes($text.Replace('gigacode-workbench/', $installed))
    }
    return ,$bytes
}
function Get-WISourceFiles {
    param([string]$Root)
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push($Root)
    while ($pending.Count) {
        $directory = $pending.Pop()
        foreach ($item in (Get-ChildItem -LiteralPath $directory -Force)) {
            if ($item.Name -in @('.git', '__pycache__', '.DS_Store') -or $item.Extension -eq '.pyc') { continue }
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw ('Source contains a reparse path: ' + $item.FullName) }
            if ($item.PSIsContainer) { $pending.Push($item.FullName) } else { $item.FullName }
        }
    }
}
function Get-WorkbenchInstallPlan {
    param([string]$TargetRoot, [string]$SourceRoot, [string]$GlobalContextPath, [switch]$SetUserSystemPrompt, [switch]$IncludeAgents)
    $source = Get-WIFullPath $SourceRoot; $target = Get-WIFullPath $TargetRoot
    $blocked = [Collections.Generic.List[object]]::new(); $entries = [Collections.Generic.List[object]]::new()
    try {
        Assert-WIPath $source -Directory; Assert-WIPath $target -Directory
        Assert-WIPath (Join-Path $target 'history/workbench-install') -Directory
        if (-not [IO.Directory]::Exists($source)) { throw ('Source directory does not exist: ' + $source) }
        if ((Test-WIWithin $source $target) -or (Test-WIWithin $target $source)) { throw 'SourceRoot and TargetRoot must not overlap' }
        foreach ($file in @(Get-WISourceFiles $source)) {
            $relative = $file.Substring($source.Length).TrimStart([char[]]'\/').Replace('\', '/')
            $entries.Add([ordered]@{ source = $file; relative_target = 'workbench/' + $relative; render_adapter = $false; purpose = 'bundle' })
        }
        $entries.Add([ordered]@{ source = Join-Path $source 'adapters/gigacode/commands/workbench.md'; relative_target = 'commands/workbench.md'; render_adapter = $true; purpose = 'native_command' })
        if ($IncludeAgents) {
            foreach ($role in @('analyst', 'architect', 'backend', 'database', 'designer', 'devops', 'diagnostics', 'frontend', 'qa', 'reviewer', 'security', 'spec', 'technical-writer', 'gigacode-ui')) {
                $entries.Add([ordered]@{ source = Join-Path $source ('adapters/gigacode/agents/workbench-' + $role + '.md'); relative_target = 'agents/workbench-' + $role + '.md'; render_adapter = $true; purpose = 'native_agent' })
            }
        }
        if ($GlobalContextPath) {
            $context = Get-WIFullPath $GlobalContextPath
            Assert-WIPath $context
            if (-not [IO.File]::Exists($context)) { throw ('Prepared GlobalContextPath does not exist: ' + $context) }
            $entries.Add([ordered]@{ source = $context; relative_target = 'GIGACODE.md'; render_adapter = $false; purpose = 'explicit_prepared_global_context' })
        }
    } catch { $blocked.Add([ordered]@{ path = $source; reason = $_.Exception.Message }) }
    $files = [Collections.Generic.List[object]]::new()
    $comparer = [StringComparer]::Ordinal; if ($script:WIWindows) { $comparer = [StringComparer]::OrdinalIgnoreCase }
    $seen = [Collections.Generic.HashSet[string]]::new($comparer)
    foreach ($entry in $entries) {
        $destination = Join-Path $target $entry.relative_target
        try {
            if (-not $seen.Add($destination)) { throw ('Two managed sources address the same destination: ' + $destination) }
            Assert-WIPath $destination
            if ([IO.Directory]::Exists($destination)) { throw ('Destination file is a directory: ' + $destination) }
            $bytes = Get-WIPayload $entry $target
            $before = Get-WIFileHash $destination; $after = Get-WIHash $bytes
            $action = 'create'; if ($before) { $action = 'replace'; if ($before -eq $after) { $action = 'unchanged' } }
            $files.Add([ordered]@{ source = $entry.source; target = $destination; relative_target = $entry.relative_target; purpose = $entry.purpose; render_adapter = $entry.render_adapter; action = $action; before_sha256 = $before; after_sha256 = $after; size_bytes = $bytes.Length })
        } catch { $blocked.Add([ordered]@{ path = $destination; reason = $_.Exception.Message }) }
    }
    # Stable order independent of culture or directory enumeration order.
    $byPath = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
    foreach ($entry in $files) { $byPath.Add($entry.relative_target, $entry) }
    [string[]]$keys = @($byPath.Keys); [Array]::Sort($keys, [StringComparer]::Ordinal)
    $orderedFiles = @($keys | ForEach-Object { $byPath[$_] })
    $environment = $null
    if ($SetUserSystemPrompt) {
        if (-not $script:WIWindows) { $blocked.Add([ordered]@{ path = 'User:GIGACODE_SYSTEM_MD'; reason = 'SetUserSystemPrompt is supported only on Windows; no environment was changed' }) }
        else {
            $prompt = Join-Path $target 'workbench/SYSTEM_PROMPT.md'
            if (-not [IO.File]::Exists((Join-Path $source 'SYSTEM_PROMPT.md'))) { $blocked.Add([ordered]@{ path = $prompt; reason = 'SYSTEM_PROMPT.md is missing from the source bundle' }) }
            $previous = [Environment]::GetEnvironmentVariable('GIGACODE_SYSTEM_MD', 'User')
            $action = 'set'; if ($previous -ceq $prompt) { $action = 'unchanged' }
            $environment = [ordered]@{ name = 'GIGACODE_SYSTEM_MD'; scope = 'User'; previous_value = $previous; value = $prompt; action = $action }
        }
    }
    $status = 'ready'; if ($blocked.Count) { $status = 'blocked' }
    $plan = [ordered]@{ schema_version = 1; status = $status; source_root = $source; target_root = $target; include_agents = [bool]$IncludeAgents; files = @($orderedFiles); blocked_conflicts = @($blocked.ToArray()); environment = $environment; receipt_root = Join-Path $target 'history/workbench-install'; persistent_memory = [ordered]@{ path = Join-Path $target 'workbench-memory'; policy = 'not read, enumerated, or modified by this installer' }; restore_instruction = 'Restore changed files from their receipt backups only after checking their current after hash; remove only recorded created files if unchanged since installation. Restore the previous User environment value when present. Preserve later edits.' }
    $plan.plan_hash = Get-WIHash (Get-WIJsonBytes $plan)
    return $plan
}
function Write-WIAtomic {
    param([string]$Path, [byte[]]$Bytes)
    Assert-WIPath $Path
    $directory = Split-Path -Parent $Path
    [void][IO.Directory]::CreateDirectory($directory)
    Assert-WIPath $directory -Directory
    $temporary = Join-Path $directory ('.workbench-' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $stream.Write($Bytes, 0, $Bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        Assert-WIPath $Path
        if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) }
        else { [IO.File]::Move($temporary, $Path) }
    } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}
function Install-WorkbenchUser {
    param([string]$TargetRoot, [string]$SourceRoot, [string]$GlobalContextPath, [switch]$SetUserSystemPrompt, [string]$ExpectedPlanHash, [switch]$IncludeAgents)
    if (-not $ExpectedPlanHash) { throw 'PlanOnly preflight is required: supply its plan_hash as ExpectedPlanHash' }
    $plan = Get-WorkbenchInstallPlan -TargetRoot $TargetRoot -SourceRoot $SourceRoot -GlobalContextPath $GlobalContextPath -SetUserSystemPrompt:$SetUserSystemPrompt -IncludeAgents:$IncludeAgents
    if ($plan.status -eq 'blocked') { throw ('Installation is blocked: ' + (($plan.blocked_conflicts | ForEach-Object { $_.reason }) -join '; ')) }
    if ($plan.plan_hash -cne $ExpectedPlanHash) { throw 'Preflight plan no longer matches; run PlanOnly again before applying' }
    $changed = @($plan.files | Where-Object { $_.action -ne 'unchanged' })
    $envChanged = $null -ne $plan.environment -and $plan.environment.action -ne 'unchanged'
    if ($changed.Count -eq 0 -and -not $envChanged) { return [ordered]@{ status = 'no_changes'; plan_hash = $plan.plan_hash; managed_files = @($plan.files); receipt_path = $null } }
    $run = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N')
    $history = Join-Path $plan.receipt_root $run
    Assert-WIPath $history -Directory
    [void][IO.Directory]::CreateDirectory($history)
    $receiptPath = Join-Path $history 'receipt.json'
    $applied = [Collections.Generic.List[object]]::new()
    $receipt = [ordered]@{ schema_version = 1; status = 'in_progress'; started_utc = [DateTime]::UtcNow.ToString('o'); plan_hash = $plan.plan_hash; source_root = $plan.source_root; target_root = $plan.target_root; managed_files = @($plan.files); applied_files = @(); pending_file = $null; environment = $plan.environment; environment_state = 'not_changed'; restore_instruction = $plan.restore_instruction }
    Write-WIAtomic $receiptPath (Get-WIJsonBytes $receipt)
    try {
        foreach ($entry in $changed) {
            $bytes = Get-WIPayload $entry $plan.target_root
            if ((Get-WIHash $bytes) -cne $entry.after_sha256) { throw ('Source changed after preflight: ' + $entry.source) }
            Assert-WIPath $entry.target
            $oldBytes = $null; $actualBefore = $null
            if ([IO.File]::Exists($entry.target)) { $oldBytes = [IO.File]::ReadAllBytes($entry.target); $actualBefore = Get-WIHash $oldBytes }
            if ($actualBefore -cne $entry.before_sha256) { throw ('Destination changed after preflight: ' + $entry.target) }
            $backup = $null
            if ($null -ne $oldBytes) { $backup = Join-Path (Join-Path $history 'backup') $entry.relative_target; Write-WIAtomic $backup $oldBytes }
            $receipt.pending_file = [ordered]@{ target = $entry.target; before_sha256 = $entry.before_sha256; after_sha256 = $entry.after_sha256; backup = $backup }
            Write-WIAtomic $receiptPath (Get-WIJsonBytes $receipt)
            Write-WIAtomic $entry.target $bytes
            $after = Get-WIFileHash $entry.target
            if ($after -cne $entry.after_sha256) { throw ('Installed file hash mismatch: ' + $entry.target) }
            $applied.Add([ordered]@{ target = $entry.target; action = $entry.action; before_sha256 = $entry.before_sha256; after_sha256 = $after; backup = $backup })
            $receipt.applied_files = @($applied.ToArray()); $receipt.pending_file = $null
            Write-WIAtomic $receiptPath (Get-WIJsonBytes $receipt)
        }
        if ($envChanged) {
            $current = [Environment]::GetEnvironmentVariable('GIGACODE_SYSTEM_MD', 'User')
            if ($current -cne $plan.environment.previous_value) { throw 'User system prompt setting changed after preflight' }
            $receipt.environment_state = 'pending'; Write-WIAtomic $receiptPath (Get-WIJsonBytes $receipt)
            [Environment]::SetEnvironmentVariable('GIGACODE_SYSTEM_MD', $plan.environment.value, 'User')
            if ([Environment]::GetEnvironmentVariable('GIGACODE_SYSTEM_MD', 'User') -cne $plan.environment.value) { throw 'User system prompt setting did not match after write' }
            $receipt.environment_state = 'verified_changed'
        }
        $receipt.status = 'installed'; $receipt.completed_utc = [DateTime]::UtcNow.ToString('o')
        Write-WIAtomic $receiptPath (Get-WIJsonBytes $receipt)
        return [ordered]@{ status = 'installed'; plan_hash = $plan.plan_hash; changed_files = $applied.Count; receipt_path = $receiptPath; restart_required = [bool]$SetUserSystemPrompt }
    } catch {
        $receipt.status = 'incomplete'; $receipt.error = $_.Exception.Message
        try { Write-WIAtomic $receiptPath (Get-WIJsonBytes $receipt) } catch { }
        throw ('Installation incomplete; inspect receipt ' + $receiptPath + ': ' + $receipt.error)
    }
}

if ($LibraryOnly) { return }
try {
    if ($PlanOnly) { $result = Get-WorkbenchInstallPlan -TargetRoot $TargetRoot -SourceRoot $SourceRoot -GlobalContextPath $GlobalContextPath -SetUserSystemPrompt:$SetUserSystemPrompt -IncludeAgents:$IncludeAgents }
    else { $result = Install-WorkbenchUser -TargetRoot $TargetRoot -SourceRoot $SourceRoot -GlobalContextPath $GlobalContextPath -SetUserSystemPrompt:$SetUserSystemPrompt -ExpectedPlanHash $ExpectedPlanHash -IncludeAgents:$IncludeAgents }
} catch { $result = [ordered]@{ status = 'error'; error = $_.Exception.Message } }
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false) } catch { }
[Console]::WriteLine(($result | ConvertTo-Json -Depth 32))
if ($result.status -in @('error', 'blocked')) { exit 2 }
exit 0
