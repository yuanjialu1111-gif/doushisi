param(
  [string]$Adb = 'adb',
  [string]$Serial = '',
  [string]$ReportPath
)
$ErrorActionPreference = 'Stop'
$adbArguments = @()
if ($Serial) { $adbArguments += @('-s', $Serial) }
function Invoke-ReadOnlyAdb([string[]]$Arguments) {
  $result = & $Adb @adbArguments @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "ADB read-only check failed: $($Arguments -join ' ')" }
  return ($result -join "`n")
}
$devices = Invoke-ReadOnlyAdb @('devices', '-l')
if ($Serial -and $devices -notmatch [regex]::Escape($Serial) + '\s+device') { throw 'Requested device is not online.' }
$package = Invoke-ReadOnlyAdb @('shell', 'dumpsys', 'package', 'net.doushisi.standalone')
$location = Invoke-ReadOnlyAdb @('shell', 'dumpsys', 'location')
$power = Invoke-ReadOnlyAdb @('shell', 'dumpsys', 'power')
$providers = (($location -split 'Location Providers:', 2)[-1] -split 'Historical Aggregate Location Provider Data:|Event Log:', 2)[0]
$report = [ordered]@{
  checkedAt = [DateTime]::UtcNow.ToString('o')
  serial = if ($Serial) { $Serial } else { 'selected-by-adb' }
  passed = $true
  readOnlyCommands = @('adb devices -l', 'adb shell dumpsys package net.doushisi.standalone', 'adb shell dumpsys location', 'adb shell dumpsys power')
  packageInstalled = $package -match 'net\.doushisi\.standalone'
  locationServiceDumped = $location -match 'Location Manager State|Location mode|provider'
  deviceAwake = $power -match 'mWakefulness=Awake'
  fineLocationPermissionGranted = $package -match 'android\.permission\.ACCESS_FINE_LOCATION: granted=true'
  coarseLocationPermissionGranted = $package -match 'android\.permission\.ACCESS_COARSE_LOCATION: granted=true'
  gpsProviderPresent = $providers -match '(?im)^\s*gps(?: provider)?:'
  networkProviderPresent = $providers -match '(?im)^\s*network(?: provider)?:'
  limitations = @('This script does not grant permissions, change providers, install an APK, set a mock location, or modify emulator networking.', 'Provider presence is not a location fix; real coordinates require an authorized provider and physical-device testing.', 'Audio service presence is not proof that a speaker played a quick voice.')
}
$report.passed = $report.packageInstalled -and $report.locationServiceDumped -and $report.deviceAwake
$json = $report | ConvertTo-Json -Depth 10
if ($ReportPath) {
  $absoluteReport = [IO.Path]::GetFullPath($ReportPath)
  $parent = Split-Path $absoluteReport -Parent
  [IO.Directory]::CreateDirectory($parent) | Out-Null
  [IO.File]::WriteAllText($absoluteReport, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}
Write-Output $json
if (-not $report.passed) { exit 1 }
