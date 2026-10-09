#requires -Version 5.1
<# Independent shared-memory regression tests. No Pester, Python, network or model.
   Actual runtime is reported; PS7 execution does not prove Windows PS5.1 execution. #>
[CmdletBinding()]
param([string]$MemoryPath,[string]$WorkbenchPath,[string]$TemporaryRoot,[switch]$KeepTemporary)
$ErrorActionPreference='Stop'
$script:MTConfig=@{memory=$MemoryPath;controller=$WorkbenchPath;temporary=$TemporaryRoot;keep=[bool]$KeepTemporary}
$script:MTResults=New-Object 'System.Collections.Generic.List[object]'
$script:MTExe=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
$script:MTBundle=Split-Path -Parent $PSScriptRoot
if (-not $script:MTConfig['memory']) { $script:MTConfig['memory']=Join-Path $script:MTBundle 'tools/memory' }
if (-not $script:MTConfig['controller']) { $script:MTConfig['controller']=Join-Path $script:MTBundle 'workbench' }
if (-not $script:MTConfig['temporary']) { $script:MTConfig['temporary']=[IO.Path]::GetTempPath() }
$script:MTTemp=Join-Path ([IO.Path]::GetFullPath($script:MTConfig['temporary'])) ('Workbench memory '+[Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($script:MTTemp)
$script:MTController=Join-Path $script:MTTemp 'workbench.ps1'; $script:MTMemory=Join-Path $script:MTTemp 'memory.ps1'
[IO.File]::Copy([IO.Path]::GetFullPath($script:MTConfig['controller']),$script:MTController)
[IO.File]::Copy([IO.Path]::GetFullPath($script:MTConfig['memory']),$script:MTMemory)
. $script:MTMemory -WorkbenchPath $script:MTController -LibraryOnly
function MT-Assert { param([bool]$Condition,[string]$Message) if(-not $Condition){throw ('ASSERT: '+$Message)} }
function MT-Equal { param($Actual,$Expected,[string]$Message='Values differ') MT-Assert ((WB-Json $Actual) -ceq (WB-Json $Expected)) ($Message+'; expected '+(WB-Json $Expected)+' actual '+(WB-Json $Actual)) }
function MT-State { return MEM-Load $script:MTStore }
function MT-Snapshot {
    $file=Join-Path $script:MTStore 'memory.json'
    if([IO.File]::Exists($file)){return [Convert]::ToBase64String([IO.File]::ReadAllBytes($file))}
    return '<absent>'
}
function MT-Rejected {
    param([scriptblock]$Body)
    $before=MT-Snapshot;$rejected=$false
    try { [void](& $Body) } catch {
        $exception=$_.Exception
        while($null -ne $exception){if($exception.GetType().FullName -ceq 'WorkbenchPortable.InvalidException'){$rejected=$true;break};$exception=$exception.InnerException}
        if(-not $rejected){throw}
    }
    MT-Assert $rejected 'Expected controller validation exception'
    MT-Equal (MT-Snapshot) $before 'Rejected operation mutated memory.json'
}
function MT-Invoke {
    param([string]$Command,$Extra=@{})
    $options=@{command=$Command;store=$script:MTStore;limit=25}
    foreach($key in $Extra.Keys){$options[$key]=$Extra[$key]}
    return MEM-Dispatch $options
}
function MT-Entry {
    param([string]$Content='Use the project build command.',[string]$Project='alpha')
    return @{key='build.command';category='project_fact';scope='project';project_id=$Project;summary='Build command';content=$Content;status='verified';sources=@(@{kind='repo';reference='README.md:12';revision='commit-123';observed_at='2026-10-09T00:00:00Z'})}
}
function MT-Remember {
    param($Entry,$Extra=@{})
    $path=Join-Path $script:MTCaseRoot ('input-'+[Guid]::NewGuid().ToString('N')+'.json');WB-WriteAtomicJson $path $Entry
    $options=@{input_path=$path};foreach($key in $Extra.Keys){$options[$key]=$Extra[$key]}
    return MT-Invoke 'remember' $options
}
function MT-Case {
    param([string]$Name,[scriptblock]$Body)
    $script:MTCaseRoot=Join-Path $script:MTTemp ([Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($script:MTCaseRoot);$script:MTStore=Join-Path $script:MTCaseRoot 'Память project'
    $watch=[Diagnostics.Stopwatch]::StartNew();$status='pass';$detail=''
    try{& $Body}catch{$status='fail';$detail=$_.Exception.Message+' | '+$_.ScriptStackTrace}
    $watch.Stop();$script:MTResults.Add(@{name=$Name;status=$status;milliseconds=$watch.ElapsedMilliseconds;detail=$detail})
}
try {
    MT-Case 'remember and get preserve Unicode, source provenance and revision' {
        $result=MT-Remember (MT-Entry 'Собрать через npm run build.')
        MT-Equal $result.revision 1;MT-Equal $result.counts.added 1
        $read=MT-Invoke 'get' @{id=$result.results[0].id;project_id='alpha'}
        MT-Equal $read.entry.content 'Собрать через npm run build.'
        MT-Equal $read.entry.sources[0].revision 'commit-123'
        MT-Equal $read.entry.effective_status 'verified'
        MT-Assert (MT-Invoke 'verify').valid 'Store must verify structurally'
    }
    MT-Case 'identical remember is idempotent without history growth' {
        $entry=MT-Entry;$first=MT-Remember $entry;$before=MT-Snapshot;$again=MT-Remember $entry
        MT-Equal $again.results[0].id $first.results[0].id
        MT-Equal $again.counts.deduplicated 1;MT-Equal (MT-Snapshot) $before
        MT-Equal (MT-State).events.Count 1
    }
    MT-Case 'conflicting value creates proposal and preserves verified original' {
        $first=MT-Remember (MT-Entry 'npm run build');$original=(MT-State).entries[0].record_hash
        $second=MT-Remember (MT-Entry 'pnpm build')
        MT-Equal $second.results[0].status 'proposed';MT-Equal $second.counts.proposed_conflict 1
        $state=MT-State;MT-Equal $state.entries.Count 2;MT-Equal $state.entries[0].record_hash $original
        MT-Equal $state.entries[0].content 'npm run build';MT-Equal $state.entries[0].status 'verified'
        $again=MT-Remember (MT-Entry 'pnpm build');MT-Equal $again.counts.deduplicated 1;MT-Equal (MT-State).entries.Count 2
    }
    MT-Case 'search globals plus matching project only and get denies another project' {
        [void](MT-Remember (MT-Entry 'alpha build' 'alpha'));$beta=MT-Remember (MT-Entry 'beta build' 'beta')
        $global=MT-Entry 'Prefer concise answers';$global.scope='global';$global.category='preference';$global.project_id=$null;$global.key='answer.style'
        [void](MT-Remember $global)
        $alpha=MT-Invoke 'search' @{project_id='alpha'};MT-Equal $alpha.returned 2
        foreach($entry in $alpha.results){MT-Assert ($entry.project_id -cne 'beta') 'Cross-project data leaked'}
        MT-Equal (MT-Invoke 'search').returned 1
        MT-Rejected { MT-Invoke 'get' @{id=$beta.results[0].id;project_id='alpha'} }
    }
    MT-Case 'expired entry is not returned as a current verified fact' {
        $entry=MT-Entry;$entry.expires_at='2000-01-01T00:00:00Z';$saved=MT-Remember $entry
        $read=MT-Invoke 'get' @{id=$saved.results[0].id;project_id='alpha'}
        MT-Equal $read.entry.status 'verified';MT-Equal $read.entry.effective_status 'needs_verification';MT-Assert $read.entry.expired 'Expiration not detected'
        MT-Equal (MT-Invoke 'search' @{project_id='alpha'}).results[0].effective_status 'needs_verification'
    }
    MT-Case 'legacy import never trusts verified status and repeat does not grow store' {
        $first=MT-Entry 'Historical command';$first.sources=@(@{kind='legacy';reference='old-notes.txt'})
        $second=MT-Entry 'Possible alternative';$second.key='alternate.command';$second.status='proposed'
        $path=Join-Path $script:MTCaseRoot 'legacy.json';WB-WriteAtomicJson $path @($first,$second);$inputBefore=WB-HashBytes ([IO.File]::ReadAllBytes($path))
        $saved=MT-Invoke 'import' @{input_path=$path};MT-Equal $saved.results[0].status 'needs_verification';MT-Equal $saved.results[1].status 'proposed'
        $before=MT-Snapshot;$again=MT-Invoke 'import' @{input_path=$path};MT-Equal $again.counts.deduplicated 2
        MT-Equal (MT-Snapshot) $before;MT-Equal (WB-HashBytes ([IO.File]::ReadAllBytes($path))) $inputBefore 'Legacy input modified'
    }
    MT-Case 'stale expected revision rejects append without mutation' {
        [void](MT-Remember (MT-Entry));MT-Rejected {MT-Remember (MT-Entry 'Changed') @{expected_revision=0}}
    }
    MT-Case 'concurrent write preserves existing lock and store bytes' {
        [void](MT-Remember (MT-Entry));$lock=Join-Path $script:MTStore '.workbench.lock'
        [IO.File]::WriteAllText($lock,'another-process');MT-Rejected {MT-Remember (MT-Entry 'Changed')}
        MT-Equal ([IO.File]::ReadAllText($lock)) 'another-process';[IO.File]::Delete($lock)
    }
    MT-Case 'explicit replacement and retirement preserve immutable historical content' {
        $first=MT-Remember (MT-Entry 'Original');$old=$first.results[0].id
        MT-Rejected {MT-Remember (MT-Entry 'Replacement') @{replace_id=$old}}
        $second=MT-Remember (MT-Entry 'Replacement') @{replace_id=$old;expected_revision=1}
        MT-Equal $second.counts.replaced 1;$new=$second.results[0].id;$state=MT-State
        MT-Equal $state.entries[0].status 'retired';MT-Equal $state.entries[0].content 'Original'
        MT-Equal $state.events[0].entries[0].status 'verified';MT-Equal $state.events[0].entries[0].content 'Original'
        MT-Equal $state.entries[1].status 'verified';MT-Equal $state.events.Count 2
        [void](MT-Invoke 'retire' @{id=$new;project_id='alpha';expected_revision=2;reason='Confirmed obsolete'})
        $state=MT-State;MT-Equal $state.entries.Count 2;MT-Equal $state.events.Count 3;MT-Equal $state.entries[1].status 'retired'
        MT-Equal (MT-Invoke 'search' @{project_id='alpha'}).returned 0
        MT-Equal (MT-Invoke 'get' @{id=$old;project_id='alpha'}).entry.content 'Original'
    }
    MT-Case 'proposal promotion requires resolving another verified value and uses current payload' {
        $first=MT-Remember (MT-Entry 'Original');$old=$first.results[0].id
        $proposal=MT-Remember (MT-Entry 'Changed');$candidate=$proposal.results[0].id
        MT-Rejected {MT-Remember (MT-Entry 'Changed') @{replace_id=$candidate;expected_revision=2}}
        $refreshed=MT-Entry 'Changed';$refreshed.sources[0].observed_at='2026-10-09T01:00:00Z'
        MT-Rejected {MT-Remember $refreshed @{replace_id=$candidate;expected_revision=2}}
        [void](MT-Invoke 'retire' @{id=$old;project_id='alpha';expected_revision=2;reason='Old value confirmed obsolete'})
        $promoted=MT-Remember (MT-Entry 'Changed') @{replace_id=$candidate;expected_revision=3}
        MT-Equal $promoted.counts.replaced 1;MT-Equal $promoted.results[0].status 'verified'
        $state=MT-State;MT-Equal @($state.entries | Where-Object {$_['status'] -ceq 'verified'}).Count 1
        MT-Equal $state.entries[1].status 'retired';MT-Equal $state.entries[1].content 'Changed'
    }
    MT-Case 'retired identical input does not silently reactivate a fact' {
        $entry=MT-Entry;$saved=MT-Remember $entry
        [void](MT-Invoke 'retire' @{id=$saved.results[0].id;project_id='alpha';expected_revision=1;reason='Obsolete'})
        $before=MT-Snapshot;$again=MT-Remember $entry
        MT-Equal $again.counts.deduplicated 1;MT-Equal $again.results[0].status 'retired';MT-Equal (MT-Snapshot) $before
        MT-Equal (MT-Invoke 'search' @{project_id='alpha'}).returned 0
    }
    MT-Case 'retire requires current revision and reason' {
        $saved=MT-Remember (MT-Entry)
        MT-Rejected {MT-Invoke 'retire' @{id=$saved.results[0].id;project_id='alpha';reason='Obsolete'}}
        MT-Rejected {MT-Invoke 'retire' @{id=$saved.results[0].id;project_id='alpha';reason='Obsolete';expected_revision=0}}
        MT-Rejected {MT-Invoke 'retire' @{id=$saved.results[0].id;project_id='alpha';expected_revision=1}}
    }
    MT-Case 'verified entries require source reference revision and observed date' {
        $entry=MT-Entry;$entry.sources=@();MT-Rejected {MT-Remember $entry}
        $entry=MT-Entry;$entry.sources[0].revision=$null;MT-Rejected {MT-Remember $entry}
        $entry=MT-Entry;$entry.sources[0].observed_at='yesterday';MT-Rejected {MT-Remember $entry}
        $entry=MT-Entry;$entry.sources[0].reference='';MT-Rejected {MT-Remember $entry}
    }
    MT-Case 'project facts cannot be global and project context cannot be crossed' {
        $entry=MT-Entry;$entry.scope='global';$entry.project_id=$null;MT-Rejected {MT-Remember $entry}
        MT-Rejected {MT-Remember (MT-Entry) @{project_id='other'}}
    }
    MT-Case 'tampered memory fails closed without overwriting the corrupted store' {
        [void](MT-Remember (MT-Entry));$state=MT-State;$state.entries[0].content='Silently edited'
        WB-WriteAtomicJson (Join-Path $script:MTStore 'memory.json') $state
        MT-Rejected {MT-Invoke 'verify'};MT-Rejected {MT-Remember (MT-Entry 'Another value')}
    }
    MT-Case 'search is bounded and does not return full content' {
        $entry=MT-Entry ('x'*1200);[void](MT-Remember $entry)
        $second=MT-Entry 'Another';$second.key='other';[void](MT-Remember $second)
        $result=MT-Invoke 'search' @{project_id='alpha';limit=1}
        MT-Equal $result.returned 1;MT-Assert $result.has_more 'Expected pagination flag'
        MT-Assert (-not $result.results[0].Contains('content')) 'Search dumped full knowledge content'
        MT-Rejected {MT-Invoke 'search' @{limit=101}}
    }
    MT-Case 'default location requires explicit target root and never uses package root' {
        $result=MEM-Dispatch @{command='verify';target_root=$script:MTCaseRoot}
        MT-Equal $result.store (Join-Path $script:MTCaseRoot 'workbench-memory')
        MT-Assert (-not [IO.Directory]::Exists($result.store)) 'Read-only verify created a store'
        MT-Rejected {MEM-Dispatch @{command='verify'}}
    }
    MT-Case 'store size limit includes final newline and rejects before write' {
        [void](MT-Remember (MT-Entry))
        $probe=Join-Path $script:MTCaseRoot 'size-probe';[void][IO.Directory]::CreateDirectory($probe)
        $probeState=MT-State;MEM-Commit $probe $probeState 'boundary-probe' @() @{note='same-length'}
        $finalSize=(New-Object IO.FileInfo -ArgumentList (Join-Path $probe 'memory.json')).Length
        $originalLimit=$script:MEMStoreMaxBytes
        try {
            $script:MEMStoreMaxBytes=$finalSize-1
            MT-Rejected {$candidate=MT-State;MEM-Commit $script:MTStore $candidate 'boundary-probe' @() @{note='same-length'}}
        } finally {$script:MEMStoreMaxBytes=$originalLimit}
    }
    MT-Case 'CLI emits parseable JSON with zero status using prepared controller' {
        [void](MT-Remember (MT-Entry))
        $output=& $script:MTExe -NoLogo -NoProfile -File $script:MTMemory verify -Store $script:MTStore -WorkbenchPath $script:MTController
        MT-Equal $LASTEXITCODE 0
        $decoded=[WorkbenchPortable.JsonCodec]::Parse(($output -join "`n"));MT-Assert $decoded['valid'] 'CLI verify did not succeed';MT-Equal $decoded['entries'] 1
    }
} finally {
    if(-not $script:MTConfig['keep'] -and [IO.Directory]::Exists($script:MTTemp)){[IO.Directory]::Delete($script:MTTemp,$true)}
}
$failed=@($script:MTResults | Where-Object {$_.status -ceq 'fail'}).Count
$report=@{suite='shared-memory';total=$script:MTResults.Count;passed=$script:MTResults.Count-$failed;failed=$failed;skipped=0;runtime=$PSVersionTable.PSVersion.ToString();platform=[Environment]::OSVersion.ToString();target='Windows PowerShell 5.1; actual execution platform is reported separately';results=$script:MTResults.ToArray()}
[Console]::Out.WriteLine((WB-Json $report))
if($failed -gt 0){exit 1};exit 0
