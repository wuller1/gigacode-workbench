# docs-impact.ps1 — Python-free, read-only Git impact analysis for Windows PowerShell 5.1.
# Restore the .ps1 extension before execution. -LibraryOnly exposes Get-DocsImpact.
[CmdletBinding()]
param([string]$Repo, [string]$Map, [switch]$Staged, [string]$Base = 'HEAD', [switch]$LibraryOnly)

$ErrorActionPreference = 'Stop'
$script:DIUtf8 = New-Object Text.UTF8Encoding($false, $true)
if (-not ('Gigacode.DocsImpactNative' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
namespace Gigacode {
    public sealed class DocsImpactResult {
        public int ExitCode;
        public byte[] Stdout;
        public byte[] Stderr;
    }
    public static class DocsImpactNative {
        // Windows CRT quoting, also accepted by ProcessStartInfo.Arguments on .NET Core.
        public static string Quote(string arg) {
            if (arg == null || arg.IndexOf('\0') >= 0) throw new ArgumentException("Invalid native argument");
            StringBuilder text = new StringBuilder("\"");
            int slashes = 0;
            foreach (char c in arg) {
                if (c == '\\') { slashes++; continue; }
                if (c == '"') { text.Append('\\', slashes * 2 + 1); text.Append(c); }
                else { text.Append('\\', slashes); text.Append(c); }
                slashes = 0;
            }
            text.Append('\\', slashes * 2); text.Append('"');
            return text.ToString();
        }
        private static byte[] ReadBounded(Stream stream) {
            using (MemoryStream memory = new MemoryStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = stream.Read(buffer, 0, buffer.Length)) != 0) {
                    if (memory.Length + count > 8 * 1024 * 1024) throw new IOException("Native output exceeds 8 MiB");
                    memory.Write(buffer, 0, count);
                }
                return memory.ToArray();
            }
        }
        private static void Stop(Process process) {
            try {
                if (process.HasExited) return;
                if (Environment.OSVersion.Platform == PlatformID.Win32NT) {
                    ProcessStartInfo kill = new ProcessStartInfo();
                    kill.FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "taskkill.exe");
                    kill.Arguments = "/PID " + process.Id + " /T /F";
                    kill.UseShellExecute = false; kill.CreateNoWindow = true;
                    kill.RedirectStandardOutput = true; kill.RedirectStandardError = true;
                    using (Process killer = Process.Start(kill)) { if (!killer.WaitForExit(3000)) killer.Kill(); }
                }
                if (!process.HasExited) process.Kill();
                process.WaitForExit(3000);
            } catch { }
        }
        public static DocsImpactResult Run(string file, string[] args, string directory, IDictionary environment, int timeoutMs) {
            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = file;
            List<string> quoted = new List<string>();
            foreach (string arg in args) quoted.Add(Quote(arg));
            info.Arguments = String.Join(" ", quoted.ToArray());
            info.WorkingDirectory = directory; info.UseShellExecute = false; info.CreateNoWindow = true;
            info.RedirectStandardOutput = true; info.RedirectStandardError = true; info.RedirectStandardInput = true;
            foreach (DictionaryEntry pair in environment) info.EnvironmentVariables[(string)pair.Key] = (string)pair.Value;
            using (Process process = Process.Start(info)) {
                process.StandardInput.Close();
                Task<byte[]> stdout = Task.Run(() => ReadBounded(process.StandardOutput.BaseStream));
                Task<byte[]> stderr = Task.Run(() => ReadBounded(process.StandardError.BaseStream));
                Stopwatch timer = Stopwatch.StartNew();
                try {
                    while (!process.WaitForExit(50)) {
                        if (stdout.IsFaulted || stderr.IsFaulted) throw new IOException("Native output reader failed or exceeded 8 MiB");
                        if (timer.ElapsedMilliseconds >= timeoutMs) throw new TimeoutException("Native process exceeded the timeout");
                    }
                    if (!Task.WaitAll(new Task[] { stdout, stderr }, 5000)) throw new IOException("Native output streams did not close");
                    return new DocsImpactResult { ExitCode = process.ExitCode, Stdout = stdout.Result, Stderr = stderr.Result };
                } catch { Stop(process); throw; }
            }
        }
        private static int[] Points(string text) {
            List<int> points = new List<int>();
            for (int i = 0; i < text.Length; i++) {
                int value = Char.ConvertToUtf32(text, i); points.Add(value);
                if (value > 65535) i++;
            }
            return points.ToArray();
        }
        // fnmatchcase semantics: case-sensitive; * and ? include slash; ! negates a class.
        // No PowerShell wildcard interpretation, regex interpolation or shell expansion.
        public static bool FnMatch(string name, string pattern) {
            return Match(Points(name), Points(pattern), 0, 0, new Dictionary<long, bool>());
        }
        private static bool Match(int[] name, int[] pattern, int n, int p, Dictionary<long, bool> memo) {
            long key = ((long)n << 32) | (uint)p;
            bool known;
            if (memo.TryGetValue(key, out known)) return known;
            bool result;
            if (p == pattern.Length) result = n == name.Length;
            else if (pattern[p] == '*') {
                while (p + 1 < pattern.Length && pattern[p + 1] == '*') p++;
                result = false;
                for (int i = n; i <= name.Length && !result; i++) result = Match(name, pattern, i, p + 1, memo);
            } else if (n == name.Length) result = false;
            else if (pattern[p] == '?') result = Match(name, pattern, n + 1, p + 1, memo);
            else if (pattern[p] == '[') {
                int end = p + 1;
                if (end < pattern.Length && pattern[end] == '!') end++;
                if (end < pattern.Length && pattern[end] == ']') end++;
                while (end < pattern.Length && pattern[end] != ']') end++;
                if (end == pattern.Length) result = name[n] == '[' && Match(name, pattern, n + 1, p + 1, memo);
                else {
                    int begin = p + 1;
                    bool negate = pattern[begin] == '!'; if (negate) begin++;
                    bool member = false;
                    for (int i = begin; i < end; i++) {
                        if (i + 2 < end && pattern[i + 1] == '-') {
                            member |= name[n] >= pattern[i] && name[n] <= pattern[i + 2]; i += 2;
                        } else member |= name[n] == pattern[i];
                    }
                    result = (negate ? !member : member) && Match(name, pattern, n + 1, end + 1, memo);
                }
            } else result = name[n] == pattern[p] && Match(name, pattern, n + 1, p + 1, memo);
            memo[key] = result; return result;
        }
    }
}
'@
}

function Invoke-DIProcess {
    param([string]$File, [string[]]$Argv, [string]$Directory, [hashtable]$Environment = @{}, [int]$TimeoutMs = 30000)
    return [Gigacode.DocsImpactNative]::Run($File, $Argv, $Directory, $Environment, $TimeoutMs)
}
function Invoke-DIGit {
    param([string]$Repository, [string[]]$Argv)
    $result = Invoke-DIProcess -File 'git' -Argv (@('--no-optional-locks', '-C', $Repository, '-c', 'core.fsmonitor=false') + $Argv) -Directory $Repository -Environment @{ GIT_OPTIONAL_LOCKS = '0'; GIT_TERMINAL_PROMPT = '0' }
    if ($result.ExitCode -ne 0) {
        $errorText = $script:DIUtf8.GetString($result.Stderr)
        if ($errorText.Length -gt 2000) { $errorText = $errorText.Substring(0, 2000) }
        throw ('Git failed: ' + $errorText.Trim())
    }
    return ,$result.Stdout
}
function ConvertFrom-DIBytes {
    param([byte[]]$Bytes)
    return $script:DIUtf8.GetString($Bytes)
}
function Get-DINulFields {
    param([byte[]]$Bytes)
    $text = ConvertFrom-DIBytes $Bytes
    if ($text.Length -eq 0) { return }
    if ($text[$text.Length - 1] -ne [char]0) { throw 'Malformed Git NUL output' }
    $text.Substring(0, $text.Length - 1).Split([char]0)
}
function Get-DISorted {
    param($Values)
    [string[]]$items = @($Values)
    [Array]::Sort($items, [StringComparer]::Ordinal)
    return ,$items
}
function Assert-DIRelative {
    param($Value, [switch]$Glob)
    if ($Value -isnot [string] -or -not $Value -or $Value.Contains('\') -or $Value.Contains([string][char]0)) { throw 'Map paths must be nonempty relative POSIX paths' }
    if ($Value.StartsWith('/') -or $Value.Contains(':') -or @($Value.Split('/') | Where-Object { $_ -in @('', '.', '..') }).Count) { throw 'Map paths cannot be absolute or escape the repository' }
    if (-not $Glob -and $Value.IndexOfAny([char[]]'*?[') -ge 0) { throw 'Document paths cannot contain glob syntax' }
    if ($Value.Length -gt 2048) { throw 'Map pattern/path exceeds 2048 characters' }
}
function Assert-DIReason {
    param($Value)
    if ($Value -isnot [string] -or -not $Value.Trim()) { throw 'Every rule and ignore needs an explicit reason' }
}
function Read-DIMap {
    param([string]$Path, [string]$Repository)
    $file = Get-Item -LiteralPath $Path -Force
    if ($file.Length -gt 8MB) { throw 'Map exceeds the 8 MiB limit' }
    $text = (ConvertFrom-DIBytes ([IO.File]::ReadAllBytes($file.FullName))).TrimStart([char]0xFEFF)
    $data = ConvertFrom-Json -InputObject $text
    if ($data -isnot [pscustomobject] -or $data.version -is [bool] -or $data.version -ne 1) { throw 'Map version must be 1' }
    if ($data.configured -isnot [bool]) { throw 'Map needs an explicit boolean configured field' }
    if ($data.rules -isnot [Array] -or $data.ignores -isnot [Array]) { throw 'Map rules and ignores must be arrays' }
    $ids = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($rule in $data.rules) {
        if ($rule -isnot [pscustomobject] -or $rule.id -isnot [string] -or -not $rule.id.Trim() -or -not $ids.Add($rule.id)) { throw 'Rule ids must be nonempty and unique' }
        Assert-DIReason $rule.reason
        foreach ($key in @('sources', 'documents')) {
            if ($rule.$key -isnot [Array] -or $rule.$key.Count -eq 0) { throw 'Rules need nonempty sources and documents arrays' }
            foreach ($item in $rule.$key) {
                Assert-DIRelative $item -Glob:($key -eq 'sources')
                if ($key -eq 'documents') {
                    $current = $Repository
                    foreach ($part in $item.Split('/')) {
                        $current = Join-Path $current $part
                        try { $attributes = [IO.File]::GetAttributes($current) }
                        catch [IO.FileNotFoundException] { break }
                        catch [IO.DirectoryNotFoundException] { break }
                        if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Document paths through symlinks or junctions are not accepted; map the repository path explicitly' }
                    }
                }
            }
        }
    }
    foreach ($ignore in $data.ignores) {
        if ($ignore -isnot [pscustomobject]) { throw 'Invalid ignore' }
        Assert-DIRelative $ignore.pattern -Glob
        Assert-DIReason $ignore.reason
    }
    return $data
}
function Get-DIPaths {
    param($Change)
    foreach ($key in @('path', 'old_path', 'new_path')) { if ($Change.Contains($key)) { $Change[$key] } }
}
function Test-DIRule {
    param([string]$Name, $Rule)
    foreach ($document in $Rule.documents) { if ([string]::Equals($Name, $document, [StringComparison]::Ordinal)) { return $true } }
    foreach ($pattern in $Rule.sources) { if ([Gigacode.DocsImpactNative]::FnMatch($Name, $pattern)) { return $true } }
    return $false
}
function ConvertFrom-DIDiff {
    param([byte[]]$Bytes)
    $fields = @(Get-DINulFields $Bytes)
    for ($index = 0; $index -lt $fields.Count;) {
        $status = $fields[$index]
        $count = 1; if ($status.StartsWith('R') -or $status.StartsWith('C')) { $count = 2 }
        if ($index + $count -ge $fields.Count) { throw 'Malformed Git name-status output' }
        $change = [ordered]@{ status = $status }
        if ($count -eq 2) { $change.old_path = $fields[$index + 1]; $change.new_path = $fields[$index + 2] }
        else { $change.path = $fields[$index + 1] }
        $index += $count + 1
        $change
    }
}
function Get-DocsImpact {
    param([string]$Repo, [string]$Map, [switch]$Staged, [string]$Base = 'HEAD')
    if (-not $Repo -or -not $Map) { throw 'Repo and Map are required' }
    if (-not $Base -or $Base.StartsWith('-')) { throw 'Base must be a commit revision, not an option' }
    if ($Staged -and $Base -ne 'HEAD') { throw 'Staged and Base cannot be combined' }
    $repository = (Resolve-Path -LiteralPath $Repo).ProviderPath
    $repository = (ConvertFrom-DIBytes (Invoke-DIGit $repository @('rev-parse', '--show-toplevel'))).TrimEnd([char[]]"`r`n")
    $data = Read-DIMap $Map $repository
    $commit = (ConvertFrom-DIBytes (Invoke-DIGit $repository @('rev-parse', '--verify', '--end-of-options', ($Base + '^{commit}')))).Trim()
    $diffArguments = @('diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '--find-renames')
    if ($Staged) { $diffArguments += '--cached' }
    $changes = [Collections.Generic.List[object]]::new()
    foreach ($change in @(ConvertFrom-DIDiff (Invoke-DIGit $repository ($diffArguments + @($commit, '--'))))) { $changes.Add($change) }
    $unstaged = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    if ($Staged) {
        # This output is used only for warnings, never to satisfy an index document check.
        foreach ($name in @(Get-DINulFields (Invoke-DIGit $repository @('diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', '--')))) { [void]$unstaged.Add($name) }
    } else {
        foreach ($name in @(Get-DINulFields (Invoke-DIGit $repository @('ls-files', '--others', '--exclude-standard', '--exclude=node_modules/', '-z', '--')))) { $changes.Add([ordered]@{ status = '??'; path = $name }) }
    }
    if ($changes.Count -gt 10000) { throw 'More than 10000 changed paths; narrow the scope' }
    $changedPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($change in $changes) { foreach ($name in @(Get-DIPaths $change)) { [void]$changedPaths.Add($name) } }
    $affected = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
    $unmapped = [Collections.Generic.List[object]]::new(); $ignored = [Collections.Generic.List[object]]::new()
    foreach ($change in $changes) {
        $names = @(Get-DIPaths $change)
        $matching = @($data.rules | Where-Object { $rule = $_; @($names | Where-Object { Test-DIRule $_ $rule }).Count -gt 0 })
        $missing = [Collections.Generic.List[string]]::new(); $ignoreReasons = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($name in $names) {
            $mapped = @($matching | Where-Object { Test-DIRule $name $_ }).Count -gt 0
            $excluded = @($data.ignores | Where-Object { [Gigacode.DocsImpactNative]::FnMatch($name, $_.pattern) })
            if (-not $mapped -and $excluded.Count -eq 0) { $missing.Add($name) }
            foreach ($entry in $excluded) { [void]$ignoreReasons.Add($entry.reason) }
        }
        foreach ($rule in $matching) {
            foreach ($document in $rule.documents) {
                if (-not $affected.ContainsKey($document)) {
                    $affected.Add($document, [ordered]@{ path = $document; rule_ids = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal); changed_paths = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal); reasons = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal); document_changed = $changedPaths.Contains($document) })
                }
                $entry = $affected[$document]; [void]$entry.rule_ids.Add($rule.id); [void]$entry.reasons.Add($rule.reason)
                foreach ($name in $names) { [void]$entry.changed_paths.Add($name) }
            }
        }
        if ($missing.Count) {
            $copy = [ordered]@{}; foreach ($key in $change.Keys) { $copy[$key] = $change[$key] }
            if ($matching.Count) { $copy.unmapped_paths = @($missing.ToArray()) }
            $unmapped.Add($copy)
        } elseif ($matching.Count -eq 0) {
            $copy = [ordered]@{}; foreach ($key in $change.Keys) { $copy[$key] = $change[$key] }
            $copy.reasons = Get-DISorted $ignoreReasons; $ignored.Add($copy)
        }
    }
    $documents = [Collections.Generic.List[object]]::new(); $stale = [Collections.Generic.List[object]]::new()
    foreach ($name in (Get-DISorted $affected.Keys)) {
        $entry = $affected[$name]
        foreach ($key in @('rule_ids', 'changed_paths', 'reasons')) { $entry[$key] = Get-DISorted $entry[$key] }
        $documents.Add($entry)
        if ($Staged -and $unstaged.Contains($name) -and -not $changedPaths.Contains($name)) { $stale.Add([ordered]@{ path = $name; reason = 'Document differs only in working tree; not included in the index change' }) }
    }
    $status = 'no_op_candidate'; if ($affected.Count -or $unmapped.Count) { $status = 'needs_review' }
    if (-not $data.configured) { $status = 'needs_configuration' }
    $scope = 'working_tree'; $untrackedPolicy = 'nonignored; node_modules/ excluded from discovery'
    if ($Staged) { $scope = 'index'; $untrackedPolicy = 'excluded' }
    return [ordered]@{ status = $status; repo = $repository; scope = $scope; base_commit = $commit; configured = $data.configured; changed_files = @($changes.ToArray()); affected_documents = @($documents.ToArray()); unmapped_changes = @($unmapped.ToArray()); ignored_changes = @($ignored.ToArray()); stale_index_docs = @($stale.ToArray()); semantic_freshness = 'not_evaluated'; untracked_policy = $untrackedPolicy }
}

if ($LibraryOnly) { return }
try {
    if ($Staged -and $PSBoundParameters.ContainsKey('Base')) { throw 'Staged and Base cannot be combined' }
    $result = Get-DocsImpact -Repo $Repo -Map $Map -Staged:$Staged -Base $Base
} catch { $result = [ordered]@{ status = 'error'; error = $_.Exception.Message } }
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false) } catch { }
[Console]::WriteLine(($result | ConvertTo-Json -Depth 32))
if ($result.status -eq 'no_op_candidate') { exit 0 }
if ($result.status -eq 'needs_review') { exit 1 }
exit 2
