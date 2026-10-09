#requires -Version 5.1
<# Shared local knowledge store. Structural integrity is not factual verification.
   No model, network, secret detector, automatic crawl, or external publication.
   Prepare workbench.ps1 alongside the package root before running this script.
#>
[CmdletBinding(PositionalBinding=$false)]
param(
    [Parameter(Position=0)][string]$Command,
    [string]$Store, [string]$TargetRoot, [string]$InputPath,
    [string]$Id, [string]$ReplaceId, [Nullable[long]]$ExpectedRevision=$null,
    [string]$ProjectId, [string]$Query, [int]$Limit=25, [string]$Reason,
    [string]$WorkbenchPath, [switch]$LibraryOnly
)
# Dot-sourcing the controller binds its parameters in this scope. Save our inputs first.
$script:MEMInvocation=@{command=$Command;store=$Store;target_root=$TargetRoot;input_path=$InputPath;id=$Id;replace_id=$ReplaceId;expected_revision=$ExpectedRevision;project_id=$ProjectId;query=$Query;limit=$Limit;reason=$Reason;library_only=[bool]$LibraryOnly;workbench_path=$WorkbenchPath}
$script:MEMScriptRoot=$PSScriptRoot
if (-not $script:MEMInvocation['workbench_path']) {
    $script:MEMInvocation['workbench_path']=Join-Path (Split-Path -Parent $script:MEMScriptRoot) 'workbench.ps1'
}
if (-not [IO.File]::Exists($script:MEMInvocation['workbench_path'])) {
    throw 'Prepared workbench.ps1 not found. Prepare the text package first, or supply -WorkbenchPath.'
}
. $script:MEMInvocation['workbench_path'] -LibraryOnly
$script:MEMCategories=@('preference','project_fact','decision','tool_knowledge','lesson')
$script:MEMStatuses=@('verified','needs_verification','proposed','retired')
$script:MEMStoreMaxBytes=8*1024*1024
$script:MEMInputMaxBytes=1024*1024

function MEM-Option { param($Options,[string]$Name,$Default=$null) return ,(WB-Option $Options $Name $Default) }
function MEM-RequireText {
    param($Value,[string]$Name,[int]$Maximum=200)
    WB-Require ((WB-Text $Value) -and $Value.Length -le $Maximum) ($Name+' must be nonempty text, at most '+$Maximum+' characters')
}
function MEM-StorePath {
    param($Options)
    $path=MEM-Option $Options 'store'
    if (-not (WB-Text $path)) {
        $target=MEM-Option $Options 'target_root'
        MEM-RequireText $target 'Store or TargetRoot' 4096
        $path=Join-Path (WB-FullPath $target) 'workbench-memory'
    }
    return WB-FullPath $path
}
function MEM-Date {
    param($Value,[string]$Name)
    WB-Require ($Value -is [string] -and $Value -match '\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})\z') ($Name+' must be an ISO timestamp with timezone')
    $parsed=[DateTimeOffset]::MinValue
    WB-Require ([DateTimeOffset]::TryParse($Value,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None,[ref]$parsed)) ('Invalid '+$Name)
    return $parsed
}
function MEM-CopyMap {
    param($Value,[string[]]$Exclude=@())
    $result=WB-Map
    foreach($key in $Value.Keys) { if ($Exclude -cnotcontains $key) { $result[$key]=$Value[$key] } }
    return ,$result
}
function MEM-Fingerprint { param($Value,[string]$Field) return WB-Digest (MEM-CopyMap $Value @($Field)) }
function MEM-NormalizeEntry {
    param($Entry,[bool]$Import=$false,[string]$ProjectId)
    WB-Require ($Entry -is [System.Collections.IDictionary]) 'Entry must be a JSON object'
    $allowed=@('key','category','scope','project_id','summary','content','status','sources','expires_at')
    foreach($field in $Entry.Keys) { WB-Require ($allowed -ccontains $field) ('Unknown entry field: '+$field) }
    foreach($field in @('key','summary','content')) {
        $maximum=200; if ($field -ceq 'summary') { $maximum=1000 }; if ($field -ceq 'content') { $maximum=40000 }
        MEM-RequireText $Entry[$field] $field $maximum
    }
    WB-Require ($Entry['key'] -notmatch '[\r\n]') 'key cannot contain newlines'
    WB-Require ($script:MEMCategories -ccontains $Entry['category']) 'Unknown category'
    WB-Require (@('global','project') -ccontains $Entry['scope']) 'scope must be global or project'
    $project=$Entry['project_id']
    if ($Entry['scope'] -ceq 'project') {
        if (-not (WB-Text $project) -and (WB-Text $ProjectId)) { $project=$ProjectId }
        MEM-RequireText $project 'project_id' 200
        if (WB-Text $ProjectId) { WB-Require ($project -ceq $ProjectId) 'Input belongs to a different project than ProjectId' }
    } else {
        WB-Require ($null -eq $project -or ($project -is [string] -and [string]::IsNullOrWhiteSpace($project))) 'Global entries cannot carry project_id'
        WB-Require ($Entry['category'] -cne 'project_fact') 'project_fact requires project scope'
        $project=$null
    }
    $status=$Entry['status']
    if ($Import) { $status='needs_verification'; if ($Entry['status'] -ceq 'proposed') { $status='proposed' } }
    WB-Require (@('verified','needs_verification','proposed') -ccontains $status) 'New entries require verified, needs_verification or proposed status; use retire to retire an existing entry'
    $sources=$Entry['sources']
    if ($Import -and $null -eq $sources) { $sources=@() }
    WB-Require ((WB-Array $sources) -and $sources.Count -le 50) 'sources must be an array of at most 50 provenance records'
    if ($status -ceq 'verified') { WB-Require ($sources.Count -gt 0) 'verified requires provenance; the store does not verify its truth' }
    $normalizedSources=@()
    foreach($source in $sources) {
        WB-Require ($source -is [System.Collections.IDictionary]) 'Source must be an object'
        foreach($field in $source.Keys) { WB-Require (@('kind','reference','revision','observed_at') -ccontains $field) ('Unknown source field: '+$field) }
        MEM-RequireText $source['kind'] 'source.kind' 80
        MEM-RequireText $source['reference'] 'source.reference' 4096
        $revision=$source['revision']; $observed=$source['observed_at']
        if ($status -ceq 'verified') {
            MEM-RequireText $revision 'verified source.revision' 500
            [void](MEM-Date $observed 'verified source.observed_at')
        } else {
            if ($null -ne $revision) { MEM-RequireText $revision 'source.revision' 500 }
            if ($null -ne $observed) { [void](MEM-Date $observed 'source.observed_at') }
        }
        $normalizedSources+=,@{kind=$source['kind'];reference=$source['reference'];revision=$revision;observed_at=$observed}
    }
    $expires=$Entry['expires_at']; if ($null -ne $expires) { [void](MEM-Date $expires 'expires_at') }
    return @{key=$Entry['key'];category=$Entry['category'];scope=$Entry['scope'];project_id=$project;summary=$Entry['summary'];content=$Entry['content'];status=$status;sources=$normalizedSources;expires_at=$expires}
}
function MEM-Empty {
    return @{schema_version=1;store_id=(WB-UUID);revision=0;created_at=(WB-Now);updated_at=(WB-Now);entries=@();events=@()}
}
function MEM-VerifyState {
    param($State)
    WB-Require ($State -is [System.Collections.IDictionary] -and $State['schema_version'] -eq 1) 'Unsupported memory schema'
    WB-Require (($State['revision'] -is [int] -or $State['revision'] -is [long]) -and $State['revision'] -ge 0) 'Invalid memory revision'
    WB-Require ((WB-Array $State['entries']) -and (WB-Array $State['events'])) 'Invalid memory arrays'
    WB-Require ((MEM-Fingerprint $State 'integrity_hash') -ceq $State['integrity_hash']) 'Memory integrity hash mismatch; restore the original store instead of overwriting history'
    $ids=WB-Map; $head=''; $sequence=0; $history=WB-Map
    foreach($event in $State['events']) {
        $sequence++
        WB-Require ($event['sequence'] -eq $sequence -and $event['revision'] -eq $sequence) 'Memory history sequence is invalid'
        WB-Require ($event['previous_hash'] -ceq $head) 'Memory history chain is invalid'
        WB-Require ((MEM-Fingerprint $event 'hash') -ceq $event['hash']) 'Memory history event hash mismatch'
        $head=$event['hash']
        foreach($record in $event['entries']) {
            WB-Require ((MEM-Fingerprint $record 'record_hash') -ceq $record['record_hash']) 'Historical entry hash mismatch'
            $history[$record['id']]=$record['record_hash']
        }
    }
    WB-Require ($sequence -eq $State['revision']) 'Revision does not match memory history'
    foreach($record in $State['entries']) {
        MEM-RequireText $record['id'] 'entry.id' 80
        WB-Require (-not $ids.Contains($record['id'])) 'Duplicate memory ID'
        $ids[$record['id']]=$true
        WB-Require ((MEM-Fingerprint $record 'record_hash') -ceq $record['record_hash']) 'Memory entry hash mismatch'
        WB-Require ($history.Contains($record['id']) -and $history[$record['id']] -ceq $record['record_hash']) 'Current entry does not match append-only history'
        WB-Require ($script:MEMStatuses -ccontains $record['status']) 'Unknown stored entry status'
        $payload=MEM-Payload $record
        if ($payload['status'] -ceq 'retired') { $payload['status']='needs_verification' }
        [void](MEM-NormalizeEntry $payload)
    }
    WB-Require ($ids.Count -eq $history.Count) 'History contains an entry missing from the store'
}
function MEM-Load {
    param([string]$Store)
    $file=Join-Path $Store 'memory.json'
    if (-not [IO.File]::Exists($file)) { return MEM-Empty }
    WB-Require ((New-Object IO.FileInfo -ArgumentList $file).Length -le $script:MEMStoreMaxBytes) 'Memory store exceeds 8 MiB; archive/migrate explicitly'
    $state=WB-ReadJson $file; MEM-VerifyState $state; return ,$state
}
function MEM-Expected {
    param($State,$Options,[bool]$Required=$false)
    $expected=MEM-Option $Options 'expected_revision'
    if ($Required) { WB-Require ($null -ne $expected) 'ExpectedRevision is required for replacement or retirement' }
    if ($null -ne $expected) { WB-Require ($State['revision'] -eq $expected) 'Stale memory revision; reread before applying the change' }
}
function MEM-Commit {
    param([string]$Store,$State,[string]$Action,$Entries,$Details)
    $revision=[long]$State['revision']+1; $head=''
    if ($State['events'].Count -gt 0) { $head=$State['events'][-1]['hash'] }
    $event=@{sequence=$revision;revision=$revision;time=(WB-Now);action=$Action;entries=@($Entries);details=$Details;previous_hash=$head}
    $event['hash']=MEM-Fingerprint $event 'hash'
    $State['events']=@($State['events'])+@($event); $State['revision']=$revision; $State['updated_at']=WB-Now
    $State['integrity_hash']=MEM-Fingerprint $State 'integrity_hash'
    WB-Require ($script:WBUtf8.GetByteCount((WB-Json $State)+"`n") -le $script:MEMStoreMaxBytes) 'Memory store would exceed 8 MiB; no change written'
    MEM-VerifyState $State
    WB-WriteAtomicJson (Join-Path $Store 'memory.json') $State
}
function MEM-Payload {
    param($Record)
    $payload=WB-Map
    foreach($field in @('key','category','scope','project_id','summary','content','status','sources','expires_at')) { $payload[$field]=$Record[$field] }
    return ,$payload
}
function MEM-SameKey {
    param($Left,$Right)
    return ($Left['scope'] -ceq $Right['scope'] -and $Left['project_id'] -ceq $Right['project_id'] -and $Left['key'] -ceq $Right['key'])
}
function MEM-Visible {
    param($Entry,[string]$ProjectId)
    return ($Entry['scope'] -ceq 'global' -or ((WB-Text $ProjectId) -and $Entry['project_id'] -ceq $ProjectId))
}
function MEM-View {
    param($Entry,[bool]$Full=$false)
    $view=WB-Map
    foreach($field in @('id','key','category','scope','project_id','summary','status','sources','expires_at','created_at','updated_at','record_hash')) { $view[$field]=$Entry[$field] }
    $expired=$false
    if ($null -ne $Entry['expires_at']) { $expired=(MEM-Date $Entry['expires_at'] 'expires_at') -le [DateTimeOffset]::UtcNow }
    $effective=$Entry['status']; if ($expired -and $effective -cne 'retired') { $effective='needs_verification' }
    $view['expired']=$expired; $view['effective_status']=$effective
    if ($Full) { $view['content']=$Entry['content']; $view['history_note']='Snapshots and hashes are in memory.json events; provenance is recorded, not independently verified.' }
    else { $content=$Entry['content']; $view['snippet']=$content.Substring(0,[Math]::Min(300,$content.Length)) }
    return ,$view
}
function MEM-NewRecord {
    param($Payload,[string]$InputDigest,[string]$Origin)
    $record=MEM-CopyMap $Payload
    $record['id']=WB-UUID; $record['created_at']=WB-Now; $record['updated_at']=WB-Now
    $record['input_digest']=$InputDigest; $record['origin']=$Origin
    $record['record_hash']=MEM-Fingerprint $record 'record_hash'
    return ,$record
}
function MEM-AddToState {
    param($State,$Payload,[string]$Origin,[string]$ReplaceId)
    $inputDigest=WB-Digest $Payload; $old=$null
    if (WB-Text $ReplaceId) {
        foreach($entry in $State['entries']) { if ($entry['id'] -ceq $ReplaceId) { $old=$entry; break } }
        WB-Require ($null -ne $old -and $old['status'] -cne 'retired') 'ReplaceId must refer to a current entry'
        WB-Require (MEM-SameKey $old $Payload) 'Replacement must have the same scope, project_id and key'
    }
    foreach($entry in $State['entries']) {
        $currentDigest=WB-Digest (MEM-Payload $entry)
        if ($null -ne $old) {
            # A proposal remembers the digest of the originally requested verified value.
            # Explicit promotion must compare its current payload, not that original digest.
            if ($old['id'] -ceq $entry['id'] -and $currentDigest -ceq $inputDigest) {
                return @{kind='deduplicated';entry=$entry;changed=@()}
            }
            if ($old['id'] -cne $entry['id'] -and $entry['status'] -ceq 'verified' -and $Payload['status'] -ceq 'verified' -and (MEM-SameKey $entry $Payload)) {
                WB-Fail 'Another verified entry still owns this key. Explicitly replace that entry, or retire it with ExpectedRevision before promoting this proposal.'
            }
        } elseif ($entry['input_digest'] -ceq $inputDigest -or $currentDigest -ceq $inputDigest) {
            return @{kind='deduplicated';entry=$entry;changed=@()}
        }
    }
    $changed=@(); $conflict=$false
    if ($null -eq $old) {
        foreach($entry in $State['entries']) { if ($entry['status'] -cne 'retired' -and (MEM-SameKey $entry $Payload)) { $conflict=$true; break } }
        if ($conflict) { $Payload=MEM-CopyMap $Payload; $Payload['status']='proposed' }
    } else {
        $retired=MEM-CopyMap $old; $retired['status']='retired'; $retired['updated_at']=WB-Now
        $retired['record_hash']=MEM-Fingerprint $retired 'record_hash'
        $updated=@(); foreach($entry in $State['entries']) { if ($entry['id'] -ceq $old['id']) { $updated+=,$retired } else { $updated+=,$entry } }
        $State['entries']=$updated; $changed+=,$retired
    }
    $record=MEM-NewRecord $Payload $inputDigest $Origin
    $State['entries']=@($State['entries'])+@($record); $changed+=,$record
    $kind='added'; if ($conflict) { $kind='proposed_conflict' }; if ($null -ne $old) { $kind='replaced' }
    return @{kind=$kind;entry=$record;changed=$changed}
}
function MEM-ReadInput {
    param($Options)
    $path=MEM-Option $Options 'input_path'; MEM-RequireText $path 'InputPath' 4096
    $path=WB-FullPath $path
    WB-Require ([IO.File]::Exists($path)) 'InputPath file not found'
    WB-Require ((New-Object IO.FileInfo -ArgumentList $path).Length -le $script:MEMInputMaxBytes) 'Input exceeds 1 MiB'
    return ,(WB-ReadJson $path)
}
function MEM-WriteCommand {
    param($Options,[bool]$Import)
    $store=MEM-StorePath $Options; $project=MEM-Option $Options 'project_id'
    $inputValue=MEM-ReadInput $Options; $replace=MEM-Option $Options 'replace_id'
    $payloads=@()
    if ($Import) {
        WB-Require (-not (WB-Text $replace)) 'Import cannot replace existing entries'
        WB-Require ((WB-Array $inputValue) -and $inputValue.Count -le 1000) 'Import expects an array of at most 1000 entries'
        foreach($item in $inputValue) { $payloads+=,(MEM-NormalizeEntry $item $true $project) }
    } else { $payloads+=,(MEM-NormalizeEntry $inputValue $false $project) }
    if (-not [IO.Directory]::Exists($store)) { [void][IO.Directory]::CreateDirectory($store) }
    return WB-WithLock $store {
        $state=MEM-Load $store; MEM-Expected $state $Options ([bool](WB-Text $replace))
        $results=@(); $changed=@(); $counts=@{added=0;proposed_conflict=0;replaced=0;deduplicated=0}
        foreach($payload in $payloads) {
            $origin='remember'; if ($Import) { $origin='legacy_import' }
            $outcome=MEM-AddToState $state $payload $origin $replace
            $counts[$outcome['kind']]++; $changed+=@($outcome['changed'])
            $results+=,@{id=$outcome['entry']['id'];key=$outcome['entry']['key'];result=$outcome['kind'];status=$outcome['entry']['status']}
        }
        if ($changed.Count -gt 0) {
            $action='remember'; if ($Import) { $action='import' }
            MEM-Commit $store $state $action $changed @{counts=$counts;replace_id=$replace}
        }
        return @{store=$store;revision=$state['revision'];counts=$counts;results=$results;verification='Structural provenance only; factual truth must be checked against current sources.'}
    }
}
function MEM-Search {
    param($Options)
    $store=MEM-StorePath $Options; $state=MEM-Load $store; $project=MEM-Option $Options 'project_id'; $query=MEM-Option $Options 'query' ''
    $limit=[int](MEM-Option $Options 'limit' 25); WB-Require ($limit -ge 1 -and $limit -le 100) 'Limit must be 1..100'
    if ($query) { WB-Require ($query -is [string] -and $query.Length -le 1000) 'Query must be text of at most 1000 characters' }
    $found=@()
    foreach($entry in $state['entries']) {
        if ($entry['status'] -ceq 'retired' -or -not (MEM-Visible $entry $project)) { continue }
        $haystack=$entry['key']+"`n"+$entry['summary']+"`n"+$entry['content']
        if ($query -and $haystack.IndexOf($query,[StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
        $found+=,$entry
    }
    $ordered=@($found | Sort-Object -Property @{Expression={$_['updated_at']};Descending=$true},@{Expression={$_['id']};Descending=$false})
    $results=@(); foreach($entry in @($ordered | Select-Object -First $limit)) { $results+=,(MEM-View $entry) }
    return @{store=$store;revision=$state['revision'];project_id=$project;results=$results;matches=$found.Count;returned=$results.Count;has_more=($found.Count -gt $results.Count);rule='Global and matching project only. Effective status does not prove truth; check current sources before relying on facts.'}
}
function MEM-Get {
    param($Options)
    $store=MEM-StorePath $Options; $state=MEM-Load $store; $id=MEM-Option $Options 'id'; MEM-RequireText $id 'Id' 80
    foreach($entry in $state['entries']) {
        if ($entry['id'] -ceq $id -and (MEM-Visible $entry (MEM-Option $Options 'project_id'))) { return @{store=$store;revision=$state['revision'];entry=(MEM-View $entry $true)} }
    }
    WB-Fail 'Entry not found in the requested scope'
}
function MEM-Retire {
    param($Options)
    $store=MEM-StorePath $Options; $id=MEM-Option $Options 'id'; MEM-RequireText $id 'Id' 80
    $reason=MEM-Option $Options 'reason'; MEM-RequireText $reason 'Reason' 2000
    WB-Require ([IO.Directory]::Exists($store)) 'Memory store not found'
    return WB-WithLock $store {
        $state=MEM-Load $store; MEM-Expected $state $Options $true; $found=$null
        foreach($entry in $state['entries']) { if ($entry['id'] -ceq $id -and (MEM-Visible $entry (MEM-Option $Options 'project_id'))) { $found=$entry;break } }
        WB-Require ($null -ne $found) 'Entry not found in the requested scope'
        if ($found['status'] -ceq 'retired') { return @{retired=$id;revision=$state['revision'];changed=$false} }
        $replacement=MEM-CopyMap $found; $replacement['status']='retired'; $replacement['updated_at']=WB-Now
        $replacement['record_hash']=MEM-Fingerprint $replacement 'record_hash'
        $items=@(); foreach($entry in $state['entries']) { if ($entry['id'] -ceq $id) { $items+=,$replacement } else { $items+=,$entry } }; $state['entries']=$items
        MEM-Commit $store $state 'retire' @($replacement) @{id=$id;reason=$reason}
        return @{retired=$id;revision=$state['revision'];changed=$true}
    }
}
function MEM-Dispatch {
    param([System.Collections.IDictionary]$Options)
    $command=MEM-Option $Options 'command'
    switch -CaseSensitive ($command) {
        'remember' { return MEM-WriteCommand $Options $false }
        'import' { return MEM-WriteCommand $Options $true }
        'search' { return MEM-Search $Options }
        'get' { return MEM-Get $Options }
        'retire' { return MEM-Retire $Options }
        'verify' {
            $store=MEM-StorePath $Options; $state=MEM-Load $store
            return @{valid=$true;store=$store;exists=[IO.File]::Exists((Join-Path $store 'memory.json'));revision=$state['revision'];entries=$state['entries'].Count;events=$state['events'].Count;scope='Structure, recorded provenance and hash-chain consistency only; not source freshness, authorization, confidentiality or factual truth.'}
        }
        default { WB-Fail 'Command must be remember, search, get, import, retire or verify' }
    }
}
if (-not $script:MEMInvocation['library_only']) {
    try {
        [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding -ArgumentList $false
        [Console]::Out.WriteLine((WB-Json (MEM-Dispatch $script:MEMInvocation)))
        exit 0
    } catch { [Console]::Error.WriteLine('Memory error: '+$_.Exception.Message); exit 2 }
}
