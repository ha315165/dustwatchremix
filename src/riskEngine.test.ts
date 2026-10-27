/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSubScore,
  scoreToCategory,
  calculateHourlyBaseline,
  predictRisk,
  calculateConfidence,
  find3HourWindows,
  validateModelConfig,
} from './riskEngine.ts';
import { APP_CONFIG } from './config.ts';
import { RawHourlyVariables, ModelFileConfig } from './types.ts';

test('Self-Check 1: all variables at low values yield score 0 and Low risk', () => {
  const lowRaw: RawHourlyVariables = {
    time: '2026-10-20T12:00',
    dust: 20,
    pm10: 50,
    wind_gusts_10m: 25,
    wind_speed_10m: 15,
    aerosol_optical_depth: 0.2,
    visibility: 10000, // clean visibility -> subScore 0
    relative_humidity_2m: 60, // normal humidity -> subScore 0
    pm2_5: 10,
    temperature_2m: 28,
    wind_direction_10m: 300,
  };

  const result = calculateHourlyBaseline(0, lowRaw, APP_CONFIG);
  assert.equal(result.baselineScore, 0);
  assert.equal(result.category, 'Low');
});

test('Self-Check 2: all variables at high values yield score 100 and Very High risk', () => {
  const highRaw: RawHourlyVariables = {
    time: '2026-10-20T12:00',
    dust: 300,
    pm10: 400,
    wind_gusts_10m: 70,
    wind_speed_10m: 50,
    aerosol_optical_depth: 1.5,
    visibility: 1000, // severely reduced visibility -> subScore 100
    relative_humidity_2m: 15, // dry -> subScore 100
    pm2_5: 120,
    temperature_2m: 42,
    wind_direction_10m: 320,
  };

  const result = calculateHourlyBaseline(0, highRaw, APP_CONFIG);
  assert.equal(result.baselineScore, 100);
  assert.equal(result.category, 'Very High');
});

test('Self-Check 3: missing dust or PM10 at peak hour drops confidence to Low', () => {
  const rawWithMissingDust: RawHourlyVariables = {
    time: '2026-10-20T12:00',
    dust: null,
    pm10: 100,
    wind_gusts_10m: 30,
    wind_speed_10m: 20,
    aerosol_optical_depth: 0.4,
    visibility: 8000,
    relative_humidity_2m: 40,
    pm2_5: 30,
    temperature_2m: 30,
    wind_direction_10m: 310,
  };

  const hourly = [calculateHourlyBaseline(0, rawWithMissingDust, APP_CONFIG)];
  const { confidence, reasons } = calculateConfidence(hourly, 0, true, 0.5, true, APP_CONFIG);
  assert.equal(confidence, 'Low');
  assert.ok(reasons.some((r) => r.includes('Key particle data')));
});

test('Self-Check 4: score exactly on cutoff goes into higher category', () => {
  assert.equal(scoreToCategory(24), 'Low');
  assert.equal(scoreToCategory(25), 'Moderate');
  assert.equal(scoreToCategory(49), 'Moderate');
  assert.equal(scoreToCategory(50), 'High');
  assert.equal(scoreToCategory(74), 'High');
  assert.equal(scoreToCategory(75), 'Very High');
});

test('Self-Check 5: particle cap prevents high wind from triggering High or Very High', () => {
  // Dust and PM10 very low (subScores < 10)
  // Extreme wind gusts (e.g. 90 km/h) and wind speed (60 km/h)
  const extremeWindCleanParticles: RawHourlyVariables = {
    time: '2026-10-20T12:00',
    dust: 20, // subScore 0 (< 10)
    pm10: 50, // subScore 0 (< 10)
    wind_gusts_10m: 90, // subScore 100
    wind_speed_10m: 70, // subScore 100
    aerosol_optical_depth: 1.5, // subScore 100
    visibility: 1000, // subScore 100
    relative_humidity_2m: 15, // subScore 100
    pm2_5: 5,
    temperature_2m: 25,
    wind_direction_10m: 300,
  };

  const result = calculateHourlyBaseline(0, extremeWindCleanParticles, APP_CONFIG);
  assert.equal(result.isParticleCapped, true);
  assert.ok(result.finalScore <= 24);
  assert.equal(result.category, 'Low');
});

test('Self-Check 6: predictRisk without model returns baseline, with model runs logistic regression', () => {
  const sampleRaw: RawHourlyVariables = {
    time: '2026-10-20T14:00',
    dust: 150,
    pm10: 200,
    wind_gusts_10m: 40,
    wind_speed_10m: 25,
    aerosol_optical_depth: 0.6,
    visibility: 5000,
    relative_humidity_2m: 35,
    pm2_5: 45,
    temperature_2m: 32,
    wind_direction_10m: 310,
  };

  // Without model
  const baselineRes = predictRisk(0, sampleRaw, null, APP_CONFIG);
  assert.equal(baselineRes.modelScore, undefined);
  assert.equal(baselineRes.finalScore, baselineRes.baselineScore);

  // With a test model
  const testModel: ModelFileConfig = {
    model_name: 'test_logistic',
    model_type: 'logistic_regression',
    version: '1.0',
    trained_on: 'Synthetic UAE dataset',
    trained_date: '2026-10-01',
    feature_names: ['dust', 'wind_speed_10m'],
    coefficients: [0.02, 0.05],
    intercept: -3.0,
    scaler: {
      mean: [100, 20],
      scale: [50, 10],
    },
    probability_cutoffs: {
      moderate: 0.3,
      high: 0.6,
      very_high: 0.8,
    },
  };

  const modelRes = predictRisk(0, sampleRaw, testModel, APP_CONFIG);
  assert.notEqual(modelRes.modelScore, undefined);
  assert.ok(modelRes.modelScore! >= 0 && modelRes.modelScore! <= 100);
  assert.equal(modelRes.finalScore, modelRes.modelScore);
});

test('3-hour window calculation identifies best and worst blocks', () => {
  const dummyHours = [10, 20, 30, 80, 90, 85, 40, 20, 15, 10, 10, 12].map((s, idx) => ({
    hourIndex: idx,
    time: `2026-10-20T${String(idx).padStart(2, '0')}:00`,
    displayHour: `${String(idx).padStart(2, '0')}:00`,
    baselineScore: s,
    baselineCategory: scoreToCategory(s),
    finalScore: s,
    category: scoreToCategory(s),
    missingVariables: [],
    subScores: {},
    topContributors: [],
    isParticleCapped: false,
    contextVariables: {
      pm2_5: { value: 10, unit: 'µg/m³' },
      temperature_2m: { value: 25, unit: '°C' },
    },
  }));

  const { bestWindow, worstWindow } = find3HourWindows(dummyHours);
  // Worst window should be hours 3-5 (80, 90, 85 -> avg 85)
  assert.equal(worstWindow.startHourIndex, 3);
  assert.equal(worstWindow.endHourIndex, 5);
  assert.equal(worstWindow.level, 'Very High');

  // Best window should be hours 8-10 or 9-11 (10, 10, 12 -> avg 10.7)
  assert.equal(bestWindow.level, 'Low');
});

test('Model Predictions Integrity: predictRisk strictly only populates modelCategory on valid execution and never labels baseline as model', () => {
  const sampleRaw: RawHourlyVariables = {
    time: '2026-10-20T12:00',
    dust: 250,
    pm10: 320,
    pm2_5: 90,
    aerosol_optical_depth: 1.2,
    wind_speed_10m: 42,
    wind_gusts_10m: 60,
    wind_direction_10m: 320,
    relative_humidity_2m: 20,
    temperature_2m: 35,
    visibility: 1500,
  };

  const validModel: ModelFileConfig = {
    model_name: 'test_logistic_regression',
    model_type: 'logistic_regression',
    version: '1.0',
    trained_on: '2023-2024 Hindcast',
    trained_date: '2026-10-01',
    feature_names: ['dust', 'wind_speed_10m', 'pm10'],
    coefficients: [0.02, 0.05, 0.01],
    intercept: -3.0,
    scaler: {
      mean: [100, 20, 150],
      scale: [50, 10, 80],
    },
    probability_cutoffs: {
      moderate: 0.3,
      high: 0.6,
      very_high: 0.8,
    },
  };

  // 1. Valid model execution produces genuine modelScore and modelCategory
  const validRes = predictRisk(0, sampleRaw, validModel, APP_CONFIG);
  assert.notEqual(validRes.modelScore, undefined);
  assert.notEqual(validRes.modelCategory, undefined);
  assert.equal(validRes.finalScore, validRes.modelScore);
  assert.equal(validRes.category, validRes.modelCategory);

  // 2. Missing model (null or undefined) produces NO modelCategory and returns baseline
  const nullModelRes = predictRisk(0, sampleRaw, null, APP_CONFIG);
  assert.equal(nullModelRes.modelScore, undefined, 'Missing model must not populate modelScore');
  assert.equal(nullModelRes.modelCategory, undefined, 'Missing model must not populate modelCategory');
  assert.equal(nullModelRes.finalScore, nullModelRes.baselineScore);
  assert.equal(nullModelRes.category, nullModelRes.baselineCategory);

  const undefModelRes = predictRisk(0, sampleRaw, undefined, APP_CONFIG);
  assert.equal(undefModelRes.modelScore, undefined);
  assert.equal(undefModelRes.modelCategory, undefined);

  // 3. Missing required model feature (pm10 is null while in feature_names)
  const rawWithMissingFeature: RawHourlyVariables = {
    ...sampleRaw,
    pm10: null,
  };
  const missingFeatureRes = predictRisk(0, rawWithMissingFeature, validModel, APP_CONFIG);
  assert.equal(missingFeatureRes.modelScore, undefined, 'Missing feature must not populate modelScore');
  assert.equal(missingFeatureRes.modelCategory, undefined, 'Missing feature must not populate modelCategory');
  assert.equal(missingFeatureRes.finalScore, missingFeatureRes.baselineScore);
  assert.equal(missingFeatureRes.category, missingFeatureRes.baselineCategory);
  assert.ok(
    missingFeatureRes.missingVariables.includes('Required model feature missing'),
    'Should note that required model feature is missing'
  );

  // 4. Invalid model config (empty feature_names or length mismatch)
  const invalidModelConfig = {
    ...validModel,
    coefficients: [0.02], // length mismatch with feature_names
  } as unknown as ModelFileConfig;
  const invalidConfigRes = predictRisk(0, sampleRaw, invalidModelConfig, APP_CONFIG);
  assert.equal(invalidConfigRes.modelScore, undefined, 'Invalid config must not populate modelScore');
  assert.equal(invalidConfigRes.modelCategory, undefined, 'Invalid config must not populate modelCategory');

  // 5. Invalid scaler (scale is 0)
  const zeroScaleModel: ModelFileConfig = {
    ...validModel,
    scaler: {
      mean: [100, 20, 150],
      scale: [0, 10, 80],
    },
  };
  const zeroScaleRes = predictRisk(0, sampleRaw, zeroScaleModel, APP_CONFIG);
  assert.equal(zeroScaleRes.modelScore, undefined, 'Zero scale must not populate modelScore');
  assert.equal(zeroScaleRes.modelCategory, undefined, 'Zero scale must not populate modelCategory');

  // 6. Non-finite calculation (intercept = Infinity)
  const infModel: ModelFileConfig = {
    ...validModel,
    intercept: Infinity,
  };
  const infModelRes = predictRisk(0, sampleRaw, infModel, APP_CONFIG);
  assert.equal(infModelRes.modelScore, undefined, 'Non-finite output must not populate modelScore');
  assert.equal(infModelRes.modelCategory, undefined, 'Non-finite output must not populate modelCategory');
});

test('Confidence Calculation: synthetic demonstration data is locked to Low confidence and pending evaluation caps at Medium', () => {
  const sampleRaw: RawHourlyVariables = {
    time: '2026-10-20T12:00',
    dust: 50,
    pm10: 70,
    pm2_5: 20,
    aerosol_optical_depth: 0.3,
    wind_speed_10m: 18,
    wind_gusts_10m: 25,
    wind_direction_10m: 180,
    relative_humidity_2m: 45,
    temperature_2m: 30,
    visibility: 9000,
  };
  const baselineRes = calculateHourlyBaseline(0, sampleRaw, APP_CONFIG);
  const hourlyResults = [baselineRes];

  // 1. Synthetic data (isLive = false) MUST be Low confidence
  const syntheticConf = calculateConfidence(hourlyResults, 0, false, 0.5, true, APP_CONFIG);
  assert.equal(syntheticConf.confidence, 'Low', 'Synthetic data must never produce Medium or High confidence');
  assert.ok(syntheticConf.reasons.some((r) => r.includes('saved or synthetic demonstration data')));

  // 2. Real live data without real evaluation (hasRealEvaluation = false) caps at Medium
  const liveConf = calculateConfidence(hourlyResults, 0, true, 0.5, false, APP_CONFIG);
  assert.equal(liveConf.confidence, 'Medium', 'Confidence without real evaluation must cap at Medium');
  assert.ok(liveConf.reasons.some((r) => r.includes('historical accuracy validation pending')));
});

test('Model Predictions: thorough validation of invalid configs, NaN features, and probability cutoffs', () => {
  const sampleRaw: RawHourlyVariables = {
    time: '2026-10-20T12:00',
    dust: 120,
    pm10: 160,
    pm2_5: 50,
    aerosol_optical_depth: 0.6,
    wind_speed_10m: 25,
    wind_gusts_10m: 35,
    wind_direction_10m: 270,
    relative_humidity_2m: 30,
    temperature_2m: 32,
    visibility: 5000,
  };

  const validBaseModel: ModelFileConfig = {
    model_name: 'reg_test_model',
    model_type: 'logistic_regression',
    version: '1.0',
    trained_on: '2023-2024 Hindcast',
    trained_date: '2026-10-01',
    feature_names: ['dust', 'pm10', 'wind_speed_10m'],
    coefficients: [0.015, 0.01, 0.04],
    intercept: -2.5,
    scaler: {
      mean: [100, 150, 20],
      scale: [50, 60, 10],
    },
    probability_cutoffs: {
      moderate: 0.35,
      high: 0.65,
      very_high: 0.85,
    },
  };

  // 1. Feature with NaN in raw readings triggers clean fallback without model labels
  const rawWithNan: RawHourlyVariables = {
    ...sampleRaw,
    wind_speed_10m: NaN,
  };
  const nanRes = predictRisk(0, rawWithNan, validBaseModel, APP_CONFIG);
  assert.strictEqual(nanRes.modelScore, undefined);
  assert.strictEqual(nanRes.modelCategory, undefined);
  assert.strictEqual(nanRes.finalScore, nanRes.baselineScore);
  assert.strictEqual(nanRes.category, nanRes.baselineCategory);

  // 2. Model with non-finite coefficient (NaN or Infinity)
  const nanCoefModel = {
    ...validBaseModel,
    coefficients: [0.015, NaN, 0.04],
  } as unknown as ModelFileConfig;
  const nanCoefRes = predictRisk(0, sampleRaw, nanCoefModel, APP_CONFIG);
  assert.strictEqual(nanCoefRes.modelScore, undefined);
  assert.strictEqual(nanCoefRes.modelCategory, undefined);
  assert.strictEqual(nanCoefRes.finalScore, nanCoefRes.baselineScore);

  // 3. Scaler with negative scale value
  const negScaleModel: ModelFileConfig = {
    ...validBaseModel,
    scaler: {
      mean: [100, 150, 20],
      scale: [50, -10, 10],
    },
  };
  const negScaleRes = predictRisk(0, sampleRaw, negScaleModel, APP_CONFIG);
  assert.strictEqual(negScaleRes.modelScore, undefined);
  assert.strictEqual(negScaleRes.modelCategory, undefined);

  // 4. Invalid probability cutoffs (unordered: moderate > high)
  const unorderedCutoffsModel: ModelFileConfig = {
    ...validBaseModel,
    probability_cutoffs: {
      moderate: 0.8,
      high: 0.4,
      very_high: 0.9,
    },
  };
  const unorderedRes = predictRisk(0, sampleRaw, unorderedCutoffsModel, APP_CONFIG);
  assert.strictEqual(unorderedRes.modelScore, undefined);
  assert.strictEqual(unorderedRes.modelCategory, undefined);

  // 5. Out-of-bounds probability cutoffs (very_high > 1)
  const outOfBoundsModel: ModelFileConfig = {
    ...validBaseModel,
    probability_cutoffs: {
      moderate: 0.3,
      high: 0.6,
      very_high: 1.5,
    },
  };
  const outOfBoundsRes = predictRisk(0, sampleRaw, outOfBoundsModel, APP_CONFIG);
  assert.strictEqual(outOfBoundsRes.modelScore, undefined);
  assert.strictEqual(outOfBoundsRes.modelCategory, undefined);
});

