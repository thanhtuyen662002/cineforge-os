[CmdletBinding()]
param(
    [string]$ArtifactRoot = (Join-Path $PSScriptRoot '..\dist\CineForge')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$resolvedArtifact = (Resolve-Path -LiteralPath $ArtifactRoot).Path
$exe = Join-Path $resolvedArtifact 'CineForge.exe'
$webIndex = Join-Path $resolvedArtifact 'web\index.html'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Portable executable is missing: $exe" }
if (-not (Test-Path -LiteralPath $webIndex -PathType Leaf)) { throw "Packaged web bundle is missing: $webIndex" }

$tempPrefix = ([IO.Path]::GetFullPath([IO.Path]::GetTempPath())).TrimEnd('\') + '\'
$tamperRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ('CineForge-tamper-' + [Guid]::NewGuid().ToString('N'))))
if (-not $tamperRoot.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to create a tamper fixture outside the system temp directory: $tamperRoot"
}
$dataRoot = Join-Path $tamperRoot 'data'

try {
    New-Item -ItemType Directory -Path $tamperRoot -Force | Out-Null
    Get-ChildItem -LiteralPath $resolvedArtifact -Force | Copy-Item -Destination $tamperRoot -Recurse -Force
    Add-Content -LiteralPath (Join-Path $tamperRoot 'web\index.html') -Value '<!-- tampered -->'

    $quote = { param([string]$Value) '"' + $Value.Replace('"', '\"') + '"' }
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = Join-Path $tamperRoot 'CineForge.exe'
    $startInfo.Arguments = '--no-browser --root ' + (& $quote $tamperRoot) + ' --data ' + (& $quote $dataRoot)
    $startInfo.WorkingDirectory = $tamperRoot
    $startInfo.CreateNoWindow = $true
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [Diagnostics.Process]::Start($startInfo)
    try {
        if (-not $process.WaitForExit(30000)) {
            try { $process.Kill() } catch { }
            throw 'Tampered CineForge package did not fail within 30 seconds.'
        }
        $stderr = $process.StandardError.ReadToEnd()
        if ($process.ExitCode -ne 7) {
            throw "Tampered package returned exit code $($process.ExitCode), expected 7. $stderr"
        }
        if (Test-Path -LiteralPath $dataRoot) {
            throw 'Tampered package created a data directory before manifest validation failed.'
        }
        Write-Output "TAMPER_SMOKE=PASS exit=$($process.ExitCode)"
    }
    finally {
        $process.Dispose()
    }
}
finally {
    if (Test-Path -LiteralPath $tamperRoot) {
        $resolvedTamper = (Resolve-Path -LiteralPath $tamperRoot).Path
        if (-not $resolvedTamper.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to clean a tamper fixture outside the system temp directory: $resolvedTamper"
        }
        Remove-Item -LiteralPath $resolvedTamper -Recurse -Force
    }
}
