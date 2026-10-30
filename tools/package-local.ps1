param(
  [Parameter(Mandatory=$true)][string]$Destination,
  [switch]$AllowIncomplete
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$target = [IO.Path]::GetFullPath($Destination)

if (!$AllowIncomplete) {
  Push-Location $root
  try {
    & node tools/release-check.mjs --local
    if ($LASTEXITCODE -ne 0) { throw 'Local acceptance is not complete; packaging was refused.' }
    # Refresh the production readiness report that is copied into the package.
    # Without this step a stale release-readiness.json from an earlier subject
    # could be shipped even though the current formal evidence is complete.
    & node tools/release-check.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Production acceptance is not complete; packaging was refused.' }
  } finally {
    Pop-Location
  }
}

if (Test-Path -LiteralPath $target) { throw 'Packaging requires a new empty destination.' }
New-Item -ItemType Directory -Path $target | Out-Null

function Ensure-Directory([string]$Path) {
  if (!(Test-Path -LiteralPath $Path -PathType Container)) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
  }
}

function Copy-RequiredFile([string]$Source, [string]$Destination) {
  if (!(Test-Path -LiteralPath $Source -PathType Leaf)) { throw "Required file is missing: $Source" }
  Ensure-Directory (Split-Path -Parent $Destination)
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

function Copy-RequiredDirectory([string]$Source, [string]$Destination) {
  if (!(Test-Path -LiteralPath $Source -PathType Container)) { throw "Required directory is missing: $Source" }
  Ensure-Directory (Split-Path -Parent $Destination)
  if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
  Ensure-Directory $Destination
  Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
}

function Get-TextHash([string]$Text) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return (($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)) | ForEach-Object { $_.ToString('x2') }) -join '')
  } finally {
    $sha.Dispose()
  }
}

function Get-RelativeUnixPath([string]$Base, [string]$Path) {
  return $Path.Substring($Base.Length).TrimStart('\','/').Replace('\','/')
}

function Get-DirectoryDigest([string]$Path) {
  $base = [IO.Path]::GetFullPath($Path)
  $files = @(Get-ChildItem -LiteralPath $base -Recurse -File -Force | Sort-Object FullName)
  $records = foreach ($file in $files) {
    $relative = Get-RelativeUnixPath $base $file.FullName
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$relative`:$hash"
  }
  return Get-TextHash (($records -join "`n"))
}

function Get-DirectoryRecord([string]$Base, [string]$Path) {
  $absolute = [IO.Path]::GetFullPath($Path)
  $files = @(Get-ChildItem -LiteralPath $absolute -Recurse -File -Force)
  return [ordered]@{
    path = Get-RelativeUnixPath $Base $absolute
    sha256 = Get-DirectoryDigest $absolute
    fileCount = $files.Count
  }
}

function Get-FileRecord([string]$Base, [string]$Path) {
  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required packaged file is missing: $Path" }
  return [ordered]@{
    path = Get-RelativeUnixPath $Base $Path
    sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

function Resolve-ProjectArtifactPath {
  param(
    [Parameter(Mandatory=$true)][string]$Root,
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Label
  )
  if ([string]::IsNullOrWhiteSpace($Path)) { throw "$Label path is empty." }
  $normalized = $Path.Replace('/', [IO.Path]::DirectorySeparatorChar)
  $absolute = if ($normalized -match '^[A-Za-z]:' -or $normalized.StartsWith('\\')) {
    [IO.Path]::GetFullPath($normalized)
  } else {
    [IO.Path]::GetFullPath((Join-Path $Root $normalized))
  }
  $base = [IO.Path]::GetFullPath($Root).TrimEnd(
    [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  ) + [IO.Path]::DirectorySeparatorChar
  if (!$absolute.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) {
    throw "$Label escapes the project root: $Path"
  }
  try {
    $resolved = (Resolve-Path -LiteralPath $absolute -ErrorAction Stop).Path
  } catch {
    throw "$Label does not exist inside the project root: $Path"
  }
  $resolved = [IO.Path]::GetFullPath($resolved)
  if (!$resolved.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) {
    throw "$Label resolves outside the project root: $Path"
  }
  $item = Get-Item -LiteralPath $resolved -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "$Label must not be a symlink or reparse point: $Path"
  }
  return $resolved
}

function Get-ReportPassed([string]$ReportName, [object]$ReportJson) {
  if ($ReportName -eq 'local-readiness.json') { return $ReportJson.localReady -eq $true }
  if ($ReportName -eq 'release-readiness.json') { return $ReportJson.releaseReady -eq $true }
  return $ReportJson.passed -eq $true
}

function Test-ForbiddenArtifact([string]$Path) {
  $name = [IO.Path]::GetFileName($Path)
  $relative = $Path.Replace('\','/')
  if ($name -like '.env*' -and $name -notlike '*.example') { return $true }
  $extension = [IO.Path]::GetExtension($name).ToLowerInvariant()
  if (@('.jks','.keystore','.p12','.pfx','.pem','.key') -contains $extension) { return $true }
  if ($name -eq 'local-access.json') { return $true }
  if ($name -like '*signing-credential*') { return $true }
  if ($name -eq 'lan-config.json') { return $true }
  if ($relative -like '.local/*' -or $relative -like '*/.local/*') { return $true }
  return $false
}

function Assert-NoForbiddenArtifacts([string]$Path) {
  $forbidden = @(Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object { Test-ForbiddenArtifact $_.FullName })
  if ($forbidden.Count -gt 0) {
    $names = ($forbidden | ForEach-Object { Get-RelativeUnixPath $target $_.FullName } | Sort-Object) -join ', '
    throw "Unexpected credentials or private runtime files in the exported package: $names"
  }
}

function Assert-NoForbiddenFiles([string]$Source, [string]$Label) {
  if (!(Test-Path -LiteralPath $Source -PathType Container)) { return }
  $forbidden = @(Get-ChildItem -LiteralPath $Source -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object { Test-ForbiddenArtifact $_.FullName })
  if ($forbidden.Count -gt 0) { throw "Prohibited files are present in $Label; packaging was refused." }
}

function Assert-AndroidArtifactReport {
  param(
    [Parameter(Mandatory=$true)][string]$Root,
    [Parameter(Mandatory=$true)][object]$Report,
    [Parameter(Mandatory=$true)][string]$ReportRelativePath,
    [string]$ExpectedApkSha256,
    [string]$ExpectedIdsigSha256 = $null,
    [string]$ExpectedCertificateSha256 = $null,
    [string[]]$ExpectedPaths = @()
  )

  if ([int]$Report.schemaVersion -ne 1) {
    throw "Android artifact report has an unsupported schema version: $ReportRelativePath"
  }
  if ($Report.passed -ne $true) {
    throw "Android artifact report did not pass: $ReportRelativePath"
  }
  if ([string]::IsNullOrWhiteSpace([string]$Report.apk.sha256) -or
      [string]::IsNullOrWhiteSpace([string]$Report.apk.path)) {
    throw "Android artifact report has no APK path or SHA-256: $ReportRelativePath"
  }
  if ([string]::IsNullOrWhiteSpace([string]$Report.idsig.sha256) -or
      [string]::IsNullOrWhiteSpace([string]$Report.idsig.path)) {
    throw "Android artifact report has no idsig path or SHA-256: $ReportRelativePath"
  }

  $apkPath = Resolve-ProjectArtifactPath -Root $Root -Path ([string]$Report.apk.path) -Label "$ReportRelativePath:apk.path"
  $idsigPath = Resolve-ProjectArtifactPath -Root $Root -Path ([string]$Report.idsig.path) -Label "$ReportRelativePath:idsig.path"

  if ($ExpectedPaths.Count -gt 0) {
    $pathMatched = $false
    foreach ($expectedPath in @($ExpectedPaths)) {
      $normalizedExpected = [IO.Path]::GetFullPath([string]$expectedPath)
      if ([string]::Equals($normalizedExpected, $apkPath, [StringComparison]::OrdinalIgnoreCase)) {
        $pathMatched = $true
        break
      }
    }
    if (!$pathMatched) {
      throw "Android artifact report APK path is not an expected build output: $ReportRelativePath"
    }
  }

  $actualApkSha256 = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualApkSha256 -ne ([string]$Report.apk.sha256).ToLowerInvariant()) {
    throw "Android artifact report APK SHA-256 does not match the file on disk: $ReportRelativePath"
  }
  if ($ExpectedApkSha256 -and $actualApkSha256 -ne $ExpectedApkSha256.ToLowerInvariant()) {
    throw "Android artifact report APK SHA-256 does not match the accepted APK: $ReportRelativePath"
  }

  $actualIdsigSha256 = (Get-FileHash -LiteralPath $idsigPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualIdsigSha256 -ne ([string]$Report.idsig.sha256).ToLowerInvariant()) {
    throw "Android artifact report idsig SHA-256 does not match the file on disk: $ReportRelativePath"
  }
  if ($ExpectedIdsigSha256 -and $actualIdsigSha256 -ne $ExpectedIdsigSha256.ToLowerInvariant()) {
    throw "Android artifact report idsig SHA-256 does not match the expected idsig: $ReportRelativePath"
  }

  $certificateSha256 = ([string]$Report.signing.certificateSha256).ToLowerInvariant()
  $expectedCertificate = ([string]$Report.signing.expectedCertificateSha256).ToLowerInvariant()
  if ($certificateSha256 -notmatch '^[0-9a-f]{64}$' -or
      $expectedCertificate -notmatch '^[0-9a-f]{64}$' -or
      $certificateSha256 -ne $expectedCertificate) {
    throw "Android artifact report signing certificate is not pinned: $ReportRelativePath"
  }
  if ($ExpectedCertificateSha256 -and $certificateSha256 -ne $ExpectedCertificateSha256.ToLowerInvariant()) {
    throw "Android artifact report signing certificate does not match the expected certificate: $ReportRelativePath"
  }
  if ($Report.signing.v2 -ne $true -or $Report.signing.v3 -ne $true -or $Report.signing.v4 -ne $true) {
    throw "Android artifact report is missing v2/v3/v4 signatures: $ReportRelativePath"
  }
}

function Assert-ApkSignatureVerified {
  param(
    [Parameter(Mandatory=$true)][string]$Root,
    [Parameter(Mandatory=$true)][object]$Report,
    [Parameter(Mandatory=$true)][string]$ReportRelativePath,
    [Parameter(Mandatory=$true)][string]$ExpectedCertificateSha256
  )

  $workspaceRoot = [IO.Path]::GetFullPath((Join-Path $Root '../..'))
  $toolchainRoot = Join-Path $workspaceRoot 'work/client-build'
  $javaHome = if ($env:DOUSHISI_JAVA_HOME) { $env:DOUSHISI_JAVA_HOME } else {
    Join-Path $toolchainRoot 'java/zulu17.68.203-ca-jre17.0.20.1-win_x64'
  }
  $buildTools = if ($env:DOUSHISI_BUILD_TOOLS) { $env:DOUSHISI_BUILD_TOOLS } else {
    Join-Path $toolchainRoot 'android-sdk/android-15'
  }
  $java = Join-Path $javaHome 'bin/java.exe'
  if (!(Test-Path -LiteralPath $java -PathType Leaf)) {
    $discovered = @(Get-ChildItem -LiteralPath (Join-Path $toolchainRoot 'java') -Recurse -File -Filter 'java.exe' -ErrorAction SilentlyContinue)
    if ($discovered.Count -gt 0) { $java = $discovered[0].FullName }
  }
  $apksignerJar = Join-Path $buildTools 'lib/apksigner.jar'
  if (!(Test-Path -LiteralPath $java -PathType Leaf)) {
    throw "Independent APK signature verification needs java.exe. Set DOUSHISI_JAVA_HOME. Missing: $java"
  }
  if (!(Test-Path -LiteralPath $apksignerJar -PathType Leaf)) {
    throw "Independent APK signature verification needs apksigner.jar. Set DOUSHISI_BUILD_TOOLS. Missing: $apksignerJar"
  }

  $apkPath = Resolve-ProjectArtifactPath -Root $Root -Path ([string]$Report.apk.path) -Label "$ReportRelativePath:apk.path"
  $idsigPath = Resolve-ProjectArtifactPath -Root $Root -Path ([string]$Report.idsig.path) -Label "$ReportRelativePath:idsig.path"

  $v23Output = & $java -jar $apksignerJar verify --verbose --print-certs $apkPath 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Independent APK signature verification failed (v2/v3): $ReportRelativePath"
  }
  $v23Text = ($v23Output -join [Environment]::NewLine)
  if ($v23Text -notmatch 'Verified using v2 scheme \(APK Signature Scheme v2\): true') {
    throw "Independent APK signature verification did not confirm v2: $ReportRelativePath"
  }
  if ($v23Text -notmatch 'Verified using v3 scheme \(APK Signature Scheme v3\): true') {
    throw "Independent APK signature verification did not confirm v3: $ReportRelativePath"
  }
  $certificateMatch = [regex]::Match($v23Text, 'Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F]{64})')
  if (!$certificateMatch.Success) {
    throw "Independent APK signature verification did not report a signer certificate: $ReportRelativePath"
  }
  $verifiedCertificate = $certificateMatch.Groups[1].Value.ToLowerInvariant()
  if ($verifiedCertificate -ne $ExpectedCertificateSha256.ToLowerInvariant()) {
    throw "Independent APK signature verification found an unexpected certificate: $ReportRelativePath"
  }

  $v4Output = & $java -jar $apksignerJar verify --v4-signature-file $idsigPath --verbose $apkPath 2>&1
  if ($LASTEXITCODE -ne 0 -or (($v4Output -join [Environment]::NewLine) -notmatch 'Verified using v4 scheme \(APK Signature Scheme v4\): true')) {
    throw "Independent APK signature verification did not confirm v4: $ReportRelativePath"
  }
}

function Assert-ProductionManifest([string]$Root, [string]$ReleaseSubject, [string]$ExpectedApkSha256) {
  $manifestPath = Join-Path $Root 'verification/production-acceptance.json'
  if (!(Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'Production acceptance manifest is missing from the exported package.'
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ([int]$manifest.formatVersion -ne 1) {
    throw 'Production acceptance manifest has an unsupported format version.'
  }
  if ([string]$manifest.releaseSubject.sha256 -ne $ReleaseSubject) {
    throw 'Production acceptance manifest is not bound to the current release subject.'
  }
  if ([string]$manifest.apk.sha256 -ne $ExpectedApkSha256) {
    throw 'Production acceptance manifest is not bound to the accepted APK.'
  }
  $buildRecord = Get-FileRecord $Root (Join-Path $Root 'verification/build-manifest.json')
  if ([string]$manifest.buildManifest.sha256 -ne [string]$buildRecord.sha256) {
    throw 'Production acceptance manifest does not match the packaged build manifest.'
  }
  $apkRecord = Get-FileRecord $Root (Join-Path $Root 'client/doushisi.apk')
  if ([string]$apkRecord.sha256 -ne $ExpectedApkSha256) {
    throw 'Packaged APK does not match the hash recorded by production acceptance.'
  }
  foreach ($report in @($manifest.reports)) {
    if ($report.passed -ne $true -or [string]$report.subjectSha256 -ne $ReleaseSubject) {
      throw ('Production acceptance report is not a passing report for the current subject: ' + [string]$report.path)
    }
    $reportPath = Resolve-ProjectArtifactPath -Root $Root -Path ([string]$report.path) -Label 'production-acceptance report path'
    $record = Get-FileRecord $Root $reportPath
    if ([string]$record.sha256 -ne [string]$report.sha256) {
      throw ('Packaged report does not match production acceptance: ' + [string]$report.path)
    }
  }
  foreach ($output in @($manifest.outputs)) {
    $outputPath = Resolve-ProjectArtifactPath -Root $Root -Path ([string]$output.path) -Label 'production-acceptance output path'
    $record = Get-FileRecord $Root $outputPath
    if ([string]$record.sha256 -ne [string]$output.sha256) {
      throw ('Packaged output does not match production acceptance: ' + [string]$output.path)
    }
  }
}

$workspaceState = Join-Path $root 'node_modules/.pnpm-workspace-state-v1.json'
$stateBackup = Join-Path ([IO.Path]::GetTempPath()) ('dss-pnpm-' + [Guid]::NewGuid().ToString() + '.json')
if (Test-Path -LiteralPath $workspaceState) { Copy-Item -LiteralPath $workspaceState -Destination $stateBackup }
Push-Location $root
try {
  & pnpm --filter @dss/server deploy --legacy --prod (Join-Path $target 'apps/server')
  if ($LASTEXITCODE -ne 0) { throw 'Production dependency export failed.' }

  # Keep the deployed production dependency tree, then make the runtime and
  # migration inputs explicit so a stale deploy cache cannot silently omit them.
  Copy-RequiredDirectory (Join-Path $root 'apps/server/dist') (Join-Path $target 'apps/server/dist')
  Copy-RequiredDirectory (Join-Path $root 'apps/server/migrations') (Join-Path $target 'apps/server/migrations')
  Copy-RequiredDirectory (Join-Path $root 'apps/admin/dist') (Join-Path $target 'apps/admin/dist')
  Copy-RequiredDirectory (Join-Path $root 'client/public') (Join-Path $target 'client/public')
  $releaseSubject = & node (Join-Path $root 'tools/print-source-fingerprint.mjs') --subject
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace([string]$releaseSubject)) {
    throw 'Unable to compute the release subject for the exported package.'
  }
  $releaseSubject = ([string]$releaseSubject).Trim()
  if ($releaseSubject -notmatch '^[0-9a-f]{64}$') {
    throw 'The release subject is not a lowercase SHA-256 digest.'
  }
  Copy-RequiredDirectory (Join-Path $root 'packages/rules/dist') (Join-Path $target 'packages/rules/dist')
  Copy-RequiredDirectory (Join-Path $root 'packages/protocol/dist') (Join-Path $target 'packages/protocol/dist')
  $nativeReportPath = Join-Path $root 'verification/local-native.json'
  if (!(Test-Path -LiteralPath $nativeReportPath -PathType Leaf)) {
    throw 'Local native acceptance evidence is missing; cannot choose a release APK.'
  }
  $nativeReport = Get-Content -LiteralPath $nativeReportPath -Raw | ConvertFrom-Json
  if ($nativeReport.passed -ne $true -or [string]::IsNullOrWhiteSpace([string]$nativeReport.apkSha256) -or
      [string]$nativeReport.subjectBeforeSha256 -ne $releaseSubject -or
      [string]$nativeReport.subjectAfterSha256 -ne $releaseSubject) {
    throw 'Local native acceptance has not passed; cannot choose a release APK.'
  }
  $expectedApkSha256 = ([string]$nativeReport.apkSha256).ToLowerInvariant()
  $releaseApkCandidates = @(
    (Join-Path $root 'client/android/doushisi.apk')
  )
  $releaseApkSource = $null
  foreach ($candidate in $releaseApkCandidates) {
    if (!(Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    $candidateHash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($candidateHash -eq $expectedApkSha256) { $releaseApkSource = $candidate; break }
  }
  if (!$releaseApkSource) {
    throw 'No APK matches the hash bound by the passed local native acceptance report.'
  }
  Copy-RequiredFile $releaseApkSource (Join-Path $target 'client/doushisi.apk')

  Copy-RequiredDirectory (Join-Path $PSScriptRoot 'test') (Join-Path $target 'tools/test')
  foreach ($script in @('local-run.ps1','local-shortcuts.ps1','build-fingerprint.mjs','print-source-fingerprint.mjs',
      'release-audit.mjs','release-check.mjs','run-local-stability.mjs','rulebook-integrity.mjs',
      'settlement-regressions.mjs','verify-backup-windows.ps1','verify-backup.mjs')) {
    Copy-RequiredFile (Join-Path $PSScriptRoot $script) (Join-Path $target ('tools/' + $script))
  }
  Copy-RequiredFile (Join-Path $root 'deploy/backup-lib.mjs') (Join-Path $target 'deploy/backup-lib.mjs')
  Copy-RequiredFile (Join-Path $root 'deploy/backup-cli.mjs') (Join-Path $target 'deploy/backup-cli.mjs')
  Copy-RequiredFile (Join-Path $root 'verification/build-manifest.json') (Join-Path $target 'verification/build-manifest.json')
  $productionManifestPath = Join-Path $root 'verification/production-acceptance.json'
  if (!(Test-Path -LiteralPath $productionManifestPath -PathType Leaf)) {
    throw 'Production acceptance manifest is missing. Run node tools/package-production-acceptance.mjs . first.'
  }
  Copy-RequiredFile $productionManifestPath (Join-Path $target 'verification/production-acceptance.json')

  $runtimeSource = Join-Path $root 'runtime/node.exe'
  if (!(Test-Path -LiteralPath $runtimeSource -PathType Leaf)) {
    $runtimeSource = (Get-Command node.exe -ErrorAction Stop).Source
  }
  Copy-RequiredFile $runtimeSource (Join-Path $target 'runtime/node.exe')

  Copy-RequiredFile (Join-Path $root 'docs/local-operations.md') (Join-Path $target 'README.md')
  Copy-RequiredFile (Join-Path $root 'docs/local-operations.md') (Join-Path $target 'docs/local-operations.md')
  if (Test-Path -LiteralPath (Join-Path $root 'README.md') -PathType Leaf) {
    Copy-RequiredFile (Join-Path $root 'README.md') (Join-Path $target 'README.project.md')
  }
  if (Test-Path -LiteralPath (Join-Path $root 'README.zh-CN.md') -PathType Leaf) {
    Copy-RequiredFile (Join-Path $root 'README.zh-CN.md') (Join-Path $target 'README.zh-CN.md')
  }
  Copy-RequiredFile (Join-Path $root 'package.json') (Join-Path $target 'package.json')
  Copy-RequiredFile (Join-Path $root 'pnpm-lock.yaml') (Join-Path $target 'pnpm-lock.yaml')
  Copy-RequiredFile (Join-Path $root 'pnpm-workspace.yaml') (Join-Path $target 'pnpm-workspace.yaml')
  Copy-RequiredDirectory (Join-Path $root 'docs/rules/release') (Join-Path $target 'docs/rules/release')
  # Reports reference the independent regional rulebooks and the variant
  # sources they were derived from, so carry that whole source-evidence tree.
  Copy-RequiredDirectory (Join-Path $root 'docs/rules/variants') (Join-Path $target 'docs/rules/variants')
  $independentRulebooks = @(Get-ChildItem -LiteralPath (Join-Path $root 'docs/rules') -File -Filter '*-INDEPENDENT.md' | Sort-Object Name)
  if ($independentRulebooks.Count -eq 0) { throw 'No independent regional rulebooks were found for the package.' }
  Ensure-Directory (Join-Path $target 'docs/rules')
  foreach ($rulebook in $independentRulebooks) {
    Copy-RequiredFile $rulebook.FullName (Join-Path $target ('docs/rules/' + $rulebook.Name))
  }

  # A complete package must carry the whole formal report set. The explicit
  # -AllowIncomplete switch is only for diagnostic staging, never for delivery.
  $reportNames = @(
    'local-readiness.json',
    'release-readiness.json',
    'local-ui.json',
    'local-accounting.json',
    'local-network.json',
    'local-recovery.json',
    'local-completed-games.json',
    'local-native-preflight.json',
    'local-native.json',
    'original-ui-comparison.json',
    'original-network-isolation.json',
    'gameplay-capacity.json',
    'postgres-concurrency.json',
    'native-end-to-end.json',
    'android-release-build.json',
    'android-acceptance-driver-build.json',
    'local-stability.json'
  )
  $reportRecords = @()
  $missing = @()
  $releaseCertificateSha256 = $null
  Assert-NoForbiddenFiles (Join-Path $root 'verification') 'verification evidence'
  foreach ($reportName in $reportNames) {
    $sourceReport = Join-Path $root ('verification/' + $reportName)
    $targetReport = Join-Path $target ('verification/' + $reportName)
    $relativeReport = 'verification/' + $reportName
    if (Test-Path -LiteralPath $sourceReport -PathType Leaf) {
      Copy-RequiredFile $sourceReport $targetReport
      $record = Get-FileRecord $target $targetReport
      $sourceReportJson = Get-Content -LiteralPath $sourceReport -Raw | ConvertFrom-Json
      $reportPassed = Get-ReportPassed $reportName $sourceReportJson
      if (!$AllowIncomplete -and $reportName -eq 'android-release-build.json') {
        if (!$reportPassed) { throw "Required acceptance report did not pass: $relativeReport" }
        Assert-AndroidArtifactReport -Root $root -Report $sourceReportJson -ReportRelativePath $relativeReport -ExpectedApkSha256 $expectedApkSha256 -ExpectedPaths @($releaseApkSource)
        $releaseCertificateSha256 = ([string]$sourceReportJson.signing.certificateSha256).ToLowerInvariant()
        Assert-ApkSignatureVerified -Root $root -Report $sourceReportJson -ReportRelativePath $relativeReport -ExpectedCertificateSha256 $releaseCertificateSha256
        $sourceReportJson | Add-Member -NotePropertyName bindingKind -NotePropertyValue 'release-apk' -Force
        $sourceReportJson | Add-Member -NotePropertyName boundApkSha256 -NotePropertyValue $expectedApkSha256 -Force
      } elseif (!$AllowIncomplete -and $reportName -eq 'android-acceptance-driver-build.json') {
        if (!$reportPassed) { throw "Required acceptance report did not pass: $relativeReport" }
        if ([string]::IsNullOrWhiteSpace([string]$nativeReport.driverApkSha256)) {
          throw 'Acceptance driver is not bound by local native acceptance evidence.'
        }
        Assert-AndroidArtifactReport -Root $root -Report $sourceReportJson -ReportRelativePath $relativeReport -ExpectedApkSha256 ([string]$nativeReport.driverApkSha256) -ExpectedCertificateSha256 $releaseCertificateSha256
        $sourceReportJson | Add-Member -NotePropertyName bindingKind -NotePropertyValue 'acceptance-driver' -Force
        $sourceReportJson | Add-Member -NotePropertyName boundApkSha256 -NotePropertyValue ([string]$nativeReport.driverApkSha256).ToLowerInvariant() -Force
        $sourceReportJson | Add-Member -NotePropertyName acceptedByReport -NotePropertyValue 'verification/local-native.json' -Force
      } elseif (!$AllowIncomplete -and $reportName -in @('local-readiness.json','release-readiness.json')) {
        if ([string]$sourceReportJson.subject.sha256 -ne $releaseSubject) {
          throw "Required readiness report is not bound to the current release subject: $relativeReport"
        }
      } elseif (!$AllowIncomplete -and $reportName -notin @('local-readiness.json','release-readiness.json')) {
        $reportBefore = [string]$sourceReportJson.subjectBeforeSha256
        $reportAfter = [string]$sourceReportJson.subjectAfterSha256
        if (![string]::IsNullOrWhiteSpace($reportBefore) -or ![string]::IsNullOrWhiteSpace($reportAfter)) {
          if ($reportBefore -ne $releaseSubject -or $reportAfter -ne $releaseSubject) {
            throw "Required acceptance report is not bound to the current release subject before and after collection: $relativeReport"
          }
        } elseif ([string]$sourceReportJson.subjectSha256 -ne $releaseSubject) {
          throw "Required acceptance report is not bound to the current release subject: $relativeReport"
        }
      }
      if (!$AllowIncomplete -and !$reportPassed) {
        throw "Required acceptance report did not pass: $relativeReport"
      }
      $reportRecords += [ordered]@{ path = $record.path; expectedPath = $relativeReport; present = $true
        required = $true; sha256 = $record.sha256; passed = $reportPassed }
    } else {
      $reportRecords += [ordered]@{ path = $relativeReport; expectedPath = $relativeReport; present = $false
        required = $true; sha256 = $null; passed = $false }
      $missing += [ordered]@{ kind = 'report'; path = $relativeReport; reason = 'not generated before packaging' }
      if (!$AllowIncomplete) { throw "Required acceptance report is missing: $relativeReport" }
    }
  }

  # Formal acceptance reports point at raw machine output and UI/device captures
  # that live outside verification/. Copy the whole evidence closure so the
  # exported package can be re-audited offline.
  Assert-NoForbiddenFiles (Join-Path $root 'client/validation') 'client validation evidence'
  foreach ($evidenceDirectory in @('verification/raw', 'client/validation')) {
    $evidenceSource = Join-Path $root $evidenceDirectory
    if (Test-Path -LiteralPath $evidenceSource -PathType Container) {
      Copy-RequiredDirectory $evidenceSource (Join-Path $target $evidenceDirectory)
    } elseif (!$AllowIncomplete) {
      throw "Required evidence directory is missing: $evidenceDirectory"
    }
  }

  Assert-ProductionManifest $target $releaseSubject $expectedApkSha256

  Assert-NoForbiddenArtifacts $target

  $keyFilePaths = @(
    'client/doushisi.apk',
    'verification/build-manifest.json',
    'verification/production-acceptance.json',
    'runtime/node.exe',
    'package.json',
    'tools/local-run.ps1',
    'tools/local-shortcuts.ps1',
    'tools/build-fingerprint.mjs',
    'tools/print-source-fingerprint.mjs',
    'tools/release-audit.mjs',
    'tools/release-check.mjs',
    'tools/run-local-stability.mjs',
    'tools/rulebook-integrity.mjs',
    'tools/verify-backup-windows.ps1',
    'tools/verify-backup.mjs',
    'deploy/backup-lib.mjs',
    'deploy/backup-cli.mjs',
    'apps/server/package.json',
    'apps/server/dist/main.js',
    'apps/server/dist/local-restore.js',
    'apps/admin/dist/index.html',
    'client/public/index.html',
    'packages/rules/dist',
    'packages/protocol/dist',
    'README.md',
    'docs/local-operations.md'
  )
  if (Test-Path -LiteralPath (Join-Path $target 'README.zh-CN.md') -PathType Leaf) { $keyFilePaths += 'README.zh-CN.md' }
  if (Test-Path -LiteralPath (Join-Path $target 'README.project.md') -PathType Leaf) { $keyFilePaths += 'README.project.md' }
  $keyFiles = @()
  foreach ($keyFilePath in $keyFilePaths) {
    $keyFiles += Get-FileRecord $target (Join-Path $target $keyFilePath)
  }

  $rulebookRoot = Join-Path $target 'docs/rules/release'
  $rulebookDirectories = @()
  foreach ($rulebookDirectory in @(Get-ChildItem -LiteralPath $rulebookRoot -Directory | Sort-Object Name)) {
    $rulebookDirectories += Get-DirectoryRecord $target $rulebookDirectory.FullName
  }
  $rulebookDigest = Get-TextHash (($rulebookDirectories | ForEach-Object { "$($_.path):$($_.sha256)" }) -join "`n")

  $deliveryDigests = @()
  foreach ($deliveryPath in @('apps/server/dist','apps/admin/dist','client/public',
      'packages/rules/dist','packages/protocol/dist')) {
    $deliveryDigests += Get-DirectoryRecord $target (Join-Path $target $deliveryPath)
  }

  $apkRecord = Get-FileRecord $target (Join-Path $target 'client/doushisi.apk')
  $apkRecord.source = Get-RelativeUnixPath $root $releaseApkSource
  $apkRecord.selectedBy = 'local-native-acceptance'

  $packageManifest = [ordered]@{
    formatVersion = 2
    packagedAt = [DateTime]::UtcNow.ToString('o')
    releaseSubject = $releaseSubject
    nodeVersion = (& (Join-Path $target 'runtime/node.exe') --version).Trim()
    runtimeSource = Get-RelativeUnixPath $root $runtimeSource
    apk = $apkRecord
    buildManifest = Get-FileRecord $target (Join-Path $target 'verification/build-manifest.json')
    rulebooks = [ordered]@{
      path = 'docs/rules/release'
      directoryCount = $rulebookDirectories.Count
      sha256 = $rulebookDigest
      directories = $rulebookDirectories
    }
    deliveryDigests = $deliveryDigests
    keyFiles = $keyFiles
    reports = $reportRecords
    missing = $missing
  }
  $packageManifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $target 'package-manifest.json') -Encoding utf8
  Assert-NoForbiddenArtifacts $target
  Get-FileHash -LiteralPath (Join-Path $target 'client/doushisi.apk') | Select-Object Algorithm,Hash
} finally {
  Pop-Location
  # pnpm legacy deploy writes its production-only status into the source
  # workspace cache. Preserve the development workspace's original status.
  if (Test-Path -LiteralPath $stateBackup) {
    Copy-Item -LiteralPath $stateBackup -Destination $workspaceState -Force
    Remove-Item -LiteralPath $stateBackup
  }
}
