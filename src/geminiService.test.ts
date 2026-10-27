/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearClientAdviceCache,
  clearClientSchoolCache,
  clearSchoolAdviceCache,
  getSchoolModeAdvice,
  makeGeminiCacheKey,
  schoolCache,
  serializeGeminiAdviceInputs,
  serializeSchoolAdviceInputs,
} from './geminiService.ts';

test('Client Cache Key: serializeSchoolAdviceInputs is canonical and order-independent', () => {
  const payloadA = {
    city: 'Dubai',
    activity: 'break',
    action: 'normal',
    hour: '10:00',
    temperature: 34,
    humidity: 45,
    pm10: 80,
  };

  const payloadB = {
    pm10: 80,
    humidity: 45,
    temperature: 34,
    hour: '10:00',
    action: 'normal',
    activity: 'break',
    city: 'Dubai',
  };

  const keyA = serializeSchoolAdviceInputs(payloadA);
  const keyB = serializeSchoolAdviceInputs(payloadB);
  assert.equal(keyA, keyB, 'Key order must not affect serialized output');
});

test('Client Cache Key: every prompt-relevant input alters the school-advice cache key', () => {
  const base = {
    city: 'Abu Dhabi',
    activity: 'break',
    hour: '11:00',
    action: 'normal',
    reason: 'Dust within threshold',
    heatIndex: 35,
    temperature: 33,
    humidity: 50,
    pm10: 70,
    dust: 55,
    windSpeed: 15,
    triggeredRules: [{ ruleId: 'R1', metric: 'pm10' }],
    levelNow: 'Moderate',
    peakLevel: 'Moderate',
    peakWindow: '11:00 - 13:00',
    confidence: 'High',
    lunchEnabled: false,
  };

  const baseKey = serializeSchoolAdviceInputs(base);

  // 1. Activity
  assert.notEqual(serializeSchoolAdviceInputs({ ...base, activity: 'pe' }), baseKey);
  // 2. Action
  assert.notEqual(serializeSchoolAdviceInputs({ ...base, action: 'shorten' }), baseKey);
  // 3. Peak window
  assert.notEqual(serializeSchoolAdviceInputs({ ...base, peakWindow: '14:00 - 16:00' }), baseKey);
  // 4. Temperature
  assert.notEqual(serializeSchoolAdviceInputs({ ...base, temperature: 40 }), baseKey);
  // 5. Humidity
  assert.notEqual(serializeSchoolAdviceInputs({ ...base, humidity: 75 }), baseKey);
  // 6. PM10
  assert.notEqual(serializeSchoolAdviceInputs({ ...base, pm10: 180 }), baseKey);
  // 7. Dust
  assert.notEqual(serializeSchoolAdviceInputs({ ...base, dust: 200 }), baseKey);
  // 8. Wind speed
  assert.notEqual(serializeSchoolAdviceInputs({ ...base, windSpeed: 30 }), baseKey);
  // 9. Heat index
  assert.notEqual(serializeSchoolAdviceInputs({ ...base, heatIndex: 42 }), baseKey);
  // 10. Triggered rules
  assert.notEqual(
    serializeSchoolAdviceInputs({
      ...base,
      triggeredRules: [{ ruleId: 'R2', metric: 'dust' }],
    }),
    baseKey
  );
  // 11. Hour
  assert.notEqual(serializeSchoolAdviceInputs({ ...base, hour: '12:00' }), baseKey);
  // 12. Reason
  assert.notEqual(serializeSchoolAdviceInputs({ ...base, reason: 'High dust' }), baseKey);
  // 13. Level now
  assert.notEqual(serializeSchoolAdviceInputs({ ...base, levelNow: 'High' }), baseKey);
  // 14. Peak level
  assert.notEqual(serializeSchoolAdviceInputs({ ...base, peakLevel: 'Very High' }), baseKey);
  // 15. Confidence
  assert.notEqual(serializeSchoolAdviceInputs({ ...base, confidence: 'Low' }), baseKey);
  // 17. PM2.5
  assert.notEqual(serializeSchoolAdviceInputs({ ...base, pm25: 35 }), baseKey);
  // 18. Visibility
  assert.notEqual(serializeSchoolAdviceInputs({ ...base, visibility: 5000 }), baseKey);
  // 19. Policy context
  assert.notEqual(serializeSchoolAdviceInputs({ ...base, policyContext: { version: '2.0' } }), baseKey);
  // 20. Wind
  assert.notEqual(serializeSchoolAdviceInputs({ ...base, wind: 30 }), baseKey);

  // Key order stability across nested objects inside array
  const permutedTriggeredRules = {
    ...base,
    triggeredRules: [{ metric: 'pm10', ruleId: 'R1' }],
  };
  assert.equal(
    serializeSchoolAdviceInputs(permutedTriggeredRules),
    baseKey,
    'Inner property order of nested array objects must not change cache key'
  );
});

test('Client Cache Key: general advice makeGeminiCacheKey and serializeGeminiAdviceInputs', () => {
  const objA = {
    city: 'Sharjah',
    levelNow: 'Low',
    peakLevel: 'Moderate',
    peakWindow: '08:00 - 11:00',
    confidence: 'Medium',
    topFactors: [{ name: 'PM10', value: 85, unit: 'µg/m³' }],
    dataSourceType: 'live',
  };

  const objB = {
    dataSourceType: 'live',
    topFactors: [{ name: 'PM10', value: 85, unit: 'µg/m³' }],
    confidence: 'Medium',
    peakWindow: '08:00 - 11:00',
    peakLevel: 'Moderate',
    levelNow: 'Low',
    city: 'Sharjah',
  };

  const keyA = serializeGeminiAdviceInputs(objA);
  const keyB = serializeGeminiAdviceInputs(objB);
  assert.equal(keyA, keyB, 'Key order must not affect general advice cache key');

  // Verify makeGeminiCacheKey with object parameter
  assert.equal(makeGeminiCacheKey(objA), keyA);

  // Field variations produce cache misses
  assert.notEqual(serializeGeminiAdviceInputs({ ...objA, city: 'Ajman' }), keyA);
  assert.notEqual(serializeGeminiAdviceInputs({ ...objA, levelNow: 'Moderate' }), keyA);
  assert.notEqual(serializeGeminiAdviceInputs({ ...objA, peakLevel: 'High' }), keyA);
  assert.notEqual(serializeGeminiAdviceInputs({ ...objA, peakWindow: '12:00 - 15:00' }), keyA);
  assert.notEqual(serializeGeminiAdviceInputs({ ...objA, confidence: 'High' }), keyA);
  assert.notEqual(serializeGeminiAdviceInputs({ ...objA, dataSourceType: 'sample' }), keyA);
  assert.notEqual(
    serializeGeminiAdviceInputs({ ...objA, topFactors: [{ name: 'Wind', value: 35, unit: 'km/h' }] }),
    keyA
  );
});

test('Missing Data Safety: getSchoolModeAdvice returns non-reassuring deterministic fallback without AI call', async () => {
  clearClientSchoolCache();

  // Case 1: dataMissingForAssessment is true
  const resMissing = await getSchoolModeAdvice(
    'Dubai',
    'break',
    '10:00',
    {
      recommendedAction: 'normal',
      actionTitle: 'Assessment unavailable: required data is missing',
      primaryGuidance:
        'Review the applicable school policy. Some environmental readings are unavailable and cannot be verified against school thresholds.',
      reason: 'One or more required inputs are missing.',
      triggeredRules: [],
      dataMissingForAssessment: true,
      isPolicyConfigured: true,
    },
    {
      temperature: null,
      relativeHumidity: null,
      heatIndex: { heatIndexCelsius: null, category: 'not applicable' },
      pm10: null,
      dust: null,
      windSpeed: null,
    }
  );

  assert.equal(resMissing.isAI, false, 'Must not call Gemini AI when critical data is missing');
  assert.ok(
    resMissing.summary.includes('unavailable') || resMissing.summary.includes('missing'),
    'Must return deterministic missing-data guidance'
  );
  assert.ok(
    !resMissing.summary.toLowerCase().includes('safe') && !resMissing.summary.toLowerCase().includes('clear'),
    'Must not produce reassuring safe status when data is missing'
  );

  // Case 2: unconfigured policy
  const resUnconfigured = await getSchoolModeAdvice(
    'Dubai',
    'break',
    '10:00',
    {
      recommendedAction: 'normal',
      actionTitle: 'School policy configuration required',
      primaryGuidance: 'Review the applicable school policy. Authorized school thresholds have not been configured yet.',
      reason: 'No approved school rules configured for this activity.',
      triggeredRules: [],
      dataMissingForAssessment: false,
      isPolicyConfigured: false,
    },
    {
      temperature: 30,
      relativeHumidity: 40,
      heatIndex: { heatIndexCelsius: 31, category: 'Caution' },
      pm10: 50,
      dust: 30,
      windSpeed: 12,
    }
  );

  assert.equal(resUnconfigured.isAI, false, 'Must not call AI when policy is unconfigured');
  assert.ok(
    resUnconfigured.summary.toLowerCase().includes('configured') ||
      resUnconfigured.summary.toLowerCase().includes('policy'),
    'Must indicate policy configuration is required/unconfigured'
  );
});

test('Client School Cache: hit, miss on input changes, failure isolation, and clearing helpers', async () => {
  clearClientSchoolCache();
  assert.equal(schoolCache.size(), 0);

  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  let shouldFail = false;

  const validAssessment = {
    recommendedAction: 'normal',
    actionTitle: 'Outdoor break permitted',
    primaryGuidance: 'Outdoor conditions are within policy thresholds.',
    reason: 'Readings are within limits.',
    triggeredRules: [],
    dataMissingForAssessment: false,
    isIncomplete: false,
    isPolicyConfigured: true,
    isFictionalDemo: false,
  };

  const validReadings = {
    temperature: 30,
    relativeHumidity: 40,
    heatIndex: { heatIndexCelsius: 31, category: 'Caution' },
    pm10: 50,
    dust: 30,
    windSpeed: 12,
  };

  const mockSummary = 'Outdoor air conditions remain within policy limits.';

  globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) => {
    fetchCount++;
    if (shouldFail) {
      return {
        ok: false,
        status: 500,
        json: async () => ({ ok: false, error: 'Server error' }),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { summary: mockSummary } }),
    } as Response;
  }) as typeof globalThis.fetch;

  try {
    // 1. Initial call fetches over network and caches
    const res1 = await getSchoolModeAdvice('Abu Dhabi', 'break', '09:00', validAssessment, validReadings);
    assert.equal(res1.isAI, true);
    assert.equal(res1.summary, mockSummary);
    assert.equal(fetchCount, 1);
    assert.equal(schoolCache.size(), 1);

    // 2. Identical request hits cache, does not fetch
    const res2 = await getSchoolModeAdvice('Abu Dhabi', 'break', '09:00', validAssessment, validReadings);
    assert.equal(res2.isAI, true);
    assert.equal(res2.summary, mockSummary);
    assert.equal(fetchCount, 1, 'Identical request must hit cache without incrementing fetch count');

    // 3. Cache miss when activity changes
    const res3 = await getSchoolModeAdvice('Abu Dhabi', 'pe', '09:00', validAssessment, validReadings);
    assert.equal(res3.isAI, true);
    assert.equal(fetchCount, 2, 'Activity change must fetch fresh advice');
    assert.equal(schoolCache.size(), 2);

    // 4. Cache miss when temperature changes
    const res4 = await getSchoolModeAdvice(
      'Abu Dhabi',
      'break',
      '09:00',
      validAssessment,
      { ...validReadings, temperature: 38 }
    );
    assert.equal(res4.isAI, true);
    assert.equal(fetchCount, 3, 'Temperature change must fetch fresh advice');

    // 5. Failures do not cache fallback
    shouldFail = true;
    const resFail = await getSchoolModeAdvice(
      'Abu Dhabi',
      'break',
      '10:00',
      validAssessment,
      validReadings
    );
    assert.equal(resFail.isAI, false, 'Failed request returns fallback');
    assert.equal(fetchCount, 4);

    // Recovery request after failure must fetch again
    shouldFail = false;
    const resRecover = await getSchoolModeAdvice(
      'Abu Dhabi',
      '10:00' as any,
      '10:00',
      validAssessment,
      validReadings
    );
    assert.equal(resRecover.isAI, true);
    assert.equal(fetchCount, 5, 'Subsequent request must fetch and not return cached failure');

    // 6. Test cache clear helpers
    clearSchoolAdviceCache();
    assert.equal(schoolCache.size(), 0, 'clearSchoolAdviceCache must empty schoolCache');

    clearClientSchoolCache();
    assert.equal(schoolCache.size(), 0, 'clearClientSchoolCache must empty schoolCache');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
