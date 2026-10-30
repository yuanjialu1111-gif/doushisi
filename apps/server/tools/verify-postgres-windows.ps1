param(
  [string]$RuntimeDirectory,
  [string]$WorkDirectory,
  [string]$ReportPath,
  [string]$RawReportPath
)

$ErrorActionPreference = 'Stop'
$serverDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repositoryDirectory = (Resolve-Path (Join-Path $serverDirectory '../..')).Path
$workspaceDirectory = Split-Path (Split-Path $repositoryDirectory -Parent) -Parent
if (-not $WorkDirectory) { $WorkDirectory = Join-Path $workspaceDirectory 'work/postgres' }
if (-not $RuntimeDirectory) { $RuntimeDirectory = Join-Path $WorkDirectory 'runtime/pgsql' }
if (-not $ReportPath) { $ReportPath = Join-Path $repositoryDirectory 'verification/postgres-concurrency.json' }
if (-not $RawReportPath) { $RawReportPath = Join-Path $repositoryDirectory 'verification/raw/postgres-concurrency.json' }
$ReportPath = [IO.Path]::GetFullPath($ReportPath)
$RawReportPath = [IO.Path]::GetFullPath($RawReportPath)
if ($ReportPath -eq $RawReportPath) { throw 'ReportPath and RawReportPath must be different files.' }
$RuntimeDirectory = (Resolve-Path -LiteralPath $RuntimeDirectory).Path
$WorkDirectory = [IO.Path]::GetFullPath($WorkDirectory)
[IO.Directory]::CreateDirectory($WorkDirectory) | Out-Null
$initdbBinary = Join-Path $RuntimeDirectory 'bin/initdb.exe'
$controlBinary = Join-Path $RuntimeDirectory 'bin/pg_ctl.exe'
if (-not (Test-Path -LiteralPath $initdbBinary)) { throw 'PostgreSQL initdb.exe is missing from RuntimeDirectory.' }

$requiredCheckIds = @(
  'exact-decimals',
  'fee-once',
  'settlement-once',
  'negative-balance',
  'admin-concurrency',
  'dissolve-earned-scores',
  'role-isolation'
)
$rawEvidencePath = 'verification/raw/postgres-concurrency.json'
$runId = [Guid]::NewGuid().ToString('N')
$clusterDirectory = Join-Path $WorkDirectory "cluster-$runId"
$passwordPath = Join-Path $WorkDirectory "password-$runId.tmp"
$postgresLog = Join-Path $WorkDirectory "server-$runId.log"
$postgresPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
$socket = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$socket.Start()
$port = $socket.LocalEndpoint.Port
$socket.Stop()
$oldConnectionSet = Test-Path Env:POSTGRES_VERIFY_ADMIN_URL
$oldConnection = $env:POSTGRES_VERIFY_ADMIN_URL
$oldReportSet = Test-Path Env:POSTGRES_VERIFY_REPORT
$oldReport = $env:POSTGRES_VERIFY_REPORT
$nodeBinary = (Get-Command node -ErrorAction Stop).Source
$serverStarted = $false
$serverStopped = $false
$verificationInvoked = $false
$testExitCode = 1
$initialFailure = $null
$subjectBefore = ''
$subjectAfter = ''

function Quote-NativeArgument([string]$Value) { return '"' + $Value.Replace('"', '\"') + '"' }
function Invoke-PostgresTool([string]$Binary, [string[]]$ToolArguments, [string]$Stage) {
  $stdoutPath = Join-Path $WorkDirectory "$Stage-$runId.stdout.log"
  $stderrPath = Join-Path $WorkDirectory "$Stage-$runId.stderr.log"
  $process = Start-Process -FilePath $Binary -ArgumentList $ToolArguments -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    if (Test-Path -LiteralPath $stderrPath) { Write-Host (Get-Content -LiteralPath $stderrPath -Raw) }
    throw "PostgreSQL $Stage failed with exit code $($process.ExitCode). See $stdoutPath"
  }
}
function Invoke-SourceFingerprint([string]$Stage) {
  try {
    $lines = @(& $nodeBinary (Join-Path $repositoryDirectory 'tools/print-source-fingerprint.mjs') --subject)
    if ($LASTEXITCODE -ne 0) { throw "Source fingerprint capture failed at $Stage." }
    $value = ($lines -join [Environment]::NewLine).Trim()
    if ($value -notmatch '^[0-9a-f]{64}$') { throw "Source fingerprint capture at $Stage was not a SHA-256 value." }
    return $value
  } catch {
    Write-Warning "Could not capture the source fingerprint at $Stage`: $($_.Exception.Message)"
    return ''
  }
}

# Never leave a previous successful descriptor or raw run in place if this run fails early.
Remove-Item -LiteralPath $RawReportPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $ReportPath -Force -ErrorAction SilentlyContinue

try {
  $subjectBefore = Invoke-SourceFingerprint 'before'
  [IO.File]::WriteAllText($passwordPath, $postgresPassword, [Text.UTF8Encoding]::new($false))
  Invoke-PostgresTool $initdbBinary @('-D', (Quote-NativeArgument $clusterDirectory), '-U', 'postgres', '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C', '--pwfile', (Quote-NativeArgument $passwordPath)) 'initdb'
  Remove-Item -LiteralPath $passwordPath
  Invoke-PostgresTool $controlBinary @('-D', (Quote-NativeArgument $clusterDirectory), '-l', (Quote-NativeArgument $postgresLog), '-o', (Quote-NativeArgument "-h 127.0.0.1 -p $port"), '-w', 'start') 'start'
  $serverStarted = $true
  Write-Host "Isolated PostgreSQL listening on 127.0.0.1:$port"
  $env:POSTGRES_VERIFY_ADMIN_URL = 'postgresql://postgres:' + $postgresPassword + '@127.0.0.1:' + $port + '/postgres'
  $env:POSTGRES_VERIFY_REPORT = $RawReportPath
  $verificationInvoked = $true
  Push-Location $serverDirectory
  try {
    & $nodeBinary --import tsx (Join-Path $PSScriptRoot 'verify-postgres.ts')
    $testExitCode = $LASTEXITCODE
  } finally { Pop-Location }
} catch {
  $initialFailure = $_.Exception.Message
  $testExitCode = 1
  Write-Warning $initialFailure
} finally {
  if ($serverStarted -or (Test-Path -LiteralPath (Join-Path $clusterDirectory 'postmaster.pid'))) {
    try {
      Invoke-PostgresTool $controlBinary @('-D', (Quote-NativeArgument $clusterDirectory), '-m', 'fast', '-w', 'stop') 'stop'
      Write-Host 'Isolated PostgreSQL stopped.'
    } catch {
      Write-Warning $_.Exception.Message
      $testExitCode = 1
      if (-not $initialFailure) { $initialFailure = $_.Exception.Message }
    }
  }
  $serverStopped = -not (Test-Path -LiteralPath (Join-Path $clusterDirectory 'postmaster.pid'))
  if (Test-Path -LiteralPath $passwordPath) { Remove-Item -LiteralPath $passwordPath }
  if ($oldConnectionSet) { $env:POSTGRES_VERIFY_ADMIN_URL = $oldConnection }
  else { Remove-Item Env:POSTGRES_VERIFY_ADMIN_URL -ErrorAction SilentlyContinue }
  if ($oldReportSet) { $env:POSTGRES_VERIFY_REPORT = $oldReport }
  else { Remove-Item Env:POSTGRES_VERIFY_REPORT -ErrorAction SilentlyContinue }

  $rawReportExists = Test-Path -LiteralPath $RawReportPath
  $rawReportReadable = $false
  if ($rawReportExists) {
    try {
      $report = Get-Content -LiteralPath $RawReportPath -Raw | ConvertFrom-Json -AsHashtable
      $rawReportReadable = $true
    } catch {
      Write-Warning "Could not read the raw PostgreSQL report: $($_.Exception.Message)"
      $testExitCode = 1
      if (-not $initialFailure) { $initialFailure = $_.Exception.Message }
      $report = @{ checks = @(); passed = $false }
    }
  } else {
    Write-Warning "The PostgreSQL verifier did not produce $RawReportPath."
    $report = @{ checks = @(); passed = $false }
  }

  $rawChecks = if ($report.ContainsKey('checks')) { @($report['checks']) } else { @() }
  $report['temporaryServerStopped'] = $serverStopped
  $report['loopbackPort'] = $port
  $report['serverBinary'] = $controlBinary
  $report['clusterDirectory'] = $clusterDirectory
  $report['subjectBeforeSha256'] = $subjectBefore
  $report['subjectAfterSha256'] = $subjectAfter
  $archivePath = Join-Path $WorkDirectory 'postgresql-17.6-1-windows-x64-binaries.zip'
  if (Test-Path -LiteralPath $archivePath) {
    $report['binarySource'] = 'https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64-binaries.zip'
    $report['archiveSha256'] = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  $rawPassed = $report['passed'] -eq $true
  if (-not $serverStopped -or -not $rawReportReadable) { $report['passed'] = $false }

  $subjectAfter = Invoke-SourceFingerprint 'after'
  $report['subjectAfterSha256'] = $subjectAfter
  [IO.Directory]::CreateDirectory((Split-Path -Parent $RawReportPath)) | Out-Null
  [IO.File]::WriteAllText($RawReportPath, ($report | ConvertTo-Json -Depth 30) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
  $rawSha256 = (Get-FileHash -LiteralPath $RawReportPath -Algorithm SHA256).Hash.ToLowerInvariant()

  $formalChecks = @()
  $missingRequiredIds = @()
  $failedRequiredIds = @()
  foreach ($id in $requiredCheckIds) {
  $matches = @($rawChecks | Where-Object { $_ -is [Collections.IDictionary] -and [string]$_['id'] -eq $id })
    if ($matches.Count -ne 1) {
      $missingRequiredIds += $id
      $formalChecks += [ordered]@{ id = $id; passed = $false; details = @{ evidenceCheckCount = $matches.Count } }
      continue
    }
    $rawCheck = $matches[0]
    if ($rawCheck['passed'] -ne $true) { $failedRequiredIds += $id }
    $formalChecks += [ordered]@{ id = $id; passed = ($rawCheck['passed'] -eq $true); details = $rawCheck['details'] }
  }

  $subjectStable = ($subjectBefore -match '^[0-9a-f]{64}$') -and ($subjectAfter -eq $subjectBefore)
  $passed = $verificationInvoked -and ($testExitCode -eq 0) -and (-not $initialFailure) -and $rawReportExists -and $rawReportReadable -and $serverStopped -and $rawPassed -and $subjectStable -and ($missingRequiredIds.Count -eq 0) -and ($failedRequiredIds.Count -eq 0) -and ($rawSha256 -match '^[0-9a-f]{64}$')
  $formal = [ordered]@{
    schemaVersion = 1
    passed = [bool]$passed
    subjectSha256 = $subjectAfter
    subjectBeforeSha256 = $subjectBefore
    subjectAfterSha256 = $subjectAfter
    checks = $formalChecks
    evidence = @([ordered]@{ path = $rawEvidencePath; sha256 = $rawSha256 })
  }
  [IO.Directory]::CreateDirectory((Split-Path -Parent $ReportPath)) | Out-Null
  [IO.File]::WriteAllText($ReportPath, ($formal | ConvertTo-Json -Depth 30) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
  if (-not $passed) {
    Write-Warning "Formal PostgreSQL descriptor failed validation. Missing checks: $($missingRequiredIds -join ', '). Failed checks: $($failedRequiredIds -join ', ')."
    if ($testExitCode -eq 0) { $testExitCode = 1 }
  }
}
exit $testExitCode
