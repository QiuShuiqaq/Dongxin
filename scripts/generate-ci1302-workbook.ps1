param(
    [Parameter(Mandatory = $true)][string]$TemplatePath,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [string]$WordsPath,
    [switch]$NaturalSpeech
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $WordsPath) { $WordsPath = Join-Path $PSScriptRoot '../docs/ci1302/first-integration.words.json' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$xmlNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
$utf8 = [Text.UTF8Encoding]::new($false)

function Read-Part($Archive, [string]$Name) {
    $entry = $Archive.GetEntry($Name)
    if ($null -eq $entry) { throw "Missing workbook part: $Name" }
    $reader = [IO.StreamReader]::new($entry.Open(), $utf8, $true)
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

function Write-Part($Archive, [string]$Name, [xml]$Document) {
    $Archive.GetEntry($Name).Delete()
    $entry = $Archive.CreateEntry($Name)
    $stream = $entry.Open()
    try {
        $settings = [Xml.XmlWriterSettings]::new()
        $settings.Encoding = $utf8
        $settings.Indent = $false
        $writer = [Xml.XmlWriter]::Create($stream, $settings)
        try { $Document.Save($writer) } finally { $writer.Dispose() }
    } finally { $stream.Dispose() }
}

function Get-Namespaces([xml]$Document) {
    $manager = [Xml.XmlNamespaceManager]::new($Document.NameTable)
    $manager.AddNamespace('s', $xmlNamespace)
    return ,$manager
}

function Get-Frame([int]$Direction, [int]$Id) {
    $bytes = @(0xA5, 0xFA, 0x00, $Direction, ($Id -band 0xFF), (($Id -shr 8) -band 0xFF))
    $sum = ($bytes | Measure-Object -Sum).Sum -band 0xFF
    return (($bytes + @($sum, 0xFB) | ForEach-Object { '{0:X2}' -f [int]$_ }) -join ' ')
}

function Assert-Frame([string]$Frame, [int]$Direction, [int]$Id) {
    if ($Frame -notmatch '^[0-9A-F]{2}( [0-9A-F]{2}){7}$') { throw "Invalid frame: $Frame" }
    $bytes = @($Frame.Split(' ') | ForEach-Object { [Convert]::ToInt32($_, 16) })
    $sum = 0
    for ($i = 0; $i -lt 6; $i++) { $sum += $bytes[$i] }
    if ($bytes[0] -ne 0xA5 -or $bytes[1] -ne 0xFA -or $bytes[2] -ne 0 -or
        $bytes[3] -ne $Direction -or ($bytes[4] + 256 * $bytes[5]) -ne $Id -or
        $bytes[6] -ne ($sum -band 0xFF) -or $bytes[7] -ne 0xFB) {
        throw "Frame validation failed: $Frame"
    }
}

$templateFullPath = (Resolve-Path -LiteralPath $TemplatePath).Path
$outputFullPath = [IO.Path]::GetFullPath($OutputPath)
if ($templateFullPath -eq $outputFullPath) { throw 'Output must differ from the template.' }
if (Test-Path -LiteralPath $outputFullPath) { throw "Output already exists: $outputFullPath" }
if (-not (Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($outputFullPath)) -PathType Container)) {
    throw 'Output directory does not exist.'
}
$templateHash = (Get-FileHash -LiteralPath $templateFullPath -Algorithm SHA256).Hash
$source = Get-Content -LiteralPath $WordsPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (@($source.headers).Count -ne 7 -or @($source.rows).Count -lt 1) { throw 'Expected 7 headers and at least one word.' }
if (@($source.rows.word | Sort-Object -Unique).Count -ne @($source.rows).Count) { throw 'Duplicate command words.' }
$semanticFrames = @{}
foreach ($item in $source.rows) {
    $wordPattern = if ($NaturalSpeech) { '^[\u4e00-\u9fff]{2,8}$' } else { '^[\u4e00-\u9fff]{4,6}$' }
    if ($item.id -lt 1 -or $item.id -gt 65535 -or $item.word -notmatch $wordPattern) {
        throw 'Invalid semantic ID or command text.'
    }
    if (-not $item.type -or $item.mode -notin @([string][char]0x4E3B, [string][char]0x88AB) -or -not $item.reply) {
        throw "Invalid function, mode or reply: $($item.word)"
    }
    $stm32Command = if ($item.PSObject.Properties.Match('stm32Command').Count -gt 0) { $item.stm32Command } else { '' }
    $stm32Value = if ($item.PSObject.Properties.Match('stm32Value').Count -gt 0) { $item.stm32Value } else { '' }
    $signature = @($item.action, $item.type, $item.reply, $item.mode, $stm32Command, $stm32Value) -join '|'
    if ($semanticFrames.ContainsKey([string]$item.id)) {
        if ($semanticFrames[[string]$item.id] -cne $signature) { throw "Conflicting mapping for semantic ID $($item.id)" }
    } else { $semanticFrames[[string]$item.id] = $signature }
}

$originalParts = @{}
$templateArchive = [IO.Compression.ZipFile]::OpenRead($templateFullPath)
try {
    foreach ($entry in $templateArchive.Entries) {
        $originalParts[$entry.FullName] = Read-Part $templateArchive $entry.FullName
    }
} finally { $templateArchive.Dispose() }

[xml]$sheet = $originalParts['xl/worksheets/sheet1.xml']
[xml]$strings = $originalParts['xl/sharedStrings.xml']
$sheetNs = Get-Namespaces $sheet
$stringsNs = Get-Namespaces $strings
$stringRoot = $strings.DocumentElement
$stringIndex = [Collections.Generic.Dictionary[string, int]]::new([StringComparer]::Ordinal)
$existingStrings = @($strings.SelectNodes('/s:sst/s:si', $stringsNs))
for ($i = 0; $i -lt $existingStrings.Count; $i++) {
    if (-not $stringIndex.ContainsKey($existingStrings[$i].InnerText)) {
        $stringIndex.Add($existingStrings[$i].InnerText, $i)
    }
}
function Add-SharedString([string]$Value) {
    if ($stringIndex.ContainsKey($Value)) { return $stringIndex[$Value] }
    $index = $stringRoot.ChildNodes.Count
    $itemNode = $strings.CreateElement('si', $xmlNamespace)
    $textNode = $strings.CreateElement('t', $xmlNamespace)
    $textNode.InnerText = $Value
    [void]$itemNode.AppendChild($textNode)
    [void]$stringRoot.AppendChild($itemNode)
    $stringIndex.Add($Value, $index)
    return $index
}

$sheetData = $sheet.SelectSingleNode('/s:worksheet/s:sheetData', $sheetNs)
$naturalHeaders = @('语义标签', '最小功能词', '功能泛化词', '功能类型', '播报语句', '播报模式', '发送协议', '接收协议')
$expectedHeaders = if ($NaturalSpeech) { $naturalHeaders } else { @($source.headers) }
$columnCount = $expectedHeaders.Count
if ($sheetData.FirstChild.ChildNodes.Count -ne $columnCount) { throw 'Template column count does not match the selected layout.' }
for ($i = 0; $i -lt $columnCount; $i++) {
    $header = $sheetData.FirstChild.ChildNodes[$i]
    if ($existingStrings[[int]$header.LastChild.InnerText].InnerText -cne $expectedHeaders[$i]) {
        throw 'Unexpected template header.'
    }
}
$sampleRow = $sheetData.ChildNodes[1]
$naturalStyles = if ($NaturalSpeech) { @($sampleRow.ChildNodes | ForEach-Object { $_.GetAttribute('s') }) } else { @() }
foreach ($row in @($sheetData.ChildNodes | Select-Object -Skip 1)) { [void]$sheetData.RemoveChild($row) }
$rowNumber = 2
$previousId = $null
foreach ($item in $source.rows) {
    $row = $sheet.CreateElement('row', $xmlNamespace)
    $row.SetAttribute('r', [string]$rowNumber)
    $row.SetAttribute('spans', "1:$columnCount")
    if ($NaturalSpeech) {
        if ($item.id -eq $previousId) {
            $values = @('', '', [string]$item.word, [string]$item.type, '', '', '', '')
        } else {
            # Explicitly include each command phrase even if it is absent from the vendor's built-in function library.
            $generalization = if ($item.type -eq '唤醒词') { '' } else { [string]$item.word }
            $values = @([string]$item.id, [string]$item.word, $generalization, [string]$item.type,
                [string]$item.reply, [string]$item.mode, (Get-Frame 0x81 $item.id), (Get-Frame 0x82 $item.id))
        }
    } else {
        $values = @([string]$item.id, [string]$item.word, [string]$item.type, [string]$item.reply, [string]$item.mode,
            (Get-Frame 0x81 $item.id), (Get-Frame 0x82 $item.id))
    }
    for ($col = 0; $col -lt $columnCount; $col++) {
        $cell = $sheet.CreateElement('c', $xmlNamespace)
        $cell.SetAttribute('r', ([string][char](65 + $col) + $rowNumber))
        if ($NaturalSpeech) {
            if ($naturalStyles[$col]) { $cell.SetAttribute('s', $naturalStyles[$col]) }
        } else {
            if ($col -eq 0) { $cell.SetAttribute('s', '1') }
            if ($col -ge 5) { $cell.SetAttribute('s', '20') }
        }
        if ($values[$col] -ne '') {
            $value = $sheet.CreateElement('v', $xmlNamespace)
            if ($col -eq 0) { $value.InnerText = $values[$col] }
            else {
                $cell.SetAttribute('t', 's')
                $value.InnerText = [string](Add-SharedString $values[$col])
            }
            [void]$cell.AppendChild($value)
        }
        [void]$row.AppendChild($cell)
    }
    [void]$sheetData.AppendChild($row)
    $rowNumber++
    $previousId = $item.id
}
$lastRow = $rowNumber - 1
$lastColumn = [string][char](64 + $columnCount)
$sheet.SelectSingleNode('/s:worksheet/s:dimension', $sheetNs).SetAttribute('ref', "A1:$lastColumn$lastRow")
$validations = @($sheet.SelectNodes('/s:worksheet/s:dataValidations/s:dataValidation', $sheetNs))
$typeValidation = @($validations | Where-Object { $_.FirstChild.InnerText -match '唤醒词' })[0]
$modeValidation = @($validations | Where-Object { $_.FirstChild.InnerText -match '主,被' })[0]
if (-not $typeValidation -or -not $modeValidation) { throw 'Template validation lists are missing.' }
$allowedTypes = $typeValidation.FirstChild.InnerText.Trim('"').Split(',')
foreach ($item in $source.rows) {
    if ($item.type -notin $allowedTypes) { throw "Function type is not in template validation: $($item.word)" }
}
$typeColumn = if ($NaturalSpeech) { 'D' } else { 'C' }
$modeColumn = if ($NaturalSpeech) { 'F' } else { 'E' }
$typeValidation.SetAttribute('sqref', "${typeColumn}2:${typeColumn}$lastRow")
$modeValidation.SetAttribute('sqref', "${modeColumn}2:${modeColumn}$lastRow")
$selection = $sheet.SelectSingleNode('/s:worksheet/s:sheetViews/s:sheetView/s:selection', $sheetNs)
$selection.SetAttribute('activeCell', 'A1')
$selection.SetAttribute('sqref', 'A1')
$stringRoot.SetAttribute('uniqueCount', [string]$stringRoot.ChildNodes.Count)
$sharedReferenceCount = $sheet.SelectNodes('//s:c[@t="s"]', $sheetNs).Count
foreach ($name in @($originalParts.Keys | Where-Object { $_ -match '^xl/worksheets/sheet\d+\.xml$' -and $_ -ne 'xl/worksheets/sheet1.xml' })) {
    [xml]$otherSheet = $originalParts[$name]
    $sharedReferenceCount += $otherSheet.SelectNodes('//s:c[@t="s"]', (Get-Namespaces $otherSheet)).Count
}
$stringRoot.SetAttribute('count', [string]$sharedReferenceCount)

Copy-Item -LiteralPath $templateFullPath -Destination $outputFullPath
$outputArchive = [IO.Compression.ZipFile]::Open($outputFullPath, [IO.Compression.ZipArchiveMode]::Update)
try {
    Write-Part $outputArchive 'xl/worksheets/sheet1.xml' $sheet
    Write-Part $outputArchive 'xl/sharedStrings.xml' $strings
} finally { $outputArchive.Dispose() }

# Validate persisted cells and verify that all other template parts are untouched.
$checkArchive = [IO.Compression.ZipFile]::OpenRead($outputFullPath)
try {
    if ($checkArchive.Entries.Count -ne $originalParts.Count) { throw 'Workbook part count changed.' }
    foreach ($entry in $checkArchive.Entries) {
        $content = Read-Part $checkArchive $entry.FullName
        if ($entry.FullName -match '\.xml$|\.rels$') { [void]([xml]$content) }
        if ($entry.FullName -notin @('xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml') -and
            $content -cne $originalParts[$entry.FullName]) { throw "Template part changed: $($entry.FullName)" }
    }
    [xml]$savedSheet = Read-Part $checkArchive 'xl/worksheets/sheet1.xml'
    [xml]$savedStrings = Read-Part $checkArchive 'xl/sharedStrings.xml'
    $savedNs = Get-Namespaces $savedSheet
    $savedStringNodes = @($savedStrings.SelectNodes('/s:sst/s:si', (Get-Namespaces $savedStrings)))
    $savedRows = @($savedSheet.SelectNodes('/s:worksheet/s:sheetData/s:row', $savedNs))
    if ($savedRows.Count -ne (@($source.rows).Count + 1)) { throw 'Incorrect saved row count.' }
    $allFrames = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    for ($i = 0; $i -lt $savedRows.Count; $i++) {
        $cells = @($savedRows[$i].SelectNodes('s:c', $savedNs))
        if ($cells.Count -ne $columnCount) { throw 'Incorrect saved column count.' }
        $actual = @($cells | ForEach-Object {
            $valueNode = $_.SelectSingleNode('s:v', $savedNs)
            if ($null -eq $valueNode) { '' }
            elseif ($_.GetAttribute('t') -eq 's') { $savedStringNodes[[int]$valueNode.InnerText].InnerText }
            else { $valueNode.InnerText }
        })
        if ($i -eq 0) { $expected = @($expectedHeaders) }
        else {
            $item = $source.rows[$i - 1]
            if ($NaturalSpeech) {
                $priorId = if ($i -gt 1) { $source.rows[$i - 2].id } else { $null }
                if ($item.id -eq $priorId) {
                    $expected = @('', '', [string]$item.word, [string]$item.type, '', '', '', '')
                } else {
                    $generalization = if ($item.type -eq '唤醒词') { '' } else { [string]$item.word }
                    $expected = @([string]$item.id, [string]$item.word, $generalization, [string]$item.type,
                        [string]$item.reply, [string]$item.mode, (Get-Frame 0x81 $item.id), (Get-Frame 0x82 $item.id))
                    if ($cells[0].GetAttribute('t') -eq 's') { throw 'Semantic ID must be numeric.' }
                    Assert-Frame $actual[6] 0x81 ([int]$actual[0])
                    Assert-Frame $actual[7] 0x82 ([int]$actual[0])
                    if (-not $allFrames.Add($actual[6]) -or -not $allFrames.Add($actual[7])) {
                        throw 'Duplicate protocol frame across semantic IDs.'
                    }
                }
            } else {
                $expected = @([string]$item.id, $item.word, $item.type, $item.reply, $item.mode,
                    (Get-Frame 0x81 $item.id), (Get-Frame 0x82 $item.id))
                if ($cells[0].GetAttribute('t') -eq 's') { throw 'Semantic ID must be numeric.' }
                Assert-Frame $actual[5] 0x81 ([int]$actual[0])
                Assert-Frame $actual[6] 0x82 ([int]$actual[0])
                foreach ($frame in $actual[5..6]) {
                    if (-not $allFrames.Add($frame) -and @($source.rows | Where-Object { $_.id -eq $item.id }).Count -eq 1) {
                        throw 'Duplicate protocol frame across semantic IDs.'
                    }
                }
            }
        }
        for ($col = 0; $col -lt $columnCount; $col++) {
            if ($actual[$col] -cne $expected[$col]) { throw "Saved cell mismatch at row $($i + 1), column $($col + 1)." }
        }
        if ($i -gt 0) { Write-Output ($actual -join ' | ') }
    }
} finally { $checkArchive.Dispose() }
if ((Get-FileHash -LiteralPath $templateFullPath -Algorithm SHA256).Hash -ne $templateHash) {
    throw 'Original template changed.'
}
Write-Output "PASS: $(@($source.rows).Count) words, $($semanticFrames.Count) semantics, $($allFrames.Count) protocol frames, checksum validation, unchanged template and other workbook parts."
Write-Output "Output: $outputFullPath"
Write-Output "SHA256: $((Get-FileHash -LiteralPath $outputFullPath -Algorithm SHA256).Hash)"
