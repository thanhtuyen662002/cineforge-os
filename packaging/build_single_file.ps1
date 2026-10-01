[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [switch]$SkipTests,
    [switch]$NoInstall,
    [switch]$KeepBuildFiles
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$distRoot = Join-Path $repoRoot 'dist'
$portableRoot = Join-Path $distRoot 'CineForge'
$singleRoot = Join-Path $distRoot 'CineForge-OneFile'
$buildRoot = Join-Path $repoRoot '.packaging'
$buildScript = Join-Path $PSScriptRoot 'build_windows.ps1'
$smokeScript = Join-Path $PSScriptRoot 'single_file_smoke_test.ps1'
$tamperScript = Join-Path $PSScriptRoot 'single_file_tamper_test.ps1'
$bootstrapProject = Join-Path $PSScriptRoot 'bootstrap\CineForge.Bootstrap.csproj'
$started = Get-Date

function Remove-KnownPath([string]$PathToRemove, [string]$ExpectedParent) {
    if (-not (Test-Path -LiteralPath $PathToRemove)) { return }
    $resolved = (Resolve-Path -LiteralPath $PathToRemove).Path
    $parent = (Resolve-Path -LiteralPath $ExpectedParent).Path.TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($parent, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove path outside the build directory: $resolved"
    }
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        try {
            Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
            return
        }
        catch {
            if ($attempt -eq 14) { throw }
            Start-Sleep -Milliseconds 250
        }
    }
}

function Get-Sha256([string]$PathToHash) {
    $hashCommand = Get-Command Get-FileHash -ErrorAction SilentlyContinue
    if ($null -ne $hashCommand) {
        return ((& $hashCommand.Name -LiteralPath $PathToHash -Algorithm SHA256).Hash).ToLowerInvariant()
    }
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($PathToHash)
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream)) -replace '-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}

function Get-CanonicalContentSha256([object[]]$Entries) {
    # The manifest inventory order is part of the signed/compiled content
    # digest. Keeping one explicit order avoids PowerShell's culture-sensitive
    # Sort-Object disagreeing with .NET's ordinal comparer for mixed-case Node
    # license/readme paths.
    $lines = foreach ($entry in @($Entries)) {
        "{0}`n{1}`n{2}`n" -f ([string]$entry.path).Replace('\', '/'), ([int64]$entry.bytes), ([string]$entry.sha256).ToLowerInvariant()
    }
    $canonical = [Text.Encoding]::UTF8.GetBytes(($lines -join ''))
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($canonical)) -replace '-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}

function Invoke-Checked([string]$FilePath, [string[]]$Arguments, [string]$Description, [string]$WorkingDirectory = $repoRoot) {
    Write-Host "==> $Description" -ForegroundColor Cyan
    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$Description failed with exit code $LASTEXITCODE." }
    }
    finally { Pop-Location }
}

if (-not (Test-Path -LiteralPath $buildScript)) { throw "Portable build script is missing: $buildScript" }
if (-not (Test-Path -LiteralPath $smokeScript)) { throw "Single-file smoke script is missing: $smokeScript" }
if (-not (Test-Path -LiteralPath $bootstrapProject)) { throw "Bootstrap project is missing: $bootstrapProject" }

Write-Host 'CineForge single-file packaging' -ForegroundColor Green
Write-Host "Repository: $repoRoot"

# The portable builder remains the single source for the real UI/Core build
# and its integration smoke. We then embed exactly its web/runtime files into
# the .NET bootstrap, so the one-file artifact cannot gain a hidden machine
# level Node/Python dependency.
$portableParams = @{
    Mode = 'Portable'
    Configuration = $Configuration
    SkipTests = $SkipTests
    NoInstall = $NoInstall
    KeepBuildFiles = $KeepBuildFiles
}
& $buildScript @portableParams
if ($LASTEXITCODE -ne 0) { throw "Portable payload build failed with exit code $LASTEXITCODE." }

$portableExe = Join-Path $portableRoot 'CineForge.exe'
$portableManifestPath = Join-Path $portableRoot 'build-manifest.json'
if (-not (Test-Path -LiteralPath $portableExe -PathType Leaf) -or -not (Test-Path -LiteralPath $portableManifestPath -PathType Leaf)) {
    throw 'Portable build did not produce the executable and manifest needed for single-file packaging.'
}
$portableManifest = Get-Content -LiteralPath $portableManifestPath -Raw | ConvertFrom-Json
if ([string]$portableManifest.core -ne 'node-self-contained') {
    throw "Single-file packaging requires a bundled Node/Core runtime; current core mode is '$($portableManifest.core)'."
}

Remove-KnownPath $singleRoot $distRoot
New-Item -ItemType Directory -Path $singleRoot -Force | Out-Null
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
$payloadRoot = Join-Path $buildRoot ('single-file-payload-' + [Guid]::NewGuid().ToString('N'))
$payloadZip = Join-Path $buildRoot ('single-file-payload-' + [Guid]::NewGuid().ToString('N') + '.zip')
$metadataPath = Join-Path $buildRoot ('single-file-metadata-' + [Guid]::NewGuid().ToString('N') + '.g.cs')
$publishRoot = Join-Path $buildRoot ('single-file-publish-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null

try {
    Copy-Item -LiteralPath (Join-Path $portableRoot 'web') -Destination (Join-Path $payloadRoot 'web') -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $portableRoot 'runtime') -Destination (Join-Path $payloadRoot 'runtime') -Recurse -Force

    $payloadEntries = @($portableManifest.artifact_files |
        Where-Object { [string]$_.path -ne 'CineForge.exe' } |
        ForEach-Object {
            [ordered]@{
                path = ([string]$_.path).Replace('\', '/')
                bytes = [int64]$_.bytes
                sha256 = ([string]$_.sha256).ToLowerInvariant()
            }
        } |
        Sort-Object { [string]$_['path'] })
    if ($payloadEntries.Count -eq 0) { throw 'Portable manifest has no web/Core artifacts to embed.' }
    $contentSha256 = Get-CanonicalContentSha256 $payloadEntries

    $singleManifest = [ordered]@{
        product = 'CineForge OS'
        version = '0.1.0-single-file'
        built_at_utc = [DateTime]::UtcNow.ToString('o')
        source_git_head = [string]$portableManifest.source_git_head
        source_tree_clean = [bool]$portableManifest.source_tree_clean
        mode = 'single-file'
        ui = [string]$portableManifest.ui
        core = 'node-self-contained'
        bootstrap = 'CineForge.exe (embedded resource)'
        bootstrap_sha256 = $null
        embedded_content_sha256 = $contentSha256
        artifact_file_count = $payloadEntries.Count
        artifact_files = $payloadEntries
        signing = 'UNSIGNED_BUILD_REQUIRES_TRUSTED_RELEASE_SIGNING'
        runtime = 'Single executable with authenticated embedded web/Core/Node payload.'
        warnings = @('The single-file artifact is unsigned until the trusted release signing lane is run.')
        embedded_format = 'CINEFORGE_EMBEDDED_RESOURCE_V1'
    }
    $singleManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $payloadRoot 'build-manifest.json') -Encoding UTF8

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($payloadRoot, $payloadZip, [IO.Compression.CompressionLevel]::Optimal, $false)
    $payloadSha256 = Get-Sha256 $payloadZip

    # The metadata is compiled into the bootstrap. PublishSingleFile then owns
    # the resource; no bytes are appended after the apphost bundle footer.
    @"
namespace CineForge.Bootstrap;

internal static class EmbeddedBuildMetadata
{
    public const string PayloadSha256 = "$payloadSha256";
    public const string ContentSha256 = "$contentSha256";
}
"@ | Set-Content -LiteralPath $metadataPath -Encoding UTF8

    Remove-KnownPath $publishRoot $buildRoot
    New-Item -ItemType Directory -Path $publishRoot -Force | Out-Null
    $dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($null -eq $dotnet) { throw '.NET 8 SDK is required to produce the embedded single-file CineForge.exe.' }
    $publishArgs = @(
        'publish', $bootstrapProject,
        '--configuration', $Configuration,
        '--runtime', 'win-x64',
        '--self-contained', 'true',
        '-p:PublishSingleFile=true',
        '-p:IncludeNativeLibrariesForSelfExtract=true',
        '-p:DebugType=None',
        "-p:PackagePayload=$payloadZip",
        "-p:EmbeddedMetadata=$metadataPath",
        '--output', $publishRoot,
        '--nologo'
    )
    Invoke-Checked $dotnet.Source $publishArgs 'Publish resource-embedded self-contained CineForge.exe' $repoRoot
    $publishedExe = Join-Path $publishRoot 'CineForge.exe'
    if (-not (Test-Path -LiteralPath $publishedExe -PathType Leaf)) { throw "The .NET publish did not produce the expected executable: $publishedExe" }

    $singleExe = Join-Path $singleRoot 'CineForge.exe'
    Copy-Item -LiteralPath $publishedExe -Destination $singleExe -Force
    $singleFileInfo = Get-Item -LiteralPath $singleExe
    Write-Host "Single-file artifact: $singleExe" -ForegroundColor Green
    Write-Host ("Single-file bytes: {0:N0}" -f $singleFileInfo.Length)
    Write-Host ("Single-file SHA-256: {0}" -f (Get-Sha256 $singleExe))

    & $smokeScript -ExecutablePath $singleExe
    if ($LASTEXITCODE -ne 0) { throw "Single-file smoke test failed with exit code $LASTEXITCODE." }
    if (Test-Path -LiteralPath $tamperScript) {
        & $tamperScript -ExecutablePath $singleExe
        if ($LASTEXITCODE -ne 0) { throw "Single-file tamper test failed with exit code $LASTEXITCODE." }
    }
}
finally {
    if (-not $KeepBuildFiles) {
        foreach ($temporary in @($payloadRoot, $payloadZip, $metadataPath, $publishRoot)) {
            if (Test-Path -LiteralPath $temporary) { Remove-KnownPath $temporary $buildRoot }
        }
    }
}

# The consumer directory is intentionally one file. Keep the portable
# directory only for diagnostics when explicitly requested with KeepBuildFiles.
if (-not $KeepBuildFiles) { Remove-KnownPath $portableRoot $distRoot }

$elapsed = (Get-Date) - $started
Write-Host ("Single-file packaging complete in {0:N1}s." -f $elapsed.TotalSeconds) -ForegroundColor Green
