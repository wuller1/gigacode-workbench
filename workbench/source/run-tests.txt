#requires -Version 5.1
[CmdletBinding()]
param([string]$BundleRoot = (Split-Path -Parent $PSScriptRoot), [switch]$RequireNode)
$ErrorActionPreference = 'Stop'
$engine = (Get-Process -Id $PID).Path
$suites = @('test-workbench.ps1', 'test-docs-impact.ps1', 'test-install-user.ps1', 'test-memory.ps1', 'test-design-metrics.ps1')
$failures = @()
foreach ($suite in $suites) {
    $arguments = @('-NoLogo', '-NoProfile', '-File', (Join-Path $PSScriptRoot $suite))
    if ($suite -eq 'test-workbench.ps1') { $arguments += @('-WorkbenchPath', (Join-Path $BundleRoot 'workbench.ps1')) }
    elseif ($suite -eq 'test-memory.ps1') { $arguments += @('-MemoryPath', (Join-Path $BundleRoot 'tools/memory.ps1'), '-WorkbenchPath', (Join-Path $BundleRoot 'workbench.ps1')) }
    else { $arguments += @('-BundleRoot', $BundleRoot) }
    if ($suite -eq 'test-design-metrics.ps1' -and $RequireNode) { $arguments += '-RequireNode' }
    & $engine @arguments
    if ($LASTEXITCODE -ne 0) { $failures += $suite }
}
@{suites=$suites.Count; failed=@($failures); powershell=$PSVersionTable.PSVersion.ToString(); os=[Environment]::OSVersion.ToString()} | ConvertTo-Json
if ($failures.Count -gt 0) { exit 1 }
