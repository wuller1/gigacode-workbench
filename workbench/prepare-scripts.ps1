#requires -Version 5.1
# First: Copy-Item -LiteralPath .\source\prepare-scripts.txt -Destination .\prepare-scripts.ps1
# Then: powershell -NoProfile -File .\prepare-scripts.ps1
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Assert-LocalRegularPath([string]$Relative) {
    if ($Relative -notmatch '^[a-z][a-z0-9/-]*(\.(ps1|txt))?$' -or $Relative.Contains('..')) { throw "Invalid package path: $Relative" }
    $cursor = $PSScriptRoot
    foreach ($part in ($Relative -split '/')) {
        $cursor = Join-Path $cursor $part
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Linked package path is unsupported: $Relative" }
        }
    }
}
try {
    $allowed = @{
        'source/prepare-scripts.txt' = 'prepare-scripts.ps1'
        'source/workbench.txt' = 'workbench.ps1'
        'source/install-user.txt' = 'install-user.ps1'
        'source/docs-impact.txt' = 'tools/docs-impact.ps1'
        'source/design-metrics.txt' = 'tools/design-metrics.ps1'
        'source/memory.txt' = 'tools/memory.ps1'
        'source/test-workbench.txt' = 'tests/test-workbench.ps1'
        'source/test-docs-impact.txt' = 'tests/test-docs-impact.ps1'
        'source/test-design-metrics.txt' = 'tests/test-design-metrics.ps1'
        'source/test-install-user.txt' = 'tests/test-install-user.ps1'
        'source/test-memory.txt' = 'tests/test-memory.ps1'
        'source/run-tests.txt' = 'tests/run-tests.ps1'
    }
    $manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'scripts.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.schema_version -ne 1 -or @($manifest.scripts).Count -ne $allowed.Count) { throw 'Invalid scripts manifest' }
    $seen = @{}
    $pending = @()
    foreach ($item in $manifest.scripts) {
        $source = [string]$item.source
        if ((-not $allowed.ContainsKey($source)) -or $seen.ContainsKey($source) -or $item.target -cne $allowed[$source] -or $item.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Unexpected script mapping' }
        $seen[$source] = $true
        Assert-LocalRegularPath $source
        Assert-LocalRegularPath ([string]$item.target)
        $from = Join-Path $PSScriptRoot $source
        $to = Join-Path $PSScriptRoot ([string]$item.target)
        if (-not (Test-Path -LiteralPath $from -PathType Leaf) -or (Get-Sha256 $from) -cne $item.sha256) { throw "Source checksum mismatch: $source" }
        if (Test-Path -LiteralPath $to) {
            if (-not (Test-Path -LiteralPath $to -PathType Leaf) -or (Get-Sha256 $to) -cne $item.sha256) { throw "Existing target differs; preserve and review it before replacing: $($item.target)" }
        } else { $pending += @{source=$from; target=$to; hash=[string]$item.sha256} }
    }
    # All conflicts are checked before the first write. Each copy uses CreateNew.
    foreach ($item in $pending) {
        $bytes = [IO.File]::ReadAllBytes($item.source)
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $currentHash = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
        if ($currentHash -cne $item.hash) { throw 'Source changed after validation' }
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($item.target))
        $stream = New-Object IO.FileStream($item.target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        if ((Get-Sha256 $item.target) -cne $item.hash) { throw "Copy checksum mismatch: $($item.target)" }
    }
    @{status='prepared'; created=$pending.Count; scripts=$allowed.Count; project_settings_changed=$false} | ConvertTo-Json
} catch {
    @{status='error'; error=$_.Exception.Message} | ConvertTo-Json
    exit 2
}
