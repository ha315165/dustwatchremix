/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extract12Hours,
  processCityOutlook,
  exportSnapshotJson,
  importSnapshotJson,
} from './dataService.ts';
import { CITIES } from './config.ts';
import { RawCityData } from './types.ts';
import { createSyntheticSampleData } from './sampleData.ts';

const testCity = CITIES[0]; // Abu Dhabi

function makeMockRawCityData(options: {
  wxTimes: string[];
  aqTimes: string[];
  tempValues?: number[];
  pm10Values?: number[];
}): RawCityData {
  return {
    city: testCity,
    fetchTimestamp: Date.now(),
    isSampleOrSnapshot: false,
    weather: {
      latitude: testCity.latitude,
      longitude: testCity.longitude,
      timezone: 'Asia/Dubai',
      hourly: {
        time: options.wxTimes,
        temperature_2m: options.tempValues ?? options.wxTimes.map((_, i) => 25 + i),
        relative_humidity_2m: options.wxTimes.map(() => 50),
        wind_speed_10m: options.wxTimes.map(() => 15),
        wind_gusts_10m: options.wxTimes.map(() => 25),
        wind_direction_10m: options.wxTimes.map(() => 180),
        visibility: options.wxTimes.map(() => 9000),
      },
    },
    airQuality: {
      latitude: testCity.latitude,
      longitude: testCity.longitude,
      timezone: 'Asia/Dubai',
      hourly: {
        time: options.aqTimes,
        pm10: options.pm10Values ?? options.aqTimes.map((_, i) => 80 + i),
        pm2_5: options.aqTimes.map(() => 30),
        dust: options.aqTimes.map(() => 45),
        aerosol_optical_depth: options.aqTimes.map(() => 0.3),
      },
    },
  };
}

test('Priority 1: extract12Hours returns null when current Dubai hour cannot be matched (does NOT default to index 0)', () => {
  // 24 hours of data for 2026-10-15
  const times = Array.from({ length: 24 }, (_, i) => `2026-10-15T${String(i).padStart(2, '0')}:00`);
  const rawCity = makeMockRawCityData({ wxTimes: times, aqTimes: times });

  // Querying for a completely different date / hour in 2030
  const result = extract12Hours(rawCity, '2030-01-01T12:00');
  assert.strictEqual(result, null, 'Must return null and NOT default to index 0 when current hour is missing');
});

test('Priority 1: extract12Hours returns null when fewer than 12 consecutive hours remain (does NOT pad with earlier hours)', () => {
  // 24 hours of data for 2026-10-15 (00:00 to 23:00)
  const times = Array.from({ length: 24 }, (_, i) => `2026-10-15T${String(i).padStart(2, '0')}:00`);
  const rawCity = makeMockRawCityData({ wxTimes: times, aqTimes: times });

  // Querying hour 18:00 -> only 6 hours remain (18, 19, 20, 21, 22, 23)
  const result = extract12Hours(rawCity, '2026-10-15T18:00');
  assert.strictEqual(result, null, 'Must return null and NOT pad with earlier hours when fewer than 12 hours remain');

  // Querying hour 12:00 -> exactly 12 hours remain (12 to 23)
  const validResult = extract12Hours(rawCity, '2026-10-15T12:00');
  assert.ok(validResult !== null, 'Should succeed when exactly 12 hours remain');
  assert.strictEqual(validResult.length, 12);
  assert.strictEqual(validResult[0].time, '2026-10-15T12:00');
  assert.strictEqual(validResult[11].time, '2026-10-15T23:00');
});

test('Priority 1: extract12Hours aligns weather and air-quality readings strictly by timestamp', () => {
  // Construct mismatched timestamps:
  // Weather starts at 06:00 to 23:00 (18 hours)
  // Air quality starts at 08:00 to 23:00 (16 hours)
  const wxTimes = Array.from({ length: 18 }, (_, i) => `2026-10-15T${String(i + 6).padStart(2, '0')}:00`);
  const aqTimes = Array.from({ length: 16 }, (_, i) => `2026-10-15T${String(i + 8).padStart(2, '0')}:00`);

  const tempValues = wxTimes.map((_, i) => 20 + i); // 20, 21, ...
  const pm10Values = aqTimes.map((_, i) => 100 + i); // 100, 101, ...

  const rawCity = makeMockRawCityData({ wxTimes, aqTimes, tempValues, pm10Values });

  // Current hour is 08:00 -> 16 hours remain until 23:00, plenty for 12 hours
  const result = extract12Hours(rawCity, '2026-10-15T08:00');
  assert.ok(result !== null);
  assert.strictEqual(result.length, 12);

  // Hour 08:00:
  // wxTimes index 2 (since starts at 06) -> temp = 20 + 2 = 22
  // aqTimes index 0 (since starts at 08) -> pm10 = 100 + 0 = 100
  assert.strictEqual(result[0].time, '2026-10-15T08:00');
  assert.strictEqual(result[0].temperature_2m, 22);
  assert.strictEqual(result[0].pm10, 100);

  // If we query 06:00 (where air quality is missing for 06:00 and 07:00):
  const resultFrom06 = extract12Hours(rawCity, '2026-10-15T06:00');
  assert.ok(resultFrom06 !== null);
  assert.strictEqual(resultFrom06[0].time, '2026-10-15T06:00');
  assert.strictEqual(resultFrom06[0].temperature_2m, 20);
  assert.strictEqual(resultFrom06[0].pm10, null, 'pm10 should be null when timestamp is missing in air-quality feed');
  assert.strictEqual(resultFrom06[2].time, '2026-10-15T08:00');
  assert.strictEqual(resultFrom06[2].temperature_2m, 22);
  assert.strictEqual(resultFrom06[2].pm10, 100);
});

test('Priority 1: processCityOutlook returns explicit unavailable error state when forecast window cannot be established', () => {
  const times = Array.from({ length: 5 }, (_, i) => `2026-10-15T${String(i).padStart(2, '0')}:00`);
  const rawCity = makeMockRawCityData({ wxTimes: times, aqTimes: times });

  // Missing current hour
  const outlookMissingHour = processCityOutlook(rawCity, null, '2026-10-15T12:00', '2026-10-15 12:00 GST');
  assert.strictEqual(outlookMissingHour.isUnavailable, true);
  assert.strictEqual(outlookMissingHour.confidence, 'Low');
  assert.ok(outlookMissingHour.unavailableReason?.includes('cannot be established'));
  assert.strictEqual(outlookMissingHour.hourlyResults.length, 0);

  // Short window
  const outlookShort = processCityOutlook(rawCity, null, '2026-10-15T02:00', '2026-10-15 02:00 GST');
  assert.strictEqual(outlookShort.isUnavailable, true);
  assert.ok(outlookShort.unavailableReason?.includes('cannot be established'));
});

test('Priority 4: snapshot provenance propagation and synthetic labeling', () => {
  const sampleData = createSyntheticSampleData();
  const exportedJson = exportSnapshotJson(sampleData);
  const parsedJson = JSON.parse(exportedJson);

  assert.strictEqual(parsedJson.isSynthetic, true, 'Exported snapshot from sample data must be labeled isSynthetic: true');

  const importRes = importSnapshotJson(exportedJson);
  assert.strictEqual(importRes.success, true);
  assert.strictEqual(importRes.isSynthetic, true, 'Imported snapshot must preserve isSynthetic: true');
});
