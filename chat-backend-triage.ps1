param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath,

    [string]$ProjectRef = "",

    [switch]$LinkProject,

    [switch]$ApplyMissingMigrations,

    [switch]$VerboseOutput
)

$ErrorActionPreference = "Stop"

function Write-Info($msg)  { Write-Host "[INFO]  $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "[OK]    $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "[WARN]  $msg" -ForegroundColor Yellow }
function Write-Bad($msg)   { Write-Host "[FAIL]  $msg" -ForegroundColor Red }

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

function Run-Step {
    param(
        [string]$Label,
        [scriptblock]$Script
    )
    Write-Info $Label
    & $Script
}

function Invoke-CliCapture {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    if ($VerboseOutput) {
        Write-Host ">> $FilePath $($Arguments -join ' ')" -ForegroundColor DarkGray
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    foreach ($arg in $Arguments) {
        [void]$psi.ArgumentList.Add($arg)
    }
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    [void]$p.Start()

    $stdout = $p.StandardOutput.ReadToEnd()
    $stderr = $p.StandardError.ReadToEnd()
    $p.WaitForExit()

    [pscustomobject]@{
        ExitCode = $p.ExitCode
        StdOut   = $stdout
        StdErr   = $stderr
        Combined = (($stdout.TrimEnd(), $stderr.TrimEnd()) | Where-Object { $_ -ne "" }) -join "`n"
    }
}

function Invoke-SupabaseSql {
    param(
        [string]$Sql,
        [string]$WorkingDirectory
    )

    $tempSql = Join-Path $env:TEMP ("chat_diag_" + [guid]::NewGuid().ToString("N") + ".sql")
    Set-Content -Path $tempSql -Value $Sql -Encoding UTF8

    try {
        $result = Invoke-CliCapture -FilePath "supabase" -Arguments @("db", "query", "--file", $tempSql) -WorkingDirectory $WorkingDirectory
        return $result
    }
    finally {
        Remove-Item $tempSql -Force -ErrorAction SilentlyContinue
    }
}

function Test-PathOrThrow([string]$PathToCheck) {
    if (-not (Test-Path $PathToCheck)) {
        throw "Path not found: $PathToCheck"
    }
}

Require-Command "git"
Require-Command "supabase"

Test-PathOrThrow $RepoPath
$RepoPath = (Resolve-Path $RepoPath).Path

$repoGit = Join-Path $RepoPath ".git"
Test-PathOrThrow $repoGit

$migrationsPath = Join-Path $RepoPath "supabase\migrations"
Test-PathOrThrow $migrationsPath

$requiredMigrationFiles = @(
    "20260327094756_6b3300f6-a66d-4168-822e-1b78f7cadef8.sql",
    "20260327094806_6b004f55-db00-40d4-859a-1c9454f5d598.sql",
    "20260405160000_os_messages_realtime_and_notifications.sql"
)

Write-Info "Checking required migration files in repo"
foreach ($file in $requiredMigrationFiles) {
    $full = Join-Path $migrationsPath $file
    if (Test-Path $full) {
        Write-Ok $file
    }
    else {
        Write-Bad "Missing migration file in repo: $file"
        exit 1
    }
}

Push-Location $RepoPath
try {
    Run-Step -Label "Checking git status" -Script {
        $gitStatus = Invoke-CliCapture -FilePath "git" -Arguments @("status", "--short") -WorkingDirectory $RepoPath
        if ($gitStatus.ExitCode -ne 0) {
            throw $gitStatus.Combined
        }
        if ([string]::IsNullOrWhiteSpace($gitStatus.StdOut)) {
            Write-Ok "Working tree clean"
        }
        else {
            Write-Warn "Working tree has local changes"
            Write-Host $gitStatus.StdOut
        }
    }

    if ($LinkProject) {
        if ([string]::IsNullOrWhiteSpace($ProjectRef)) {
            throw "You used -LinkProject but did not provide -ProjectRef"
        }

        Run-Step -Label "Linking repo to Supabase project $ProjectRef" -Script {
            $linkResult = Invoke-CliCapture -FilePath "supabase" -Arguments @("link", "--project-ref", $ProjectRef) -WorkingDirectory $RepoPath
            if ($linkResult.ExitCode -ne 0) {
                throw $linkResult.Combined
            }
            Write-Ok "Project linked"
        }
    }

    Run-Step -Label "Checking Supabase CLI auth and project state" -Script {
        $projects = Invoke-CliCapture -FilePath "supabase" -Arguments @("projects", "list") -WorkingDirectory $RepoPath
        if ($projects.ExitCode -ne 0) {
            throw "Supabase CLI is not ready. Login first with: supabase login`n$($projects.Combined)"
        }
        Write-Ok "Supabase CLI reachable"
    }

    Run-Step -Label "Checking migration status" -Script {
        $status = Invoke-CliCapture -FilePath "supabase" -Arguments @("migration", "list") -WorkingDirectory $RepoPath
        if ($status.ExitCode -ne 0) {
            throw $status.Combined
        }

        Write-Host $status.StdOut

        $missing = @()
        foreach ($file in $requiredMigrationFiles) {
            if ($status.Combined -notmatch [regex]::Escape($file)) {
                $missing += $file
            }
        }

        if ($missing.Count -eq 0) {
            Write-Ok "All required chat migrations are visible in migration list"
        }
        else {
            Write-Warn "Some required migrations do not appear in migration list"
            $missing | ForEach-Object { Write-Host " - $_" -ForegroundColor Yellow }
        }
    }

    if ($ApplyMissingMigrations) {
        Run-Step -Label "Applying migrations to linked Supabase project" -Script {
            $push = Invoke-CliCapture -FilePath "supabase" -Arguments @("db", "push") -WorkingDirectory $RepoPath
            if ($push.ExitCode -ne 0) {
                throw $push.Combined
            }
            Write-Ok "db push completed"
            Write-Host $push.StdOut
        }
    }
    else {
        Write-Warn "Skipping migration apply, because -ApplyMissingMigrations was not supplied"
    }

    $diagSql = @"
select 'fn_chat_send_message' as check_name, count(*)::text as value
from pg_proc
where proname = 'fn_chat_send_message'
union all
select 'fn_chat_mark_read', count(*)::text
from pg_proc
where proname = 'fn_chat_mark_read'
union all
select 'chat_room_summary_v', count(*)::text
from pg_views
where schemaname = 'public' and viewname = 'chat_room_summary_v'
union all
select 'os_messages_in_realtime_publication', count(*)::text
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'os_messages'
union all
select 'os_messages_replica_identity_full',
case c.relreplident when 'f' then '1' else '0' end as value
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'os_messages'
union all
select 'fn_os_messages_notify_counterparty', count(*)::text
from pg_proc
where proname = 'fn_os_messages_notify_counterparty'
union all
select 'trg_os_messages_notify', count(*)::text
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'os_messages'
  and t.tgname = 'trg_os_messages_notify';
"@

    Run-Step -Label "Running structural chat diagnostics against live database" -Script {
        $diag = Invoke-SupabaseSql -Sql $diagSql -WorkingDirectory $RepoPath
        if ($diag.ExitCode -ne 0) {
            throw $diag.Combined
        }

        Write-Host $diag.StdOut

        $combined = $diag.Combined

        $expectedChecks = @{
            "fn_chat_send_message"               = "1"
            "fn_chat_mark_read"                  = "1"
            "chat_room_summary_v"                = "1"
            "os_messages_in_realtime_publication"= "1"
            "os_messages_replica_identity_full"  = "1"
            "fn_os_messages_notify_counterparty" = "1"
            "trg_os_messages_notify"             = "1"
        }

        $failed = @()

        foreach ($key in $expectedChecks.Keys) {
            if ($combined -notmatch [regex]::Escape($key)) {
                $failed += "$key not returned"
                continue
            }

            if ($combined -notmatch ("{0}.*?{1}" -f [regex]::Escape($key), [regex]::Escape($expectedChecks[$key]))) {
                $failed += "$key expected $($expectedChecks[$key])"
            }
        }

        if ($failed.Count -eq 0) {
            Write-Ok "Live DB structure matches required chat contract"
        }
        else {
            Write-Bad "Live DB structure is missing required chat pieces"
            $failed | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
        }
    }

    $policySql = @"
select schemaname, tablename, policyname, permissive, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('os_messages', 'os_room_members', 'os_rooms', 'merchant_profiles')
order by tablename, policyname;
"@

    Run-Step -Label "Dumping RLS policies for critical chat tables" -Script {
        $pol = Invoke-SupabaseSql -Sql $policySql -WorkingDirectory $RepoPath
        if ($pol.ExitCode -ne 0) {
            throw $pol.Combined
        }
        Write-Host $pol.StdOut
        Write-Warn "Read this carefully. If policies are too strict or mismatched to current auth, send and receive will still fail even if functions exist."
    }

    $tableSql = @"
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('os_messages', 'os_room_members', 'os_rooms', 'notifications', 'merchant_profiles')
order by table_name;
"@

    Run-Step -Label "Checking presence of critical chat tables" -Script {
        $tables = Invoke-SupabaseSql -Sql $tableSql -WorkingDirectory $RepoPath
        if ($tables.ExitCode -ne 0) {
            throw $tables.Combined
        }
        Write-Host $tables.StdOut
    }

    $finalSummary = @"
================================================================================
CHAT BACKEND TRIAGE SUMMARY

PASS means the backend contract required by the repo is present.
FAIL means the chat app can still render UI but real delivery is broken.

Mandatory contract:
1. fn_chat_send_message
2. fn_chat_mark_read
3. chat_room_summary_v
4. os_messages included in supabase_realtime publication
5. os_messages replica identity FULL
6. fn_os_messages_notify_counterparty
7. trg_os_messages_notify

If any of the above fails, messages and or live updates are not trustworthy.

Important:
- Calls are still fragile even after message fixes, because current useWebRTC relies on
  Supabase broadcast signaling on room:{roomId}:calls and not a durable server-mediated flow.
- Do not keep changing frontend files until backend parity is proven.

Suggested next command if structure failed:
    powershell -ExecutionPolicy Bypass -File .\chat-backend-triage.ps1 -RepoPath "$RepoPath" -ApplyMissingMigrations

================================================================================
"@

    Write-Host $finalSummary -ForegroundColor White
}
finally {
    Pop-Location
}