[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$source = (Resolve-Path -LiteralPath $ExecutablePath).Path
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('CineForge-single-tamper-' + [Guid]::NewGuid().ToString('N'))
$copy = Join-Path $tempRoot 'CineForge.exe'
$data = Join-Path $tempRoot 'data'
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

function Add-ProcessArgument([Diagnostics.ProcessStartInfo]$StartInfo, [string]$Value, [ref]$LegacyArguments) {
    # ArgumentList is available in modern PowerShell/.NET. Keep the tamper
    # check runnable from the inbox Windows PowerShell used by .cmd wrappers.
    $argumentListProperty = $StartInfo.GetType().GetProperty('ArgumentList')
    if ($null -ne $argumentListProperty) {
        $StartInfo.ArgumentList.Add($Value)
        return
    }
    $quoted = '"' + $Value.Replace('"', '\"') + '"'
    if ($LegacyArguments.Value.Length -gt 0) { $LegacyArguments.Value += ' ' }
    $LegacyArguments.Value += $quoted
}

try {
    Copy-Item -LiteralPath $source -Destination $copy -Force
    $bytes = [IO.File]::ReadAllBytes($copy)
    if ($bytes.Length -lt 4096) { throw 'Single-file executable is unexpectedly small.' }

    # The embedded payload contains this central-directory name in its ZIP
    # metadata. Flipping one byte there changes the resource bytes without
    # touching the PE header; the compiled payload digest must reject it before
    # the user data directory is created. If a future ZIP implementation hides
    # the name, use a middle-of-bundle byte as a conservative fallback.
    $needle = [Text.Encoding]::ASCII.GetBytes('build-manifest.json')
    $flipAt = -1
    for ($offset = 0; $offset -le $bytes.Length - $needle.Length; $offset++) {
        $matches = $true
        for ($index = 0; $index -lt $needle.Length; $index++) {
            if ($bytes[$offset + $index] -ne $needle[$index]) { $matches = $false; break }
        }
        if ($matches) { $flipAt = $offset; break }
    }
    if ($flipAt -lt 0) { $flipAt = [Math]::Max(4096, [int]($bytes.Length / 2)) }
    if ($flipAt -ge $bytes.Length) { throw 'Could not select a safe tamper offset.' }
    $bytes[$flipAt] = $bytes[$flipAt] -bxor 1
    [IO.File]::WriteAllBytes($copy, $bytes)

    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $copy
    $start.WorkingDirectory = $tempRoot
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $legacyArguments = ''
    foreach ($argument in @('--no-browser', '--data', $data)) { Add-ProcessArgument $start $argument ([ref]$legacyArguments) }
    if ($start.GetType().GetProperty('ArgumentList') -eq $null) { $start.Arguments = $legacyArguments }
    $process = [Diagnostics.Process]::Start($start)
    try {
        if (-not $process.WaitForExit(15000)) {
            try { $process.Kill($true) } catch { }
            throw 'Tampered single-file executable did not fail promptly.'
        }
        $stderr = $process.StandardError.ReadToEnd()
        if ($process.ExitCode -ne 7) { throw "Tampered single-file executable returned exit code $($process.ExitCode), expected 7. $stderr" }
        if (Test-Path -LiteralPath $data) { throw 'Tampered single-file executable created the user data directory before validation.' }
        Write-Host "SINGLE_FILE_TAMPER=PASS exit=$($process.ExitCode) offset=$flipAt" -ForegroundColor Green
    }
    finally { $process.Dispose() }
}
finally {
    try {
        if (Test-Path -LiteralPath $tempRoot) {
            $resolved = (Resolve-Path -LiteralPath $tempRoot).Path
            $tempPrefix = (Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).Path.TrimEnd('\') + '\'
            if ($resolved.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
    catch { }
}
