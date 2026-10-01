[CmdletBinding()]
param(
    [ValidateSet('Auto', 'Portable', 'SingleFile', 'Tauri')]
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

# SingleFile has a separate, deliberately small orchestration layer. It first
# produces the exact verified portable payload, then embeds that payload into
# the self-contained bootstrap and runs a smoke test against the resulting
# lone executable. Keeping the existing Portable path intact avoids changing
# its manifest contract or release behaviour.
if ($Mode -eq 'SingleFile') {
    if ($SkipCoreBundle) {
        throw 'Single-file packaging always bundles the production Node/Core runtime; -SkipCoreBundle is not supported.'
    }
    $singleFileScript = Join-Path $PSScriptRoot 'build_single_file.ps1'
    if (-not (Test-Path -LiteralPath $singleFileScript)) {
        throw "Single-file packaging script is missing: $singleFileScript"
    }
    $singleParams = @{
        Configuration = $Configuration
        SkipTests = $SkipTests
        NoInstall = $NoInstall
        KeepBuildFiles = $KeepBuildFiles
    }
    & $singleFileScript @singleParams
    exit $LASTEXITCODE
}

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

function Get-Sha256([string]$PathToHash) {
    # Windows PowerShell installations used on build machines do not always
    # ship the Get-FileHash cmdlet. Keep the manifest deterministic with the
    # framework crypto API so the one-click wrapper works on both PowerShell
    # editions.
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

function Assert-CleanGitTree {
    # The packaged payload can contain generated files that are not represented
    # by HEAD. Refuse to publish a manifest that claims only a commit while the
    # working tree contributes unreviewed tracked or untracked source. Ignored
    # build/cache directories remain allowed; they are recreated or excluded
    # by the packaging boundary below.
    try {
        $status = @(& git -C $repoRoot status --porcelain=v1 --untracked-files=all 2>$null)
    }
    catch {
        throw "Could not inspect the source tree before packaging. $($_.Exception.Message)"
    }
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the source tree before packaging: git status failed.' }
    if ($status.Count -gt 0) {
        $sample = (($status | Select-Object -First 8) -join '; ')
        throw "Packaging requires a clean Git worktree so provenance is truthful. Commit or stash source changes first. Detected: $sample"
    }
}

Assert-CleanGitTree
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

# The final artifact must always be rebuilt from an empty package root.  A
# previous `-KeepBuildFiles` run used to leave stale web/runtime files in
# `dist/CineForge`, which then made the inventory depend on build history (and
# could ship deleted source files).  `-KeepBuildFiles` only preserves the
# intermediate staging directory for diagnostics; it must never weaken the
# reproducibility boundary of the delivered package.
Remove-KnownPath $packageRoot $distRoot
# A previous Tauri build may have left an installer beside the portable
# artifact. Remove it before every run so a later Portable/Auto build cannot
# expose a stale installer that is absent from the current manifest.
Remove-KnownPath (Join-Path $distRoot 'installer') $distRoot
if (-not $KeepBuildFiles) {
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
    $nodeVersionText = (& $node -p "process.versions.node").Trim()
    try { $nodeVersion = [version]$nodeVersionText }
    catch { throw "Could not read the Node.js version ($nodeVersionText). Node.js 22.5+ is required for the built-in node:sqlite Core." }
    if ($nodeVersion.Major -lt 22 -or ($nodeVersion.Major -eq 22 -and $nodeVersion.Minor -lt 5)) {
        throw "Node.js $nodeVersionText is too old. Node.js 22.5+ is required for the built-in node:sqlite Core."
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
        $nodeDirectory = Split-Path -Parent $node
        foreach ($licenseName in @('LICENSE', 'README.md')) {
            $licensePath = Join-Path $nodeDirectory $licenseName
            if (Test-Path -LiteralPath $licensePath) {
                Copy-Item -LiteralPath $licensePath -Destination (Join-Path $runtimeRoot ("Node-" + $licenseName)) -Force
            }
        }
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
$artifactFiles = [System.Collections.Generic.List[object]]::new()
$packagePrefix = $packageRoot.TrimEnd('\') + '\'
$artifactRoots = @('CineForge.exe', 'web', 'runtime')
foreach ($artifactRoot in $artifactRoots) {
    $artifactPath = Join-Path $packageRoot $artifactRoot
    if (-not (Test-Path -LiteralPath $artifactPath)) { continue }
    $artifactItem = Get-Item -LiteralPath $artifactPath
    $files = if ($artifactItem.PSIsContainer) {
        @(Get-ChildItem -LiteralPath $artifactPath -Recurse -File | Sort-Object FullName)
    }
    else {
        @($artifactItem)
    }
    foreach ($file in $files) {
        $fullFilePath = (Resolve-Path -LiteralPath $file.FullName).Path
        if (-not $fullFilePath.StartsWith($packagePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Artifact file escaped the package root: $fullFilePath"
        }
        $relative = $fullFilePath.Substring($packagePrefix.Length).Replace('\', '/')
        $artifactFiles.Add([ordered]@{
            path = $relative
            bytes = [int64]$file.Length
            sha256 = Get-Sha256 $file.FullName
        })
    }
}
$artifactFiles = @($artifactFiles | Sort-Object { [string]$_['path'] })
$manifest = [ordered]@{
    product = 'CineForge OS'
    version = '0.1.0-portable'
    built_at_utc = [DateTime]::UtcNow.ToString('o')
    source_git_head = $gitHead
    source_tree_clean = $true
    mode = $Mode
    ui = $uiMode
    core = $coreMode
    tauri_installer = if ($null -ne $tauriInstaller) { [IO.Path]::GetRelativePath($distRoot, $tauriInstaller) } else { $null }
    bootstrap = 'CineForge.exe'
    bootstrap_sha256 = if (Test-Path -LiteralPath $exe) { Get-Sha256 $exe } else { $null }
    artifact_file_count = $artifactFiles.Count
    artifact_files = $artifactFiles
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
