# Starts MQTT, API, development console, and operations console with D-drive Node.js.
$ErrorActionPreference = "Stop"

$nodeRoot = "D:\workspace\.tools\node-v22.12.0-win-x64"
$npm = Join-Path $nodeRoot "npm.cmd"
$shim = "D:\workspace\node-userinfo-shim.cjs"

if (-not (Test-Path -LiteralPath $npm)) {
    throw "Node.js was not found at $nodeRoot"
}

$env:PATH = "$nodeRoot;$env:PATH"
$env:npm_config_cache = "D:\workspace\.npm-cache"
if (Test-Path -LiteralPath $shim) {
    $env:NODE_OPTIONS = "--require=$shim"
}

Set-Location $PSScriptRoot
& $npm run dev
exit $LASTEXITCODE
