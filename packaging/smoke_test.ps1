[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ArtifactRoot,
    [switch]$AllowOffline,
    [int]$StartupTimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Net.Http

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

function Get-OptionalProperty($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-HttpErrorCode($Caught) {
    $message = ''
    try { $message = [string]$Caught.ErrorDetails.Message } catch { }
    if ([string]::IsNullOrWhiteSpace($message) -and $null -ne $Caught.Exception.Response) {
        try {
            $stream = $Caught.Exception.Response.GetResponseStream()
            if ($null -ne $stream) {
                $reader = [IO.StreamReader]::new($stream)
                try { $message = $reader.ReadToEnd() } finally { $reader.Dispose() }
            }
        } catch { }
    }
    if ([string]::IsNullOrWhiteSpace($message)) { return '' }
    try { return [string](($message | ConvertFrom-Json).error.code) } catch { return '' }
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
    $healthJson = $health | ConvertTo-Json -Depth 10 -Compress
    if ($healthJson -match '(?i)([A-Za-z]:\\|\\\\|(?:file|https?)://|/Users/|/home/)' -or $healthJson -match [regex]::Escape($dataRoot)) {
        throw 'CineForge health endpoint leaked an absolute data path.'
    }
    if ($health.dataRootConfigured -ne $true) { throw 'CineForge health endpoint did not report the data root as configured.' }

    # A second bootstrap must not probe another port and open the same data
    # root concurrently. The Windows host owns a stable mutex keyed by this
    # data root and reports a deterministic already-running exit code.
    $duplicateStdout = Join-Path $dataRoot 'bootstrap.duplicate.stdout.log'
    $duplicateStderr = Join-Path $dataRoot 'bootstrap.duplicate.stderr.log'
    # Start the executable directly instead of routing through cmd.exe.  The
    # latter reparses paths and arguments, so a checkout/data path containing
    # cmd metacharacters (for example `%` or `&`) could change the duplicate
    # probe command. Use ProcessStartInfo rather than Start-Process here so the
    # native single-file host's exit code remains available after WaitForExit.
    $duplicateStart = [System.Diagnostics.ProcessStartInfo]::new()
    $duplicateStart.FileName = $exe
    $duplicateStart.Arguments = $arguments
    $duplicateStart.WorkingDirectory = $resolvedRoot
    $duplicateStart.CreateNoWindow = $true
    $duplicateStart.UseShellExecute = $false
    $duplicateStart.RedirectStandardOutput = $true
    $duplicateStart.RedirectStandardError = $true
    $duplicate = [System.Diagnostics.Process]::Start($duplicateStart)
    try {
        if (-not $duplicate.WaitForExit(10000)) {
            throw 'A second CineForge bootstrap did not exit after detecting the active data-root owner.'
        }
        $duplicate.Refresh()
        $duplicateOutput = $duplicate.StandardOutput.ReadToEnd()
        $duplicateError = $duplicate.StandardError.ReadToEnd()
        Set-Content -LiteralPath $duplicateStdout -Value $duplicateOutput -Encoding UTF8
        Set-Content -LiteralPath $duplicateStderr -Value $duplicateError -Encoding UTF8
        if ($duplicate.ExitCode -ne 6) {
            throw "A second CineForge bootstrap returned exit code $($duplicate.ExitCode), expected 6. $duplicateError"
        }
        if ($duplicateError -notmatch '(?i)already running') {
            throw "A second CineForge bootstrap did not report an already-running error. $duplicateError"
        }
    }
    finally {
        try {
            if (-not $duplicate.HasExited) { Stop-Tree $duplicate }
            else { $duplicate.Dispose() }
        }
        catch { }
    }

    $html = (Invoke-WebRequest -Uri "http://127.0.0.1:$webPort/" -UseBasicParsing -TimeoutSec 5).Content
    if ($html -notmatch '<html') { throw 'CineForge root page did not return HTML.' }
    if ($health.core) {
        # The browser-facing health projection must remain useful without
        # disclosing the Core's private database/WAL/object-store locations.
        $apiHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/health" -TimeoutSec 5
        $apiHealthResult = Get-OptionalProperty $apiHealth 'result'
        foreach ($privateHealthField in @('db_path', 'wal_path', 'object_store_path')) {
            if ($null -ne (Get-OptionalProperty $apiHealthResult $privateHealthField)) {
                throw "Browser health projection leaked private field $privateHealthField."
            }
        }
        $recovery = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/recovery/status" -TimeoutSec 5
        $recoveryResult = Get-OptionalProperty $recovery 'result'
        if ($null -eq $recoveryResult -or (Get-OptionalProperty $recoveryResult 'read_only') -ne $true) {
            throw 'Packaged recovery status did not expose an explicit read-only posture.'
        }
        if ((Get-OptionalProperty $recoveryResult 'restore_activation_state') -ne 'NOT_IMPLEMENTED') {
            throw 'Packaged recovery status silently advertised restore activation.'
        }
        $scrub = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/storage/scrub-health?limit=1&max_bytes=65536" -TimeoutSec 5
        $scrubResult = Get-OptionalProperty $scrub 'result'
        if ($null -eq $scrubResult -or (Get-OptionalProperty $scrubResult 'read_only') -ne $true) {
            throw 'Packaged storage scrub endpoint did not expose a read-only evidence contract.'
        }
        $scrubScan = Get-OptionalProperty $scrubResult 'scan'
        if ($null -eq $scrubScan -or $null -eq (Get-OptionalProperty $scrubScan 'complete')) {
            throw 'Packaged storage scrub endpoint returned no bounded scan evidence.'
        }
        $jobs = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/jobs?limit=1" -TimeoutSec 5
        $jobsResult = Get-OptionalProperty $jobs 'result'
        if ($null -eq $jobsResult) { $jobsResult = $jobs }
        # PowerShell unwraps an empty JSON array to `$null` in some versions;
        # inspect property presence rather than treating an empty queue as a
        # malformed projection.
        $jobsProperty = if ($null -ne $jobsResult) { $jobsResult.PSObject.Properties['jobs'] } else { $null }
        if ($null -eq $jobsProperty) { $jobsProperty = if ($null -ne $jobsResult) { $jobsResult.PSObject.Properties['items'] } else { $null } }
        if ($null -eq $jobsProperty) {
            throw 'Packaged jobs endpoint returned no bounded job list projection.'
        }
        $dashboard = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/dashboard" -TimeoutSec 5
        if ($null -eq $dashboard) { throw 'Core dashboard response was empty.' }
        $browserHeaders = @{ Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $projectHeaders = @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-project'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $project = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/projects" -Method Post -Headers $projectHeaders -ContentType 'application/json' -Body (@{ name = 'Packaging smoke project' } | ConvertTo-Json) -TimeoutSec 5
        if ([string]::IsNullOrWhiteSpace([string]$project.id)) { throw 'Core project creation returned no project id.' }
        $replayedProject = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/projects" -Method Post -Headers $projectHeaders -ContentType 'application/json' -Body (@{ name = 'Packaging smoke project' } | ConvertTo-Json) -TimeoutSec 5
        if ($replayedProject.id -ne $project.id) { throw 'Idempotent project retry returned a different project id.' }
        $item = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/v1/projects/{1}/production-items" -f $webPort, [Uri]::EscapeDataString([string]$project.id)) -Method Post -Headers $browserHeaders -ContentType 'application/json' -Body (@{ title = 'Packaging smoke item' } | ConvertTo-Json) -TimeoutSec 5
        if ([string]::IsNullOrWhiteSpace([string]$item.id)) { throw 'Core production item creation returned no item id.' }

        # The canonical workspace surface is part of the packaged contract.
        # Keep this beside the legacy projection check so a release cannot
        # pass while only the compatibility route works.
        $taskUri = "http://127.0.0.1:{0}/v1/projects/{1}/tasks" -f $webPort, [Uri]::EscapeDataString([string]$project.id)
        $taskHeaders = @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-task'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $taskEnvelope = Invoke-RestMethod -Uri $taskUri -Method Post -Headers $taskHeaders -ContentType 'application/json' -Body (@{ title = 'Lock canonical shot list'; description = 'Workspace route smoke' } | ConvertTo-Json) -TimeoutSec 5
        $taskRecord = $taskEnvelope.result.task
        if ($null -eq $taskRecord) { $taskRecord = $taskEnvelope.result }
        if ([string]::IsNullOrWhiteSpace([string]$taskRecord.id) -or [string]$taskRecord.status -ne 'PLANNED') { throw 'Canonical task creation returned an invalid task.' }
        $taskReplayEnvelope = Invoke-RestMethod -Uri $taskUri -Method Post -Headers $taskHeaders -ContentType 'application/json' -Body (@{ title = 'Lock canonical shot list'; description = 'Workspace route smoke' } | ConvertTo-Json) -TimeoutSec 5
        $taskReplayRecord = $taskReplayEnvelope.result.task
        if ($null -eq $taskReplayRecord) { $taskReplayRecord = $taskReplayEnvelope.result }
        if ($taskReplayRecord.id -ne $taskRecord.id) { throw 'Canonical task idempotent retry returned a different task id.' }
        $taskId = [Uri]::EscapeDataString([string]$taskRecord.id)
        $taskUpdateEnvelope = Invoke-RestMethod -Uri "$taskUri/$taskId" -Method Patch -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-task-update'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ status = 'IN_PROGRESS'; row_version = [int]$taskRecord.row_version } | ConvertTo-Json) -TimeoutSec 5
        $taskUpdateRecord = $taskUpdateEnvelope.result.task
        if ($null -eq $taskUpdateRecord) { $taskUpdateRecord = $taskUpdateEnvelope.result }
        if ($taskUpdateRecord.status -ne 'IN_PROGRESS' -or [int]$taskUpdateRecord.row_version -ne ([int]$taskRecord.row_version + 1)) { throw 'Canonical task update did not advance status and row version.' }
        $staleTaskStatus = 0
        try {
            Invoke-RestMethod -Uri "$taskUri/$taskId" -Method Patch -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-task-stale'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ status = 'DONE'; row_version = [int]$taskRecord.row_version } | ConvertTo-Json) -TimeoutSec 5 | Out-Null
        }
        catch { if ($null -ne $_.Exception.Response) { $staleTaskStatus = [int]$_.Exception.Response.StatusCode } }
        if ($staleTaskStatus -ne 409) { throw "Stale canonical task update was not rejected with HTTP 409 (actual: $staleTaskStatus)." }

        $shotUri = "http://127.0.0.1:{0}/v1/projects/{1}/shots" -f $webPort, [Uri]::EscapeDataString([string]$project.id)
        $shotEnvelope = Invoke-RestMethod -Uri $shotUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-shot'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ code = 'SH010'; title = 'Door opens' } | ConvertTo-Json) -TimeoutSec 5
        $shotRecord = $shotEnvelope.result.shot
        if ($null -eq $shotRecord) { $shotRecord = $shotEnvelope.result }
        if ([string]::IsNullOrWhiteSpace([string]$shotRecord.id) -or [string]$shotRecord.lifecycle_state -ne 'ACTIVE') { throw 'Canonical shot creation returned an invalid shot.' }
        $shotId = [Uri]::EscapeDataString([string]$shotRecord.id)
        $shotUpdateEnvelope = Invoke-RestMethod -Uri "$shotUri/$shotId" -Method Patch -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-shot-update'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ lifecycle_state = 'PAUSED'; row_version = [int]$shotRecord.row_version } | ConvertTo-Json) -TimeoutSec 5
        $shotUpdateRecord = $shotUpdateEnvelope.result.shot
        if ($null -eq $shotUpdateRecord) { $shotUpdateRecord = $shotUpdateEnvelope.result }
        if ($shotUpdateRecord.lifecycle_state -ne 'PAUSED') { throw 'Canonical shot lifecycle update did not persist.' }

        $taskNoteUri = "$taskUri/$taskId/notes"
        $taskNoteEnvelope = Invoke-RestMethod -Uri $taskNoteUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-task-note'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ body = 'Review rights before generation.' } | ConvertTo-Json) -TimeoutSec 5
        $taskNoteRecord = $taskNoteEnvelope.result.note
        if ($null -eq $taskNoteRecord) { $taskNoteRecord = $taskNoteEnvelope.result }
        if ([string]::IsNullOrWhiteSpace([string]$taskNoteRecord.id) -or [string]$taskNoteRecord.entity_type -ne 'TASK' -or $taskNoteRecord.entity_id -ne $taskRecord.id) { throw 'Canonical task note creation returned an invalid note.' }
        $workspaceUri = "http://127.0.0.1:{0}/v1/projects/{1}/workspace" -f $webPort, [Uri]::EscapeDataString([string]$project.id)
        $workspaceEnvelope = Invoke-RestMethod -Uri $workspaceUri -TimeoutSec 5
        $workspaceRecord = $workspaceEnvelope.result
        if (@($workspaceRecord.tasks | Where-Object { $_.id -eq $taskRecord.id }).Count -ne 1) { throw 'Canonical task was not present in the workspace projection.' }
        if (@($workspaceRecord.shots | Where-Object { $_.id -eq $shotRecord.id }).Count -ne 1) { throw 'Canonical shot was not present in the workspace projection.' }
        if (@($workspaceRecord.notes | Where-Object { $_.id -eq $taskNoteRecord.id }).Count -ne 1) { throw 'Canonical note was not present in the workspace projection.' }

        # DecisionRequest is canonical user-blocking state. The packaged
        # boundary must expose choices and stale-safe resolution; a dashboard
        # notification alone is not evidence that a decision exists.
        $decisionCommandHeaders = @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-decision'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $decisionPayload = @{
            command_type = 'CreateDecisionRequest'
            payload = @{
                project_id = [string]$project.id
                decision_type = 'PACKAGING_REVIEW'
                title_key = 'packaging.smoke.title'
                reason_key = 'packaging.smoke.reason'
                blocking_scope_type = 'PROJECT'
                blocking_scope_id = [string]$project.id
                severity = 'HIGH'
                evidence = @(@{ kind = 'SMOKE'; status = 'UNKNOWN' })
                default_behavior = @{ action = 'DO_NOTHING' }
                choices = @(@{ id = 'continue'; label_key = 'packaging.smoke.continue'; recommended = $true }, @{ id = 'hold'; label_key = 'packaging.smoke.hold' })
            }
        } | ConvertTo-Json -Depth 10
        $decisionEnvelope = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/commands" -Method Post -Headers $decisionCommandHeaders -ContentType 'application/json' -Body $decisionPayload -TimeoutSec 5
        $decisionRecord = $decisionEnvelope.result.decision
        if ($null -eq $decisionRecord) { $decisionRecord = $decisionEnvelope.result }
        if ([string]::IsNullOrWhiteSpace([string]$decisionRecord.id) -or [string]$decisionRecord.state -ne 'OPEN') { throw 'DecisionRequest creation returned an invalid open request.' }
        if (@($decisionRecord.choices).Count -ne 2 -or [int]$decisionRecord.decision_version -ne 1) { throw 'DecisionRequest choices or version are invalid.' }
        $decisionDashboard = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/dashboard" -TimeoutSec 5
        if (@($decisionDashboard.decisions | Where-Object { $_.id -eq $decisionRecord.id }).Count -ne 1) { throw 'Open DecisionRequest was missing from the dashboard.' }
        $decisionList = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/decisions?project_id=$([Uri]::EscapeDataString([string]$project.id))" -TimeoutSec 5
        if (@($decisionList.result.items | Where-Object { $_.id -eq $decisionRecord.id }).Count -ne 1) { throw 'Open DecisionRequest was missing from the canonical list.' }
        $staleDecisionStatus = 0
        try {
            Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/v1/decisions/{1}/resolve" -f $webPort, [Uri]::EscapeDataString([string]$decisionRecord.id)) -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-decision-stale'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ choice_id = 'continue'; expected_decision_version = 2 } | ConvertTo-Json) -TimeoutSec 5 | Out-Null
        }
        catch { if ($null -ne $_.Exception.Response) { $staleDecisionStatus = [int]$_.Exception.Response.StatusCode } }
        if ($staleDecisionStatus -ne 409) { throw "Stale DecisionRequest resolution was not rejected with HTTP 409 (actual: $staleDecisionStatus)." }
        $decisionResolveUri = "http://127.0.0.1:{0}/v1/decisions/{1}/resolve" -f $webPort, [Uri]::EscapeDataString([string]$decisionRecord.id)
        $resolvedDecision = Invoke-RestMethod -Uri $decisionResolveUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-decision-resolve'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ choice_id = 'continue'; expected_decision_version = [int]$decisionRecord.decision_version } | ConvertTo-Json) -TimeoutSec 5
        $resolvedDecisionRecord = $resolvedDecision.result.decision
        if ($null -eq $resolvedDecisionRecord) { $resolvedDecisionRecord = $resolvedDecision.result }
        if ([string]$resolvedDecisionRecord.state -ne 'RESOLVED' -or [string]$resolvedDecisionRecord.resolved_choice_id -ne 'continue') { throw 'DecisionRequest did not resolve to the selected choice.' }
        $resolvedReplay = Invoke-RestMethod -Uri $decisionResolveUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-decision-resolve'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ choice_id = 'continue'; expected_decision_version = [int]$decisionRecord.decision_version } | ConvertTo-Json) -TimeoutSec 5
        $resolvedReplayFlag = Get-OptionalProperty $resolvedReplay 'idempotent_replay'
        if ($null -eq $resolvedReplayFlag) { $resolvedReplayFlag = Get-OptionalProperty $resolvedReplay.result 'idempotent_replay' }
        if (-not $resolvedReplayFlag) { throw 'DecisionRequest resolve retry was not an idempotent replay.' }

        # Exercise the metadata-first review gate through the packaged
        # bootstrap.  A timeline revision cannot become APPROVED until an
        # exact, current APPROVE review has been submitted for it.  This keeps
        # the one-click artifact aligned with the canonical Core invariants:
        # project scope, optimistic versions, idempotent commands, and stale
        # review rejection are all checked on the real loopback boundary.
        $profileUri = "http://127.0.0.1:{0}/v1/projects/{1}/media-profile" -f $webPort, [Uri]::EscapeDataString([string]$project.id)
        $profileHeaders = @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-review-profile'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $profileEnvelope = Invoke-RestMethod -Uri $profileUri -Method Post -Headers $profileHeaders -ContentType 'application/json' -Body (@{
            timeline_rate = @{ num = 24; den = 1 }
            time_base = @{ num = 1; den = 24 }
            width = 1920
            height = 1080
            pixel_aspect = @{ num = 1; den = 1 }
            working_color_space = 'sRGB'
            transfer_function = 'SDR'
            hdr_policy = 'NONE'
            audio_sample_rate = 48000
            audio_channel_layout = 'STEREO'
        } | ConvertTo-Json -Depth 10) -TimeoutSec 5
        $profileCandidate = @($profileEnvelope.result.candidateRevisions) | Select-Object -First 1
        if ($null -eq $profileCandidate -or [string]::IsNullOrWhiteSpace([string]$profileCandidate.id) -or [int]$profileCandidate.rowVersion -ne 1) { throw 'Review smoke media profile creation returned no candidate revision at version 1.' }
        $profileApproveUri = "{0}/revisions/{1}/transition" -f $profileUri, [Uri]::EscapeDataString([string]$profileCandidate.id)
        $profileApproved = Invoke-RestMethod -Uri $profileApproveUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-review-profile-approve'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ next_state = 'APPROVED'; expected_version = [int]$profileCandidate.rowVersion } | ConvertTo-Json) -TimeoutSec 5
        $approvedProfile = $profileApproved.result.approvedRevision
        if ($null -eq $approvedProfile -or [string]$approvedProfile.state -ne 'APPROVED') { throw 'Review smoke media profile did not reach APPROVED.' }

        $timelineUri = "http://127.0.0.1:{0}/v1/projects/{1}/timelines" -f $webPort, [Uri]::EscapeDataString([string]$project.id)
        $timelineEnvelope = Invoke-RestMethod -Uri $timelineUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-review-timeline'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{
            code = 'REVIEW'
            title = 'Review smoke timeline'
            media_profile_revision_id = [string]$approvedProfile.id
        } | ConvertTo-Json -Depth 10) -TimeoutSec 5
        $timelineResult = $timelineEnvelope.result
        $timelineRecord = Get-OptionalProperty $timelineResult 'timeline'
        if ($null -eq $timelineRecord) { $timelineRecord = $timelineResult }
        if ($null -eq $timelineRecord -or [string]::IsNullOrWhiteSpace([string]$timelineRecord.id) -or [int]$timelineRecord.rowVersion -ne 1) { throw 'Review smoke timeline creation returned an invalid timeline.' }
        $timelineId = [Uri]::EscapeDataString([string]$timelineRecord.id)
        $checkpointUri = "{0}/{1}/revisions" -f $timelineUri, $timelineId
        $checkpointEnvelope = Invoke-RestMethod -Uri $checkpointUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-review-checkpoint'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{
            expected_version = [int]$timelineRecord.rowVersion
            media_profile_revision_id = [string]$approvedProfile.id
            duration = @{ num = 24; den = 1 }
            # Keep this metadata/review fixture clip-free. Working-session
            # checkpointing requires every existing clip to carry an exact
            # materialized asset pin; INSERT_CLIP coverage is exercised by
            # Core tests and a separate asset-intake smoke below.
            tracks = @(@{ track_type = 'VIDEO'; order_index = 0; name = 'Picture'; clips = @() })
            markers = @(@{ time = @{ num = 6; den = 1 }; marker_type = 'NOTE'; label = 'Review gate' })
        } | ConvertTo-Json -Depth 15) -TimeoutSec 5
        $checkpointResult = $checkpointEnvelope.result
        $checkpointRevision = Get-OptionalProperty $checkpointResult 'currentRevision'
        if ($null -eq $checkpointRevision) { $checkpointRevision = Get-OptionalProperty $checkpointResult 'revision' }
        if ($null -eq $checkpointRevision -or [string]::IsNullOrWhiteSpace([string]$checkpointRevision.id) -or [string]$checkpointRevision.state -ne 'DRAFT_CHECKPOINT' -or [int]$checkpointRevision.rowVersion -ne 1) { throw 'Review smoke checkpoint did not return the expected DRAFT_CHECKPOINT revision.' }
        $revisionId = [Uri]::EscapeDataString([string]$checkpointRevision.id)
        $candidateUri = "{0}/{1}/transition" -f $checkpointUri, $revisionId
        $candidateEnvelope = Invoke-RestMethod -Uri $candidateUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-review-candidate'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ next_state = 'CANDIDATE'; expected_version = [int]$checkpointRevision.rowVersion } | ConvertTo-Json) -TimeoutSec 5
        $candidateResult = $candidateEnvelope.result
        $candidateRevision = Get-OptionalProperty $candidateResult 'currentRevision'
        if ($null -eq $candidateRevision) { $candidateRevision = Get-OptionalProperty $candidateResult 'revision' }
        if ($null -eq $candidateRevision -or [string]$candidateRevision.state -ne 'CANDIDATE' -or [int]$candidateRevision.rowVersion -ne 2) { throw 'Review smoke checkpoint did not transition to CANDIDATE at version 2.' }

        $reviewsUri = "http://127.0.0.1:{0}/v1/projects/{1}/reviews" -f $webPort, [Uri]::EscapeDataString([string]$project.id)
        $openReviewBody = @{
            subject_type = 'TIMELINE_REVISION'
            subject_revision_id = [string]$candidateRevision.id
            expected_version = [int]$candidateRevision.rowVersion
        } | ConvertTo-Json -Depth 10
        $openReviewHeaders = @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-review-open'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $openReviewEnvelope = Invoke-RestMethod -Uri $reviewsUri -Method Post -Headers $openReviewHeaders -ContentType 'application/json' -Body $openReviewBody -TimeoutSec 5
        $reviewRecord = $openReviewEnvelope.result.review
        if ($null -eq $reviewRecord -or [string]::IsNullOrWhiteSpace([string]$reviewRecord.id) -or [string]$reviewRecord.state -ne 'OPEN' -or [int]$reviewRecord.rowVersion -ne 1) { throw 'Review smoke OpenReview did not return an OPEN session at version 1.' }
        $openReviewReplay = Invoke-RestMethod -Uri $reviewsUri -Method Post -Headers $openReviewHeaders -ContentType 'application/json' -Body $openReviewBody -TimeoutSec 5
        $openReviewReplayFlag = Get-OptionalProperty $openReviewReplay 'idempotent_replay'
        if ($null -eq $openReviewReplayFlag) { $openReviewReplayFlag = Get-OptionalProperty $openReviewReplay.result 'idempotent_replay' }
        if (($null -ne $openReviewReplayFlag -and -not $openReviewReplayFlag) -or [string]$openReviewReplay.result.review.id -ne [string]$reviewRecord.id) { throw 'OpenReview retry was not an idempotent replay of the same session.' }

        $reviewId = [Uri]::EscapeDataString([string]$reviewRecord.id)
        $submitReviewUri = "$reviewsUri/$reviewId/submit"
        $submitReviewBody = @{ decision = 'APPROVE'; notes = 'Packaged metadata review passed.'; reason_codes = @('SMOKE_PASS'); expected_version = [int]$reviewRecord.rowVersion } | ConvertTo-Json -Depth 10
        $submitReviewHeaders = @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-review-submit'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $submittedReviewEnvelope = Invoke-RestMethod -Uri $submitReviewUri -Method Post -Headers $submitReviewHeaders -ContentType 'application/json' -Body $submitReviewBody -TimeoutSec 5
        $submittedReview = $submittedReviewEnvelope.result.review
        if ($null -eq $submittedReview -or [string]$submittedReview.state -ne 'SUBMITTED' -or [string]$submittedReview.humanReview.decision -ne 'APPROVE' -or [int]$submittedReview.rowVersion -ne 2 -or [string]$submittedReview.dependencySnapshotHash -notmatch '^[0-9a-fA-F]{64}$') { throw 'SubmitReview did not return a SUBMITTED APPROVE review at version 2 with an exact dependency snapshot hash.' }
        $submitReviewReplay = Invoke-RestMethod -Uri $submitReviewUri -Method Post -Headers $submitReviewHeaders -ContentType 'application/json' -Body $submitReviewBody -TimeoutSec 5
        $submitReviewReplayFlag = Get-OptionalProperty $submitReviewReplay 'idempotent_replay'
        if ($null -eq $submitReviewReplayFlag) { $submitReviewReplayFlag = Get-OptionalProperty $submitReviewReplay.result 'idempotent_replay' }
        if (($null -ne $submitReviewReplayFlag -and -not $submitReviewReplayFlag) -or [string]$submitReviewReplay.result.review.id -ne [string]$reviewRecord.id) { throw 'SubmitReview retry was not an idempotent replay of the same review.' }

        $approveTimeline = Invoke-RestMethod -Uri $candidateUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-review-approve'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ next_state = 'APPROVED'; expected_version = [int]$candidateRevision.rowVersion; review_session_id = [string]$reviewRecord.id; dependency_snapshot_hash = [string]$reviewRecord.dependencySnapshotHash } | ConvertTo-Json -Depth 10) -TimeoutSec 5
        $approvedTimelineResult = $approveTimeline.result
        $approvedTimelineRevision = Get-OptionalProperty $approvedTimelineResult 'currentRevision'
        if ($null -eq $approvedTimelineRevision) { $approvedTimelineRevision = Get-OptionalProperty $approvedTimelineResult 'revision' }
        if ($null -eq $approvedTimelineRevision -or [string]$approvedTimelineRevision.state -ne 'APPROVED' -or [int]$approvedTimelineRevision.rowVersion -ne 3) { throw 'Timeline did not become APPROVED through the submitted review gate.' }
        $reviewList = Invoke-RestMethod -Uri $reviewsUri -TimeoutSec 5
        if (@($reviewList.result.reviews | Where-Object { $_.id -eq $reviewRecord.id -and $_.state -eq 'SUBMITTED' -and $_.humanReview.decision -eq 'APPROVE' }).Count -ne 1) { throw 'Submitted APPROVE review was missing from the packaged project review list.' }
        $reviewDetail = Invoke-RestMethod -Uri "$reviewsUri/$reviewId" -TimeoutSec 5
        if ([string]$reviewDetail.result.review.state -ne 'SUBMITTED' -or [string]$reviewDetail.result.subject.state -ne 'APPROVED') { throw 'Packaged review detail did not reflect the approved timeline subject.' }

        # Exercise the Issue #29 metadata-first timing slice through the
        # packaged boundary. These records pin the exact approved timeline
        # revision/hash, require idempotency, reject unsafe rational ranges and
        # asset/rights gaps, and expose only redacted projections.
        $timingRevisionId = [string]$approvedTimelineRevision.id
        $timingContentHash = [string]$approvedTimelineRevision.editHash
        if ($timingContentHash -notmatch '^[0-9a-fA-F]{64}$') { throw 'Timing smoke did not receive an exact timeline content hash.' }
        $timingHeaders = @{ Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $audioCuesUri = "http://127.0.0.1:{0}/v1/projects/{1}/audio-cues" -f $webPort, [Uri]::EscapeDataString([string]$project.id)
        $audioBody = @{
            timeline_id = [string]$timelineRecord.id
            timing_dependency_revision_id = $timingRevisionId
            timing_dependency_content_hash = $timingContentHash
            cue_type = 'SILENCE'
            title = 'Packaged room tone gap'
            start = @{ num = 0; den = 1 }
            end = @{ num = 2; den = 1 }
            intent_text = 'Metadata-only smoke cue'
        } | ConvertTo-Json -Depth 10
        $audioHeaders = @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-audio-create'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $audioCreate = Invoke-RestMethod -Uri $audioCuesUri -Method Post -Headers $audioHeaders -ContentType 'application/json' -Body $audioBody -TimeoutSec 5
        $audioRecord = $audioCreate.result.audioCue
        $audioRevision = $audioCreate.result.revision
        if ($null -eq $audioRecord -or $null -eq $audioRevision -or [string]$audioRevision.state -ne 'DRAFT' -or [string]$audioRevision.timingDependencyRevisionId -ne $timingRevisionId -or [string]$audioRevision.timingDependencyContentHash -ne $timingContentHash) { throw 'Packaged audio timing creation did not preserve the exact timeline pin.' }
        if ($null -eq $audioRevision.assetGate -or [string]$audioRevision.assetGate.state -ne 'NOT_APPLICABLE') { throw 'Intentional SILENCE audio cue did not report a redacted NOT_APPLICABLE asset gate.' }
        $audioReplay = Invoke-RestMethod -Uri $audioCuesUri -Method Post -Headers $audioHeaders -ContentType 'application/json' -Body $audioBody -TimeoutSec 5
        $audioReplayFlag = Get-OptionalProperty $audioReplay 'idempotent_replay'
        if ($null -eq $audioReplayFlag) { $audioReplayFlag = Get-OptionalProperty $audioReplay.result 'idempotent_replay' }
        if (-not $audioReplayFlag -or [string]$audioReplay.result.revision.id -ne [string]$audioRevision.id) { throw 'Audio timing retry was not an idempotent replay.' }
        $audioInvalidStatus = 0
        $audioInvalidCode = ''
        try {
            Invoke-RestMethod -Uri $audioCuesUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-audio-invalid'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{
                timeline_id = [string]$timelineRecord.id
                timing_dependency_revision_id = $timingRevisionId
                timing_dependency_content_hash = $timingContentHash
                cue_type = 'SILENCE'
                start = @{ num = 23; den = 1 }
                end = @{ num = 25; den = 1 }
            } | ConvertTo-Json -Depth 10) -TimeoutSec 5 | Out-Null
        } catch { if ($null -ne $_.Exception.Response) { $audioInvalidStatus = [int]$_.Exception.Response.StatusCode; $audioInvalidCode = Get-HttpErrorCode $_ } }
        if ($audioInvalidStatus -ne 409 -or $audioInvalidCode -ne 'TIMING_OUT_OF_BOUNDS') { throw "Invalid audio timing was not rejected with HTTP 409/TIMING_OUT_OF_BOUNDS (actual: $audioInvalidStatus/$audioInvalidCode)." }
        $audioMissingAssetStatus = 0
        $audioMissingAssetCode = ''
        try {
            Invoke-RestMethod -Uri $audioCuesUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-audio-missing-asset'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{
                timeline_id = [string]$timelineRecord.id
                timing_dependency_revision_id = $timingRevisionId
                timing_dependency_content_hash = $timingContentHash
                cue_type = 'DIALOGUE'
                title = 'Missing asset must block'
                start = @{ num = 3; den = 1 }
                end = @{ num = 4; den = 1 }
            } | ConvertTo-Json -Depth 10) -TimeoutSec 5 | Out-Null
        } catch { if ($null -ne $_.Exception.Response) { $audioMissingAssetStatus = [int]$_.Exception.Response.StatusCode; $audioMissingAssetCode = Get-HttpErrorCode $_ } }
        if ($audioMissingAssetStatus -ne 409 -or $audioMissingAssetCode -ne 'AUDIO_ASSET_REQUIRED') { throw "Audio without an asset was not rejected with HTTP 409/AUDIO_ASSET_REQUIRED (actual: $audioMissingAssetStatus/$audioMissingAssetCode)." }

        $subtitleTracksUri = "http://127.0.0.1:{0}/v1/projects/{1}/subtitle-tracks" -f $webPort, [Uri]::EscapeDataString([string]$project.id)
        $overlapStatus = 0
        $overlapCode = ''
        try {
            Invoke-RestMethod -Uri $subtitleTracksUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-subtitle-overlap'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{
                timeline_id = [string]$timelineRecord.id
                timing_dependency_revision_id = $timingRevisionId
                timing_dependency_content_hash = $timingContentHash
                locale = 'vi-VN'
                title = 'Overlap must block'
                segments = @(
                    @{ start = @{ num = 1; den = 1 }; end = @{ num = 5; den = 1 }; text = 'Một' }
                    @{ start = @{ num = 4; den = 1 }; end = @{ num = 6; den = 1 }; text = 'Hai' }
                )
            } | ConvertTo-Json -Depth 10) -TimeoutSec 5 | Out-Null
        } catch { if ($null -ne $_.Exception.Response) { $overlapStatus = [int]$_.Exception.Response.StatusCode; $overlapCode = Get-HttpErrorCode $_ } }
        if ($overlapStatus -ne 409 -or $overlapCode -ne 'SUBTITLE_SEGMENT_OVERLAP') { throw "Overlapping subtitle segments were not rejected with HTTP 409/SUBTITLE_SEGMENT_OVERLAP (actual: $overlapStatus/$overlapCode)." }
        $subtitleHeaders = @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-subtitle-create'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $subtitleBody = @{
            timeline_id = [string]$timelineRecord.id
            timing_dependency_revision_id = $timingRevisionId
            timing_dependency_content_hash = $timingContentHash
            locale = 'vi-VN'
            title = 'Phụ đề smoke'
            segments = @(@{ start = @{ num = 7; den = 1 }; end = @{ num = 9; den = 1 }; text = 'Xin chào' })
        } | ConvertTo-Json -Depth 10
        $subtitleCreate = Invoke-RestMethod -Uri $subtitleTracksUri -Method Post -Headers $subtitleHeaders -ContentType 'application/json' -Body $subtitleBody -TimeoutSec 5
        $subtitleRevision = $subtitleCreate.result.revision
        if ($null -eq $subtitleRevision -or [string]$subtitleRevision.state -ne 'DRAFT' -or [string]$subtitleRevision.timingDependencyRevisionId -ne $timingRevisionId) { throw 'Packaged subtitle timing creation did not preserve the exact timeline pin.' }
        $subtitleReplay = Invoke-RestMethod -Uri $subtitleTracksUri -Method Post -Headers $subtitleHeaders -ContentType 'application/json' -Body $subtitleBody -TimeoutSec 5
        $subtitleReplayFlag = Get-OptionalProperty $subtitleReplay 'idempotent_replay'
        if ($null -eq $subtitleReplayFlag) { $subtitleReplayFlag = Get-OptionalProperty $subtitleReplay.result 'idempotent_replay' }
        if (-not $subtitleReplayFlag -or [string]$subtitleReplay.result.revision.id -ne [string]$subtitleRevision.id) { throw 'Subtitle timing retry was not an idempotent replay.' }
        $audioTimingUri = "http://127.0.0.1:{0}/v1/projects/{1}/timelines/{2}/revisions/{3}/audio-cues" -f $webPort, [Uri]::EscapeDataString([string]$project.id), [Uri]::EscapeDataString([string]$timelineRecord.id), [Uri]::EscapeDataString($timingRevisionId)
        $subtitleTimingUri = "http://127.0.0.1:{0}/v1/projects/{1}/timelines/{2}/revisions/{3}/subtitle-tracks?locale=vi-VN" -f $webPort, [Uri]::EscapeDataString([string]$project.id), [Uri]::EscapeDataString([string]$timelineRecord.id), [Uri]::EscapeDataString($timingRevisionId)
        $timingImpactUri = "http://127.0.0.1:{0}/v1/projects/{1}/timelines/{2}/revisions/{3}/timing-impact" -f $webPort, [Uri]::EscapeDataString([string]$project.id), [Uri]::EscapeDataString([string]$timelineRecord.id), [Uri]::EscapeDataString($timingRevisionId)
        $timingAudioRead = Invoke-RestMethod -Uri $audioTimingUri -TimeoutSec 5
        $timingSubtitleRead = Invoke-RestMethod -Uri $subtitleTimingUri -TimeoutSec 5
        $timingImpact = Invoke-RestMethod -Uri $timingImpactUri -TimeoutSec 5
        if (@($timingAudioRead.result.cues).Count -ne 1 -or @($timingSubtitleRead.result.tracks).Count -ne 1 -or [int]$timingImpact.result.counts.staleTotal -ne 0) { throw 'Fresh packaged timing projections did not return the created metadata.' }
        $timingPayload = ($timingAudioRead | ConvertTo-Json -Depth 30 -Compress) + ($timingSubtitleRead | ConvertTo-Json -Depth 30 -Compress) + ($timingImpact | ConvertTo-Json -Depth 30 -Compress)
        if ($timingPayload.Contains($dataRoot) -or $timingPayload -match '(?i)(provider_path|storage_uri|local_path|credentials|media_bytes)') { throw 'Packaged timing projections leaked paths, provider fields, credentials or media bytes.' }

        # Exercise the bounded, local timeline working-session editor through
        # the same packaged HTTP boundary.  The session is pinned to the exact
        # approved revision/hash and every edit is versioned, idempotent and
        # durable before the immutable checkpoint is created.
        $approvedWorkspace = Invoke-RestMethod -Uri ("{0}/{1}/workspace" -f $timelineUri, $timelineId) -TimeoutSec 5
        $workingTimeline = $approvedWorkspace.result.timeline
        $workingBase = $approvedWorkspace.result.currentRevision
        if ($null -eq $workingBase -or [string]$workingBase.state -ne 'APPROVED' -or [string]$workingBase.editHash -notmatch '^[0-9a-fA-F]{64}$') { throw 'Working-session smoke could not recover the exact approved base revision/hash.' }
        $workingSessionsUri = "{0}/{1}/working-sessions" -f $timelineUri, $timelineId
        $workingBeginHeaders = @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-working-begin'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $workingBeginBody = @{
            base_revision_id = [string]$workingBase.id
            base_revision_row_version = [int]$workingBase.rowVersion
            base_content_hash = [string]$workingBase.editHash
            client_instance_id = 'packaging-smoke-client'
            expected_timeline_version = [int]$workingTimeline.rowVersion
        } | ConvertTo-Json -Depth 10
        $workingBegin = Invoke-RestMethod -Uri $workingSessionsUri -Method Post -Headers $workingBeginHeaders -ContentType 'application/json' -Body $workingBeginBody -TimeoutSec 5
        $workingSession = $workingBegin.result.session
        if ($null -eq $workingSession -or [string]$workingSession.state -ne 'OPEN' -or [int]$workingSession.rowVersion -ne 1 -or [string]$workingSession.baseContentHash -ne [string]$workingBase.editHash) { throw 'Working-session begin did not bind the exact approved base evidence.' }
        $workingSessionUri = "$workingSessionsUri/$([Uri]::EscapeDataString([string]$workingSession.id))"
        $workingOpsUri = "$workingSessionUri/ops"
        $workingOpHeaders = @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-working-op'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $workingOpBody = @{
            operations = @(@{ op_type = 'ADD_MARKER'; payload = @{ id = 'packaged-marker-1'; time = @{ num = 1; den = 1 }; marker_type = 'NOTE'; label = 'Packaged smoke'; payload = @{} } })
            client_instance_id = 'packaging-smoke-client'
            expected_version = [int]$workingSession.rowVersion
        } | ConvertTo-Json -Depth 20
        $workingApplied = Invoke-RestMethod -Uri $workingOpsUri -Method Post -Headers $workingOpHeaders -ContentType 'application/json' -Body $workingOpBody -TimeoutSec 5
        $workingSession = $workingApplied.result.session
        if ([string]$workingSession.state -ne 'DIRTY' -or [int]$workingSession.lastAcknowledgedOpSeq -ne 1 -or [string]$workingSession.draftHash -notmatch '^[0-9a-fA-F]{64}$') { throw 'Working-session edit did not return a dirty, hashed draft acknowledgement.' }
        $workingReplay = Invoke-RestMethod -Uri $workingOpsUri -Method Post -Headers $workingOpHeaders -ContentType 'application/json' -Body $workingOpBody -TimeoutSec 5
        $workingReplayFlag = Get-OptionalProperty $workingReplay 'idempotent_replay'
        if ($null -eq $workingReplayFlag) { $workingReplayFlag = Get-OptionalProperty $workingReplay.result 'idempotent_replay' }
        if (-not $workingReplayFlag) { throw 'Working-session operation retry was not an idempotent replay.' }
        $workingStaleStatus = 0
        try {
            Invoke-RestMethod -Uri $workingOpsUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-working-stale'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ operations = @(@{ op_type = 'ADD_MARKER'; payload = @{ id = 'packaged-marker-stale'; time = @{ num = 2; den = 1 }; marker_type = 'NOTE'; label = 'stale'; payload = @{} } }); client_instance_id = 'packaging-smoke-client'; expected_version = 1 } | ConvertTo-Json -Depth 20) -TimeoutSec 5 | Out-Null
        } catch { if ($null -ne $_.Exception.Response) { $workingStaleStatus = [int]$_.Exception.Response.StatusCode } }
        if ($workingStaleStatus -ne 409) { throw "Stale working-session edit was not rejected with HTTP 409 (actual: $workingStaleStatus)." }
        $workingUndo = Invoke-RestMethod -Uri "$workingSessionUri/undo" -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-working-undo'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ client_instance_id = 'packaging-smoke-client'; expected_version = [int]$workingSession.rowVersion } | ConvertTo-Json) -TimeoutSec 5
        $workingSession = $workingUndo.result.session
        if ([string]$workingSession.state -ne 'CLEAN' -or $null -eq $workingUndo.result.undoneOperation -or [int]$workingUndo.result.undoneOperation.opSeq -ne 1) { throw 'Working-session undo did not restore the exact clean base projection.' }
        $workingRedo = Invoke-RestMethod -Uri "$workingSessionUri/redo" -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-working-redo'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ client_instance_id = 'packaging-smoke-client'; expected_version = [int]$workingSession.rowVersion } | ConvertTo-Json) -TimeoutSec 5
        $workingSession = $workingRedo.result.session
        if ([string]$workingSession.state -ne 'DIRTY' -or $null -eq $workingRedo.result.redoneOperation -or [int]$workingRedo.result.redoneOperation.opSeq -ne 1) { throw 'Working-session redo did not restore the exact edited draft projection.' }
        $workingAutosave = Invoke-RestMethod -Uri "$workingSessionUri/autosave" -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-working-autosave'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ client_instance_id = 'packaging-smoke-client'; expected_version = [int]$workingSession.rowVersion } | ConvertTo-Json) -TimeoutSec 5
        $workingSession = $workingAutosave.result.session
        if ([string]$workingSession.state -ne 'CLEAN' -or [string]$workingSession.autosavedHash -ne [string]$workingSession.draftHash) { throw 'Working-session autosave did not durably acknowledge the exact draft hash.' }
        $workingCheckpoint = Invoke-RestMethod -Uri "$workingSessionUri/checkpoint" -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-working-checkpoint'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ client_instance_id = 'packaging-smoke-client'; expected_version = [int]$workingSession.rowVersion; expected_timeline_version = [int]$workingTimeline.rowVersion } | ConvertTo-Json) -TimeoutSec 5
        $workingCheckpointRevision = $workingCheckpoint.result.checkpointRevision
        $workingSession = $workingCheckpoint.result.session
        if ($null -eq $workingCheckpointRevision -or [string]$workingCheckpointRevision.state -ne 'DRAFT_CHECKPOINT' -or [string]$workingCheckpointRevision.editHash -ne [string]$workingSession.draftHash) { throw 'Working-session checkpoint did not create an exact immutable DRAFT_CHECKPOINT.' }
        $staleTimingAudio = Invoke-RestMethod -Uri $audioTimingUri -TimeoutSec 5
        $staleTimingImpact = Invoke-RestMethod -Uri $timingImpactUri -TimeoutSec 5
        if ([string]$staleTimingAudio.result.cues[0].revision.state -ne 'STALE' -or [string]$staleTimingAudio.result.cues[0].revision.staleReason -ne 'TIMELINE_REVISION_CHANGED') { throw 'A packaged timeline checkpoint did not project the old audio timing revision as STALE.' }
        if ([int]$staleTimingImpact.result.counts.staleTotal -lt 2) { throw 'Packaged timing impact did not count both stale audio and subtitle revisions after a checkpoint.' }
        $staleTimingPayload = ($staleTimingAudio | ConvertTo-Json -Depth 30 -Compress) + ($staleTimingImpact | ConvertTo-Json -Depth 30 -Compress)
        if ($staleTimingPayload.Contains($dataRoot) -or $staleTimingPayload -match '(?i)(provider_path|storage_uri|local_path|credentials|media_bytes)') { throw 'Stale packaged timing projections leaked paths, provider fields, credentials or media bytes.' }
        $workingOp2Body = @{ operations = @(@{ op_type = 'ADD_MARKER'; payload = @{ id = 'packaged-marker-2'; time = @{ num = 2; den = 1 }; marker_type = 'NOTE'; label = 'Close test'; payload = @{} } }); client_instance_id = 'packaging-smoke-client'; expected_version = [int]$workingSession.rowVersion } | ConvertTo-Json -Depth 20
        $workingOp2 = Invoke-RestMethod -Uri $workingOpsUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-working-op-2'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body $workingOp2Body -TimeoutSec 5
        $workingSession = $workingOp2.result.session
        $workingClosed = Invoke-RestMethod -Uri "$workingSessionUri/close" -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-working-abandon'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ disposition = 'ABANDON'; client_instance_id = 'packaging-smoke-client'; expected_version = [int]$workingSession.rowVersion } | ConvertTo-Json) -TimeoutSec 5
        if ([string]$workingClosed.result.session.state -ne 'ABANDONED') { throw 'Working-session ABANDON close did not preserve a terminal durable draft.' }
        $workingDetail = Invoke-RestMethod -Uri $workingSessionUri -TimeoutSec 5
        $workingHistoryActions = @($workingDetail.result.session.historyActions)
        if ([string]$workingDetail.result.session.state -ne 'ABANDONED' -or @($workingHistoryActions | Where-Object { $_.actionType -eq 'UNDO' }).Count -lt 1 -or @($workingHistoryActions | Where-Object { $_.actionType -eq 'REDO' }).Count -lt 1) { throw 'Working-session detail did not preserve the terminal audit projection.' }

        # Handoff is a metadata-only, immutable boundary. It must bind the
        # exact approved revision/review/snapshot, remain conservative for an
        # unknown editor target, and be safe to replay with the same command
        # key without leaking paths or media bytes.
        $handoffUri = "http://127.0.0.1:{0}/v1/projects/{1}/handoffs" -f $webPort, [Uri]::EscapeDataString([string]$project.id)
        $handoffBody = @{
            timeline_revision_id = [string]$approvedTimelineRevision.id
            review_session_id = [string]$reviewRecord.id
            dependency_snapshot_hash = [string]$reviewRecord.dependencySnapshotHash
            target_editor = 'UNKNOWN_EDITOR'
            target_version = '1'
            target_profile = 'GENERIC_INTERCHANGE'
            expected_version = [int]$approvedTimelineRevision.rowVersion
        } | ConvertTo-Json -Depth 10
        $handoffHeaders = @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-handoff'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $handoffEnvelope = Invoke-RestMethod -Uri $handoffUri -Method Post -Headers $handoffHeaders -ContentType 'application/json' -Body $handoffBody -TimeoutSec 5
        $handoffResult = $handoffEnvelope.result
        $handoffSession = Get-OptionalProperty $handoffResult 'exportSession'
        if ($null -eq $handoffSession) { $handoffSession = Get-OptionalProperty $handoffResult 'export_session' }
        $handoffManifest = Get-OptionalProperty $handoffResult 'handoffManifest'
        if ($null -eq $handoffManifest) { $handoffManifest = Get-OptionalProperty $handoffResult 'handoff_manifest' }
        if ($null -eq $handoffSession -or [string]::IsNullOrWhiteSpace([string]$handoffSession.id) -or [string]$handoffSession.state -ne 'PREFLIGHT') { throw 'Packaged handoff creation did not return a PREFLIGHT export session.' }
        $handoffManifestHash = Get-OptionalProperty $handoffManifest 'manifestHash'
        if ($null -eq $handoffManifestHash) { $handoffManifestHash = Get-OptionalProperty $handoffManifest 'manifest_hash' }
        $handoffTargetEditor = Get-OptionalProperty $handoffManifest 'targetEditor'
        if ($null -eq $handoffTargetEditor) { $handoffTargetEditor = Get-OptionalProperty $handoffManifest 'target_editor' }
        $handoffTargetVersion = Get-OptionalProperty $handoffManifest 'targetVersion'
        if ($null -eq $handoffTargetVersion) { $handoffTargetVersion = Get-OptionalProperty $handoffManifest 'target_version' }
        if ($null -eq $handoffManifest -or [string]$handoffManifestHash -notmatch '^[0-9a-fA-F]{64}$') { throw 'Packaged handoff did not return an exact manifest SHA-256.' }
        if ([string]$handoffTargetEditor -ne 'UNKNOWN_EDITOR' -or [string]$handoffTargetVersion -ne '1') { throw 'Packaged handoff target metadata did not persist.' }
        $handoffCompatibility = Get-OptionalProperty $handoffManifest 'compatibility'
        if ($null -eq $handoffCompatibility) { $handoffCompatibility = Get-OptionalProperty $handoffManifest 'compatibilityReport' }
        $handoffSanitization = Get-OptionalProperty $handoffManifest 'sanitizationReport'
        if ($null -eq $handoffSanitization) { $handoffSanitization = Get-OptionalProperty $handoffManifest 'sanitization' }
        if ([bool](Get-OptionalProperty $handoffCompatibility 'editableClaim')) { throw 'Unknown handoff target incorrectly claimed editable output.' }
        if (@((Get-OptionalProperty $handoffCompatibility 'entries') | Where-Object { $_.status -eq 'UNKNOWN' -or $_.status -eq 'UNSUPPORTED' }).Count -eq 0) { throw 'Unknown handoff target did not report conservative compatibility.' }
        if (@((Get-OptionalProperty $handoffSanitization 'removedFields') | Where-Object { $_ -eq 'absolute_local_paths' -or $_ -eq 'credentials_and_secrets' }).Count -lt 2) { throw 'Handoff sanitization report did not record path and credential removal.' }
        $handoffReplay = Invoke-RestMethod -Uri $handoffUri -Method Post -Headers $handoffHeaders -ContentType 'application/json' -Body $handoffBody -TimeoutSec 5
        $handoffReplayManifest = Get-OptionalProperty $handoffReplay.result 'handoffManifest'
        if ($null -eq $handoffReplayManifest) { $handoffReplayManifest = Get-OptionalProperty $handoffReplay.result 'handoff_manifest' }
        $handoffReplayHash = Get-OptionalProperty $handoffReplay.result 'manifestHash'
        if ($null -eq $handoffReplayHash) { $handoffReplayHash = Get-OptionalProperty $handoffReplay.result 'manifest_hash' }
        if ([string]$handoffReplayManifest.id -ne [string]$handoffManifest.id -or [string]$handoffReplayHash -ne [string]$handoffManifestHash) { throw 'Handoff retry returned a different immutable manifest.' }
        $handoffList = Invoke-RestMethod -Uri $handoffUri -TimeoutSec 5
        if (@($handoffList.result.items | Where-Object { $_.exportSession.id -eq $handoffSession.id -and $_.handoffManifest.manifestHash -eq $handoffManifestHash }).Count -ne 1) { throw 'Packaged handoff list did not expose the created manifest.' }
        $handoffDetail = Invoke-RestMethod -Uri "$handoffUri/$([Uri]::EscapeDataString([string]$handoffSession.id))" -TimeoutSec 5
        if ([string]$handoffDetail.result.exportSession.timelineRevisionId -ne [string]$approvedTimelineRevision.id -or [string]$handoffDetail.result.handoffManifest.manifestHash -ne [string]$handoffManifestHash) { throw 'Packaged handoff detail did not preserve exact revision/hash evidence.' }
        $handoffJson = $handoffDetail | ConvertTo-Json -Depth 30
        if ($handoffJson.Contains($dataRoot) -or $handoffJson -match '(?i)"(provider_path|storage_uri|local_path|credentials|prompt_payload|media_bytes)"\s*:') { throw 'Packaged handoff response leaked paths, credentials, prompts, or media bytes.' }

        # Build the bounded local timeline-interchange artifact. This is a
        # deterministic JSON/CAS evidence boundary, not a render, technical
        # master, release or publish operation.
        $exportUri = "http://127.0.0.1:{0}/v1/projects/{1}/exports/{2}" -f $webPort, [Uri]::EscapeDataString([string]$project.id), [Uri]::EscapeDataString([string]$handoffSession.id)
        $buildHeaders = @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-interchange-build'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $buildBody = @{ dependency_snapshot_hash = [string]$handoffSession.dependencySnapshotHash; expected_version = [int]$handoffSession.rowVersion } | ConvertTo-Json -Depth 10
        $buildEnvelope = Invoke-RestMethod -Uri "$exportUri/build" -Method Post -Headers $buildHeaders -ContentType 'application/json' -Body $buildBody -TimeoutSec 10
        $buildResult = $buildEnvelope.result
        $builtSession = Get-OptionalProperty $buildResult 'exportSession'
        if ($null -eq $builtSession) { $builtSession = Get-OptionalProperty $buildResult 'export_session' }
        $builtHash = Get-OptionalProperty $buildResult 'outputContentHash'
        if ($null -eq $builtHash) { $builtHash = Get-OptionalProperty $buildResult 'output_content_hash' }
        $builtSize = Get-OptionalProperty $buildResult 'outputByteSize'
        if ($null -eq $builtSize) { $builtSize = Get-OptionalProperty $buildResult 'output_byte_size' }
        $builtAssetRevision = Get-OptionalProperty $buildResult 'assetRevisionId'
        if ($null -eq $builtAssetRevision) { $builtAssetRevision = Get-OptionalProperty $buildResult 'asset_revision_id' }
        if ($null -eq $builtSession -or [string]$builtSession.state -ne 'COMPLETED' -or [string]$builtSession.outputAssetRevisionId -ne [string]$builtAssetRevision) { throw 'Packaged interchange build did not reach COMPLETED with an output asset revision.' }
        if ([string]$builtHash -notmatch '^[0-9a-fA-F]{64}$' -or [int64]$builtSize -le 0) { throw 'Packaged interchange build returned invalid digest/size evidence.' }
        $buildReplay = Invoke-RestMethod -Uri "$exportUri/build" -Method Post -Headers $buildHeaders -ContentType 'application/json' -Body $buildBody -TimeoutSec 10
        $buildReplaySession = Get-OptionalProperty $buildReplay.result 'exportSession'
        if ($null -eq $buildReplaySession) { $buildReplaySession = Get-OptionalProperty $buildReplay.result 'export_session' }
        if ([string]$buildReplaySession.id -ne [string]$builtSession.id -or [string]$buildReplaySession.state -ne 'COMPLETED') { throw 'Packaged interchange retry did not replay the completed session.' }
        $exportList = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/v1/projects/{1}/exports" -f $webPort, [Uri]::EscapeDataString([string]$project.id)) -TimeoutSec 5
        if (@($exportList.result.items | Where-Object { $_.id -eq $handoffSession.id -and $_.state -eq 'COMPLETED' -and $_.outputContentHash -eq $builtHash }).Count -ne 1) { throw 'Packaged export list did not expose the verified interchange binding.' }
        $downloadHeaders = @{ 'x-cineforge-session' = 'packaging-interchange-ui'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $downloadCapability = Invoke-RestMethod -Uri "$exportUri/download" -Headers $downloadHeaders -TimeoutSec 5
        $downloadUrl = [string](Get-OptionalProperty $downloadCapability.result 'download_url')
        if ([string]::IsNullOrWhiteSpace($downloadUrl) -or $downloadCapability.result.PSObject.Properties.Name -contains 'token') { throw 'Packaged interchange download capability leaked a token or omitted the bounded URL.' }
        $downloadFile = Join-Path $dataRoot 'packaged-interchange.json'
        Invoke-WebRequest -Uri ("http://127.0.0.1:{0}{1}" -f $webPort, $downloadUrl) -Headers $downloadHeaders -OutFile $downloadFile -TimeoutSec 10
        $downloadHash = (Get-FileHash -LiteralPath $downloadFile -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($downloadHash -ne ([string]$builtHash).ToLowerInvariant() -or (Get-Item -LiteralPath $downloadFile).Length -ne [int64]$builtSize) { throw 'Packaged interchange download failed the exact hash/size check.' }
        $downloadDocument = Get-Content -LiteralPath $downloadFile -Raw | ConvertFrom-Json
        if ([string]$downloadDocument.manifest_type -ne 'CINEFORGE_TIMELINE_INTERCHANGE' -or [int]$downloadDocument.manifest_schema_version -ne 1) { throw 'Packaged interchange JSON did not return the canonical document schema.' }

        # Exercise the user-facing asset path through the packaged bootstrap.
        # The source is deliberately created inside the temporary data root so
        # this test also proves that COPY materializes bytes into the managed
        # content-addressed store instead of only recording an external path.
        $assetSource = Join-Path $dataRoot 'packaged-smoke-asset.txt'
        [IO.File]::WriteAllText($assetSource, 'CineForge packaged asset smoke', [Text.UTF8Encoding]::new($false))
        $assetUri = "http://127.0.0.1:{0}/v1/projects/{1}/assets" -f $webPort, [Uri]::EscapeDataString([string]$project.id)
        $asset = Invoke-RestMethod -Uri $assetUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-asset'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{
            source_path = $assetSource
            asset_type = 'DOCUMENT'
            semantic_role = 'SOURCE_REFERENCE'
            storage_mode = 'COPY'
            mime_type = 'image/png'
        } | ConvertTo-Json) -TimeoutSec 5
        if ([string]::IsNullOrWhiteSpace([string]$asset.id)) { throw 'Core asset import returned no asset id.' }
        if ([string]$asset.availability -ne 'AVAILABLE') { throw "Packaged asset import was not AVAILABLE: $($asset.availability)" }
        if ([string]$asset.readinessState -ne 'UNKNOWN') { throw "Packaged asset readiness was not UNKNOWN before verifier evidence: $($asset.readinessState)" }
        if ([string]$asset.contentHash -notmatch '^[0-9a-fA-F]{64}$') { throw 'Packaged asset import returned an invalid SHA-256 hash.' }
        if ([string]$asset.storageUri -notmatch '^object://sha-256/') { throw 'Packaged asset import did not return a managed object URI.' }
        if ([string]::IsNullOrWhiteSpace([string]$asset.importSessionId)) { throw 'Packaged asset import returned no import session id.' }
        if ([string]$asset.rights.status -ne 'UNKNOWN' -or [string]::IsNullOrWhiteSpace([string]$asset.rights.rights_identity_id)) { throw 'Packaged asset import did not create an UNKNOWN rights identity projection.' }
        $rightsIdentityId = [string]$asset.rights.rights_identity_id
        $rightsRecordHeaders = @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-rights-record'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $rightsRecord = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/commands" -Method Post -Headers $rightsRecordHeaders -ContentType 'application/json' -Body (@{
            command_type = 'CreateRightsRecord'
            payload = @{
                rights_identity_id = $rightsIdentityId
                right_type = 'SOURCE_USE'
                status = 'ALLOWED'
                territory = @('VN')
                purpose = @{ allowed = @('PRODUCTION', 'MEDIA_PREVIEW') }
            }
        } | ConvertTo-Json -Depth 10) -TimeoutSec 5
        if (-not $rightsRecord.ok -or [string]$rightsRecord.result.record.status -ne 'ALLOWED') { throw 'Packaged rights record command returned an invalid record.' }
        $rightsUnknown = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/v1/assets/{1}/rights?territory=VN" -f $webPort, [Uri]::EscapeDataString([string]$asset.id)) -TimeoutSec 5
        if ([string]$rightsUnknown.result.status -ne 'UNKNOWN') { throw 'Rights evaluation did not remain UNKNOWN before consent.' }
        $rightsConsent = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/commands" -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-rights-consent'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{
            command_type = 'RecordConsent'
            payload = @{ rights_identity_id = $rightsIdentityId; consent_type = 'SOURCE_USE'; granted_by = 'packaging-smoke'; evidence_asset_revision_id = [string]$asset.revisionId }
        } | ConvertTo-Json -Depth 10) -TimeoutSec 5
        if (-not $rightsConsent.ok) { throw 'Packaged consent command failed.' }
        $rightsAllowed = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/v1/assets/{1}/rights?territory=VN" -f $webPort, [Uri]::EscapeDataString([string]$asset.id)) -TimeoutSec 5
        if ([string]$rightsAllowed.result.status -ne 'ALLOWED' -or -not $rightsAllowed.result.eligible) { throw 'Packaged rights evaluation did not become ALLOWED after consent.' }

        # Register the verified interchange as a returned external-edit
        # artifact through the same one-click boundary. This proves that a
        # returned managed asset is bound to the exact completed export and
        # remains a lineage record; registration must never mutate the
        # canonical timeline.
        $returnedAsset = Invoke-RestMethod -Uri $assetUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-returned-interchange'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{
            source_path = $downloadFile
            asset_type = 'TIMELINE_INTERCHANGE'
            origin_type = 'EXTERNAL_EDIT'
            semantic_role = 'TIMELINE_INTERCHANGE'
            storage_mode = 'COPY'
            display_name = 'Packaged returned interchange'
            mime_type = 'application/json'
        } | ConvertTo-Json) -TimeoutSec 5
        if ([string]$returnedAsset.assetType -ne 'TIMELINE_INTERCHANGE' -or [string]$returnedAsset.originType -ne 'EXTERNAL_EDIT' -or [string]::IsNullOrWhiteSpace([string]$returnedAsset.revisionId)) { throw 'Packaged returned interchange import did not preserve the bounded asset contract.' }
        $returnedRightsIdentity = [string]$returnedAsset.rights.rights_identity_id
        if ([string]::IsNullOrWhiteSpace($returnedRightsIdentity)) { throw 'Packaged returned interchange import returned no rights identity.' }
        $returnedRights = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/commands" -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-returned-rights'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{
            command_type = 'CreateRightsRecord'
            payload = @{ rights_identity_id = $returnedRightsIdentity; right_type = 'SOURCE_USE'; status = 'ALLOWED'; purpose = @{ allowed = @('EXTERNAL_EDIT_REGISTRATION') } }
        } | ConvertTo-Json -Depth 10) -TimeoutSec 5
        if (-not $returnedRights.ok -or [string]$returnedRights.result.record.status -ne 'ALLOWED') { throw 'Packaged returned interchange rights record failed.' }
        $returnedConsent = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/commands" -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-returned-consent'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{
            command_type = 'RecordConsent'
            payload = @{ rights_identity_id = $returnedRightsIdentity; consent_type = 'SOURCE_USE'; granted_by = 'packaging-smoke'; evidence_asset_revision_id = [string]$returnedAsset.revisionId }
        } | ConvertTo-Json -Depth 10) -TimeoutSec 5
        if (-not $returnedConsent.ok) { throw 'Packaged returned interchange consent failed.' }
        $externalEditUri = "http://127.0.0.1:{0}/v1/projects/{1}/external-edits" -f $webPort, [Uri]::EscapeDataString([string]$project.id)
        $externalEditHeaders = @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-external-edit'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $externalEditBody = @{ handoff_manifest_id = [string]$handoffManifest.id; export_session_id = [string]$handoffSession.id; returned_asset_revision_id = [string]$returnedAsset.revisionId; expected_version = [int]$builtSession.rowVersion } | ConvertTo-Json -Depth 10
        $externalEditEnvelope = Invoke-RestMethod -Uri $externalEditUri -Method Post -Headers $externalEditHeaders -ContentType 'application/json' -Body $externalEditBody -TimeoutSec 10
        $externalEdit = Get-OptionalProperty $externalEditEnvelope.result 'externalEdit'
        if ($null -eq $externalEdit) { $externalEdit = Get-OptionalProperty $externalEditEnvelope.result 'external_edit' }
        if ($null -eq $externalEdit -or [string]$externalEdit.validationState -ne 'REGISTERED' -or [string]$externalEdit.lineageConfidence -ne 'EXACT') { throw 'Packaged returned interchange registration did not produce exact registered lineage.' }
        $externalEditReplay = Invoke-RestMethod -Uri $externalEditUri -Method Post -Headers $externalEditHeaders -ContentType 'application/json' -Body $externalEditBody -TimeoutSec 10
        $externalEditReplayRecord = Get-OptionalProperty $externalEditReplay.result 'externalEdit'
        if ($null -eq $externalEditReplayRecord) { $externalEditReplayRecord = Get-OptionalProperty $externalEditReplay.result 'external_edit' }
        if ([string]$externalEditReplayRecord.id -ne [string]$externalEdit.id) { throw 'Returned interchange registration retry returned a different lineage record.' }
        $externalEditList = Invoke-RestMethod -Uri "${externalEditUri}?validation_state=REGISTERED" -TimeoutSec 5
        if (@($externalEditList.result.items | Where-Object { $_.id -eq $externalEdit.id -and $_.returnedAssetRevisionId -eq $returnedAsset.revisionId }).Count -ne 1) { throw 'Packaged returned interchange list did not expose the registered lineage.' }
        $externalEditDetail = Invoke-RestMethod -Uri "$externalEditUri/$([Uri]::EscapeDataString([string]$externalEdit.id))" -TimeoutSec 5
        if ([string]$externalEditDetail.result.externalEdit.handoffManifestId -ne [string]$handoffManifest.id -or [string]$externalEditDetail.result.externalEdit.returnedRightsStatus -ne 'ALLOWED') { throw 'Packaged returned interchange detail lost exact scope or rights evidence.' }

        # Preview is a scoped inspection capability, not a filesystem proxy.
        # Resolve through the same bootstrap origin, then verify HEAD/range
        # streaming and the absence of local paths or opaque bytes in JSON.
        $previewUri = "http://127.0.0.1:{0}/v1/projects/{1}/assets/{2}/preview?purpose=LIBRARY_PREVIEW" -f $webPort, [Uri]::EscapeDataString([string]$project.id), [Uri]::EscapeDataString([string]$asset.revisionId)
        $previewResolved = Invoke-RestMethod -Uri $previewUri -Headers $browserHeaders -TimeoutSec 5
        $previewResult = $previewResolved.result
        if ($null -eq $previewResult -or [string]::IsNullOrWhiteSpace([string]$previewResult.preview_url) -or [string]$previewResult.mime_type -ne 'image/png') { throw 'Packaged media preview did not return an image capability.' }
        $previewJson = $previewResolved | ConvertTo-Json -Depth 20 -Compress
        if ($previewJson.Contains($dataRoot) -or $previewJson -match '(?i)(file://|provider_path|local_path|media_bytes|<script)') { throw 'Packaged preview capability leaked a path, provider field, or media bytes.' }
        $previewUrl = "http://127.0.0.1:$webPort$([string]$previewResult.preview_url)"
        # Windows PowerShell reserves Invoke-WebRequest's Range header for its
        # file-transfer switches. Use the framework client so the smoke test
        # exercises the actual HTTP byte-range contract on both PS editions.
        $previewClient = [System.Net.Http.HttpClient]::new()
        try {
            $previewRangeRequest = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $previewUrl)
            $previewRangeRequest.Headers.Range = [System.Net.Http.Headers.RangeHeaderValue]::Parse('bytes=0-3')
            $previewRangeResponse = $previewClient.SendAsync($previewRangeRequest).GetAwaiter().GetResult()
            $previewRangeHeader = [string]$previewRangeResponse.Content.Headers.ContentRange
            $previewNoSniff = if ($previewRangeResponse.Headers.Contains('X-Content-Type-Options')) { [string]($previewRangeResponse.Headers.GetValues('X-Content-Type-Options') -join ',') } else { '' }
            $previewRangeBytes = $previewRangeResponse.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
            if ([int]$previewRangeResponse.StatusCode -ne 206 -or $previewRangeHeader -notmatch '^bytes 0-3/') { throw 'Packaged preview did not return a bounded 206 range.' }
            if ($previewNoSniff -ne 'nosniff' -or $previewRangeBytes.Length -ne 4) { throw 'Packaged preview omitted nosniff or returned an incorrect range length.' }
            $previewHeadRequest = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Head, $previewUrl)
            $previewHeadResponse = $previewClient.SendAsync($previewHeadRequest).GetAwaiter().GetResult()
            if ([int]$previewHeadResponse.StatusCode -ne 200 -or [int64]$previewHeadResponse.Content.Headers.ContentLength -le 0) { throw 'Packaged preview HEAD did not return the stream length.' }
            $previewBadRangeRequest = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $previewUrl)
            $previewBadRangeRequest.Headers.Range = [System.Net.Http.Headers.RangeHeaderValue]::Parse('bytes=999999-1000000')
            $previewBadRangeResponse = $previewClient.SendAsync($previewBadRangeRequest).GetAwaiter().GetResult()
            if ([int]$previewBadRangeResponse.StatusCode -ne 416) { throw "Packaged preview invalid range was not rejected with HTTP 416 (actual: $([int]$previewBadRangeResponse.StatusCode))." }
            $previewRangeResponse.Dispose(); $previewHeadResponse.Dispose(); $previewBadRangeResponse.Dispose()
            $previewRangeRequest.Dispose(); $previewHeadRequest.Dispose(); $previewBadRangeRequest.Dispose()
        }
        finally { $previewClient.Dispose() }
        $rightsConsentReplay = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/commands" -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-rights-consent'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{
            command_type = 'RecordConsent'
            payload = @{ rights_identity_id = $rightsIdentityId; consent_type = 'SOURCE_USE'; granted_by = 'packaging-smoke'; evidence_asset_revision_id = [string]$asset.revisionId }
        } | ConvertTo-Json -Depth 10) -TimeoutSec 5
        $rightsConsentReplayFlag = Get-OptionalProperty $rightsConsentReplay 'idempotent_replay'
        if ($null -eq $rightsConsentReplayFlag) { $rightsConsentReplayFlag = Get-OptionalProperty $rightsConsentReplay.result 'idempotent_replay' }
        if (-not $rightsConsentReplayFlag) { throw 'Packaged consent retry was not an idempotent replay.' }
        $rightsRestricted = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/v1/assets/{1}/rights?territory=US" -f $webPort, [Uri]::EscapeDataString([string]$asset.id)) -TimeoutSec 5
        if ([string]$rightsRestricted.result.status -ne 'RESTRICTED' -or $rightsRestricted.result.eligible) { throw 'Packaged territory restriction did not fail closed.' }
        $expiredNowUs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() * 1000
        $expiredAtUs = $expiredNowUs - 2000000
        $expiredIdentity = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/commands" -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-rights-expired-identity'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{
            command_type = 'CreateRightsIdentity'
            payload = @{ project_id = [string]$project.id; subject_type = 'PERSON'; subject_id = 'packaging-expired-person' }
        } | ConvertTo-Json -Depth 10) -TimeoutSec 5
        $expiredIdentityId = [string]$expiredIdentity.result.id
        if ([string]::IsNullOrWhiteSpace($expiredIdentityId)) { throw 'Packaged expired rights identity command returned no identity id.' }
        $expiredRecord = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/commands" -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-rights-expired-record'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{
            command_type = 'CreateRightsRecord'
            payload = @{ rights_identity_id = $expiredIdentityId; right_type = 'SOURCE_USE'; status = 'ALLOWED'; valid_from_utc_us = ($expiredAtUs - 1000000); valid_to_utc_us = $expiredAtUs }
        } | ConvertTo-Json -Depth 10) -TimeoutSec 5
        if (-not $expiredRecord.ok) { throw 'Packaged expired rights record command failed.' }
        $expiredConsent = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/commands" -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-rights-expired-consent'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{
            command_type = 'RecordConsent'
            payload = @{ rights_identity_id = $expiredIdentityId; consent_type = 'SOURCE_USE'; granted_by = 'packaging-smoke'; valid_from_utc_us = ($expiredAtUs - 1000000); valid_to_utc_us = $expiredAtUs }
        } | ConvertTo-Json -Depth 10) -TimeoutSec 5
        if (-not $expiredConsent.ok) { throw 'Packaged expired consent command failed.' }
        $rightsExpired = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/v1/rights/evaluate?rights_identity_id={1}" -f $webPort, [Uri]::EscapeDataString($expiredIdentityId)) -TimeoutSec 5
        if ([string]$rightsExpired.result.status -ne 'EXPIRED' -or $rightsExpired.result.eligible) { throw 'Packaged expired rights evaluation did not fail closed.' }
        $rightsRevoked = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/commands" -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-rights-revoke'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{
            command_type = 'RevokeRights'
            payload = @{ rights_identity_id = $rightsIdentityId; right_type = 'SOURCE_USE'; reason = 'packaging smoke revocation' }
        } | ConvertTo-Json -Depth 10) -TimeoutSec 5
        if (-not $rightsRevoked.ok) { throw 'Packaged rights revoke command failed.' }
        $rightsAfterRevoke = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/v1/assets/{1}/rights?territory=VN" -f $webPort, [Uri]::EscapeDataString([string]$asset.id)) -TimeoutSec 5
        if ([string]$rightsAfterRevoke.result.status -ne 'REVOKED' -or $rightsAfterRevoke.result.eligible) { throw 'Packaged rights evaluation did not fail closed after revocation.' }
        $projectAssets = Invoke-RestMethod -Uri $assetUri -TimeoutSec 5
        if (@($projectAssets.assets | Where-Object { $_.id -eq $asset.id }).Count -ne 1) { throw 'Imported asset was not present in the project asset library.' }
        $stagingList = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/storage/staging?state=REGISTERED" -TimeoutSec 5
        $stagedAsset = @($stagingList.result.items | Where-Object { $_.sha256 -eq $asset.contentHash }) | Select-Object -First 1
        if ($null -eq $stagedAsset -or [string]$stagedAsset.state -ne 'REGISTERED') { throw 'Packaged asset staging evidence was not REGISTERED.' }
        if ($stagedAsset.PSObject.Properties.Name -contains 'temp_path') { throw 'Packaged staging response leaked an internal temp path.' }
        $reconcileHeaders = @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-staging-reconcile'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $reconcile = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/storage/staging/reconcile" -Method Post -Headers $reconcileHeaders -ContentType 'application/json' -Body (@{ staging_id = [string]$stagedAsset.id } | ConvertTo-Json) -TimeoutSec 5
        if (-not $reconcile.ok -or $null -eq $reconcile.result.staging) { throw 'Packaged staging reconciliation command returned an invalid result.' }
        $reference = Invoke-RestMethod -Uri $assetUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-reference'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{
            source_path = $assetSource
            asset_type = 'DOCUMENT'
            storage_mode = 'REFERENCE'
        } | ConvertTo-Json) -TimeoutSec 5
        if ([string]$reference.availability -ne 'UNKNOWN' -or [string]$reference.readinessState -ne 'UNKNOWN') { throw 'Packaged REFERENCE intake did not preserve UNKNOWN availability/readiness.' }

        # Exercise the local, verified backup boundary against the managed
        # object store populated above.  The command is intentionally sent
        # through the same canonical /v1/commands endpoint used by desktop
        # clients so the packaged path proves audit/idempotency behavior too.
        $backupRoot = Join-Path $dataRoot 'backup-smoke'
        $backupHeaders = @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-backup-create'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $backupCreateBody = @{
            command_type = 'CreateBackup'
            payload = @{
                destination_path = $backupRoot
                durability_class = 'LOCAL_WRITABLE'
                failure_domain = 'PACKAGING_SMOKE'
                reserve_bytes = 0
            }
        } | ConvertTo-Json -Depth 10
        $backupCreate = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/commands" -Method Post -Headers $backupHeaders -ContentType 'application/json' -Body $backupCreateBody -TimeoutSec 20
        $backupRecord = $backupCreate.result.backup
        if ($null -eq $backupRecord) { $backupRecord = $backupCreate.result }
        if (-not $backupCreate.ok -or [string]$backupRecord.state -ne 'VERIFIED' -or [string]$backupCreate.result.verification.outcome -ne 'VERIFIED') { throw 'Packaged local backup did not complete with VERIFIED state.' }
        if ([string]::IsNullOrWhiteSpace([string]$backupRecord.id)) { throw 'Packaged local backup returned no backup id.' }
        if ($backupRecord.PSObject.Properties.Name -contains 'destination_path' -or $backupRecord.PSObject.Properties.Name -contains 'manifest_path' -or $backupRecord.PSObject.Properties.Name -contains 'snapshot_path') { throw 'Packaged backup response leaked an internal absolute path field.' }
        $backupResponseJson = $backupCreate | ConvertTo-Json -Depth 20 -Compress
        if ($backupResponseJson.Contains($dataRoot) -or $backupResponseJson -match '(?i)[A-Z]:\\') { throw 'Packaged backup response leaked an absolute machine path.' }
        $backupId = [string]$backupRecord.id
        $backupArtifactRoot = Join-Path $backupRoot $backupId
        $backupManifest = Join-Path $backupArtifactRoot 'manifest.json'
        if (-not (Test-Path -LiteralPath $backupManifest -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $backupArtifactRoot 'cineforge.sqlite') -PathType Leaf)) { throw 'Packaged verified backup artifact is incomplete.' }

        $backupReplay = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/commands" -Method Post -Headers $backupHeaders -ContentType 'application/json' -Body $backupCreateBody -TimeoutSec 20
        $backupReplayIsIdempotent = ($backupReplay.PSObject.Properties.Name -contains 'idempotent_replay' -and [bool]$backupReplay.idempotent_replay)
        if (-not $backupReplayIsIdempotent -and $null -ne $backupReplay.result) {
            $backupReplayIsIdempotent = ($backupReplay.result.PSObject.Properties.Name -contains 'idempotent_replay' -and [bool]$backupReplay.result.idempotent_replay)
        }
        if (-not $backupReplayIsIdempotent -or [string]$backupReplay.result.backup.id -ne $backupId) { throw 'Packaged backup command retry was not an idempotent replay.' }

        $backupList = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/backups" -TimeoutSec 5
        $backupItems = @()
        if ($null -ne $backupList.result -and $backupList.result.PSObject.Properties.Name -contains 'items') { $backupItems = @($backupList.result.items) }
        elseif ($null -ne $backupList.result -and $backupList.result.PSObject.Properties.Name -contains 'backups') { $backupItems = @($backupList.result.backups) }
        elseif ($backupList.PSObject.Properties.Name -contains 'backups') { $backupItems = @($backupList.backups) }
        if (@($backupItems | Where-Object { [string]$_.id -eq $backupId -and [string]$_.state -eq 'VERIFIED' }).Count -ne 1) { throw 'Packaged backup list did not expose the verified backup.' }
        $backupDetail = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/v1/backups/{1}" -f $webPort, [Uri]::EscapeDataString($backupId)) -TimeoutSec 5
        $backupDetailRecord = $backupDetail.result.backup
        if ($null -eq $backupDetailRecord) { $backupDetailRecord = $backupDetail.result }
        if ([string]$backupDetailRecord.id -ne $backupId -or [string]$backupDetailRecord.state -ne 'VERIFIED') { throw 'Packaged backup detail did not return the verified backup.' }
        if ($backupDetailRecord.PSObject.Properties.Name -contains 'destination_path' -or ([string]($backupDetail | ConvertTo-Json -Depth 20)).Contains($dataRoot)) { throw 'Packaged backup detail leaked an internal path.' }

        # A changed manifest must be observable as a failed verification while
        # preserving the append-only verification history and failed state.
        [IO.File]::AppendAllText($backupManifest, "`n", [Text.UTF8Encoding]::new($false))
        $verifyHeaders = @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-backup-verify-tampered'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $verifyBody = @{ command_type = 'VerifyBackup'; payload = @{ backup_id = $backupId } } | ConvertTo-Json -Depth 10
        $tamperedVerification = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/commands" -Method Post -Headers $verifyHeaders -ContentType 'application/json' -Body $verifyBody -TimeoutSec 20
        if (-not $tamperedVerification.ok -or [string]$tamperedVerification.result.verification.outcome -ne 'FAILED' -or [string]$tamperedVerification.result.backup.state -ne 'FAILED') { throw 'Tampered packaged backup did not fail closed during verification.' }

        # Admission must fail before creating a destination or partial bytes
        # when the caller supplies an impossible max budget.
        $pressureRoot = Join-Path $dataRoot 'backup-pressure'
        $pressureHeaders = @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-backup-pressure'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' }
        $pressureBody = @{ command_type = 'CreateBackup'; payload = @{ destination_path = $pressureRoot; durability_class = 'LOCAL_WRITABLE'; reserve_bytes = 0; max_backup_bytes = 1 } } | ConvertTo-Json -Depth 10
        $pressureStatus = 0
        $pressureCode = ''
        $pressureClient = [System.Net.Http.HttpClient]::new()
        $pressureRequest = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, "http://127.0.0.1:$webPort/v1/commands")
        $pressureRequest.Headers.TryAddWithoutValidation('Idempotency-Key', [string]$pressureHeaders['Idempotency-Key']) | Out-Null
        $pressureRequest.Headers.TryAddWithoutValidation('Origin', [string]$pressureHeaders.Origin) | Out-Null
        $pressureRequest.Headers.TryAddWithoutValidation('Sec-Fetch-Site', [string]$pressureHeaders.'Sec-Fetch-Site') | Out-Null
        $pressureContent = [System.Net.Http.StringContent]::new($pressureBody, [Text.Encoding]::UTF8, 'application/json')
        $pressureRequest.Content = $pressureContent
        try {
            $pressureResponse = $pressureClient.SendAsync($pressureRequest).GetAwaiter().GetResult()
            $pressureStatus = [int]$pressureResponse.StatusCode
            $pressureResponseBody = $pressureResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            try { $pressureCode = [string](($pressureResponseBody | ConvertFrom-Json).error.code) } catch { }
        }
        finally {
            if ($null -ne $pressureRequest) { $pressureRequest.Dispose() }
            if ($null -ne $pressureClient) { $pressureClient.Dispose() }
        }
        if ($pressureStatus -ne 409 -or $pressureCode -ne 'STORAGE_PRESSURE') { throw "Backup storage admission did not fail closed with HTTP 409/STORAGE_PRESSURE (actual: $pressureStatus/$pressureCode)." }
        if (Test-Path -LiteralPath $pressureRoot) { throw 'Storage-pressure rejection created a backup destination or partial artifact.' }

        # Exercise the browser file-picker boundary. The bootstrap accepts the
        # raw stream only from the exact local UI origin, stores it under an
        # opaque handle, and rewrites the subsequent Core command internally;
        # the browser never sends a machine path to Core.
        $stagedSource = Join-Path $dataRoot 'browser-stage-smoke.txt'
        [IO.File]::WriteAllText($stagedSource, 'CineForge browser staged asset smoke', [Text.UTF8Encoding]::new($false))
        function Get-StageStatus([string]$Uri, [byte[]]$Bytes, [string]$Origin) {
            $client = [System.Net.Http.HttpClient]::new()
            $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, $Uri)
            $content = [System.Net.Http.ByteArrayContent]::new($Bytes)
            $content.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('text/plain')
            $request.Content = $content
            if (-not [string]::IsNullOrWhiteSpace($Origin)) { $request.Headers.TryAddWithoutValidation('Origin', $Origin) | Out-Null }
            try {
                $response = $client.SendAsync($request).GetAwaiter().GetResult()
                return [int]$response.StatusCode
            }
            finally {
                if ($null -ne $request) { $request.Dispose() }
                if ($null -ne $client) { $client.Dispose() }
            }
        }
        $stageUri = "http://127.0.0.1:$webPort/v1/desktop/stage"
        $intakeRoot = Join-Path $dataRoot 'intake'
        $intakeBeforeRejectedRequests = if (Test-Path -LiteralPath $intakeRoot) { @(Get-ChildItem -LiteralPath $intakeRoot -Directory).Count } else { 0 }
        if ((Get-StageStatus $stageUri ([IO.File]::ReadAllBytes($stagedSource)) 'https://evil.example') -ne 403) { throw 'Foreign browser origin was not rejected before staging.' }
        if ((Get-StageStatus $stageUri ([IO.File]::ReadAllBytes($stagedSource)) '') -ne 403) { throw 'Missing browser origin was not rejected before staging.' }
        $intakeAfterRejectedRequests = if (Test-Path -LiteralPath $intakeRoot) { @(Get-ChildItem -LiteralPath $intakeRoot -Directory).Count } else { 0 }
        if ($intakeAfterRejectedRequests -ne $intakeBeforeRejectedRequests) { throw 'Rejected staging requests created an intake directory.' }
        $stageClient = [System.Net.Http.HttpClient]::new()
        $stageRequest = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, $stageUri)
        $stageRequest.Headers.TryAddWithoutValidation('Origin', "http://127.0.0.1:$webPort") | Out-Null
        $stageRequest.Headers.TryAddWithoutValidation('Sec-Fetch-Site', 'same-origin') | Out-Null
        $stageFilenameB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('browser-stage-smoke.txt')).TrimEnd('=').Replace('+', '-').Replace('/', '_')
        $stageRequest.Headers.TryAddWithoutValidation('X-CineForge-Filename-B64', $stageFilenameB64) | Out-Null
        $stageContent = [System.Net.Http.ByteArrayContent]::new([IO.File]::ReadAllBytes($stagedSource))
        $stageContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('text/plain')
        $stageRequest.Content = $stageContent
        try {
            $stageResponse = $stageClient.SendAsync($stageRequest).GetAwaiter().GetResult()
            if (-not $stageResponse.IsSuccessStatusCode) { throw "Browser staging request failed with HTTP $([int]$stageResponse.StatusCode)." }
            $stagePayload = $stageResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
        }
        finally {
            if ($null -ne $stageRequest) { $stageRequest.Dispose() }
            if ($null -ne $stageClient) { $stageClient.Dispose() }
        }
        if (-not $stagePayload.ok -or [string]$stagePayload.result.handle -notmatch '^[0-9a-fA-F]{32}$') { throw 'Browser staging did not return a valid opaque handle.' }
        if ([int64]$stagePayload.result.byteSize -ne (Get-Item -LiteralPath $stagedSource).Length) { throw 'Browser staging returned an incorrect byte size.' }
        $leasePath = Join-Path (Join-Path $intakeRoot ([string]$stagePayload.result.handle)) 'consume.lock'
        $heldLease = [IO.File]::Open($leasePath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        $busyStageStatus = 0
        try {
            Invoke-RestMethod -Uri $assetUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-stage-busy'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ source_handle = [string]$stagePayload.result.handle; asset_type = 'DOCUMENT' } | ConvertTo-Json) -TimeoutSec 5 | Out-Null
        }
        catch { if ($null -ne $_.Exception.Response) { $busyStageStatus = [int]$_.Exception.Response.StatusCode } }
        finally { $heldLease.Dispose() }
        if ($busyStageStatus -ne 409) { throw "A leased staging handle was not rejected with HTTP 409 (actual: $busyStageStatus)." }
        $invalidHandleStatus = 0
        try {
            Invoke-RestMethod -Uri $assetUri -Method Post -Headers @{ Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ source_handle = 'not-a-valid-handle' } | ConvertTo-Json) -TimeoutSec 5 | Out-Null
        }
        catch { if ($null -ne $_.Exception.Response) { $invalidHandleStatus = [int]$_.Exception.Response.StatusCode } }
        if ($invalidHandleStatus -ne 400) { throw "Malformed staging handle was not rejected with HTTP 400 (actual: $invalidHandleStatus)." }
        $ambiguousStatus = 0
        try {
            Invoke-RestMethod -Uri $assetUri -Method Post -Headers @{ Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ source_handle = [string]$stagePayload.result.handle; source_path = 'C:\should-not-be-used' } | ConvertTo-Json) -TimeoutSec 5 | Out-Null
        }
        catch { if ($null -ne $_.Exception.Response) { $ambiguousStatus = [int]$_.Exception.Response.StatusCode } }
        if ($ambiguousStatus -ne 400) { throw "Ambiguous staging/source path request was not rejected with HTTP 400 (actual: $ambiguousStatus)." }
        $stagedAsset = Invoke-RestMethod -Uri $assetUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-staged-asset'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{
            source_handle = [string]$stagePayload.result.handle
            asset_type = 'DOCUMENT'
            semantic_role = 'SOURCE_REFERENCE'
            storage_mode = 'COPY'
            original_name = [string]$stagePayload.result.name
        } | ConvertTo-Json) -TimeoutSec 5
        if ([string]::IsNullOrWhiteSpace([string]$stagedAsset.id)) { throw 'Staged Core asset import returned no asset id.' }
        if ([string]$stagedAsset.availability -ne 'AVAILABLE') { throw "Staged asset import was not AVAILABLE: $($stagedAsset.availability)" }
        if ([string]$stagedAsset.readinessState -ne 'UNKNOWN') { throw "Staged asset readiness was not UNKNOWN before verifier evidence: $($stagedAsset.readinessState)" }
        if ([string]$stagedAsset.contentHash -notmatch '^[0-9a-fA-F]{64}$') { throw 'Staged asset import returned an invalid SHA-256 hash.' }
        if ([string]$stagedAsset.storageUri -notmatch '^object://sha-256/') { throw 'Staged asset import did not return a managed object URI.' }
        $stagedReplay = Invoke-RestMethod -Uri $assetUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-staged-asset'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{
            source_handle = [string]$stagePayload.result.handle
            asset_type = 'DOCUMENT'
            semantic_role = 'SOURCE_REFERENCE'
            storage_mode = 'COPY'
            original_name = [string]$stagePayload.result.name
        } | ConvertTo-Json) -TimeoutSec 5
        if ($stagedReplay.id -ne $stagedAsset.id) { throw 'Replaying a staged import with the same idempotency key returned a different asset.' }
        $consumedHandleStatus = 0
        try {
            Invoke-RestMethod -Uri $assetUri -Method Post -Headers @{ 'Idempotency-Key' = 'cineforge-packaging-smoke-staged-asset-new'; Origin = "http://127.0.0.1:$webPort"; 'Sec-Fetch-Site' = 'same-origin' } -ContentType 'application/json' -Body (@{ source_handle = [string]$stagePayload.result.handle } | ConvertTo-Json) -TimeoutSec 5 | Out-Null
        }
        catch { if ($null -ne $_.Exception.Response) { $consumedHandleStatus = [int]$_.Exception.Response.StatusCode } }
        if ($consumedHandleStatus -ne 409) { throw "A consumed staging handle was not rejected with HTTP 409 for a new idempotency key (actual: $consumedHandleStatus)." }
        $projectAssetsAfterStage = Invoke-RestMethod -Uri $assetUri -TimeoutSec 5
        if (@($projectAssetsAfterStage.assets | Where-Object { $_.id -eq $stagedAsset.id }).Count -ne 1) { throw 'Browser-staged asset was not present in the project asset library.' }

        $refreshed = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/v1/dashboard" -TimeoutSec 5
        $persisted = @($refreshed.projects | Where-Object { $_.id -eq $project.id })
        if ($persisted.Count -ne 1) { throw 'Created project was not present in the refreshed dashboard.' }
        if (@($persisted[0].productionItems | Where-Object { $_.id -eq $item.id }).Count -ne 1) { throw 'Created production item was not present after dashboard refresh.' }
        $refreshedWorkspace = Invoke-RestMethod -Uri $workspaceUri -TimeoutSec 5
        if (@($refreshedWorkspace.result.tasks | Where-Object { $_.id -eq $taskRecord.id -and $_.status -eq 'IN_PROGRESS' }).Count -ne 1) { throw 'Canonical task was not present after dashboard refresh.' }
        if (@($refreshedWorkspace.result.shots | Where-Object { $_.id -eq $shotRecord.id -and $_.lifecycle_state -eq 'PAUSED' }).Count -ne 1) { throw 'Canonical shot was not present after dashboard refresh.' }
        if (@($refreshedWorkspace.result.notes | Where-Object { $_.id -eq $taskNoteRecord.id }).Count -ne 1) { throw 'Canonical note was not present after dashboard refresh.' }

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
        $reloadedWorkspace = Invoke-RestMethod -Uri $workspaceUri -TimeoutSec 5
        if (@($reloadedWorkspace.result.tasks | Where-Object { $_.id -eq $taskRecord.id -and $_.status -eq 'IN_PROGRESS' }).Count -ne 1) { throw 'Canonical task did not survive a packaged bootstrap restart.' }
        if (@($reloadedWorkspace.result.shots | Where-Object { $_.id -eq $shotRecord.id -and $_.lifecycle_state -eq 'PAUSED' }).Count -ne 1) { throw 'Canonical shot did not survive a packaged bootstrap restart.' }
        if (@($reloadedWorkspace.result.notes | Where-Object { $_.id -eq $taskNoteRecord.id }).Count -ne 1) { throw 'Canonical note did not survive a packaged bootstrap restart.' }
        $reloadedAssets = Invoke-RestMethod -Uri $assetUri -TimeoutSec 5
        $reloadedAsset = @($reloadedAssets.assets | Where-Object { $_.id -eq $asset.id })
        if ($reloadedAsset.Count -ne 1 -or $reloadedAsset[0].contentHash -ne $asset.contentHash -or $reloadedAsset[0].availability -ne 'AVAILABLE' -or $reloadedAsset[0].readinessState -ne 'UNKNOWN') { throw 'Imported asset did not survive a packaged bootstrap restart.' }
        $reloadedStagedAsset = @($reloadedAssets.assets | Where-Object { $_.id -eq $stagedAsset.id })
        if ($reloadedStagedAsset.Count -ne 1 -or $reloadedStagedAsset[0].contentHash -ne $stagedAsset.contentHash -or $reloadedStagedAsset[0].availability -ne 'AVAILABLE' -or $reloadedStagedAsset[0].readinessState -ne 'UNKNOWN') { throw 'Browser-staged asset did not survive a packaged bootstrap restart.' }
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
