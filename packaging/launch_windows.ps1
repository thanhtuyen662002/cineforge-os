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
