[CmdletBinding()]
param(
    [string]$ArtifactRoot = (Join-Path $PSScriptRoot '..\dist\CineForge'),
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$exe = Join-Path (Resolve-Path -LiteralPath $ArtifactRoot).Path 'CineForge.exe'
if (-not (Test-Path -LiteralPath $exe)) {
    throw "CineForge.exe is missing. Run packaging\\build_windows.ps1 first."
}
$args = @()
if ($NoBrowser) { $args += '--no-browser' }
& $exe @args
exit $LASTEXITCODE
