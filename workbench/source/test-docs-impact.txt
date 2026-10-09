# test-docs-impact.ps1 — standalone Windows PowerShell 5.1 tests; no Pester or Python.
[CmdletBinding()]
param([string]$BundleRoot, [string]$PowerShellPath)
$ErrorActionPreference = 'Stop'
# Resolve automatic script paths after parameter binding on Windows PowerShell 5.1.
if (-not $BundleRoot) { $BundleRoot = Split-Path -Parent $PSScriptRoot }
$script:TestUtf8 = New-Object Text.UTF8Encoding($false)
$script:TestRoot = Join-Path ([IO.Path]::GetTempPath()) ('gigacode docs тест ' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($script:TestRoot)
$savedEnvironment = @{}
foreach ($key in @('GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_TERMINAL_PROMPT')) { $savedEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
$script:TestHelper = Join-Path $script:TestRoot 'docs-impact.ps1'
$source = Join-Path $BundleRoot 'tools/docs-impact.ps1'
if (-not [IO.File]::Exists($source)) { $source = Join-Path $BundleRoot 'tools/docs-impact' }
[IO.File]::WriteAllBytes($script:TestHelper, [IO.File]::ReadAllBytes($source))
. $script:TestHelper -LibraryOnly
if (-not $PowerShellPath) { $PowerShellPath = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName }
$script:TestPowerShell = $PowerShellPath

function Assert-Test {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}
function Write-TestFile {
    param([string]$Relative, [string]$Text)
    $path = Join-Path $script:TestRepo $Relative
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $Text, $script:TestUtf8)
}
function Invoke-TestGit {
    param([string[]]$GitArguments)
    $arguments = @('-C', $script:TestRepo, '-c', 'user.name=Docs Impact Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgSign=false', '-c', ('core.hooksPath=' + $script:EmptyHooks)) + $GitArguments
    $result = Invoke-DIProcess 'git' $arguments $script:TestRepo
    if ($result.ExitCode -ne 0) { throw ('Fixture Git failed: ' + (ConvertFrom-DIBytes $result.Stderr)) }
    return ,$result.Stdout
}
function Write-TestMap {
    param($Rules = $null, $Ignores = @(), [bool]$Configured = $true)
    if ($null -eq $Rules) { $Rules = @(@{ id = 'source-a'; sources = @('src/*'); documents = @('docs/a.md'); reason = 'Source behavior is described in A.' }) }
    $map = [ordered]@{ version = 1; configured = $Configured; rules = @($Rules); ignores = @($Ignores) }
    [IO.File]::WriteAllText($script:TestMap, ($map | ConvertTo-Json -Depth 16), $script:TestUtf8)
}
function New-TestFixture {
    $base = Join-Path $script:TestRoot ([guid]::NewGuid().ToString('N'))
    $script:TestRepo = Join-Path $base 'проект с пробелами'
    $script:TestMap = Join-Path $base 'карта документов.json'
    $script:EmptyHooks = Join-Path $base 'empty hooks'
    [void][IO.Directory]::CreateDirectory($script:TestRepo)
    [void][IO.Directory]::CreateDirectory($script:EmptyHooks)
    $null = Invoke-TestGit @('init', '-q')
    foreach ($entry in @{
        'src/a.py' = "def value_a():`n    return 1`n";
        'src/b.py' = "def value_b():`n    return 2`n";
        'docs/a.md' = "# A`nCurrent A behavior.`n";
        'docs/b.md' = "# B`nCurrent B behavior.`n";
        'notes/note.md' = "Local notes.`n"
    }.GetEnumerator()) { Write-TestFile $entry.Key $entry.Value }
    $null = Invoke-TestGit @('add', '.')
    $null = Invoke-TestGit @('commit', '-qm', 'Initial isolated fixture')
    Write-TestMap
}
function Inspect-Test {
    param([switch]$Staged, [string]$Base = 'HEAD')
    return Get-DocsImpact -Repo $script:TestRepo -Map $script:TestMap -Staged:$Staged -Base $Base
}
function Inspect-TestCli {
    param([string[]]$Extra = @())
    $arguments = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script:TestHelper, '-Repo', $script:TestRepo, '-Map', $script:TestMap) + $Extra
    $result = Invoke-DIProcess -File $script:TestPowerShell -Argv $arguments -Directory $script:TestRepo
    $text = ConvertFrom-DIBytes $result.Stdout
    try { $data = ConvertFrom-Json -InputObject $text }
    catch { throw ('CLI returned no JSON: ' + $text + '; stderr: ' + (ConvertFrom-DIBytes $result.Stderr)) }
    return @{ Code = $result.ExitCode; Data = $data }
}
function Get-TestPaths {
    param($Records)
    foreach ($record in $Records) {
        foreach ($key in @('path', 'old_path', 'new_path')) {
            if ($record -is [Collections.IDictionary]) { if ($record.Contains($key)) { $record[$key] } }
            elseif ($record.PSObject.Properties[$key]) { $record.$key }
        }
    }
}

$tests = [ordered]@{
    'clean tree and exit 0' = {
        $result = Inspect-Test
        Assert-Test ($result.status -eq 'no_op_candidate' -and $result.changed_files.Count -eq 0) 'Clean tree was not a no-op candidate'
        $cli = Inspect-TestCli
        Assert-Test ($cli.Code -eq 0 -and $cli.Data.status -eq 'no_op_candidate') 'CLI exit 0 contract failed'
        Assert-Test ($cli.Data.changed_files -is [Array] -and $cli.Data.affected_documents -is [Array]) 'Empty arrays were not preserved in JSON'
    }
    'staged source plus unstaged document and exit 1' = {
        Write-TestFile 'src/a.py' "def value_a():`n    return 10`n"
        $null = Invoke-TestGit @('add', 'src/a.py')
        Write-TestFile 'docs/a.md' "# A`nOnly working tree documentation.`n"
        $result = Inspect-Test -Staged
        Assert-Test ($result.status -eq 'needs_review') 'Staged source must require review'
        Assert-Test ('docs/a.md' -notin @(Get-TestPaths $result.changed_files)) 'Unstaged document leaked into index changes'
        Assert-Test ('docs/a.md' -in @(Get-TestPaths $result.stale_index_docs)) 'Unstaged document was not flagged'
        $cli = Inspect-TestCli @('-Staged')
        Assert-Test ($cli.Code -eq 1 -and $cli.Data.status -eq 'needs_review') 'CLI exit 1 contract failed'
    }
    'unmapped source requires review' = {
        Write-TestMap -Rules @(@{ id = 'only-a'; sources = @('src/a.py'); documents = @('docs/a.md'); reason = 'Only A is mapped.' })
        Write-TestFile 'src/b.py' "def value_b():`n    return 20`n"
        $result = Inspect-Test
        Assert-Test ($result.status -eq 'needs_review' -and 'src/b.py' -in @(Get-TestPaths $result.unmapped_changes)) 'Unknown source did not require review'
    }
    'rename maps both names' = {
        Write-TestMap -Rules @(
            @{ id = 'old'; sources = @('src/a.py'); documents = @('docs/a.md'); reason = 'Old path.' },
            @{ id = 'new'; sources = @('src/renamed.py'); documents = @('docs/b.md'); reason = 'New path.' }
        )
        $null = Invoke-TestGit @('mv', 'src/a.py', 'src/renamed.py')
        $result = Inspect-Test
        $rename = @($result.changed_files | Where-Object { $_.status.StartsWith('R') })
        Assert-Test ($rename.Count -eq 1 -and $rename[0].old_path -eq 'src/a.py' -and $rename[0].new_path -eq 'src/renamed.py') 'Rename sides were lost'
        $paths = @(Get-TestPaths $result.affected_documents)
        Assert-Test ($paths.Count -eq 2 -and 'docs/a.md' -in $paths -and 'docs/b.md' -in $paths) 'Both rename mappings were not retained'
    }
    'untracked default but not index' = {
        Write-TestFile 'src/new.py' 'NEW_VALUE = 7'
        $normal = Inspect-Test; $index = Inspect-Test -Staged
        Assert-Test ($normal.status -eq 'needs_review' -and 'src/new.py' -in @(Get-TestPaths $normal.changed_files)) 'Untracked source was not discovered'
        Assert-Test ($index.status -eq 'no_op_candidate' -and $index.changed_files.Count -eq 0) 'Untracked source leaked into index scope'
    }
    'parent traversal rejected and exit 2' = {
        Write-TestMap -Rules @(@{ id = 'outside'; sources = @('src/*'); documents = @('../outside.md'); reason = 'Invalid path.' })
        $cli = Inspect-TestCli
        Assert-Test ($cli.Code -eq 2 -and $cli.Data.status -eq 'error') 'Traversal map was accepted'
    }
    'unconfigured is never a pass' = {
        Write-TestMap -Rules @() -Configured $false
        $result = Inspect-Test
        Assert-Test ($result.status -eq 'needs_configuration') 'Unconfigured map produced a pass'
    }
    'explicit ignore permits a no-op candidate' = {
        Write-TestMap -Ignores @(@{ pattern = 'notes/*'; reason = 'Local scratch notes.' })
        Write-TestFile 'notes/note.md' 'Updated notes.'
        $result = Inspect-Test
        Assert-Test ($result.status -eq 'no_op_candidate' -and 'notes/note.md' -in @(Get-TestPaths $result.ignored_changes)) 'Justified ignore was not reported'
    }
    'leading option base rejected' = {
        $cli = Inspect-TestCli @('-Base', '--cached')
        Assert-Test ($cli.Code -eq 2 -and $cli.Data.status -eq 'error') 'Leading option base was accepted'
    }
    'staged document does not prove freshness' = {
        Write-TestFile 'src/a.py' "def value_a():`n    return 10`n"
        Write-TestFile 'docs/a.md' 'Cosmetic edit only.'
        $null = Invoke-TestGit @('add', 'src/a.py', 'docs/a.md')
        $result = Inspect-Test -Staged
        Assert-Test ($result.status -eq 'needs_review' -and $result.semantic_freshness -eq 'not_evaluated' -and $result.stale_index_docs.Count -eq 0) 'Changed document was falsely accepted as current'
    }
    'partially mapped rename preserves unknown side' = {
        Write-TestMap -Rules @(@{ id = 'old'; sources = @('src/a.py'); documents = @('docs/a.md'); reason = 'Only old path.' })
        $null = Invoke-TestGit @('mv', 'src/a.py', 'src/new.py')
        $result = Inspect-Test
        Assert-Test ($result.status -eq 'needs_review' -and 'src/new.py' -in $result.unmapped_changes[0].unmapped_paths) 'Unknown rename destination was hidden'
    }
    'untracked dependency directories excluded' = {
        Write-TestFile 'node_modules/pkg/index.js' 'Installed dependency'
        Write-TestFile 'frontend/node_modules/pkg/index.js' 'Nested dependency'
        $result = Inspect-Test
        Assert-Test ($result.status -eq 'no_op_candidate' -and $result.changed_files.Count -eq 0) 'Dependency discovery exclusion failed'
    }
    'Cyrillic spaces and raw NUL filenames' = {
        Write-TestFile 'src/новая функция.py' 'VALUE = 7'
        Write-TestMap -Rules @(@{ id = 'unicode'; sources = @('src/новая функция.py'); documents = @('docs/описание функции.md'); reason = 'Описание функции.' })
        $result = Inspect-Test
        Assert-Test ('src/новая функция.py' -in @(Get-TestPaths $result.changed_files)) 'UTF-8 source path was corrupted'
        Assert-Test ('docs/описание функции.md' -in @(Get-TestPaths $result.affected_documents)) 'UTF-8 document path was corrupted'
        $cli = Inspect-TestCli
        Assert-Test ($cli.Code -eq 1 -and 'src/новая функция.py' -in @(Get-TestPaths $cli.Data.changed_files)) 'CLI Unicode/space argument round trip failed'
    }
    'explicit base revision includes committed change' = {
        $before = (ConvertFrom-DIBytes (Invoke-TestGit @('rev-parse', 'HEAD'))).Trim()
        Write-TestFile 'src/a.py' "def value_a():`n    return 10`n"
        $null = Invoke-TestGit @('add', 'src/a.py'); $null = Invoke-TestGit @('commit', '-qm', 'Change')
        $current = Inspect-Test; $previous = Inspect-Test -Base $before
        Assert-Test ($current.status -eq 'no_op_candidate' -and $previous.status -eq 'needs_review') 'Explicit base revision was ignored'
    }
    'fnmatchcase wildcard semantics' = {
        foreach ($case in @(
            @('src/nested/a.py', 'src/*', $true), @('src/A.py', 'src/a.py', $false),
            @('b', '[!a]', $true), @('a', '[!a]', $false), @(']', '[]]', $true),
            @('[', '[[]', $true), @('q', '[z-aq]', $true), @('z', '[z-a]', $false),
            @('x/y', '*?*', $true), @('abc', 'a[bc', $false), @('a[bc', 'a[bc', $true),
            @('😀', '?', $true), @('😀x', '?', $false), @('a', '[^]', $false), @('^', '[^]', $true)
        )) { Assert-Test ([Gigacode.DocsImpactNative]::FnMatch($case[0], $case[1]) -eq $case[2]) ('fnmatchcase mismatch: ' + ($case -join ', ')) }
        Assert-Test ([Gigacode.DocsImpactNative]::Quote('C:\with spaces\') -eq '"C:\with spaces\\"') 'Trailing backslash quoting failed'
        Assert-Test ([Gigacode.DocsImpactNative]::Quote('a"b') -eq '"a\"b"') 'Embedded quote escaping failed'
    }
}

$failures = [Collections.Generic.List[string]]::new()
try {
    $emptyConfig = Join-Path $script:TestRoot 'empty git config'
    [IO.File]::WriteAllText($emptyConfig, '', $script:TestUtf8)
    [Environment]::SetEnvironmentVariable('GIT_CONFIG_NOSYSTEM', '1', 'Process')
    [Environment]::SetEnvironmentVariable('GIT_CONFIG_GLOBAL', $emptyConfig, 'Process')
    [Environment]::SetEnvironmentVariable('GIT_TERMINAL_PROMPT', '0', 'Process')
    foreach ($name in $tests.Keys) {
        try { New-TestFixture; & $tests[$name]; Write-Output ('PASS ' + $name) }
        catch { $message = $name + ': ' + $_.Exception.Message; $failures.Add($message); Write-Output ('FAIL ' + $message) }
    }
} finally {
    foreach ($key in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key, $savedEnvironment[$key], 'Process') }
    Remove-Item -LiteralPath $script:TestRoot -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Output ('Tests: ' + $tests.Count + '; failures: ' + $failures.Count)
if ($failures.Count) { exit 1 }
exit 0
