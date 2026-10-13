#requires -Version 5.1
<#
Independent controller/journal tests. No Pester, Python, model, MCP or network.
The package preparation step copies this extensionless UTF-8 BOM file to .ps1.
Run: powershell -NoProfile -File tests\test-workbench.ps1
PowerShell 7 can run these tests, but does not establish Windows 5.1 compatibility.
#>
[CmdletBinding()]
param(
    [string]$WorkbenchPath,
    [string]$TemporaryRoot,
    [switch]$KeepTemporary
)

$ErrorActionPreference = 'Stop'
$script:TResults = New-Object 'System.Collections.Generic.List[object]'
$script:TEncoding = New-Object System.Text.UTF8Encoding($false)
$script:TExe = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
$script:TTemporary = $null

function T-Assert {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw ('ASSERT: ' + $Message) }
}

function T-Canonical {
    param($Value)
    if ($null -eq $Value) { return 'null' }
    # ConvertFrom-Json may coerce ISO timestamps to local DateTime. Compare their
    # instants with runtime date strings; separate assertions check raw timezone.
    if (($Value -is [DateTime]) -or ($Value -is [DateTimeOffset])) {
        return 'timestamp:' + ([DateTimeOffset]$Value).ToUniversalTime().ToString('o')
    }
    if (($Value -is [string]) -and ($Value -match '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$')) {
        return 'timestamp:' + ([DateTimeOffset]::Parse($Value)).ToUniversalTime().ToString('o')
    }
    if ($Value -is [System.Collections.IDictionary]) {
        $parts = @($Value.Keys | Sort-Object | ForEach-Object {
            (ConvertTo-Json -InputObject ([string]$_) -Compress) + ':' + (T-Canonical $Value[$_])
        })
        return '{' + ($parts -join ',') + '}'
    }
    if ($Value -is [pscustomobject]) {
        $parts = @($Value.PSObject.Properties.Name | Sort-Object | ForEach-Object {
            (ConvertTo-Json -InputObject ([string]$_) -Compress) + ':' + (T-Canonical $Value.$_)
        })
        return '{' + ($parts -join ',') + '}'
    }
    if (($Value -is [System.Collections.IEnumerable]) -and -not ($Value -is [string])) {
        $parts = @($Value | ForEach-Object { T-Canonical $_ })
        return '[' + ($parts -join ',') + ']'
    }
    return (ConvertTo-Json -InputObject $Value -Compress -Depth 100)
}

function T-Equal {
    param($Actual, $Expected, [string]$Message = 'Values differ')
    $actualText = T-Canonical $Actual
    $expectedText = T-Canonical $Expected
    if ($actualText -cne $expectedText) {
        throw ('ASSERT: ' + $Message + '; expected=' + $expectedText + '; actual=' + $actualText)
    }
}

function T-WriteText {
    param([string]$Path, [string]$Text)
    [System.IO.File]::WriteAllText($Path, $Text, $script:TEncoding)
}

function T-WriteJson {
    param([string]$Path, $Value)
    T-WriteText $Path ((ConvertTo-Json -InputObject $Value -Depth 100) + "`n")
}

function T-ReadJson {
    param([string]$Path)
    return (ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)))
}

function T-Sha {
    param([string]$Path)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($algorithm.ComputeHash([System.IO.File]::ReadAllBytes($Path)))).Replace('-', '').ToLowerInvariant()
    } finally { $algorithm.Dispose() }
}

function T-Snapshot {
    return [Convert]::ToBase64String([System.IO.File]::ReadAllBytes((Join-Path $script:TRun 'state.json')))
}

function T-State { return T-ReadJson (Join-Path $script:TRun 'state.json') }

function T-Invoke {
    param([string]$Command, [hashtable]$Options = @{})
    $parameters = @{
        command=$Command; run=$script:TRun; workflow='synthetic'; project=$script:TProject;
        task='Verify controller invariants with Unicode paths: проверка.'; max_attempts=3;
        context_mode='full'; full=$false; after=0; limit=100; evidence=@();
        operation_id=$null; expected_revision=$null; details=$null; summary='Local fixture observation.'
    }
    foreach ($key in $Options.Keys) { $parameters[$key] = $Options[$key] }
    return WB-Dispatch -Options $parameters
}

function T-NextJson {
    param($Value)
    $script:TSequence += 1
    $path = Join-Path $script:TCase ('input-' + $script:TSequence + '.json')
    T-WriteJson $path $Value
    return $path
}

function T-Evidence {
    param([string]$Name = 'operation.txt', [string]$Content = "Observed local fixture.`n")
    $relative = 'evidence/' + $Name
    T-WriteText (Join-Path $script:TRun $relative) $Content
    return $relative
}

function T-Report {
    $state = T-State
    $stage = $state.workflow.stages[$state.index].id
    $prefix = $stage + '-r' + $state.revision
    $artifact = 'artifacts/' + $prefix + '.txt'
    T-WriteText (Join-Path $script:TRun $artifact) "Deliverable for isolated fixture.`n"
    $evidence = T-Evidence ($prefix + '.txt')
    return @{
        schema_version=1; run_id=$state.run_id; workflow=$state.workflow.id; stage=$stage;
        revision=$state.revision; attempt_id=$state.attempt_id; status='completed';
        summary='Observed isolated fixture; no product check is implied.';
        source_revision='fixture-source-v1'; spec_revision='fixture-spec-v1';
        artifacts=@{deliverable=$artifact};
        checks=@{'observed-result'=@{outcome='pass'; evidence=@($evidence); explanation='Local fixture only.'}};
        questions=@(); blockers=@()
    }
}

function T-Submit {
    param($Report)
    return T-Invoke 'submit' @{result=(T-NextJson $Report)}
}

function T-Rejected {
    param([scriptblock]$Operation, [switch]$ExistingLock)
    $before = T-Snapshot
    $rejected = $false
    try { $null = & $Operation } catch {
        if ($_.Exception.Message.StartsWith('ASSERT:')) { throw }
        $expectedFailure = $false
        $exception = $_.Exception
        while ($null -ne $exception) {
            if ($exception.GetType().FullName -eq 'WorkbenchPortable.InvalidException') { $expectedFailure = $true; break }
            $exception = $exception.InnerException
        }
        if (-not $expectedFailure) { throw }
        $rejected = $true
    }
    T-Assert $rejected 'Expected the controller to reject the operation'
    T-Equal (T-Snapshot) $before 'Rejected operation changed state bytes'
    if (-not $ExistingLock) {
        T-Assert (-not [System.IO.File]::Exists((Join-Path $script:TRun '.workbench.lock'))) 'Rejected operation leaked a lock'
    }
}

function T-Rework {
    param([string]$Target)
    return T-Invoke 'rework' @{target=$Target; reason='Recheck affected fixture requirements.'}
}
function T-Cancel { return T-Invoke 'cancel' @{reason='Pause the fixture.'} }
function T-Resume { return T-Invoke 'resume' @{note='Recorded the required decision.'} }

function T-Record {
    param(
        [string]$Kind,
        [string]$OperationId,
        $Details = $null,
        [string[]]$Evidence = @(),
        $ExpectedRevision = $null,
        [string]$Summary = 'Recorded an isolated fixture observation.'
    )
    $detailPath = $null
    if ($null -ne $Details) { $detailPath = T-NextJson $Details }
    return T-Invoke 'record' @{
        kind=$Kind; operation_id=$OperationId; details=$detailPath; evidence=@($Evidence);
        expected_revision=$ExpectedRevision; summary=$Summary
    }
}

function T-Start {
    param([string]$OperationId = 'fixture-operation', $ExpectedRevision = $null)
    return T-Record 'action_started' -OperationId $OperationId -ExpectedRevision $ExpectedRevision -Details @{
        target='isolated local fixture'; intent='observe a simulated operation';
        expected_result='fixture evidence exists'; reconcile='read evidence before any retry'
    }
}

function T-Finish {
    param([string]$Evidence = 'evidence/operation.txt', [string]$OperationId = 'fixture-operation')
    return T-Record 'action_finished' -OperationId $OperationId -Details @{outcome='verified_success'} -Evidence @($Evidence)
}

function T-Native {
    param([string[]]$Arguments)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(& $script:TExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script:TController @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
    return @{exit_code=$exitCode; output=(@($output | ForEach-Object { $_.ToString() }) -join "`n")}
}

function T-Case {
    param([string]$Name, [scriptblock]$Body)
    $script:TCase = Join-Path $script:TTemporary ('случай ' + ([Guid]::NewGuid().ToString('N')))
    $null = [System.IO.Directory]::CreateDirectory($script:TCase)
    $script:TProject = Join-Path $script:TCase 'проект с пробелами'
    $null = [System.IO.Directory]::CreateDirectory($script:TProject)
    $script:TRun = Join-Path $script:TCase 'запуск задачи'
    $script:TSequence = 0
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    $outcome = 'pass'
    $detail = ''
    try {
        WB-SetRoot -Path $script:TFixture
        $null = & $Body
    } catch {
        $detail = $_.Exception.Message
        if ($detail.StartsWith('SKIP:')) { $outcome = 'skip' } else { $outcome = 'fail' }
        $detail += ' | ' + $_.ScriptStackTrace
    } finally {
        $timer.Stop()
        $script:TResults.Add([ordered]@{name=$Name; status=$outcome; milliseconds=$timer.ElapsedMilliseconds; detail=$detail})
    }
}

$fatal = $null
try {
    if ([string]::IsNullOrWhiteSpace($WorkbenchPath)) {
        $bundle = Split-Path -Parent $PSScriptRoot
        $WorkbenchPath = Join-Path $bundle 'workbench.ps1'
        if (-not [System.IO.File]::Exists($WorkbenchPath)) { $WorkbenchPath = Join-Path $bundle 'workbench' }
    }
    $WorkbenchPath = [System.IO.Path]::GetFullPath($WorkbenchPath)
    $script:TBundle = Split-Path -Parent $WorkbenchPath
    T-Assert ([System.IO.File]::Exists($WorkbenchPath)) 'Controller source not found'
    if ([string]::IsNullOrWhiteSpace($TemporaryRoot)) { $TemporaryRoot = [System.IO.Path]::GetTempPath() }
    $script:TTemporary = Join-Path ([System.IO.Path]::GetFullPath($TemporaryRoot)) ('Workbench тест ' + [Guid]::NewGuid().ToString('N'))
    $script:TFixture = Join-Path $script:TTemporary 'пакет fixture'
    $null = [System.IO.Directory]::CreateDirectory((Join-Path $script:TFixture 'workflows'))
    $null = [System.IO.Directory]::CreateDirectory((Join-Path $script:TFixture 'profiles'))
    $script:TController = Join-Path $script:TFixture 'workbench.ps1'
    [System.IO.File]::Copy($WorkbenchPath, $script:TController)
    T-WriteText (Join-Path $script:TFixture 'CORE.md') "# Test core`n"
    T-WriteText (Join-Path $script:TFixture 'SYSTEM_PROMPT.md') "# Unique system policy`n"
    foreach ($profile in @('analyst','spec','architect','backend','database','designer','frontend','security','devops','qa','reviewer','diagnostics','technical-writer','gigacode-ui')) {
        T-WriteText (Join-Path $script:TFixture ('profiles/' + $profile + '.md')) ("# Test profile: " + $profile + "`n")
    }
    $stageIds = @('define','implement','accept')
    $stageProfiles = @('spec','backend','qa')
    $stages = @()
    for ($i=0; $i -lt 3; $i++) {
        $previousIds = @()
        if ($i -gt 0) { $previousIds = @($stageIds[0..($i-1)]) }
        $stages += @{
            id=$stageIds[$i]; profile=$stageProfiles[$i]; title=('Fixture '+$stageIds[$i]);
            instructions=@('Inspect the isolated fixture result.'); required_artifacts=@('deliverable');
            checks=@(@{id='observed-result'; kind='execution'; description='Observe fixture.'; allow_na=$false});
            capabilities=@('repo.read','test.run'); rework_targets=$previousIds
        }
    }
    T-WriteJson (Join-Path $script:TFixture 'workflows/synthetic.json') @{
        schema_version=1; id='synthetic'; title='Controller integration fixture';
        description='Local test only; no real external operation.'; stages=$stages
    }
    . $script:TController -LibraryOnly

    T-Case 'JSON codec preserves case-distinct keys arrays and date strings' {
        $path=Join-Path $script:TCase 'codec.json'
        T-WriteText $path '{"Key":"upper","key":"lower","empty":[],"at":"2026-10-09T12:34:56+10:00"}'
        $parsed=WB-ReadJson -Path $path
        T-Equal $parsed.Count 4
        T-Equal $parsed['Key'] 'upper'; T-Equal $parsed['key'] 'lower'
        T-Assert ($parsed['at'] -is [string]) 'Codec coerced a JSON timestamp'
        T-Assert ($parsed['at'] -ceq '2026-10-09T12:34:56+10:00') 'Codec changed timestamp spelling'
        T-Equal @($parsed['empty']).Count 0
        WB-WriteAtomicJson -Path $path -Data $parsed
        $raw=[IO.File]::ReadAllText($path,[Text.Encoding]::UTF8)
        T-Assert ($raw -cmatch '"Key"\s*:\s*"upper"') 'Uppercase key lost on write'
        T-Assert ($raw -cmatch '"key"\s*:\s*"lower"') 'Lowercase key lost on write'
        T-Assert ($raw -match '"empty"\s*:\s*\[\s*\]') 'Empty array changed type'
    }
    T-Case 'canonical digest matches independent Unicode and case golden vector' {
        $path=Join-Path $script:TCase 'digest.json'
        T-WriteText $path '{"a":[],"A":{},"unicode":"Привет 🐈","line":"a\nb","numbers":[0,-2,15],"\ue000":1,"😀":2}'
        # Golden SHA256 of UTF-8 JSON with ordinal Unicode-codepoint key order,
        # unescaped Unicode and Python default comma-space/colon-space separators.
        $digest=WB-Digest -Value (WB-ReadJson -Path $path)
        T-Equal $digest 'eed88b7d9015679a475079c9f48e1849f562b435623bd025c391dc067e8299e1'
    }
    T-Case 'unsupported floating-point digest rejects explicit migration need' {
        $null=T-Invoke 'init'
        $path=Join-Path $script:TCase 'floating.json'
        T-WriteText $path '{"metadata":1.5}'
        T-Rejected {WB-Digest -Value (WB-ReadJson -Path $path)}
    }
    T-Case 'real workflow catalog and fourteen profiles validate' {
        WB-SetRoot -Path $script:TBundle
        $result = T-Invoke 'validate'
        T-Assert $result.valid 'Real catalog is invalid'
        T-Equal $result.profiles 14
        T-Equal $result.workflows @((Get-ChildItem -LiteralPath (Join-Path $script:TBundle 'workflows') -Filter '*.json' -File)).Count
        T-Assert ($result.stages -ge $result.workflows) 'Stage count is invalid'
    }
    T-Case 'successful multistage completion and Unicode paths' {
        $initial = T-Invoke 'init'
        T-Equal $initial.stage 'define'
        $prompt = T-Invoke 'prompt'
        T-Assert ($prompt.Contains('# Test core')) 'Core missing'
        T-Assert ($prompt.Contains('# Test profile: spec')) 'Profile missing'
        foreach ($expected in @('define','implement','accept')) {
            $state = T-State
            T-Equal $state.workflow.stages[$state.index].id $expected
            $last = T-Submit (T-Report)
        }
        T-Equal $last.status 'completed'
        T-Equal $last.stage $null
        $state = T-State
        T-Equal $state.index 3
        T-Equal @($state.records | ForEach-Object {$_.stage}) @('define','implement','accept')
        T-Equal $state.attempts @{define=1; implement=1; accept=1}
        T-Equal @($state.events).Count 3
        T-Assert (T-Invoke 'verify').valid 'Accepted files did not verify'
    }
    T-Case 'missing evidence rejects without state mutation' {
        $null = T-Invoke 'init'; $report = T-Report
        $report.checks['observed-result'].evidence = @()
        T-Rejected { T-Submit $report }
        T-Equal @((T-State).records).Count 0
    }
    T-Case 'stale report after pause and resume is rejected' {
        $null = T-Invoke 'init'; $old = T-Report
        $paused = T-Report; $paused.status='waiting_input'; $paused.questions=@('Choose required behavior.')
        $null = T-Submit $paused
        T-Equal (T-State).status 'waiting_input'
        $null = T-Resume
        T-Assert ((T-State).attempt_id -ne $old.attempt_id) 'Attempt identity was reused'
        T-Rejected { T-Submit $old }
        T-Equal (T-Submit (T-Report)).stage 'implement'
    }
    T-Case 'changed accepted file blocks prompt and next completion' {
        $null = T-Invoke 'init'; $report=T-Report; $null=T-Submit $report
        T-WriteText (Join-Path $script:TRun $report.artifacts.deliverable) 'Unreviewed content.'
        T-Rejected { T-Invoke 'prompt' }
        $next=T-Report; T-Rejected { T-Submit $next }
    }
    T-Case 'rework invalidates successors and preserves history' {
        $null=T-Invoke 'init'
        1..3 | ForEach-Object { $null=T-Submit (T-Report) }
        $before=T-State; $result=T-Rework 'implement'; $after=T-State
        T-Equal $result.status 'ready'; T-Equal $result.stage 'implement'
        T-Equal @($after.records) @($before.records[0])
        T-Equal @($after.archived_records | ForEach-Object {$_.record}) @($before.records[1],$before.records[2])
        T-Equal @($after.events[0..2]) @($before.events)
        T-Equal $after.events[-1].details.invalidated @('implement','accept')
        T-Equal $after.attempts.implement 2
        foreach ($record in $before.records) { foreach ($file in $record.files) {
            T-Assert ([IO.File]::Exists((Join-Path $script:TRun $file.path))) 'History artifact removed'
        }}
        $null=T-Submit (T-Report); $null=T-Submit (T-Report)
        T-Equal (T-State).status 'completed'; T-Equal @((T-State).archived_records).Count 2
    }
    T-Case 'budget cannot be bypassed by cancel and resume' {
        $null=T-Invoke 'init' @{max_attempts=1}
        T-Equal (T-Rework 'define').status 'blocked_budget'
        T-Rejected {T-Resume}; $null=T-Cancel
        T-Equal (T-Resume).status 'blocked_budget'
        T-Equal (T-State).attempts.define 2
        T-Rejected {T-Submit (T-Report)}; T-Rejected {T-Resume}
    }
    T-Case 'needs_rework cannot be bypassed by cancel and resume' {
        $null=T-Invoke 'init'; $null=T-Submit (T-Report)
        $report=T-Report; $report.status='needs_rework'; $report.return_to='define'; $null=T-Submit $report
        T-Rejected {T-Resume}; $null=T-Cancel
        T-Equal (T-Resume).status 'needs_rework'
        T-Equal (T-State).last_result.return_to 'define'
        T-Rejected {T-Submit (T-Report)}; T-Rejected {T-Rework 'implement'}
        T-Equal (T-Rework 'define').stage 'define'
    }
    T-Case 'path traversal and absolute evidence paths are denied' {
        $null=T-Invoke 'init'; $outside=Join-Path $script:TCase 'outside.txt'; T-WriteText $outside 'Outside.'
        foreach ($bad in @('../outside.txt','artifacts/../../outside.txt','artifacts/../state.json',$outside)) {
            $report=T-Report; $report.artifacts.deliverable=$bad
            T-Rejected {T-Submit $report}
        }
    }
    T-Case 'symlink file and directory outside run are denied' {
        $null=T-Invoke 'init'; $outside=Join-Path $script:TCase 'outside directory'
        $null=[IO.Directory]::CreateDirectory($outside); T-WriteText (Join-Path $outside 'proof.txt') 'Outside.'
        $fileLink=Join-Path $script:TRun 'artifacts/external-file.txt'
        $dirLink=Join-Path $script:TRun 'evidence/external-directory'
        try {
            $null=New-Item -ItemType SymbolicLink -Path $fileLink -Target (Join-Path $outside 'proof.txt') -ErrorAction Stop
            $null=New-Item -ItemType SymbolicLink -Path $dirLink -Target $outside -ErrorAction Stop
        } catch { throw ('SKIP: OS did not permit symlink creation: '+$_.Exception.Message) }
        foreach ($bad in @('artifacts/external-file.txt','evidence/external-directory/proof.txt')) {
            $report=T-Report; $report.checks['observed-result'].evidence=@($bad)
            T-Rejected {T-Submit $report}
        }
    }
    T-Case 'dot is not a valid artifact' {
        $null=T-Invoke 'init'; $report=T-Report; $report.artifacts.deliverable='.'
        T-Rejected {T-Submit $report}
    }
    T-Case 'future stage cannot be selected by rework' {
        $null=T-Invoke 'init'; T-Rejected {T-Rework 'accept'}; T-Equal (T-State).index 0
    }
    T-Case 'duplicate report cannot advance twice' {
        $null=T-Invoke 'init'; $report=T-Report; $null=T-Submit $report
        T-Rejected {T-Submit $report}; T-Equal @((T-State).records).Count 1; T-Equal (T-State).index 1
    }
    T-Case 'concurrent mutation preserves the other lock owner' {
        $null=T-Invoke 'init'; $report=T-Report; $lock=Join-Path $script:TRun '.workbench.lock'
        T-WriteText $lock 'other-process-owner'; $before=T-Sha $lock
        T-Rejected {T-Submit $report} -ExistingLock
        T-Equal (T-Sha $lock) $before 'Other lock was removed or modified'
        [IO.File]::Delete($lock)
        T-Equal (T-Submit $report).stage 'implement'
    }
    T-Case 'not_applicable cannot bypass a mandatory check' {
        $null=T-Invoke 'init'; $report=T-Report
        $report.checks['observed-result'].outcome='not_applicable'
        $report.checks['observed-result'].explanation='Reason cannot override allow_na=false.'
        T-Rejected {T-Submit $report}
    }
    T-Case 'context reuse omits only explicitly selected policy layers' {
        $null=T-Invoke 'init'; $before=T-Snapshot
        $hash=T-Sha (Join-Path $script:TFixture 'SYSTEM_PROMPT.md')
        foreach ($mode in @('full','role','stage')) {
            $prompt=T-Invoke 'prompt' @{context_mode=$mode}
            T-Equal $prompt.Contains('# Unique system policy') ($mode -eq 'full')
            T-Equal $prompt.Contains('# Test core') ($mode -eq 'full')
            T-Equal $prompt.Contains('# Test profile: spec') ($mode -ne 'stage')
            foreach ($part in @('Verify controller invariants','observed-result',$hash,'attempt_id')) {
                T-Assert ($prompt.Contains($part)) ('Prompt missing '+$part)
            }
        }
        T-Equal (T-Snapshot) $before
    }
    T-Case 'pending started action blocks completion' {
        $null=T-Invoke 'init'; T-Equal (T-Start).pending_actions 1
        T-Rejected {T-Submit (T-Report)}
        T-Equal (T-State).pending_actions.'fixture-operation'.status 'started'
    }
    T-Case 'journal pagination has no lost or duplicate events' {
        $null=T-Invoke 'init'
        0..6 | ForEach-Object {$null=T-Record 'observation' -Summary ('fact '+$_)}
        $before=T-Snapshot; $cursor=0; $seen=@(); $iterations=0
        do {
            $page=T-Invoke 'journal' @{after=$cursor;limit=3}
            $seen+=@($page.events | ForEach-Object {$_.sequence}); $cursor=$page.next_after
            $iterations+=1; T-Assert ($iterations -lt 10) 'Pagination did not terminate'
        } while ($page.has_more)
        T-Equal $seen @(1..7); T-Equal (T-Snapshot) $before
    }
    T-Case 'compact recovery selects latest checkpoint and its tail' {
        $null=T-Invoke 'init'; $null=T-Record 'observation'
        $null=T-Record 'checkpoint' -Evidence @((T-Evidence 'checkpoint.md'))
        $null=T-Record 'decision'
        $result=T-Invoke 'recover'
        T-Equal $result.latest_checkpoint.sequence 2; T-Equal $result.journal_after_sequence 2
        T-Equal @($result.events | ForEach-Object {$_.sequence}) @(3)
        T-Equal $result.events_total 3; T-Equal $result.events_omitted 2
    }
    T-Case 'journal rejects invalid pagination' {
        $null=T-Invoke 'init'
        foreach ($pair in @(@(-1,10),@(0,0),@(0,501))) {
            T-Rejected {T-Invoke 'journal' @{after=$pair[0];limit=$pair[1]}}
        }
    }
    T-Case 'unknown outcome cannot finish even when evidence exists' {
        $null=T-Invoke 'init'; $null=T-Start; $null=T-Record 'action_unknown' -OperationId 'fixture-operation'
        $evidence=T-Evidence
        foreach ($outcome in @($null,'unknown','success')) {
            $details=@{}; if ($null -ne $outcome) {$details.outcome=$outcome}
            T-Rejected {T-Record 'action_finished' -OperationId 'fixture-operation' -Details $details -Evidence @($evidence)}
        }
        T-Equal (T-State).pending_actions.'fixture-operation'.status 'unknown'
    }
    T-Case 'verified outcome requires existing evidence' {
        $null=T-Invoke 'init'; $null=T-Start
        T-Rejected {T-Record 'action_finished' -OperationId 'fixture-operation' -Details @{outcome='verified_success'}}
        T-Rejected {T-Finish 'evidence/missing.txt'}
    }
    T-Case 'verified outcome resolves pending and preserves original action' {
        $null=T-Invoke 'init'; $null=T-Start; $original=(T-State).pending_actions.'fixture-operation'
        $null=T-Record 'action_unknown' -OperationId 'fixture-operation'
        T-Equal (T-Finish (T-Evidence)).pending_actions 0
        $state=T-State; T-Equal $state.pending_actions @{}
        T-Equal $state.events[-1].details.data.original_action.attempt_id $original.attempt_id
        T-Equal $state.events[-1].details.data.original_action.status 'unknown'
        T-Equal (T-Submit (T-Report)).stage 'implement'
    }
    T-Case 'changed finished-action evidence blocks completion and appears in recovery' {
        $null=T-Invoke 'init'; $null=T-Start; $evidence=T-Evidence 'finished.txt'
        $null=T-Finish $evidence; $report=T-Report
        T-WriteText (Join-Path $script:TRun $evidence) 'Changed after recording.'
        T-Rejected {T-Submit $report}
        $recovered=T-Invoke 'recover' @{full=$true}
        T-Assert ((($recovered.integrity_problems -join "`n")).Contains($evidence)) 'Missing journal-integrity issue'
        T-Equal (T-State).index 0
    }
    T-Case 'duplicate operation id denied pending and after completion' {
        $null=T-Invoke 'init'; $null=T-Start; T-Rejected {T-Start}
        $null=T-Finish (T-Evidence); T-Rejected {T-Start}
    }
    T-Case 'stale expected revision rejects events without mutation' {
        $null=T-Invoke 'init'; $revision=(T-State).revision
        $null=T-Start -ExpectedRevision $revision
        T-Rejected {T-Record 'observation' -ExpectedRevision $revision}
        $evidence=T-Evidence
        T-Rejected {T-Record 'action_finished' -OperationId 'fixture-operation' -Details @{outcome='verified_success'} -Evidence @($evidence) -ExpectedRevision $revision}
    }
    T-Case 'cancel and resume preserve unresolved action' {
        $null=T-Invoke 'init'; $null=T-Start; $null=T-Record 'action_unknown' -OperationId 'fixture-operation'
        $initial=T-State; $null=T-Cancel
        T-Equal (T-State).pending_actions $initial.pending_actions
        $null=T-Resume; $state=T-State
        T-Equal $state.status 'ready'; T-Assert ($state.attempt_id -ne $initial.attempt_id) 'Attempt not renewed'
        T-Equal $state.pending_actions $initial.pending_actions
        T-Rejected {T-Submit (T-Report)}
    }
    T-Case 'full recovery returns all events and integrity issues read-only' {
        $null=T-Invoke 'init'; $report=T-Report; $null=T-Submit $report
        $journalFile=T-Evidence 'journal-original.txt'; $null=T-Record 'observation' -Evidence @($journalFile)
        0..44 | ForEach-Object {$null=T-Record 'checkpoint' -Details @{checkpoint_index=$_}}
        $null=T-Start; $null=T-Record 'action_unknown' -OperationId 'fixture-operation'
        $artifact=$report.artifacts.deliverable
        T-WriteText (Join-Path $script:TRun $artifact) 'Changed accepted artifact.'
        [IO.File]::Delete((Join-Path $script:TRun $journalFile))
        $before=T-Snapshot; $statePath=Join-Path $script:TRun 'state.json'
        $mtime=[IO.File]::GetLastWriteTimeUtc($statePath).Ticks
        $full=T-Invoke 'recover' @{full=$true}; $state=T-State
        T-Equal @($full.events) @($state.events); T-Assert ($full.events_total -gt 40) 'Fixture journal too short'
        T-Equal $full.events_omitted 0; T-Equal $full.pending_actions $state.pending_actions
        foreach ($path in @($artifact,$journalFile)) {
            T-Assert (($full.integrity_problems -join "`n").Contains($path)) ('Missing integrity issue '+$path)
        }
        $compact=T-Invoke 'recover'
        T-Equal @($compact.events) @($state.events[($state.events.Count-2)..($state.events.Count-1)])
        T-Equal $compact.latest_checkpoint.details.data.checkpoint_index 44
        T-Equal $compact.events_omitted ($state.events.Count-2)
        T-Assert (($compact.integrity_problems -join "`n").Contains($artifact)) 'Compact recovery lost accepted-file issue'
        T-Assert (-not (($compact.integrity_problems -join "`n").Contains($journalFile))) 'Compact recovery unexpectedly scanned omitted old event'
        T-Equal (T-Snapshot) $before; T-Equal ([IO.File]::GetLastWriteTimeUtc($statePath).Ticks) $mtime
        T-Assert (-not [IO.File]::Exists((Join-Path $script:TRun '.workbench.lock'))) 'Read-only recovery created a lock'
    }
    T-Case 'journal records recovery fields and file fingerprints' {
        $null=T-Invoke 'init'; $initial=T-State
        $started=T-Start -OperationId '' -ExpectedRevision 0; $event=(T-State).events[-1]
        T-Equal $event.sequence 1; T-Equal $event.state_revision 1
        # ConvertFrom-Json in some PS versions turns ISO strings into local DateTime.
        # Verify the serialized timestamp so the assertion is timezone independent.
        $rawState=[IO.File]::ReadAllText((Join-Path $script:TRun 'state.json'),[Text.Encoding]::UTF8)
        $timeMatches=[regex]::Matches($rawState,'"time"\s*:\s*"([^"]+)"')
        T-Assert ($timeMatches.Count -gt 0) 'No serialized event timestamp'
        $timestamp=$timeMatches[$timeMatches.Count-1].Groups[1].Value
        $parsed=[DateTimeOffset]::Parse($timestamp)
        T-Assert ($timestamp -match '(Z|[+-]\d\d:\d\d)$') 'Timestamp has no timezone'
        T-Equal $event.event 'action_started'; T-Assert (-not [string]::IsNullOrWhiteSpace($started.operation_id)) 'Missing generated operation id'
        T-Equal $event.details.operation_id $started.operation_id
        T-Equal $event.details.stage 'define'; T-Equal $event.details.attempt_id $initial.attempt_id
        T-Equal @($event.details.files).Count 0
        T-Equal @($event.details.data.PSObject.Properties.Name | Sort-Object) @('expected_result','intent','reconcile','target')
        $evidence=T-Evidence 'verification.txt' "Measured fixture outcome.`n"
        $null=T-Record 'verification' -OperationId $started.operation_id -Details @{method='read fixture'} -Evidence @($evidence) -ExpectedRevision 1
        $event=(T-State).events[-1]; $path=Join-Path $script:TRun $evidence
        T-Equal $event.sequence 2; T-Equal $event.state_revision 2
        T-Equal $event.details.data @{method='read fixture'}
        T-Equal @($event.details.files) @(@{path=$evidence;sha256=(T-Sha $path);bytes=([IO.File]::ReadAllBytes($path).Length)})
        T-Assert ($null -ne (T-State).pending_actions.PSObject.Properties[$started.operation_id]) 'Verification incorrectly completed action'
    }
    T-Case 'pending action prevents rework until outcome is reconciled' {
        $null=T-Invoke 'init'; $null=T-Start
        T-Rejected {T-Rework 'define'}
        $null=T-Finish (T-Evidence)
        T-Equal (T-Rework 'define').status 'ready'
    }
    T-Case 'CLI emits JSON and exit zero for status and full recovery' {
        $null=T-Invoke 'init'; $null=T-Record 'observation' -Summary 'Unicode CLI: проверка.'
        foreach ($command in @('status','recover')) {
            $arguments=@($command,'-Run',$script:TRun)
            if ($command -eq 'recover') {$arguments+='-Full'}
            $native=T-Native $arguments
            T-Equal $native.exit_code 0 ('CLI failed: '+$native.output)
            $result=ConvertFrom-Json -InputObject $native.output
            T-Equal $result.run_id (T-State).run_id
            if ($command -eq 'recover') {T-Equal $result.events_total 1}
        }
    }
    T-Case 'CLI rejected submission exits two without state mutation' {
        $null=T-Invoke 'init'; $report=T-Report; $report.checks['observed-result'].evidence=@()
        $path=T-NextJson $report; $before=T-Snapshot
        $native=T-Native @('submit','-Run',$script:TRun,'-Result',$path)
        T-Equal $native.exit_code 2 ('Expected CLI validation exit 2: '+$native.output)
        T-Equal (T-Snapshot) $before
    }
} catch {
    $fatal=$_.Exception.Message+' | '+$_.ScriptStackTrace
    $script:TResults.Add([ordered]@{name='test harness setup';status='fail';milliseconds=0;detail=$fatal})
} finally {
    if ($script:TTemporary -and [IO.Directory]::Exists($script:TTemporary) -and -not $KeepTemporary) {
        try { Remove-Item -LiteralPath $script:TTemporary -Recurse -Force -ErrorAction Stop } catch {
            $script:TResults.Add([ordered]@{name='temporary cleanup';status='fail';milliseconds=0;detail=$_.Exception.Message})
        }
    }
}

$passed=@($script:TResults | Where-Object {$_.status -eq 'pass'}).Count
$failed=@($script:TResults | Where-Object {$_.status -eq 'fail'}).Count
$skipped=@($script:TResults | Where-Object {$_.status -eq 'skip'}).Count
$testSummary=[ordered]@{
    suite='workbench-controller-and-journal'; total=$script:TResults.Count; passed=$passed; failed=$failed; skipped=$skipped;
    runtime=$PSVersionTable.PSVersion.ToString(); platform=[Environment]::OSVersion.ToString();
    target='Windows PowerShell 5.1; this output records the actual runtime, not an unperformed target-platform test';
    temporary_path=$(if ($KeepTemporary) {$script:TTemporary} else {$null}); results=$script:TResults.ToArray()
}
Write-Output (ConvertTo-Json -InputObject $testSummary -Depth 100)
if ($failed -gt 0) {exit 1}
exit 0
