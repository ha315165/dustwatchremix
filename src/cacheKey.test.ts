/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deterministicNormalize,
  deterministicSerialize,
  makeGeminiCacheKey,
  makeSchoolAdviceCacheKey,
  serializeGeminiAdviceInputs,
  serializeSchoolAdviceInputs,
} from './cacheKey.ts';

test('deterministicNormalize: handles primitives and special number values', () => {
  assert.equal(deterministicNormalize('text'), 'text');
  assert.equal(deterministicNormalize(42), 42);
  assert.equal(deterministicNormalize(true), true);
  assert.equal(deterministicNormalize(false), false);
  assert.equal(deterministicNormalize(null), null);
  assert.equal(deterministicNormalize(undefined), undefined);
  assert.equal(deterministicNormalize(NaN), null);
  assert.equal(deterministicNormalize(Infinity), null);
  assert.equal(deterministicNormalize(-Infinity), null);
});

test('deterministicSerialize: produces deterministic output for nested objects and arrays', () => {
  const deep1 = {
    z: { b: 2, a: 1 },
    a: [
      { beta: 'B', alpha: 'A' },
      { delta: { two: 2, one: 1 }, gamma: 3 },
    ],
  };

  const deep2 = {
    a: [
      { alpha: 'A', beta: 'B' },
      { gamma: 3, delta: { one: 1, two: 2 } },
    ],
    z: { a: 1, b: 2 },
  };

  const str1 = deterministicSerialize(deep1);
  const str2 = deterministicSerialize(deep2);
  assert.equal(str1, str2, 'Nested keys at all levels must sort canonically');

  // Verify undefined fields are omitted
  const withUndefined = { ...deep1, ignored: undefined };
  assert.equal(deterministicSerialize(withUndefined), str1);
});

test('serializeSchoolAdviceInputs & makeSchoolAdviceCacheKey', () => {
  const p1 = {
    city: 'Dubai',
    activity: 'break',
    readings: { temp: 35, hum: 40 },
    triggeredRules: [{ id: 'R1', metric: 'dust' }],
  };
  const p2 = {
    activity: 'break',
    triggeredRules: [{ metric: 'dust', id: 'R1' }],
    readings: { hum: 40, temp: 35 },
    city: 'Dubai',
  };

  assert.equal(serializeSchoolAdviceInputs(p1), serializeSchoolAdviceInputs(p2));
  assert.equal(makeSchoolAdviceCacheKey(p1), serializeSchoolAdviceInputs(p1));
});

test('serializeGeminiAdviceInputs & makeGeminiCacheKey', () => {
  const p1 = {
    city: 'Abu Dhabi',
    peakLevel: 'High',
    topFactors: [{ name: 'PM10', value: 120 }],
  };
  const p2 = {
    topFactors: [{ name: 'PM10', value: 120 }],
    city: 'Abu Dhabi',
    peakLevel: 'High',
  };

  assert.equal(serializeGeminiAdviceInputs(p1), serializeGeminiAdviceInputs(p2));
  assert.equal(makeGeminiCacheKey(p1), serializeGeminiAdviceInputs(p1));
});
