[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath,
    [int]$StartupTimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$resolvedExe = (Resolve-Path -LiteralPath $ExecutablePath).Path
if (-not (Test-Path -LiteralPath $resolvedExe -PathType Leaf)) {
    throw "Single-file executable is missing: $resolvedExe"
}

function Get-FreeLoopbackPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    }
    finally { $listener.Stop() }
}

function Stop-Tree([System.Diagnostics.Process]$Target) {
    if ($null -eq $Target) { return }
    try {
        if (-not $Target.HasExited) {
            $taskkill = Get-Command taskkill.exe -ErrorAction SilentlyContinue
            if ($null -ne $taskkill) { & $taskkill.Source /PID $Target.Id /T /F 2>$null | Out-Null }
            else { Stop-Process -Id $Target.Id -Force -ErrorAction SilentlyContinue }
        }
    }
    catch { }
    try { $Target.Dispose() } catch { }
}

function Add-ProcessArgument([Diagnostics.ProcessStartInfo]$StartInfo, [string]$Value, [ref]$LegacyArguments) {
    # ArgumentList was added after Windows PowerShell 5.1. The .cmd wrappers
    # intentionally remain compatible with that inbox host, while .NET 8
    # callers use the structured API that avoids command-line reparsing.
    $argumentListProperty = $StartInfo.GetType().GetProperty('ArgumentList')
    if ($null -ne $argumentListProperty) {
        $StartInfo.ArgumentList.Add($Value)
        return
    }
    $quoted = '"' + $Value.Replace('"', '\"') + '"'
    if ($LegacyArguments.Value.Length -gt 0) { $LegacyArguments.Value += ' ' }
    $LegacyArguments.Value += $quoted
}

$webPort = Get-FreeLoopbackPort
do { $corePort = Get-FreeLoopbackPort } while ($corePort -eq $webPort)
$dataRoot = Join-Path ([IO.Path]::GetTempPath()) ('CineForge-single-smoke-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
$stdout = Join-Path $dataRoot 'bootstrap.stdout.log'
$stderr = Join-Path $dataRoot 'bootstrap.stderr.log'
$process = $null

try {
    $start = [System.Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $resolvedExe
    $start.WorkingDirectory = Split-Path -Parent $resolvedExe
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $legacyArguments = ''
    foreach ($argument in @('--no-browser', '--data', $dataRoot, '--web-port', [string]$webPort, '--core-port', [string]$corePort)) {
        Add-ProcessArgument $start $argument ([ref]$legacyArguments)
    }
    if ($start.GetType().GetProperty('ArgumentList') -eq $null) { $start.Arguments = $legacyArguments }
    $process = [System.Diagnostics.Process]::Start($start)
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()

    $health = $null
    $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    while ((Get-Date) -lt $deadline -and $null -eq $health) {
        if ($process.HasExited) {
            $errorText = $stderrTask.GetAwaiter().GetResult()
            throw "CineForge single-file executable exited during startup (code $($process.ExitCode)). $errorText"
        }
        try { $health = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/healthz" -TimeoutSec 2 }
        catch { Start-Sleep -Milliseconds 250 }
    }
    if ($null -eq $health) { throw "CineForge single-file health endpoint did not respond within $StartupTimeoutSeconds seconds." }
    if (-not $health.web -or $health.status -ne 'ok' -or -not $health.core) {
        throw 'CineForge single-file package did not expose a ready web/Core product.'
    }
    $healthJson = $health | ConvertTo-Json -Depth 10 -Compress
    if ($healthJson -match '(?i)([A-Za-z]:\\|\\\\|(?:file|https?)://|/Users/|/home/)' -or $healthJson -match [regex]::Escape($dataRoot)) {
        throw 'CineForge single-file health endpoint leaked an absolute data path.'
    }
    if ($health.dataRootConfigured -ne $true) { throw 'CineForge single-file health endpoint did not report the data root as configured.' }

    $html = (Invoke-WebRequest -Uri "http://127.0.0.1:$webPort/" -UseBasicParsing -TimeoutSec 5).Content
    if ($html -notmatch '<html') { throw 'CineForge single-file root page did not return HTML.' }
    $healthProjection = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/health" -TimeoutSec 5
    $result = if ($healthProjection.result) { $healthProjection.result } else { $healthProjection }
    foreach ($privateField in @('db_path', 'wal_path', 'object_store_path')) {
        if ($null -ne $result.PSObject.Properties[$privateField]) { throw "Single-file health projection leaked private field $privateField." }
    }
    $rendererPreflightEnvelope = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/release/renderer/preflight" -TimeoutSec 5
    $rendererPreflight = if ($rendererPreflightEnvelope.result) { $rendererPreflightEnvelope.result } else { $rendererPreflightEnvelope }
    if ($rendererPreflight.state -ne 'BLOCKED' -or $rendererPreflight.execution_state -ne 'DISABLED') {
        throw 'Single-file renderer preflight did not fail closed with execution disabled when no trusted toolchain pack is bundled.'
    }
    $rendererJson = $rendererPreflight | ConvertTo-Json -Depth 20 -Compress
    if ($rendererJson -match '(?i)([A-Za-z]:\\|\\\\|(?:file|https?)://|/Users/|/home/)') {
        throw 'Single-file renderer preflight leaked a filesystem or provider path.'
    }
    $jobs = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/jobs?limit=1" -TimeoutSec 5
    $jobsResult = if ($jobs.result) { $jobs.result } else { $jobs }
    if ($null -eq $jobsResult.PSObject.Properties['jobs'] -and $null -eq $jobsResult.PSObject.Properties['items']) {
        throw 'CineForge single-file jobs projection is missing its bounded list field.'
    }
    $headers = @{ 'Idempotency-Key' = 'cineforge-single-file-smoke-project'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
    $project = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/projects" -Method Post -Headers $headers -ContentType 'application/json' -Body (@{ name = 'Single-file smoke project' } | ConvertTo-Json) -TimeoutSec 5
    if ([string]::IsNullOrWhiteSpace([string]$project.id)) { throw 'CineForge single-file project creation returned no id.' }
    $replay = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/projects" -Method Post -Headers $headers -ContentType 'application/json' -Body (@{ name = 'Single-file smoke project' } | ConvertTo-Json) -TimeoutSec 5
    if ($replay.id -ne $project.id) { throw 'CineForge single-file project retry was not idempotent.' }

    # Restart the same lone executable against the same data root. This
    # proves the first-run extraction/cache and Core database are durable,
    # rather than merely returning a healthy in-memory fixture.
    Stop-Tree $process
    $process = $null
    $webPort2 = Get-FreeLoopbackPort
    do { $corePort2 = Get-FreeLoopbackPort } while ($corePort2 -eq $webPort2)
    $startAgain = [System.Diagnostics.ProcessStartInfo]::new()
    $startAgain.FileName = $resolvedExe
    $startAgain.WorkingDirectory = Split-Path -Parent $resolvedExe
    $startAgain.UseShellExecute = $false
    $startAgain.CreateNoWindow = $true
    $startAgain.RedirectStandardOutput = $true
    $startAgain.RedirectStandardError = $true
    $legacyAgain = ''
    foreach ($argument in @('--no-browser', '--data', $dataRoot, '--web-port', [string]$webPort2, '--core-port', [string]$corePort2)) {
        Add-ProcessArgument $startAgain $argument ([ref]$legacyAgain)
    }
    if ($startAgain.GetType().GetProperty('ArgumentList') -eq $null) { $startAgain.Arguments = $legacyAgain }
    $process = [System.Diagnostics.Process]::Start($startAgain)
    $restartStderr = $process.StandardError.ReadToEndAsync()
    $restartHealth = $null
    $restartDeadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    while ((Get-Date) -lt $restartDeadline -and $null -eq $restartHealth) {
        if ($process.HasExited) {
            $errorText = $restartStderr.GetAwaiter().GetResult()
            throw "CineForge single-file executable exited during restart (code $($process.ExitCode)). $errorText"
        }
        try { $restartHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort2/healthz" -TimeoutSec 2 }
        catch { Start-Sleep -Milliseconds 250 }
    }
    if ($null -eq $restartHealth -or -not $restartHealth.core -or $restartHealth.status -ne 'ok') { throw 'CineForge single-file restart did not expose a ready Core.' }
    $projects = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort2/v1/projects" -TimeoutSec 5
    $projectItems = if ($projects.result -and $projects.result.projects) { @($projects.result.projects) } elseif ($projects.result) { @($projects.result) } elseif ($projects.items) { @($projects.items) } else { @($projects) }
    $projectId = [string]$project.id
    $matchingProjects = @($projectItems | Where-Object {
        if ($null -eq $_) { return $false }
        $idProperty = $_.PSObject.Properties['id']
        $null -ne $idProperty -and [string]$idProperty.Value -eq $projectId
    })
    if ($matchingProjects.Count -ne 1) {
        throw 'CineForge single-file project was not durable across an executable restart.'
    }

    Write-Host "SINGLE_FILE_SMOKE=PASS core=$($health.core) web=$($health.web) restart=True" -ForegroundColor Green
}
finally {
    if ($null -ne $process) {
        try { if (-not $process.HasExited) { Stop-Tree $process } } catch { }
    }
    try {
        if (Test-Path -LiteralPath $dataRoot) {
            $resolvedData = (Resolve-Path -LiteralPath $dataRoot).Path
            $tempRoot = (Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).Path.TrimEnd('\') + '\'
            if ($resolvedData.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
                Remove-Item -LiteralPath $resolvedData -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
    catch { }
}
