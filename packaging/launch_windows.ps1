[CmdletBinding()]
param(
    [string]$ArtifactRoot = (Join-Path $PSScriptRoot '..\dist\CineForge'),
    [switch]$NoBrowser,
    [switch]$AllowOffline
)

$ErrorActionPreference = 'Stop'
$exe = Join-Path (Resolve-Path -LiteralPath $ArtifactRoot).Path 'CineForge.exe'
if (-not (Test-Path -LiteralPath $exe)) {
    throw "CineForge.exe is missing. Run packaging\\build_windows.ps1 first."
}
$resolvedRoot = (Resolve-Path -LiteralPath $ArtifactRoot).Path
$webIndex = Join-Path $resolvedRoot 'web\index.html'
if (-not (Test-Path -LiteralPath $webIndex)) {
    throw "CineForge web bundle is missing: $webIndex"
}
$manifestPath = Join-Path $resolvedRoot 'build-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "CineForge build manifest is missing: $manifestPath"
}

function Get-Sha256([string]$PathToHash) {
    $fileHash = Get-Command Get-FileHash -ErrorAction SilentlyContinue
    if ($null -ne $fileHash) {
        return ((& $fileHash.Name -LiteralPath $PathToHash -Algorithm SHA256).Hash).ToLowerInvariant()
    }
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($PathToHash)
    try {
        return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream)) -replace '-', '').ToLowerInvariant()
    }
    finally {
        $stream.Dispose()
        $algorithm.Dispose()
    }
}

try { $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json }
catch { throw "CineForge build manifest is invalid: $manifestPath ($($_.Exception.Message))" }
$manifestHash = if ($manifest.PSObject.Properties.Name -contains 'bootstrap_sha256') { [string]$manifest.bootstrap_sha256 } else { '' }
if ([string]::IsNullOrWhiteSpace($manifestHash)) { throw 'CineForge build manifest does not contain bootstrap_sha256.' }
$actualHash = Get-Sha256 $exe
if (-not $actualHash.Equals($manifestHash, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "CineForge.exe failed manifest integrity check (expected $manifestHash, got $actualHash)."
}

$artifactProperty = $manifest.PSObject.Properties['artifact_files']
if ($null -eq $artifactProperty -or $null -eq $artifactProperty.Value) {
    throw 'CineForge build manifest does not contain the bounded artifact file inventory.'
}
$artifactFiles = @($artifactProperty.Value)
$artifactCount = if ($manifest.PSObject.Properties.Name -contains 'artifact_file_count') { [int]$manifest.artifact_file_count } else { -1 }
if ($artifactCount -lt 1 -or $artifactCount -ne $artifactFiles.Count) {
    throw "CineForge build manifest artifact count is invalid (declared $artifactCount, actual $($artifactFiles.Count))."
}
$rootPrefix = $resolvedRoot.TrimEnd('\') + '\'
$seenArtifactPaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($artifact in $artifactFiles) {
    $relative = [string]$artifact.path
    if ([string]::IsNullOrWhiteSpace($relative)
        -or [IO.Path]::IsPathRooted($relative)
        -or $relative -match '(^|[\\/])\.\.?([\\/]|$)') {
        throw "CineForge build manifest contains an unsafe artifact path: $relative"
    }
    $candidate = [IO.Path]::GetFullPath((Join-Path $resolvedRoot ($relative -replace '/', '\')))
    if (-not $candidate.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)
        -or -not $seenArtifactPaths.Add($candidate)) {
        throw "CineForge build manifest contains a duplicate or escaped artifact path: $relative"
    }
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "CineForge packaged artifact is missing: $relative"
    }
    $attributes = [IO.File]::GetAttributes($candidate)
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "CineForge packaged artifact is a reparse point: $relative"
    }
    $expectedBytes = [long]$artifact.bytes
    if ($expectedBytes -lt 0 -or (Get-Item -LiteralPath $candidate).Length -ne $expectedBytes) {
        throw "CineForge packaged artifact size mismatch: $relative"
    }
    $expectedArtifactHash = [string]$artifact.sha256
    if ($expectedArtifactHash -notmatch '^[0-9a-fA-F]{64}$') {
        throw "CineForge build manifest contains an invalid artifact hash: $relative"
    }
    $actualArtifactHash = Get-Sha256 $candidate
    if (-not $actualArtifactHash.Equals($expectedArtifactHash, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "CineForge packaged artifact hash mismatch: $relative"
    }
}

if (-not $AllowOffline) {
    $bundledNode = Join-Path $resolvedRoot 'runtime\node.exe'
    $bundledCore = Join-Path $resolvedRoot 'runtime\core\server.mjs'
    if (-not (Test-Path -LiteralPath $bundledNode) -or -not (Test-Path -LiteralPath $bundledCore)) {
        throw 'This portable artifact is missing the bundled Node/Core runtime. Rebuild it before launching.'
    }
    if ($manifest.PSObject.Properties.Name -contains 'core' -and [string]$manifest.core -ne 'node-self-contained') {
        throw "This artifact reports core mode '$($manifest.core)' and is not a self-contained production package."
    }
}
$args = @()
if ($NoBrowser) { $args += '--no-browser' }
if ($AllowOffline) { $args += '--allow-offline' }
& $exe @args
exit $LASTEXITCODE
