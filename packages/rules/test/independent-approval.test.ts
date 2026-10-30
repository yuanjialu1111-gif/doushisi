import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeIndependentApproval, RETAINED_VARIANT_KEYS, INDEPENDENT_APPROVAL_VERSION } from '../src/index.js';

test('blanket independent authorization covers exactly the retained 21 configurations, not removed games', () => {
  for (const variantKey of RETAINED_VARIANT_KEYS) {
    const approval = freezeIndependentApproval(variantKey);
    assert.equal(approval.variantKey, variantKey);
    assert.equal(approval.version, INDEPENDENT_APPROVAL_VERSION);
    assert.equal(approval.verification, 'implementation-and-tests-required');
    approval.variantKey = 'modified';
    assert.equal(freezeIndependentApproval(variantKey).variantKey, variantKey);
  }
  for (const key of ['2:0', '2:1', '3:0', '13:0', '17:0', '18:0', '101:0', '8:1']) {
    assert.throws(() => freezeIndependentApproval(key));
  }
});
