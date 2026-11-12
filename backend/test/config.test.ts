import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readFlag } from '../src/config.js';

describe('readFlag', () => {
  it('falls back when the variable is unset or empty', () => {
    assert.equal(readFlag('FEATURE_X', undefined, true), true);
    assert.equal(readFlag('FEATURE_X', ' ', false), false);
  });

  it('reads the usual on and off words', () => {
    assert.equal(readFlag('FEATURE_X', 'off', true), false);
    assert.equal(readFlag('FEATURE_X', 'FALSE', true), false);
    assert.equal(readFlag('FEATURE_X', 'on', false), true);
    assert.equal(readFlag('FEATURE_X', '1', false), true);
  });

  it('refuses a value it would have to guess', () => {
    assert.throws(() => readFlag('FEATURE_X', 'disabled', true), /Invalid FEATURE_X/);
  });
});
