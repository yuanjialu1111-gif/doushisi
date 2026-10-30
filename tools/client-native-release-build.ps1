param(
  [string]$ApiBase,
  [string]$DecodedRoot,
  [string]$OutputApk,
  [string]$OutputIdsig,
  [string]$JavaHome,
  [string]$ApktoolJar,
  [string]$BuildTools,
  [string]$KeyStore,
  [string]$CredentialFile,
  [string]$KeyAlias = 'doushisi',
  [string]$ExpectedCertificateSha256 = 'd90b4c8e4b7fb34dd7445a060b0f8f3b7820f2a05fe31ea1b4aeac062edf883c',
  [string]$ReportPath,
  [switch]$SkipPatch
)
$ErrorActionPreference = 'Stop'

function Get-NormalizedPath([string]$Path) {
  return [IO.Path]::GetFullPath($Path)
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-File([string]$Path, [string]$Label) {
  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required $Label is missing: $Path" }
}

function Invoke-External([string]$FilePath, [string[]]$Arguments, [string]$FailureMessage) {
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) { throw $FailureMessage }
}

function Read-ProtectedPassword([string]$Path) {
  Assert-File $Path 'signing credential file'
  try {
    $credential = Import-Clixml -LiteralPath $Path
  } catch {
    throw "Could not import the protected signing credential. Use the Windows account that created it. $($_.Exception.Message)"
  }
  if ($credential -isnot [System.Management.Automation.PSCredential]) {
    throw 'The protected signing credential is not a PSCredential.'
  }
  if ([string]::IsNullOrEmpty($credential.UserName)) { throw 'The protected signing credential has no user name.' }
  $password = $credential.GetNetworkCredential().Password
  if ([string]::IsNullOrEmpty($password)) { throw 'The protected signing credential has an empty password.' }
  return $password
}

function Get-CertificateSha256([string]$Apk) {
  $output = & $java -jar $apksigner verify --print-certs $Apk 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Could not read APK certificate: $output" }
  $match = [regex]::Match(($output -join "`n"), 'Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F]{64})')
  if (!$match.Success) { throw 'APK certificate SHA-256 digest was not reported.' }
  return $match.Groups[1].Value.ToLowerInvariant()
}

function Get-Verification([string]$Apk, [string]$Idsig) {
  $v23Output = & $java -jar $apksigner verify --verbose --print-certs $Apk 2>&1
  if ($LASTEXITCODE -ne 0) { throw "APK v2/v3 verification failed: $v23Output" }
  $v4Output = & $java -jar $apksigner verify --v4-signature-file $Idsig --verbose $Apk 2>&1
  if ($LASTEXITCODE -ne 0) { throw "APK v4 verification failed: $v4Output" }
  return [ordered]@{
    v2 = [bool](($v23Output -join "`n") -match 'Verified using v2 scheme \(APK Signature Scheme v2\): true')
    v3 = [bool](($v23Output -join "`n") -match 'Verified using v3 scheme \(APK Signature Scheme v3\): true')
    v4 = [bool](($v4Output -join "`n") -match 'Verified using v4 scheme \(APK Signature Scheme v4\): true')
  }
}

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '../..'))
$toolchainRoot = Join-Path $workspaceRoot 'work/client-build'
if (!$JavaHome) { $JavaHome = Join-Path $toolchainRoot 'java/zulu17.68.203-ca-jre17.0.20.1-win_x64' }
if (!$ApktoolJar) { $ApktoolJar = Join-Path $toolchainRoot 'apktool.jar' }
if (!$BuildTools) { $BuildTools = Join-Path $toolchainRoot 'android-sdk/android-15' }
if (!$KeyStore) { $KeyStore = Join-Path $toolchainRoot 'doushisi-dev.jks' }
if (!$CredentialFile) { $CredentialFile = Join-Path $toolchainRoot 'doushisi-signing-credential.xml' }

$apiBaseArguments = @((Join-Path $PSScriptRoot 'resolve-api-base.mjs'))
if ($PSBoundParameters.ContainsKey('ApiBase')) { $apiBaseArguments += '--value'; $apiBaseArguments += $ApiBase }
$apiBaseArguments += '--runtime'
$apiBaseArguments += (Join-Path $projectRoot '.local/runtime.json')
$resolvedApiBase = & node @apiBaseArguments
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace([string]$resolvedApiBase)) {
  throw 'Could not resolve the API base. Pass -ApiBase, set DOUSHISI_API_BASE, or run the local server once to create .local/runtime.json.'
}
$ApiBase = [string]$resolvedApiBase

if (!$DecodedRoot) { $DecodedRoot = Join-Path $workspaceRoot 'work/client-native-build' }
if (!$OutputApk) { $OutputApk = Join-Path $projectRoot 'client/android/doushisi-acceptance.apk' }
if (!$OutputIdsig) { $OutputIdsig = $OutputApk + '.idsig' }
if (!$ReportPath) { $ReportPath = Join-Path $projectRoot 'verification/android-release-build.json' }

$decoded = Get-NormalizedPath $DecodedRoot
$output = Get-NormalizedPath $OutputApk
$idsig = Get-NormalizedPath $OutputIdsig
$reportPath = Get-NormalizedPath $ReportPath
$java = Get-NormalizedPath (Join-Path $JavaHome 'bin/java.exe')
$zipalign = Get-NormalizedPath (Join-Path $BuildTools 'zipalign.exe')
$apksigner = Get-NormalizedPath (Join-Path $BuildTools 'lib/apksigner.jar')

foreach ($file in @($java, $ApktoolJar, $zipalign, $apksigner, $KeyStore, $CredentialFile)) {
  Assert-File (Get-NormalizedPath $file) 'build input'
}
if (!(Test-Path -LiteralPath (Join-Path $decoded 'apktool.yml') -PathType Leaf)) {
  throw "Decoded Apktool project is missing: $decoded"
}

$outputDirectory = Split-Path -Parent $output
$idsigDirectory = Split-Path -Parent $idsig
[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
[IO.Directory]::CreateDirectory($idsigDirectory) | Out-Null
[IO.Directory]::CreateDirectory((Split-Path -Parent $reportPath)) | Out-Null

$dist = Join-Path $decoded 'dist'
[IO.Directory]::CreateDirectory($dist) | Out-Null
$unsigned = Join-Path $dist 'doushisi-release-unsigned.apk'
$aligned = Join-Path $dist 'doushisi-release-aligned.apk'
$stagedApk = Join-Path $dist 'doushisi-release-signed.apk'
$stagedIdsig = $stagedApk + '.idsig'

$previousPassword = $env:DOUSHISI_KEYSTORE_PASSWORD
$env:DOUSHISI_KEYSTORE_PASSWORD = Read-ProtectedPassword (Get-NormalizedPath $CredentialFile)
try {
  if (!$SkipPatch) {
    Invoke-External 'node' @((Join-Path $PSScriptRoot 'client-native-patch.mjs'), $decoded, $ApiBase, '--acceptance') 'Acceptance client resource patch failed.'

    $manifestPath = Join-Path $decoded 'AndroidManifest.xml'
    [xml]$manifest = Get-Content -Raw -LiteralPath $manifestPath
    $androidNamespace = 'http://schemas.android.com/apk/res/android'
    $application = $manifest.manifest.application
    foreach ($existing in @($application.ChildNodes | Where-Object {
          $_.LocalName -eq 'receiver' -and $_.GetAttribute('name', $androidNamespace) -eq 'net.doushisi.standalone.AcceptanceReceiver'
        })) {
      $application.RemoveChild($existing) | Out-Null
    }
    $receiver = $manifest.CreateElement('receiver')
    $receiver.SetAttribute('name', $androidNamespace, 'net.doushisi.standalone.AcceptanceReceiver')
    $receiver.SetAttribute('exported', $androidNamespace, 'true')
    $filter = $manifest.CreateElement('intent-filter')
    $action = $manifest.CreateElement('action')
    $action.SetAttribute('name', $androidNamespace, 'net.doushisi.standalone.ACCEPTANCE')
    $filter.AppendChild($action) | Out-Null
    $receiver.AppendChild($filter) | Out-Null
    $application.AppendChild($receiver) | Out-Null
    $manifest.Save($manifestPath)

    Copy-Item -LiteralPath (Join-Path $projectRoot 'client/android/native/AcceptanceReceiver.smali') `
      -Destination (Join-Path $decoded 'smali/net/doushisi/standalone/AcceptanceReceiver.smali') -Force
  }

  foreach ($stale in @($stagedApk, $stagedIdsig, $unsigned, $aligned)) {
    if (Test-Path -LiteralPath $stale) { Remove-Item -LiteralPath $stale -Force }
  }

  Invoke-External $java @('-jar', (Get-NormalizedPath $ApktoolJar), 'b', $decoded, '-o', $unsigned) 'Acceptance APK build failed.'
  Invoke-External $zipalign @('-f', '-p', '4', $unsigned, $aligned) 'Acceptance APK alignment failed.'
  Invoke-External $java @('-jar', $apksigner, 'sign', '--ks', (Get-NormalizedPath $KeyStore), '--ks-key-alias', $KeyAlias,
    '--ks-pass', 'env:DOUSHISI_KEYSTORE_PASSWORD', '--out', $stagedApk, $aligned) 'Acceptance APK signing failed.'
  if (!(Test-Path -LiteralPath $stagedIdsig -PathType Leaf)) {
    throw 'apksigner did not produce the v4 sidecar file.'
  }

  $actualCertificateSha256 = Get-CertificateSha256 $stagedApk
  $expected = $ExpectedCertificateSha256.ToLowerInvariant()
  if ($actualCertificateSha256 -ne $expected) {
    throw "SIGNING_CERTIFICATE_MISMATCH: expected $expected but got $actualCertificateSha256"
  }
  $verification = Get-Verification $stagedApk $stagedIdsig
  if (!($verification.v2 -and $verification.v3 -and $verification.v4)) {
    throw "APK_SIGNATURE_SCHEME_MISSING: v2=$($verification.v2) v3=$($verification.v3) v4=$($verification.v4)"
  }

  Move-Item -LiteralPath $stagedApk -Destination $output -Force
  Move-Item -LiteralPath $stagedIdsig -Destination $idsig -Force
} finally {
  if ($null -eq $previousPassword) { Remove-Item Env:DOUSHISI_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue }
  else { $env:DOUSHISI_KEYSTORE_PASSWORD = $previousPassword }
}

$apkSha256 = Get-Sha256 $output
$idsigSha256 = Get-Sha256 $idsig
$certificateSha256 = Get-CertificateSha256 $output
$finalVerification = Get-Verification $output $idsig
$report = [ordered]@{
  schemaVersion = 1
  stage = 'release-build'
  status = 'passed'
  passed = $true
  generatedAt = [DateTime]::UtcNow.ToString('o')
  apiBase = $ApiBase
  packageName = 'net.doushisi.standalone'
  apk = [ordered]@{
    path = $output
    sha256 = $apkSha256
    size = (Get-Item -LiteralPath $output).Length
  }
  idsig = [ordered]@{
    path = $idsig
    sha256 = $idsigSha256
    size = (Get-Item -LiteralPath $idsig).Length
  }
  signing = [ordered]@{
    certificateSha256 = $certificateSha256
    expectedCertificateSha256 = $expected
    keyAlias = $KeyAlias
    v2 = $finalVerification.v2
    v3 = $finalVerification.v3
    v4 = $finalVerification.v4
  }
  command = "pwsh -NoProfile -File tools/client-native-release-build.ps1 -ApiBase $ApiBase"
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8

Write-Output $output
Write-Output $apkSha256
Write-Output $idsigSha256
Write-Output $certificateSha256
Write-Output $reportPath
