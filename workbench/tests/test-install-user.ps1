# test-install-user.ps1 — isolated, standalone PowerShell 5.1 tests. Never changes User env.
[CmdletBinding()]
param([string]$BundleRoot)
$ErrorActionPreference = 'Stop'
# Resolve automatic script paths after parameter binding on Windows PowerShell 5.1.
if (-not $BundleRoot) { $BundleRoot = Split-Path -Parent $PSScriptRoot }
$script:IUtf8 = New-Object Text.UTF8Encoding($false)
$temporaryBase = [IO.Path]::GetTempPath()
# macOS /var is a symlink; tests use the physical path so the reparse guard stays strict.
if ($temporaryBase.StartsWith('/var/') -and [IO.Directory]::Exists('/private' + $temporaryBase)) { $temporaryBase = '/private' + $temporaryBase }
$script:ITestRoot = Join-Path $temporaryBase ('workbench install тест ' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($script:ITestRoot)
$source = Join-Path $BundleRoot 'install-user.ps1'
if (-not [IO.File]::Exists($source)) { $source = Join-Path $BundleRoot 'install-user' }
$loader = Join-Path $script:ITestRoot 'install-user.ps1'
[IO.File]::WriteAllBytes($loader, [IO.File]::ReadAllBytes($source))
. $loader -LibraryOnly

function Assert-InstallTest {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}
function Write-InstallTestFile {
    param([string]$Path, [string]$Text)
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $Path))
    [IO.File]::WriteAllText($Path, $Text, $script:IUtf8)
}
function New-InstallFixture {
    $script:IBase = Join-Path $script:ITestRoot ([guid]::NewGuid().ToString('N'))
    $script:ISource = Join-Path $script:IBase 'source bundle'
    $script:ITarget = Join-Path $script:IBase 'личная настройка'
    [void][IO.Directory]::CreateDirectory($script:ISource)
    Write-InstallTestFile (Join-Path $script:ISource 'SYSTEM_PROMPT.md') 'Fact-oriented system instructions.'
    Write-InstallTestFile (Join-Path $script:ISource 'README.md') 'Readme with Unicode: описание.'
    Write-InstallTestFile (Join-Path $script:ISource 'docs/описание файла.md') 'Preserve raw UTF-8 bytes.'
    Write-InstallTestFile (Join-Path $script:ISource 'adapters/gigacode/commands/workbench.md') "---`ndescription: Workbench`n---`nRead ``gigacode-workbench/BOOTSTRAP.md``."
    foreach ($role in @('analyst', 'backend', 'devops', 'diagnostics', 'frontend', 'qa', 'reviewer', 'spec', 'gigacode-ui')) {
        Write-InstallTestFile (Join-Path $script:ISource ('adapters/gigacode/agents/workbench-' + $role + '.md')) ("---`nname: workbench-" + $role + "`ndescription: Test role`ntools: [Read]`n---`nRead ``gigacode-workbench/CORE.md``.")
    }
    $script:IOptions = @{ TargetRoot = $script:ITarget; SourceRoot = $script:ISource }
}
function Get-InstallTestPlan { return Get-WorkbenchInstallPlan @script:IOptions }
function Apply-InstallTestPlan {
    param($Plan)
    $options = $script:IOptions.Clone(); $options.ExpectedPlanHash = $Plan.plan_hash
    return Install-WorkbenchUser @options
}
function Assert-InstallThrows {
    param([scriptblock]$Body, [string]$Message)
    $threw = $false
    try { $null = & $Body } catch { $threw = $true }
    Assert-InstallTest $threw $Message
}
function Read-InstallReceipt {
    param([string]$Path)
    return ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($Path, $script:IUtf8))
}

$tests = [ordered]@{
    'CLI source defaults to its script directory after parameter binding' = {
        $entry = Join-Path $script:ISource 'install-user.ps1'
        [IO.File]::WriteAllBytes($entry, [IO.File]::ReadAllBytes($loader))
        $engine = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
        $output = & $engine -NoLogo -NoProfile -File $entry -TargetRoot $script:ITarget -PlanOnly
        Assert-InstallTest ($LASTEXITCODE -eq 0) 'Default-source installer CLI failed'
        $plan = ConvertFrom-Json -InputObject ($output -join "`n")
        Assert-InstallTest ($plan.status -eq 'ready' -and $plan.source_root -eq [IO.Path]::GetFullPath($script:ISource)) 'Default source did not resolve to the script directory'
        Assert-InstallTest (-not [IO.Directory]::Exists($script:ITarget)) 'Default-source preflight modified the target'
    }
    'preflight is read-only and agents are opt-in' = {
        $plan = Get-InstallTestPlan
        Assert-InstallTest ($plan.status -eq 'ready' -and $plan.plan_hash.Length -eq 64) 'Preflight did not produce a ready hashed plan'
        Assert-InstallTest (-not [IO.Directory]::Exists($script:ITarget)) 'Preflight created target state'
        Assert-InstallTest (@($plan.files | Where-Object { $_.purpose -eq 'native_agent' }).Count -eq 0) 'Agents were activated without explicit opt-in'
        Assert-InstallThrows { Install-WorkbenchUser @script:IOptions } 'Application without preflight hash was accepted'
    }
    'install renders command and preserves foreign settings context memory' = {
        Write-InstallTestFile (Join-Path $script:ITarget 'settings.json') '{"fixture":"unchanged"}'
        Write-InstallTestFile (Join-Path $script:ITarget 'GIGACODE.md') 'Existing subject rules.'
        Write-InstallTestFile (Join-Path $script:ITarget 'agents/user-agent.md') 'Existing agent.'
        Write-InstallTestFile (Join-Path $script:ITarget 'workbench-memory/facts.json') '{"fixture":"persistent"}'
        $receipt = Apply-InstallTestPlan (Get-InstallTestPlan)
        Assert-InstallTest ($receipt.status -eq 'installed') 'Installation failed'
        $command = [IO.File]::ReadAllText((Join-Path $script:ITarget 'commands/workbench.md'), $script:IUtf8)
        $expected = (Join-Path $script:ITarget 'workbench').Replace('\', '/') + '/BOOTSTRAP.md'
        Assert-InstallTest ($command.Contains($expected) -and -not $command.Contains('gigacode-workbench/')) 'Native command path was not rendered'
        Assert-InstallTest ([IO.File]::ReadAllText((Join-Path $script:ITarget 'settings.json')) -eq '{"fixture":"unchanged"}') 'Settings changed'
        Assert-InstallTest ([IO.File]::ReadAllText((Join-Path $script:ITarget 'GIGACODE.md')) -eq 'Existing subject rules.') 'Global context changed without input'
        Assert-InstallTest ([IO.File]::ReadAllText((Join-Path $script:ITarget 'workbench-memory/facts.json')) -eq '{"fixture":"persistent"}') 'Persistent memory changed'
        Assert-InstallTest ([IO.File]::ReadAllText((Join-Path $script:ITarget 'agents/user-agent.md')) -eq 'Existing agent.') 'Foreign agent changed'
    }
    'explicit agents installed and opt-in covered by hash' = {
        $without = Get-InstallTestPlan
        $script:IOptions.IncludeAgents = $true
        $with = Get-InstallTestPlan
        Assert-InstallTest ($without.plan_hash -ne $with.plan_hash -and @($with.files | Where-Object { $_.purpose -eq 'native_agent' }).Count -eq 9) 'Agent opt-in not represented in plan'
        $null = Apply-InstallTestPlan $with
        Assert-InstallTest (@(Get-ChildItem -LiteralPath (Join-Path $script:ITarget 'agents') -File).Count -eq 9) 'Nine native agents were not installed'
        $text = [IO.File]::ReadAllText((Join-Path $script:ITarget 'agents/workbench-analyst.md'))
        Assert-InstallTest (-not $text.Contains('gigacode-workbench/')) 'Agent path was not rendered'
    }
    'replacement saves exact backup bytes and receipt hashes' = {
        $destination = Join-Path $script:ITarget 'commands/workbench.md'
        [void][IO.Directory]::CreateDirectory((Split-Path -Parent $destination))
        [byte[]]$old = @(0xEF, 0xBB, 0xBF, 0x6F, 0x6C, 0x64, 0x0D, 0x0A)
        [IO.File]::WriteAllBytes($destination, $old)
        $result = Apply-InstallTestPlan (Get-InstallTestPlan)
        $receipt = Read-InstallReceipt $result.receipt_path
        $entry = @($receipt.applied_files | Where-Object { $_.target -eq $destination })[0]
        Assert-InstallTest ($entry.before_sha256 -eq (Get-WIHash $old)) 'Before hash is incorrect'
        Assert-InstallTest ((Get-WIFileHash $entry.backup) -eq $entry.before_sha256) 'Backup bytes differ'
        Assert-InstallTest ((Get-WIFileHash $destination) -eq $entry.after_sha256) 'After hash is incorrect'
        Assert-InstallTest ($receipt.status -eq 'installed' -and $null -eq $receipt.pending_file) 'Receipt falsely reports incomplete outcome'
    }
    'prepared global context is explicit and backed up' = {
        Write-InstallTestFile (Join-Path $script:ITarget 'GIGACODE.md') 'Old retained context.'
        $context = Join-Path $script:IBase 'prepared context.md'
        Write-InstallTestFile $context 'New agreed policy plus retained subject rules.'
        $script:IOptions.GlobalContextPath = $context
        $result = Apply-InstallTestPlan (Get-InstallTestPlan)
        $receipt = Read-InstallReceipt $result.receipt_path
        $entry = @($receipt.applied_files | Where-Object { $_.target -eq (Join-Path $script:ITarget 'GIGACODE.md') })[0]
        Assert-InstallTest ([IO.File]::ReadAllText($entry.backup) -eq 'Old retained context.') 'Global context backup is missing'
        Assert-InstallTest ([IO.File]::ReadAllText($entry.target) -eq 'New agreed policy plus retained subject rules.') 'Prepared global context was not copied'
    }
    'repeat leaves unchanged files untouched' = {
        $null = Apply-InstallTestPlan (Get-InstallTestPlan)
        $file = Join-Path $script:ITarget 'workbench/README.md'
        $before = [IO.File]::GetLastWriteTimeUtc($file)
        $plan = Get-InstallTestPlan
        Assert-InstallTest (@($plan.files | Where-Object { $_.action -ne 'unchanged' }).Count -eq 0) 'Repeated plan invented changed files'
        $result = Apply-InstallTestPlan $plan
        Assert-InstallTest ($result.status -eq 'no_changes' -and $null -eq $result.receipt_path -and [IO.File]::GetLastWriteTimeUtc($file) -eq $before) 'Unchanged file was rewritten'
    }
    'stale target invalidates preflight' = {
        $plan = Get-InstallTestPlan
        Write-InstallTestFile (Join-Path $script:ITarget 'commands/workbench.md') 'Concurrent edit.'
        Assert-InstallThrows { Apply-InstallTestPlan $plan } 'Stale target plan was accepted'
        Assert-InstallTest ([IO.File]::ReadAllText((Join-Path $script:ITarget 'commands/workbench.md')) -eq 'Concurrent edit.') 'Concurrent edit was overwritten'
    }
    'source and rendered adapter changes invalidate preflight' = {
        $plan = Get-InstallTestPlan
        Write-InstallTestFile (Join-Path $script:ISource 'adapters/gigacode/commands/workbench.md') 'Changed gigacode-workbench/BOOTSTRAP.md'
        Assert-InstallThrows { Apply-InstallTestPlan $plan } 'Stale source/rendered bytes were accepted'
        Assert-InstallTest (-not [IO.Directory]::Exists($script:ITarget)) 'Stale source plan made writes'
    }
    'overlapping source and target rejected' = {
        $script:IOptions.TargetRoot = Join-Path $script:ISource 'inside'
        $plan = Get-InstallTestPlan
        Assert-InstallTest ($plan.status -eq 'blocked') 'Overlapping directories were accepted'
        Assert-InstallThrows { Apply-InstallTestPlan $plan } 'Blocked overlap was installed'
    }
    'destination file directory conflict is blocked' = {
        [void][IO.Directory]::CreateDirectory((Join-Path $script:ITarget 'commands/workbench.md'))
        $plan = Get-InstallTestPlan
        Assert-InstallTest ($plan.status -eq 'blocked' -and $plan.blocked_conflicts.Count -gt 0) 'Destination directory conflict was accepted'
    }
    'missing native command is blocked' = {
        [IO.File]::Delete((Join-Path $script:ISource 'adapters/gigacode/commands/workbench.md'))
        Assert-InstallTest ((Get-InstallTestPlan).status -eq 'blocked') 'Missing selected adapter was accepted'
    }
    'unique history survives consecutive upgrades' = {
        $first = Apply-InstallTestPlan (Get-InstallTestPlan)
        Write-InstallTestFile (Join-Path $script:ISource 'README.md') 'Second version.'
        $second = Apply-InstallTestPlan (Get-InstallTestPlan)
        Assert-InstallTest ($first.receipt_path -ne $second.receipt_path -and [IO.File]::Exists($first.receipt_path) -and [IO.File]::Exists($second.receipt_path)) 'History receipts collided'
    }
    'reparse destination is rejected' = {
        $outside = Join-Path $script:IBase 'outside fixture'; [void][IO.Directory]::CreateDirectory($outside)
        [void][IO.Directory]::CreateDirectory($script:ITarget)
        $link = Join-Path $script:ITarget 'commands'
        $kind = 'SymbolicLink'; if ($script:WIWindows) { $kind = 'Junction' }
        [void](New-Item -ItemType $kind -Path $link -Target $outside)
        $plan = Get-InstallTestPlan
        Assert-InstallTest ($plan.status -eq 'blocked') 'Reparse target was accepted'
        Assert-InstallTest (@(Get-ChildItem -LiteralPath $outside -Force).Count -eq 0) 'Preflight wrote through a reparse target'
    }
    'persistent memory is not traversed even when linked' = {
        $outside = Join-Path $script:IBase 'memory outside'; [void][IO.Directory]::CreateDirectory($outside)
        Write-InstallTestFile (Join-Path $outside 'fact.md') 'Persistent fact.'
        [void][IO.Directory]::CreateDirectory($script:ITarget)
        $kind = 'SymbolicLink'; if ($script:WIWindows) { $kind = 'Junction' }
        [void](New-Item -ItemType $kind -Path (Join-Path $script:ITarget 'workbench-memory') -Target $outside)
        $plan = Get-InstallTestPlan
        Assert-InstallTest ($plan.status -eq 'ready') 'Installer traversed unrelated persistent memory'
        $null = Apply-InstallTestPlan $plan
        Assert-InstallTest ([IO.File]::ReadAllText((Join-Path $outside 'fact.md')) -eq 'Persistent fact.') 'Persistent memory content changed'
    }
    'system prompt environment requires Windows and explicit switch' = {
        $plan = Get-InstallTestPlan
        Assert-InstallTest ($null -eq $plan.environment) 'Default plan unexpectedly changes User environment'
        if (-not $script:WIWindows) {
            $script:IOptions.SetUserSystemPrompt = $true
            $blocked = Get-InstallTestPlan
            Assert-InstallTest ($blocked.status -eq 'blocked' -and ($blocked.blocked_conflicts.reason -join ' ').Contains('only on Windows')) 'Non-Windows environment switch did not fail clearly'
        }
        # Never invoke the switch on Windows: tests must not read/write real User env.
    }
}
$failures = [Collections.Generic.List[string]]::new()
try {
    foreach ($name in $tests.Keys) {
        try { New-InstallFixture; & $tests[$name]; Write-Output ('PASS ' + $name) }
        catch { $message = $name + ': ' + $_.Exception.Message; $failures.Add($message); Write-Output ('FAIL ' + $message) }
    }
} finally { Remove-Item -LiteralPath $script:ITestRoot -Recurse -Force -ErrorAction SilentlyContinue }
Write-Output ('Tests: ' + $tests.Count + '; failures: ' + $failures.Count)
if ($failures.Count) { exit 1 }
exit 0
