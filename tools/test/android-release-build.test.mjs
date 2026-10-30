import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const releaseScript = readFileSync(new URL('../client-native-release-build.ps1', import.meta.url), 'utf8');
const driverScript = readFileSync(new URL('../android-acceptance-driver/build-driver.ps1', import.meta.url), 'utf8');
const compatibilityScript = readFileSync(new URL('../client-native-acceptance-build.ps1', import.meta.url), 'utf8');
const nativeRunner = readFileSync(new URL('../run-local-native-acceptance.ps1', import.meta.url), 'utf8');

const certificateSha256 = 'd90b4c8e4b7fb34dd7445a060b0f8f3b7820f2a05fe31ea1b4aeac062edf883c';

test('release APK build uses the protected credential and pins the signing certificate', () => {
  assert.match(releaseScript, /doushisi-signing-credential\.xml/);
  assert.match(releaseScript, /Import-Clixml/);
  assert.match(releaseScript, /PSCredential/);
  assert.ok(releaseScript.includes(certificateSha256), 'expected certificate hash must be pinned');
  assert.match(releaseScript, /SIGNING_CERTIFICATE_MISMATCH/);
  assert.doesNotMatch(releaseScript, /--ks-pass\s+['"]?\S*(?<!env:DOUSHISI_KEYSTORE_PASSWORD)/);
  assert.doesNotMatch(releaseScript, /-StorePass\s+['"][^'"]+['"]/);
});

test('release APK build verifies v2, v3 and v4 plus the v4 sidecar', () => {
  assert.match(releaseScript, /--v4-signature-file/);
  assert.match(releaseScript, /APK Signature Scheme v2/);
  assert.match(releaseScript, /APK Signature Scheme v3/);
  assert.match(releaseScript, /APK Signature Scheme v4/);
  assert.match(releaseScript, /APK_SIGNATURE_SCHEME_MISSING/);
  assert.match(releaseScript, /apksigner did not produce the v4 sidecar file/);
});

test('release APK build writes hash, signature and certificate evidence', () => {
  for (const field of ['schemaVersion', 'stage', 'passed', 'apiBase', 'packageName', 'apk',
    'idsig', 'signing', 'certificateSha256', 'expectedCertificateSha256', 'keyAlias',
    'v2', 'v3', 'v4', 'command']) {
    assert.ok(releaseScript.includes(field), `release report is missing ${field}`);
  }
  assert.match(releaseScript, /Set-Content -LiteralPath \$reportPath -Encoding utf8/);
});

test('acceptance driver build uses the protected credential and verifies all signature schemes', () => {
  assert.match(driverScript, /doushisi-signing-credential\.xml/);
  assert.match(driverScript, /Import-Clixml/);
  assert.match(driverScript, /PSCredential/);
  assert.ok(driverScript.includes(certificateSha256), 'driver expected certificate hash must be pinned');
  assert.match(driverScript, /SIGNING_CERTIFICATE_MISMATCH/);
  assert.match(driverScript, /--v4-signature-file/);
  assert.match(driverScript, /DRIVER_SIGNATURE_SCHEME_MISSING/);
  assert.match(driverScript, /android-acceptance-driver-build\.json/);
});

test('acceptance driver report records APK, idsig, signing and reproducibility fields', () => {
  for (const field of ['schemaVersion', 'stage', 'passed', 'generatedAt', 'packageName', 'apk',
    'idsig', 'signing', 'certificateSha256', 'expectedCertificateSha256', 'keyAlias',
    'v2', 'v3', 'v4', 'command']) {
    assert.ok(driverScript.includes(field), `driver report is missing ${field}`);
  }
  assert.match(driverScript, /Set-Content -LiteralPath \$report -Encoding utf8/);
});

test('legacy acceptance build entrypoint delegates to the verified release build', () => {
  assert.match(compatibilityScript, /client-native-release-build\.ps1/);
  assert.match(compatibilityScript, /CredentialFile/);
  assert.match(compatibilityScript, /OutputIdsig/);
  assert.doesNotMatch(compatibilityScript, /DOUSHISI_KEYSTORE_PASSWORD/);
  assert.match(compatibilityScript, /ACCEPTANCE_APK_BUILD_FAILED/);
});

test('native runner passes the protected credential to both APK builds', () => {
  assert.match(nativeRunner, /client-native-release-build\.ps1/);
  assert.match(nativeRunner, /build-driver\.ps1/);
  const credentialForwarding = nativeRunner.match(/@\('CredentialFile', \$CredentialFile\)/g) ?? [];
  assert.ok(credentialForwarding.length >= 1, 'CredentialFile must be forwarded to the APK build');
  assert.match(nativeRunner, /-CredentialFile \$CredentialFile/);
});

test('build scripts do not contain a plaintext signing password literal', () => {
  for (const script of [releaseScript, driverScript, compatibilityScript]) {
    assert.doesNotMatch(script, /DOUSHISI_KEYSTORE_PASSWORD\s*=\s*['"][^'"]+['"]/);
    assert.doesNotMatch(script, /storepass\s*[=:]\s*['"]?[A-Za-z0-9]/i);
  }
});
