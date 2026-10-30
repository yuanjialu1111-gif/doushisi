import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = readFileSync(new URL('../package-local.ps1', import.meta.url), 'utf8');
const toolsRoot = dirname(fileURLToPath(import.meta.url)) + '/..';
const projectRoot = join(toolsRoot, '..');

// Every local ./relative.mjs import inside an offline verification tool must
// also be copied by package-local.ps1, otherwise the exported package can
// reference a file it never carried.
test('local package script copies every relative import of its bundled offline tools', () => {
  const bundled = [
    'release-audit.mjs',
    'release-check.mjs',
    'run-local-stability.mjs',
    'rulebook-integrity.mjs',
    'verify-backup.mjs',
  ];
  const importPattern = /from\s+['"]\.\/([^'"]+\.mjs)['"]/g;
  const missing = [];
  for (const name of bundled) {
    const source = readFileSync(join(toolsRoot, name), 'utf8');
    for (const match of source.matchAll(importPattern)) {
      const dependency = match[1];
      if (!existsSync(join(projectRoot, 'tools', dependency))) {
        throw new Error(`offline verification dependency is missing on disk: tools/${dependency}`);
      }
      if (!script.includes(dependency)) missing.push(`${name} -> tools/${dependency}`);
    }
  }
  assert.deepEqual(missing, [], `package-local.ps1 must copy: ${missing.join(', ')}`);
});

test('local package script includes the required runtime deliverables', () => {
  for (const required of [
    'apps/server/dist',
    'apps/server/migrations',
    'apps/admin/dist',
    'client/public',
    'client/android/doushisi.apk',
    'runtime/node.exe',
    'tools/local-run.ps1',
    'tools/local-shortcuts.ps1',
    'tools/build-fingerprint.mjs',
    'tools/print-source-fingerprint.mjs',
    'deploy/backup-lib.mjs',
    'deploy/backup-cli.mjs',
    'verification/build-manifest.json',
    'docs/rules/release',
    'package-manifest.json',
  ]) {
    assert.ok(script.includes(required), `missing required package entry: ${required}`);
  }
});

test('local package script records report presence and explicit missing entries', () => {
  for (const report of [
    'local-readiness.json',
    'release-readiness.json',
    'local-ui.json',
    'local-accounting.json',
    'local-network.json',
    'local-recovery.json',
    'local-completed-games.json',
    'local-native-preflight.json',
    'local-native.json',
    'original-ui-comparison.json',
    'original-network-isolation.json',
    'gameplay-capacity.json',
    'postgres-concurrency.json',
    'native-end-to-end.json',
    'android-release-build.json',
    'android-acceptance-driver-build.json',
    'local-stability.json',
  ]) {
    assert.ok(script.includes(report), `missing optional report path: ${report}`);
  }
  assert.match(script, /present\s*=\s*\$true/);
  assert.match(script, /present\s*=\s*\$false/);
  assert.match(script, /missing\s*=\s*\$missing/);
  assert.match(script, /reason\s*=\s*'not generated before packaging'/);
});

test('local package script rejects credential and private-key artifacts', () => {
  for (const forbidden of [
    '.env',
    'jks',
    'keystore',
    'p12',
    'pfx',
    'pem',
    'key',
    'local-access.json',
    'signing-credential',
    'lan-config.json',
    '.local',
  ]) {
    assert.ok(script.includes(forbidden), `missing safety exclusion: ${forbidden}`);
  }
  assert.match(script, /Assert-NoForbiddenArtifacts/);
  assert.match(script, /Unexpected credentials or private runtime files/);
});

test('local package script records file and directory hashes in the manifest', () => {
  for (const field of [
    'formatVersion',
    'releaseSubject',
    'apk',
    'buildManifest',
    'rulebooks',
    'keyFiles',
    'deliveryDigests',
    'reports',
    'missing',
  ]) {
    assert.ok(script.includes(field), `missing manifest field: ${field}`);
  }
  for (const hashFunction of ['Get-FileRecord', 'Get-DirectoryDigest', 'Get-TextHash', 'Get-FileHash']) {
    assert.ok(script.includes(hashFunction), `missing hash helper: ${hashFunction}`);
  }
  assert.match(script, /sha256\s*=/);
  assert.match(script, /directoryCount\s*=/);
});

test('local package script includes the full offline evidence closure', () => {
  for (const required of [
    'verification/raw',
    'client/validation',
    'Copy-RequiredDirectory $evidenceSource',
    'docs/rules/variants',
    "*-INDEPENDENT.md",
    'print-source-fingerprint.mjs',
    '--subject',
    'releaseSubject = $releaseSubject',
  ]) assert.ok(script.includes(required), `missing evidence closure entry: ${required}`);
  assert.match(script, /Required acceptance report is missing/);
  assert.match(script, /Required acceptance report did not pass/);
  assert.match(script, /Required evidence directory is missing/);
  assert.match(script, /if\s*\(Test-Path -LiteralPath \$evidenceSource -PathType Container\)/);
});

test('local package script binds the formal acceptance subject and offline re-verification tools', () => {
  for (const required of [
    "tools/print-source-fingerprint.mjs",
    '--subject',
    "verification/production-acceptance.json",
    "Production acceptance manifest is missing. Run node tools/package-production-acceptance.mjs . first.",
    "tools/release-audit.mjs",
    "tools/release-check.mjs",
    "tools/run-local-stability.mjs",
    "tools/rulebook-integrity.mjs",
    "packages/rules/dist",
    "packages/protocol/dist",
    "$nativeReport.passed -ne $true",
    "$nativeReport.subjectBeforeSha256 -ne $releaseSubject",
    "$nativeReport.subjectAfterSha256 -ne $releaseSubject",
    "$candidateHash -eq $expectedApkSha256",
  ]) assert.ok(script.includes(required), `missing release binding entry: ${required}`);
});

test('local package script refuses forbidden files in source evidence before packaging', () => {
  assert.match(script, /function Assert-NoForbiddenFiles/);
  assert.match(script, /Assert-NoForbiddenFiles \(Join-Path \$root 'verification'\) 'verification evidence'/);
  assert.match(script, /Assert-NoForbiddenFiles \(Join-Path \$root 'client\/validation'\) 'client validation evidence'/);
  assert.match(script, /Prohibited files are present in \$Label; packaging was refused\./);
});

test('local package script cross-checks the packaged production acceptance manifest', () => {
  assert.match(script, /function Assert-ProductionManifest/);
  assert.match(script, /Assert-ProductionManifest \$target \$releaseSubject \$expectedApkSha256/);
  for (const required of [
    'Production acceptance manifest is missing from the exported package.',
    'Production acceptance manifest is not bound to the current release subject.',
    'Production acceptance manifest is not bound to the accepted APK.',
    'Production acceptance manifest does not match the packaged build manifest.',
    'Packaged report does not match production acceptance:',
    'Packaged output does not match production acceptance:',
  ]) assert.ok(script.includes(required), `missing production manifest gate: ${required}`);
});

test('local package script reads readiness pass state from readiness fields', () => {
  assert.match(script, /function Get-ReportPassed/);
  assert.match(script, /\$ReportJson\.localReady -eq \$true/);
  assert.match(script, /\$ReportJson\.releaseReady -eq \$true/);
  assert.match(script, /return \$ReportJson\.passed -eq \$true/);
  assert.match(script, /\$reportPassed = Get-ReportPassed \$reportName \$sourceReportJson/);
});

test('local package script binds the APK to passed local native acceptance evidence', () => {
  for (const required of [
    "verification/local-native.json",
    "client/android/doushisi.apk",
    "$nativeReport.passed -ne $true",
    "$nativeReport.apkSha256",
    "$candidateHash -eq $expectedApkSha256",
    "No APK matches the hash bound by the passed local native acceptance report.",
  ]) assert.ok(script.includes(required), `missing APK binding entry: ${required}`);
  assert.ok(!script.includes('client/android/doushisi-acceptance.apk'),
    'acceptance APK must not be a formal release candidate');
  assert.match(script, /\$apkRecord\.source\s*=\s*Get-RelativeUnixPath\s+\$root\s+\$releaseApkSource/);
  assert.match(script, /\$apkRecord\.selectedBy\s*=\s*'local-native-acceptance'/);
  assert.match(script, /apk\s*=\s*\$apkRecord/);
});

test('local package script independently binds Android build artifacts', () => {
  for (const required of [
    'function Resolve-ProjectArtifactPath',
    'function Assert-AndroidArtifactReport',
    'Assert-AndroidArtifactReport -Root $root',
    "-NotePropertyName bindingKind -NotePropertyValue 'release-apk'",
    "-NotePropertyName bindingKind -NotePropertyValue 'acceptance-driver'",
    "-NotePropertyName acceptedByReport -NotePropertyValue 'verification/local-native.json'",
    'Android artifact report APK SHA-256 does not match the file on disk:',
    'Android artifact report APK SHA-256 does not match the accepted APK:',
    'Android artifact report idsig SHA-256 does not match the file on disk:',
    'Android artifact report signing certificate is not pinned:',
    'Android artifact report is missing v2/v3/v4 signatures:',
    'Acceptance driver is not bound by local native acceptance evidence.',
  ]) {
    assert.ok(script.includes(required), 'missing Android artifact binding entry: ' + required);
  }
  assert.match(script, /Get-FileHash -LiteralPath \$apkPath -Algorithm SHA256/);
  assert.match(script, /Get-FileHash -LiteralPath \$idsigPath -Algorithm SHA256/);
});

test('the Android artifact binding helper accepts the real release APK and rejects a hash swap', {
  skip: process.platform !== 'win32',
}, () => {
  const helperSource = script.match(
    /(?<helper>^function Resolve-ProjectArtifactPath \{[\s\S]*?^\}\r?\n\r?\nfunction Assert-AndroidArtifactReport \{[\s\S]*?^\})/m,
  )?.groups?.helper;
  assert.ok(helperSource, 'Android artifact binding helpers must be present in package-local.ps1');

  const apk = join(projectRoot, 'client', 'android', 'doushisi.apk');
  const reportPath = join(projectRoot, 'verification', 'android-release-build.json');
  assert.ok(existsSync(apk), 'formal release APK must exist for this test');
  assert.ok(existsSync(reportPath), 'android-release-build.json must exist for this test');
  // Derive the accepted hash from the APK bytes so the test independently
  // checks that the build report, the file on disk, and the caller all agree.
  const expectedApkSha256 = createHash('sha256').update(readFileSync(apk)).digest('hex');
  assert.equal(
    JSON.parse(readFileSync(reportPath, 'utf8')).apk.sha256,
    expectedApkSha256,
    'android-release-build.json must pin the current APK hash',
  );
  const expectedPath = apk.replaceAll('\\', '/');

  const invoke = mutation => spawnSync('pwsh', ['-NoProfile', '-Command', [
    '$ErrorActionPreference = \'Stop\'',
    helperSource,
    '$report = Get-Content -LiteralPath $env:REPORT_PATH -Raw | ConvertFrom-Json',
    '$mutation = $env:REPORT_MUTATION_JSON | ConvertFrom-Json',
    'foreach ($name in @("apkSha256","idsigSha256","certificateSha256","expectedCertificateSha256","apkPath","v2","v3","v4")) {',
    '  if ($null -ne $mutation.$name) {',
    '    if ($name -eq "apkSha256") { $report.apk.sha256 = [string]$mutation.$name }',
    '    elseif ($name -eq "idsigSha256") { $report.idsig.sha256 = [string]$mutation.$name }',
    '    elseif ($name -eq "certificateSha256") { $report.signing.certificateSha256 = [string]$mutation.$name }',
    '    elseif ($name -eq "expectedCertificateSha256") { $report.signing.expectedCertificateSha256 = [string]$mutation.$name }',
    '    elseif ($name -eq "apkPath") { $report.apk.path = [string]$mutation.$name }',
    '    else { $report.signing.$name = [bool]$mutation.$name }',
    '  }',
    '}',
    "Assert-AndroidArtifactReport -Root $env:PROJECT_ROOT -Report $report -ReportRelativePath 'verification/android-release-build.json' -ExpectedApkSha256 $env:EXPECTED_APK_SHA256 -ExpectedPaths @($env:EXPECTED_APK_PATH)",
  ].join('\n')], {
    env: {
      ...process.env,
      PROJECT_ROOT: projectRoot,
      REPORT_PATH: reportPath,
      REPORT_MUTATION_JSON: JSON.stringify(mutation),
      EXPECTED_APK_SHA256: expectedApkSha256,
      EXPECTED_APK_PATH: expectedPath,
    },
    encoding: 'utf8',
  });

  const matching = invoke({});
  assert.equal(matching.status, 0, matching.stderr);

  const mismatched = invoke({ apkSha256: '0'.repeat(64) });
  assert.notEqual(mismatched.status, 0, 'a swapped APK hash must be rejected');
  assert.match(mismatched.stderr, /APK SHA-256 does not match the file on disk/);

  const idsigMismatch = invoke({ idsigSha256: '0'.repeat(64) });
  assert.notEqual(idsigMismatch.status, 0, 'a swapped idsig hash must be rejected');
  assert.match(idsigMismatch.stderr, /idsig SHA-256 does not match the file on disk/);

  const signatureMismatch = invoke({ v3: false });
  assert.notEqual(signatureMismatch.status, 0, 'a missing v3 signature flag must be rejected');
  assert.match(signatureMismatch.stderr, /missing v2\/v3\/v4 signatures/);

  const certificateMismatch = invoke({ certificateSha256: '0'.repeat(64) });
  assert.notEqual(certificateMismatch.status, 0, 'a mismatched signing certificate must be rejected');
  assert.match(certificateMismatch.stderr, /signing certificate is not pinned/);

  const pathEscape = invoke({ apkPath: '../outside.apk' });
  assert.notEqual(pathEscape.status, 0, 'an APK path outside the project must be rejected');
  assert.match(pathEscape.stderr, /escapes the project root/);
});

test('local package script refuses an incomplete release unless explicitly allowed', () => {
  assert.match(script, /\[switch\]\$AllowIncomplete/);
  assert.match(script, /if\s*\(!\$AllowIncomplete\)\s*\{/);
  assert.match(script, /node tools\/release-check\.mjs --local/);
  assert.match(script, /Local acceptance is not complete; packaging was refused\./);
});

test('local package script refreshes production readiness before packaging', () => {
  const localCheck = script.indexOf('node tools/release-check.mjs --local');
  const productionCheck = script.indexOf('& node tools/release-check.mjs', localCheck + 1);
  const productionGate = script.indexOf('Production acceptance is not complete; packaging was refused.');
  assert.ok(localCheck >= 0, 'packaging must run the local acceptance check');
  assert.ok(productionCheck >= 0, 'packaging must refresh the production readiness report');
  assert.ok(productionGate > productionCheck, 'production readiness refresh must fail packaging when incomplete');
  assert.ok(localCheck < productionCheck, 'local acceptance must be checked before production readiness is refreshed');
  assert.match(script, /\$LASTEXITCODE -ne 0\) \{ throw 'Production acceptance is not complete/);
});

test('local package script independently verifies release APK signatures', () => {
  for (const required of [
    'function Assert-ApkSignatureVerified',
    'apksigner.jar',
    'verify --verbose --print-certs',
    'verify --v4-signature-file',
    'Independent APK signature verification did not confirm v2:',
    'Independent APK signature verification did not confirm v3:',
    'Independent APK signature verification did not confirm v4:',
    'Independent APK signature verification found an unexpected certificate:',
    'DOUSHISI_JAVA_HOME',
    'DOUSHISI_BUILD_TOOLS',
  ]) assert.ok(script.includes(required), 'missing independent signature gate: ' + required);
  assert.match(script, /Assert-ApkSignatureVerified -Root \$root/);
});

test('production acceptance manifest paths must resolve inside the packaged root', () => {
  assert.match(
    script,
    /Resolve-ProjectArtifactPath -Root \$Root -Path \(\[string\]\$report\.path\) -Label 'production-acceptance report path'/,
  );
  assert.match(
    script,
    /Resolve-ProjectArtifactPath -Root \$Root -Path \(\[string\]\$output\.path\) -Label 'production-acceptance output path'/,
  );
});

test('acceptance reports with before and after subjects must match both digests', () => {
  assert.match(script, /\$reportBefore = \[string\]\$sourceReportJson\.subjectBeforeSha256/);
  assert.match(script, /\$reportAfter = \[string\]\$sourceReportJson\.subjectAfterSha256/);
  assert.match(script, /\$reportBefore -ne \$releaseSubject -or \$reportAfter -ne \$releaseSubject/);
  assert.match(script, /Required acceptance report is not bound to the current release subject before and after collection:/);
  assert.match(script, /Required readiness report is not bound to the current release subject:/);
});
