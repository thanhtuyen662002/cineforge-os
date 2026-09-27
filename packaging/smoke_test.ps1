[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ArtifactRoot,
    [switch]$AllowOffline,
    [int]$StartupTimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$resolvedRoot = (Resolve-Path -LiteralPath $ArtifactRoot).Path
$exe = Join-Path $resolvedRoot 'CineForge.exe'
if (-not (Test-Path -LiteralPath $exe)) {
    throw "Portable executable is missing: $exe"
}

function Get-FreeLoopbackPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    }
    finally {
        $listener.Stop()
    }
}

# Use ephemeral loopback ports so smoke verification remains reliable when a
# developer already has another CineForge instance or service running.
$webPort = Get-FreeLoopbackPort
do { $corePort = Get-FreeLoopbackPort } while ($corePort -eq $webPort)
$dataRoot = Join-Path ([IO.Path]::GetTempPath()) ('CineForge-smoke-' + [Guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $dataRoot) { Remove-Item -LiteralPath $dataRoot -Recurse -Force }
New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
$stdout = Join-Path $dataRoot 'bootstrap.stdout.log'
$stderr = Join-Path $dataRoot 'bootstrap.stderr.log'
$quote = { param([string]$value) '"' + $value.Replace('"', '\"') + '"' }
$arguments = '--no-browser --root ' + (& $quote $resolvedRoot) + ' --data ' + (& $quote $dataRoot) + " --web-port $webPort --core-port $corePort"
if ($AllowOffline) { $arguments += ' --allow-offline' }
$process = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $resolvedRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$passed = $false

function Stop-Tree([System.Diagnostics.Process]$Target) {
    if ($null -eq $Target) { return }
    try {
        if (-not $Target.HasExited) {
            $taskkill = Get-Command taskkill.exe -ErrorAction SilentlyContinue
            if ($null -ne $taskkill) {
                & $taskkill.Source /PID $Target.Id /T /F 2>$null | Out-Null
            }
            else {
                Stop-Process -Id $Target.Id -Force -ErrorAction SilentlyContinue
            }
        }
    }
    catch { }
    try { $Target.Dispose() } catch { }
}

try {
    $health = $null
    $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    while ((Get-Date) -lt $deadline -and $null -eq $health) {
        if ($process.HasExited) {
            $errorText = if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Raw } else { '' }
            throw "CineForge.exe exited during startup (code $($process.ExitCode)). $errorText"
        }
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/healthz" -TimeoutSec 2
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if ($null -eq $health) { throw "CineForge health endpoint did not respond within $StartupTimeoutSeconds seconds." }
    if (-not $health.web) { throw 'CineForge health endpoint reported an invalid web state.' }
    if ($AllowOffline) {
        if ($health.status -notin @('ok', 'degraded')) { throw 'CineForge health endpoint reported an invalid status.' }
    }
    elseif ($health.status -ne 'ok' -or -not $health.core) {
        throw 'CineForge Core did not become ready; a production portable build must include a working Core.'
    }

    $html = (Invoke-WebRequest -Uri "http://127.0.0.1:$webPort/" -UseBasicParsing -TimeoutSec 5).Content
    if ($html -notmatch '<html') { throw 'CineForge root page did not return HTML.' }
    if ($health.core) {
        $dashboard = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/dashboard" -TimeoutSec 5
        if ($null -eq $dashboard) { throw 'Core dashboard response was empty.' }
        $projectHeaders = @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-project' }
        $project = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/projects" -Method Post -Headers $projectHeaders -ContentType 'application/json' -Body (@{ name = 'Packaging smoke project' } | ConvertTo-Json) -TimeoutSec 5
        if ([string]::IsNullOrWhiteSpace([string]$project.id)) { throw 'Core project creation returned no project id.' }
        $replayedProject = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/projects" -Method Post -Headers $projectHeaders -ContentType 'application/json' -Body (@{ name = 'Packaging smoke project' } | ConvertTo-Json) -TimeoutSec 5
        if ($replayedProject.id -ne $project.id) { throw 'Idempotent project retry returned a different project id.' }
        $item = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/v1/projects/{1}/production-items" -f $webPort, [Uri]::EscapeDataString([string]$project.id)) -Method Post -ContentType 'application/json' -Body (@{ title = 'Packaging smoke item' } | ConvertTo-Json) -TimeoutSec 5
        if ([string]::IsNullOrWhiteSpace([string]$item.id)) { throw 'Core production item creation returned no item id.' }
        $refreshed = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/dashboard" -TimeoutSec 5
        $persisted = @($refreshed.projects | Where-Object { $_.id -eq $project.id })
        if ($persisted.Count -ne 1) { throw 'Created project was not present in the refreshed dashboard.' }
        if (@($persisted[0].productionItems | Where-Object { $_.id -eq $item.id }).Count -ne 1) { throw 'Created production item was not present after dashboard refresh.' }

        # Restart the exact bootstrap against the same data directory. This
        # catches accidental in-memory-only success in the packaged path.
        Stop-Tree $process
        for ($attempt = 0; $attempt -lt 20 -and -not $process.HasExited; $attempt++) {
            Start-Sleep -Milliseconds 100
        }
        # Use separate redirect files so Windows does not race a still-closing
        # handle from the first bootstrap process.
        $restartStdout = Join-Path $dataRoot 'bootstrap.restart.stdout.log'
        $restartStderr = Join-Path $dataRoot 'bootstrap.restart.stderr.log'
        $process = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $resolvedRoot -WindowStyle Hidden -RedirectStandardOutput $restartStdout -RedirectStandardError $restartStderr -PassThru
        $restartedHealth = $null
        $restartDeadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
        while ((Get-Date) -lt $restartDeadline -and $null -eq $restartedHealth) {
            if ($process.HasExited) {
                $errorText = if (Test-Path -LiteralPath $restartStderr) { Get-Content -LiteralPath $restartStderr -Raw } else { '' }
                throw "CineForge.exe exited during restart (code $($process.ExitCode)). $errorText"
            }
            try { $restartedHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/healthz" -TimeoutSec 2 }
            catch { Start-Sleep -Milliseconds 250 }
        }
        if ($null -eq $restartedHealth -or -not $restartedHealth.core) { throw 'Core did not recover after restarting the packaged bootstrap.' }
        $reloaded = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/dashboard" -TimeoutSec 5
        $reloadedProject = @($reloaded.projects | Where-Object { $_.id -eq $project.id })
        if ($reloadedProject.Count -ne 1 -or @($reloadedProject[0].productionItems | Where-Object { $_.id -eq $item.id }).Count -ne 1) { throw 'Project data did not survive a packaged bootstrap restart.' }
    }
    Write-Host ("PACKAGING_SMOKE=PASS core={0} web={1}" -f $health.core, $health.web) -ForegroundColor Green
    $passed = $true
}
finally {
    Stop-Tree $process
    if ($passed -and (Test-Path -LiteralPath $dataRoot)) {
        for ($attempt = 0; $attempt -lt 30 -and (Test-Path -LiteralPath $dataRoot); $attempt++) {
            Start-Sleep -Milliseconds 200
            Remove-Item -LiteralPath $dataRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
