param(
  [string]$Adb = 'D:/leidian/LDPlayer14/adb.exe',
  [string]$Device = 'emulator-5554',
  [string]$Ld = 'D:/leidian/LDPlayer14/ld.exe'
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$apk = Join-Path $projectRoot 'client/android/doushisi.apk'
$archive = Join-Path $projectRoot 'client/android/recovered-apktool.zip'
$screenshot = Join-Path $projectRoot 'client/validation/native-current.png'
$packageLine = (& $Adb -s $Device shell pm path net.doushisi.standalone).Trim()
if (!$packageLine.StartsWith('package:')) { throw 'Standalone APK is not installed' }
$installedPath = $packageLine.Substring(8)
if ($installedPath -notmatch '^/data/app/[A-Za-z0-9._/~+=-]+/base\.apk$') { throw 'Unexpected installed APK path' }
$deviceHash = (& $Adb -s $Device shell sha256sum $installedPath).Split(' ')[0]
$apkHash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
if ($deviceHash -ne $apkHash) { throw 'Installed APK hash mismatch' }
& $Adb -s $Device shell am force-stop net.doushisi.standalone | Out-Null
& $Adb -s $Device shell am start -n net.doushisi.standalone/org.cocos2dx.javascript.AppActivity | Out-Null
Start-Sleep -Seconds 4
$nativeProcess = (& $Adb -s $Device shell pidof net.doushisi.standalone).Trim()
if ($nativeProcess -notmatch '^\d+$') { throw 'Standalone Android process is not running' }
& node (Join-Path $PSScriptRoot 'client-capture-native.mjs') $Ld $screenshot | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Native screenshot failed' }
Add-Type -AssemblyName System.Drawing
$bitmap = [Drawing.Bitmap]::new($screenshot)
$sum = 0.0; $squares = 0.0; $samples = 0
try {
  $width = $bitmap.Width; $height = $bitmap.Height
  for ($y=0; $y -lt $height; $y+=16) {
    for ($x=0; $x -lt $width; $x+=16) {
      $pixel = $bitmap.GetPixel($x,$y)
      foreach ($value in @($pixel.R,$pixel.G,$pixel.B)) { $sum+=$value; $squares+=$value*$value; $samples++ }
    }
  }
} finally { $bitmap.Dispose() }
$deviation = [Math]::Sqrt($squares/$samples-[Math]::Pow($sum/$samples,2))
if ($deviation -lt 20) { throw 'Native screen appears blank' }
$errors = @(& $Adb -s $Device logcat -d -t 1000 "--pid=$nativeProcess" | Select-String -Pattern 'Uncaught|FATAL EXCEPTION|dssshare|上传，发生|External request blocked' | ForEach-Object { $_.Line })
if ($errors.Count -gt 0) { throw ($errors -join "`n") }
$health = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/health' -TimeoutSec 5
$report = [ordered]@{
  checkedAt=[DateTime]::UtcNow.ToString('o'); scope='Installed native startup, screen pixels, current-process errors and local service only; no completed gameplay or original-server network acceptance.'
  smokeOnly=$true; passed=$true; device=$Device; apkSha256=$apkHash; installedApkSha256=$deviceHash
  recoveredArchiveSha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  standaloneSourceSha256=(Get-FileHash -LiteralPath (Join-Path $projectRoot 'client/public/standalone.js') -Algorithm SHA256).Hash.ToLowerInvariant()
  screenshot='native-current.png'; screenshotSha256=(Get-FileHash -LiteralPath $screenshot -Algorithm SHA256).Hash.ToLowerInvariant()
  viewport=@{width=$width;height=$height}; pixelStandardDeviation=$deviation; currentProcessErrors=$errors; health=$health
}
$report | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $projectRoot 'client/validation/native-current-report.json')
$report | ConvertTo-Json -Depth 6
