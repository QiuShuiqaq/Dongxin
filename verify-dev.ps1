# Verifies TypeScript and the running local MQTT/API command lifecycle.
$ErrorActionPreference = "Stop"

$nodeRoot = "D:\workspace\.tools\node-v22.12.0-win-x64"
$node = Join-Path $nodeRoot "node.exe"
$npm = Join-Path $nodeRoot "npm.cmd"

if (-not (Test-Path -LiteralPath $npm)) {
    throw "Node.js was not found at $nodeRoot"
}

$env:PATH = "$nodeRoot;$env:PATH"
$env:npm_config_cache = "D:\workspace\.npm-cache"
Set-Location $PSScriptRoot

& $npm run typecheck
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

& $npm run mcu:self-test
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

& $node --no-warnings --experimental-strip-types apps\mqtt-broker\src\smoke.ts
exit $LASTEXITCODE
