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
        if (-not $resolvedReplay.result.idempotent_replay) { throw 'DecisionRequest resolve retry was not an idempotent replay.' }

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
                purpose = @{ allowed = @('PRODUCTION') }
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
