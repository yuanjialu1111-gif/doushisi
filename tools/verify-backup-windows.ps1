param(
  [string]$RuntimeDirectory,
  [string]$WorkDirectory,
  [string]$ReportPath
)
$ErrorActionPreference = 'Stop'
$repositoryDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workspaceDirectory = (Resolve-Path (Join-Path $repositoryDirectory '../..')).Path
if (!$RuntimeDirectory) { $RuntimeDirectory = Join-Path $workspaceDirectory 'work/postgres/runtime/pgsql' }
if (!$WorkDirectory) { $WorkDirectory = Join-Path $workspaceDirectory 'work/backup-verification' }
$RuntimeDirectory = (Resolve-Path -LiteralPath $RuntimeDirectory).Path
$runId = [Guid]::NewGuid().ToString('N')
$runDirectory = Join-Path ([IO.Path]::GetFullPath($WorkDirectory)) $runId
[IO.Directory]::CreateDirectory($runDirectory) | Out-Null
if (!$ReportPath) { $ReportPath = Join-Path $repositoryDirectory 'deploy/verification/postgres-backup-restore.json' }
$clusterDirectory = Join-Path $runDirectory 'cluster'
$passwordPath = Join-Path $runDirectory 'init-password.tmp'
$controlBinary = Join-Path $RuntimeDirectory 'bin/pg_ctl.exe'
$testPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
$previous = @{}
foreach ($key in @('PGHOST','PGPORT','PGUSER','PGDATABASE','PGPASSWORD','PG_BIN','BACKUP_VERIFY_WORK','BACKUP_VERIFY_REPORT','BACKUP_VERIFY_DISPOSABLE_CLUSTER')) { $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
$started = $false
$stopped = $false
$testExit = 1
function Quote-ToolArgument([string]$Value) { return '"' + $Value.Replace('"', '\"') + '"' }
function Invoke-DatabaseTool([string]$Binary, [string[]]$Arguments, [string]$Stage) {
  $stdout = Join-Path $runDirectory "$Stage.stdout.log"
  $stderr = Join-Path $runDirectory "$Stage.stderr.log"
  $process = Start-Process -FilePath $Binary -ArgumentList $Arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw "Isolated PostgreSQL $Stage failed; inspect private logs under $runDirectory" }
}
try {
  [IO.File]::WriteAllText($passwordPath, $testPassword, [Text.UTF8Encoding]::new($false))
  Invoke-DatabaseTool (Join-Path $RuntimeDirectory 'bin/initdb.exe') @('-D',(Quote-ToolArgument $clusterDirectory),'-U','postgres','--auth=scram-sha-256','--encoding=UTF8','--locale=C','--pwfile',(Quote-ToolArgument $passwordPath)) 'initdb'
  Remove-Item -LiteralPath $passwordPath
  Invoke-DatabaseTool $controlBinary @('-D',(Quote-ToolArgument $clusterDirectory),'-l',(Quote-ToolArgument (Join-Path $runDirectory 'server.log')),'-o',(Quote-ToolArgument "-h 127.0.0.1 -p $port"),'-w','start') 'start'
  $started = $true
  $env:PGHOST = '127.0.0.1'
  $env:PGPORT = [string]$port
  $env:PGUSER = 'postgres'
  $env:PGDATABASE = 'postgres'
  $env:PGPASSWORD = $testPassword
  $env:PG_BIN = Join-Path $RuntimeDirectory 'bin'
  $env:BACKUP_VERIFY_WORK = Join-Path $runDirectory 'evidence'
  $env:BACKUP_VERIFY_REPORT = $ReportPath
  $env:BACKUP_VERIFY_DISPOSABLE_CLUSTER = 'true'
  & (Get-Command node -ErrorAction Stop).Source (Join-Path $PSScriptRoot 'verify-backup.mjs')
  $testExit = $LASTEXITCODE
} finally {
  if ($started -or (Test-Path -LiteralPath (Join-Path $clusterDirectory 'postmaster.pid'))) {
    try {
      Invoke-DatabaseTool $controlBinary @('-D',(Quote-ToolArgument $clusterDirectory),'-m','fast','-w','stop') 'stop'
      $stopped = $true
    } catch { Write-Warning $_; $testExit = 1 }
  }
  if (Test-Path -LiteralPath $passwordPath) { Remove-Item -LiteralPath $passwordPath }
  foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
  if (Test-Path -LiteralPath $ReportPath) {
    $report = Get-Content -LiteralPath $ReportPath -Raw | ConvertFrom-Json -AsHashtable
    $report.temporaryServerStopped = $stopped
    $report.loopbackPort = $port
    $report.pgVersion = (& (Join-Path $RuntimeDirectory 'bin/pg_dump.exe') --version)
    $report.dockerExecuted = $false
    if (!$stopped) { $report.passed = $false }
    [IO.File]::WriteAllText($ReportPath, ($report | ConvertTo-Json -Depth 30) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
  }
}
exit $testExit
