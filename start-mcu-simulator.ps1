param(
    [string]$Port,
    [int]$Baud = 115200,
    [switch]$List
)

$ErrorActionPreference = "Stop"
$nodeRoot = "D:\workspace\.tools\node-v22.12.0-win-x64"
$npm = Join-Path $nodeRoot "npm.cmd"

if (-not (Test-Path -LiteralPath $npm)) {
    throw "Node.js was not found at $nodeRoot"
}

$env:PATH = "$nodeRoot;$env:PATH"
$env:npm_config_cache = "D:\workspace\.npm-cache"
Set-Location $PSScriptRoot

if ($List) {
    & $npm run mcu:sim -- --list
} elseif ($Port) {
    & $npm run mcu:sim -- --port $Port --baud $Baud
} else {
    Write-Host "Usage: .\start-mcu-simulator.ps1 -List"
    Write-Host "       .\start-mcu-simulator.ps1 -Port COM4 [-Baud 115200]"
    exit 1
}

exit $LASTEXITCODE
