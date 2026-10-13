#requires -Version 5.1
<# Portable local workflow controller. No Python, network, model or MCP runtime.
   Copy this delivery file to workbench.ps1 in the same folder before Windows use.
   PowerShell 5.1 / .NET Framework 4.x compatible; JSON state remains schema 1.
#>
[CmdletBinding(PositionalBinding=$false)]
param(
    [Parameter(Position=0)][string]$Command,
    [string]$Run, [string]$Workflow, [string]$Project, [string]$Task,
    [string]$Result, [string]$Target, [string]$Reason, [string]$Note,
    [string]$Kind, [string]$Summary, [string]$Details,
    [string[]]$Evidence = @(), [string]$OperationId,
    [Nullable[int]]$ExpectedRevision = $null,
    [int]$MaxAttempts = 3, [string]$ContextMode = 'full',
    [switch]$Full, [int]$After = 0, [int]$Limit = 50,
    [switch]$LibraryOnly
)

# A small JSON codec preserves case-sensitive keys, arrays, and date strings.
# ConvertFrom-Json on PS5.1 cannot preserve all of those properties reliably.
if (-not ('WorkbenchPortable.JsonCodec' -as [type])) {
    Add-Type -ErrorAction Stop -TypeDefinition @'
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
namespace WorkbenchPortable {
    public class InvalidException : Exception {
        public InvalidException(string message) : base(message) {}
    }
    public sealed class NumberToken {
        public readonly string Text;
        public readonly bool IsInteger;
        public NumberToken(string text, bool integer) { Text=text; IsInteger=integer; }
    }
    public static class JsonCodec {
        public static object Parse(string text) { return new Parser(text).Read(); }
        public static string Serialize(object value, bool canonicalDigest) {
            StringBuilder output=new StringBuilder();
            Emit(output,value,canonicalDigest,0); return output.ToString();
        }
        private static void Quoted(StringBuilder output,string value) {
            output.Append('"');
            for(int i=0;i<value.Length;i++) {
                char c=value[i];
                switch(c) {
                    case '"': output.Append("\\\""); break;
                    case '\\': output.Append("\\\\"); break;
                    case '\b': output.Append("\\b"); break;
                    case '\f': output.Append("\\f"); break;
                    case '\n': output.Append("\\n"); break;
                    case '\r': output.Append("\\r"); break;
                    case '\t': output.Append("\\t"); break;
                    default:
                        if(c<32) output.Append("\\u"+((int)c).ToString("x4",CultureInfo.InvariantCulture));
                        else if(char.IsHighSurrogate(c)) {
                            if(i+1>=value.Length || !char.IsLowSurrogate(value[i+1])) throw new InvalidException("Unpaired Unicode surrogate in JSON string.");
                            output.Append(c); output.Append(value[++i]);
                        } else if(char.IsLowSurrogate(c)) throw new InvalidException("Unpaired Unicode surrogate in JSON string.");
                        else output.Append(c);
                        break;
                }
            }
            output.Append('"');
        }
        private static int CompareKeys(string left,string right) {
            int a=0,b=0;
            while(a<left.Length && b<right.Length) {
                int x=char.ConvertToUtf32(left,a), y=char.ConvertToUtf32(right,b);
                if(x!=y) return x<y?-1:1;
                a+=x>65535?2:1; b+=y>65535?2:1;
            }
            return a==left.Length ? (b==right.Length?0:-1) : 1;
        }
        private static void Emit(StringBuilder output,object value,bool canonical,int depth) {
            if(depth>128) throw new InvalidException("JSON nesting exceeds 128 levels.");
            // PowerShell may wrap pipeline values and hashtable members in PSObject.
            // Reflection keeps this codec independent of a host-specific SMA assembly.
            while(value!=null && value.GetType().FullName=="System.Management.Automation.PSObject") {
                object unwrapped=value.GetType().GetProperty("BaseObject").GetValue(value,null);
                if(Object.ReferenceEquals(value,unwrapped)) throw new InvalidException("Cyclic PowerShell JSON wrapper.");
                value=unwrapped;
            }
            if(value==null) { output.Append("null"); return; }
            if(value is string) { Quoted(output,(string)value); return; }
            if(value is bool) { output.Append((bool)value?"true":"false"); return; }
            NumberToken raw=value as NumberToken;
            if(raw!=null) {
                if(canonical && !raw.IsInteger) throw new InvalidException("Floating-point workflow metadata cannot use the legacy Python digest safely. Use integer/string workflow metadata or explicitly migrate the state; no silent digest conversion is performed.");
                output.Append(raw.Text); return;
            }
            if(value is byte || value is sbyte || value is short || value is ushort || value is int || value is uint || value is long || value is ulong) {
                output.Append(Convert.ToString(value,CultureInfo.InvariantCulture)); return;
            }
            if(value is double || value is float || value is decimal) {
                if(canonical) throw new InvalidException("Floating-point workflow metadata is unsupported by the legacy digest; explicit migration is required.");
                string number;
                if(value is double) {
                    double d=(double)value;
                    if(double.IsNaN(d)||double.IsInfinity(d)) throw new InvalidException("Non-finite JSON number.");
                    number=d.ToString("R",CultureInfo.InvariantCulture);
                } else if(value is float) {
                    float f=(float)value;
                    if(float.IsNaN(f)||float.IsInfinity(f)) throw new InvalidException("Non-finite JSON number.");
                    number=f.ToString("R",CultureInfo.InvariantCulture);
                } else number=((decimal)value).ToString(CultureInfo.InvariantCulture);
                output.Append(number); return;
            }
            IDictionary map=value as IDictionary;
            if(map!=null) {
                List<string> keys=new List<string>();
                foreach(object key in map.Keys) {
                    if(!(key is string)) throw new InvalidException("JSON object keys must be strings.");
                    keys.Add((string)key);
                }
                keys.Sort(CompareKeys);
                output.Append('{');
                for(int i=0;i<keys.Count;i++) {
                    if(i>0) output.Append(", ");
                    Quoted(output,keys[i]); output.Append(": ");
                    Emit(output,map[keys[i]],canonical,depth+1);
                }
                output.Append('}'); return;
            }
            IEnumerable list=value as IEnumerable;
            if(list!=null) {
                output.Append('['); bool first=true;
                foreach(object item in list) {
                    if(!first) output.Append(", "); first=false;
                    Emit(output,item,canonical,depth+1);
                }
                output.Append(']'); return;
            }
            throw new InvalidException("Unsupported JSON value type: "+value.GetType().FullName);
        }
        private sealed class Parser {
            private readonly string text;
            private int at;
            public Parser(string value) { text=value; at=0; }
            private void White() { while(at<text.Length && (text[at]==' '||text[at]=='\t'||text[at]=='\r'||text[at]=='\n')) at++; }
            private InvalidException Bad(string reason) { return new InvalidException("Invalid JSON at offset "+at+": "+reason); }
            public object Read() { object result=Value(0); White(); if(at!=text.Length) throw Bad("trailing content"); return result; }
            private object Value(int depth) {
                if(depth>128) throw Bad("nesting exceeds 128 levels");
                White(); if(at>=text.Length) throw Bad("unexpected end");
                char c=text[at];
                if(c=='"') return String();
                if(c=='{') {
                    at++; White(); Hashtable map=new Hashtable(StringComparer.Ordinal);
                    if(at<text.Length && text[at]=='}') { at++; return map; }
                    while(true) {
                        White(); if(at>=text.Length || text[at]!='"') throw Bad("object key expected");
                        string key=String(); White();
                        if(at>=text.Length || text[at++]!=':') throw Bad("colon expected");
                        object item=Value(depth+1);
                        if(map.Contains(key)) throw Bad("duplicate key "+key);
                        map.Add(key,item); White();
                        if(at>=text.Length) throw Bad("unterminated object");
                        char end=text[at++]; if(end=='}') return map;
                        if(end!=',') throw Bad("comma expected");
                    }
                }
                if(c=='[') {
                    at++; White(); List<object> items=new List<object>();
                    if(at<text.Length && text[at]==']') { at++; return items.ToArray(); }
                    while(true) {
                        items.Add(Value(depth+1)); White();
                        if(at>=text.Length) throw Bad("unterminated array");
                        char end=text[at++]; if(end==']') return items.ToArray();
                        if(end!=',') throw Bad("comma expected");
                    }
                }
                if(c=='t' && Match("true")) return true;
                if(c=='f' && Match("false")) return false;
                if(c=='n' && Match("null")) return null;
                if(c=='-' || (c>='0'&&c<='9')) return Number();
                throw Bad("unexpected token");
            }
            private bool Match(string token) {
                if(at+token.Length>text.Length || System.String.CompareOrdinal(text,at,token,0,token.Length)!=0) return false;
                at+=token.Length; return true;
            }
            private object Number() {
                int start=at; bool integer=true;
                if(text[at]=='-') at++;
                if(at>=text.Length) throw Bad("number expected");
                if(text[at]=='0') at++;
                else {
                    if(text[at]<'1'||text[at]>'9') throw Bad("number expected");
                    while(at<text.Length && text[at]>='0'&&text[at]<='9') at++;
                }
                if(at<text.Length && text[at]=='.') {
                    integer=false; at++; int digits=at;
                    while(at<text.Length && text[at]>='0'&&text[at]<='9') at++;
                    if(at==digits) throw Bad("fraction expected");
                }
                if(at<text.Length && (text[at]=='e'||text[at]=='E')) {
                    integer=false; at++;
                    if(at<text.Length && (text[at]=='+'||text[at]=='-')) at++;
                    int digits=at; while(at<text.Length && text[at]>='0'&&text[at]<='9') at++;
                    if(at==digits) throw Bad("exponent expected");
                }
                string token=text.Substring(start,at-start); long value;
                if(integer && Int64.TryParse(token,NumberStyles.AllowLeadingSign,CultureInfo.InvariantCulture,out value)) return value;
                return new NumberToken(token,integer);
            }
            private string String() {
                at++; StringBuilder output=new StringBuilder();
                while(at<text.Length) {
                    char c=text[at++];
                    if(c=='"') return output.ToString();
                    if(c<32) throw Bad("unescaped control character");
                    if(c!='\\') { output.Append(c); continue; }
                    if(at>=text.Length) throw Bad("unfinished escape");
                    c=text[at++];
                    switch(c) {
                        case '"': output.Append('"'); break;
                        case '\\': output.Append('\\'); break;
                        case '/': output.Append('/'); break;
                        case 'b': output.Append('\b'); break;
                        case 'f': output.Append('\f'); break;
                        case 'n': output.Append('\n'); break;
                        case 'r': output.Append('\r'); break;
                        case 't': output.Append('\t'); break;
                        case 'u':
                            if(at+4>text.Length) throw Bad("unfinished unicode escape");
                            ushort code;
                            if(!UInt16.TryParse(text.Substring(at,4),NumberStyles.AllowHexSpecifier,CultureInfo.InvariantCulture,out code)) throw Bad("invalid unicode escape");
                            output.Append((char)code); at+=4; break;
                        default: throw Bad("invalid escape");
                    }
                }
                throw Bad("unterminated string");
            }
        }
    }
}
'@
}

$script:WBRoot = $PSScriptRoot
$script:WBUtf8 = New-Object System.Text.UTF8Encoding -ArgumentList @($false, $true)
$script:WBProfiles = @('analyst','spec','architect','backend','database','designer','frontend','security','devops','qa','reviewer','diagnostics','technical-writer','gigacode-ui')
$script:WBCapabilities = @('repo.read','repo.write','git.read','git.branch','git.commit','git.push','git.pr.read','git.pr.write','git.merge','knowledge.read','knowledge.write','ci.read','ci.run','cluster.read','cluster.apply','browser.inspect','test.run','data.read','data.migrate','metrics.read','tracker.read','tracker.write','security.scan.read','security.scan.run')
$script:WBKinds = @('observation','decision','question','answer','action_started','action_finished','action_unknown','checkpoint','verification')

function WB-Fail { param([string]$Message) throw (New-Object WorkbenchPortable.InvalidException -ArgumentList $Message) }
function WB-Require { param([bool]$Condition,[string]$Message) if (-not $Condition) { WB-Fail $Message } }
function WB-Text { param($Value) return ($Value -is [string] -and -not [string]::IsNullOrWhiteSpace($Value)) }
function WB-Array { param($Value) return ($Value -is [System.Array] -or $Value -is [System.Collections.IList]) }
function WB-Map { return ,(New-Object System.Collections.Hashtable -ArgumentList ([System.StringComparer]::Ordinal)) }
function WB-Now { return [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.ffffff+00:00',[Globalization.CultureInfo]::InvariantCulture) }
function WB-UUID { return [Guid]::NewGuid().ToString() }
function WB-Json { param($Value) return [WorkbenchPortable.JsonCodec]::Serialize($Value,$false) }
function WB-HashBytes {
    param([byte[]]$Bytes)
    $algorithm=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}
function WB-Digest {
    param($Value)
    # Compatible with Python json.dumps(ensure_ascii=False,sort_keys=True),
    # including default ', ' / ': ' separators, for integer/string/bool/null workflows.
    # Fractional workflow metadata is rejected explicitly rather than rehashed silently.
    return WB-HashBytes -Bytes $script:WBUtf8.GetBytes([WorkbenchPortable.JsonCodec]::Serialize($Value,$true))
}
function WB-FullPath {
    param([string]$Path)
    WB-Require (WB-Text $Path) 'Пустой путь'
    if ($Path -eq '~') { $Path=[Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile) }
    elseif ($Path.StartsWith('~/') -or $Path.StartsWith('~\')) {
        $Path=Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)) $Path.Substring(2)
    }
    # Respect Set-Location in an existing PowerShell session, not process startup cwd.
    return [IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path))
}
function WB-SetRoot { param([string]$Path) $script:WBRoot=WB-FullPath $Path }
function WB-ReadJson {
    param([string]$Path)
    $text=[IO.File]::ReadAllText((WB-FullPath $Path),$script:WBUtf8)
    return ,([WorkbenchPortable.JsonCodec]::Parse($text))
}
function WB-WriteAtomicJson {
    param([string]$Path,$Data)
    $destination=WB-FullPath $Path
    $directory=[IO.Path]::GetDirectoryName($destination)
    WB-Require ([IO.Directory]::Exists($directory)) 'Каталог для атомарной записи не найден'
    $temporary=Join-Path $directory ('.pending-'+(WB-UUID))
    $stream=$null
    try {
        $stream=New-Object System.IO.FileStream -ArgumentList @($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None) -ErrorAction Stop
        $bytes=$script:WBUtf8.GetBytes((WB-Json $Data)+"`n")
        $stream.Write($bytes,0,$bytes.Length)
        $stream.Flush($true)
        $stream.Dispose(); $stream=$null
        if ([IO.File]::Exists($destination)) { [IO.File]::Replace($temporary,$destination,[NullString]::Value) }
        else { [IO.File]::Move($temporary,$destination) }
    } finally {
        if ($null -ne $stream) { $stream.Dispose() }
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}
function WB-WithLock {
    param([string]$Run,[scriptblock]$Body)
    $lock=Join-Path (WB-FullPath $Run) '.workbench.lock'
    $stream=$null; $owned=$false
    try {
        try { $stream=New-Object System.IO.FileStream -ArgumentList @($lock,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None) -ErrorAction Stop; $owned=$true }
        catch [IO.IOException] { WB-Fail 'Задача занята или lock недоступен. После аварии сначала убедитесь, что другой процесс не работает; только затем удаляйте .workbench.lock.' }
        $bytes=$script:WBUtf8.GetBytes([string]$PID); $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true)
        $stream.Dispose(); $stream=$null
        $value=& $Body
        return ,$value
    } finally {
        if ($null -ne $stream) { $stream.Dispose() }
        if ($owned -and [IO.File]::Exists($lock)) { [IO.File]::Delete($lock) }
    }
}
function WB-Slug { param($Value) return ($Value -is [string] -and $Value -cmatch '\A[a-z][a-z0-9-]*\z') }
function WB-UniqueStrings {
    param($Values)
    $seen=WB-Map
    foreach($value in $Values) {
        if ($value -isnot [string] -or $seen.ContainsKey($value)) { return $false }
        $seen[$value]=$true
    }
    return $true
}
function WB-KeysEqual {
    param($Map,$Names)
    if ($Map -isnot [System.Collections.IDictionary] -or $Map.Count -ne @($Names).Count) { return $false }
    foreach($name in $Names) { if (-not $Map.Contains($name)) { return $false } }
    return $true
}
function WB-ValidateWorkflow {
    param($Workflow)
    WB-Require ($Workflow -is [System.Collections.IDictionary]) 'Workflow должен быть JSON-объектом'
    WB-Require (($Workflow['schema_version'] -is [int] -or $Workflow['schema_version'] -is [long]) -and $Workflow['schema_version'] -eq 1) 'Неподдерживаемая версия workflow'
    WB-Require (WB-Slug $Workflow['id']) 'Неверный ID workflow'
    WB-Require (WB-Text $Workflow['title']) 'Нет названия workflow'
    WB-Require ((WB-Array $Workflow['stages']) -and $Workflow['stages'].Count -gt 0) 'Workflow без этапов'
    $seen=WB-Map
    foreach($stage in $Workflow['stages']) {
        WB-Require ($stage -is [System.Collections.IDictionary]) 'Этап должен быть JSON-объектом'
        $sid=$stage['id']
        WB-Require ((WB-Slug $sid) -and -not $seen.ContainsKey($sid)) 'Неверный или повторный ID этапа'
        WB-Require ($script:WBProfiles -ccontains $stage['profile']) 'Неизвестный профиль'
        WB-Require (WB-Text $stage['title']) 'Нет названия этапа'
        WB-Require ((WB-Array $stage['instructions']) -and $stage['instructions'].Count -gt 0) 'Нет инструкций этапа'
        foreach($instruction in $stage['instructions']) { WB-Require (WB-Text $instruction) 'Пустая инструкция этапа' }
        $artifacts=$stage['required_artifacts']
        WB-Require ((WB-Array $artifacts) -and $artifacts.Count -gt 0 -and (WB-UniqueStrings $artifacts)) 'Неверные артефакты этапа'
        foreach($artifact in $artifacts) { WB-Require (WB-Slug $artifact) 'Неверный ID артефакта' }
        $checks=$stage['checks']; $checkIds=WB-Map
        WB-Require ((WB-Array $checks) -and $checks.Count -gt 0) 'Нет проверок этапа'
        foreach($check in $checks) {
            WB-Require ($check -is [System.Collections.IDictionary]) 'Проверка должна быть JSON-объектом'
            WB-Require ((WB-Slug $check['id']) -and -not $checkIds.ContainsKey($check['id'])) 'Неверный ID проверки'
            WB-Require (@('artifact','judgment','execution') -ccontains $check['kind']) 'Неверный вид проверки'
            WB-Require (WB-Text $check['description']) 'Нет описания проверки'
            WB-Require ($check['allow_na'] -is [bool]) 'Нет allow_na'
            $checkIds[$check['id']]=$true
        }
        WB-Require (WB-Array $stage['capabilities']) 'Неверный список capabilities'
        foreach($capability in $stage['capabilities']) { WB-Require ($script:WBCapabilities -ccontains $capability) 'Неизвестная capability' }
        WB-Require (WB-Array $stage['rework_targets']) 'Неверный список возвратов'
        foreach($back in $stage['rework_targets']) { WB-Require ($back -is [string] -and $seen.ContainsKey($back)) 'Возврат должен вести на предыдущий этап' }
        $seen[$sid]=$true
    }
    return ,$Workflow
}
function WB-AssetPath {
    param([string]$Relative)
    $path=Join-Path $script:WBRoot $Relative
    if ([IO.File]::Exists($path)) { return $path }
    # The transport bundle may omit file extensions; preparation restores them.
    $extension=[IO.Path]::GetExtension($path)
    if ($extension) { $without=$path.Substring(0,$path.Length-$extension.Length); if ([IO.File]::Exists($without)) { return $without } }
    return $path
}
function WB-LoadWorkflow {
    param([string]$Name)
    WB-Require (WB-Slug $Name) 'Неверный ID workflow'
    return ,(WB-ValidateWorkflow (WB-ReadJson (WB-AssetPath ('workflows/'+$Name+'.json'))))
}
function WB-LoadState {
    param([string]$Run)
    $state=WB-ReadJson (Join-Path (WB-FullPath $Run) 'state.json')
    WB-Require ($state -is [System.Collections.IDictionary] -and ($state['schema_version'] -is [int] -or $state['schema_version'] -is [long]) -and $state['schema_version'] -eq 1) 'Неподдерживаемая версия состояния'
    [void](WB-ValidateWorkflow $state['workflow'])
    if ($state.Contains('workflow_digest_algorithm')) { WB-Require ($state['workflow_digest_algorithm'] -ceq 'python-json-v1') 'Неизвестный алгоритм workflow_digest; нужна явная миграция' }
    WB-Require ((WB-Digest $state['workflow']) -ceq $state['workflow_digest']) 'Сохранённый workflow изменён. Создайте новый запуск с новой версией.'
    return ,$state
}
function WB-Current {
    param($State)
    WB-Require ($State['status'] -cne 'completed') 'Workflow уже завершён'
    $index=[int]$State['index']
    WB-Require ($index -ge 0 -and $index -lt $State['workflow']['stages'].Count) 'Неверный индекс этапа'
    return ,$State['workflow']['stages'][$index]
}
function WB-CommitState {
    param([string]$Run,$State,[string]$Event,$Details)
    $State['events']=@($State['events'])+@(@{sequence=$State['events'].Count+1;state_revision=$State['revision']+1;time=(WB-Now);event=$Event;details=$Details})
    $State['revision']=[long]$State['revision']+1
    $State['updated_at']=WB-Now
    WB-WriteAtomicJson (Join-Path (WB-FullPath $Run) 'state.json') $State
}
function WB-AssertNoReparse {
    param([string]$Path,[string]$StopAt)
    $cursor=WB-FullPath $Path
    $boundary=WB-FullPath $StopAt
    while ($cursor) {
        if ([IO.File]::Exists($cursor) -or [IO.Directory]::Exists($cursor)) {
            WB-Require (([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) -eq 0) ('Symlink/reparse point запрещён в пути свидетельства: '+$cursor)
        }
        if ($cursor -ceq $boundary) { break }
        $parent=[IO.Path]::GetDirectoryName($cursor)
        if (-not $parent -or $parent -ceq $cursor) { break }
        $cursor=$parent
    }
}
function WB-VerifyFile {
    param([string]$Run,$Relative)
    WB-Require (WB-Text $Relative) 'Пустая ссылка на свидетельство'
    WB-Require (-not [IO.Path]::IsPathRooted($Relative) -and $Relative -notmatch '\A[A-Za-z]:' -and -not $Relative.StartsWith('\')) 'Артефакты должны быть внутри каталога запуска'
    $portable=$Relative.Replace('\','/')
    $parts=@($portable.Split('/') | Where-Object { $_ -ne '' -and $_ -ne '.' })
    WB-Require ($parts.Count -gt 1 -and @('artifacts','evidence') -ccontains $parts[0]) 'Артефакты и свидетельства храните в artifacts/ или evidence/'
    WB-Require ($parts -cnotcontains '..') 'Ссылка выходит за каталог запуска'
    WB-Require (@($parts | Where-Object { $_ -match ':' }).Count -eq 0) 'Alternate data streams запрещены'
    $root=WB-FullPath $Run
    $resolved=WB-FullPath (Join-Path $root ($parts -join [IO.Path]::DirectorySeparatorChar))
    $comparison=[StringComparison]::Ordinal
    if ([IO.Path]::DirectorySeparatorChar -eq '\') { $comparison=[StringComparison]::OrdinalIgnoreCase }
    $prefix=$root.TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
    WB-Require ($resolved.StartsWith($prefix,$comparison)) 'Ссылка выходит за каталог запуска'
    WB-AssertNoReparse $resolved $root
    WB-Require ([IO.File]::Exists($resolved)) ('Файл не найден: '+$Relative)
    $content=[IO.File]::ReadAllBytes($resolved)
    $meaningful=$false
    foreach($b in $content) { if (@(9,10,11,12,13,32) -notcontains [int]$b) { $meaningful=$true; break } }
    WB-Require $meaningful ('Пустой файл: '+$Relative)
    return @{path=($parts -join '/');sha256=(WB-HashBytes $content);bytes=$content.LongLength}
}
function WB-VerifyActiveRecords {
    param([string]$Run,$State)
    foreach($record in $State['records']) { foreach($info in $record['files']) {
        $actual=WB-VerifyFile $Run $info['path']
        WB-Require ($actual['sha256'] -ceq $info['sha256']) ('Принятый артефакт изменился: '+$info['path']+'. Верните процесс на соответствующий этап командой rework.')
    } }
}
function WB-VerifyJournalFiles {
    param([string]$Run,$State)
    foreach($event in $State['events']) { foreach($info in $event['details']['files']) {
        $actual=WB-VerifyFile $Run $info['path']
        WB-Require ($actual['sha256'] -ceq $info['sha256']) ('Файл журнала изменился: '+$info['path']+'. Восстановите исходное свидетельство; не перезаписывайте историю.')
    } }
}
function WB-ResultTemplate {
    param($State)
    $stage=WB-Current $State; $artifacts=WB-Map; $checks=WB-Map
    foreach($artifact in $stage['required_artifacts']) { $artifacts[$artifact]='' }
    foreach($check in $stage['checks']) { $checks[$check['id']]=@{outcome='not_run';evidence=@();explanation=''} }
    return @{schema_version=1;run_id=$State['run_id'];workflow=$State['workflow']['id'];stage=$stage['id'];revision=$State['revision'];attempt_id=$State['attempt_id'];status='completed';summary='';source_revision='';spec_revision='';artifacts=$artifacts;checks=$checks;questions=@();blockers=@()}
}
function WB-Option {
    param($Options,[string]$Name,$Default=$null)
    if ($Options.Contains($Name)) { return ,$Options[$Name] }
    return ,$Default
}
function WB-RequiredOption {
    param($Options,[string]$Name)
    $value=WB-Option $Options $Name
    WB-Require (WB-Text $value) ('Не указан параметр: '+$Name)
    return $value
}
function WB-Init {
    param($Options)
    $workflow=WB-LoadWorkflow (WB-RequiredOption $Options 'workflow')
    $project=WB-FullPath (WB-RequiredOption $Options 'project')
    $run=WB-FullPath (WB-RequiredOption $Options 'run')
    $task=WB-RequiredOption $Options 'task'; $max=[int](WB-Option $Options 'max_attempts' 3)
    WB-Require ([IO.Directory]::Exists($project)) 'Каталог проекта не найден'
    WB-Require (-not [IO.Directory]::Exists($run) -and -not [IO.File]::Exists($run)) 'Каталог запуска уже существует; используйте status или prompt'
    WB-Require ($max -ge 1 -and $max -le 20) 'max-attempts должен быть от 1 до 20'
    [void][IO.Directory]::CreateDirectory($run)
    foreach($folder in @('artifacts','evidence')) { [void][IO.Directory]::CreateDirectory((Join-Path $run $folder)) }
    $attempts=WB-Map; foreach($stage in $workflow['stages']) { $attempts[$stage['id']]=0 }
    $attempts[$workflow['stages'][0]['id']]=1
    $state=@{schema_version=1;run_id=(WB-UUID);task=$task;project=$project;workflow=$workflow;workflow_digest=(WB-Digest $workflow);workflow_digest_algorithm='python-json-v1';index=0;status='ready';revision=0;attempt_id=(WB-UUID);attempts=$attempts;max_attempts=$max;records=@();archived_records=@();events=@();created_at=(WB-Now);updated_at=(WB-Now);last_result=$null;pending_actions=(WB-Map)}
    WB-WriteAtomicJson (Join-Path $run 'state.json') $state
    return @{run=$run;workflow=$workflow['id'];stage=$workflow['stages'][0]['id'];status='ready'}
}
function WB-Prompt {
    param($Options)
    $run=WB-RequiredOption $Options 'run'; $state=WB-LoadState $run; $stage=WB-Current $state
    WB-VerifyActiveRecords $run $state; WB-VerifyJournalFiles $run $state
    $mode=WB-Option $Options 'context_mode' 'full'
    WB-Require (@('full','role','stage') -ccontains $mode) 'Неверный context-mode'
    $systemPath=WB-AssetPath 'SYSTEM_PROMPT.md'; $corePath=WB-AssetPath 'CORE.md'; $profilePath=WB-AssetPath ('profiles/'+$stage['profile']+'.md')
    $manifest=@(); foreach($path in @($systemPath,$corePath,$profilePath)) { if ([IO.File]::Exists($path)) { $manifest+=@{path=$path;sha256=(WB-HashBytes ([IO.File]::ReadAllBytes($path)))} } }
    $sections=@('# Контекст этапа GigaCode Workbench',('Режим контекста: '+$mode+'. Пропущенные инструкции должны уже быть загружены в этой сессии с теми же hashes; иначе используйте full.'+"`n"+(WB-Json $manifest)))
    if ($mode -ceq 'full') {
        if ([IO.File]::Exists($systemPath)) { $sections+=[IO.File]::ReadAllText($systemPath,$script:WBUtf8) }
        $sections+=[IO.File]::ReadAllText($corePath,$script:WBUtf8)
    }
    if (@('full','role') -ccontains $mode) { $sections+=[IO.File]::ReadAllText($profilePath,$script:WBUtf8) }
    $context=WB-Map; foreach($key in @('task','project','status','revision','attempt_id','last_result')) { $context[$key]=$state[$key] }
    $tail=@($state['events'] | Select-Object -Last 12)
    $sections+=@(('## Задача и состояние'+"`n"+(WB-Json $context)),('## Текущий этап'+"`n"+(WB-Json $stage)),('## Принятые результаты'+"`n"+(WB-Json $state['records'])),('## Незавершённые действия'+"`n"+(WB-Json $state['pending_actions'])),('## Журнал'+"`n"+'Показаны последние 12 событий из '+$state['events'].Count+'. Полный журнал — state.json или recover -Full.'+"`n"+(WB-Json $tail)),('## Шаблон отчёта'+"`n"+(WB-Json (WB-ResultTemplate $state))),('Каталог запуска: '+(WB-FullPath $run)),'Дополнительно прочитай правила проекта, его config/project.json и config/bindings.json при наличии. Ссылки на файлы ещё не означают, что их содержимое прочитано.')
    if ($state['status'] -cne 'ready') { $sections+='СТОП: состояние не ready. Прочитай last_result, журнал и CONTROLLER.md. Для waiting_input/blocked нужен resume после фактического устранения причины; для needs_rework — rework; blocked_budget требует пересмотра задачи. Completed повторно не исполняется. Не обходи состояние через resume.' }
    return $sections -join "`n`n"
}
function WB-Submit {
    param($Options)
    $run=WB-RequiredOption $Options 'run'; $report=WB-ReadJson (WB-RequiredOption $Options 'result')
    WB-Require ($report -is [System.Collections.IDictionary]) 'Отчёт должен быть JSON-объектом'
    return WB-WithLock $run {
        $state=WB-LoadState $run
        WB-Require ($state['status'] -ceq 'ready') 'Сначала устраните причину и выполните resume'
        $stage=WB-Current $state
        $expected=@{schema_version=1;run_id=$state['run_id'];workflow=$state['workflow']['id'];stage=$stage['id'];revision=$state['revision'];attempt_id=$state['attempt_id']}
        foreach($key in $expected.Keys) { WB-Require ((WB-Json $report[$key]) -ceq (WB-Json $expected[$key])) ('Устаревший или чужой отчёт: '+$key) }
        WB-Require (WB-Text $report['summary']) 'Нужно краткое описание результата'
        WB-Require ((WB-Array $report['questions']) -and (WB-Array $report['blockers'])) 'questions/blockers должны быть списками'
        $status=$report['status']
        WB-Require (@('completed','waiting_input','blocked','needs_rework') -ccontains $status) 'Неверный статус отчёта'
        if ($status -cne 'completed') {
            if ($status -ceq 'waiting_input') { WB-Require ($report['questions'].Count -gt 0) 'Нет вопросов для пользователя' }
            if ($status -ceq 'blocked') { WB-Require ($report['blockers'].Count -gt 0) 'Нет описания блокировки' }
            if ($status -ceq 'needs_rework') { WB-Require ((@($stage['id'])+@($stage['rework_targets'])) -ccontains $report['return_to']) 'Неверная цель возврата' }
            $state['status']=$status; $state['last_result']=$report
            WB-CommitState $run $state 'stage_paused' $report
            return @{status=$status;stage=$stage['id'];revision=$state['revision']}
        }
        WB-VerifyActiveRecords $run $state; WB-VerifyJournalFiles $run $state
        WB-Require ($state['pending_actions'].Count -eq 0) 'Есть действия с неизвестным/незавершённым результатом; сначала проверьте их исход и запишите action_finished'
        WB-Require ($report['questions'].Count -eq 0 -and $report['blockers'].Count -eq 0) 'Нельзя завершить этап с открытыми вопросами/блокировками'
        WB-Require (WB-Text $report['source_revision']) 'Укажите версию исходников или объяснение неприменимости'
        WB-Require (WB-Text $report['spec_revision']) 'Укажите версию спецификации или объяснение неприменимости'
        WB-Require (WB-KeysEqual $report['artifacts'] $stage['required_artifacts']) 'Неверный набор артефактов'
        $files=@(); foreach($artifact in $stage['required_artifacts']) { $files+=WB-VerifyFile $run $report['artifacts'][$artifact] }
        $checkNames=@($stage['checks'] | ForEach-Object { $_['id'] })
        WB-Require (WB-KeysEqual $report['checks'] $checkNames) 'Неверный набор проверок'
        foreach($spec in $stage['checks']) {
            $check=$report['checks'][$spec['id']]
            WB-Require ($check -is [System.Collections.IDictionary]) 'Неверный результат проверки'
            $outcome=$check['outcome']
            WB-Require ($outcome -ceq 'pass' -or ($outcome -ceq 'not_applicable' -and $spec['allow_na'])) ('Проверка не пройдена: '+$spec['id'])
            WB-Require ((WB-Array $check['evidence']) -and $check['evidence'].Count -gt 0) ('Нет свидетельств: '+$spec['id'])
            if ($outcome -ceq 'not_applicable') { WB-Require (WB-Text $check['explanation']) 'Обоснуйте неприменимость' }
            foreach($evidencePath in $check['evidence']) { $files+=WB-VerifyFile $run $evidencePath }
        }
        $state['records']=@($state['records'])+@(@{stage=$stage['id'];completed_at=(WB-Now);report=$report;files=$files})
        $state['index']=[int]$state['index']+1; $state['last_result']=$report
        $next=$null
        if ($state['index'] -eq $state['workflow']['stages'].Count) { $state['status']='completed' }
        else {
            $next=(WB-Current $state)['id']; $state['attempts'][$next]=[int]$state['attempts'][$next]+1
            $state['status']='ready'; if ($state['attempts'][$next] -gt $state['max_attempts']) { $state['status']='blocked_budget' }
        }
        $state['attempt_id']=WB-UUID; WB-CommitState $run $state 'stage_completed' @{stage=$stage['id']}
        return @{status=$state['status'];stage=$next;revision=$state['revision']}
    }
}
function WB-Rework {
    param($Options)
    $run=WB-RequiredOption $Options 'run'; $targetId=WB-RequiredOption $Options 'target'; $reason=WB-RequiredOption $Options 'reason'
    return WB-WithLock $run {
        $state=WB-LoadState $run
        WB-Require ($state['pending_actions'].Count -eq 0) 'До возврата установите исход незавершённых действий'
        $ids=@($state['workflow']['stages'] | ForEach-Object { $_['id'] })
        $target=-1; for($i=0;$i -lt $ids.Count;$i++) { if ($ids[$i] -ceq $targetId) { $target=$i;break } }
        WB-Require ($target -ge 0) 'Этап не найден'
        WB-Require ($target -le $state['index']) 'Нельзя пропускать этапы'
        if ($state['status'] -ceq 'needs_rework') { WB-Require ($targetId -ceq $state['last_result']['return_to']) 'Цель должна совпадать с return_to отчёта' }
        $kept=@(); $stale=@()
        foreach($record in $state['records']) {
            $recordIndex=-1; for($i=0;$i -lt $ids.Count;$i++) { if($ids[$i] -ceq $record['stage']) { $recordIndex=$i;break } }
            if ($recordIndex -ge $target) { $stale+=,$record } else { $kept+=,$record }
        }
        foreach($record in $stale) { $state['archived_records']=@($state['archived_records'])+@(@{invalidated_at=(WB-Now);reason=$reason;record=$record}) }
        $state['records']=$kept; $state['index']=$target; $state['attempts'][$targetId]=[int]$state['attempts'][$targetId]+1
        $state['status']='ready'; if ($state['attempts'][$targetId] -gt $state['max_attempts']) { $state['status']='blocked_budget' }
        $state['attempt_id']=WB-UUID; $state['last_result']=$null
        WB-CommitState $run $state 'rework' @{target=$targetId;reason=$reason;invalidated=@($stale | ForEach-Object { $_['stage'] })}
        return @{status=$state['status'];stage=$targetId;revision=$state['revision']}
    }
}
function WB-Resume {
    param($Options)
    $run=WB-RequiredOption $Options 'run'; $note=WB-RequiredOption $Options 'note'
    return WB-WithLock $run {
        $state=WB-LoadState $run
        WB-Require (@('waiting_input','blocked','cancelled') -ccontains $state['status']) 'Этот статус нельзя возобновить. Для needs_rework используйте rework; для blocked_budget требуется пересмотр задачи и новый запуск.'
        $previous='ready'
        if ($state['status'] -ceq 'cancelled' -and $state.Contains('status_before_cancel')) { $previous=$state['status_before_cancel']; $state.Remove('status_before_cancel') }
        $state['status']=$previous; $state['attempt_id']=WB-UUID
        WB-CommitState $run $state 'resumed' @{note=$note}
        return @{status=$state['status'];stage=(WB-Current $state)['id'];revision=$state['revision']}
    }
}
function WB-Cancel {
    param($Options)
    $run=WB-RequiredOption $Options 'run'; $reason=WB-RequiredOption $Options 'reason'
    return WB-WithLock $run {
        $state=WB-LoadState $run
        WB-Require (@('completed','cancelled') -cnotcontains $state['status']) 'Запуск уже завершён или отменён'
        $state['status_before_cancel']=$state['status']; $state['status']='cancelled'; $state['attempt_id']=WB-UUID
        WB-CommitState $run $state 'cancelled' @{reason=$reason}
        return @{status='cancelled';note='Контроллер не управляет внешними процессами; их остановку проверяет host.'}
    }
}
function WB-Record {
    param($Options)
    $run=WB-RequiredOption $Options 'run'; $summary=WB-RequiredOption $Options 'summary'; $kind=WB-RequiredOption $Options 'kind'
    WB-Require ($script:WBKinds -ccontains $kind) 'Неизвестный kind события'
    return WB-WithLock $run {
        $state=WB-LoadState $run
        $expected=WB-Option $Options 'expected_revision'
        if ($null -ne $expected) { WB-Require ($state['revision'] -eq $expected) 'Устаревшая версия состояния для события' }
        $details=WB-Map; $detailsPath=WB-Option $Options 'details'
        if ($detailsPath) { $details=WB-ReadJson $detailsPath }
        WB-Require ($details -is [System.Collections.IDictionary]) 'details должен быть JSON-объектом'
        $files=@(); foreach($path in (WB-Option $Options 'evidence' @())) { $files+=WB-VerifyFile $run $path }
        if (-not $state.Contains('pending_actions')) { $state['pending_actions']=WB-Map }
        $pending=$state['pending_actions']; $operation=WB-Option $Options 'operation_id'
        if ($kind -ceq 'action_started') {
            WB-Require ($state['status'] -ceq 'ready') 'Новые действия требуют ready; для сверки неизвестного исхода используйте observation/verification'
            if (-not $operation) { $operation=WB-UUID }
            $used=@($state['events'] | Where-Object { $_['event'] -ceq 'action_started' } | ForEach-Object { $_['details']['operation_id'] })
            WB-Require ($used -cnotcontains $operation) 'operation_id уже использован'
            foreach($key in @('target','intent','expected_result','reconcile')) { WB-Require ([bool]$details[$key]) 'action_started требует target, intent, expected_result, reconcile в details' }
            $pending[$operation]=@{stage=(WB-Current $state)['id'];attempt_id=$state['attempt_id'];summary=$summary;details=$details;status='started';started_at=(WB-Now)}
        } elseif (@('action_finished','action_unknown') -ccontains $kind) {
            WB-Require ($operation -is [string] -and $pending.Contains($operation)) 'Не найдено начатое действие'
            if ($kind -ceq 'action_finished') {
                WB-Require (@('verified_success','verified_not_applied','verified_failure') -ccontains $details['outcome']) 'Укажите подтверждённый outcome'
                WB-Require ($files.Count -gt 0) 'Нужно свидетельство проверки результата действия'
                $details['original_action']=$pending[$operation]; $pending.Remove($operation)
            } else { $pending[$operation]['status']='unknown'; $pending[$operation]['last_observation']=$summary }
        }
        $stage=$null; if ($state['status'] -cne 'completed') { $stage=(WB-Current $state)['id'] }
        $payload=@{summary=$summary;operation_id=$operation;data=$details;files=$files;stage=$stage;attempt_id=$state['attempt_id']}
        WB-CommitState $run $state $kind $payload
        return @{recorded=$kind;operation_id=$operation;revision=$state['revision'];pending_actions=$pending.Count}
    }
}
function WB-Recover {
    param($Options)
    $run=WB-RequiredOption $Options 'run'; $state=WB-LoadState $run; $full=[bool](WB-Option $Options 'full' $false)
    $integrity=@(); try { WB-VerifyActiveRecords $run $state } catch { $integrity+=,$_.Exception.Message }
    $checkpoint=$null; foreach($event in $state['events']) { if ($event['event'] -ceq 'checkpoint') { $checkpoint=$event } }
    $after=@($state['events'] | Where-Object { $null -eq $checkpoint -or $_['sequence'] -gt $checkpoint['sequence'] })
    $inspected=$state['events']
    if (-not $full) { $inspected=@(); if ($null -ne $checkpoint) { $inspected+=,$checkpoint }; $inspected+=@($after) }
    foreach($event in $inspected) { foreach($info in $event['details']['files']) {
        try { $actual=WB-VerifyFile $run $info['path']; WB-Require ($actual['sha256'] -ceq $info['sha256']) ('Файл журнала изменился: '+$info['path']) }
        catch { if ($integrity -cnotcontains $_.Exception.Message) { $integrity+=,$_.Exception.Message } }
    } }
    $events=$state['events']; $scope='all accepted records and full journal'
    if (-not $full) { $events=@($after | Select-Object -Last 40); $scope='all accepted records, latest checkpoint and journal tail after it' }
    $stage=$null; if ($state['status'] -cne 'completed') { $stage=WB-Current $state }
    $sequence=0; if ($null -ne $checkpoint) { $sequence=$checkpoint['sequence'] }
    return @{run_id=$state['run_id'];task=$state['task'];project=$state['project'];status=$state['status'];revision=$state['revision'];workflow=$state['workflow']['id'];workflow_digest=$state['workflow_digest'];current_stage=$stage;accepted_records=$state['records'];archived_records=$state['archived_records'];pending_actions=$state['pending_actions'];last_result=$state['last_result'];latest_checkpoint=$checkpoint;events=@($events);events_total=$state['events'].Count;events_omitted=$state['events'].Count-@($events).Count;integrity_scope=$scope;journal_after_sequence=$sequence;integrity_problems=$integrity;recovery_rule='Сначала проверьте актуальность исходников/спецификации, целостность evidence и исход pending_actions чтением. Не повторяйте неизвестную запись. Журнал содержит только записанные события; значения секретов и незаписанные действия не восстанавливаются.'}
}
function WB-Journal {
    param($Options)
    $state=WB-LoadState (WB-RequiredOption $Options 'run'); $after=[int](WB-Option $Options 'after' 0); $limit=[int](WB-Option $Options 'limit' 50)
    WB-Require ($after -ge 0 -and $limit -ge 1 -and $limit -le 500) 'after >= 0, limit от 1 до 500'
    $remaining=@($state['events'] | Where-Object { $_['sequence'] -gt $after }); $page=@($remaining | Select-Object -First $limit)
    $next=$after; if ($page.Count -gt 0) { $next=$page[-1]['sequence'] }
    return @{events=$page;next_after=$next;has_more=($remaining.Count -gt $page.Count);total_events=$state['events'].Count;state_revision=$state['revision']}
}
function WB-Catalog {
    $directory=Join-Path $script:WBRoot 'workflows'; $names=WB-Map
    foreach($file in (Get-ChildItem -LiteralPath $directory -File -ErrorAction Stop)) {
        if ($file.Extension -ceq '.json') { $names[$file.BaseName]=$true }
        elseif ($file.Extension -ceq '' -and (WB-Slug $file.Name)) { $names[$file.Name]=$true }
    }
    $result=@(); foreach($name in ($names.Keys | Sort-Object -CaseSensitive)) { $result+=,(WB-LoadWorkflow $name) }
    return ,$result
}
function WB-Dispatch {
    param([System.Collections.IDictionary]$Options)
    WB-Require ($null -ne $Options) 'Не переданы параметры'
    $command=WB-RequiredOption $Options 'command'
    switch -CaseSensitive ($command) {
        'init' { return WB-Init $Options }
        'prompt' { return WB-Prompt $Options }
        'submit' { return WB-Submit $Options }
        'rework' { return WB-Rework $Options }
        'resume' { return WB-Resume $Options }
        'cancel' { return WB-Cancel $Options }
        'record' { return WB-Record $Options }
        'recover' { return WB-Recover $Options }
        'journal' { return WB-Journal $Options }
        'result-template' { return WB-ResultTemplate (WB-LoadState (WB-RequiredOption $Options 'run')) }
        'status' {
            $state=WB-LoadState (WB-RequiredOption $Options 'run'); $result=WB-Map
            foreach($key in @('run_id','task','status','revision','attempts','last_result')) { $result[$key]=$state[$key] }
            $result['stage']=$null; if ($state['status'] -cne 'completed') { $result['stage']=WB-Current $state }
            return ,$result
        }
        'verify' {
            $run=WB-RequiredOption $Options 'run'; $state=WB-LoadState $run
            WB-VerifyActiveRecords $run $state; WB-VerifyJournalFiles $run $state
            return @{valid=$true;accepted_stages=$state['records'].Count;scope='Artifact existence and hashes only; no semantic, source-tree, permission or execution verification.'}
        }
        'list' {
            $list=@(); foreach($workflow in (WB-Catalog)) { $list+=@{id=$workflow['id'];title=$workflow['title'];stages=$workflow['stages'].Count} }
            return ,$list
        }
        'validate' {
            $workflows=WB-Catalog; WB-Require ($workflows.Count -gt 0) 'Нет workflows'
            foreach($profile in $script:WBProfiles) { WB-Require ([IO.File]::Exists((WB-AssetPath ('profiles/'+$profile+'.md')))) ('Нет профиля: '+$profile) }
            WB-Require ([IO.File]::Exists((WB-AssetPath 'CORE.md'))) 'Нет CORE.md'
            $stages=0; foreach($workflow in $workflows) { $stages+=$workflow['stages'].Count }
            return @{valid=$true;workflows=$workflows.Count;profiles=$script:WBProfiles.Count;stages=$stages}
        }
        default { WB-Fail ('Неизвестная команда: '+$command) }
    }
}

if (-not $LibraryOnly) {
    try {
        [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding -ArgumentList $false
        $options=@{command=$Command;run=$Run;workflow=$Workflow;project=$Project;task=$Task;result=$Result;target=$Target;reason=$Reason;note=$Note;kind=$Kind;summary=$Summary;details=$Details;evidence=$Evidence;operation_id=$OperationId;expected_revision=$ExpectedRevision;max_attempts=$MaxAttempts;context_mode=$ContextMode;full=[bool]$Full;after=$After;limit=$Limit}
        if (-not $PSBoundParameters.ContainsKey('OperationId')) { $options['operation_id']=$null }
        $answer=WB-Dispatch -Options $options
        if ($answer -is [string]) { [Console]::Out.WriteLine($answer) }
        else { [Console]::Out.WriteLine((WB-Json $answer)) }
        exit 0
    } catch {
        [Console]::Error.WriteLine('Ошибка: '+$_.Exception.Message)
        exit 2
    }
}
