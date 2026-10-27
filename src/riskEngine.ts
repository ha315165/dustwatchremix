/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { APP_CONFIG } from './config.ts';
import {
  ConfidenceLevel,
  HourlyRiskResult,
  ModelFileConfig,
  RawHourlyVariables,
  RiskCategory,
  SubScoreDetail,
  ThresholdConfig,
  TimeWindow,
} from './types.ts';

/**
 * Calculates a 0-100 sub-score for a single environmental variable
 * using straight-line scaling between low and high cutoffs, clamped at 0 and 100.
 */
export function calculateSubScore(
  variableKey: keyof ThresholdConfig,
  rawValue: number | null,
  config: typeof APP_CONFIG = APP_CONFIG
): SubScoreDetail {
  const threshold = config.thresholds[variableKey];
  if (!threshold) {
    throw new Error(`Unknown threshold configuration for variable: ${variableKey}`);
  }

  if (rawValue === null || rawValue === undefined || Number.isNaN(rawValue)) {
    return {
      variableKey,
      displayName: threshold.displayName,
      rawValue: null,
      unit: threshold.unit,
      subScore: null,
      weight: threshold.weight,
      effectiveWeight: 0,
      status: 'missing',
      reversed: threshold.reversed,
    };
  }

  let normalized: number;
  if (threshold.reversed) {
    // For reversed metrics (visibility, relative humidity),
    // low value = 0 score (better/cleaner), high value = 100 score (dust hazard).
    // E.g. visibility: 10000m or above is 0, 1000m or below is 100.
    if (rawValue >= threshold.low) {
      normalized = 0;
    } else if (rawValue <= threshold.high) {
      normalized = 100;
    } else {
      normalized = ((threshold.low - rawValue) / (threshold.low - threshold.high)) * 100;
    }
  } else {
    // Standard metric: low value = 0, high value = 100
    if (rawValue <= threshold.low) {
      normalized = 0;
    } else if (rawValue >= threshold.high) {
      normalized = 100;
    } else {
      normalized = ((rawValue - threshold.low) / (threshold.high - threshold.low)) * 100;
    }
  }

  const clampedSubScore = Math.min(100, Math.max(0, Math.round(normalized * 10) / 10));

  let status: 'low' | 'moderate' | 'high' = 'low';
  if (clampedSubScore >= 50) {
    status = 'high';
  } else if (clampedSubScore >= 25) {
    status = 'moderate';
  }

  return {
    variableKey,
    displayName: threshold.displayName,
    rawValue,
    unit: threshold.unit,
    subScore: clampedSubScore,
    weight: threshold.weight,
    effectiveWeight: threshold.weight,
    status,
    reversed: threshold.reversed,
  };
}

/**
 * Maps a numeric score (0-100) to a RiskCategory.
 * A score exactly on a cutoff goes into the higher category:
 * Low: 0-24, Moderate: 25-49, High: 50-74, Very High: 75-100.
 */
export function scoreToCategory(score: number, config: typeof APP_CONFIG = APP_CONFIG): RiskCategory {
  const rounded = Math.round(score);
  if (rounded >= config.cutoffs.veryHighMin) return 'Very High';
  if (rounded >= config.cutoffs.highMin) return 'High';
  if (rounded >= config.cutoffs.moderateMin) return 'Moderate';
  return 'Low';
}

/**
 * Validates a ModelFileConfig JSON structure.
 */
export function validateModelConfig(model: unknown): { isValid: boolean; error?: string; config?: ModelFileConfig } {
  if (!model || typeof model !== 'object') {
    return { isValid: false, error: 'Model config must be a JSON object' };
  }

  const m = model as Partial<ModelFileConfig>;
  if (!m.model_name || typeof m.model_name !== 'string') {
    return { isValid: false, error: 'Missing or invalid model_name' };
  }
  if (m.model_type !== 'logistic_regression') {
    return { isValid: false, error: 'Only logistic_regression model_type is currently supported' };
  }
  if (!Array.isArray(m.feature_names) || m.feature_names.length === 0) {
    return { isValid: false, error: 'feature_names must be a non-empty array' };
  }
  for (const f of m.feature_names) {
    if (typeof f !== 'string' || f.trim().length === 0) {
      return { isValid: false, error: 'All feature_names must be non-empty strings' };
    }
  }
  if (!Array.isArray(m.coefficients) || m.coefficients.length !== m.feature_names.length) {
    return { isValid: false, error: 'coefficients length must match feature_names length' };
  }
  if (typeof m.intercept !== 'number' || !Number.isFinite(m.intercept)) {
    return { isValid: false, error: 'intercept must be a valid finite number' };
  }
  for (const c of m.coefficients) {
    if (typeof c !== 'number' || !Number.isFinite(c)) {
      return { isValid: false, error: 'All coefficients must be valid finite numbers' };
    }
  }

  if (m.scaler) {
    if (!Array.isArray(m.scaler.mean) || m.scaler.mean.length !== m.feature_names.length) {
      return { isValid: false, error: 'scaler.mean length must match feature_names' };
    }
    if (!Array.isArray(m.scaler.scale) || m.scaler.scale.length !== m.feature_names.length) {
      return { isValid: false, error: 'scaler.scale length must match feature_names' };
    }
    for (const meanVal of m.scaler.mean) {
      if (typeof meanVal !== 'number' || !Number.isFinite(meanVal)) {
        return { isValid: false, error: 'All scaler.mean values must be valid finite numbers' };
      }
    }
    for (const scaleVal of m.scaler.scale) {
      if (typeof scaleVal !== 'number' || !Number.isFinite(scaleVal) || scaleVal <= 0) {
        return { isValid: false, error: 'All scaler.scale values must be positive finite numbers (> 0)' };
      }
    }
  }

  if (
    !m.probability_cutoffs ||
    typeof m.probability_cutoffs.moderate !== 'number' ||
    typeof m.probability_cutoffs.high !== 'number' ||
    typeof m.probability_cutoffs.very_high !== 'number' ||
    !Number.isFinite(m.probability_cutoffs.moderate) ||
    !Number.isFinite(m.probability_cutoffs.high) ||
    !Number.isFinite(m.probability_cutoffs.very_high) ||
    m.probability_cutoffs.moderate <= 0 ||
    m.probability_cutoffs.moderate >= m.probability_cutoffs.high ||
    m.probability_cutoffs.high >= m.probability_cutoffs.very_high ||
    m.probability_cutoffs.very_high >= 1
  ) {
    return { isValid: false, error: 'probability_cutoffs must specify valid ascending numeric thresholds between 0 and 1 (0 < moderate < high < very_high < 1)' };
  }

  return { isValid: true, config: m as ModelFileConfig };
}

/**
 * Baseline calculation for a single hour.
 */
export function calculateHourlyBaseline(
  hourIndex: number,
  raw: RawHourlyVariables,
  config: typeof APP_CONFIG = APP_CONFIG
): HourlyRiskResult {
  const scoredKeys: (keyof ThresholdConfig)[] = [
    'dust',
    'pm10',
    'wind_gusts_10m',
    'wind_speed_10m',
    'aerosol_optical_depth',
    'visibility',
    'relative_humidity_2m',
  ];

  const subScores: Record<string, SubScoreDetail> = {};
  const missingVariables: string[] = [];
  let availableWeightTotal = 0;

  for (const key of scoredKeys) {
    const val = raw[key as keyof RawHourlyVariables] as number | null;
    const detail = calculateSubScore(key, val, config);
    subScores[key] = detail;
    if (detail.subScore === null) {
      missingVariables.push(detail.displayName);
    } else {
      availableWeightTotal += detail.weight;
    }
  }

  let baselineScore = 0;
  if (availableWeightTotal > 0) {
    let weightedSum = 0;
    for (const key of scoredKeys) {
      const detail = subScores[key];
      if (detail.subScore !== null) {
        // Shared out weights among available variables
        const effectiveWeight = detail.weight / availableWeightTotal;
        detail.effectiveWeight = effectiveWeight;
        weightedSum += detail.subScore * effectiveWeight;
      }
    }
    baselineScore = Math.min(100, Math.max(0, Math.round(weightedSum * 10) / 10));
  }

  // Particle cap rule: if both dust and PM10 sub-scores are below 10, cap score at 24
  let isParticleCapped = false;
  if (config.particleCapEnabled) {
    const dustSub = subScores.dust?.subScore;
    const pm10Sub = subScores.pm10?.subScore;
    if (
      dustSub !== null &&
      pm10Sub !== null &&
      dustSub < config.particleCapDustThreshold &&
      pm10Sub < config.particleCapPm10Threshold
    ) {
      if (baselineScore > config.particleCapMaxScore) {
        baselineScore = config.particleCapMaxScore;
        isParticleCapped = true;
      }
    }
  }

  const baselineCategory = scoreToCategory(baselineScore, config);

  // Top contributors
  const scoredItems = Object.values(subScores).filter((s) => s.subScore !== null);
  scoredItems.sort((a, b) => ((b.subScore || 0) * b.effectiveWeight) - ((a.subScore || 0) * a.effectiveWeight));
  const topContributors = scoredItems.slice(0, 3).map((s) => s.displayName);

  // Time formatting
  const displayHour = raw.time.includes('T') ? raw.time.split('T')[1].substring(0, 5) : raw.time;

  return {
    hourIndex,
    time: raw.time,
    displayHour,
    baselineScore,
    baselineCategory,
    finalScore: baselineScore,
    category: baselineCategory,
    missingVariables,
    subScores,
    topContributors,
    isParticleCapped,
    contextVariables: {
      pm2_5: { value: raw.pm2_5, unit: 'µg/m³' },
      temperature_2m: { value: raw.temperature_2m, unit: '°C' },
    },
  };
}

/**
 * Prediction slot: predictRisk(features, modelConfig?)
 * If no valid model is provided, returns baseline result.
 * If model is provided and valid, runs logistic regression:
 *   z = intercept + sum(coef_i * ((val_i - mean_i) / scale_i))
 *   p = 1 / (1 + exp(-z))
 */
export function predictRisk(
  hourIndex: number,
  raw: RawHourlyVariables,
  modelConfig?: ModelFileConfig | null,
  config: typeof APP_CONFIG = APP_CONFIG
): HourlyRiskResult {
  const baselineResult = calculateHourlyBaseline(hourIndex, raw, config);

  if (!modelConfig) {
    return baselineResult;
  }

  const validation = validateModelConfig(modelConfig);
  if (!validation.isValid || !validation.config) {
    return baselineResult;
  }

  const m = validation.config;
  let hasMissingRequiredFeature = false;
  let z = m.intercept;

  for (let i = 0; i < m.feature_names.length; i++) {
    const fName = m.feature_names[i] as keyof RawHourlyVariables;
    const rawVal = raw[fName] as number | null;

    if (rawVal === null || rawVal === undefined || !Number.isFinite(rawVal)) {
      hasMissingRequiredFeature = true;
      break;
    }

    let val = rawVal;
    if (m.scaler && m.scaler.mean[i] !== undefined && m.scaler.scale[i] !== undefined) {
      const scale = m.scaler.scale[i];
      if (scale === 0 || !Number.isFinite(scale)) {
        return {
          ...baselineResult,
          missingVariables: [...baselineResult.missingVariables, 'Invalid model scaler configuration'],
        };
      }
      val = (rawVal - m.scaler.mean[i]) / scale;
    }
    z += m.coefficients[i] * val;
  }

  if (hasMissingRequiredFeature) {
    // If any required feature is missing for an hour, use baseline for that hour.
    // Crucially: modelScore and modelCategory remain undefined.
    return {
      ...baselineResult,
      missingVariables: [...baselineResult.missingVariables, 'Required model feature missing'],
    };
  }

  if (!Number.isFinite(z)) {
    return {
      ...baselineResult,
      missingVariables: [...baselineResult.missingVariables, 'Model calculation produced non-finite log-odds'],
    };
  }

  const probability = 1 / (1 + Math.exp(-z));
  if (!Number.isFinite(probability) || Number.isNaN(probability) || probability < 0 || probability > 1) {
    return {
      ...baselineResult,
      missingVariables: [...baselineResult.missingVariables, 'Model calculation produced invalid probability'],
    };
  }

  const modelScore = Math.min(100, Math.max(0, Math.round(probability * 1000) / 10));
  if (!Number.isFinite(modelScore) || Number.isNaN(modelScore)) {
    return {
      ...baselineResult,
      missingVariables: [...baselineResult.missingVariables, 'Model calculation produced invalid score'],
    };
  }

  let modelCategory: RiskCategory = 'Low';
  if (probability >= m.probability_cutoffs.very_high) {
    modelCategory = 'Very High';
  } else if (probability >= m.probability_cutoffs.high) {
    modelCategory = 'High';
  } else if (probability >= m.probability_cutoffs.moderate) {
    modelCategory = 'Moderate';
  }

  return {
    ...baselineResult,
    modelScore,
    modelCategory,
    finalScore: modelScore,
    category: modelCategory,
  };
}

/**
 * Calculates confidence rating (Low, Medium, High) and reasons based on the rules.
 */
export function calculateConfidence(
  hourlyResults: HourlyRiskResult[],
  peakHourIndex: number,
  isLive: boolean,
  fetchAgeHours: number,
  hasRealEvaluation: boolean,
  config: typeof APP_CONFIG = APP_CONFIG
): { confidence: ConfidenceLevel; reasons: string[] } {
  let levelScore = 3; // 3: High, 2: Medium, 1: Low
  const reasons: string[] = [];

  const peakHour = hourlyResults[peakHourIndex] || hourlyResults[0];

  // Rule a: If dust or PM10 is missing for the peak hour: Low. If any other variable is missing: drop one level.
  const dustSub = peakHour?.subScores?.dust?.subScore;
  const pm10Sub = peakHour?.subScores?.pm10?.subScore;

  if (dustSub === null || dustSub === undefined || pm10Sub === null || pm10Sub === undefined) {
    levelScore = 1;
    reasons.push('Key particle data (dust or PM10) is missing for the peak risk hour.');
  } else {
    // Check if any other variable is missing across the 12 hours
    const anyMissing = hourlyResults.some((h) => h.missingVariables.length > 0);
    if (anyMissing) {
      levelScore = Math.min(levelScore, 2);
      reasons.push('Some atmospheric forecast variables are missing.');
    }
  }

  // Rule b: If data is sample data, a saved snapshot or an old cached response: Low.
  if (!isLive) {
    levelScore = 1;
    reasons.push('Using saved or synthetic demonstration data, not live telemetry.');
  }

  // Rule c: If data was fetched more than 3 hours ago: drop one level.
  if (fetchAgeHours > config.confidenceRules.oldDataHours) {
    levelScore = Math.max(1, levelScore - 1);
    reasons.push(`Data was fetched ${Math.round(fetchAgeHours * 10) / 10} hours ago (> 3 hours).`);
  }

  // Rule d: Disagreement checks for the peak hour:
  // - dust and PM10 sub-scores differ by > 40 points
  // - wind high (sub-score > 60) while particles low (sub-scores < 20)
  // - particles high while wind low
  if (dustSub !== null && pm10Sub !== null && dustSub !== undefined && pm10Sub !== undefined) {
    const diff = Math.abs(dustSub - pm10Sub);
    if (diff > config.confidenceRules.dustPm10DiffThreshold) {
      levelScore = Math.max(1, levelScore - 1);
      reasons.push(`Dust and PM10 disagree (sub-scores differ by ${Math.round(diff)} points).`);
    }

    const windGustSub = peakHour.subScores.wind_gusts_10m?.subScore ?? 0;
    const windSpeedSub = peakHour.subScores.wind_speed_10m?.subScore ?? 0;
    const maxWind = Math.max(windGustSub, windSpeedSub);
    const maxParticle = Math.max(dustSub, pm10Sub);

    if (maxWind > config.confidenceRules.highWindSubScore && maxParticle < config.confidenceRules.lowParticleSubScore) {
      levelScore = Math.max(1, levelScore - 1);
      reasons.push('High wind forecast but low particle concentrations.');
    } else if (
      maxParticle > config.confidenceRules.highParticleSubScore &&
      maxWind < config.confidenceRules.lowWindSubScore
    ) {
      levelScore = Math.max(1, levelScore - 1);
      reasons.push('High particle concentrations despite calm winds.');
    }
  }

  // Rule e: If score is within 5 points of a category cutoff: drop one level
  const margin = config.confidenceRules.cutoffMargin;
  const score = peakHour?.finalScore ?? 0;
  const cutoffs = [
    config.cutoffs.moderateMin,
    config.cutoffs.highMin,
    config.cutoffs.veryHighMin,
  ];
  const nearCutoff = cutoffs.some((c) => Math.abs(score - c) <= margin);
  if (nearCutoff) {
    levelScore = Math.max(1, levelScore - 1);
    reasons.push(`Peak risk score (${Math.round(score)}) is near a category cutoff boundary.`);
  }

  // Rule f: Until real evaluation results exist, never show High: cap at Medium
  if (!hasRealEvaluation) {
    if (levelScore > 2) {
      levelScore = 2;
    }
    reasons.push('Evaluation not finished yet (historical accuracy validation pending).');
  }

  let confidence: ConfidenceLevel = 'Low';
  if (levelScore >= 3) {
    confidence = 'High';
  } else if (levelScore === 2) {
    confidence = 'Medium';
  }

  return { confidence, reasons };
}

/**
 * Finds the best and worst 3-hour windows (lowest and highest average score).
 */
export function find3HourWindows(hourlyResults: HourlyRiskResult[]): {
  bestWindow: TimeWindow;
  worstWindow: TimeWindow;
} {
  if (hourlyResults.length < 3) {
    const single = hourlyResults[0] || {
      hourIndex: 0,
      finalScore: 0,
      category: 'Low' as RiskCategory,
      displayHour: '00:00',
    };
    const win: TimeWindow = {
      startHourIndex: 0,
      endHourIndex: 0,
      displayRange: single.displayHour,
      averageScore: single.finalScore,
      level: single.category,
    };
    return { bestWindow: win, worstWindow: win };
  }

  let minAvg = Infinity;
  let maxAvg = -Infinity;
  let bestIdx = 0;
  let worstIdx = 0;

  for (let i = 0; i <= hourlyResults.length - 3; i++) {
    const sum = hourlyResults[i].finalScore + hourlyResults[i + 1].finalScore + hourlyResults[i + 2].finalScore;
    const avg = sum / 3;
    if (avg < minAvg) {
      minAvg = avg;
      bestIdx = i;
    }
    if (avg > maxAvg) {
      maxAvg = avg;
      worstIdx = i;
    }
  }

  const makeWindow = (idx: number, avg: number): TimeWindow => {
    const startHour = hourlyResults[idx].displayHour;
    // Window covers 3 hours, so end label is the 3rd hour or 3 hours after start
    const endHour = hourlyResults[idx + 2].displayHour;
    return {
      startHourIndex: idx,
      endHourIndex: idx + 2,
      displayRange: `${startHour} - ${endHour}`,
      averageScore: Math.round(avg * 10) / 10,
      level: scoreToCategory(avg),
    };
  };

  return {
    bestWindow: makeWindow(bestIdx, minAvg),
    worstWindow: makeWindow(worstIdx, maxAvg),
  };
}
