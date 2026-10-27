/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  HINDCAST_PROVENANCE_LABEL,
  SYNTHETIC_HINDCAST_LABEL,
  buildHourlyPredictions,
  evaluateNurseComparison,
  evaluatePredictionsAgainstEvents,
  fetchHindcastData,
  generateSyntheticHindcastData,
  getNurseLogTemplateCsv,
  parseEventLogCsv,
  parseNurseLogCsv,
} from './backtestService.ts';
import { APP_CONFIG, CITIES } from './config.ts';
import { DEFAULT_UNCONFIGURED_POLICY, FICTIONAL_DEMO_POLICY } from './schoolPolicy.ts';
import { ModelFileConfig, SchoolPolicyConfig } from './types.ts';
import { parseAndEvaluateCsv } from './evaluation.ts';
import { exportSnapshotJson, importSnapshotJson } from './dataService.ts';

test('Backtest: generates synthetic hindcast data and drops first 12 hours for persistence', () => {
  const hindcastData = generateSyntheticHindcastData(2, CITIES.slice(0, 2));
  const predictions = buildHourlyPredictions(hindcastData, null);

  assert.ok(predictions.length > 0, 'Should generate predictions');
  
  // Every prediction must have persistence_level defined because first 12 were dropped
  for (const p of predictions) {
    assert.ok(p.persistence_level !== undefined, 'Persistence level must exist');
    assert.strictEqual(typeof p.baseline_score, 'number');
    assert.strictEqual(p.model_level, '', 'Model level should be blank when no model loaded');
  }
});

test('Backtest: Event log parser checks independence and flags model_forecast/CAMS', () => {
  const csv = [
    'city,start,end,evidence_type,source_name,source_link,notes',
    'Abu Dhabi,2026-10-10T10:00,2026-10-10T16:00,observation_report,Ground Station,https://example.com,real observation',
    'Dubai,2026-10-10T12:00,2026-10-10T18:00,model_forecast,Open-Meteo CAMS forecast,https://open-meteo.com,model based',
  ].join('\n');

  // Default: exclude non-independent
  const resDefault = parseEventLogCsv(csv, false);
  assert.strictEqual(resDefault.success, true);
  assert.strictEqual(resDefault.nonIndependentCount, 1, 'Should flag 1 non-independent event');
  assert.strictEqual(resDefault.events.length, 1, 'Should exclude non-independent event by default');
  assert.strictEqual(resDefault.events[0].city, 'Abu Dhabi');

  // When includeNonIndependent is true
  const resIncluded = parseEventLogCsv(csv, true);
  assert.strictEqual(resIncluded.events.length, 2, 'Should include both events when allowed');
  assert.strictEqual(resIncluded.circularityWarningTriggered, true, 'Should trigger circularity warning');
});

test('Backtest: Hours outside searched period or cities are excluded', () => {
  const hindcastData = generateSyntheticHindcastData(5, CITIES.slice(0, 2));
  const predictions = buildHourlyPredictions(hindcastData, null);

  const city0Name = CITIES[0].name;
  const searchStart = predictions[2].timestamp;
  const searchEnd = predictions[10].timestamp;

  const result = evaluatePredictionsAgainstEvents({
    predictions,
    events: [],
    searchedPeriod: { start: searchStart, end: searchEnd },
    searchedCities: [city0Name],
    daysRequested: 5,
    activeModel: null,
  });

  assert.ok(result.evaluatedRows.length > 0);
  for (const r of result.evaluatedRows) {
    assert.strictEqual(r.city, city0Name, 'Only searched city should be evaluated');
    assert.ok(r.timestamp >= searchStart && r.timestamp <= searchEnd, 'Only searched period evaluated');
  }
  assert.ok(result.metadata.hoursExcluded > 0, 'Hours outside search window must be excluded');
  assert.strictEqual(result.metadata.hindcastLabel, SYNTHETIC_HINDCAST_LABEL);
  assert.strictEqual(result.isSynthetic, true, 'Synthetic predictions must be labeled as synthetic');
});

test('Backtest: Event detection, lead time, and false alarm episodes', () => {
  const hindcastData = generateSyntheticHindcastData(4, [CITIES[0]]);
  const predictions = buildHourlyPredictions(hindcastData, null);

  const evtStart = predictions[5].timestamp;
  const evtEnd = predictions[8].timestamp;

  const eventObj = {
    id: 'evt-1',
    rowNumber: 2,
    city: CITIES[0].name,
    start: evtStart,
    end: evtEnd,
    evidence_type: 'observation_report' as const,
    source_name: 'Airport Metar',
    source_link: 'https://metar.com',
    notes: 'Sandstorm',
    isIndependent: true,
  };

  const result = evaluatePredictionsAgainstEvents({
    predictions,
    events: [eventObj],
    searchedPeriod: { start: predictions[0].timestamp, end: predictions[predictions.length - 1].timestamp },
    searchedCities: [CITIES[0].name],
    daysRequested: 4,
    activeModel: null,
  });

  assert.strictEqual(result.hasEnoughEvents, false, 'Less than 10 events should flag too few events');
  assert.strictEqual(result.eventSummaries.length, 1);
  assert.ok(result.csvText.includes('observed_event'));
});

test('Part B Nurse Comparison: Stops with "School policy not loaded" if policy is unconfigured or demo', () => {
  const hindcastData = generateSyntheticHindcastData(3, [CITIES[0]]);
  const sampleNurseCsv = [
    'date,hour,activity,nurse_action',
    '2026-10-10,10,break,normal',
  ].join('\n');
  const parseRes = parseNurseLogCsv(sampleNurseCsv);
  assert.strictEqual(parseRes.success, true);

  // 1. Unconfigured policy
  const unconfiguredEval = evaluateNurseComparison({
    nurseRows: parseRes.rows,
    schoolPolicy: DEFAULT_UNCONFIGURED_POLICY,
    rawCityData: hindcastData,
    schoolCityId: CITIES[0].id,
  });
  assert.strictEqual(unconfiguredEval.success, false);
  assert.strictEqual(unconfiguredEval.error, 'School policy not loaded');

  // 2. Demo fictional policy (must NEVER be used for comparison)
  const demoEval = evaluateNurseComparison({
    nurseRows: parseRes.rows,
    schoolPolicy: FICTIONAL_DEMO_POLICY,
    rawCityData: hindcastData,
    schoolCityId: CITIES[0].id,
  });
  assert.strictEqual(demoEval.success, false);
  assert.strictEqual(demoEval.error, 'School policy not loaded');
});

test('Part B Nurse Comparison: Evaluates agreement with configured official policy', () => {
  const hindcastData = generateSyntheticHindcastData(3, [CITIES[0]]);
  const cityData = hindcastData[CITIES[0].id];
  const firstTime = cityData.weather.hourly.time[14];
  const [datePart, hourPart] = firstTime.split('T');
  const hourNum = parseInt(hourPart.split(':')[0], 10);

  // Valid configured school policy (not demo)
  const officialPolicy: SchoolPolicyConfig = {
    isConfigured: true,
    isFictionalDemo: false,
    schoolName: 'Al Nahda Academy',
    policyVersion: '2.1',
    effectiveDate: '2026-09-01',
    approvedBy: 'Principal & Health Lead',
    sourceDocument: 'School Operations Handbook 2026',
    precedenceOrder: ['suspend', 'indoor_only', 'modified', 'normal'],
    rules: [
      {
        id: 'pm10-mod',
        name: 'Moderate Particulate Warning',
        activity: 'all',
        metric: 'pm10',
        operator: '>=',
        threshold: 100,
        unit: 'µg/m³',
        recommendedAction: 'modified',
        actionTitle: 'Shorten outdoor play',
        actionGuidance: 'Reduce strenuous outdoor exertion.',
        reason: 'PM10 high',
        severity: 1,
      },
    ],
  };

  const nurseRows = [
    { rowNumber: 2, date: datePart, hour: hourNum, activity: 'break' as const, nurse_action: 'normal' as const },
    { rowNumber: 3, date: '2020-01-01', hour: 10, activity: 'pe' as const, nurse_action: 'cancel' as const },
  ];

  const evalRes = evaluateNurseComparison({
    nurseRows,
    schoolPolicy: officialPolicy,
    rawCityData: hindcastData,
    schoolCityId: CITIES[0].id,
  });

  assert.strictEqual(evalRes.success, true);
  assert.ok(evalRes.summary);
  assert.strictEqual(evalRes.summary.totalRows, 2);
  assert.strictEqual(evalRes.summary.outsideDataCount, 1, '2020-01-01 should be outside available data');
  assert.strictEqual(evalRes.summary.evaluatedCount, 1);
  assert.ok(evalRes.summary.note.includes('Differences can come from model data versus the nurses'));
});

test('Part B Nurse Comparison: Missing selected-city data fails cleanly without falling back to default city', () => {
  const hindcastData = generateSyntheticHindcastData(3, [CITIES[0]]); // Abu Dhabi loaded
  const nurseRows = [
    { rowNumber: 2, date: '2026-10-10', hour: 10, activity: 'break' as const, nurse_action: 'normal' as const },
  ];

  const officialPolicy: SchoolPolicyConfig = {
    isConfigured: true,
    isFictionalDemo: false,
    schoolName: 'Al Ain Campus Academy',
    policyVersion: '1.0',
    effectiveDate: '2026-09-01',
    precedenceOrder: ['suspend', 'indoor_only', 'modified', 'normal'],
    rules: [
      {
        id: 'r1',
        name: 'Heat rule',
        activity: 'break',
        metric: 'heat_index',
        operator: '>=',
        threshold: 38,
        unit: '°C',
        recommendedAction: 'modified',
        actionTitle: 'Shorten outdoor play',
        actionGuidance: 'Reduce exertion under high heat.',
        reason: 'Heat index >= 38',
        severity: 1,
      },
    ],
  };

  // Asking for 'al-ain' when only Abu Dhabi is loaded
  const evalRes = evaluateNurseComparison({
    nurseRows,
    schoolPolicy: officialPolicy,
    rawCityData: hindcastData,
    schoolCityId: 'al-ain',
  });

  assert.strictEqual(evalRes.success, false);
  assert.ok(evalRes.error?.includes('al-ain'));
  assert.ok(evalRes.error?.includes('Cannot substitute another city'));
});

test('Part B Nurse Comparison: Excludes no_applicable_rules, unavailable, and incomplete rows from evaluatedCount and reconciles total', () => {
  const hindcastData = generateSyntheticHindcastData(3, [CITIES[0]]);
  const cityData = hindcastData[CITIES[0].id];
  const firstTime = cityData.weather.hourly.time[14];
  const [datePart, hourPart] = firstTime.split('T');
  const hourNum = parseInt(hourPart.split(':')[0], 10);

  const secondTime = cityData.weather.hourly.time[15];
  const [datePart2, hourPart2] = secondTime.split('T');
  const hourNum2 = parseInt(hourPart2.split(':')[0], 10);

  const thirdTime = cityData.weather.hourly.time[16];
  const [datePart3, hourPart3] = thirdTime.split('T');
  const hourNum3 = parseInt(hourPart3.split(':')[0], 10);

  // Policy with ONLY rules for PE (so 'break' has no applicable rules)
  const policy: SchoolPolicyConfig = {
    isConfigured: true,
    isFictionalDemo: false,
    schoolName: 'Test School',
    policyVersion: '1.0',
    effectiveDate: '2026-09-01',
    precedenceOrder: ['suspend', 'indoor_only', 'modified', 'normal'],
    rules: [
      {
        id: 'pe-rule',
        name: 'PE Heat Warning',
        activity: 'pe',
        metric: 'heat_index',
        operator: '>=',
        threshold: 30,
        unit: '°C',
        recommendedAction: 'modified',
        actionTitle: 'Shorten outdoor PE',
        actionGuidance: 'Shorten PE sessions.',
        reason: 'Heat index >= 30',
        severity: 1,
      },
    ],
  };

  // Row 1: activity 'break' -> no applicable rules configured -> excluded from evaluatedCount
  // Row 2: activity 'pe' on valid hour -> evaluated
  // Row 3: date outside available data -> outsideDataCount
  const nurseRows = [
    { rowNumber: 2, date: datePart, hour: hourNum, activity: 'break' as const, nurse_action: 'normal' as const },
    { rowNumber: 3, date: datePart2, hour: hourNum2, activity: 'pe' as const, nurse_action: 'normal' as const },
    { rowNumber: 4, date: '2019-01-01', hour: 12, activity: 'pe' as const, nurse_action: 'cancel' as const },
  ];

  const evalRes = evaluateNurseComparison({
    nurseRows,
    schoolPolicy: policy,
    rawCityData: hindcastData,
    schoolCityId: CITIES[0].id,
  });

  assert.strictEqual(evalRes.success, true);
  assert.ok(evalRes.summary);
  const s = evalRes.summary;

  // Breakdown checks:
  assert.strictEqual(s.totalRows, 3);
  assert.strictEqual(s.outsideDataCount, 1);
  assert.strictEqual(s.notEvaluatedCount, 1);
  assert.strictEqual(s.evaluatedCount, 1);

  // Total rows reconciliation check:
  assert.strictEqual(s.totalRows, s.evaluatedCount + s.notEvaluatedCount + s.outsideDataCount);

  // Check the not_evaluated row status and reason
  const noRulesRow = s.allRows.find((r) => r.activity === 'break');
  assert.ok(noRulesRow);
  assert.strictEqual(noRulesRow.status, 'not_evaluated');
  assert.ok(noRulesRow.reason?.includes('No applicable rules configured'));

  // Test an incomplete row where one rule triggers and another reading is missing
  if (cityData.airQuality.hourly.pm10) {
    cityData.airQuality.hourly.pm10[16] = null;
  }
  const policyWithIncomplete: SchoolPolicyConfig = {
    ...policy,
    rules: [
      {
        id: 'heat-trigger',
        name: 'Heat Trigger',
        activity: 'pe',
        metric: 'temperature',
        operator: '>=',
        threshold: 10,
        unit: '°C',
        recommendedAction: 'modified',
        actionTitle: 'Shorten outdoor play',
        actionGuidance: 'Reduce exertion.',
        reason: 'Temperature trigger',
        severity: 1,
      },
      {
        id: 'pm10-rule',
        name: 'PM10 rule',
        activity: 'pe',
        metric: 'pm10',
        operator: '>=',
        threshold: 150,
        unit: 'µg/m³',
        recommendedAction: 'indoor_only',
        actionTitle: 'Move indoors',
        actionGuidance: 'Elevated PM10.',
        reason: 'PM10 trigger',
        severity: 2,
      },
    ],
  };

  const evalIncomplete = evaluateNurseComparison({
    nurseRows: [
      { rowNumber: 5, date: datePart3, hour: hourNum3, activity: 'pe' as const, nurse_action: 'shorten' as const },
    ],
    schoolPolicy: policyWithIncomplete,
    rawCityData: hindcastData,
    schoolCityId: CITIES[0].id,
  });

  assert.strictEqual(evalIncomplete.success, true);
  assert.ok(evalIncomplete.summary);
  const sInc = evalIncomplete.summary;
  assert.strictEqual(sInc.evaluatedCount, 0);
  assert.strictEqual(sInc.notEvaluatedCount, 1);
  assert.strictEqual(sInc.allRows[0].status, 'not_evaluated');
  assert.strictEqual(sInc.allRows[0].dustwatch_action, 'shorten'); // triggered action preserved
  assert.ok(sInc.allRows[0].reason?.includes('Incomplete assessment'));
});

test('Backtest Integrity: synthetic data is explicitly tagged and not masqueraded as real hindcast', () => {
  const synthetic = generateSyntheticHindcastData(3, [CITIES[0]]);
  const cityData = synthetic[CITIES[0].id];

  assert.strictEqual(cityData.isSampleOrSnapshot, true);
  assert.strictEqual(cityData.snapshotLabel, SYNTHETIC_HINDCAST_LABEL);

  const predictions = buildHourlyPredictions(synthetic, null);
  assert.ok(predictions.length > 0);
  assert.strictEqual(predictions[0].isSynthetic, true);

  const evalResult = evaluatePredictionsAgainstEvents({
    predictions,
    events: [],
    searchedPeriod: { start: predictions[0].timestamp, end: predictions[predictions.length - 1].timestamp },
    searchedCities: [CITIES[0].name],
    daysRequested: 3,
    activeModel: null,
  });

  assert.strictEqual(evalResult.isSynthetic, true);
  assert.strictEqual(evalResult.metadata.isSynthetic, true);
  assert.strictEqual(evalResult.metadata.hindcastLabel, SYNTHETIC_HINDCAST_LABEL);
});

test('Backtest Integrity: synthetic evaluation CSV contains comment header and cannot be parsed as real data', () => {
  const synthetic = generateSyntheticHindcastData(2, [CITIES[0]]);
  const predictions = buildHourlyPredictions(synthetic, null);
  const evalResult = evaluatePredictionsAgainstEvents({
    predictions,
    events: [],
    searchedPeriod: { start: predictions[0].timestamp, end: predictions[predictions.length - 1].timestamp },
    searchedCities: [CITIES[0].name],
    daysRequested: 2,
    activeModel: null,
  });

  // Check CSV text contains synthetic comment header
  assert.ok(evalResult.csvText.includes('# dataset: synthetic'));
  assert.ok(evalResult.csvText.includes(SYNTHETIC_HINDCAST_LABEL));

  // When uploaded into Accuracy Checker without extra metadata, the comment header preserves synthetic status
  const parsed = parseAndEvaluateCsv(evalResult.csvText);
  assert.strictEqual(parsed.success, true);
  assert.strictEqual(parsed.result?.workbenchMetadata?.isSynthetic, true);
  assert.strictEqual(parsed.result?.workbenchMetadata?.hindcastLabel, SYNTHETIC_HINDCAST_LABEL);
});

test('Snapshot Integrity: synthetic data exported to snapshot cannot be relabeled as real data upon import', () => {
  const synthetic = generateSyntheticHindcastData(2, CITIES);
  const jsonStr = exportSnapshotJson(synthetic);
  const parsedJson = JSON.parse(jsonStr);
  assert.strictEqual(parsedJson.isSynthetic, true);

  const importResult = importSnapshotJson(jsonStr);
  assert.strictEqual(importResult.success, true);
  assert.strictEqual(importResult.isSynthetic, true);
});

test('Realistic Dataset: non-synthetic predictions are labeled with real hindcast provenance and not synthetic', () => {
  // Realistic non-synthetic hindcast data representation
  const realisticData = generateSyntheticHindcastData(2, [CITIES[0]]);
  realisticData[CITIES[0].id].isSampleOrSnapshot = false;
  realisticData[CITIES[0].id].snapshotLabel = HINDCAST_PROVENANCE_LABEL;

  const predictions = buildHourlyPredictions(realisticData, null);
  assert.strictEqual(predictions[0].isSynthetic, false);

  const evalResult = evaluatePredictionsAgainstEvents({
    predictions,
    events: [],
    searchedPeriod: { start: predictions[0].timestamp, end: predictions[predictions.length - 1].timestamp },
    searchedCities: [CITIES[0].name],
    daysRequested: 2,
    activeModel: null,
  });

  assert.strictEqual(evalResult.isSynthetic, false);
  assert.strictEqual(evalResult.metadata.isSynthetic, false);
  assert.strictEqual(evalResult.metadata.hindcastLabel, HINDCAST_PROVENANCE_LABEL);
  assert.ok(!evalResult.csvText.includes('# dataset: synthetic'));
});

test('Provenance Isolation: caller passing isSynthetic: false cannot override synthetic CSV header', () => {
  const syntheticCsv = [
    '# dataset: synthetic',
    `# provenance: ${SYNTHETIC_HINDCAST_LABEL}`,
    'timestamp,city,observed_event,model_level,baseline_level,persistence_level',
    '2026-10-10T10:00,Abu Dhabi,0,,Low,Low',
    '2026-10-10T11:00,Abu Dhabi,1,,High,Low',
  ].join('\n');

  // Attempt to override synthetic provenance with isSynthetic: false in caller metadata
  const parsed = parseAndEvaluateCsv(syntheticCsv, {
    isSynthetic: false,
    hindcastLabel: 'Attempted real label override',
  });

  assert.strictEqual(parsed.success, true);
  assert.strictEqual(parsed.result?.workbenchMetadata?.isSynthetic, true, 'Synthetic CSV must remain synthetic despite caller override');
  assert.ok(
    parsed.result?.workbenchMetadata?.hindcastLabel?.includes('Synthetic') ||
      parsed.result?.workbenchMetadata?.hindcastLabel?.includes('synthetic'),
    'Label must maintain synthetic provenance'
  );
});

test('City Batch Integrity: fetchHindcastData throws on mismatched city counts or coordinates', async () => {
  // Test error throwing when batch fetch returns incorrect city count or mismatched responses
  const originalFetch = globalThis.fetch;
  try {
    // 1. Array length mismatch (e.g. only 5 responses for 10 cities)
    globalThis.fetch = async () =>
      new Response(JSON.stringify([{ latitude: 24.45, longitude: 54.37, hourly: { time: ['2026-10-10T00:00'] } }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    await assert.rejects(
      async () => {
        await fetchHindcastData(1);
      },
      /mismatch/i,
      'Batch size mismatch must throw and not fall back to city 0'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Timestamp Alignment: weather and air-quality observations are matched by timestamp when array offsets differ', () => {
  // Construct raw city data where weather starts at 00:00 and air-quality starts at 02:00
  const city = CITIES[0];
  const wxTimes: string[] = [];
  const aqTimes: string[] = [];

  const tempArr: number[] = [];
  const windArr: number[] = [];
  const visArr: number[] = [];
  const rhArr: number[] = [];

  const dustArr: number[] = [];
  const pm10Arr: number[] = [];

  // 24 hours
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0');
    const ts = `2026-10-10T${hh}:00`;
    wxTimes.push(ts);
    tempArr.push(25 + h);
    windArr.push(10 + h);
    visArr.push(8000);
    rhArr.push(50);

    // Air quality only starts at 02:00
    if (h >= 2) {
      aqTimes.push(ts);
      dustArr.push(50 + h);
      pm10Arr.push(70 + h);
    }
  }

  const offsetData = {
    [city.id]: {
      city,
      weather: {
        latitude: city.latitude,
        longitude: city.longitude,
        timezone: 'Asia/Dubai',
        hourly: {
          time: wxTimes,
          temperature_2m: tempArr,
          relative_humidity_2m: rhArr,
          wind_speed_10m: windArr,
          wind_gusts_10m: windArr.map((w) => w + 5),
          wind_direction_10m: windArr.map(() => 180),
          visibility: visArr,
        },
      },
      airQuality: {
        latitude: city.latitude,
        longitude: city.longitude,
        timezone: 'Asia/Dubai',
        hourly: {
          time: aqTimes,
          dust: dustArr,
          pm10: pm10Arr,
          pm2_5: pm10Arr.map((p) => Math.round(p * 0.4)),
        },
      },
      fetchTimestamp: Date.now(),
      isSampleOrSnapshot: false,
      snapshotLabel: HINDCAST_PROVENANCE_LABEL,
    },
  };

  const predictions = buildHourlyPredictions(offsetData, null);
  assert.ok(predictions.length > 0);

  // Predictions start at index 12 (dropping first 12 hours)
  // For hour 14 (14:00), verify that temperature matches wx hour 14 and dust matches aq hour 14
  const pred14 = predictions.find((p) => p.timestamp === '2026-10-10T14:00');
  assert.ok(pred14, 'Prediction for 14:00 must exist');
  assert.strictEqual(pred14.rawVariables.temperature_2m, 25 + 14);
  assert.strictEqual(pred14.rawVariables.dust, 50 + 14);
  assert.strictEqual(pred14.rawVariables.pm10, 70 + 14);
});

test('Provenance Preservation: sample and custom provenance labels are preserved in predictions and evaluation output', () => {
  const city = CITIES[0];
  const synthetic = generateSyntheticHindcastData(2, [city]);
  // Tag with custom sample label
  const customSampleLabel = 'Custom Sample Archive v1.0';
  synthetic[city.id].isSampleOrSnapshot = true;
  synthetic[city.id].snapshotLabel = customSampleLabel;

  const predictions = buildHourlyPredictions(synthetic, null);
  assert.ok(predictions.length > 0);
  assert.strictEqual(predictions[0].isSynthetic, true);
  assert.strictEqual(predictions[0].snapshotLabel, customSampleLabel);

  const evalResult = evaluatePredictionsAgainstEvents({
    predictions,
    events: [],
    searchedPeriod: { start: predictions[0].timestamp, end: predictions[predictions.length - 1].timestamp },
    searchedCities: [city.name],
    daysRequested: 2,
    activeModel: null,
  });

  assert.strictEqual(evalResult.isSynthetic, true);
  assert.strictEqual(evalResult.metadata.isSynthetic, true);
  assert.strictEqual(evalResult.metadata.hindcastLabel, customSampleLabel);
  assert.ok(evalResult.csvText.includes(`# provenance: ${customSampleLabel}`));
});

test('Model Predictions in Hindcast: model_level is strictly blank on fallback and never populated with baseline category', () => {
  const city = CITIES[0];
  const hindcastData = generateSyntheticHindcastData(2, [city]);

  const testModel: ModelFileConfig = {
    model_name: 'test_logistic_regression',
    model_type: 'logistic_regression',
    version: '1.0',
    trained_on: '2023-2024 Hindcast',
    trained_date: '2026-10-01',
    feature_names: ['dust', 'pm10', 'wind_speed_10m'],
    coefficients: [0.03, 0.02, 0.04],
    intercept: -2.5,
    scaler: {
      mean: [100, 150, 20],
      scale: [50, 80, 10],
    },
    probability_cutoffs: {
      moderate: 0.3,
      high: 0.6,
      very_high: 0.8,
    },
  };

  // 1. With valid model and full data, model_level is populated
  const predsWithModel = buildHourlyPredictions(hindcastData, testModel);
  assert.ok(predsWithModel.length > 0);
  assert.ok(predsWithModel[0].model_level !== '', 'model_level should be populated when model runs');

  // 2. Inject missing required feature (pm10 = null) into hour 15
  const cityData = hindcastData[city.id];
  if (cityData.airQuality.hourly.pm10) {
    cityData.airQuality.hourly.pm10[15] = null;
  }

  const predsWithMissing = buildHourlyPredictions(hindcastData, testModel);
  // Find the hour corresponding to index 15
  const time15 = cityData.weather.hourly.time[15];
  const pred15 = predsWithMissing.find((p) => p.timestamp === time15);
  assert.ok(pred15, 'Prediction for hour 15 must exist');
  assert.strictEqual(
    pred15.model_level,
    '',
    'Hour with missing required model feature must have blank model_level, NEVER the baseline fallback category'
  );
  assert.notEqual(pred15.baseline_level, '', 'Baseline level should still be evaluated');

  // 3. Without model (null), all model_level are blank ''
  const predsNullModel = buildHourlyPredictions(hindcastData, null);
  for (const p of predsNullModel) {
    assert.strictEqual(p.model_level, '', 'model_level must be blank when no model is loaded');
  }
});

test('Nurse Comparison Provenance: preserves synthetic and custom telemetry provenance', () => {
  const city = CITIES[0];
  const synthetic = generateSyntheticHindcastData(2, [city]);
  const customLabel = 'Sample Telemetry Dataset v2';
  synthetic[city.id].isSampleOrSnapshot = true;
  synthetic[city.id].snapshotLabel = customLabel;

  const validPolicy: SchoolPolicyConfig = {
    isConfigured: true,
    isFictionalDemo: false,
    schoolName: 'Al Nahda Campus',
    policyVersion: '1.0',
    effectiveDate: '2026-09-01',
    precedenceOrder: ['suspend', 'indoor_only', 'modified', 'normal'],
    rules: [
      {
        id: 'r1',
        name: 'Heat rule',
        activity: 'all',
        metric: 'temperature',
        operator: '>=',
        threshold: 30,
        unit: '°C',
        recommendedAction: 'modified',
        actionTitle: 'Shorten outdoor play',
        actionGuidance: 'Reduce exertion.',
        reason: 'Temperature threshold',
        severity: 1,
      },
    ],
  };

  const sampleCsv = getNurseLogTemplateCsv();
  const parsedNurse = parseNurseLogCsv(sampleCsv);
  assert.strictEqual(parsedNurse.success, true);

  const evalRes = evaluateNurseComparison({
    nurseRows: parsedNurse.rows,
    schoolPolicy: validPolicy,
    rawCityData: synthetic,
    schoolCityId: city.id,
  });

  assert.strictEqual(evalRes.success, true);
  assert.ok(evalRes.summary);
  assert.strictEqual(evalRes.summary.isSynthetic, true);
  assert.strictEqual(evalRes.summary.hindcastLabel, customLabel);
});

test('Provenance Detection: parseAndEvaluateCsv flags unknown origin when uploaded without headers', () => {
  const plainCsv = [
    'timestamp,city,observed_event,model_level,baseline_level,persistence_level',
    '2026-10-10T10:00,Abu Dhabi,0,,Low,Low',
    '2026-10-10T11:00,Abu Dhabi,1,,High,Low',
  ].join('\n');

  const parsed = parseAndEvaluateCsv(plainCsv);
  assert.strictEqual(parsed.success, true);
  assert.ok(parsed.result?.workbenchMetadata);
  assert.strictEqual(parsed.result.workbenchMetadata.isUnknownOrigin, true);
  assert.strictEqual(
    parsed.result.workbenchMetadata.hindcastLabel,
    'Uploaded CSV (Unknown origin / unverified provenance)'
  );
});

test('Provenance Preservation: real hindcast CSV roundtrip preserves provenance comments and avoids unknown origin', () => {
  const realisticData = generateSyntheticHindcastData(2, [CITIES[0]]);
  realisticData[CITIES[0].id].isSampleOrSnapshot = false;
  realisticData[CITIES[0].id].snapshotLabel = HINDCAST_PROVENANCE_LABEL;

  const predictions = buildHourlyPredictions(realisticData, null);
  const evalResult = evaluatePredictionsAgainstEvents({
    predictions,
    events: [],
    searchedPeriod: { start: predictions[0].timestamp, end: predictions[predictions.length - 1].timestamp },
    searchedCities: [CITIES[0].name],
    daysRequested: 2,
    activeModel: null,
  });

  // Verify exported CSV has genuine hindcast headers
  assert.ok(evalResult.csvText.includes('# dataset: hindcast'), 'Must specify hindcast dataset');
  assert.ok(evalResult.csvText.includes(`# provenance: ${HINDCAST_PROVENANCE_LABEL}`), 'Must include full hindcast provenance disclaimer');

  // Parse exported CSV back as a user file upload
  const roundtrip = parseAndEvaluateCsv(evalResult.csvText);
  assert.strictEqual(roundtrip.success, true);
  assert.ok(roundtrip.result?.workbenchMetadata);
  assert.strictEqual(roundtrip.result.workbenchMetadata.isSynthetic, false);
  assert.strictEqual(roundtrip.result.workbenchMetadata.isSample, false);
  assert.strictEqual(roundtrip.result.workbenchMetadata.isUnknownOrigin, false, 'Must not be classified as unknown origin');
  assert.strictEqual(roundtrip.result.workbenchMetadata.hindcastLabel, HINDCAST_PROVENANCE_LABEL);
});

test('Provenance Preservation: sample dataset CSV roundtrip preserves sample provenance and flags sample demonstration', () => {
  const sampleLabel = 'Sample demonstration data (Oct 2026 snapshot)';
  const sampleData = generateSyntheticHindcastData(2, [CITIES[0]]);
  sampleData[CITIES[0].id].isSampleOrSnapshot = true;
  sampleData[CITIES[0].id].snapshotLabel = sampleLabel;

  const predictions = buildHourlyPredictions(sampleData, null);
  const evalResult = evaluatePredictionsAgainstEvents({
    predictions,
    events: [],
    searchedPeriod: { start: predictions[0].timestamp, end: predictions[predictions.length - 1].timestamp },
    searchedCities: [CITIES[0].name],
    daysRequested: 2,
    activeModel: null,
  });

  assert.ok(evalResult.csvText.includes('# dataset: synthetic'));
  assert.ok(evalResult.csvText.includes(`# provenance: ${sampleLabel}`));

  const roundtrip = parseAndEvaluateCsv(evalResult.csvText);
  assert.strictEqual(roundtrip.success, true);
  assert.ok(roundtrip.result?.workbenchMetadata);
  assert.strictEqual(roundtrip.result.workbenchMetadata.isSynthetic, true);
  assert.strictEqual(roundtrip.result.workbenchMetadata.isSample, true);
  assert.strictEqual(roundtrip.result.workbenchMetadata.isUnknownOrigin, false);
});

test('Timestamp Alignment: partial overlap sets missing readings to null explicitly and marks core data missing', () => {
  const city = CITIES[0];
  const partialData = {
    [city.id]: {
      city,
      weather: {
        latitude: city.latitude,
        longitude: city.longitude,
        timezone: 'Asia/Dubai',
        hourly: {
          time: [
            // 14 hours total, 00:00 to 13:00
            ...Array.from({ length: 14 }, (_, i) => `2026-10-10T${String(i).padStart(2, '0')}:00`),
          ],
          wind_speed_10m: Array(14).fill(20),
          wind_gusts_10m: Array(14).fill(30),
          wind_direction_10m: Array(14).fill(180),
          relative_humidity_2m: Array(14).fill(40),
          temperature_2m: Array(14).fill(30),
          visibility: Array(14).fill(8000),
        },
      },
      airQuality: {
        latitude: city.latitude,
        longitude: city.longitude,
        timezone: 'Asia/Dubai',
        hourly: {
          // Air quality only starts at 13:00 (hour 13)
          time: [`2026-10-10T13:00`],
          pm10: [150],
          pm2_5: [50],
          dust: [100],
          aerosol_optical_depth: [0.5],
        },
      },
      fetchTimestamp: Date.now(),
      isSampleOrSnapshot: false,
      snapshotLabel: HINDCAST_PROVENANCE_LABEL,
    },
  };

  const predictions = buildHourlyPredictions(partialData, null);
  // Because first 12 hours are dropped for persistence, predictions contain hours 12 and 13
  assert.strictEqual(predictions.length, 2);

  // Hour 12 (12:00): weather is present, air-quality is missing
  const pred12 = predictions.find((p) => p.timestamp.endsWith('12:00'));
  assert.ok(pred12);
  assert.strictEqual(pred12.rawVariables.wind_speed_10m, 20);
  assert.strictEqual(pred12.rawVariables.pm10, null, 'pm10 must be null when timestamp missing in air quality');
  assert.strictEqual(pred12.rawVariables.dust, null, 'dust must be null when timestamp missing in air quality');
  assert.strictEqual(pred12.isCoreDataMissing, true, 'Hour with missing air-quality must be marked core data missing');

  // Hour 13 (13:00): both weather and air-quality are present
  const pred13 = predictions.find((p) => p.timestamp.endsWith('13:00'));
  assert.ok(pred13);
  assert.strictEqual(pred13.rawVariables.wind_speed_10m, 20);
  assert.strictEqual(pred13.rawVariables.pm10, 150);
  assert.strictEqual(pred13.rawVariables.dust, 100);
  assert.strictEqual(pred13.isCoreDataMissing, false, 'Hour with both feeds matched is complete');
});


