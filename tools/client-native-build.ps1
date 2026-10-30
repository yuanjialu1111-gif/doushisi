param(
  [Parameter(Mandatory=$true)][string]$OriginalApk,
  [Parameter(Mandatory=$true)][string]$JavaHome,
  [Parameter(Mandatory=$true)][string]$ApktoolJar,
  [Parameter(Mandatory=$true)][string]$BuildTools,
  [Parameter(Mandatory=$true)][string]$KeyStore,
  [string]$KeyAlias = 'doushisi',
  [string]$ApiBase = 'http://127.0.0.1:3000',
  [switch]$Acceptance
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$workspaceRoot = Resolve-Path (Join-Path $projectRoot '../..')
$decodedRoot = Join-Path $workspaceRoot 'work/client-native-build'
$decodedAbsolute = [IO.Path]::GetFullPath($decodedRoot)
$allowedWorkspace = [IO.Path]::GetFullPath($workspaceRoot.Path) + [IO.Path]::DirectorySeparatorChar
if (!$decodedAbsolute.StartsWith($allowedWorkspace, [StringComparison]::OrdinalIgnoreCase)) { throw 'Decode target must remain inside the workspace.' }
$destination = Join-Path $projectRoot 'client/android'
$javaExecutable = Join-Path $JavaHome 'bin/java.exe'
if (!$env:DOUSHISI_KEYSTORE_PASSWORD) { throw 'Set DOUSHISI_KEYSTORE_PASSWORD before signing.' }
New-Item -ItemType Directory -Force -Path $destination | Out-Null
& $javaExecutable -jar $ApktoolJar d $OriginalApk -o $decodedRoot -f
if ($LASTEXITCODE -ne 0) { throw 'APK decode failed' }
$patchArguments = @((Join-Path $PSScriptRoot 'client-native-patch.mjs'), $decodedRoot, $ApiBase)
if ($Acceptance) { $patchArguments += '--acceptance' }
& node @patchArguments
if ($LASTEXITCODE -ne 0) { throw 'Client patch failed' }
$manifestPath = Join-Path $decodedRoot 'AndroidManifest.xml'
[xml]$manifest = Get-Content -Raw -LiteralPath $manifestPath
$androidNamespace = 'http://schemas.android.com/apk/res/android'
$manifest.manifest.SetAttribute('package', 'net.doushisi.standalone')
$application = $manifest.manifest.application
$application.SetAttribute('allowBackup', $androidNamespace, 'false')
$application.SetAttribute('extractNativeLibs', $androidNamespace, 'true')
$application.SetAttribute('label', $androidNamespace, '斗十四')
foreach ($attribute in @('appComponentFactory','foregroundServiceType','requestLegacyExternalStorage')) { $application.RemoveAttribute($attribute, $androidNamespace) }
foreach ($child in @($application.ChildNodes)) {
  if ($child.LocalName -eq 'meta-data' -and $child.GetAttribute('name', $androidNamespace) -eq 'android.app.lib_name') { continue }
  if ($child.LocalName -eq 'activity' -and $child.GetAttribute('name', $androidNamespace) -eq 'org.cocos2dx.javascript.AppActivity') {
    foreach ($filter in @($child.SelectNodes('intent-filter'))) {
      if (@($filter.SelectNodes('action') | Where-Object { $_.GetAttribute('name', $androidNamespace) -eq 'android.intent.action.MAIN' }).Count -eq 0) { $child.RemoveChild($filter) | Out-Null }
    }
    continue
  }
  $application.RemoveChild($child) | Out-Null
}
if ($Acceptance) {
  $receiver = $manifest.CreateElement('receiver')
  $receiver.SetAttribute('name', $androidNamespace, 'net.doushisi.standalone.AcceptanceReceiver')
  $receiver.SetAttribute('exported', $androidNamespace, 'true')
  $filter = $manifest.CreateElement('intent-filter')
  $action = $manifest.CreateElement('action')
  $action.SetAttribute('name', $androidNamespace, 'net.doushisi.standalone.ACCEPTANCE')
  $filter.AppendChild($action) | Out-Null
  $receiver.AppendChild($filter) | Out-Null
  $application.AppendChild($receiver) | Out-Null
}
$keepPermissions = @('android.permission.INTERNET','android.permission.ACCESS_NETWORK_STATE','android.permission.ACCESS_WIFI_STATE','android.permission.ACCESS_COARSE_LOCATION','android.permission.ACCESS_FINE_LOCATION','android.permission.MODIFY_AUDIO_SETTINGS','android.permission.VIBRATE')
foreach ($permission in @($manifest.manifest.SelectNodes('uses-permission'))) {
  if ($keepPermissions -notcontains $permission.GetAttribute('name',$androidNamespace)) { $manifest.manifest.RemoveChild($permission) | Out-Null }
}
foreach ($queries in @($manifest.manifest.SelectNodes('queries'))) { $manifest.manifest.RemoveChild($queries) | Out-Null }
$manifest.Save($manifestPath)
$unsigned = Join-Path $decodedRoot 'dist/doushisi-unsigned.apk'
$aligned = Join-Path $decodedRoot 'dist/doushisi-aligned.apk'
$signed = Join-Path $destination $(if ($Acceptance) { 'doushisi-acceptance.apk' } else { 'doushisi.apk' })
& $javaExecutable -jar $ApktoolJar b $decodedRoot -o $unsigned
if ($LASTEXITCODE -ne 0) { throw 'APK build failed' }
& (Join-Path $BuildTools 'zipalign.exe') -f -p 4 $unsigned $aligned
if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed' }
& $javaExecutable -jar (Join-Path $BuildTools 'lib/apksigner.jar') sign --ks $KeyStore --ks-key-alias $KeyAlias --ks-pass env:DOUSHISI_KEYSTORE_PASSWORD --out $signed $aligned
if ($LASTEXITCODE -ne 0) { throw 'APK signing failed' }
& $javaExecutable -jar (Join-Path $BuildTools 'lib/apksigner.jar') verify --verbose $signed
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
Write-Output $signed
