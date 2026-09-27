[CmdletBinding()]
param(
    [ValidateSet('Auto', 'Portable', 'Tauri')]
    [string]$Mode = 'Auto',
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [switch]$SkipTests,
    [switch]$NoInstall,
    [switch]$SkipCoreBundle,
    [switch]$KeepBuildFiles
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$distRoot = Join-Path $repoRoot 'dist'
$packageRoot = Join-Path $distRoot 'CineForge'
$buildRoot = Join-Path $repoRoot '.packaging'
$runtimeRoot = Join-Path $packageRoot 'runtime'
$bootstrapProject = Join-Path $PSScriptRoot 'bootstrap\CineForge.Bootstrap.csproj'
$started = Get-Date
$warnings = [System.Collections.Generic.List[string]]::new()

function Get-ToolPath([string]$Name) {
    $tool = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $tool) { return $null }
    return $tool.Source
}

function Invoke-Checked([string]$FilePath, [string[]]$Arguments, [string]$Description, [string]$WorkingDirectory = $repoRoot) {
    Write-Host "==> $Description" -ForegroundColor Cyan
    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$Description failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

function Remove-KnownPath([string]$PathToRemove, [string]$ExpectedParent) {
    if (-not (Test-Path -LiteralPath $PathToRemove)) { return }
    $resolved = (Resolve-Path -LiteralPath $PathToRemove).Path
    $parent = (Resolve-Path -LiteralPath $ExpectedParent).Path.TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($parent, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove path outside the build directory: $resolved"
    }
    $removed = $false
    for ($attempt = 0; $attempt -lt 15 -and -not $removed; $attempt++) {
        try {
            Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
            $removed = $true
        }
        catch {
            if ($attempt -eq 14) { throw }
            Start-Sleep -Seconds 1
        }
    }
}

function Find-Python {
    foreach ($candidate in @('python', 'py')) {
        $path = Get-ToolPath $candidate
        if ($null -ne $path) { return $path }
    }
    return $null
}

function Get-GitHead {
    try {
        $head = (& git -C $repoRoot rev-parse HEAD 2>$null).Trim()
        if ($LASTEXITCODE -eq 0 -and $head) { return $head }
    }
    catch { }
    return $null
}

Write-Host "CineForge Windows packaging ($Mode / $Configuration)" -ForegroundColor Green
Write-Host "Repository: $repoRoot"

$node = Get-ToolPath 'node'
$npm = Get-ToolPath 'npm'
$dotnet = Get-ToolPath 'dotnet'
$cargo = Get-ToolPath 'cargo'
$python = Find-Python

if ($null -eq $dotnet) {
    throw '.NET 8 SDK is required to produce the portable CineForge.exe bootstrap.'
}

if (-not $KeepBuildFiles) {
    Remove-KnownPath $packageRoot $distRoot
    Remove-KnownPath $buildRoot $repoRoot
}
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null

$appRoot = Join-Path $repoRoot 'app'
$appPackage = Join-Path $appRoot 'package.json'
$appDist = Join-Path $appRoot 'dist'
$uiMode = 'existing-static-bundle'

if (Test-Path -LiteralPath $appPackage) {
    if ($null -eq $node -or $null -eq $npm) {
        throw 'app/package.json exists but Node.js/npm is unavailable.'
    }
    if (-not $NoInstall) {
        $lock = Join-Path $appRoot 'package-lock.json'
        if (Test-Path -LiteralPath $lock) {
            Invoke-Checked $npm @('ci', '--no-audit', '--no-fund') 'Install pinned UI dependencies' $appRoot
        }
        else {
            # Avoid writing a lockfile from an automated packaging run when the
            # source tree intentionally has no lock yet.
            Invoke-Checked $npm @('install', '--no-package-lock', '--no-audit', '--no-fund') 'Install UI dependencies' $appRoot
        }
    }

    if (-not $SkipTests) {
        Invoke-Checked $npm @('run', 'test', '--', '--run') 'Run UI tests' $appRoot
    }

    $oldCoreBase = $env:VITE_CORE_BASE_URL
    try {
        # A relative base makes the packaged UI use the bootstrap's same-origin
        # /v1 proxy. This avoids hard-coding a machine-specific localhost port.
        $env:VITE_CORE_BASE_URL = '.'
        Invoke-Checked $npm @('run', 'build') 'Build Vite UI bundle' $appRoot
    }
    finally {
        if ($null -eq $oldCoreBase) { Remove-Item Env:VITE_CORE_BASE_URL -ErrorAction SilentlyContinue }
        else { $env:VITE_CORE_BASE_URL = $oldCoreBase }
    }
    $uiMode = 'vite-build'
}

if (-not (Test-Path -LiteralPath $appDist)) {
    throw "UI build output is missing: $appDist"
}
Copy-Item -LiteralPath $appDist -Destination (Join-Path $packageRoot 'web') -Recurse -Force

$coreRoot = Join-Path $repoRoot 'core'
$coreMode = 'missing'
if (Test-Path -LiteralPath $coreRoot) {
    $coreServer = Join-Path $coreRoot 'server.mjs'
    if ((Test-Path -LiteralPath $coreServer) -and $null -ne $node) {
        if (-not $SkipTests) {
            $corePackage = Join-Path $coreRoot 'package.json'
            if (Test-Path -LiteralPath $corePackage) {
                $coreTestFiles = @(Get-ChildItem -LiteralPath $coreRoot -Filter '*.test.mjs' -File -ErrorAction SilentlyContinue)
                if ($coreTestFiles.Count -gt 0) {
                    Invoke-Checked $node @('--test', '--test-reporter', 'spec') 'Run Core tests' $coreRoot
                }
            }
        }
        # Node's Windows executable is self-contained. Copying it next to the
        # source Core makes the portable package independent of PATH/Node.js.
        Copy-Item -LiteralPath $coreRoot -Destination (Join-Path $runtimeRoot 'core') -Recurse -Force
        Copy-Item -LiteralPath $node -Destination (Join-Path $runtimeRoot 'node.exe') -Force
        $coreMode = 'node-self-contained'
    }
    else {
        $pyInstaller = Get-ToolPath 'pyinstaller'
        $pyInstallerViaModule = $false
        if ($null -eq $pyInstaller -and $null -ne $python) {
            try {
                & $python -c 'import PyInstaller' 2>$null
                if ($LASTEXITCODE -eq 0) { $pyInstaller = $python; $pyInstallerViaModule = $true }
            }
            catch { }
        }

        if (-not $SkipCoreBundle -and $null -ne $pyInstaller) {
            $pyWork = Join-Path $buildRoot 'pyinstaller'
            New-Item -ItemType Directory -Path $pyWork -Force | Out-Null
            $entry = Join-Path $coreRoot '__main__.py'
            if (Test-Path -LiteralPath $entry) {
                $pyArgs = @('--noconfirm', '--clean', '--onedir', '--name', 'CineForgeCore', '--distpath', $runtimeRoot, '--workpath', $pyWork, '--paths', $repoRoot, '--collect-submodules', 'core', $entry)
                if ($pyInstallerViaModule) {
                    $pyArgs = @('-m', 'PyInstaller') + $pyArgs
                    Invoke-Checked $pyInstaller $pyArgs 'Bundle Python Core with PyInstaller' $repoRoot
                }
                else {
                    Invoke-Checked $pyInstaller $pyArgs 'Bundle Python Core with PyInstaller' $repoRoot
                }
                $coreMode = 'pyinstaller-onedir'
            }
        }

        if ($coreMode -eq 'missing') {
            # Source fallback is useful for development and remains deterministic;
            # production distribution should use PyInstaller so Python is not a
            # hidden machine prerequisite.
            Copy-Item -LiteralPath $coreRoot -Destination (Join-Path $runtimeRoot 'core') -Recurse -Force
            $coreMode = 'python-source-fallback'
            $warnings.Add('Node Core is unavailable and PyInstaller did not produce a bundle; portable output requires Python 3.11+ on the target machine.')
        }
    }
}
else {
    $warnings.Add('core/ is missing; launcher will open the UI in offline/demo mode.')
}

$tauriInstaller = $null
$tauriToolchainAvailable = $null -ne $cargo -and (Test-Path -LiteralPath (Join-Path $appRoot 'src-tauri\Cargo.toml'))
# The current native shell is intentionally only a validated UI scaffold. It
# does not yet package/start the Node Core as a Tauri sidecar, so producing an
# installer here would create a polished shell that silently falls back to the
# bounded demo adapter. Keep that path fail-closed until sidecar integration is
# implemented and tested.
$tauriCoreBootstrapReady = $false
$tauriAvailable = $tauriToolchainAvailable -and $tauriCoreBootstrapReady
if ($Mode -eq 'Tauri' -and -not $tauriAvailable) {
    if (-not $tauriToolchainAvailable) { throw 'Tauri mode requested, but Cargo and app/src-tauri/Cargo.toml are unavailable.' }
    throw 'Tauri mode is intentionally disabled until the native shell packages and starts the Core sidecar. Use Portable for the verified CineForge.exe product.'
}
if ($tauriAvailable -and $Mode -ne 'Portable') {
    try {
        Invoke-Checked $npm @('run', 'desktop:build') 'Build signed-target Tauri bundle' $appRoot
        $nsis = Get-ChildItem -LiteralPath (Join-Path $appRoot 'src-tauri\target\release\bundle\nsis') -Filter '*.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $nsis) {
            $installerDir = Join-Path $distRoot 'installer'
            New-Item -ItemType Directory -Path $installerDir -Force | Out-Null
            $tauriInstaller = Join-Path $installerDir $nsis.Name
            Copy-Item -LiteralPath $nsis.FullName -Destination $tauriInstaller -Force
        }
        else {
            $warnings.Add('Tauri build completed but no NSIS .exe was found under src-tauri/target/release/bundle/nsis.')
        }
    }
    catch {
        if ($Mode -eq 'Tauri') { throw }
        $warnings.Add("Tauri build unavailable; portable bootstrap was still produced. $($_.Exception.Message)")
    }
}
elseif ($Mode -eq 'Auto') {
    if ($tauriToolchainAvailable) {
        $warnings.Add('Cargo/Tauri is installed, but native Core sidecar integration is not release-ready; producing the verified portable bootstrap.')
    }
    else {
        $warnings.Add('Cargo/Tauri project is unavailable; producing the portable browser-hosted bootstrap.')
    }
}

$bootstrapPublishRoot = Join-Path $buildRoot 'bootstrap-publish'
Remove-KnownPath $bootstrapPublishRoot $buildRoot
New-Item -ItemType Directory -Path $bootstrapPublishRoot -Force | Out-Null
# Publish into a staging directory. The .NET SDK is allowed to clean its
# output directory, so publishing directly into the final artifact would erase
# the already-copied web bundle and Core runtime.
$publishArgs = @('publish', $bootstrapProject, '--configuration', $Configuration, '--runtime', 'win-x64', '--self-contained', 'true', '-p:PublishSingleFile=true', '-p:IncludeNativeLibrariesForSelfExtract=true', '-p:DebugType=None', '--output', $bootstrapPublishRoot, '--nologo')
Invoke-Checked $dotnet $publishArgs 'Publish self-contained CineForge.exe bootstrap' $repoRoot
$publishedExe = Join-Path $bootstrapPublishRoot 'CineForge.exe'
if (-not (Test-Path -LiteralPath $publishedExe)) {
    throw "The .NET publish did not produce the expected executable: $publishedExe"
}
Copy-Item -LiteralPath $publishedExe -Destination (Join-Path $packageRoot 'CineForge.exe') -Force

$gitHead = Get-GitHead
$exe = Join-Path $packageRoot 'CineForge.exe'
$manifest = [ordered]@{
    product = 'CineForge OS'
    version = '0.1.0-portable'
    built_at_utc = [DateTime]::UtcNow.ToString('o')
    source_git_head = $gitHead
    mode = $Mode
    ui = $uiMode
    core = $coreMode
    tauri_installer = if ($null -ne $tauriInstaller) { [IO.Path]::GetRelativePath($distRoot, $tauriInstaller) } else { $null }
    bootstrap = 'CineForge.exe'
    bootstrap_sha256 = if (Test-Path -LiteralPath $exe) { (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
    signing = 'UNSIGNED_BUILD_REQUIRES_TRUSTED_RELEASE_SIGNING'
    runtime = if ($coreMode -eq 'node-self-contained') { 'Self-contained bootstrap with bundled Node.js and Core.' } elseif ($coreMode -eq 'python-source-fallback') { 'Python 3.11+ required unless Core is bundled with PyInstaller.' } else { 'Self-contained bootstrap; Core bundled.' }
    warnings = @($warnings)
}
$manifestPath = Join-Path $packageRoot 'build-manifest.json'
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host "Portable artifact: $exe" -ForegroundColor Green
Write-Host "Manifest: $manifestPath"
if ($tauriInstaller) { Write-Host "Tauri installer: $tauriInstaller" -ForegroundColor Green }
if ($warnings.Count -gt 0) {
    Write-Host 'Packaging warnings:' -ForegroundColor Yellow
    $warnings | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
}

$smoke = Join-Path $PSScriptRoot 'smoke_test.ps1'
if (Test-Path -LiteralPath $smoke) {
    $allowOffline = $coreMode -notin @('node-self-contained', 'pyinstaller-onedir')
    & $smoke -ArtifactRoot $packageRoot -AllowOffline:$allowOffline
    if ($LASTEXITCODE -ne 0) { throw "Portable smoke test failed with exit code $LASTEXITCODE." }
}

$elapsed = (Get-Date) - $started
Write-Host ("Packaging complete in {0:N1}s." -f $elapsed.TotalSeconds) -ForegroundColor Green
