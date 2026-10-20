[CmdletBinding()]
param(
    [string]$KeilPath = 'D:\Keil_v5\UV4\UV4.exe'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$controllerRoot = Join-Path $projectRoot 'axent-controller'
$projectPath = Join-Path $controllerRoot 'AXENT-AC6.uvprojx'
$buildLog = Join-Path $controllerRoot 'ac6-build.log'
$hexPath = Join-Path $controllerRoot 'Objects\AXENT.hex'

foreach ($path in @($KeilPath, $projectPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required file not found: $path"
    }
}

Remove-Item -LiteralPath $buildLog -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $hexPath -Force -ErrorAction SilentlyContinue

Push-Location $controllerRoot
try {
    $arguments = @('-r', $projectPath, '-j0', '-o', $buildLog)
    $process = Start-Process -FilePath $KeilPath -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Keil returned exit code $($process.ExitCode). See $buildLog"
    }
} finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $buildLog -PathType Leaf)) {
    throw "Keil did not create the build log: $buildLog"
}
$logText = Get-Content -LiteralPath $buildLog -Raw
if ($logText -notmatch '0 Error\(s\), 0 Warning\(s\)') {
    throw "STM32 build did not pass with zero errors and warnings. See $buildLog"
}
if (-not (Test-Path -LiteralPath $hexPath -PathType Leaf)) {
    throw "STM32 build did not create the HEX file: $hexPath"
}

$hash = Get-FileHash -LiteralPath $hexPath -Algorithm SHA256
$sizeLine = [regex]::Match($logText, 'Program Size:[^\r\n]+').Value
Write-Host 'STM32 build passed.'
Write-Host $sizeLine
Write-Host "HEX: $hexPath"
Write-Host "SHA-256: $($hash.Hash)"
