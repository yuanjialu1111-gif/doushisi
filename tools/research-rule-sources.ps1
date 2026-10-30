param([int]$TimeoutSeconds = 15)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '../..'))
$reportPath = Join-Path $projectRoot 'docs/rules/github-recheck.json'
$treePath = Join-Path $workspaceRoot 'work/github/qmcloud-chess/_file-tree.json'
$tree = Get-Content -LiteralPath $treePath -Raw | ConvertFrom-Json
$commit = '5f2d792775ca40e6d86c85b5c29f431e133cdb79'
if ($tree.sha -ne $commit) { throw 'Unexpected evidence commit' }
$archivePaths = @($tree.paths | Where-Object { $_ -match '\.zip$' })
$wantedPaths = @('README.md', '98k房卡/web/GameAdminWeb.csproj', '98k房卡/web/cs/file/src/app.zip', '98k房卡/web/qqq/file/src/app.zip')
$records = @()
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.IO.Compression
$client = [Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
try {
  foreach ($repoPath in $wantedPaths) {
    $encodedPath = (($repoPath -split '/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/'
    $url = "https://raw.githubusercontent.com/qmcloud/chess/$commit/$encodedPath"
    $record = [ordered]@{ path = $repoPath; url = $url; status = 'unread'; bytes = 0; sha256 = $null; entries = @(); textExcerpt = $null; error = $null }
    try {
      $response = $client.GetAsync($url, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
      try {
        $response.EnsureSuccessStatusCode() | Out-Null
        if ($response.Content.Headers.ContentLength -gt 33554432) { throw 'Archive exceeds 32 MiB research limit' }
        $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        if ($bytes.Length -gt 33554432) { throw 'Response exceeds 32 MiB research limit' }
      } finally { $response.Dispose() }
      $record.bytes = $bytes.Length
      $sha = [Security.Cryptography.SHA256]::Create()
      try { $record.sha256 = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
      if ($repoPath -match '\.zip$') {
        $stream = [IO.MemoryStream]::new($bytes, $false)
        $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Read)
        try {
          if ($archive.Entries.Count -gt 10000) { throw 'Too many ZIP entries for bounded research' }
          $record.entries = @($archive.Entries | ForEach-Object { [ordered]@{ path=$_.FullName; bytes=$_.Length; compressedBytes=$_.CompressedLength } })
          $record.status = 'zip-inventory-read-no-third-party-execution'
        } finally { $archive.Dispose(); $stream.Dispose() }
      } else {
        $text = [Text.Encoding]::UTF8.GetString($bytes)
        $record.textExcerpt = $text.Substring(0,[Math]::Min($text.Length,12000))
        $record.status = 'text-read-no-third-party-execution'
      }
    } catch {
      $record.status = 'request-failed-or-bounded'
      $record.error = $_.Exception.Message
    }
    $records += $record
    Write-Host ($repoPath + ': ' + $record.status)
  }
} finally { $client.Dispose() }
$result = [ordered]@{
  checkedAtUtc = [DateTime]::UtcNow.ToString('o')
  repository = 'qmcloud/chess'
  commit = $commit
  cachedTreePaths = $tree.paths.Count
  cachedTreeArchivePaths = $archivePaths
  rootLicensePaths = @($tree.paths | Where-Object { $_ -match '^(LICENSE|COPYING|NOTICE)(\.[^/]+)?$' })
  archiveScope = 'Two src/app.zip payloads only; other nested archives remain unverified. Inventory does not prove absence of obfuscated game rules.'
  executedThirdPartyCode = $false
  records = $records
}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Host ('Research report: ' + $reportPath)
