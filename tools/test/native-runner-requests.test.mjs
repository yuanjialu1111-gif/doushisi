import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const nativeRunnerPath = fileURLToPath(new URL('../run-local-native-acceptance.ps1', import.meta.url));

async function readNativeRunner() {
  return fs.readFile(nativeRunnerPath, 'utf8');
}

test('native acceptance admin requests bind PowerShell parameters without network access', () => {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$tokens=$null; $errors=$null",
    " $ast=[System.Management.Automation.Language.Parser]::ParseFile('" + nativeRunnerPath.replaceAll("'", "''") + "',[ref]$tokens,[ref]$errors)",
    "if ($errors.Count) { throw ($errors | Out-String) }",
    "$ApiBase='http://localhost:3000/'; $adminUsername='test-admin'; $adminPassword='test-password'",
    "$adminHeaders=@{ Authorization='Bearer test-token' }; $account=@{ userId='test-user'; expectedBalance='100' }; $requestId='test-credit'",
    "$captured=[System.Collections.Generic.List[object]]::new()",
    "function Invoke-RestMethod { param([string]$Method,[string]$Uri,[string]$ContentType,[string]$Body,[hashtable]$Headers,[int]$TimeoutSec); if ($args.Count) { throw 'Unbound parameters' }; $captured.Add(@{ method=$Method; uri=$Uri; contentType=$ContentType; body=($Body|ConvertFrom-Json); headers=$Headers; timeout=$TimeoutSec }) }",
    "foreach ($name in @('loginRequest','adjustmentRequest')) {",
    "$assignment=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left -is [System.Management.Automation.Language.VariableExpressionAst] -and $n.Left.VariablePath.UserPath -eq $name},$true)",
    "if (@($assignment).Count -ne 1) { throw 'Missing request assignment' }; . ([scriptblock]::Create($assignment[0].Extent.Text))",
    "$command=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Invoke-RestMethod' -and @($n.CommandElements|Where-Object { $_ -is [System.Management.Automation.Language.VariableExpressionAst] -and $_.Splatted -and $_.VariablePath.UserPath -eq $name }).Count -eq 1},$true)",
    "if (@($command).Count -ne 1) { throw 'Missing REST invocation' }; . ([scriptblock]::Create($command[0].Extent.Text))",
    "}",
    "ConvertTo-Json -InputObject @($captured.ToArray()) -Depth 8 -Compress",
  ].join('\n');
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 20000, windowsHide: true });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const [login, credit] = JSON.parse(result.stdout.trim());
  for (const request of [login, credit]) {
    assert.equal(request.method, 'Post');
    assert.equal(request.contentType, 'application/json');
    assert.equal(request.timeout, 20);
  }
  assert.equal(login.uri, 'http://localhost:3000/api/admin/login');
  assert.deepEqual(login.body, { username: 'test-admin', password: 'test-password' });
  assert.equal(credit.uri, 'http://localhost:3000/api/admin/users/test-user/adjustments');
  assert.equal(credit.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(credit.body, { amount: '100', reason: 'local native acceptance', requestId: 'test-credit' });
});

test('native acceptance requires an explicit formal APK and records its path and hash', async () => {
  const script = await readNativeRunner();
  const acceptance = script.indexOf("$acceptanceApkPath = Join-Path $projectRoot 'client/android/doushisi-acceptance.apk'");
  const release = script.indexOf("$releaseApkPath = Join-Path $projectRoot 'client/android/doushisi.apk'");
  assert.ok(acceptance >= 0, 'acceptance APK path must be declared');
  assert.ok(release > acceptance, 'formal APK path must be declared separately from the acceptance APK path');
  assert.match(script, /if \(\$Stage -eq 'acceptance'\) \{[\s\S]*?!\$PSBoundParameters\.ContainsKey\('ApkPath'\)[\s\S]*?APK_PATH_REQUIRED/);
  assert.match(script, /if \(\$Stage -eq 'acceptance'\) \{[\s\S]*?!\$InstallApk\.IsPresent[\s\S]*?INSTALL_REQUIRED/);
  assert.match(script, /if \(\$PSBoundParameters\.ContainsKey\('ApkPath'\)\) \{[\s\S]*?\$apkSelectionMode = 'explicit'/);
  assert.match(script, /\$apkPath\.Equals\(\$expectedReleaseApkPath, \[StringComparison\]::OrdinalIgnoreCase\)[\s\S]*?RELEASE_APK_REQUIRED/);
  assert.match(script, /elseif \(Test-Path -LiteralPath \$releaseApkPath -PathType Leaf\) \{[\s\S]*?\$apkSelectionMode = 'default'/);
  assert.doesNotMatch(script, /elseif \(Test-Path -LiteralPath \$acceptanceApkPath -PathType Leaf\) \{[\s\S]*?\$apkSelectionMode = 'default'/);
  assert.match(script, /function Get-ApkEvidence \{[\s\S]*?path = Get-ProjectRelativePath -Path \$apkPath[\s\S]*?sha256 = Get-ApkSha256[\s\S]*?selectedBy = \$script:apkSelectionMode/);
  assert.match(script, /throw "APK_NOT_FOUND: \$ApkPath"/);
});

test('native acceptance requires both clients to settle all twelve configured rounds', async () => {
  const script = await readNativeRunner();
  assert.match(script, /\$configuredGameNum = 12/);
  assert.match(script, /\$requiredCompletedRounds = \$configuredGameNum/);
  assert.match(script, /gameNum = \$configuredGameNum/);
  assert.match(script, /Action 'completed-round' -Fields @\{ roomId = \$roomId \}/);
  assert.match(script, /Get-ObjectPropertyValue -Value \$_ -Name 'settledAt'/);
  assert.match(script, /\$settlementsByDevice\[\[string\]\$account\.device\] = \$settled\.Count/);
  assert.match(script, /Where-Object \{ \$settlementsByDevice\[\$_\] -lt \$requiredCompletedRounds \}/);
  assert.match(script, /COMPLETED_ROUND_TIMEOUT: both devices did not observe \$requiredCompletedRounds settled rounds/);
  assert.match(script, /COMPLETED_ROUND_MISMATCH: expected \$requiredCompletedRounds settled rounds/);
  assert.match(script, /New-FinalCheck -Checks \$checks -Id 'completed-round'[\s\S]*?Details @\{ roundId = \$roundId; settledCount = \$requiredCompletedRounds \}/);
  assert.doesNotMatch(script, /Details @\{ roundId = \$roundId; settledCount = \$requiredCompletedRounds; requiredCompletedRounds/);
  assert.match(script, /SETTLEMENT_FAILED: \$\(\$account\.device\) did not observe all \$requiredCompletedRounds completed rounds/);
});

test('native acceptance checks real adb reverse and forward lists before and after the run', async () => {
  const script = await readNativeRunner();
  assert.match(script, /Invoke-AdbText -Arguments @\('-s', \$Serial, 'reverse', '--list'\)/);
  assert.match(script, /Invoke-AdbText -Arguments @\('-s', \$Serial, 'forward', '--list'\)/);
  assert.match(script, /ADB_FORWARDING_PRESENT: adb reverse or forward entries exist/);
  assert.match(script, /\$postForwarding = Assert-AdbForwardingAbsent -Serial \(\[string\]\$device\.id\) -Phase 'post-acceptance'/);
  assert.match(script, /\$device\.forwardingCheckedAfter = \$true/);
  assert.match(script, /ADB_FORWARDING_PRESENT_AFTER_ACCEPTANCE/);
  assert.match(script, /preflightForwardingFree = \(@\(\$deviceSummary \| Where-Object \{ \$_\.forwardingFreeBefore -ne \$true \}\)\.Count -eq 0\)/);
  assert.match(script, /postAcceptanceForwardingFree = \(@\(\$deviceSummary \| Where-Object \{ \$_\.forwardingFreeAfter -ne \$true \}\)\.Count -eq 0\)/);
  assert.match(script, /reverseListBefore = \[string\]\$_\.reverseList/);
  assert.match(script, /forwardListAfter = \[string\]\$_\.forwardListAfter/);
  assert.doesNotMatch(script, /preflightForwardingFree\s*=\s*\$true/);
});

test('native acceptance records real device properties, identity, network and rejects emulators', async () => {
  const script = await readNativeRunner();
  for (const property of [
    'ro.serialno', 'ro.boot.serialno', 'ro.product.brand', 'ro.product.manufacturer',
    'ro.product.model', 'ro.product.device', 'ro.product.name', 'ro.build.fingerprint',
    'ro.boot.hardware', 'ro.boot.bootloader',
  ]) {
    assert.ok(script.includes(`'${property}'`), `missing getprop evidence for ${property}`);
  }
  assert.match(script, /Invoke-AdbText -Arguments @\('-s', \$serial, 'shell', 'getprop'\)/);
  assert.match(script, /Invoke-AdbText -Arguments @\('-s', \$serial, 'shell', 'ip', 'route'\)/);
  assert.match(script, /Invoke-AdbText -Arguments @\('-s', \$serial, 'shell', 'ip', 'addr'\)/);
  assert.match(script, /identitySha256 = \$identitySha256/);
  assert.match(script, /preflight-distinct-device-identity/);
  assert.match(script, /DUPLICATE_DEVICE_IDENTITY/);
  assert.match(script, /\$Serial -match '\^emulator-'/);
  assert.match(script, /ranchu\|goldfish/);
  assert.match(script, /ro\.kernel\.qemu/);
  assert.match(script, /EMULATOR_DEVICE_REJECTED/);
  assert.match(script, /route = \[string\]\$_\.route/);
  assert.match(script, /ipAddr = \[string\]\$_\.ipAddr/);
  assert.ok(script.includes('identitySha256 = $_.identitySha256'));
});

test('native acceptance installs and binds both the client and driver APKs on each physical device', async () => {
  const script = await readNativeRunner();
  assert.match(script, /if \(!\(Test-Path -LiteralPath \$driverApkPath -PathType Leaf\)\) \{[\s\S]*?DRIVER_APK_NOT_FOUND/);
  assert.match(script, /function Get-DriverApkEvidence \{[\s\S]*?\$apkSha256 = Get-Sha256 -Path \$absolute[\s\S]*?targetPackage = \$package/);
  assert.match(script, /function Install-AndVerifyPackage \{[\s\S]*?if \(\$InstallApk\) \{[\s\S]*?'install', '-r', \$Apk[\s\S]*?Success[\s\S]*?Assert-InstalledPackageSet -Serial \$Serial -PackageName \$PackageName/);
  assert.match(script, /function Get-InstalledPackageEvidence \{[\s\S]*?'shell', 'pm', 'path', \$PackageName[\s\S]*?sha256sum/);
  assert.match(script, /Install-AndVerifyPackage -Serial \$serial -PackageName \$package -Apk \$apkPath -ExpectedSha256 \$apkSha256 -FailureCode 'APK'/);
  assert.match(script, /Install-AndVerifyPackage -Serial \$serial -PackageName 'net\.doushisi\.acceptance' -Apk \$driverApkPath -ExpectedSha256 \$driverApkSha256 -FailureCode 'DRIVER_APK'/);
  assert.match(script, /driverApkSha256 = \$null[\s\S]*?\$driverApkEvidence = Get-DriverApkEvidence[\s\S]*?\$report\.driverApkSha256 = \$driverApkSha256/);
  assert.match(script, /installedDriverApkSha256 = \$driverApkSha256[\s\S]*?installedDriverApkByScript = \[bool\]\$installedDriver\.installedByScript/);
  assert.match(script, /if \(\[string\]\$device\.installedDriverApkSha256 -ne \[string\]\$Preflight\.driverApkSha256\)[\s\S]*?LOCAL_NATIVE_DRIVER_APK_MISMATCH/);
  assert.match(script, /if \(\(Get-Sha256 -Path \$driverApkPath\) -ne \[string\]\$Preflight\.driverApkSha256\)[\s\S]*?DRIVER_APK_CHANGED_DURING_ACCEPTANCE/);
  assert.match(script, /elseif \(\$Stage -eq 'acceptance'\) \{[\s\S]*?INSTALL_REQUIRED: acceptance requires -InstallApk/);
});

test('preflight never archives, overwrites or deletes the final acceptance report', async () => {
  const script = await readNativeRunner();
  assert.match(script, /\$preflightPath = Join-Path \$verificationDirectory 'local-native-preflight\.json'/);
  assert.match(script, /\$finalPath = Join-Path \$verificationDirectory 'local-native\.json'/);
  assert.match(script, /function Initialize-LocalNativeRun \{[\s\S]*?param\(\[Parameter\(Mandatory=\$true\)\]\[ValidateSet\('preflight', 'acceptance'\)\]\[string\]\$RunStage\)/);
  assert.match(script, /if \(\$RunStage -ne 'acceptance'\) \{ return \}/);
  assert.match(script, /Initialize-LocalNativeRun -RunStage \$Stage/);
  assert.doesNotMatch(script, /Remove-Item -LiteralPath \$finalPath/);
  assert.match(script, /if \(\$Stage -eq 'preflight'\) \{\s*# Preflight owns only verification\/local-native-preflight\.json[\s\S]*?\n\s*throw\n/);
  assert.match(script, /Write-FailedFinalReport -Failure \$failure/);
  assert.doesNotMatch(script, /Final local-native\.json was intentionally not created/);
});

test('native acceptance trusts the runner-observed driver APK and binds it to the release subject', async () => {
  const script = await readNativeRunner();
  // The driver APK path, size, hash and signature must all be measured from the
  // APK/sidecar by the runner rather than copied from a self-asserted artifact.
  assert.match(script, /function Get-DriverApkEvidence \{[\s\S]{0,4000}?\$apkSha256 = Get-Sha256 -Path \$absolute/);
  assert.match(script, /function Get-DriverApkEvidence \{[\s\S]{0,4000}?\$apkSize = \(Get-Item -LiteralPath \$absolute\)\.Length/);
  assert.match(script, /function Get-DriverApkEvidence \{[\s\S]{0,4000}?\$signing = Get-DriverSigningEvidence -Apk \$absolute -Idsig \$idsigPath -ExpectedCertificateSha256 \$trustedDriverCertificateSha256/);
  assert.match(script, /function Get-DriverApkEvidence \{[\s\S]{0,4000}?\$releaseSubjectSha256 = Get-SubjectSha256/);
  assert.match(script, /function Get-DriverApkEvidence \{[\s\S]{0,4000}?releaseSubjectBinding = 'runner-observed-current-subject'/);
  assert.match(script, /\$trustedDriverCertificateSha256 = 'd90b4c8e4b7fb34dd7445a060b0f8f3b7820f2a05fe31ea1b4aeac062edf883c'/);
  // The reported certificate must match the pinned certificate, and the runner
  // must re-verify the on-disk APK signature instead of trusting the report.
  assert.match(script, /\$reportedCertificate -ne \$trustedDriverCertificateSha256/);
  assert.match(script, /\$reportedExpectedCertificate -ne \$trustedDriverCertificateSha256/);
  assert.match(script, /DRIVER_APK_BUILD_REPORT_MISMATCH: The build report is not bound to the trusted driver signing certificate\./);
  // The driver APK must be bound to the current release subject both when the
  // preflight starts and after the run finishes.
  assert.match(script, /\$driverApkEvidence\.releaseSubjectSha256 -ne \[string\]\$subjectBefore[\s\S]{0,200}?DRIVER_APK_RELEASE_SUBJECT_MISMATCH/);
  assert.match(script, /\$driverApkAtEnd\.releaseSubjectSha256 -ne \[string\]\$subjectAfter[\s\S]{0,200}?DRIVER_APK_RELEASE_SUBJECT_MISMATCH/);
  assert.match(script, /\$report\.driverApkAtEnd = \$driverApkAtEnd/);
  assert.match(script, /DRIVER_APK_CHANGED_DURING_ACCEPTANCE/);
  assert.doesNotMatch(script, /driverApkSelfAsserted|selfAssertedDriver/i);
});

test('native acceptance re-reads installed client and driver hashes after preflight instead of trusting earlier values', async () => {
  const script = await readNativeRunner();
  // Preflight installs, then immediately re-reads the on-device package.
  assert.match(script, /Assert-InstalledPackageMatchesSnapshot -Serial \(\[string\]\$device\.id\) -PackageName \$package -ExpectedSha256 \(\[string\]\$apkSha256\) -FailureCode 'LOCAL_NATIVE_APK' -Phase 'preflight-post-install'/);
  assert.match(script, /Assert-InstalledPackageMatchesSnapshot -Serial \(\[string\]\$device\.id\) -PackageName 'net\.doushisi\.acceptance' -ExpectedSha256 \(\[string\]\$driverApkSha256\) -FailureCode 'LOCAL_NATIVE_DRIVER_APK' -Phase 'preflight-post-install'/);
  assert.equal((script.match(/'preflight-post-install'/g) ?? []).length >= 2, true);
  // Acceptance re-reads the installed packages again at the end of the run.
  assert.match(script, /Assert-InstalledPackageMatchesSnapshot -Serial \(\[string\]\$device\.id\) -PackageName \$package -ExpectedSha256 \(\[string\]\$Preflight\.apkSha256\) -FailureCode 'LOCAL_NATIVE_APK' -Phase 'acceptance-final'/);
  assert.match(script, /Assert-InstalledPackageMatchesSnapshot -Serial \(\[string\]\$device\.id\) -PackageName 'net\.doushisi\.acceptance' -ExpectedSha256 \(\[string\]\$Preflight\.driverApkSha256\) -FailureCode 'LOCAL_NATIVE_DRIVER_APK' -Phase 'acceptance-final'/);
  assert.match(script, /installedApkSha256ByBasename = \$installedClient\.sha256ByBasename/);
  assert.match(script, /installedDriverApkSha256ByBasename = \$installedDriver\.sha256ByBasename/);
  assert.match(script, /installedClientRereadAt = \[string\]\$_\.installedPackageRereadAt/);
  assert.match(script, /installedDriverRereadAt = \[string\]\$_\.installedPackageRereadAt/);
  assert.match(script, /installedClientFinalSha256 = \[string\]\$endClient\.hashes\[0\]/);
  assert.match(script, /installedDriverFinalSha256 = \[string\]\$endDriver\.hashes\[0\]/);
  assert.doesNotMatch(script, /ExpectedSha256 = \$device\.installedApkSha256(?![A-Za-z])/);
});
