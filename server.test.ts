/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import {
  createApp,
  clearSchoolAdviceCache,
  clearClientSchoolCache,
  schoolAdviceCache,
  serializeSchoolAdviceInputs,
  makeSchoolAdviceCacheKey,
  clearAdviceCache,
  clearClientAdviceCache,
  adviceCache,
  serializeGeminiAdviceInputs,
  makeGeminiCacheKey,
  hasUnsupportedSafetyClaims,
} from './server.ts';

// Helper to start an ephemeral test server without polluting port 3000
function startTestServer(app: ReturnType<typeof createApp>): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

test('Lifecycle & Import: importing server does not start listener and provides app factory', () => {
  const app = createApp({ enableRateLimit: false });
  assert.ok(app, 'createApp returns an Express app instance');
  assert.equal(typeof app.listen, 'function');
  assert.equal(typeof clearSchoolAdviceCache, 'function');
});

test('serializeSchoolAdviceInputs produces canonical order-independent serialization including nested objects and arrays', () => {
  const obj1 = {
    city: 'Dubai',
    activity: 'break',
    action: 'normal',
    temperature: 35,
    humidity: 50,
    triggeredRules: [{ id: 'R1', metric: 'pm10' }, { id: 'R2', metric: 'dust' }],
    policyContext: { version: '1.0', schoolName: 'Al Noor' },
  };

  const obj2 = {
    humidity: 50,
    policyContext: { schoolName: 'Al Noor', version: '1.0' },
    action: 'normal',
    triggeredRules: [{ metric: 'pm10', id: 'R1' }, { metric: 'dust', id: 'R2' }],
    city: 'Dubai',
    temperature: 35,
    activity: 'break',
  };

  const serialized1 = serializeSchoolAdviceInputs(obj1);
  const serialized2 = serializeSchoolAdviceInputs(obj2);

  assert.equal(serialized1, serialized2, 'Key ordering at both root and nested levels must produce identical key');
  assert.equal(makeSchoolAdviceCacheKey(obj1), serialized1);

  // Changing any field should change the key
  const modified = { ...obj1, temperature: 36 };
  assert.notEqual(serializeSchoolAdviceInputs(modified), serialized1);
});


test('School-advice endpoint: caching, cache isolation, input validation, and fallback', async (t) => {
  let geminiCallCount = 0;
  let lastGeneratedPrompt: string | null = null;
  let mockShouldFail = false;
  let mockGeneratedSummary = 'Dust levels are moderate and staff should maintain routine outdoor precautions.';

  const mockAiClient = {
    models: {
      generateContent: async (args: { contents: string }) => {
        geminiCallCount++;
        lastGeneratedPrompt = args.contents;
        if (mockShouldFail) {
          throw new Error('Simulated upstream Gemini error');
        }
        return {
          text: JSON.stringify({ summary: mockGeneratedSummary }),
        };
      },
    },
  };

  const app = createApp({ aiClient: mockAiClient, enableRateLimit: false });
  const { server, url } = await startTestServer(app);

  t.after(() => {
    server.close();
  });

  const basePayload = {
    city: 'Abu Dhabi',
    activity: 'break',
    action: 'normal',
    status: 'action_triggered',
    hour: '11:00',
    reason: 'Dust concentrations within acceptable thresholds',
    temperature: 32,
    humidity: 45,
    heatIndex: 34,
    pm10: 75,
    dust: 60,
    windSpeed: 15,
    triggeredRules: [{ id: 'HEAT_MODERATE', metric: 'heatIndex' }],
    levelNow: 'Moderate',
    peakLevel: 'Moderate',
    peakWindow: '11:00 - 13:00',
    confidence: 'High',
  };

  await t.test('Initial request executes generation and does not report cached', async () => {
    clearSchoolAdviceCache();
    geminiCallCount = 0;

    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(basePayload),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.summary, mockGeneratedSummary);
    assert.equal(body.cached, undefined, 'Cache miss should not return cached: true');
    assert.equal(geminiCallCount, 1, 'Gemini generator should be invoked once');
  });

  await t.test('Identical request hits cache, does not call generator, returns cached: true', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(basePayload),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.summary, mockGeneratedSummary);
    assert.equal(body.cached, true, 'Cache hit must return cached: true');
    assert.equal(geminiCallCount, 1, 'Generator count must remain 1');
  });

  await t.test('Cache miss when activity changes (break -> pe)', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, activity: 'pe' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined, 'Activity change must be a cache miss');
    assert.equal(geminiCallCount, 2, 'Generator must be called for new activity');
  });

  await t.test('Cache miss when action changes (normal -> shorten)', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, action: 'shorten' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined, 'Action change must be a cache miss');
    assert.equal(geminiCallCount, 3, 'Generator must be called for new action');
  });

  await t.test('Cache miss when peak window changes', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, peakWindow: '14:00 - 16:00' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined, 'Peak window change must be a cache miss');
    assert.equal(geminiCallCount, 4, 'Generator must be called for new peak window');
  });

  await t.test('Cache miss when temperature changes', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, temperature: 41 }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined, 'Temperature change must be a cache miss');
    assert.equal(geminiCallCount, 5, 'Generator must be called for new temperature');
  });

  await t.test('Cache miss when humidity changes', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, humidity: 75 }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined, 'Humidity change must be a cache miss');
    assert.equal(geminiCallCount, 6, 'Generator must be called for new humidity');
  });

  await t.test('Cache miss when dust reading changes', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, dust: 220 }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined, 'Dust change must be a cache miss');
    assert.equal(geminiCallCount, 7, 'Generator must be called for new dust reading');
  });

  await t.test('Cache miss when pm10 reading changes', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, pm10: 195 }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined, 'PM10 change must be a cache miss');
    assert.equal(geminiCallCount, 8, 'Generator must be called for new PM10 reading');
  });

  await t.test('Cache miss when windSpeed reading changes', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, windSpeed: 28 }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined, 'WindSpeed change must be a cache miss');
    assert.equal(geminiCallCount, 9, 'Generator must be called for new windSpeed reading');
  });

  await t.test('Cache miss when wind reading is changed via wind property', async () => {
    const payloadWithWind = { ...basePayload };
    delete (payloadWithWind as any).windSpeed;
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payloadWithWind, wind: 33 }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined, 'Wind reading change must be a cache miss');
    assert.equal(geminiCallCount, 10, 'Generator must be called for new wind reading');
  });

  await t.test('Cache miss when heatIndex reading changes', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, heatIndex: 42 }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined, 'HeatIndex change must be a cache miss');
    assert.equal(geminiCallCount, 11, 'Generator must be called for new heatIndex reading');
  });

  await t.test('Cache miss when triggeredRules change', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...basePayload,
        triggeredRules: [{ id: 'DUST_CRITICAL', metric: 'dust' }],
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined, 'Triggered rules change must be a cache miss');
    assert.equal(geminiCallCount, 12, 'Generator must be called for new triggered rules');
  });

  await t.test('Cache miss when confidence changes', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, confidence: 'Low' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined, 'Confidence change must be a cache miss');
    assert.equal(geminiCallCount, 13, 'Generator must be called for new confidence');
  });

  await t.test('Cache miss when levelNow changes', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, levelNow: 'High' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined, 'LevelNow change must be a cache miss');
    assert.equal(geminiCallCount, 14, 'Generator must be called for new levelNow');
  });

  await t.test('Cache miss when peakLevel changes', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, peakLevel: 'Very High' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined, 'PeakLevel change must be a cache miss');
    assert.equal(geminiCallCount, 15, 'Generator must be called for new peakLevel');
  });

  await t.test('Cache miss when hour changes', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, hour: '14:00' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined, 'Hour change must be a cache miss');
    assert.equal(geminiCallCount, 16, 'Generator must be called for new hour');
  });

  await t.test('Cache miss when reason changes', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, reason: 'Severe dust plume detected nearby' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined, 'Reason change must be a cache miss');
    assert.equal(geminiCallCount, 17, 'Generator must be called for new reason');
  });

  await t.test('Cache miss when lunchEnabled changes', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, lunchEnabled: true }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined, 'LunchEnabled change must be a cache miss');
    assert.equal(geminiCallCount, 18, 'Generator must be called for lunchEnabled');
  });

  await t.test('Cache miss when pm25 reading is supplied or changes', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, pm25: 35 }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined, 'PM2.5 change must be a cache miss');
    assert.equal(geminiCallCount, 19, 'Generator must be called for new pm25');
  });

  await t.test('Cache miss when visibility reading is supplied or changes', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, visibility: 4000 }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined, 'Visibility change must be a cache miss');
    assert.equal(geminiCallCount, 20, 'Generator must be called for new visibility');
  });

  await t.test('Cache miss when policyVersion or policyContext changes', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...basePayload,
        policyVersion: '2.0',
        policyContext: { schoolName: 'Al Noor', version: '2.0', strictMode: true },
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined, 'PolicyVersion and policyContext change must be a cache miss');
    assert.equal(geminiCallCount, 21, 'Generator must be called for new policyVersion');
  });

  await t.test('Nested key-order stability within policyContext and triggeredRules hits cache', async () => {
    const permutedPolicyPayload = {
      ...basePayload,
      policyContext: { strictMode: true, version: '2.0', schoolName: 'Al Noor' },
      policyVersion: '2.0',
    };

    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(permutedPolicyPayload),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, true, 'Permuted nested key order in policyContext must hit cache');
    assert.equal(geminiCallCount, 21, 'Generator count must NOT increment on nested key-order permutation');
  });

  await t.test('Identical request with scrambled nested and root keys hits cache and returns cached: true', async () => {
    const scrambledPayload = {
      windSpeed: 15,
      heatIndex: 34,
      triggeredRules: [{ metric: 'heatIndex', id: 'HEAT_MODERATE' }],
      humidity: 45,
      city: 'Abu Dhabi',
      peakWindow: '11:00 - 13:00',
      reason: 'Dust concentrations within acceptable thresholds',
      status: 'action_triggered',
      hour: '11:00',
      action: 'normal',
      confidence: 'High',
      temperature: 32,
      dust: 60,
      peakLevel: 'Moderate',
      activity: 'break',
      pm10: 75,
      levelNow: 'Moderate',
    };
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scrambledPayload),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, true, 'Scrambled key order must hit cache');
    assert.equal(geminiCallCount, 21, 'Generator count must NOT increment on key-order permutation');
  });

  await t.test('Cache clear helper resets the cache', async () => {
    clearSchoolAdviceCache();
    assert.equal(schoolAdviceCache.size(), 0);

    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(basePayload),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.cached, undefined, 'Should be a cache miss after clearing cache');
    assert.equal(geminiCallCount, 22);
  });

  await t.test('clearClientSchoolCache alias clears the exact cache used by the school endpoint', async () => {
    assert.equal(schoolAdviceCache.size(), 1);
    clearClientSchoolCache();
    assert.equal(schoolAdviceCache.size(), 0);

    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(basePayload),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.cached, undefined, 'Should be a cache miss after clearClientSchoolCache');
    assert.equal(geminiCallCount, 23);
  });

  await t.test('Validation rejects invalid activity with 400', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, activity: 'football_match' }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /Invalid activity/);
  });

  await t.test('Validation rejects invalid action with 400', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, action: 'postpone_until_tomorrow' }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /Invalid action/);
  });

  await t.test('Fallback behavior: upstream Gemini error returns 200 with fallback notice and is not cached', async () => {
    mockShouldFail = true;
    clearSchoolAdviceCache();

    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, city: 'Al Ain' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /AI summary unavailable, using rule guidance/);
    assert.equal(schoolAdviceCache.size(), 0, 'Failed response must not be placed in cache');

    mockShouldFail = false;

    // Subsequent identical request after recovery must call generator and succeed
    const recoverRes = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, city: 'Al Ain' }),
    });

    assert.equal(recoverRes.status, 200);
    const recoverBody = await recoverRes.json();
    assert.equal(recoverBody.ok, true);
    assert.equal(recoverBody.cached, undefined, 'Initial successful recovery should not report cached: true');
    assert.equal(schoolAdviceCache.size(), 1, 'Successful recovery is stored in cache');
  });

  await t.test('Output validation rejects summaries containing hallucinated digits', async () => {
    clearSchoolAdviceCache();
    mockGeneratedSummary = 'Dust levels will reach 999 micrograms today.';

    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...basePayload,
        city: 'Fujairah',
        // Note: 9 is not in Fujairah, 32, 45, 34, 75, 60, 15, or any basePayload fields
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    // Because 999 contains disallowed digit '9', validateSchoolSummary throws and fallback is returned
    assert.equal(body.ok, false);
    assert.match(body.error, /AI summary unavailable, using rule guidance/);

    // Reset summary
    mockGeneratedSummary = 'Dust levels are moderate and staff should maintain routine outdoor precautions.';
  });

  await t.test('Server gates when core reading is null, undefined, or Unavailable string', async () => {
    // null temperature
    const resNull = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, temperature: null }),
    });
    const bodyNull = await resNull.json();
    assert.equal(bodyNull.ok, false);
    assert.match(bodyNull.error, /core readings are missing or unavailable/);

    // 'Unavailable' string for pm10
    const resUnavail = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, pm10: 'Unavailable' }),
    });
    const bodyUnavail = await resUnavail.json();
    assert.equal(bodyUnavail.ok, false);
    assert.match(bodyUnavail.error, /core readings are missing or unavailable/);
  });

  await t.test('Server gates when core reading is non-finite (NaN, Infinity)', async () => {
    const resNan = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, temperature: 'NaN' }),
    });
    const bodyNan = await resNan.json();
    assert.equal(bodyNan.ok, false);
    assert.match(bodyNan.error, /core readings are missing or unavailable/);

    const resInf = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, dust: 'Infinity' }),
    });
    const bodyInf = await resInf.json();
    assert.equal(bodyInf.ok, false);
    assert.match(bodyInf.error, /core readings are missing or unavailable/);
  });

  await t.test('Server gates when action is non-normal (cancel) without triggered rules', async () => {
    const res = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...basePayload,
        action: 'cancel',
        triggeredRules: [],
      }),
    });
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /non-normal action requires triggered rules/);
  });

  await t.test('Priority 2: Server rejects criteria_met_no_actions without explicitly verified isPolicyConfigured: true (HTTP 400)', async () => {
    // Missing isPolicyConfigured
    const resMissing = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...basePayload,
        status: 'criteria_met_no_actions',
        action: 'normal',
        triggeredRules: [],
      }),
    });
    assert.equal(resMissing.status, 400);
    const bodyMissing = await resMissing.json();
    assert.equal(bodyMissing.ok, false);
    assert.match(bodyMissing.error, /requires explicitly verified isPolicyConfigured: true/);

    // isPolicyConfigured: false
    const resFalse = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...basePayload,
        status: 'criteria_met_no_actions',
        action: 'normal',
        triggeredRules: [],
        isPolicyConfigured: false,
      }),
    });
    assert.equal(resFalse.status, 400);
    const bodyFalse = await resFalse.json();
    assert.equal(bodyFalse.ok, false);
    assert.match(bodyFalse.error, /requires explicitly verified isPolicyConfigured: true/);
  });

  await t.test('Priority 2: Server rejects contradictory status/action combinations with HTTP 400', async () => {
    // criteria_met_no_actions with non-normal action
    const resActionMismatch = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...basePayload,
        status: 'criteria_met_no_actions',
        action: 'shorten',
        isPolicyConfigured: true,
        triggeredRules: [],
      }),
    });
    assert.equal(resActionMismatch.status, 400);
    const bodyAction = await resActionMismatch.json();
    assert.match(bodyAction.error, /cannot have non-normal action/);

    // criteria_met_no_actions with triggered rules
    const resRuleMismatch = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...basePayload,
        status: 'criteria_met_no_actions',
        action: 'normal',
        isPolicyConfigured: true,
        triggeredRules: [{ id: 'R1', metric: 'pm10' }],
      }),
    });
    assert.equal(resRuleMismatch.status, 400);
    const bodyRule = await resRuleMismatch.json();
    assert.match(bodyRule.error, /cannot have triggered rules/);

    // criteria_met_no_actions with isIncomplete: true
    const resIncompleteMismatch = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...basePayload,
        status: 'criteria_met_no_actions',
        action: 'normal',
        isPolicyConfigured: true,
        isIncomplete: true,
        triggeredRules: [],
      }),
    });
    assert.equal(resIncompleteMismatch.status, 400);
    const bodyIncomplete = await resIncompleteMismatch.json();
    assert.match(bodyIncomplete.error, /cannot have incomplete data/);

    // action_triggered with isPolicyConfigured: false
    const resActionUnconfigured = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...basePayload,
        status: 'action_triggered',
        action: 'shorten',
        isPolicyConfigured: false,
        triggeredRules: [{ id: 'R1', metric: 'pm10' }],
      }),
    });
    assert.equal(resActionUnconfigured.status, 400);
    const bodyActionUnconfig = await resActionUnconfigured.json();
    assert.match(bodyActionUnconfig.error, /action_triggered cannot have isPolicyConfigured: false/);

    // policy_unconfigured with isPolicyConfigured: true
    const resUnconfigContradiction = await fetch(`${url}/api/gemini/school-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...basePayload,
        status: 'policy_unconfigured',
        action: 'normal',
        isPolicyConfigured: true,
        triggeredRules: [],
      }),
    });
    assert.equal(resUnconfigContradiction.status, 400);
    const bodyUnconfig = await resUnconfigContradiction.json();
    assert.match(bodyUnconfig.error, /policy_unconfigured cannot have isPolicyConfigured: true/);
  });
});

test('General advice endpoint: caching, cache isolation across all prompt-affecting inputs, and fallback isolation', async (t) => {
  let geminiCallCount = 0;
  let mockShouldFail = false;
  let mockReturnedAdvice = {
    schools: 'Keep students hydrated and limit intense outdoor running.',
    workers: 'Provide dust masks and schedule mandatory water breaks.',
    families: 'Close windows and avoid strenuous outdoor exercise.',
  };

  const mockAiClient = {
    models: {
      generateContent: async () => {
        geminiCallCount++;
        if (mockShouldFail) {
          throw new Error('Simulated upstream Gemini quota or connection error');
        }
        return {
          text: JSON.stringify(mockReturnedAdvice),
        };
      },
    },
  };

  const app = createApp({ aiClient: mockAiClient, enableRateLimit: false });
  const { server, url } = await startTestServer(app);

  t.after(() => {
    server.close();
  });

  const basePayload = {
    city: 'Dubai',
    levelNow: 'Moderate',
    peakLevel: 'High',
    peakWindow: '13:00 - 15:00',
    confidence: 'High',
    topFactors: [
      { name: 'PM10 particulate', value: 180, unit: 'µg/m³', status: 'Elevated' },
      { name: 'Wind gusts', value: 45, unit: 'km/h', status: 'Moderate' },
    ],
    dataSourceType: 'live',
  };

  await t.test('serializeGeminiAdviceInputs canonical order-independent serialization', () => {
    const permuted = {
      dataSourceType: 'live',
      topFactors: basePayload.topFactors,
      peakWindow: '13:00 - 15:00',
      city: 'Dubai',
      confidence: 'High',
      peakLevel: 'High',
      levelNow: 'Moderate',
    };
    assert.equal(serializeGeminiAdviceInputs(basePayload), serializeGeminiAdviceInputs(permuted));
    assert.equal(makeGeminiCacheKey(basePayload), serializeGeminiAdviceInputs(basePayload));
  });

  await t.test('Initial request calls Gemini and does not return cached: true', async () => {
    clearAdviceCache();
    geminiCallCount = 0;

    const res = await fetch(`${url}/api/gemini/advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(basePayload),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.data, mockReturnedAdvice);
    assert.equal(body.cached, undefined);
    assert.equal(geminiCallCount, 1);
  });

  await t.test('Identical request reuses cache and returns cached: true', async () => {
    const res = await fetch(`${url}/api/gemini/advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(basePayload),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, true);
    assert.equal(geminiCallCount, 1, 'Generator count must stay 1 on cache hit');
  });

  await t.test('Cache miss when city changes', async () => {
    const res = await fetch(`${url}/api/gemini/advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, city: 'Sharjah' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined);
    assert.equal(geminiCallCount, 2);
  });

  await t.test('Cache miss when levelNow changes', async () => {
    const res = await fetch(`${url}/api/gemini/advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, levelNow: 'Low' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined);
    assert.equal(geminiCallCount, 3);
  });

  await t.test('Cache miss when peakLevel changes', async () => {
    const res = await fetch(`${url}/api/gemini/advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, peakLevel: 'Very High' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined);
    assert.equal(geminiCallCount, 4);
  });

  await t.test('Cache miss when peakWindow changes', async () => {
    const res = await fetch(`${url}/api/gemini/advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, peakWindow: '16:00 - 18:00' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined);
    assert.equal(geminiCallCount, 5);
  });

  await t.test('Cache miss when confidence changes', async () => {
    const res = await fetch(`${url}/api/gemini/advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, confidence: 'Medium' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined);
    assert.equal(geminiCallCount, 6);
  });

  await t.test('Cache miss when topFactors change (values or factors)', async () => {
    const res = await fetch(`${url}/api/gemini/advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...basePayload,
        topFactors: [
          { name: 'PM10 particulate', value: 310, unit: 'µg/m³', status: 'Severe' },
          { name: 'Wind gusts', value: 65, unit: 'km/h', status: 'High' },
        ],
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined);
    assert.equal(geminiCallCount, 7);
  });

  await t.test('Cache miss when dataSourceType changes', async () => {
    const res = await fetch(`${url}/api/gemini/advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...basePayload, dataSourceType: 'demo' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, undefined);
    assert.equal(geminiCallCount, 8);
  });

  await t.test('Upstream errors are not cached, allowing subsequent request to succeed', async () => {
    clearAdviceCache();
    mockShouldFail = true;

    // Failing request
    const failRes = await fetch(`${url}/api/gemini/advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(basePayload),
    });

    assert.equal(failRes.status, 200);
    const failBody = await failRes.json();
    assert.equal(failBody.ok, false);
    assert.match(failBody.error, /fallback/);
    assert.equal(adviceCache.size(), 0, 'Cache must not store failed responses');

    // Recovery request
    mockShouldFail = false;
    const recoverRes = await fetch(`${url}/api/gemini/advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(basePayload),
    });

    assert.equal(recoverRes.status, 200);
    const recoverBody = await recoverRes.json();
    assert.equal(recoverBody.ok, true);
    assert.deepEqual(recoverBody.data, mockReturnedAdvice);
    assert.equal(recoverBody.cached, undefined);
    assert.equal(adviceCache.size(), 1, 'Cache stores successful response upon recovery');
  });
});

test('Safety Assurance Validation: unsupported safety claims are rejected without rejecting cautious qualified wording', async (t) => {
  await t.test('hasUnsupportedSafetyClaims identifies overclaims and absolute safety assurances', () => {
    const overclaims = [
      'Conditions are safe for all outdoor play.',
      'The air is completely safe today.',
      'This activity is officially approved by local authorities.',
      'Approved for all outdoor activities without restrictions.',
      'There is zero risk of heat illness today.',
      'It is safe to proceed without precautions.',
      'The environment is entirely safe today.',
      'Outdoor activities are safe today.',
    ];

    for (const claim of overclaims) {
      assert.equal(hasUnsupportedSafetyClaims(claim), true, `Expected overclaim to be detected: "${claim}"`);
    }
  });

  await t.test('hasUnsupportedSafetyClaims does not flag cautious, qualified guidance', () => {
    const qualifiedStatements = [
      'Dust levels are moderate and staff should maintain routine outdoor precautions.',
      'Outdoor activities should proceed with caution and frequent water breaks.',
      'Conditions remain within normal thresholds for physical education.',
      'Check official UAE NCM announcements for national weather warnings.',
      'Take precautions for students sensitive to dust or heat.',
      'Air quality is unhealthy for sensitive groups; limit strenuous outdoor exercise.',
      'Standard safety procedures should be observed during all outdoor sessions.',
      'Estimated risk is low, but staff should monitor changing wind conditions.',
    ];

    for (const statement of qualifiedStatements) {
      assert.equal(
        hasUnsupportedSafetyClaims(statement),
        false,
        `Expected qualified statement NOT to be flagged: "${statement}"`
      );
    }
  });

  await t.test('School advice endpoint rejects overclaims from AI and does not cache them', async () => {
    let mockSummary = 'Conditions are completely safe.';
    const mockAiClient = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({ summary: mockSummary }),
        }),
      },
    };

    const app = createApp({ aiClient: mockAiClient, enableRateLimit: false });
    const { server, url } = await startTestServer(app);

    try {
      clearSchoolAdviceCache();
      const basePayload = {
        city: 'Abu Dhabi',
        activity: 'break',
        hour: '10:00',
        action: 'normal',
        status: 'criteria_met_no_actions',
        reason: 'Within thresholds',
        heatIndex: 32,
        temperature: 30,
        humidity: 40,
        pm10: 50,
        dust: 40,
        windSpeed: 15,
        isPolicyConfigured: true,
        isFictionalDemo: false,
      };

      // 1. Overclaim should fail validation and fall back
      const res = await fetch(`${url}/api/gemini/school-advice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(basePayload),
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.match(body.error, /AI summary unavailable, using rule guidance/);
      assert.equal(schoolAdviceCache.size(), 0, 'Rejected overclaim must not be cached');

      // 2. Cautious qualified wording succeeds and is cached
      mockSummary = 'Conditions are moderate and staff should maintain routine outdoor precautions.';
      const resPass = await fetch(`${url}/api/gemini/school-advice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(basePayload),
      });

      assert.equal(resPass.status, 200);
      const bodyPass = await resPass.json();
      assert.equal(bodyPass.ok, true);
      assert.equal(bodyPass.data.summary, mockSummary);
      assert.equal(schoolAdviceCache.size(), 1, 'Valid cautious advice is cached');
    } finally {
      server.close();
    }
  });
});

