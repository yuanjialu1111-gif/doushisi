param([string]$DecodedRoot)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$DecodedRoot) { $DecodedRoot = Join-Path $projectRoot '../../work/client-native-build' }
$sourceRoot = (Resolve-Path -LiteralPath $DecodedRoot).Path
if (!(Test-Path -LiteralPath (Join-Path $sourceRoot 'apktool.yml'))) { throw 'Expected a recovered Apktool project' }
$targetPath = Join-Path $projectRoot 'client/android/recovered-apktool.zip'
Add-Type -AssemblyName System.IO.Compression
$stream = [IO.File]::Open($targetPath, [IO.FileMode]::Create)
$zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
$count = 0
try {
  foreach ($file in Get-ChildItem -LiteralPath $sourceRoot -File -Recurse) {
    if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Links are not exportable' }
    $relative = [IO.Path]::GetRelativePath($sourceRoot, $file.FullName).Replace('\','/')
    if ($relative -match '^(build|dist)/') { continue }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $relative, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    $count++
  }
} finally { $zip.Dispose(); $stream.Dispose() }
[pscustomobject]@{path=$targetPath;files=$count;sha256=(Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash.ToLowerInvariant()} | ConvertTo-Json
