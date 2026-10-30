param(
  [ValidateSet('configure','start','stop','status','backup','restore')][string]$Action = 'status',
  [string]$Address,
  [string]$Archive
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$local = Join-Path $root '.local'
$configPath = Join-Path $local 'lan-config.json'
$statePath = Join-Path $local 'runtime.json'
$startLockPath = Join-Path $local 'start.lock'
New-Item -ItemType Directory -Force -Path $local | Out-Null
function Save-Config($config) {
  $temporary = $configPath + '.pending'
  $config | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding utf8
  Move-Item -LiteralPath $temporary -Destination $configPath -Force
}
if ($Action -eq 'configure') {
  if ($Address -notmatch '^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$') { throw 'Supply this computer private IPv4 address with -Address.' }
  $adapter = Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -eq $Address | Select-Object -First 1
  if (!$adapter) { throw 'Address is not assigned to this computer.' }
  $network = Get-NetConnectionProfile -InterfaceIndex $adapter.InterfaceIndex
  if ([int]$network.NetworkCategory -ne 1) { throw 'This adapter must already be a trusted Private network.' }
  $dataDir = Join-Path $root 'apps/server/.local/database'
  if (Test-Path -LiteralPath $configPath) { $dataDir = (Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json).dataDir }
  Save-Config ([ordered]@{address=$Address;interfaceAlias=$adapter.InterfaceAlias;port=3000;controlPort=3001;dataDir=$dataDir;backupDir=(Join-Path $local 'backups')})
  $ruleName = 'Doushisi-LAN-' + $Address.Replace('.','-')
  if (!(Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name $ruleName -DisplayName 'Doushisi local game' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -LocalAddress $Address -RemoteAddress LocalSubnet -Profile Private -InterfaceAlias $adapter.InterfaceAlias | Out-Null
  }
  Write-Output ('Configured http://' + $Address + ':3000/client/')
  exit
}
if (!(Test-Path -LiteralPath $configPath)) { throw 'Run configure -Address <private IPv4> first.' }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$node = Join-Path $root 'runtime/node.exe'
if (!(Test-Path -LiteralPath $node)) { $node = (Get-Command node.exe -ErrorAction Stop).Source }
function Read-ManagedState {
  if (!(Test-Path -LiteralPath $statePath)) { return $null }
  $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  if (!$state.pid -or !(Get-Process -Id $state.pid -ErrorAction SilentlyContinue)) {
    Move-Item -LiteralPath $statePath -Destination ($statePath + '.' + [Guid]::NewGuid().ToString('N') + '.stale') -Force
    return $null
  }
  $state
}
function Control($operation, $method = 'POST') {
  $state = Read-ManagedState
  if (!$state) { throw 'Local service is not running.' }
  $result = Invoke-RestMethod -Uri ("http://127.0.0.1:$($state.controlPort)/$operation") -Method $method -Headers @{Authorization=('Bearer ' + $state.token)} -TimeoutSec 120
  if ($method -eq 'GET' -and [int]$result.pid -ne [int]$state.pid) { throw 'Control port belongs to a different process.' }
  $result
}
if ($Action -eq 'status') {
  try { Control 'status' 'GET' | ConvertTo-Json } catch {
    if ($_.Exception.Message -eq 'Local service is not running.') { [ordered]@{status='stopped'} | ConvertTo-Json; exit }
    throw
  }
  exit
}
if ($Action -eq 'stop') {
  try { Control 'status' 'GET' | Out-Null } catch {
    if ($_.Exception.Message -eq 'Local service is not running.') { Write-Output 'Local service is already stopped.'; exit }
    throw
  }
  Control 'stop' | Out-Null
  $deadline = (Get-Date).AddSeconds(30)
  while ((Test-Path -LiteralPath $statePath) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
  if (Test-Path -LiteralPath $statePath) { throw 'Service has not finished shutting down.' }
  Write-Output 'Local service stopped.'
  exit
}
if ($Action -eq 'backup') { Control 'backup' | ConvertTo-Json; exit }
if ($Action -eq 'start') {
  $pendingLock = $startLockPath + '.' + $PID + '.pending'
  Set-Content -LiteralPath $pendingLock -Value ([string]$PID) -Encoding ascii
  try { Move-Item -LiteralPath $pendingLock -Destination $startLockPath -ErrorAction Stop } catch {
    Remove-Item -LiteralPath $pendingLock -ErrorAction SilentlyContinue
    $ownerPid = 0
    try { $ownerPid = [int]((Get-Content -LiteralPath $startLockPath -Raw).Trim()) } catch { }
    if ($ownerPid -gt 0 -and (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue)) { throw 'Another local start is already in progress.' }
    Remove-Item -LiteralPath $startLockPath -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $pendingLock -Destination $startLockPath -ErrorAction Stop
  }
}
try {
  if ($Action -eq 'start') {
  if (Get-NetTCPConnection -State Listen -LocalPort $config.port,$config.controlPort -ErrorAction SilentlyContinue) { throw 'Local ports are occupied. Stop the existing service first.' }
  if (!(Test-Path -LiteralPath (Join-Path $root 'apps/server/dist/main.js'))) { throw 'Server build output is missing. Run pnpm build.' }
  if (!(Test-Path -LiteralPath (Join-Path $root 'verification/build-manifest.json'))) { throw 'Build manifest is missing. Run pnpm build.' }
  $manifest = Get-Content -LiteralPath (Join-Path $root 'verification/build-manifest.json') -Raw | ConvertFrom-Json
  if (!$manifest.sources.sha256 -or !$manifest.binaries.sha256) { throw 'Build manifest is incomplete. Run pnpm build.' }
  $sourceTree = Join-Path $root 'apps/server/src'
  if (Test-Path -LiteralPath $sourceTree) {
    $currentFingerprintText = (& $node (Join-Path $root 'tools/print-source-fingerprint.mjs') --json).Trim()
    if ($LASTEXITCODE -ne 0 -or !$currentFingerprintText) { throw 'Could not fingerprint build inputs. Run pnpm build.' }
    $currentFingerprint = $currentFingerprintText | ConvertFrom-Json
    if ($currentFingerprint.sources -ne $manifest.sources.sha256) { throw 'Source files changed after the last build. Run pnpm build before starting.' }
    if ($currentFingerprint.binaries -ne $manifest.binaries.sha256) { throw 'Build outputs changed after the last build. Run pnpm build before starting.' }
  } else {
    $packageManifestPath = Join-Path $root 'package-manifest.json'
    if (!(Test-Path -LiteralPath $packageManifestPath)) { throw 'Package manifest is missing. Recreate this local package.' }
    $packageManifest = Get-Content -LiteralPath $packageManifestPath -Raw | ConvertFrom-Json
    $manifestHash = (Get-FileHash -LiteralPath (Join-Path $root 'verification/build-manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($packageManifest.buildManifest.sha256 -ne $manifestHash) { throw 'Packaged build manifest changed after packaging.' }
    $apkPath = Join-Path $root 'client/doushisi.apk'
    if (!(Test-Path -LiteralPath $apkPath)) { throw 'Packaged APK is missing.' }
    $apkHash = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($packageManifest.apk.sha256 -ne $apkHash) { throw 'Packaged APK changed after packaging.' }
  }
  if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($state.pid -and (Get-Process -Id $state.pid -ErrorAction SilentlyContinue)) { throw 'Local service is already running.' }
    Move-Item -LiteralPath $statePath -Destination ($statePath + '.' + [Guid]::NewGuid().ToString('N') + '.stale') -Force
  }
  $listenHost = @($env:HOST, '0.0.0.0') | Where-Object { $_ } | Select-Object -First 1
  $env:HOST = $listenHost
  }
  if ($Action -eq 'restore') {
  if (!$Archive) { throw 'Select an archive with -Archive.' }
  $restoreRoot = Join-Path $local 'restores'
  New-Item -ItemType Directory -Force -Path $restoreRoot | Out-Null
  $target = Join-Path $restoreRoot ([Guid]::NewGuid().ToString())
  & $node (Join-Path $root 'apps/server/dist/local-restore.js') ([IO.Path]::GetFullPath($Archive)) $target
  if ($LASTEXITCODE -ne 0) { throw 'Restore verification failed; active data configuration was preserved.' }
  Copy-Item -LiteralPath $configPath -Destination ($configPath + '.' + (Get-Date -Format 'yyyyMMddHHmmss') + '.previous')
  $config.dataDir = $target
  Save-Config $config
  Write-Output 'Verified isolated restore selected. Start the service to use it; prior data was preserved.'
  exit
  }
  $adapter = Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -eq $config.address | Select-Object -First 1
  if (!$adapter -or [int](Get-NetConnectionProfile -InterfaceIndex $adapter.InterfaceIndex).NetworkCategory -ne 1) { throw 'Configured private LAN adapter is unavailable.' }
  $dataPath = [IO.Path]::GetFullPath($config.dataDir)
  if (!$dataPath.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Database must be inside this local workspace.' }
  $lockPath = $dataPath + '.owner-lock'
  if (Test-Path -LiteralPath $lockPath) {
    $owner = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
    if (Get-Process -Id $owner.pid -ErrorAction SilentlyContinue) { throw 'Database owner is still running.' }
    Move-Item -LiteralPath $lockPath -Destination ($lockPath + '.' + [Guid]::NewGuid().ToString() + '.stale')
  }
  $env:PORT = [string]$config.port
  $env:LOCAL_DATABASE_DIR = $dataPath
  $env:LOCAL_BACKUP_DIR = $config.backupDir
  $env:DSS_LOCAL_CONTROL_PORT = [string]$config.controlPort
  $env:DSS_LOCAL_STATE_FILE = $statePath
  $env:DSS_LOCAL_API_BASE = "http://$($config.address):$($config.port)"
  $env:DSS_LOCAL_CONTROL_TOKEN = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:SKIP_MIGRATIONS -ErrorAction SilentlyContinue
  $env:NODE_ENV = 'development'
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $process = Start-Process -FilePath $node -ArgumentList @('"' + (Join-Path $root 'apps/server/dist/main.js') + '"') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $local "server-$stamp.stdout.log") -RedirectStandardError (Join-Path $local "server-$stamp.stderr.log") -PassThru
  $deadline = (Get-Date).AddSeconds(50)
  while ((Get-Date) -lt $deadline) {
    if ($process.HasExited) { throw 'Service startup failed. See the local server log.' }
    try {
      $status = Control 'status' 'GET'
      if ($status.pid -eq $process.Id) { $status | ConvertTo-Json; exit }
    } catch { Start-Sleep -Milliseconds 250 }
  }
  throw 'Service readiness timed out. Inspect local logs before retrying.'
} finally {
  if (Test-Path -LiteralPath $startLockPath) {
    $lockOwner = ''
    try { $lockOwner = (Get-Content -LiteralPath $startLockPath -Raw).Trim() } catch { }
    if ($lockOwner -eq [string]$PID) { Remove-Item -LiteralPath $startLockPath -Force }
  }
}
