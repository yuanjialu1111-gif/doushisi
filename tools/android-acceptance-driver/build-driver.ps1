param(
  [string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')),
  [string]$JavaHome,
  [string]$AndroidSdk,
  [string]$KeyStore,
  [string]$CredentialFile,
  [string]$KeyAlias = 'doushisi',
  [string]$ExpectedCertificateSha256 = 'd90b4c8e4b7fb34dd7445a060b0f8f3b7820f2a05fe31ea1b4aeac062edf883c',
  [string]$AdapterPath,
  [string]$OutputApk,
  [string]$OutputIdsig,
  [string]$ReportPath
)
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath($ProjectRoot)
$driver = [IO.Path]::GetFullPath($PSScriptRoot)
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $project '../..'))
$toolchainRoot = Join-Path $workspaceRoot 'work/client-build'
if (!$JavaHome) {
  $bundledJava = Join-Path $toolchainRoot 'java/zulu17.68.203-ca-jre17.0.20.1-win_x64'
  $desktopJava = 'C:\Users\Administrator\Desktop\直播\_android_build\jdk17\jdk-17.0.20.1+1'
  if (Test-Path -LiteralPath (Join-Path $bundledJava 'bin/javac.exe')) { $JavaHome = $bundledJava }
  elseif (Test-Path -LiteralPath (Join-Path $desktopJava 'bin/javac.exe')) { $JavaHome = $desktopJava }
  else { throw 'Java 17 with javac is required. Pass -JavaHome.' }
}
if (!$AndroidSdk) {
  $bundledSdk = Join-Path $toolchainRoot 'android-sdk'
  $desktopSdk = 'C:\Users\Administrator\Desktop\直播\_android_build\sdk'
  if (Test-Path -LiteralPath (Join-Path $bundledSdk 'platforms/android-35/android.jar')) { $AndroidSdk = $bundledSdk }
  elseif (Test-Path -LiteralPath (Join-Path $desktopSdk 'platforms/android-35/android.jar')) { $AndroidSdk = $desktopSdk }
  else { throw 'Android SDK platform 35 is required. Pass -AndroidSdk.' }
}
if (!$KeyStore) { $KeyStore = Join-Path $toolchainRoot 'doushisi-dev.jks' }
if (!$CredentialFile) { $CredentialFile = Join-Path $toolchainRoot 'doushisi-signing-credential.xml' }
if (!$AdapterPath) { $AdapterPath = Join-Path $project 'tools/acceptance-client-adapter.js' }
if (!$OutputApk) { $OutputApk = Join-Path $driver 'dist/doushisi-acceptance-driver.apk' }
if (!$OutputIdsig) { $OutputIdsig = $OutputApk + '.idsig' }
if (!$ReportPath) { $ReportPath = Join-Path $project 'verification/android-acceptance-driver-build.json' }

$java = Join-Path $JavaHome 'bin/java.exe'
$javac = Join-Path $JavaHome 'bin/javac.exe'
$keytool = Join-Path $JavaHome 'bin/keytool.exe'
$buildTools = Join-Path $AndroidSdk 'build-tools/35.0.0'
$aapt2 = Join-Path $buildTools 'aapt2.exe'
$d8 = Join-Path $buildTools 'd8.bat'
$zipalign = Join-Path $buildTools 'zipalign.exe'
$apksigner = Join-Path $buildTools 'apksigner.bat'
$apksignerJar = Join-Path $buildTools 'lib/apksigner.jar'
$androidJar = Join-Path $AndroidSdk 'platforms/android-35/android.jar'
$manifest = Join-Path $driver 'AndroidManifest.xml'
$source = Join-Path $driver 'src/net/doushisi/acceptance/AcceptanceInstrumentation.java'
$dist = Join-Path $driver 'dist'

function Get-NormalizedPath([string]$Path) { return [IO.Path]::GetFullPath($Path) }
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
  try { $credential = Import-Clixml -LiteralPath $Path } catch {
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
  $output = & $java -jar $apksignerJar verify --print-certs $Apk 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Could not read APK certificate: $output" }
  $match = [regex]::Match(($output -join "`n"), 'Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F]{64})')
  if (!$match.Success) { throw 'APK certificate SHA-256 digest was not reported.' }
  return $match.Groups[1].Value.ToLowerInvariant()
}
function Get-Verification([string]$Apk, [string]$Idsig) {
  $v23Output = & $java -jar $apksignerJar verify --verbose --print-certs $Apk 2>&1
  if ($LASTEXITCODE -ne 0) { throw "APK v2/v3 verification failed: $v23Output" }
  $v4Output = & $java -jar $apksignerJar verify --v4-signature-file $Idsig --verbose $Apk 2>&1
  if ($LASTEXITCODE -ne 0) { throw "APK v4 verification failed: $v4Output" }
  return [ordered]@{
    v2 = [bool](($v23Output -join "`n") -match 'Verified using v2 scheme \(APK Signature Scheme v2\): true')
    v3 = [bool](($v23Output -join "`n") -match 'Verified using v3 scheme \(APK Signature Scheme v3\): true')
    v4 = [bool](($v4Output -join "`n") -match 'Verified using v4 scheme \(APK Signature Scheme v4\): true')
  }
}

$output = Get-NormalizedPath $OutputApk
$idsig = Get-NormalizedPath $OutputIdsig
$report = Get-NormalizedPath $ReportPath
$keyStorePath = Get-NormalizedPath $KeyStore
$credentialPath = Get-NormalizedPath $CredentialFile
foreach ($file in @($java, $javac, $keytool, $aapt2, $d8, $zipalign, $apksigner, $apksignerJar,
    $androidJar, $manifest, $source, $keyStorePath, $credentialPath, $AdapterPath)) {
  Assert-File $file 'build input'
}
[IO.Directory]::CreateDirectory((Split-Path -Parent $output)) | Out-Null
[IO.Directory]::CreateDirectory((Split-Path -Parent $idsig)) | Out-Null
[IO.Directory]::CreateDirectory((Split-Path -Parent $report)) | Out-Null

$previousPassword = $env:DOUSHISI_KEYSTORE_PASSWORD
$env:DOUSHISI_KEYSTORE_PASSWORD = Read-ProtectedPassword $credentialPath
$env:JAVA_HOME = $JavaHome
$env:Path = (Join-Path $JavaHome 'bin') + [IO.Path]::PathSeparator + $env:Path
$build = Join-Path ([IO.Path]::GetTempPath()) ('doushisi-acceptance-driver-' + [Guid]::NewGuid().ToString('N'))
try {
  $classes = Join-Path $build 'classes'
  $dex = Join-Path $build 'dex'
  $assets = Join-Path $build 'assets'
  $compiled = Join-Path $build 'compiled.apk'
  $aligned = Join-Path $build 'aligned.apk'
  $stagedApk = Join-Path $build 'signed.apk'
  $stagedIdsig = $stagedApk + '.idsig'
  New-Item -ItemType Directory -Force -Path $classes,$dex,$assets | Out-Null
  Copy-Item -LiteralPath $AdapterPath -Destination (Join-Path $assets 'acceptance-client-adapter.js') -Force
  Invoke-External $javac @('-source', '8', '-target', '8', '-encoding', 'UTF-8',
    '-bootclasspath', $androidJar, '-d', $classes, $source) 'Driver compilation failed.'
  $classFiles = @(Get-ChildItem -LiteralPath $classes -Recurse -Filter '*.class' | ForEach-Object { $_.FullName })
  $d8Arguments = @('--min-api', '26', '--lib', $androidJar, '--output', $dex) + $classFiles
  Invoke-External $d8 $d8Arguments 'Driver dex generation failed.'
  Invoke-External $aapt2 @('link', '-o', $compiled, '-I', $androidJar, '--manifest', $manifest, '-A', $assets) 'Driver APK link failed.'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::Open($compiled, [IO.Compression.ZipArchiveMode]::Update)
  try {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $dex 'classes.dex'), 'classes.dex') | Out-Null
  } finally {
    $archive.Dispose()
  }
  Invoke-External $zipalign @('-f', '-p', '4', $compiled, $aligned) 'Driver APK alignment failed.'
  Invoke-External $java @('-jar', $apksignerJar, 'sign', '--ks', $keyStorePath, '--ks-key-alias', $KeyAlias,
    '--ks-pass', 'env:DOUSHISI_KEYSTORE_PASSWORD', '--out', $stagedApk, $aligned) 'Driver APK signing failed.'
  if (!(Test-Path -LiteralPath $stagedIdsig -PathType Leaf)) { throw 'apksigner did not produce the driver v4 sidecar file.' }

  $actualCertificateSha256 = Get-CertificateSha256 $stagedApk
  $expected = $ExpectedCertificateSha256.ToLowerInvariant()
  if ($actualCertificateSha256 -ne $expected) {
    throw "SIGNING_CERTIFICATE_MISMATCH: expected $expected but got $actualCertificateSha256"
  }
  $verification = Get-Verification $stagedApk $stagedIdsig
  if (!($verification.v2 -and $verification.v3 -and $verification.v4)) {
    throw "DRIVER_SIGNATURE_SCHEME_MISSING: v2=$($verification.v2) v3=$($verification.v3) v4=$($verification.v4)"
  }
  Move-Item -LiteralPath $stagedApk -Destination $output -Force
  Move-Item -LiteralPath $stagedIdsig -Destination $idsig -Force
} finally {
  if ($null -eq $previousPassword) { Remove-Item Env:DOUSHISI_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue }
  else { $env:DOUSHISI_KEYSTORE_PASSWORD = $previousPassword }
  if (Test-Path -LiteralPath $build) { Remove-Item -LiteralPath $build -Recurse -Force }
}

$apkSha256 = Get-Sha256 $output
$idsigSha256 = Get-Sha256 $idsig
$certificateSha256 = Get-CertificateSha256 $output
$finalVerification = Get-Verification $output $idsig
$buildReport = [ordered]@{
  schemaVersion = 1
  stage = 'android-acceptance-driver-build'
  status = 'passed'
  passed = $true
  generatedAt = [DateTime]::UtcNow.ToString('o')
  packageName = 'net.doushisi.acceptance'
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
  command = 'pwsh -NoProfile -File tools/android-acceptance-driver/build-driver.ps1'
}
$buildReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $report -Encoding utf8

Write-Output $output
Write-Output $apkSha256
Write-Output $idsigSha256
Write-Output $certificateSha256
Write-Output $report
