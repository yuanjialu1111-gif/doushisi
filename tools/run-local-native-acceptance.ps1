param(
  [Parameter(Mandatory=$true)][string]$DeviceA,
  [Parameter(Mandatory=$true)][string]$DeviceB,
  [string]$Adb = 'D:/leidian/LDPlayer14/adb.exe',
  [string]$ApiBase,
  [string]$ApkPath,
  [string]$JavaHome,
  [string]$ApktoolJar,
  [string]$BuildTools,
  [string]$KeyStore,
  [string]$CredentialFile,
  [string]$AndroidSdk,
  [string]$DriverApkPath,
  [switch]$BuildAcceptanceApk,
  [switch]$BuildDriverApk,
  [switch]$InstallApk,
  [ValidateSet('preflight', 'acceptance')][string]$Stage = 'preflight',
  [string]$ProjectRoot = (Join-Path $PSScriptRoot '..')
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$apiBaseArguments = @((Join-Path $projectRoot 'tools/resolve-api-base.mjs'))
if ($PSBoundParameters.ContainsKey('ApiBase')) { $apiBaseArguments += '--value'; $apiBaseArguments += $ApiBase }
$apiBaseArguments += '--runtime'
$apiBaseArguments += (Join-Path $projectRoot '.local/runtime.json')
$resolvedApiBase = & node @apiBaseArguments
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace([string]$resolvedApiBase)) {
  throw 'Could not resolve the API base. Pass -ApiBase, set DOUSHISI_API_BASE, or run the local server once to create .local/runtime.json.'
}
$ApiBase = [string]$resolvedApiBase
$verificationDirectory = Join-Path $projectRoot 'verification'
$preflightPath = Join-Path $verificationDirectory 'local-native-preflight.json'
$finalPath = Join-Path $verificationDirectory 'local-native.json'
$archiveDirectory = Join-Path $verificationDirectory 'archive/local-native'
$rawRoot = Join-Path $verificationDirectory 'raw/local-native'
$acceptanceApkPath = Join-Path $projectRoot 'client/android/doushisi-acceptance.apk'
$releaseApkPath = Join-Path $projectRoot 'client/android/doushisi.apk'
$driverApkPath = if ($PSBoundParameters.ContainsKey('DriverApkPath')) {
  [IO.Path]::GetFullPath($DriverApkPath)
} else {
  Join-Path $projectRoot 'tools/android-acceptance-driver/dist/doushisi-acceptance-driver.apk'
}
$driverReportPath = Join-Path $projectRoot 'verification/android-acceptance-driver-build.json'
$trustedDriverCertificateSha256 = 'd90b4c8e4b7fb34dd7445a060b0f8f3b7820f2a05fe31ea1b4aeac062edf883c'

if ($Stage -eq 'acceptance') {
  if (!$PSBoundParameters.ContainsKey('ApkPath')) {
    throw 'APK_PATH_REQUIRED: acceptance requires an explicit -ApkPath pointing to client/android/doushisi.apk.'
  }
  if (!$InstallApk.IsPresent) {
    throw 'INSTALL_REQUIRED: acceptance requires the explicit -InstallApk switch so this run installs and verifies the formal APK.'
  }
}

if ($BuildAcceptanceApk) {
  $buildArguments = @('-NoProfile', '-File', (Join-Path $projectRoot 'tools/client-native-release-build.ps1'),
    '-ApiBase', $ApiBase, '-OutputApk', $acceptanceApkPath)
  foreach ($argument in @(
      @('JavaHome', $JavaHome), @('ApktoolJar', $ApktoolJar), @('BuildTools', $BuildTools),
      @('KeyStore', $KeyStore), @('CredentialFile', $CredentialFile))) {
    if (![string]::IsNullOrWhiteSpace([string]$argument[1])) { $buildArguments += '-' + $argument[0]; $buildArguments += [string]$argument[1] }
  }
  & pwsh @buildArguments
  if ($LASTEXITCODE -ne 0) { throw 'ACCEPTANCE_APK_BUILD_FAILED: client-native-release-build.ps1 did not complete.' }
}

if ($BuildDriverApk) {
  foreach ($required in @($JavaHome, $AndroidSdk, $KeyStore, $CredentialFile)) {
    if ([string]::IsNullOrWhiteSpace([string]$required)) {
      throw 'DRIVER_BUILD_ARGUMENT_MISSING: -BuildDriverApk requires -JavaHome, -AndroidSdk, -KeyStore and -CredentialFile.'
    }
  }
  & pwsh -NoProfile -File (Join-Path $projectRoot 'tools/android-acceptance-driver/build-driver.ps1') `
    -ProjectRoot $projectRoot `
    -JavaHome $JavaHome `
    -AndroidSdk $AndroidSdk `
    -KeyStore $KeyStore `
    -CredentialFile $CredentialFile `
    -OutputApk $driverApkPath
  if ($LASTEXITCODE -ne 0) { throw 'ACCEPTANCE_DRIVER_BUILD_FAILED: build-driver.ps1 did not complete.' }
}

if ($PSBoundParameters.ContainsKey('ApkPath') -and !(Test-Path -LiteralPath $ApkPath -PathType Leaf)) {
  throw "APK_NOT_FOUND: $ApkPath"
}
if ($PSBoundParameters.ContainsKey('ApkPath')) {
  $apkPath = [IO.Path]::GetFullPath($ApkPath)
  $expectedReleaseApkPath = [IO.Path]::GetFullPath($releaseApkPath)
  if ($Stage -eq 'acceptance' -and !$apkPath.Equals($expectedReleaseApkPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "RELEASE_APK_REQUIRED: acceptance must use $expectedReleaseApkPath, not $apkPath."
  }
  $apkSelectionMode = 'explicit'
} elseif (Test-Path -LiteralPath $releaseApkPath -PathType Leaf) {
  $apkPath = [IO.Path]::GetFullPath($releaseApkPath)
  $apkSelectionMode = 'default'
} else {
  throw "APK_NOT_FOUND: Expected $releaseApkPath"
}
if (!(Test-Path -LiteralPath $driverApkPath -PathType Leaf)) {
  throw "DRIVER_APK_NOT_FOUND: $driverApkPath"
}
$bridgePath = Join-Path $projectRoot 'tools/acceptance-bridge.ps1'
$localAccessPath = Join-Path $projectRoot '.local/local-access.json'
$package = 'net.doushisi.standalone'
$runId = [guid]::NewGuid().ToString()
$rawDirectory = Join-Path $rawRoot $runId
$startedAt = [DateTime]::UtcNow.ToString('o')
$configuredGameNum = 12
$requiredCompletedRounds = $configuredGameNum
$finalCheckIds = @(
  'register',
  'beans-credit',
  'create-and-join',
  'completed-round',
  'settlement',
  'auto-play',
  'reconnect',
  'animated-replay',
  'gps',
  'quick-voice',
  'standalone-network',
  'two-physical-android-devices',
  'lan-without-adb'
)

function Get-UtcTimestamp {
  return [DateTime]::UtcNow.ToString('o')
}

function Write-JsonAtomic {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)]$Value
  )
  $absolute = [IO.Path]::GetFullPath($Path)
  $directory = [IO.Path]::GetDirectoryName($absolute)
  [IO.Directory]::CreateDirectory($directory) | Out-Null
  $temporary = Join-Path $directory ('.' + [IO.Path]::GetFileName($absolute) + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
  $json = (($Value | ConvertTo-Json -Depth 20) + "`n")
  [IO.File]::WriteAllText($temporary, $json, [System.Text.UTF8Encoding]::new($false))
  try {
    if ([IO.File]::Exists($absolute)) {
      # Same-directory Move with overwrite is atomic on the supported local filesystem.
      # File.Replace rejects a null backup path on some Windows PowerShell/.NET combinations.
      [IO.File]::Move($temporary, $absolute, $true)
    } else {
      [IO.File]::Move($temporary, $absolute)
    }
  } catch {
    if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    throw
  }
}

function Get-ProjectRelativePath {
  param([Parameter(Mandatory=$true)][string]$Path)
  $absolute = [IO.Path]::GetFullPath($Path)
  $base = [IO.Path]::GetFullPath($projectRoot).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (!$absolute.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Evidence path is outside the project: $absolute"
  }
  return $absolute.Substring($base.Length).Replace('\', '/')
}

function Get-Sha256 {
  param([Parameter(Mandatory=$true)][string]$Path)
  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw "File does not exist: $Path" }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Invoke-Adb {
  param([Parameter(Mandatory=$true)][string[]]$Arguments)
  $output = & $Adb @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  if ($null -eq $exitCode -or $exitCode -ne 0) {
    $detail = (($output | ForEach-Object { [string]$_ }) -join "`n")
    throw "adb $($Arguments -join ' ') failed with exit code $exitCode. $detail"
  }
  return [string[]]$output
}

function Invoke-AdbText {
  param([Parameter(Mandatory=$true)][string[]]$Arguments)
  $lines = Invoke-Adb -Arguments $Arguments
  return (($lines | ForEach-Object { [string]$_ }) -join "`n").Trim()
}

function Get-SubjectSha256 {
  $script = Join-Path $projectRoot 'tools/print-source-fingerprint.mjs'
  if (!(Test-Path -LiteralPath $script -PathType Leaf)) { throw "Subject tool is missing: $script" }
  $output = & node $script --subject 2>&1
  $exitCode = $LASTEXITCODE
  if ($null -eq $exitCode -or $exitCode -ne 0) {
    throw "Could not calculate release subject. $((($output | ForEach-Object { [string]$_ }) -join "`n"))"
  }
  $subject = (($output | ForEach-Object { [string]$_ }) -join '').Trim()
  if ($subject -notmatch '^[0-9a-f]{64}$') { throw "Release subject is not a SHA-256 value: $subject" }
  return $subject
}

function Invoke-CapturedProcess {
  param(
    [Parameter(Mandatory=$true)][string]$FilePath,
    [Parameter(Mandatory=$true)][string[]]$Arguments,
    [Parameter(Mandatory=$true)][string]$FailureCode,
    [Parameter(Mandatory=$true)][string]$Context
  )
  $output = & $FilePath @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  if ($null -eq $exitCode) { $exitCode = 0 }
  $text = (($output | ForEach-Object { [string]$_ }) -join "`n").Trim()
  if ($exitCode -ne 0) {
    throw "${FailureCode}: ${Context} failed with exit code ${exitCode}. $text"
  }
  return $text
}

function Get-DriverSigningEvidence {
  param(
    [Parameter(Mandatory=$true)][string]$Apk,
    [Parameter(Mandatory=$true)][string]$Idsig,
    [Parameter(Mandatory=$true)][string]$ExpectedCertificateSha256
  )
  $candidateJavaHomes = @()
  if (![string]::IsNullOrWhiteSpace($JavaHome)) { $candidateJavaHomes += $JavaHome }
  $candidateJavaHomes += @(
    (Join-Path $projectRoot 'work/client-build/java/zulu17.68.203-ca-jre17.0.20.1-win_x64'),
    'C:\Users\Administrator\Desktop\直播\_android_build\jdk17\jdk-17.0.20.1+1'
  )
  $candidateSdks = @()
  if (![string]::IsNullOrWhiteSpace($AndroidSdk)) { $candidateSdks += $AndroidSdk }
  $candidateSdks += @(
    (Join-Path $projectRoot 'work/client-build/android-sdk'),
    'C:\Users\Administrator\Desktop\直播\_android_build\sdk'
  )

  $java = $null
  foreach ($candidate in $candidateJavaHomes) {
    $javaCandidate = Join-Path ([IO.Path]::GetFullPath($candidate)) 'bin/java.exe'
    if (Test-Path -LiteralPath $javaCandidate -PathType Leaf) { $java = $javaCandidate; break }
  }
  if (!$java) {
    throw 'DRIVER_APK_TRUST_UNVERIFIED: Java 17 is required to verify the acceptance driver APK. Pass -JavaHome.'
  }

  $apksignerJar = $null
  foreach ($candidate in $candidateSdks) {
    $jarCandidate = Join-Path ([IO.Path]::GetFullPath($candidate)) 'build-tools/35.0.0/lib/apksigner.jar'
    if (Test-Path -LiteralPath $jarCandidate -PathType Leaf) { $apksignerJar = $jarCandidate; break }
  }
  if (!$apksignerJar) {
    throw 'DRIVER_APK_TRUST_UNVERIFIED: Android SDK build-tools 35.0.0 apksigner.jar is required. Pass -AndroidSdk.'
  }
  if (!(Test-Path -LiteralPath $Idsig -PathType Leaf)) {
    throw "DRIVER_APK_IDSIG_NOT_FOUND: $Idsig"
  }

  $v23Output = Invoke-CapturedProcess -FilePath $java -Arguments @('-jar', $apksignerJar, 'verify', '--verbose', '--print-certs', $Apk) -FailureCode 'DRIVER_APK_TRUST_UNVERIFIED' -Context 'driver APK v2/v3 verification'
  $certificateMatch = [regex]::Match($v23Output, 'Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F]{64})')
  if (!$certificateMatch.Success) {
    throw 'DRIVER_APK_TRUST_UNVERIFIED: apksigner did not report the signer certificate SHA-256 digest.'
  }
  $certificateSha256 = $certificateMatch.Groups[1].Value.ToLowerInvariant()
  $expectedCertificate = $ExpectedCertificateSha256.Trim().ToLowerInvariant()
  if ($certificateSha256 -ne $expectedCertificate) {
    throw "DRIVER_APK_TRUST_UNVERIFIED: driver APK certificate $certificateSha256 does not match the trusted certificate $expectedCertificate."
  }
  $v2 = [bool]($v23Output -match 'Verified using v2 scheme \(APK Signature Scheme v2\): true')
  $v3 = [bool]($v23Output -match 'Verified using v3 scheme \(APK Signature Scheme v3\): true')
  $v4Output = Invoke-CapturedProcess -FilePath $java -Arguments @('-jar', $apksignerJar, 'verify', '--v4-signature-file', $Idsig, '--verbose', $Apk) -FailureCode 'DRIVER_APK_TRUST_UNVERIFIED' -Context 'driver APK v4 verification'
  $v4 = [bool]($v4Output -match 'Verified using v4 scheme \(APK Signature Scheme v4\): true')
  if (!($v2 -and $v3 -and $v4)) {
    throw "DRIVER_APK_TRUST_UNVERIFIED: driver APK signature schemes are incomplete (v2=$v2 v3=$v3 v4=$v4)."
  }
  return [ordered]@{
    certificateSha256 = $certificateSha256
    expectedCertificateSha256 = $expectedCertificate
    v2 = $v2
    v3 = $v3
    v4 = $v4
    verifier = 'apksigner.jar'
  }
}

function Get-ApkSha256 {
  return Get-Sha256 -Path $apkPath
}

function Get-ApkEvidence {
  return [ordered]@{
    path = Get-ProjectRelativePath -Path $apkPath
    sha256 = Get-ApkSha256
    selectedBy = $script:apkSelectionMode
  }
}

function Get-DriverApkEvidence {
  $absolute = [IO.Path]::GetFullPath($driverApkPath)
  $base = [IO.Path]::GetFullPath($projectRoot).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $path = if ($absolute.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) {
    Get-ProjectRelativePath -Path $absolute
  } else {
    $absolute
  }
  $apkSha256 = Get-Sha256 -Path $absolute
  $apkSize = (Get-Item -LiteralPath $absolute).Length
  if (!(Test-Path -LiteralPath $driverReportPath -PathType Leaf)) {
    throw "DRIVER_APK_BUILD_REPORT_MISSING: $driverReportPath"
  }
  try { $driverBuildReport = Get-Content -LiteralPath $driverReportPath -Raw | ConvertFrom-Json } catch {
    throw "DRIVER_APK_BUILD_REPORT_INVALID: $driverReportPath could not be parsed. $($_.Exception.Message)"
  }
  if ($driverBuildReport.schemaVersion -ne 1 -or $driverBuildReport.stage -ne 'android-acceptance-driver-build' -or
      $driverBuildReport.status -ne 'passed' -or $driverBuildReport.passed -ne $true) {
    throw 'DRIVER_APK_BUILD_REPORT_INVALID: The driver build report must be a passed schema 1 android-acceptance-driver-build report.'
  }
  if ([string]$driverBuildReport.packageName -ne 'net.doushisi.acceptance') {
    throw 'DRIVER_APK_BUILD_REPORT_INVALID: The driver build report packageName is not net.doushisi.acceptance.'
  }
  $reportedApkPath = [IO.Path]::GetFullPath([string]$driverBuildReport.apk.path)
  if (!$reportedApkPath.Equals($absolute, [StringComparison]::OrdinalIgnoreCase)) {
    throw "DRIVER_APK_BUILD_REPORT_MISMATCH: report APK path $reportedApkPath does not match $absolute."
  }
  if ([string]$driverBuildReport.apk.sha256 -ne $apkSha256 -or [int64]$driverBuildReport.apk.size -ne [int64]$apkSize) {
    throw 'DRIVER_APK_BUILD_REPORT_MISMATCH: report APK hash or size does not match the driver APK.'
  }
  $idsigPath = [IO.Path]::GetFullPath([string]$driverBuildReport.idsig.path)
  if (!(Test-Path -LiteralPath $idsigPath -PathType Leaf)) {
    throw "DRIVER_APK_IDSIG_NOT_FOUND: $idsigPath"
  }
  $idsigSha256 = Get-Sha256 -Path $idsigPath
  $idsigSize = (Get-Item -LiteralPath $idsigPath).Length
  if ([string]$driverBuildReport.idsig.sha256 -ne $idsigSha256 -or [int64]$driverBuildReport.idsig.size -ne [int64]$idsigSize) {
    throw 'DRIVER_APK_BUILD_REPORT_MISMATCH: report idsig hash or size does not match the driver v4 sidecar.'
  }
  $reportedCertificate = ([string]$driverBuildReport.signing.certificateSha256).Trim().ToLowerInvariant()
  $reportedExpectedCertificate = ([string]$driverBuildReport.signing.expectedCertificateSha256).Trim().ToLowerInvariant()
  if ($reportedCertificate -ne $trustedDriverCertificateSha256 -or
      $reportedExpectedCertificate -ne $trustedDriverCertificateSha256) {
    throw 'DRIVER_APK_BUILD_REPORT_MISMATCH: The build report is not bound to the trusted driver signing certificate.'
  }
  $signing = Get-DriverSigningEvidence -Apk $absolute -Idsig $idsigPath -ExpectedCertificateSha256 $trustedDriverCertificateSha256
  $releaseSubjectSha256 = Get-SubjectSha256
  return [ordered]@{
    path = $path
    sha256 = $apkSha256
    size = $apkSize
    package = 'net.doushisi.acceptance'
    targetPackage = $package
    reportPath = Get-ProjectRelativePath -Path $driverReportPath
    reportSha256 = Get-Sha256 -Path $driverReportPath
    idsigPath = if ($idsigPath.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { Get-ProjectRelativePath -Path $idsigPath } else { $idsigPath }
    idsigSha256 = $idsigSha256
    idsigSize = $idsigSize
    certificateSha256 = $signing.certificateSha256
    trustedCertificateSha256 = $trustedDriverCertificateSha256
    signatureSchemes = [ordered]@{ v2 = $signing.v2; v3 = $signing.v3; v4 = $signing.v4 }
    verifier = $signing.verifier
    releaseSubjectSha256 = $releaseSubjectSha256
    releaseSubjectBinding = 'runner-observed-current-subject'
    buildReportReleaseSubjectBound = $false
  }
}

function Get-InstalledPackageEvidence {
  param(
    [Parameter(Mandatory=$true)][string]$Serial,
    [Parameter(Mandatory=$true)][string]$PackageName
  )
  $packageLines = @(Invoke-Adb -Arguments @('-s', $Serial, 'shell', 'pm', 'path', $PackageName) | Where-Object { $_ -match '^package:' })
  if ($packageLines.Count -eq 0) {
    throw "PACKAGE_NOT_INSTALLED: $PackageName is not installed on $Serial."
  }
  $entries = @()
  foreach ($packageLine in $packageLines) {
    $installedPath = ([string]$packageLine).Substring(8).Trim()
    if ([string]::IsNullOrWhiteSpace($installedPath)) {
      throw "INSTALLED_PACKAGE_EVIDENCE_INVALID: $PackageName on $Serial returned an empty installed path."
    }
    $basename = [IO.Path]::GetFileName($installedPath)
    $hashLine = Invoke-AdbText -Arguments @('-s', $Serial, 'shell', 'sha256sum', $installedPath)
    $hashMatch = [regex]::Match($hashLine, '^([0-9a-fA-F]{64})\s+')
    if (!$hashMatch.Success) {
      throw "INSTALLED_PACKAGE_EVIDENCE_INVALID: sha256sum did not return a hash for $installedPath on $Serial."
    }
    $entries += [ordered]@{
      path = $installedPath
      basename = $basename
      sha256 = $hashMatch.Groups[1].Value.ToLowerInvariant()
    }
  }
  $orderedEntries = @($entries | Sort-Object -Property basename, path)
  $basenames = @($orderedEntries | ForEach-Object { $_.basename })
  $paths = @($orderedEntries | ForEach-Object { $_.path })
  $hashes = @($orderedEntries | ForEach-Object { $_.sha256 })
  return [ordered]@{
    package = $PackageName
    found = $true
    fileCount = $orderedEntries.Count
    entries = @($orderedEntries)
    basenames = @($basenames)
    paths = @($paths)
    hashes = @($hashes)
  }
}

function Assert-InstalledPackageSet {
  param(
    [Parameter(Mandatory=$true)][string]$Serial,
    [Parameter(Mandatory=$true)][string]$PackageName,
    [Parameter(Mandatory=$true)][string]$ExpectedSha256,
    [Parameter(Mandatory=$true)][string]$FailureCode,
    [string]$Phase = 'preflight',
    [string[]]$ExpectedBasenames = @('base.apk'),
    [AllowNull()][hashtable]$ExpectedSha256ByBasename
  )
  $evidence = Get-InstalledPackageEvidence -Serial $Serial -PackageName $PackageName
  $expected = @($ExpectedBasenames | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -CaseSensitive)
  if ($expected.Count -eq 0) { $expected = @('base.apk') }
  $observed = @($evidence.basenames | ForEach-Object { [string]$_ } | Sort-Object -CaseSensitive)
  # Every expected split must be present and no unexpected split may be installed.
  # A single APK build therefore requires exactly base.apk; a split build must name
  # its complete split set, never accept any one matching file.
  if ((($observed -join "`n") -cne ($expected -join "`n"))) {
    $missing = @($expected | Where-Object { $observed -cnotcontains $_ })
    $unexpected = @($observed | Where-Object { $expected -cnotcontains $_ })
    throw "${FailureCode}_INSTALLED_SPLIT_SET_MISMATCH: $PackageName on $Serial requires exactly [$($expected -join ', ')] during $Phase; missing [$($missing -join ', ')]; unexpected [$($unexpected -join ', ')]; observed [$($observed -join ', ')]."
  }
  # The runner installs a single APK, so base.apk carries the expected hash. Any
  # additional expected split must supply its own runner-observed expected hash;
  # otherwise the run fails closed instead of validating only the first file.
  $expectedHashes = @{}
  if ($null -ne $ExpectedSha256ByBasename) {
    foreach ($key in $ExpectedSha256ByBasename.Keys) {
      $name = [string]$key
      $hash = ([string]$ExpectedSha256ByBasename[$key]).Trim().ToLowerInvariant()
      if ($hash -notmatch '^[0-9a-f]{64}$') {
        throw "${FailureCode}_INSTALLED_SPLIT_HASH_INVALID: expected hash for $name of $PackageName on $Serial is not a SHA-256 value."
      }
      $expectedHashes[$name] = $hash
    }
  }
  if (!$expectedHashes.ContainsKey('base.apk')) {
    $expectedHashes['base.apk'] = ([string]$ExpectedSha256).Trim().ToLowerInvariant()
  }
  foreach ($name in $expected) {
    if (!$expectedHashes.ContainsKey($name)) {
      throw "${FailureCode}_INSTALLED_SPLIT_HASH_UNVERIFIED: no runner-observed expected SHA-256 is available for split $name of $PackageName on $Serial during $Phase."
    }
    $entry = @($evidence.entries | Where-Object { [string]$_.basename -ceq $name })[0]
    if ([string]$entry.sha256 -ne [string]$expectedHashes[$name]) {
      throw "${FailureCode}_BINDING_FAILED: installed split $name of $PackageName on $Serial has $($entry.sha256) instead of $($expectedHashes[$name]) during $Phase."
    }
  }
  return $evidence
}

function Assert-InstalledPackageMatchesSnapshot {
  param(
    [Parameter(Mandatory=$true)][string]$Serial,
    [Parameter(Mandatory=$true)][string]$PackageName,
    [Parameter(Mandatory=$true)][string]$ExpectedSha256,
    [Parameter(Mandatory=$true)][string]$FailureCode,
    [Parameter(Mandatory=$true)][string]$Phase,
    [AllowNull()][string[]]$ExpectedPaths,
    [AllowNull()][string[]]$ExpectedBasenames,
    [AllowNull()][hashtable]$ExpectedSha256ByBasename
  )
  $evidence = Assert-InstalledPackageSet -Serial $Serial -PackageName $PackageName -ExpectedSha256 $ExpectedSha256 -FailureCode $FailureCode -Phase $Phase -ExpectedBasenames $ExpectedBasenames -ExpectedSha256ByBasename $ExpectedSha256ByBasename
  if ($null -ne $ExpectedPaths) {
    $expectedPathKey = @($ExpectedPaths | ForEach-Object { [string]$_ } | Sort-Object -CaseSensitive) -join "`n"
    $observedPathKey = @($evidence.paths | ForEach-Object { [string]$_ } | Sort-Object -CaseSensitive) -join "`n"
    if ($observedPathKey -cne $expectedPathKey) {
      throw "${FailureCode}_INSTALLED_APK_PATH_CHANGED: installed $PackageName on $Serial changed its on-device path during $Phase; expected [$expectedPathKey] observed [$observedPathKey]."
    }
  }
  if ($null -ne $ExpectedBasenames) {
    $expectedNameKey = @($ExpectedBasenames | ForEach-Object { [string]$_ } | Sort-Object -CaseSensitive) -join "`n"
    $observedNameKey = @($evidence.basenames | ForEach-Object { [string]$_ } | Sort-Object -CaseSensitive) -join "`n"
    if ($observedNameKey -cne $expectedNameKey) {
      throw "${FailureCode}_INSTALLED_SPLIT_SET_CHANGED: installed $PackageName on $Serial changed its split set during $Phase; expected [$expectedNameKey] observed [$observedNameKey]."
    }
  }
  return $evidence
}

function Install-AndVerifyPackage {
  param(
    [Parameter(Mandatory=$true)][string]$Serial,
    [Parameter(Mandatory=$true)][string]$PackageName,
    [Parameter(Mandatory=$true)][string]$Apk,
    [Parameter(Mandatory=$true)][string]$ExpectedSha256,
    [Parameter(Mandatory=$true)][string]$FailureCode
  )
  $installOutput = $null
  if ($InstallApk) {
    $installOutput = @(Invoke-Adb -Arguments @('-s', $Serial, 'install', '-r', $Apk))
    if ((($installOutput | ForEach-Object { [string]$_ }) -join "`n") -notmatch '(?m)^Success\r?$') {
      throw "${FailureCode}_INSTALL_FAILED: adb install did not report Success for $PackageName on $Serial."
    }
  } elseif ($Stage -eq 'acceptance') {
    throw "${FailureCode}_INSTALL_REQUIRED: acceptance requires -InstallApk so the verified package is installed by this run."
  }

  $installed = Assert-InstalledPackageSet -Serial $Serial -PackageName $PackageName -ExpectedSha256 $ExpectedSha256 -FailureCode $FailureCode -Phase 'after-install'
  $sha256ByBasename = [ordered]@{}
  foreach ($entry in @($installed.entries)) {
    $sha256ByBasename[[string]$entry.basename] = [string]$entry.sha256
  }
  return [ordered]@{
    installed = $true
    installedByScript = [bool]$InstallApk
    installOutput = (($installOutput | ForEach-Object { [string]$_ }) -join "`n").Trim()
    paths = @($installed.paths)
    basenames = @($installed.basenames)
    hashes = @($installed.hashes)
    sha256ByBasename = $sha256ByBasename
    files = @($installed.entries)
    fileCount = $installed.fileCount
    candidates = @($installed.entries)
    matchedSha256 = $ExpectedSha256
  }
}

function ConvertTo-RedactedValue {
  param([AllowNull()]$Value, [int]$Depth = 0)
  if ($null -eq $Value) { return $null }
  if ($Depth -gt 30) { return '[REDACTED_DEPTH_LIMIT]' }
  if ($Value -is [string] -or $Value -is [char] -or $Value -is [bool] -or $Value -is [byte] -or
      $Value -is [int16] -or $Value -is [int32] -or $Value -is [int64] -or $Value -is [single] -or
      $Value -is [double] -or $Value -is [decimal] -or $Value -is [DateTime]) {
    return $Value
  }
  if ($Value -is [System.Collections.IDictionary]) {
    $result = [ordered]@{}
    foreach ($key in $Value.Keys) {
      $name = [string]$key
      if ($name -match '(?i)(password|passwd|token|authorization|cookie|session|secret|credential|api[-_]?key|private[-_]?key)') {
        $result[$name] = '[REDACTED]'
      } else {
        $result[$name] = ConvertTo-RedactedValue -Value $Value[$key] -Depth ($Depth + 1)
      }
    }
    return $result
  }
  if ($Value -is [System.Collections.IEnumerable] -and !($Value -is [string])) {
    $items = @()
    foreach ($item in $Value) { $items += ConvertTo-RedactedValue -Value $item -Depth ($Depth + 1) }
    return $items
  }
  $properties = @($Value.PSObject.Properties)
  if ($properties.Count -eq 0) { return [string]$Value }
  $result = [ordered]@{}
  foreach ($property in $properties) {
    if ($property.Name -match '(?i)(password|passwd|token|authorization|cookie|session|secret|credential|api[-_]?key|private[-_]?key)') {
      $result[$property.Name] = '[REDACTED]'
    } else {
      $result[$property.Name] = ConvertTo-RedactedValue -Value $property.Value -Depth ($Depth + 1)
    }
  }
  return $result
}

function Add-FinalEvidenceFile {
  param(
    [Parameter(Mandatory=$true)]$Evidence,
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Kind
  )
  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw "EVIDENCE_FILE_MISSING: $Path" }
  $descriptor = [ordered]@{
    path = Get-ProjectRelativePath -Path $Path
    sha256 = Get-Sha256 -Path $Path
    kind = $Kind
  }
  [void]$Evidence.Add($descriptor)
  return $descriptor
}

function Get-ObjectPropertyValue {
  param([AllowNull()]$Value, [Parameter(Mandatory=$true)][string]$Name)
  if ($null -eq $Value) { return $null }
  $property = $Value.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Get-RequiredObjectPropertyValue {
  param([AllowNull()]$Value, [Parameter(Mandatory=$true)][string]$Name, [Parameter(Mandatory=$true)][string]$Context)
  $found = Get-ObjectPropertyValue -Value $Value -Name $Name
  if ($null -eq $found -or ([string]$found).Trim().Length -eq 0) {
    throw "ACCEPTANCE_RECEIPT_INVALID: $Context is missing '$Name'."
  }
  return $found
}

function ConvertTo-NullableString {
  param([AllowNull()]$Value)
  if ($null -eq $Value) { return $null }
  $text = [string]$Value
  if ($text.Trim().Length -eq 0 -or $text.Trim() -eq '0' -or $text.Trim().ToLowerInvariant() -eq 'null') { return $null }
  return $text.Trim()
}

function Get-RandomToken {
  param([int]$ByteCount = 18)
  $bytes = [byte[]]::new($ByteCount)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Invoke-AcceptanceBridge {
  param(
    [Parameter(Mandatory=$true)][string]$Serial,
    [Parameter(Mandatory=$true)][string]$Action,
    [hashtable]$Fields = @{},
    [int]$TimeoutSeconds = 30
  )
  if (!(Test-Path -LiteralPath $bridgePath -PathType Leaf)) { throw "ACCEPTANCE_BRIDGE_MISSING: $bridgePath" }
  $id = 'dss-' + (Get-RandomToken -ByteCount 12)
  $command = [ordered]@{ id = $id; action = $Action }
  foreach ($key in $Fields.Keys) { $command[$key] = $Fields[$key] }
  $json = $command | ConvertTo-Json -Compress -Depth 12
  $receipt = & $bridgePath -Adb $Adb -Serial $Serial -Command $json -TimeoutSeconds $TimeoutSeconds -Package $package
  if ($null -eq $receipt) { throw "ACCEPTANCE_RECEIPT_MISSING: $Action on $Serial returned no receipt." }
  if ([string]$receipt.id -ne $id) { throw "ACCEPTANCE_RECEIPT_ID_MISMATCH: expected $id, got $($receipt.id)." }
  if ($receipt.ok -ne $true) {
    $detail = ConvertTo-RedactedValue -Value $receipt.detail
    throw "ACCEPTANCE_ACTION_FAILED: $Action failed on $Serial. $((($detail | ConvertTo-Json -Compress -Depth 12))) "
  }
  return $receipt
}

function Assert-AcceptanceDetail {
  param(
    [Parameter(Mandatory=$true)]$Receipt,
    [Parameter(Mandatory=$true)][string]$Action,
    [Parameter(Mandatory=$true)][string]$Serial
  )
  $detail = Get-ObjectPropertyValue -Value $Receipt -Name 'detail'
  if ($null -eq $detail -or $detail -is [string]) {
    throw "ACCEPTANCE_RECEIPT_INVALID: $Action on $Serial did not return structured detail."
  }
  return $detail
}

function Invoke-AcceptanceBridgeWithValidation {
  param(
    [Parameter(Mandatory=$true)][string]$Serial,
    [Parameter(Mandatory=$true)][string]$Action,
    [hashtable]$Fields = @{},
    [int]$TimeoutSeconds = 60,
    [int]$Attempts = 3,
    [int]$DelayMilliseconds = 750,
    [Parameter(Mandatory=$true)][scriptblock]$Validate
  )
  if ($Attempts -lt 1) { throw 'ACCEPTANCE_RETRY_INVALID: Attempts must be at least one.' }
  $lastFailure = $null
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      $receipt = Invoke-AcceptanceBridge -Serial $Serial -Action $Action -Fields $Fields -TimeoutSeconds $TimeoutSeconds
      $detail = Assert-AcceptanceDetail -Receipt $receipt -Action $Action -Serial $Serial
      $null = & $Validate $detail
      return [ordered]@{ receipt = $receipt; detail = $detail; attempts = $attempt }
    } catch {
      $lastFailure = $_
      if ($attempt -lt $Attempts) { Start-Sleep -Milliseconds $DelayMilliseconds }
    }
  }
  throw $lastFailure
}

function Get-NetworkEndpointIdentity {
  param(
    [AllowNull()][string]$Value,
    [Parameter(Mandatory=$true)][string]$Context,
    [Parameter(Mandatory=$true)][string[]]$AllowedSchemes
  )
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "LAN_ENDPOINT_INVALID: $Context is empty." }
  try {
    $uri = [Uri]::new($Value.Trim())
  } catch {
    throw "LAN_ENDPOINT_INVALID: $Context is not a valid URI."
  }
  $scheme = $uri.Scheme.ToLowerInvariant()
  if ($AllowedSchemes -notcontains $scheme) { throw "LAN_ENDPOINT_INVALID: $Context uses unsupported scheme '$scheme'." }
  if ($uri.IsLoopback) { throw "LAN_ENDPOINT_INVALID: $Context points at a loopback address." }
  if (![string]::IsNullOrWhiteSpace($uri.UserInfo)) { throw "LAN_ENDPOINT_INVALID: $Context contains credentials." }
  if (![string]::IsNullOrWhiteSpace($uri.Query) -or ![string]::IsNullOrWhiteSpace($uri.Fragment)) {
    throw "LAN_ENDPOINT_INVALID: $Context must not contain a query or fragment."
  }
  $path = $uri.AbsolutePath.TrimEnd('/')
  if ([string]::IsNullOrEmpty($path)) { $path = '/' }
  return [pscustomobject]@{
    scheme = $scheme
    host = $uri.Host.TrimEnd('.').ToLowerInvariant()
    port = $uri.Port
    path = $path
    uri = $uri
  }
}

function Get-PrivateIPv4Address {
  param(
    [AllowNull()][string]$Value,
    [Parameter(Mandatory=$true)][string]$Context
  )
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "LAN_ENDPOINT_INVALID: $Context is empty." }
  $address = $null
  if (![Net.IPAddress]::TryParse($Value.Trim(), [ref]$address) -or $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
    throw "LAN_ENDPOINT_INVALID: $Context is not an IPv4 literal."
  }
  $bytes = $address.GetAddressBytes()
  $private = $bytes[0] -eq 10 -or
    ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
    ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
  if (!$private) { throw "LAN_ENDPOINT_INVALID: $Context is not an RFC1918 private IPv4 address." }
  return $address.ToString()
}

function Convert-Ipv4ToUInt32 {
  param([Parameter(Mandatory=$true)][string]$Address)
  $bytes = [Net.IPAddress]::Parse($Address).GetAddressBytes()
  [Array]::Reverse($bytes)
  return [BitConverter]::ToUInt32($bytes, 0)
}

function Test-Ipv4SameSubnet {
  param(
    [Parameter(Mandatory=$true)][string]$Left,
    [Parameter(Mandatory=$true)][string]$Right,
    [Parameter(Mandatory=$true)][ValidateRange(0, 32)][int]$PrefixLength
  )
  $mask = if ($PrefixLength -eq 0) { [uint32]0 } else { [uint32]::MaxValue -shl (32 - $PrefixLength) }
  $leftNetwork = [uint32]((Convert-Ipv4ToUInt32 -Address $Left) -band $mask)
  $rightNetwork = [uint32]((Convert-Ipv4ToUInt32 -Address $Right) -band $mask)
  return $leftNetwork -eq $rightNetwork
}

function Get-ServerLanBinding {
  param([Parameter(Mandatory=$true)][string]$Address)
  $target = [Net.IPAddress]::Parse($Address)
  foreach ($networkInterface in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($networkInterface.OperationalStatus -ne [Net.NetworkInformation.OperationalStatus]::Up) { continue }
    foreach ($unicast in $networkInterface.GetIPProperties().UnicastAddresses) {
      if ($unicast.Address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { continue }
      if ($unicast.Address.Equals($target)) {
        return [ordered]@{
          address = $target.ToString()
          prefixLength = [int]$unicast.PrefixLength
          interfaceName = [string]$networkInterface.Name
        }
      }
    }
  }
  return $null
}

function Assert-LanNetwork {
  param([Parameter(Mandatory=$true)]$Account)
  $network = $Account.network
  if ($network.allowed -ne $true) { throw "LAN_NETWORK_BLOCKED: $($Account.device) rejected the configured LAN endpoint." }
  $expected = Get-NetworkEndpointIdentity -Value $ApiBase -Context 'configured apiBase' -AllowedSchemes @('http', 'https')
  $actual = Get-NetworkEndpointIdentity -Value ([string]$network.apiBase) -Context "apiBase reported by $($Account.device)" -AllowedSchemes @('http', 'https')
  if ($expected.scheme -ne $actual.scheme -or $expected.host -ne $actual.host -or
      $expected.port -ne $actual.port -or $expected.path -ne $actual.path) {
    throw "LAN_ENDPOINT_INVALID: $($Account.device) reported an apiBase different from the configured endpoint."
  }
  $websocket = Get-NetworkEndpointIdentity -Value ([string]$network.wsUrl) -Context "wsUrl reported by $($Account.device)" -AllowedSchemes @('ws', 'wss')
  if ($websocket.host -ne $actual.host) {
    throw "LAN_ENDPOINT_INVALID: $($Account.device) reported a WebSocket host that does not match its API host."
  }

  $serverAddress = Get-PrivateIPv4Address -Value $actual.host -Context "api host for $($Account.device)"
  $serverBinding = Get-ServerLanBinding -Address $serverAddress
  if ($null -eq $serverBinding) {
    throw "LAN_NETWORK_UNVERIFIED: The configured server address $serverAddress is not present on an active local IPv4 interface."
  }

  $routeRaw = Invoke-AdbText -Arguments @('-s', [string]$Account.device, 'shell', 'ip', 'route')
  $routeGetRaw = Invoke-AdbText -Arguments @('-s', [string]$Account.device, 'shell', 'ip', 'route', 'get', $serverAddress)
  $ipAddressRaw = Invoke-AdbText -Arguments @('-s', [string]$Account.device, 'shell', 'ip', 'addr')
  $interfaceMatch = [regex]::Match($routeGetRaw, '(?im)\bdev\s+([^\s]+)')
  $sourceMatch = [regex]::Match($routeGetRaw, '(?im)\bsrc\s+(\d+\.\d+\.\d+\.\d+)')
  if (!$interfaceMatch.Success -or !$sourceMatch.Success) {
    throw "LAN_ROUTE_UNVERIFIED: $($Account.device) did not report the device interface and source address for $serverAddress."
  }
  $deviceInterface = $interfaceMatch.Groups[1].Value.Trim()
  $deviceAddress = Get-PrivateIPv4Address -Value $sourceMatch.Groups[1].Value -Context "source address for $($Account.device)"
  $interfacePattern = '(?ms)(?:^|\n)\d+:\s+' + [regex]::Escape($deviceInterface) + ':(.*?)(?=\n\d+:\s|\z)'
  $interfaceBlockMatch = [regex]::Match($ipAddressRaw, $interfacePattern)
  if (!$interfaceBlockMatch.Success) {
    throw "LAN_ROUTE_UNVERIFIED: $($Account.device) did not report the interface block for $deviceInterface."
  }
  $devicePrefixMatch = [regex]::Match($interfaceBlockMatch.Groups[1].Value, '(?m)\binet\s+(\d+\.\d+\.\d+\.\d+)/(\d+)\b')
  if (!$devicePrefixMatch.Success) {
    throw "LAN_ROUTE_UNVERIFIED: $($Account.device) did not report an IPv4 prefix on $deviceInterface."
  }
  $deviceInterfaceAddress = Get-PrivateIPv4Address -Value $devicePrefixMatch.Groups[1].Value -Context "interface address for $($Account.device)"
  $devicePrefixLength = [int]$devicePrefixMatch.Groups[2].Value
  if ($deviceInterfaceAddress -ne $deviceAddress) {
    throw "LAN_ROUTE_UNVERIFIED: $($Account.device) reported a route source different from the interface address."
  }
  if ($devicePrefixLength -ne [int]$serverBinding.prefixLength) {
    throw "LAN_ROUTE_UNVERIFIED: $($Account.device) interface prefix /$devicePrefixLength does not match server prefix /$($serverBinding.prefixLength)."
  }
  if (!(Test-Ipv4SameSubnet -Left $serverAddress -Right $deviceAddress -PrefixLength $devicePrefixLength)) {
    throw "LAN_ROUTE_UNVERIFIED: $($Account.device) source $deviceAddress is not on the same subnet as server $serverAddress/$devicePrefixLength."
  }

  return [ordered]@{
    apiBase = $network.apiBase
    wsUrl = $network.wsUrl
    allowed = $true
    serverAddress = $serverAddress
    serverPrefixLength = [int]$serverBinding.prefixLength
    serverInterface = [string]$serverBinding.interfaceName
    deviceAddress = $deviceAddress
    devicePrefixLength = $devicePrefixLength
    deviceInterface = $deviceInterface
    routeGet = $routeGetRaw
    route = $routeRaw
    ipAddr = $ipAddressRaw
    sameSubnet = $true
  }
}

function Add-DeviceEvidenceRecord {
  param(
    [Parameter(Mandatory=$true)]$Evidence,
    [Parameter(Mandatory=$true)][string]$Device,
    [Parameter(Mandatory=$true)][string]$Action,
    [Parameter(Mandatory=$true)][string]$Observable,
    [Parameter(Mandatory=$true)][string]$CheckId,
    [AllowNull()]$Server,
    [AllowNull()]$RoomId,
    [AllowNull()]$RoundId,
    [AllowNull()]$LedgerId,
    [AllowNull()]$Error,
    [AllowNull()]$Detail
  )
  $record = [ordered]@{
    at = Get-UtcTimestamp
    device = $Device
    action = $Action
    observable = $Observable
    server = $Server
    error = $Error
    roomId = ConvertTo-NullableString -Value $RoomId
    roundId = ConvertTo-NullableString -Value $RoundId
    ledgerId = ConvertTo-NullableString -Value $LedgerId
    checkId = $CheckId
    detail = ConvertTo-RedactedValue -Value $Detail
  }
  [void]$Evidence.Add($record)
  return $record
}

function Write-RawAcceptanceEvidence {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)]$Value,
    [Parameter(Mandatory=$true)]$Evidence,
    [Parameter(Mandatory=$true)][string]$Kind
  )
  if ($Name -notmatch '^[a-z0-9][a-z0-9-]{0,80}$') { throw "INVALID_EVIDENCE_NAME: $Name" }
  $path = Join-Path $rawDirectory ($Name + '.json')
  $safe = ConvertTo-RedactedValue -Value $Value
  Write-JsonAtomic -Path $path -Value $safe
  return Add-FinalEvidenceFile -Evidence $Evidence -Path $path -Kind $Kind
}

function New-FinalCheck {
  param(
    [Parameter(Mandatory=$true)]$Checks,
    [Parameter(Mandatory=$true)][string]$Id,
    [Parameter(Mandatory=$true)][bool]$Passed,
    [AllowNull()]$Evidence,
    [AllowNull()]$Details
  )
  if ($finalCheckIds -notcontains $Id) { throw "INVALID_FINAL_CHECK: $Id" }
  if (@($Checks | Where-Object { $_.id -eq $Id }).Count -gt 0) { throw "DUPLICATE_FINAL_CHECK: $Id" }
  $evidenceValues = @()
  foreach ($item in @($Evidence)) { if ($null -ne $item) { $evidenceValues += $item } }
  [void]$Checks.Add([ordered]@{
    id = $Id
    passed = $Passed
    evidence = $evidenceValues
    details = ConvertTo-RedactedValue -Value $Details
  })
}

function Assert-FinalCondition {
  param(
    [Parameter(Mandatory=$true)]$Condition,
    [Parameter(Mandatory=$true)][string]$Message
  )
  if (![bool]$Condition) { throw [System.InvalidOperationException]::new($Message) }
}

function Test-HexSha256 {
  param([AllowNull()][string]$Value)
  return $Value -match '^[0-9a-f]{64}$'
}

function Get-FailureCode {
  param([string]$Message)
  if ($Message -match '^([A-Z][A-Z0-9_]+):') { return $Matches[1] }
  return 'LOCAL_NATIVE_ACCEPTANCE_FAILED'
}

function Add-PreflightCheck {
  param(
    [Parameter(Mandatory=$true)]$Checks,
    [Parameter(Mandatory=$true)][string]$Id,
    [Parameter(Mandatory=$true)][bool]$Passed,
    $Details
  )
  if ($Id -notmatch '^preflight-[a-z0-9-]+$') { throw "Invalid preflight check id: $Id" }
  if ($finalCheckIds -contains $Id) { throw "Preflight cannot use final check id: $Id" }
  [void]$Checks.Add([ordered]@{ id = $Id; passed = $Passed; details = $Details })
}

function Assert-PreflightCondition {
  param(
    [Parameter(Mandatory=$true)]$Condition,
    [Parameter(Mandatory=$true)]$Checks,
    [Parameter(Mandatory=$true)][string]$Id,
    $Details,
    [Parameter(Mandatory=$true)][string]$Message
  )
  $passed = [bool]$Condition
  Add-PreflightCheck -Checks $Checks -Id $Id -Passed $passed -Details $Details
  if (!$passed) { throw [System.InvalidOperationException]::new($Message) }
}

function Get-PropValue {
  param([string]$GetpropRaw, [Parameter(Mandatory=$true)][string]$Name)
  $match = [regex]::Match($GetpropRaw, '(?m)^\[' + [regex]::Escape($Name) + '\]: \[(.*)\]\s*$')
  if (!$match.Success) { return '' }
  return $match.Groups[1].Value.Trim()
}

function Test-PlaceholderIdentity {
  param([AllowNull()][string]$Value)
  $text = ConvertTo-NullableString -Value $Value
  if ($null -eq $text) { return $true }
  if ($text -match '^(?i)(unknown|null|none|n/?a|0+|f+|-+)$') { return $true }
  if ($text -match '^(?i)(0123456789abcdef|1234567890abcdef|abcdef0123456789|0000000000000000|deadbeefdeadbeef|ffffffffffffffff)$') { return $true }
  if ($text -match '(?i)(placeholder|not set|unset|undefined|sample|default|emulator|ranchu|goldfish)') { return $true }
  return $false
}

function Get-AndroidIdEvidence {
  param([Parameter(Mandatory=$true)][string]$Serial)
  $raw = Invoke-AdbText -Arguments @('-s', $Serial, 'shell', 'settings', 'get', 'secure', 'android_id')
  $value = $raw.Trim()
  if ([string]::IsNullOrEmpty($value) -or $value -match '^(?i)null$') {
    throw "DEVICE_IDENTITY_MISSING: $Serial did not report a secure android_id."
  }
  if ($value -notmatch '^[0-9a-fA-F]{12,64}$' -or (Test-PlaceholderIdentity -Value $value)) {
    throw "DEVICE_IDENTITY_INVALID: $Serial reported a placeholder or malformed android_id."
  }
  return [ordered]@{
    androidId = $value.ToLowerInvariant()
    raw = $raw
  }
}

function Get-HardwareMacEvidence {
  param([Parameter(Mandatory=$true)][string]$Serial, [Parameter(Mandatory=$true)][string]$IpLinkRaw)
  $addresses = [System.Collections.Generic.List[string]]::new()
  foreach ($match in [regex]::Matches($IpLinkRaw, '(?im)\blink/ether\s+([0-9a-f]{2}(?::[0-9a-f]{2}){5})\b')) {
    $mac = $match.Groups[1].Value.ToLowerInvariant()
    if (Test-PlaceholderIdentity -Value ($mac -replace ':','')) { continue }
    if ($mac -match '^02:00:00:00:00:00$' -or $mac -match '^00:00:00:00:00:00$') { continue }
    if (!$addresses.Contains($mac)) { $addresses.Add($mac) }
  }
  if ($addresses.Count -eq 0) {
    throw "DEVICE_IDENTITY_MISSING: $Serial did not expose a stable hardware MAC address. Enable Wi-Fi and re-run preflight."
  }
  $ordered = @($addresses | Sort-Object)
  return [ordered]@{
    macAddresses = @($ordered)
    raw = $IpLinkRaw
  }
}

function Get-StableDeviceIdentity {
  param(
    [Parameter(Mandatory=$true)][string]$Serial,
    [Parameter(Mandatory=$true)]$Properties,
    [Parameter(Mandatory=$true)][string]$AndroidId
  )
  $serialProperty = ConvertTo-NullableString -Value ([string]$Properties['ro.serialno'])
  $bootSerialProperty = ConvertTo-NullableString -Value ([string]$Properties['ro.boot.serialno'])
  if (($serialProperty -and (Test-PlaceholderIdentity -Value $serialProperty)) -and
      ($bootSerialProperty -and (Test-PlaceholderIdentity -Value $bootSerialProperty))) {
    throw "DEVICE_IDENTITY_INVALID: $Serial reported only placeholder hardware serial properties."
  }
  if ((!$serialProperty -or (Test-PlaceholderIdentity -Value $serialProperty)) -and
      (!$bootSerialProperty -or (Test-PlaceholderIdentity -Value $bootSerialProperty))) {
    throw "DEVICE_IDENTITY_MISSING: $Serial did not report a usable ro.serialno or ro.boot.serialno."
  }

  $ipLinkRaw = Invoke-AdbText -Arguments @('-s', $Serial, 'shell', 'ip', 'link')
  $macEvidence = Get-HardwareMacEvidence -Serial $Serial -IpLinkRaw $ipLinkRaw

  $strongIdentifiers = [System.Collections.Generic.List[string]]::new()
  foreach ($value in @($Serial, $serialProperty, $bootSerialProperty, $AndroidId)) {
    if (![string]::IsNullOrWhiteSpace([string]$value) -and !(Test-PlaceholderIdentity -Value ([string]$value))) {
      $strongIdentifiers.Add([string]$value)
    }
  }
  foreach ($mac in @($macEvidence.macAddresses)) {
    if (![string]::IsNullOrWhiteSpace([string]$mac) -and !(Test-PlaceholderIdentity -Value ([string]$mac -replace ':',''))) {
      $strongIdentifiers.Add([string]$mac)
    }
  }
  if (($strongIdentifiers | Select-Object -Unique).Count -lt 2) {
    throw "DEVICE_IDENTITY_INSUFFICIENT: $Serial did not expose at least two independent stable hardware identifiers."
  }

  $identityMaterial = @(
    ('serial=' + $Serial)
    ('ro.serialno=' + [string]$serialProperty)
    ('ro.boot.serialno=' + [string]$bootSerialProperty)
    ('androidId=' + $AndroidId)
    ('macAddresses=' + (@($macEvidence.macAddresses) -join ','))
    ('brand=' + [string]$Properties['ro.product.brand'])
    ('manufacturer=' + [string]$Properties['ro.product.manufacturer'])
    ('model=' + [string]$Properties['ro.product.model'])
    ('device=' + [string]$Properties['ro.product.device'])
    ('fingerprint=' + [string]$Properties['ro.build.fingerprint'])
    ('bootHardware=' + [string]$Properties['ro.boot.hardware'])
    ('bootloader=' + [string]$Properties['ro.boot.bootloader'])
  ) -join "`n"
  $identitySha256 = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData([System.Text.Encoding]::UTF8.GetBytes($identityMaterial))).ToLowerInvariant()
  return [ordered]@{
    androidId = $AndroidId
    serialProperty = $serialProperty
    bootSerialProperty = $bootSerialProperty
    macAddresses = @($macEvidence.macAddresses)
    strongIdentifierCount = (@($strongIdentifiers | Select-Object -Unique)).Count
    identityMaterial = $identityMaterial
    identitySha256 = $identitySha256
    ipLink = $ipLinkRaw
  }
}

function Test-EmulatorDevice {
  param([Parameter(Mandatory=$true)][string]$Serial, [Parameter(Mandatory=$true)]$Properties)
  if ($Serial -match '^emulator-') { return $true }
  $qemu = [string]$Properties['ro.kernel.qemu']
  if ($qemu -and $qemu -notmatch '^(0|false|no)$') { return $true }
  foreach ($key in @('ro.hardware', 'ro.product.board', 'ro.board.platform', 'ro.boot.hardware', 'ro.product.device', 'ro.product.name')) {
    if ([string]$Properties[$key] -match 'ranchu|goldfish') { return $true }
  }
  if ([string]$Properties['ro.build.characteristics'] -match 'emulator') { return $true }
  if ([string]$Properties['ro.build.fingerprint'] -match 'generic|sdk|emulator') { return $true }
  if ([string]$Properties['ro.product.model'] -match 'sdk_gphone|emulator|Android SDK built for') { return $true }
  return $false
}

function Get-AdbDeviceLine {
  param([string]$DevicesRaw, [Parameter(Mandatory=$true)][string]$Serial)
  $lines = $DevicesRaw -split "`r?`n"
  return ($lines | Where-Object { $_ -match ('^' + [regex]::Escape($Serial) + '\s') } | Select-Object -First 1)
}

function Get-FilteredAdbLines {
  param([string]$Raw, [Parameter(Mandatory=$true)][string]$Serial)
  # adb reverse/forward --list output is either empty or contains an active mapping.
  # Do not filter by serial here: an unexpected format must fail closed.
  return @($Raw -split "`r?`n" | Where-Object { $_.Trim() })
}

function Get-AdbForwardingEvidence {
  param([Parameter(Mandatory=$true)][string]$Serial)
  $reverseRaw = Invoke-AdbText -Arguments @('-s', $Serial, 'reverse', '--list')
  $forwardRaw = Invoke-AdbText -Arguments @('-s', $Serial, 'forward', '--list')
  $reverseLines = Get-FilteredAdbLines -Raw $reverseRaw -Serial $Serial
  $forwardLines = Get-FilteredAdbLines -Raw $forwardRaw -Serial $Serial
  return [ordered]@{
    serial = $Serial
    checkedAt = Get-UtcTimestamp
    reverseRaw = $reverseRaw
    forwardRaw = $forwardRaw
    reverseLines = @($reverseLines)
    forwardLines = @($forwardLines)
    reverseFree = ($reverseLines.Count -eq 0)
    forwardFree = ($forwardLines.Count -eq 0)
  }
}

function Assert-AdbForwardingAbsent {
  param(
    [Parameter(Mandatory=$true)][string]$Serial,
    [Parameter(Mandatory=$true)][string]$Phase
  )
  $evidence = Get-AdbForwardingEvidence -Serial $Serial
  if (!$evidence.reverseFree -or !$evidence.forwardFree) {
    throw "ADB_FORWARDING_PRESENT: adb reverse or forward entries exist for $Serial during $Phase. reverse=[$($evidence.reverseLines -join ', ')] forward=[$($evidence.forwardLines -join ', ')]"
  }
  return $evidence
}

function Add-ForwardingCheckpoint {
  param(
    [Parameter(Mandatory=$true)]$Device,
    [Parameter(Mandatory=$true)][string]$Phase,
    [AllowNull()]$Evidence
  )
  if ($null -eq $Evidence) { $Evidence = Get-AdbForwardingEvidence -Serial ([string]$Device.id) }
  $checkpoints = [System.Collections.Generic.List[object]]::new()
  foreach ($checkpoint in @($Device.forwardingCheckpoints)) {
    if ($null -ne $checkpoint) { $checkpoints.Add($checkpoint) }
  }
  $record = [ordered]@{
    phase = $Phase
    checkedAt = if ($Evidence.checkedAt) { [string]$Evidence.checkedAt } else { Get-UtcTimestamp }
    reverseRaw = [string]$Evidence.reverseRaw
    forwardRaw = [string]$Evidence.forwardRaw
    reverseLines = @($Evidence.reverseLines)
    forwardLines = @($Evidence.forwardLines)
    reverseFree = [bool]$Evidence.reverseFree
    forwardFree = [bool]$Evidence.forwardFree
    free = [bool]($Evidence.reverseFree -and $Evidence.forwardFree)
  }
  $checkpoints.Add($record)
  $Device.forwardingCheckpoints = @($checkpoints)
  if (-not $record.free) {
    throw "ADB_FORWARDING_PRESENT: adb reverse or forward entries exist for $([string]$Device.id) during $Phase."
  }
  return $record
}

function Assert-GpsEvidence {
  param(
    [Parameter(Mandatory=$true)]$Detail,
    [Parameter(Mandatory=$true)][string]$Serial,
    [string]$Phase = 'acceptance'
  )
  if ((Get-ObjectPropertyValue -Value $Detail -Name 'available') -ne $true) {
    throw "GPS_UNAVAILABLE: $Serial did not report an available location during $Phase."
  }
  $permission = [string](Get-ObjectPropertyValue -Value $Detail -Name 'permission')
  if ($permission -notmatch 'ACCESS_(FINE|COARSE)_LOCATION') {
    throw "GPS_PERMISSION_MISSING: $Serial did not report a granted fine or coarse location permission during $Phase."
  }
  $provider = [string](Get-ObjectPropertyValue -Value $Detail -Name 'provider')
  if ([string]::IsNullOrWhiteSpace($provider)) {
    throw "GPS_PROVIDER_MISSING: $Serial did not report a location provider during $Phase."
  }
  $latitudeValue = Get-ObjectPropertyValue -Value $Detail -Name 'latitude'
  $longitudeValue = Get-ObjectPropertyValue -Value $Detail -Name 'longitude'
  if ($null -eq $latitudeValue -or $null -eq $longitudeValue) {
    throw "GPS_UNAVAILABLE: $Serial did not return both coordinates during $Phase."
  }
  $latitude = 0.0
  $longitude = 0.0
  if (![double]::TryParse([string]$latitudeValue, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$latitude) -or
      ![double]::TryParse([string]$longitudeValue, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$longitude)) {
    throw "GPS_UNAVAILABLE: $Serial returned non-numeric coordinates during $Phase."
  }
  if ([double]::IsNaN($latitude) -or [double]::IsInfinity($latitude) -or [double]::IsNaN($longitude) -or [double]::IsInfinity($longitude)) {
    throw "GPS_UNAVAILABLE: $Serial did not resolve finite coordinates during $Phase."
  }
  if ($latitude -eq 0.0 -and $longitude -eq 0.0) {
    throw "GPS_UNAVAILABLE: $Serial returned the invalid 0,0 coordinate during $Phase."
  }
  if ($latitude -lt -90.0 -or $latitude -gt 90.0) {
    throw "GPS_UNAVAILABLE: $Serial returned an out-of-range latitude during $Phase."
  }
  if ($longitude -lt -180.0 -or $longitude -gt 180.0) {
    throw "GPS_UNAVAILABLE: $Serial returned an out-of-range longitude during $Phase."
  }

  $accuracyValue = Get-ObjectPropertyValue -Value $Detail -Name 'accuracy'
  if ($null -eq $accuracyValue) { throw "GPS_ACCURACY_MISSING: $Serial did not report location accuracy during $Phase." }
  $accuracy = 0.0
  if (![double]::TryParse([string]$accuracyValue, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$accuracy) -or
      [double]::IsNaN($accuracy) -or [double]::IsInfinity($accuracy) -or $accuracy -le 0.0) {
    throw "GPS_ACCURACY_INVALID: $Serial reported a non-positive or non-finite accuracy during $Phase."
  }

  $timestampValue = Get-ObjectPropertyValue -Value $Detail -Name 'timestamp'
  $observedAtValue = Get-ObjectPropertyValue -Value $Detail -Name 'observedAt'
  $timestamp = 0L
  $observedAt = 0L
  if ($null -eq $timestampValue -or ![long]::TryParse([string]$timestampValue, [ref]$timestamp) -or
      $null -eq $observedAtValue -or ![long]::TryParse([string]$observedAtValue, [ref]$observedAt)) {
    throw "GPS_TIMESTAMP_INVALID: $Serial did not report numeric location and observation timestamps during $Phase."
  }
  if ($timestamp -le 0 -or $observedAt -le 0) {
    throw "GPS_TIMESTAMP_INVALID: $Serial reported a non-positive location or observation timestamp during $Phase."
  }
  if ($observedAt -lt $timestamp) {
    throw "GPS_TIMESTAMP_INVALID: $Serial observed the location before its own fix timestamp during $Phase."
  }
  $ageValue = Get-ObjectPropertyValue -Value $Detail -Name 'ageMs'
  $ageMs = 0.0
  if ($null -eq $ageValue -or
      ![double]::TryParse([string]$ageValue, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$ageMs) -or
      [double]::IsNaN($ageMs) -or [double]::IsInfinity($ageMs) -or $ageMs -lt 0.0 -or $ageMs -gt 60000.0) {
    throw "GPS_FIX_STALE: $Serial did not report a finite fix age between 0 and 60000 ms during $Phase."
  }

  return [ordered]@{
    available = $true
    permission = $permission
    provider = $provider
    timestamp = $timestamp
    observedAt = $observedAt
    ageMs = $ageMs
    accuracy = $accuracy
    latitude = $latitude
    longitude = $longitude
    phase = $Phase
  }
}

function Initialize-LocalNativeRun {
  param([Parameter(Mandatory=$true)][ValidateSet('preflight', 'acceptance')][string]$RunStage)

  [IO.Directory]::CreateDirectory($verificationDirectory) | Out-Null
  [IO.Directory]::CreateDirectory($rawDirectory) | Out-Null
  # A preflight run is exploratory: it must never archive, overwrite or delete an
  # existing final acceptance report. Only a real acceptance run owns finalPath.
  if ($RunStage -ne 'acceptance') { return }

  [IO.Directory]::CreateDirectory($archiveDirectory) | Out-Null
  if (Test-Path -LiteralPath $finalPath -PathType Leaf) {
    $archiveName = ([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + $runId + '.json')
    try {
      Copy-Item -LiteralPath $finalPath -Destination (Join-Path $archiveDirectory $archiveName) -Force
    } catch {
      # A failed archive must never leave an old passing report in place.
      # The placeholder below is written even when archival fails.
    }
  }
  $placeholder = [ordered]@{
    schemaVersion = 1
    stage = 'acceptance'
    status = 'running'
    passed = $false
    runId = $runId
    subjectBeforeSha256 = $null
    subjectAfterSha256 = $null
    apkSha256 = $null
    driverApkSha256 = $null
    devices = @()
    checks = @()
    evidence = @()
    generatedAt = $startedAt
  }
  Write-JsonAtomic -Path $finalPath -Value $placeholder
}

function Write-FailedFinalReport {
  param(
    [Parameter(Mandatory=$true)]$Failure,
    $SubjectBefore,
    $SubjectAfter,
    $ApkSha256,
    $DriverApkSha256,
    $Devices,
    [AllowNull()]$Evidence,
    [AllowNull()]$Checks
  )
  $message = if ($Failure -is [System.Management.Automation.ErrorRecord]) { $Failure.Exception.Message } else { [string]$Failure }
  $checkValues = @()
  $existingCheckIds = @()
  foreach ($check in @($Checks)) {
    if ($null -eq $check) { continue }
    $checkValues += $check
    $existingCheckIds += [string]$check.id
  }
  foreach ($id in $finalCheckIds) {
    if ($existingCheckIds -contains $id) { continue }
    $checkValues += [ordered]@{ id = $id; passed = $false; evidence = @() }
  }
  $deviceValues = @()
  foreach ($device in @($Devices)) { $deviceValues += $device }
  $evidenceValues = @()
  foreach ($item in @($Evidence)) { if ($null -ne $item) { $evidenceValues += $item } }
  $report = [ordered]@{
    schemaVersion = 1
    stage = 'acceptance'
    status = 'failed'
    passed = $false
    runId = $runId
    subjectBeforeSha256 = $SubjectBefore
    subjectAfterSha256 = $SubjectAfter
    apkSha256 = $ApkSha256
    driverApkSha256 = $DriverApkSha256
    devices = $deviceValues
    checks = @($checkValues)
    evidence = @($evidenceValues)
    failure = [ordered]@{
      code = Get-FailureCode -Message $message
      message = $message
      at = Get-UtcTimestamp
    }
    generatedAt = $startedAt
    completedAt = Get-UtcTimestamp
  }
  Write-JsonAtomic -Path $finalPath -Value $report
}

function Invoke-PreflightStage {
  $checks = [System.Collections.Generic.List[object]]::new()
  $evidence = [System.Collections.Generic.List[object]]::new()
  $devices = [System.Collections.Generic.List[object]]::new()
  $failure = $null
  $report = [ordered]@{
    schemaVersion = 1
    stage = 'preflight'
    status = 'running'
    passed = $false
    runId = $runId
    subjectBeforeSha256 = $null
    subjectAfterSha256 = $null
    apkSha256 = $null
    driverApkSha256 = $null
    apiBase = $ApiBase
    devices = @()
    checks = @()
    evidence = @()
    generatedAt = $startedAt
  }

  try {
    $apkSha256 = Get-ApkSha256
    $driverApkEvidence = Get-DriverApkEvidence
    $driverApkSha256 = [string]$driverApkEvidence.sha256
    $subjectBefore = Get-SubjectSha256
    $report.apkSha256 = $apkSha256
    $report.driverApkSha256 = $driverApkSha256
    $report.apk = Get-ApkEvidence
    $report.driverApk = $driverApkEvidence
    $report.subjectBeforeSha256 = $subjectBefore
    # The driver APK is trusted (pinned certificate, independently re-verified
    # signatures) and bound to the release subject observed by this runner. The
    # build report itself carries no release-subject field, so this binding is
    # runner-observed rather than cryptographically asserted by the build.
    if ([string]$driverApkEvidence.releaseSubjectSha256 -ne [string]$subjectBefore) {
      throw "DRIVER_APK_RELEASE_SUBJECT_MISMATCH: driver APK evidence is bound to $($driverApkEvidence.releaseSubjectSha256) but the current release subject is $subjectBefore."
    }

    $devicesRaw = Invoke-AdbText -Arguments @('devices', '-l')
    $authorized = @()
    foreach ($serial in @($DeviceA, $DeviceB)) {
      $line = Get-AdbDeviceLine -DevicesRaw $devicesRaw -Serial $serial
      $authorized += [bool]($line -and $line -match '^\S+\s+device\b')
    }
    Assert-PreflightCondition -Condition (($authorized | Where-Object { !$_ }).Count -eq 0) -Checks $checks -Id 'preflight-device-authorization' -Details ([ordered]@{
      deviceA = $DeviceA
      deviceB = $DeviceB
      raw = $devicesRaw
    }) -Message 'DEVICE_NOT_AUTHORIZED: Both requested Android devices must be connected and authorized.'

    Assert-PreflightCondition -Condition ($DeviceA -ne $DeviceB) -Checks $checks -Id 'preflight-distinct-devices' -Details ([ordered]@{
      deviceA = $DeviceA
      deviceB = $DeviceB
    }) -Message 'DUPLICATE_DEVICE: Two distinct physical Android devices are required.'

    $emulatorFindings = @()
    $gpsFindings = @()
    foreach ($serial in @($DeviceA, $DeviceB)) {
      $getpropRaw = Invoke-AdbText -Arguments @('-s', $serial, 'shell', 'getprop')
      $routeRaw = Invoke-AdbText -Arguments @('-s', $serial, 'shell', 'ip', 'route')
      $ipAddressRaw = Invoke-AdbText -Arguments @('-s', $serial, 'shell', 'ip', 'addr')
      $forwarding = Assert-AdbForwardingAbsent -Serial $serial -Phase 'preflight-before-install'
      $propertyNames = @(
        'ro.kernel.qemu', 'ro.hardware', 'ro.product.board', 'ro.board.platform', 'ro.boot.hardware',
        'ro.build.characteristics', 'ro.build.fingerprint', 'ro.product.manufacturer', 'ro.product.model',
        'ro.product.device', 'ro.product.name', 'ro.build.version.release', 'ro.build.version.sdk',
        'ro.serialno', 'ro.boot.serialno', 'ro.boot.hardware', 'ro.boot.product.hardware.sku',
        'ro.boot.product.hardware.model', 'ro.boot.bootloader', 'ro.boot.verifiedbootstate',
        'ro.boot.flash.locked', 'ro.product.brand', 'ro.product.locale'
      )
      $properties = [ordered]@{}
      foreach ($name in $propertyNames) { $properties[$name] = Get-PropValue -GetpropRaw $getpropRaw -Name $name }

      if (Test-EmulatorDevice -Serial $serial -Properties $properties) {
        $emulatorFindings += [ordered]@{ id = $serial; properties = $properties }
      }

      $installedClient = Install-AndVerifyPackage -Serial $serial -PackageName $package -Apk $apkPath -ExpectedSha256 $apkSha256 -FailureCode 'APK'
      $installedDriver = Install-AndVerifyPackage -Serial $serial -PackageName 'net.doushisi.acceptance' -Apk $driverApkPath -ExpectedSha256 $driverApkSha256 -FailureCode 'DRIVER_APK'

      $androidIdEvidence = Get-AndroidIdEvidence -Serial $serial
      $identity = Get-StableDeviceIdentity -Serial $serial -Properties $properties -AndroidId ([string]$androidIdEvidence.androidId)
      $serialProperty = $identity.serialProperty
      $bootSerialProperty = $identity.bootSerialProperty
      $identitySha256 = $identity.identitySha256

      # GPS permission and a usable, fresh fix must be proven before the run
      # starts, otherwise the acceptance stage could pass using a mocked or
      # stale location. The Java driver only exposes getLastKnownLocation, so
      # this proves a fresh fix but not that the OS was freshly forced.
      $gpsPreflight = Invoke-AcceptanceBridgeWithValidation -Serial $serial -Action 'gps' -TimeoutSeconds 60 -Attempts 6 -DelayMilliseconds 1000 -Validate {
        param($detail)
        Assert-GpsEvidence -Detail $detail -Serial $serial -Phase 'preflight' | Out-Null
      }
      $gpsFindings += [ordered]@{
        device = $serial
        gps = $gpsPreflight.detail
        attempts = $gpsPreflight.attempts
      }

      $devices.Add([ordered]@{
        id = $serial
        platform = 'android'
        physical = $true
        emulator = $false
        manufacturer = $properties['ro.product.manufacturer']
        model = $properties['ro.product.model']
        android = $properties['ro.build.version.release']
        sdk = $properties['ro.build.version.sdk']
        installedApkPaths = @($installedClient.paths)
        installedApkBasenames = @($installedClient.basenames)
        installedApkSha256ByBasename = $installedClient.sha256ByBasename
        installedApkSha256 = $apkSha256
        installedApkCandidates = @($installedClient.candidates)
        installedApkByScript = [bool]$installedClient.installedByScript
        installedDriverApkPaths = @($installedDriver.paths)
        installedDriverApkBasenames = @($installedDriver.basenames)
        installedDriverApkSha256ByBasename = $installedDriver.sha256ByBasename
        installedDriverApkSha256 = $driverApkSha256
        installedDriverApkCandidates = @($installedDriver.candidates)
        installedDriverApkByScript = [bool]$installedDriver.installedByScript
        connectedWithoutAdbReverse = $true
        connectedWithoutAdbForward = $true
        serial = $serial
        serialProperty = $serialProperty
        bootSerialProperty = $bootSerialProperty
        androidId = $identity.androidId
        macAddresses = @($identity.macAddresses)
        strongIdentifierCount = $identity.strongIdentifierCount
        identityMaterial = $identity.identityMaterial
        fingerprint = $properties['ro.build.fingerprint']
        brand = $properties['ro.product.brand']
        identitySha256 = $identitySha256
        properties = $properties
        getprop = $getpropRaw
        route = $routeRaw
        ipAddr = $ipAddressRaw
        ipLink = $identity.ipLink
        gps = $gpsPreflight.detail
        reverseList = $forwarding.reverseRaw
        forwardList = $forwarding.forwardRaw
        reverseLines = @($forwarding.reverseLines)
        forwardLines = @($forwarding.forwardLines)
        forwardingCheckedBefore = $true
        forwardingCheckedAfter = $false
        forwardingFreeBefore = ($forwarding.reverseFree -and $forwarding.forwardFree)
        forwardingFreeAfter = $false
        forwardingCheckpoints = @([ordered]@{
          phase = 'preflight-before-install'
          checkedAt = [string]$forwarding.checkedAt
          reverseRaw = [string]$forwarding.reverseRaw
          forwardRaw = [string]$forwarding.forwardRaw
          reverseLines = @($forwarding.reverseLines)
          forwardLines = @($forwarding.forwardLines)
          reverseFree = [bool]$forwarding.reverseFree
          forwardFree = [bool]$forwarding.forwardFree
          free = [bool]($forwarding.reverseFree -and $forwarding.forwardFree)
        })
      })
    }

    Assert-PreflightCondition -Condition (@($devices | ForEach-Object { $_.identitySha256 } | Select-Object -Unique).Count -eq $devices.Count) -Checks $checks -Id 'preflight-distinct-device-identity' -Details ([ordered]@{
      identities = @($devices | ForEach-Object { [ordered]@{ id = $_.id; serialProperty = $_.serialProperty; bootSerialProperty = $_.bootSerialProperty; androidId = $_.androidId; macAddresses = @($_.macAddresses); strongIdentifierCount = $_.strongIdentifierCount; identitySha256 = $_.identitySha256 } })
    }) -Message 'DUPLICATE_DEVICE_IDENTITY: Device properties did not identify two distinct physical devices.'

    Assert-PreflightCondition -Condition ($gpsFindings.Count -eq $devices.Count) -Checks $checks -Id 'preflight-gps-evidence' -Details ([ordered]@{
      findings = $gpsFindings
    }) -Message 'GPS_UNAVAILABLE: Both physical devices must prove a granted location permission and a fresh usable fix before acceptance.'

    Assert-PreflightCondition -Condition ($emulatorFindings.Count -eq 0) -Checks $checks -Id 'preflight-no-emulator' -Details ([ordered]@{
      findings = $emulatorFindings
    }) -Message 'EMULATOR_DEVICE_REJECTED: Emulator devices cannot satisfy physical Android acceptance.'

    $health = Invoke-RestMethod -Uri ($ApiBase.TrimEnd('/') + '/health') -TimeoutSec 10
    Assert-PreflightCondition -Condition ($health.status -eq 'ok') -Checks $checks -Id 'preflight-server-health' -Details ([ordered]@{
      apiBase = $ApiBase
      health = $health
    }) -Message 'SERVER_HEALTH_FAILED: Local server health check did not return ok.'

    $rawPath = Join-Path $rawDirectory 'local-native-preflight.json'
    $rawEvidence = [ordered]@{
      schemaVersion = 1
      generatedAt = Get-UtcTimestamp
      apiBase = $ApiBase
      health = $health
      apk = Get-ApkEvidence
      driverApk = $driverApkEvidence
      adbDevices = $devicesRaw
      devices = @($devices)
    }
    Write-JsonAtomic -Path $rawPath -Value $rawEvidence
    $rawHash = Get-Sha256 -Path $rawPath
    $evidence.Add([ordered]@{
      path = Get-ProjectRelativePath -Path $rawPath
      sha256 = $rawHash
      kind = 'preflight-raw-devices'
    })
    Add-PreflightCheck -Checks $checks -Id 'preflight-raw-evidence' -Passed $true -Details ([ordered]@{
      path = Get-ProjectRelativePath -Path $rawPath
      sha256 = $rawHash
    })
  } catch {
    $failure = $_
  } finally {
    try {
      # Re-read both installed packages from each device at the end of preflight so
      # the preflight report cannot rely on the install-time snapshot alone. The
      # acceptance stage performs its own end-of-run re-read.
      foreach ($device in @($devices)) {
        if ($null -eq $device.installedApkPaths -or $null -eq $device.installedDriverApkPaths) {
          throw "LOCAL_NATIVE_INSTALL_BASELINE_MISSING: $($device.id) has no preflight installed-package baseline to compare against."
        }
        $rereadClient = Assert-InstalledPackageMatchesSnapshot -Serial ([string]$device.id) -PackageName $package -ExpectedSha256 ([string]$apkSha256) -FailureCode 'LOCAL_NATIVE_APK' -Phase 'preflight-post-install' -ExpectedPaths @($device.installedApkPaths) -ExpectedBasenames @($device.installedApkBasenames) -ExpectedSha256ByBasename $device.installedApkSha256ByBasename
        $rereadDriver = Assert-InstalledPackageMatchesSnapshot -Serial ([string]$device.id) -PackageName 'net.doushisi.acceptance' -ExpectedSha256 ([string]$driverApkSha256) -FailureCode 'LOCAL_NATIVE_DRIVER_APK' -Phase 'preflight-post-install' -ExpectedPaths @($device.installedDriverApkPaths) -ExpectedBasenames @($device.installedDriverApkBasenames) -ExpectedSha256ByBasename $device.installedDriverApkSha256ByBasename
        $device.preflightClientReread = $rereadClient
        $device.preflightDriverReread = $rereadDriver
        Add-ForwardingCheckpoint -Device $device -Phase 'preflight-final' -Evidence (Assert-AdbForwardingAbsent -Serial ([string]$device.id) -Phase 'preflight-final') | Out-Null
      }
    } catch {
      if (!$failure) { $failure = $_ }
    }
    try {
      $subjectAfter = Get-SubjectSha256
      $report.subjectAfterSha256 = $subjectAfter
      $stable = $report.subjectBeforeSha256 -and ($subjectAfter -eq $report.subjectBeforeSha256)
      Add-PreflightCheck -Checks $checks -Id 'preflight-subject-stability' -Passed $stable -Details ([ordered]@{
        subjectBeforeSha256 = $report.subjectBeforeSha256
        subjectAfterSha256 = $subjectAfter
      })
      if (!$stable -and !$failure) { $failure = [System.InvalidOperationException]::new('SUBJECT_CHANGED_DURING_PREFLIGHT: Source or APK changed while preflight was running.') }
    } catch {
      if (!$failure) { $failure = $_ }
    }

    $report.devices = @($devices)
    $report.checks = @($checks)
    $report.evidence = @($evidence)
    $report.status = if ($failure) { 'failed' } else { 'passed' }
    $report.passed = ($null -eq $failure)
    if ($failure) {
      $message = $failure.Exception.Message
      $report.failure = [ordered]@{
        code = Get-FailureCode -Message $message
        message = $message
        at = Get-UtcTimestamp
      }
    }
    $report.completedAt = Get-UtcTimestamp
    Write-JsonAtomic -Path $preflightPath -Value $report
  }

  if ($failure) { throw $failure }
  return $report
}

function Invoke-FinalAcceptanceStage {
  param([Parameter(Mandatory=$true)]$Preflight)

  if (!$Preflight.passed -or $Preflight.stage -ne 'preflight') {
    throw 'ACCEPTANCE_PREFLIGHT_FAILED: Final acceptance requires a passing preflight.'
  }

  $script:acceptanceChecks = [System.Collections.Generic.List[object]]::new()
  $script:acceptanceEvidence = [System.Collections.Generic.List[object]]::new()
  $script:acceptanceDevices = @($Preflight.devices)
  $checks = $script:acceptanceChecks
  $evidence = $script:acceptanceEvidence
  $devices = $script:acceptanceDevices
  $failure = $null
  $report = [ordered]@{
    schemaVersion = 1
    stage = 'acceptance'
    status = 'running'
    passed = $false
    runId = $runId
    subjectBeforeSha256 = $Preflight.subjectBeforeSha256
    subjectAfterSha256 = $null
    apkSha256 = $Preflight.apkSha256
    driverApkSha256 = $Preflight.driverApkSha256
    devices = @($devices)
    checks = @()
    evidence = @()
    generatedAt = Get-UtcTimestamp
  }

  try {
    if (@($devices).Count -ne 2) {
      throw 'PHYSICAL_DEVICE_EVIDENCE_MISSING: Final acceptance requires exactly two preflight devices.'
    }
    $deviceIds = @($devices | ForEach-Object { [string]$_.id })
    if ($deviceIds.Count -ne 2 -or $deviceIds[0] -eq $deviceIds[1]) {
      throw 'PHYSICAL_DEVICE_EVIDENCE_MISSING: Final acceptance requires two distinct devices.'
    }
    foreach ($device in $devices) {
      if ([string]$device.platform -ne 'android' -or $device.physical -ne $true -or $device.emulator -eq $true) {
        throw "PHYSICAL_DEVICE_EVIDENCE_MISSING: $($device.id) is not a verified physical Android device."
      }
      if ([string]::IsNullOrWhiteSpace([string]$device.identitySha256) -or [int]$device.strongIdentifierCount -lt 2) {
        throw "PHYSICAL_DEVICE_EVIDENCE_MISSING: $($device.id) does not have sufficient stable hardware identity evidence."
      }
      if ([string]$device.installedApkSha256 -ne [string]$Preflight.apkSha256) {
        throw "LOCAL_NATIVE_DEVICE_APK_MISMATCH: $($device.id) is not bound to the preflight APK."
      }
      if ([string]$device.installedDriverApkSha256 -ne [string]$Preflight.driverApkSha256) {
        throw "LOCAL_NATIVE_DRIVER_APK_MISMATCH: $($device.id) is not bound to the preflight driver APK."
      }
      if ($device.connectedWithoutAdbReverse -ne $true -or $device.connectedWithoutAdbForward -ne $true) {
        throw "LOCAL_NATIVE_ADB_FORWARDING_PRESENT: $($device.id) used adb forwarding during preflight."
      }
      # Re-read the installed packages instead of trusting the preflight values.
      # The re-read must match the preflight path, basename and hash, and it must
      # not silently accept a changed split set or an unexpected APK payload.
      $device.installedClientAtAcceptanceStart = Assert-InstalledPackageMatchesSnapshot -Serial ([string]$device.id) -PackageName $package -ExpectedSha256 ([string]$Preflight.apkSha256) -FailureCode 'LOCAL_NATIVE_APK' -Phase 'acceptance-start' -ExpectedPaths @($device.installedApkPaths) -ExpectedBasenames @($device.installedApkBasenames) -ExpectedSha256ByBasename $device.installedApkSha256ByBasename
      $device.installedDriverAtAcceptanceStart = Assert-InstalledPackageMatchesSnapshot -Serial ([string]$device.id) -PackageName 'net.doushisi.acceptance' -ExpectedSha256 ([string]$Preflight.driverApkSha256) -FailureCode 'LOCAL_NATIVE_DRIVER_APK' -Phase 'acceptance-start' -ExpectedPaths @($device.installedDriverApkPaths) -ExpectedBasenames @($device.installedDriverApkBasenames) -ExpectedSha256ByBasename $device.installedDriverApkSha256ByBasename
      $device.forwardingAtAcceptanceStart = Add-ForwardingCheckpoint -Device $device -Phase 'acceptance-start' -Evidence (Assert-AdbForwardingAbsent -Serial ([string]$device.id) -Phase 'acceptance-start')
    }

    if (!(Test-Path -LiteralPath $localAccessPath -PathType Leaf)) {
      throw "LOCAL_ACCESS_MISSING: $localAccessPath"
    }
    $localAccess = Get-Content -LiteralPath $localAccessPath -Raw | ConvertFrom-Json
    $adminUsername = [string](Get-ObjectPropertyValue -Value (Get-ObjectPropertyValue -Value $localAccess -Name 'beans') -Name 'username')
    $adminPassword = [string](Get-ObjectPropertyValue -Value (Get-ObjectPropertyValue -Value $localAccess -Name 'beans') -Name 'password')
    if ([string]::IsNullOrWhiteSpace($adminUsername) -or [string]::IsNullOrWhiteSpace($adminPassword)) {
      throw 'LOCAL_ACCESS_INVALID: Beans administrator credentials are required for real credit acceptance.'
    }

    $loginRequest = @{
      Method = 'Post'
      Uri = $ApiBase.TrimEnd('/') + '/api/admin/login'
      ContentType = 'application/json'
      Body = @{ username = $adminUsername; password = $adminPassword } | ConvertTo-Json -Compress
      TimeoutSec = 20
    }
    $adminLogin = Invoke-RestMethod @loginRequest
    $adminToken = [string]$adminLogin.token
    if ([string]::IsNullOrWhiteSpace($adminToken)) { throw 'ADMIN_LOGIN_FAILED: Beans administrator login returned no token.' }
    $adminHeaders = @{ Authorization = "Bearer $adminToken" }

    $accounts = @()
    foreach ($device in $devices) {
      $suffix = (Get-RandomToken -ByteCount 6).ToLowerInvariant().Replace('-', '').Replace('_', '')
      $username = 'acc' + $suffix.Substring(0, [Math]::Min(12, $suffix.Length))
      if ($username.Length -lt 4) { $username = 'acc' + ([guid]::NewGuid().ToString('N').Substring(0, 12)) }
      $accounts += [ordered]@{
        device = [string]$device.id
        username = $username
        password = ('Aa1!' + (Get-RandomToken -ByteCount 18))
        nickname = ('验收' + $username.Substring([Math]::Max(0, $username.Length - 6)))
        expectedBalance = '100'
        userId = $null
        register = $null
        login = $null
        credit = $null
        create = $null
        join = $null
        ready = $null
        autoPlay = $null
        completed = $null
        settlement = $null
        reconnect = $null
        replay = $null
        gps = $null
        voice = $null
        network = $null
      }
    }

    for ($index = 0; $index -lt $accounts.Count; $index++) {
      $account = $accounts[$index]
      $serial = [string]$account.device
      $registerResult = Invoke-AcceptanceBridgeWithValidation -Serial $serial -Action 'register' -Fields @{
        username = [string]$account.username
        password = [string]$account.password
        nickname = [string]$account.nickname
      } -TimeoutSeconds 60 -Attempts 6 -DelayMilliseconds 2000 -Validate {
        param($detail)
        if ((Get-ObjectPropertyValue -Value $detail -Name 'registered') -ne $true) {
          throw "REGISTER_FAILED: $serial did not confirm account registration."
        }
        $registeredUserId = Get-ObjectPropertyValue -Value $detail -Name 'userId'
        if ($registeredUserId -isnot [string] -or [string]::IsNullOrWhiteSpace($registeredUserId)) {
          throw "REGISTER_FAILED: $serial did not return a registered user id."
        }
      }
      $registerDetail = $registerResult.detail
      $account.register = $registerDetail
      $account.userId = [string](Get-RequiredObjectPropertyValue -Value $registerDetail -Name 'userId' -Context "register on $serial")
      if ([string](Get-RequiredObjectPropertyValue -Value $registerDetail -Name 'registered' -Context "register on $serial") -ne 'True') {
        throw "REGISTER_FAILED: $serial did not confirm account registration."
      }

      $loginResult = Invoke-AcceptanceBridgeWithValidation -Serial $serial -Action 'login' -Fields @{
        username = [string]$account.username
        password = [string]$account.password
      } -TimeoutSeconds 60 -Attempts 6 -DelayMilliseconds 2000 -Validate {
        param($detail)
        if ((Get-ObjectPropertyValue -Value $detail -Name 'submitted') -ne $true) {
          throw "LOGIN_FAILED: $serial did not submit the original login UI."
        }
      }
      $loginDetail = $loginResult.detail
      $account.login = $loginDetail
      $loginSubmitted = Get-ObjectPropertyValue -Value $loginDetail -Name 'submitted'
      if ($loginSubmitted -ne $true) { throw "LOGIN_FAILED: $serial did not submit the original login UI." }

      $status = $null
      $statusDeadline = [DateTime]::UtcNow.AddSeconds(45)
      do {
        $statusReceipt = Invoke-AcceptanceBridge -Serial $serial -Action 'status' -TimeoutSeconds 45
        $status = Assert-AcceptanceDetail -Receipt $statusReceipt -Action 'status' -Serial $serial
        $statusUserId = [string](Get-ObjectPropertyValue -Value $status -Name 'userId')
        if ($statusUserId -eq [string]$account.userId) { break }
        if ([DateTime]::UtcNow -ge $statusDeadline) { throw "LOGIN_NOT_CONFIRMED: $serial did not reach the registered account." }
        Start-Sleep -Milliseconds 500
      } while ($true)
      $account.loginStatus = $status
    }

    foreach ($account in $accounts) {
      $requestId = 'credit-' + [guid]::NewGuid().ToString('N')
      $adjustmentRequest = @{
        Method = 'Post'
        Uri = $ApiBase.TrimEnd('/') + '/api/admin/users/' + [string]$account.userId + '/adjustments'
        Headers = $adminHeaders
        ContentType = 'application/json'
        Body = @{ amount = [string]$account.expectedBalance; reason = 'local native acceptance'; requestId = $requestId } | ConvertTo-Json -Compress
        TimeoutSec = 20
      }
      $adjustment = Invoke-RestMethod @adjustmentRequest
      $credit = Invoke-AcceptanceBridge -Serial ([string]$account.device) -Action 'beans-credit' -Fields @{
        expectedAmount = [string]$account.expectedBalance
        timeoutMs = 45000
      } -TimeoutSeconds 60
      $creditDetail = Assert-AcceptanceDetail -Receipt $credit -Action 'beans-credit' -Serial ([string]$account.device)
      $account.credit = [ordered]@{ adjustment = $adjustment; device = $creditDetail }
      if ([string](Get-RequiredObjectPropertyValue -Value $creditDetail -Name 'balance' -Context 'beans-credit') -ne [string]$account.expectedBalance) {
        throw "BEANS_CREDIT_FAILED: $($account.device) did not observe the credited balance."
      }
    }

    $owner = $accounts[0]
    $joiner = $accounts[1]
    $create = Invoke-AcceptanceBridge -Serial ([string]$owner.device) -Action 'create-and-join' -Fields @{
      areaType = 8
      variantIndex = 0
      playerNum = 2
      gameNum = $configuredGameNum
      baseBeans = '0.125'
    } -TimeoutSeconds 60
    $createDetail = Assert-AcceptanceDetail -Receipt $create -Action 'create-and-join' -Serial ([string]$owner.device)
    $owner.create = $createDetail
    $roomId = [string](Get-RequiredObjectPropertyValue -Value $createDetail -Name 'roomId' -Context 'create-and-join')
    $roomCode = [string](Get-RequiredObjectPropertyValue -Value $createDetail -Name 'roomCode' -Context 'create-and-join')
    if ($roomCode -notmatch '^\d{6}$') { throw 'ROOM_CODE_INVALID: create-and-join returned an invalid room code.' }

    $join = Invoke-AcceptanceBridge -Serial ([string]$joiner.device) -Action 'joinRoom' -Fields @{ roomCode = $roomCode } -TimeoutSeconds 60
    $joinDetail = Assert-AcceptanceDetail -Receipt $join -Action 'joinRoom' -Serial ([string]$joiner.device)
    $joiner.join = $joinDetail
    if ([string](Get-RequiredObjectPropertyValue -Value $joinDetail -Name 'roomId' -Context 'join') -ne $roomId) {
      throw 'JOIN_ROOM_FAILED: devices joined different rooms.'
    }

    foreach ($account in @($owner, $joiner)) {
      $readyResult = Invoke-AcceptanceBridgeWithValidation -Serial ([string]$account.device) -Action 'ready' -TimeoutSeconds 60 -Attempts 3 -Validate {
        param($detail)
        if ((Get-ObjectPropertyValue -Value $detail -Name 'submitted') -ne $true) {
          throw "READY_FAILED: $($account.device) did not submit the ready action."
        }
      }
      $account.ready = $readyResult.detail
    }

    # Both ready actions must be submitted before either client attempts the
    # hosted autoPlay action. The adapter owns the wait for the round or hand.
    foreach ($account in @($owner, $joiner)) {
      $autoPlayResult = Invoke-AcceptanceBridgeWithValidation -Serial ([string]$account.device) -Action 'autoPlay' -Fields @{ enabled = $true } -TimeoutSeconds 60 -Attempts 3 -Validate {
        param($detail)
        if ((Get-ObjectPropertyValue -Value $detail -Name 'submitted') -ne $true -or (Get-ObjectPropertyValue -Value $detail -Name 'enabled') -ne $true) {
          throw "AUTOPLAY_FAILED: $($account.device) did not enable autoplay."
        }
      }
      $account.autoPlay = $autoPlayResult.detail
    }

    $completed = $null
    $completedDeadline = [DateTime]::UtcNow.AddMinutes(30)
    do {
      $completed = $null
      $roundsByDevice = @{}
      $settlementsByDevice = @{}
      foreach ($account in @($owner, $joiner)) {
        $completedReceipt = Invoke-AcceptanceBridge -Serial ([string]$account.device) -Action 'completed-round' -Fields @{ roomId = $roomId } -TimeoutSeconds 60
        $completedDetail = Assert-AcceptanceDetail -Receipt $completedReceipt -Action 'completed-round' -Serial ([string]$account.device)
        $account.completed = $completedDetail
        $rounds = @(Get-ObjectPropertyValue -Value $completedDetail -Name 'rounds')
        $settled = @($rounds | Where-Object { $null -ne (Get-ObjectPropertyValue -Value $_ -Name 'settledAt') })
        $roundsByDevice[[string]$account.device] = $rounds
        $settlementsByDevice[[string]$account.device] = $settled.Count
        if ($settled.Count -gt 0 -and $null -eq $completed) {
          $completed = [ordered]@{ roomId = $roomId; rounds = $rounds; settledCount = $settled.Count }
        }
      }
      $allClientsComplete = @($settlementsByDevice.Keys | Where-Object { $settlementsByDevice[$_] -lt $requiredCompletedRounds }).Count -eq 0
      if ($allClientsComplete) {
        $completed = [ordered]@{
          roomId = $roomId
          rounds = @($roundsByDevice[[string]$owner.device])
          settledCount = $requiredCompletedRounds
          completedByDevice = $settlementsByDevice
          requiredCompletedRounds = $requiredCompletedRounds
        }
        break
      }
      if ([DateTime]::UtcNow -ge $completedDeadline) {
        throw "COMPLETED_ROUND_TIMEOUT: both devices did not observe $requiredCompletedRounds settled rounds."
      }
      # adb reverse/forward must stay absent for the whole run, not only at the
      # start and end. Re-check during the long round wait.
      foreach ($device in @($devices)) {
        Add-ForwardingCheckpoint -Device $device -Phase 'during-rounds' -Evidence (Assert-AdbForwardingAbsent -Serial ([string]$device.id) -Phase 'during-rounds') | Out-Null
      }
      Start-Sleep -Seconds 2
    } while ($true)

    $settledRounds = @($completed.rounds | Where-Object { $null -ne (Get-ObjectPropertyValue -Value $_ -Name 'settledAt') })
    if ($settledRounds.Count -ne $requiredCompletedRounds) {
      throw "COMPLETED_ROUND_MISMATCH: expected $requiredCompletedRounds settled rounds, observed $($settledRounds.Count)."
    }
    $roundId = [string](Get-RequiredObjectPropertyValue -Value ($settledRounds[0]) -Name 'id' -Context 'completed-round')
    foreach ($account in @($owner, $joiner)) {
      $settlement = Invoke-AcceptanceBridge -Serial ([string]$account.device) -Action 'settlement' -Fields @{ roomId = $roomId } -TimeoutSeconds 60
      $account.settlement = Assert-AcceptanceDetail -Receipt $settlement -Action 'settlement' -Serial ([string]$account.device)
      $reconnectResult = Invoke-AcceptanceBridgeWithValidation -Serial ([string]$account.device) -Action 'reconnect' -TimeoutSeconds 60 -Attempts 4 -DelayMilliseconds 1000 -Validate {
        param($detail)
        if ((Get-ObjectPropertyValue -Value $detail -Name 'requested') -ne $true -or (Get-ObjectPropertyValue -Value $detail -Name 'hasLiveRoom') -ne $true) {
          throw "RECONNECT_FAILED: $($account.device) did not recover a live room."
        }
      }
      $account.reconnect = $reconnectResult.detail
      $gpsResult = Invoke-AcceptanceBridgeWithValidation -Serial ([string]$account.device) -Action 'gps' -TimeoutSeconds 60 -Attempts 6 -DelayMilliseconds 1000 -Validate {
        param($detail)
        Assert-GpsEvidence -Detail $detail -Serial ([string]$account.device) -Phase 'acceptance' | Out-Null
      }
      $account.gps = $gpsResult.detail
      $targetSeat = if ($account -eq $owner) { 2 } else { 1 }
      $voice = Invoke-AcceptanceBridge -Serial ([string]$account.device) -Action 'quick-voice' -Fields @{ mutualFaceId = 1; targetSeat = $targetSeat } -TimeoutSeconds 60
      $account.voice = Assert-AcceptanceDetail -Receipt $voice -Action 'quick-voice' -Serial ([string]$account.device)
      $network = Invoke-AcceptanceBridge -Serial ([string]$account.device) -Action 'standalone-network' -TimeoutSeconds 60
      $account.network = Assert-AcceptanceDetail -Receipt $network -Action 'standalone-network' -Serial ([string]$account.device)
      $deviceRecord = @($devices | Where-Object { [string]$_.id -eq [string]$account.device })[0]
      Add-ForwardingCheckpoint -Device $deviceRecord -Phase 'after-reconnect-network' -Evidence (Assert-AdbForwardingAbsent -Serial ([string]$account.device) -Phase 'after-reconnect-network') | Out-Null
    }

    foreach ($account in @($owner, $joiner)) {
      if ($account.reconnect.hasLiveRoom -ne $true) { throw "RECONNECT_FAILED: $($account.device) did not recover a live room." }
      if ($account.settlement.completedRounds -ne $requiredCompletedRounds) { throw "SETTLEMENT_FAILED: $($account.device) did not observe all $requiredCompletedRounds completed rounds." }
      $account.network = Assert-LanNetwork -Account $account
    }

    # Replay requires Standalone.hasLiveRoom() to be false. Exit the live room
    # on every device and verify the client-side room cursor before replaying.
    foreach ($account in @($owner, $joiner)) {
      $exitResult = Invoke-AcceptanceBridge -Serial ([string]$account.device) -Action 'exit' -TimeoutSeconds 60
      $account.exit = Assert-AcceptanceDetail -Receipt $exitResult -Action 'exit' -Serial ([string]$account.device)
      $exitDeadline = [DateTime]::UtcNow.AddSeconds(60)
      do {
        $exitStatusReceipt = Invoke-AcceptanceBridge -Serial ([string]$account.device) -Action 'status' -TimeoutSeconds 60
        $exitStatus = Assert-AcceptanceDetail -Receipt $exitStatusReceipt -Action 'status' -Serial ([string]$account.device)
        if ((Get-ObjectPropertyValue -Value $exitStatus -Name 'hasLiveRoom') -eq $false) { break }
        if ([DateTime]::UtcNow -ge $exitDeadline) {
          throw "ROOM_EXIT_TIMEOUT: $($account.device) still reports a live room after exit."
        }
        Start-Sleep -Milliseconds 500
      } while ($true)
      $account.exitStatus = $exitStatus
    }

    foreach ($account in @($owner, $joiner)) {
      $replayResult = Invoke-AcceptanceBridgeWithValidation -Serial ([string]$account.device) -Action 'animated-replay' -Fields @{ roomId = $roomId; roundId = $roundId } -TimeoutSeconds 90 -Attempts 3 -DelayMilliseconds 1000 -Validate {
        param($detail)
        if ((Get-ObjectPropertyValue -Value $detail -Name 'loaded') -ne $true -or (Get-ObjectPropertyValue -Value $detail -Name 'attached') -ne $true) {
          throw "ANIMATED_REPLAY_FAILED: $($account.device) did not attach the replay controller."
        }
      }
      $account.replay = $replayResult.detail
    }

    # Credentials are needed only to drive the real UI and are never evidence.
    foreach ($account in @($accounts)) { $account.password = $null }

    foreach ($device in @($devices)) {
      $postForwarding = Assert-AdbForwardingAbsent -Serial ([string]$device.id) -Phase 'post-acceptance'
      $device.forwardingCheckedAfter = $true
      $device.forwardingFreeAfter = ($postForwarding.reverseFree -and $postForwarding.forwardFree)
      $device.reverseListAfter = $postForwarding.reverseRaw
      $device.forwardListAfter = $postForwarding.forwardRaw
      $device.reverseLinesAfter = @($postForwarding.reverseLines)
      $device.forwardLinesAfter = @($postForwarding.forwardLines)
      if (!$device.forwardingFreeAfter) {
        throw "ADB_FORWARDING_PRESENT_AFTER_ACCEPTANCE: $($device.id) still has adb reverse or forward mappings."
      }
      $device.forwardingCheckpointsAfter = @($device.forwardingCheckpoints)
      Add-ForwardingCheckpoint -Device $device -Phase 'post-acceptance' -Evidence $postForwarding | Out-Null
      # Re-read both installed packages one final time, after forwarding was
      # re-checked, so the acceptance report reflects the end-of-run payload
      # instead of the preflight/acceptance-start snapshot alone.
      $endClient = Assert-InstalledPackageMatchesSnapshot -Serial ([string]$device.id) -PackageName $package -ExpectedSha256 ([string]$Preflight.apkSha256) -FailureCode 'LOCAL_NATIVE_APK' -Phase 'acceptance-final' -ExpectedPaths @($device.installedApkPaths) -ExpectedBasenames @($device.installedApkBasenames) -ExpectedSha256ByBasename $device.installedApkSha256ByBasename
      $endDriver = Assert-InstalledPackageMatchesSnapshot -Serial ([string]$device.id) -PackageName 'net.doushisi.acceptance' -ExpectedSha256 ([string]$Preflight.driverApkSha256) -FailureCode 'LOCAL_NATIVE_DRIVER_APK' -Phase 'acceptance-final' -ExpectedPaths @($device.installedDriverApkPaths) -ExpectedBasenames @($device.installedDriverApkBasenames) -ExpectedSha256ByBasename $device.installedDriverApkSha256ByBasename
      $device.installedClientAtAcceptanceEnd = $endClient
      $device.installedDriverAtAcceptanceEnd = $endDriver
      $device.installedClientFinalSha256 = [string]$endClient.hashes[0]
      $device.installedDriverFinalSha256 = [string]$endDriver.hashes[0]
      $clientFinalByBasename = [ordered]@{}
      foreach ($entry in @($endClient.entries)) { $clientFinalByBasename[[string]$entry.basename] = [string]$entry.sha256 }
      $driverFinalByBasename = [ordered]@{}
      foreach ($entry in @($endDriver.entries)) { $driverFinalByBasename[[string]$entry.basename] = [string]$entry.sha256 }
      $device.installedClientFinalSha256ByBasename = $clientFinalByBasename
      $device.installedDriverFinalSha256ByBasename = $driverFinalByBasename
      $device.installedPackageRereadAt = Get-UtcTimestamp
      Add-ForwardingCheckpoint -Device $device -Phase 'acceptance-final' -Evidence (Assert-AdbForwardingAbsent -Serial ([string]$device.id) -Phase 'acceptance-final') | Out-Null
    }

    $runEvidence = [ordered]@{
      schemaVersion = 1
      runId = $runId
      apkSha256 = $Preflight.apkSha256
      driverApkSha256 = $Preflight.driverApkSha256
      roomId = $roomId
      roomCode = $roomCode
      roundId = $roundId
      accounts = @($accounts | ForEach-Object {
        [ordered]@{
          device = $_.device
          userId = $_.userId
          username = $_.username
          register = $_.register
          login = $_.loginStatus
          credit = $_.credit
          create = $_.create
          join = $_.join
          ready = $_.ready
          autoPlay = $_.autoPlay
          completed = $_.completed
          settlement = $_.settlement
          reconnect = $_.reconnect
          exit = $_.exit
          exitStatus = $_.exitStatus
          replay = $_.replay
          gps = $_.gps
          voice = $_.voice
          network = $_.network
        }
      })
    }
    $runEvidenceDescriptor = Write-RawAcceptanceEvidence -Name 'acceptance-run' -Value $runEvidence -Evidence $evidence -Kind 'local-native-run'

    New-FinalCheck -Checks $checks -Id 'register' -Passed $true -Evidence @($runEvidenceDescriptor) -Details @{ devices = $deviceIds; userIds = @($accounts | ForEach-Object { $_.userId }) }
    New-FinalCheck -Checks $checks -Id 'beans-credit' -Passed $true -Evidence @($runEvidenceDescriptor) -Details @{ expectedBalance = '100' }
    New-FinalCheck -Checks $checks -Id 'create-and-join' -Passed $true -Evidence @($runEvidenceDescriptor) -Details @{ roomId = $roomId; roomCode = $roomCode }
    New-FinalCheck -Checks $checks -Id 'completed-round' -Passed $true -Evidence @($runEvidenceDescriptor) -Details @{ roundId = $roundId; settledCount = $requiredCompletedRounds }
    New-FinalCheck -Checks $checks -Id 'settlement' -Passed $true -Evidence @($runEvidenceDescriptor) -Details @{ completedRounds = @($accounts | ForEach-Object { $_.settlement.completedRounds }) }
    New-FinalCheck -Checks $checks -Id 'auto-play' -Passed $true -Evidence @($runEvidenceDescriptor) -Details @{ enabled = $true }
    New-FinalCheck -Checks $checks -Id 'reconnect' -Passed $true -Evidence @($runEvidenceDescriptor) -Details @{ liveRooms = @($accounts | ForEach-Object { $_.reconnect.hasLiveRoom }) }
    New-FinalCheck -Checks $checks -Id 'animated-replay' -Passed $true -Evidence @($runEvidenceDescriptor) -Details @{ roomId = $roomId; roundId = $roundId }
    New-FinalCheck -Checks $checks -Id 'gps' -Passed $true -Evidence @($runEvidenceDescriptor) -Details @{ devices = $deviceIds }
    New-FinalCheck -Checks $checks -Id 'quick-voice' -Passed $true -Evidence @($runEvidenceDescriptor) -Details @{ devices = $deviceIds }
    New-FinalCheck -Checks $checks -Id 'standalone-network' -Passed $true -Evidence @($runEvidenceDescriptor) -Details @{ apiBase = $ApiBase }

    $deviceSummary = @($devices | ForEach-Object {
      [ordered]@{
        id = [string]$_.id
        platform = [string]$_.platform
        physical = $true
        emulator = $false
        manufacturer = [string]$_.manufacturer
        model = [string]$_.model
        android = [string]$_.android
        sdk = [string]$_.sdk
        installedApkSha256 = [string]$_.installedApkSha256
        installedApkPaths = @($_.installedApkPaths)
        installedApkBasenames = @($_.installedApkBasenames)
        installedClientFinalSha256 = [string]$_.installedClientFinalSha256
        installedClientRereadAt = [string]$_.installedPackageRereadAt
        installedDriverApkSha256 = [string]$_.installedDriverApkSha256
        installedDriverApkPaths = @($_.installedDriverApkPaths)
        installedDriverApkBasenames = @($_.installedDriverApkBasenames)
        installedDriverFinalSha256 = [string]$_.installedDriverFinalSha256
        installedDriverRereadAt = [string]$_.installedPackageRereadAt
        installedDriverApkByScript = [bool]$_.installedDriverApkByScript
        connectedWithoutAdbReverse = $true
        connectedWithoutAdbForward = $true
        serial = [string]$_.serial
        serialProperty = [string]$_.serialProperty
        bootSerialProperty = [string]$_.bootSerialProperty
        androidId = [string]$_.androidId
        macAddresses = @($_.macAddresses)
        strongIdentifierCount = [int]$_.strongIdentifierCount
        identityMaterial = [string]$_.identityMaterial
        ipLink = [string]$_.ipLink
        fingerprint = [string]$_.fingerprint
        brand = [string]$_.brand
        identitySha256 = [string]$_.identitySha256
        properties = $_.properties
        route = [string]$_.route
        ipAddr = [string]$_.ipAddr
        gps = $_.gps
        reverseListBefore = [string]$_.reverseList
        forwardListBefore = [string]$_.forwardList
        reverseLinesBefore = @($_.reverseLines)
        forwardLinesBefore = @($_.forwardLines)
        forwardingCheckedBefore = [bool]$_.forwardingCheckedBefore
        forwardingCheckedAfter = [bool]$_.forwardingCheckedAfter
        forwardingFreeBefore = [bool]$_.forwardingFreeBefore
        forwardingFreeAfter = [bool]$_.forwardingFreeAfter
        reverseListAfter = [string]$_.reverseListAfter
        forwardListAfter = [string]$_.forwardListAfter
        reverseLinesAfter = @($_.reverseLinesAfter)
        forwardLinesAfter = @($_.forwardLinesAfter)
        forwardingCheckpoints = @($_.forwardingCheckpoints)
      }
    })
    $deviceDescriptor = Write-RawAcceptanceEvidence -Name 'two-physical-devices' -Value ([ordered]@{ devices = $deviceSummary; apkSha256 = $Preflight.apkSha256; apk = Get-ApkEvidence; driverApkSha256 = $Preflight.driverApkSha256; driverApk = $Preflight.driverApk }) -Evidence $evidence -Kind 'physical-device-summary'
    New-FinalCheck -Checks $checks -Id 'two-physical-android-devices' -Passed $true -Evidence @($deviceDescriptor) -Details @{ count = $deviceSummary.Count; ids = $deviceIds }

    $lanDescriptor = Write-RawAcceptanceEvidence -Name 'lan-without-adb' -Value ([ordered]@{
      apiBase = $ApiBase
      devices = @($accounts | ForEach-Object { [ordered]@{ device = $_.device; network = $_.network } })
      preflightForwardingFree = (@($deviceSummary | Where-Object { $_.forwardingFreeBefore -ne $true }).Count -eq 0)
      postAcceptanceForwardingFree = (@($deviceSummary | Where-Object { $_.forwardingFreeAfter -ne $true }).Count -eq 0)
      forwardingCheckpointsFree = (@($deviceSummary | Where-Object {
        @($_.forwardingCheckpoints | Where-Object { $_.free -ne $true }).Count -gt 0
      }).Count -eq 0)
      forwarding = @($deviceSummary | ForEach-Object {
        [ordered]@{
          device = $_.id
          identitySha256 = $_.identitySha256
          route = $_.route
          ipAddr = $_.ipAddr
          checkedBefore = $_.forwardingCheckedBefore
          freeBefore = $_.forwardingFreeBefore
          reverseListBefore = $_.reverseListBefore
          forwardListBefore = $_.forwardListBefore
          reverseLinesBefore = @($_.reverseLinesBefore)
          forwardLinesBefore = @($_.forwardLinesBefore)
          checkedAfter = $_.forwardingCheckedAfter
          freeAfter = $_.forwardingFreeAfter
          reverseListAfter = $_.reverseListAfter
          forwardListAfter = $_.forwardListAfter
          reverseLinesAfter = @($_.reverseLinesAfter)
          forwardLinesAfter = @($_.forwardLinesAfter)
          forwardingCheckpoints = @($_.forwardingCheckpoints)
        }
      })
    }) -Evidence $evidence -Kind 'lan-without-adb'
    New-FinalCheck -Checks $checks -Id 'lan-without-adb' -Passed $true -Evidence @($lanDescriptor) -Details @{ apiBase = $ApiBase; devices = $deviceIds }

    $report.checks = @($checks)
    $report.evidence = @($evidence)
    $report.devices = @($deviceSummary)
    $script:acceptanceDevices = @($deviceSummary)
  } catch {
    $failure = $_
  } finally {
    try {
      $subjectAfter = Get-SubjectSha256
      $report.subjectAfterSha256 = $subjectAfter
      if ($subjectAfter -ne [string]$Preflight.subjectBeforeSha256) {
        if (!$failure) { $failure = [System.InvalidOperationException]::new('SUBJECT_CHANGED_DURING_ACCEPTANCE: Source or APK changed while acceptance was running.') }
      }
      if ((Get-ApkSha256) -ne [string]$Preflight.apkSha256) {
        if (!$failure) { $failure = [System.InvalidOperationException]::new('APK_CHANGED_DURING_ACCEPTANCE: APK changed while acceptance was running.') }
      }
      if ((Get-Sha256 -Path $driverApkPath) -ne [string]$Preflight.driverApkSha256) {
        if (!$failure) { $failure = [System.InvalidOperationException]::new('DRIVER_APK_CHANGED_DURING_ACCEPTANCE: Acceptance driver APK changed while acceptance was running.') }
      }
      # Re-verify driver APK trust at the end of the run instead of trusting the
      # preflight observation: the file hash, pinned certificate and the release
      # subject binding must all still hold when acceptance finishes.
      $driverApkAtEnd = Get-DriverApkEvidence
      $report.driverApkAtEnd = $driverApkAtEnd
      if ([string]$driverApkAtEnd.sha256 -ne [string]$Preflight.driverApkSha256) {
        if (!$failure) { $failure = [System.InvalidOperationException]::new('DRIVER_APK_CHANGED_DURING_ACCEPTANCE: Acceptance driver APK changed while acceptance was running.') }
      }
      if ([string]$driverApkAtEnd.releaseSubjectSha256 -ne [string]$subjectAfter) {
        if (!$failure) { $failure = [System.InvalidOperationException]::new("DRIVER_APK_RELEASE_SUBJECT_MISMATCH: driver APK evidence is bound to $($driverApkAtEnd.releaseSubjectSha256) but the finishing release subject is $subjectAfter.") }
      }
    } catch {
      if (!$failure) { $failure = $_ }
    }
    $report.status = if ($failure) { 'failed' } else { 'passed' }
    $report.passed = ($null -eq $failure)
    if ($failure) {
      $message = $failure.Exception.Message
      $report.failure = [ordered]@{ code = Get-FailureCode -Message $message; message = $message; at = Get-UtcTimestamp }
    }
    $report.completedAt = Get-UtcTimestamp
    Write-JsonAtomic -Path $finalPath -Value $report
  }

  if ($failure) { throw $failure }
  return $report
}

Initialize-LocalNativeRun -RunStage $Stage
$preflight = $null
$subjectBefore = $null
$subjectAfter = $null
$apkSha256 = $null
$driverApkSha256 = $null
$devices = @()
$script:acceptanceChecks = $null
$script:acceptanceEvidence = $null
$script:acceptanceDevices = $null
try {
  $preflight = Invoke-PreflightStage
  $subjectBefore = $preflight.subjectBeforeSha256
  $subjectAfter = $preflight.subjectAfterSha256
  $apkSha256 = $preflight.apkSha256
  $driverApkSha256 = $preflight.driverApkSha256
  $devices = @($preflight.devices)
  if ($Stage -eq 'preflight') {
    Write-Output ('Preflight passed for devices: ' + (($devices | ForEach-Object { $_.model }) -join ', '))
    Write-Output 'Preflight left verification/local-native.json untouched; run -Stage acceptance only after the complete on-device flow is available.'
    return
  }
  Invoke-FinalAcceptanceStage -Preflight $preflight
} catch {
  $failure = $_
  if ($Stage -eq 'preflight') {
    # Preflight owns only verification/local-native-preflight.json. Never write a
    # failed final report that could erase a previous passing acceptance run.
    throw
  }
  if (!$subjectBefore) { try { $subjectBefore = Get-SubjectSha256 } catch { $subjectBefore = $null } }
  if (!$subjectAfter) { try { $subjectAfter = Get-SubjectSha256 } catch { $subjectAfter = $null } }
  if (!$apkSha256) { try { $apkSha256 = Get-ApkSha256 } catch { $apkSha256 = $null } }
  if (!$driverApkSha256) { try { $driverApkSha256 = Get-Sha256 -Path $driverApkPath } catch { $driverApkSha256 = $null } }
  if ($preflight -and $devices.Count -eq 0) { $devices = @($preflight.devices) }
  $failureChecks = @()
  $failureEvidence = @()
  if ($null -ne $script:acceptanceChecks) { $failureChecks = @($script:acceptanceChecks) }
  if ($null -ne $script:acceptanceEvidence) { $failureEvidence = @($script:acceptanceEvidence) }
  $failureDevices = @()
  if ($null -ne $script:acceptanceDevices -and @($script:acceptanceDevices).Count -gt 0) { $failureDevices = @($script:acceptanceDevices) } else { $failureDevices = @($devices) }
  Write-FailedFinalReport -Failure $failure -SubjectBefore $subjectBefore -SubjectAfter $subjectAfter -ApkSha256 $apkSha256 -DriverApkSha256 $driverApkSha256 -Devices $failureDevices -Evidence $failureEvidence -Checks $failureChecks
  throw
}
