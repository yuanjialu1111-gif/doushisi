param(
  [string]$Adb = 'D:/leidian/LDPlayer14/adb.exe',
  [string]$Serial = 'emulator-5554',
  [Parameter(Mandatory=$true)][string]$JavaHome,
  [Parameter(Mandatory=$true)][string]$ApktoolJar,
  [Parameter(Mandatory=$true)][string]$BuildTools,
  [Parameter(Mandatory=$true)][string]$KeyStore
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspace = [IO.Path]::GetFullPath((Join-Path $root '../..'))
$probeRoot = Join-Path $workspace ('work/location-probe-' + [guid]::NewGuid().ToString('N'))
$targetPackage = 'net.doushisi.standalone'
$probePackage = 'net.doushisi.locationprobe'
$java = Join-Path $JavaHome 'bin/java.exe'
$rows = [Collections.Generic.List[object]]::new()
$cleanupFailures = [Collections.Generic.List[string]]::new()
$createdProviders = [Collections.Generic.List[string]]::new()
$installedProbe = $false
$failure = $null
function Adb-Command([string[]]$Arguments) {
  $output = & $Adb -s $Serial @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "ADB failed: $($Arguments -join ' ')`n$($output -join "`n")" }
  return ($output -join "`n").Trim()
}
function Set-Permission([string]$Name, [bool]$Granted) {
  $verb = if ($Granted) { 'grant' } else { 'revoke' }
  Adb-Command @('shell','pm',$verb,$targetPackage,"android.permission.ACCESS_${Name}_LOCATION") | Out-Null
}
function Set-Fix([string]$Provider, [string]$Position) {
  Adb-Command @('shell','cmd','location','providers','set-test-provider-location',$Provider,'--location',$Position,'--accuracy','5') | Out-Null
}
function Provider-Section([string]$Dump) {
  return ($Dump -split 'Location Providers:', 2)[-1] -split 'Historical Aggregate Location Provider Data:', 2 | Select-Object -First 1
}
function Probe([string]$Name, [string]$Provider, [scriptblock]$Inject, [int]$Fine, [int]$Coarse) {
  $info = [Diagnostics.ProcessStartInfo]::new($Adb)
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  foreach ($arg in @('-s',$Serial,'shell','am','instrument','-w',"$probePackage/net.doushisi.locationprobe.Probe")) { $info.ArgumentList.Add($arg) }
  $process = [Diagnostics.Process]::Start($info)
  $stderr = $process.StandardError.ReadToEndAsync()
  try {
    $prefix = ''
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
      $lineTask = $process.StandardOutput.ReadLineAsync()
      if (-not $lineTask.Wait([TimeSpan]::FromSeconds(15))) { throw "Probe did not start: $Name" }
      $line = $lineTask.Result
      $prefix += "$line`n"
      if ($line -match 'INSTRUMENTATION_STATUS_CODE: 100') { break }
      if ($null -eq $line -or [DateTime]::UtcNow -gt $deadline) { throw "Probe startup failed: $prefix" }
    } while ($true)
    $providers = Provider-Section (Adb-Command @('shell','dumpsys','location'))
    $registered = @($providers -split "`n" | Where-Object { $_ -match 'net\.doushisi\.standalone.*Request\[' })
    if ($Coarse -eq 0 -and $Name -ne 'location-master-disabled' -and $registered.Count -eq 0) { throw "Target has no location listeners: $Name" }
    if ($Coarse -eq -1 -and $registered.Count -gt 0) { throw "Target retained a listener without permission: $Name" }
    if ($Name -eq 'gps-with-network-provider-absent' -and $providers -match '(?im)^\s*network provider:') { throw 'Network provider is present; absence case is not covered.' }
    & $Inject
    Adb-Command @('shell','am','broadcast','-a','net.doushisi.locationprobe.INJECTED','-p',$targetPackage,'--receiver-foreground') | Out-Null
    $stdout = $process.StandardOutput.ReadToEndAsync()
    if (-not $process.WaitForExit(15000)) { throw "Probe timed out: $Name" }
    $output = $prefix + $stdout.Result + $stderr.Result
    if ($process.ExitCode -ne 0 -or $output -notmatch 'INSTRUMENTATION_CODE: -1') { throw "Probe failed: $output" }
    $values = @{}
    foreach ($line in ($output -split "`n")) {
      if ($line -match '^INSTRUMENTATION_RESULT: (\w+)=(.*)') { $values[$Matches[1]] = $Matches[2].Trim() }
    }
    if ($values.error -or $values.provider -ne $Provider -or [int]$values.fine -ne $Fine -or [int]$values.coarse -ne $Coarse) {
      throw "Unexpected probe result for ${Name}: $($values | ConvertTo-Json -Compress)"
    }
    if ($Provider -ne 'none') {
      $latitude = [double]::Parse($values.latitude, [Globalization.CultureInfo]::InvariantCulture)
      $longitude = [double]::Parse($values.longitude, [Globalization.CultureInfo]::InvariantCulture)
      $expectedLat = if ($Provider -eq 'gps') { 30.65 } else { 31.25 }
      $expectedLon = if ($Provider -eq 'gps') { 104.07 } else { 105.15 }
      $tolerance = if ($Fine -eq 0) { 0.00001 } else { 0.1 }
      if ([Math]::Abs($latitude-$expectedLat) -gt $tolerance -or [Math]::Abs($longitude-$expectedLon) -gt $tolerance) { throw "Unexpected test coordinates for $Name" }
    }
    $rows.Add([ordered]@{name=$Name;passed=$true;activeListenerCount=$registered.Count;result=$values})
    Write-Output "PASS $Name"
  } finally {
    if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
    $process.Dispose()
  }
}
if (-not $env:DOUSHISI_KEYSTORE_PASSWORD) { throw 'Signing password is required in DOUSHISI_KEYSTORE_PASSWORD.' }
if ($Serial -notmatch '^emulator-\d+$') { throw 'This mutation-based test is limited to an Android emulator.' }
if ((Adb-Command @('shell','pm','list','packages',$probePackage)).Length -gt 0) { throw 'A probe is already installed; do not replace an unrelated test.' }
$originalPackage = Adb-Command @('shell','dumpsys','package',$targetPackage)
if ($originalPackage -notmatch 'appId=') { throw 'Install the current game APK first.' }
$fineGranted = $originalPackage -match 'android.permission.ACCESS_FINE_LOCATION: granted=true'
$coarseGranted = $originalPackage -match 'android.permission.ACCESS_COARSE_LOCATION: granted=true'
$locationEnabled = Adb-Command @('shell','cmd','location','is-location-enabled')
$locationBefore = Adb-Command @('shell','dumpsys','location')
if ((Provider-Section $locationBefore) -match '(?im)^\s*network provider:') { throw 'This fixture requires an emulator without an existing network provider.' }
if ($locationBefore -match '(?im)^\s*mock provider|mock provider=true|identity=2000/com.android.shell') { throw 'Existing mock providers must not be overwritten.' }
$mockBefore = Adb-Command @('shell','appops','get','com.android.shell','android:mock_location')
$mockMode = if ($mockBefore -match 'MOCK_LOCATION: (allow|deny|ignore|default|foreground)') { $Matches[1] } else { 'default' }
$apk = Join-Path $root 'client/android/doushisi.apk'
$apkHash = (Get-FileHash $apk -Algorithm SHA256).Hash.ToLowerInvariant()
$installedPath = (Adb-Command @('shell','pm','path',$targetPackage)) -replace '^package:', ''
if ($installedPath -notmatch '^/data/app/[A-Za-z0-9._/~+=-]+/base\.apk$') { throw 'Unexpected installed APK path.' }
$installedHash = (Adb-Command @('shell','sha256sum',$installedPath)).Split(' ')[0]
if ($installedHash -ne $apkHash) { throw 'Installed game APK does not match the current artifact.' }
try {
  Copy-Item (Join-Path $PSScriptRoot 'android-location-probe') $probeRoot -Recurse
  $unsigned = Join-Path $probeRoot 'probe-unsigned.apk'
  $signed = Join-Path $probeRoot 'probe.apk'
  & $java -jar $ApktoolJar b $probeRoot -o $unsigned
  if ($LASTEXITCODE -ne 0) { throw 'Probe APK build failed.' }
  & $java -jar (Join-Path $BuildTools 'lib/apksigner.jar') sign --ks $KeyStore --ks-key-alias doushisi --ks-pass env:DOUSHISI_KEYSTORE_PASSWORD --out $signed $unsigned
  if ($LASTEXITCODE -ne 0) { throw 'Probe signing failed.' }
  Adb-Command @('install','--streaming',$signed) | Out-Null
  $installedProbe = $true
  Adb-Command @('shell','appops','set','com.android.shell','android:mock_location','allow') | Out-Null
  Adb-Command @('shell','cmd','location','set-location-enabled','true') | Out-Null
  foreach ($provider in @('gps','network')) {
    Adb-Command @('shell','cmd','location','providers','add-test-provider',$provider) | Out-Null
    $createdProviders.Add($provider)
    Adb-Command @('shell','cmd','location','providers','set-test-provider-enabled',$provider,'true') | Out-Null
  }
  Set-Permission 'FINE' $false
  Set-Permission 'COARSE' $false
  Probe 'all-permissions-denied' 'none' { Set-Fix 'gps' '30.65,104.07'; Set-Fix 'network' '31.25,105.15' } -1 -1
  Set-Permission 'COARSE' $true
  Set-Permission 'FINE' $true
  Adb-Command @('shell','cmd','location','providers','remove-test-provider','network') | Out-Null
  $createdProviders.Remove('network') | Out-Null
  Probe 'gps-with-network-provider-absent' 'gps' { Set-Fix 'gps' '30.65,104.07' } 0 0
  Adb-Command @('shell','cmd','location','providers','add-test-provider','network') | Out-Null
  $createdProviders.Add('network')
  Adb-Command @('shell','cmd','location','providers','set-test-provider-enabled','network','true') | Out-Null
  Adb-Command @('shell','cmd','location','providers','set-test-provider-enabled','gps','false') | Out-Null
  Probe 'network-with-gps-disabled' 'network' { Set-Fix 'network' '31.25,105.15' } 0 0
  Adb-Command @('shell','cmd','location','providers','set-test-provider-enabled','gps','true') | Out-Null
  Probe 'new-network-replaces-older-gps' 'network' { Set-Fix 'gps' '30.65,104.07'; Set-Fix 'network' '31.25,105.15' } 0 0
  Probe 'new-gps-replaces-older-network' 'gps' { Set-Fix 'network' '31.25,105.15'; Set-Fix 'gps' '30.65,104.07' } 0 0
  Set-Permission 'FINE' $false
  Adb-Command @('shell','cmd','location','providers','set-test-provider-enabled','gps','false') | Out-Null
  Probe 'approximate-only-network' 'network' { Set-Fix 'network' '31.25,105.15' } -1 0
  Set-Permission 'COARSE' $false
  Probe 'all-permissions-revoked' 'none' { Set-Fix 'network' '31.25,105.15' } -1 -1
  Set-Permission 'COARSE' $true
  Set-Permission 'FINE' $true
  Adb-Command @('shell','cmd','location','set-location-enabled','false') | Out-Null
  Probe 'location-master-disabled' 'none' {} 0 0
} catch {
  $failure = $_.Exception.Message
} finally {
  foreach ($provider in $createdProviders) {
    try { Adb-Command @('shell','cmd','location','providers','remove-test-provider',$provider) | Out-Null } catch { $cleanupFailures.Add($_.Exception.Message) }
  }
  foreach ($restore in @(
    { Adb-Command @('shell','cmd','location','set-location-enabled',$locationEnabled) | Out-Null },
    { Set-Permission 'FINE' $false; Set-Permission 'COARSE' $coarseGranted; Set-Permission 'FINE' $fineGranted },
    { Adb-Command @('shell','appops','set','com.android.shell','android:mock_location',$mockMode) | Out-Null },
    { if ($installedProbe) { Adb-Command @('uninstall',$probePackage) | Out-Null } }
  )) {
    try { & $restore } catch { $cleanupFailures.Add($_.Exception.Message) }
  }
}
$restored = [ordered]@{}
try {
  $packageAfter = Adb-Command @('shell','dumpsys','package',$targetPackage)
  $mockAfter = Adb-Command @('shell','appops','get','com.android.shell','android:mock_location')
  $restored.fine = $packageAfter -match 'android.permission.ACCESS_FINE_LOCATION: granted=true'
  $restored.coarse = $packageAfter -match 'android.permission.ACCESS_COARSE_LOCATION: granted=true'
  $restored.locationEnabled = Adb-Command @('shell','cmd','location','is-location-enabled')
  $restored.mockLocationMode = if ($mockAfter -match 'MOCK_LOCATION: (allow|deny|ignore|default|foreground)') { $Matches[1] } else { 'default' }
  $restored.probeUninstalled = (Adb-Command @('shell','pm','list','packages',$probePackage)).Length -eq 0
  $restored.noShellMockProviders = (Provider-Section (Adb-Command @('shell','dumpsys','location'))) -notmatch 'identity=2000/com.android.shell'
  if ($restored.fine -ne $fineGranted -or $restored.coarse -ne $coarseGranted -or $restored.locationEnabled -ne $locationEnabled -or $restored.mockLocationMode -ne $mockMode -or -not $restored.probeUninstalled -or -not $restored.noShellMockProviders) {
    $cleanupFailures.Add('Read-back of restored emulator state did not match its initial state.')
  }
} catch { $cleanupFailures.Add($_.Exception.Message) }
$report = [ordered]@{
  checkedAt=[DateTime]::UtcNow.ToString('o'); scope='Android emulator instrumentation with synthetic locations, using the installed game bridge under the target UID'
  passed=(!$failure -and $cleanupFailures.Count -eq 0 -and $rows.Count -eq 8); emulator=$Serial; apkSha256=$apkHash; installedApkSha256=$installedHash
  bridgeSha256=(Get-FileHash (Join-Path $root 'client/android/native/StandaloneLocation.smali') -Algorithm SHA256).Hash.ToLowerInvariant()
  cases=$rows.ToArray(); failure=$failure; cleanupFailures=$cleanupFailures.ToArray()
  restored=$restored
  limitations=@('Synthetic coordinates and active listener registration only; no physical GPS precision, callback-delivery count or audio validation.', 'Tests target the installed Java bridge; original room coordinate exchange and permission-dialog UI require separate acceptance.', 'No maximum fix age is defined; the latest enabled provider result can still be old.')
}
$report | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $root 'client/validation/location-emulator.json')
$report | ConvertTo-Json -Depth 8
if (-not $report.passed) { throw 'Location emulator verification failed; see report.' }
