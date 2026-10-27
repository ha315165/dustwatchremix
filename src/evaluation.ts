/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { APP_CONFIG } from './config.ts';
import {
  EvaluationPredictorStats,
  EvaluationResultSet,
  RiskCategory,
} from './types.ts';

export interface CsvEvaluationRow {
  rowNumber: number;
  timestamp: string;
  city: string;
  observed_event: 0 | 1;
  model_level?: RiskCategory | '';
  baseline_level: RiskCategory;
  persistence_level?: RiskCategory;
}

export interface ExampleRowDetail {
  rowNumber: number;
  timestamp: string;
  city: string;
  observed: 0 | 1;
  predictedLevel: RiskCategory;
  predictorName: string;
}

export interface CsvEvaluationResult {
  totalRows: number;
  validRowsCount: number;
  ignoredRowsCount: number;
  ignoredErrors: string[];
  observedEventsCount: number;
  hasEnoughEvents: boolean;
  predictors: {
    baselineRuleScore: EvaluationPredictorStats;
    trainedModel?: EvaluationPredictorStats;
    persistenceBenchmark?: EvaluationPredictorStats;
  };
  exampleMisses: ExampleRowDetail[];
  exampleFalseAlarms: ExampleRowDetail[];
  jsonOutput: string;
  // Workbench metadata if loaded from workbench
  workbenchMetadata?: {
    hindcastLabel: string;
    searchedPeriod: { start: string; end: string };
    searchedCities: string[];
    thresholdsUsed: Record<string, unknown>;
    isSynthetic?: boolean;
    isSample?: boolean;
    isUnknownOrigin?: boolean;
    splitInfo?: {
      splitDate: string;
      tuningPeriod: {
        periodRange: string;
        rowsCount: number;
        observedEventsCount: number;
        predictors: {
          baselineRuleScore: EvaluationPredictorStats;
          trainedModel?: EvaluationPredictorStats;
          persistenceBenchmark?: EvaluationPredictorStats;
        };
      };
      testPeriod: {
        periodRange: string;
        rowsCount: number;
        observedEventsCount: number;
        predictors: {
          baselineRuleScore: EvaluationPredictorStats;
          trainedModel?: EvaluationPredictorStats;
          persistenceBenchmark?: EvaluationPredictorStats;
        };
      };
    };
  };
}

const VALID_LEVELS = new Set<string>(['Low', 'Moderate', 'High', 'Very High']);

/**
 * Checks if a level constitutes an event prediction.
 * Default is High or Very High (at or above config.eventPredictionLevel).
 */
export function isPredictedEvent(level: string, cutoffLevel: RiskCategory = APP_CONFIG.eventPredictionLevel): boolean {
  if (cutoffLevel === 'Very High') {
    return level === 'Very High';
  }
  if (cutoffLevel === 'High') {
    return level === 'High' || level === 'Very High';
  }
  if (cutoffLevel === 'Moderate') {
    return level === 'Moderate' || level === 'High' || level === 'Very High';
  }
  return true;
}

/**
 * Calculates predictor statistics.
 */
function calculatePredictorStats(
  rows: CsvEvaluationRow[],
  getLevel: (r: CsvEvaluationRow) => RiskCategory | undefined
): EvaluationPredictorStats {
  let hits = 0;
  let misses = 0;
  let falseAlarms = 0;
  let correctNegatives = 0;

  for (const r of rows) {
    const level = getLevel(r);
    if (!level) continue;

    const isPred = isPredictedEvent(level);
    const isObs = r.observed_event === 1;

    if (isPred && isObs) {
      hits++;
    } else if (!isPred && isObs) {
      misses++;
    } else if (isPred && !isObs) {
      falseAlarms++;
    } else {
      correctNegatives++;
    }
  }

  const total = hits + misses + falseAlarms + correctNegatives;
  const observedEvents = hits + misses;
  const predictedEvents = hits + falseAlarms;

  const hitRate = observedEvents > 0 ? hits / observedEvents : null;
  const missRate = observedEvents > 0 ? misses / observedEvents : null;
  const falseAlarmRatio = predictedEvents > 0 ? falseAlarms / predictedEvents : null;
  const accuracy = total > 0 ? (hits + correctNegatives) / total : null;

  return {
    hits,
    misses,
    falseAlarms,
    correctNegatives,
    total,
    hitRate,
    missRate,
    falseAlarmRatio,
    accuracy,
  };
}

/**
 * Parses and validates an uploaded CSV file text.
 */
export function parseAndEvaluateCsv(
  csvText: string,
  workbenchMeta?: Partial<NonNullable<CsvEvaluationResult['workbenchMetadata']>>
): {
  success: boolean;
  error?: string;
  result?: CsvEvaluationResult;
} {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  let isSyntheticFromComment = false;
  let hindcastLabelFromComment: string | undefined = undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('#')) {
      if (/synthetic/i.test(line)) {
        isSyntheticFromComment = true;
      }
      const labelMatch = line.match(/^#\s*(?:provenance|hindcast_label|dataset):\s*(.+)$/i);
      if (labelMatch) {
        hindcastLabelFromComment = labelMatch[1].trim();
      }
      continue;
    }
    dataLines.push(line);
  }

  if (dataLines.length < 2) {
    return { success: false, error: 'CSV file is empty or contains only a header line.' };
  }

  const hasMeta = Boolean(workbenchMeta || isSyntheticFromComment || hindcastLabelFromComment);
  const isSynthetic = Boolean(
    workbenchMeta?.isSynthetic ||
    isSyntheticFromComment ||
    /synthetic/i.test(hindcastLabelFromComment || '') ||
    /synthetic/i.test(workbenchMeta?.hindcastLabel || '')
  );
  const isSample = Boolean(
    workbenchMeta?.isSample ||
    /sample/i.test(hindcastLabelFromComment || '') ||
    /sample/i.test(workbenchMeta?.hindcastLabel || '')
  );
  const isUnknownOrigin = Boolean(
    !hasMeta ||
    workbenchMeta?.isUnknownOrigin ||
    (!isSynthetic && !isSample && (!hindcastLabelFromComment || !/open-meteo|cams|hindcast/i.test(hindcastLabelFromComment)) && !workbenchMeta?.searchedPeriod?.start)
  );

  let hindcastLabel = 'Uploaded CSV (Unknown origin / unverified provenance)';
  if (isSynthetic) {
    // Ensure generated synthetic hindcasts cannot be relabelled as genuine historical observations by changing metadata alone!
    const candidateLabel = hindcastLabelFromComment || workbenchMeta?.hindcastLabel || '';
    if (candidateLabel && (/synthetic/i.test(candidateLabel) || /sample/i.test(candidateLabel))) {
      hindcastLabel = candidateLabel;
    } else {
      hindcastLabel = 'Synthetic demonstration data (Not real Open-Meteo hindcast data).';
    }
  } else if (isSample) {
    const candidateLabel = hindcastLabelFromComment || workbenchMeta?.hindcastLabel || '';
    if (candidateLabel && /sample/i.test(candidateLabel)) {
      hindcastLabel = candidateLabel;
    } else {
      hindcastLabel = 'Sample demonstration data';
    }
  } else if (hasMeta && !isUnknownOrigin) {
    hindcastLabel = workbenchMeta?.hindcastLabel || hindcastLabelFromComment || 'Hindcast dataset';
  }

  const effectiveMeta: CsvEvaluationResult['workbenchMetadata'] = {
    hindcastLabel,
    searchedPeriod: workbenchMeta?.searchedPeriod || { start: '', end: '' },
    searchedCities: workbenchMeta?.searchedCities || [],
    thresholdsUsed: workbenchMeta?.thresholdsUsed || {},
    isSynthetic,
    isSample,
    isUnknownOrigin,
    ...(workbenchMeta?.splitInfo ? { splitInfo: workbenchMeta.splitInfo } : {}),
  };

  const headerLine = dataLines[0];
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());

  const reqCols = ['timestamp', 'city', 'observed_event', 'model_level', 'baseline_level'];
  const missing = reqCols.filter((col) => !headers.includes(col));
  if (missing.length > 0) {
    return {
      success: false,
      error: `Missing required column(s): ${missing.join(', ')}. Expected: ${reqCols.join(', ')}`,
    };
  }

  const idxTimestamp = headers.indexOf('timestamp');
  const idxCity = headers.indexOf('city');
  const idxObserved = headers.indexOf('observed_event');
  const idxModel = headers.indexOf('model_level');
  const idxBaseline = headers.indexOf('baseline_level');
  const idxPersistence = headers.indexOf('persistence_level');

  const validRows: CsvEvaluationRow[] = [];
  const ignoredErrors: string[] = [];
  let rowNum = 1;

  for (let i = 1; i < dataLines.length; i++) {
    rowNum++;
    const line = dataLines[i];
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < reqCols.length) {
      ignoredErrors.push(`Row ${rowNum}: Not enough columns (found ${parts.length}, expected >= ${reqCols.length})`);
      continue;
    }

    const timestamp = parts[idxTimestamp];
    const city = parts[idxCity];
    const rawObserved = parts[idxObserved];
    const rawModel = parts[idxModel];
    const rawBaseline = parts[idxBaseline];
    const rawPersistence = idxPersistence !== -1 ? parts[idxPersistence] : undefined;

    if (!timestamp || !city) {
      ignoredErrors.push(`Row ${rowNum}: Blank timestamp or city`);
      continue;
    }

    const obs = parseInt(rawObserved, 10);
    if (obs !== 0 && obs !== 1) {
      ignoredErrors.push(`Row ${rowNum}: observed_event must be 0 or 1, found "${rawObserved}"`);
      continue;
    }

    // Model level is optional (can be blank if no trained model loaded)
    let parsedModel: RiskCategory | '' = '';
    if (rawModel && rawModel.length > 0) {
      if (!VALID_LEVELS.has(rawModel)) {
        ignoredErrors.push(`Row ${rowNum}: Invalid model_level "${rawModel}" (must be Low, Moderate, High, or Very High, or left blank)`);
        continue;
      }
      parsedModel = rawModel as RiskCategory;
    }

    if (!VALID_LEVELS.has(rawBaseline)) {
      ignoredErrors.push(`Row ${rowNum}: Invalid baseline_level "${rawBaseline}" (must be Low, Moderate, High, or Very High)`);
      continue;
    }

    let parsedPersistence: RiskCategory | undefined = undefined;
    if (rawPersistence && rawPersistence.length > 0) {
      if (!VALID_LEVELS.has(rawPersistence)) {
        ignoredErrors.push(`Row ${rowNum}: Invalid persistence_level "${rawPersistence}"`);
        continue;
      }
      parsedPersistence = rawPersistence as RiskCategory;
    }

    validRows.push({
      rowNumber: rowNum,
      timestamp,
      city,
      observed_event: obs as 0 | 1,
      model_level: parsedModel,
      baseline_level: rawBaseline as RiskCategory,
      persistence_level: parsedPersistence,
    });
  }

  if (validRows.length === 0) {
    return {
      success: false,
      error: `No valid data rows found in CSV. ${ignoredErrors.length} rows were invalid.`,
    };
  }

  const baselineStats = calculatePredictorStats(validRows, (r) => r.baseline_level);
  
  // Only calculate model stats if at least one row has a model level
  const hasModelPredictions = validRows.some((r) => r.model_level && r.model_level.length > 0);
  const modelStats = hasModelPredictions
    ? calculatePredictorStats(
        validRows.filter((r) => r.model_level && r.model_level.length > 0),
        (r) => (r.model_level ? (r.model_level as RiskCategory) : undefined)
      )
    : undefined;

  const persistenceStats =
    idxPersistence !== -1 && validRows.some((r) => r.persistence_level)
      ? calculatePredictorStats(
          validRows.filter((r) => r.persistence_level),
          (r) => r.persistence_level
        )
      : undefined;

  const observedEventsCount = validRows.filter((r) => r.observed_event === 1).length;
  const hasEnoughEvents = observedEventsCount >= 10;

  // Collect up to 10 example misses and 10 example false alarms (using baseline as default comparator)
  const exampleMisses: ExampleRowDetail[] = [];
  const exampleFalseAlarms: ExampleRowDetail[] = [];

  for (const r of validRows) {
    const isBaselinePred = isPredictedEvent(r.baseline_level);
    if (r.observed_event === 1 && !isBaselinePred && exampleMisses.length < 10) {
      exampleMisses.push({
        rowNumber: r.rowNumber,
        timestamp: r.timestamp,
        city: r.city,
        observed: 1,
        predictedLevel: r.baseline_level,
        predictorName: 'Baseline Rule Score',
      });
    } else if (r.observed_event === 0 && isBaselinePred && exampleFalseAlarms.length < 10) {
      exampleFalseAlarms.push({
        rowNumber: r.rowNumber,
        timestamp: r.timestamp,
        city: r.city,
        observed: 0,
        predictedLevel: r.baseline_level,
        predictorName: 'Baseline Rule Score',
      });
    }
  }

  // Construct JSON representation that matches EvaluationResultSet with complete provenance
  const evaluationSet: Record<string, unknown> = {
    datasetDescription: effectiveMeta
      ? (effectiveMeta.isSynthetic
          ? `Synthetic Demonstration Data (${validRows.length} evaluated hours)`
          : effectiveMeta.isSample
          ? `Sample Demonstration Data (${validRows.length} evaluated hours)`
          : effectiveMeta.isUnknownOrigin
          ? `Unverified Origin Dataset (${validRows.length} valid rows)`
          : `Hindcast Backtest (${validRows.length} evaluated hours)`)
      : `Unverified Origin Dataset (${validRows.length} valid rows)`,
    period: `${validRows[0]?.timestamp || ''} to ${validRows[validRows.length - 1]?.timestamp || ''}`,
    cities: Array.from(new Set(validRows.map((r) => r.city))),
    eventDefinitionUsed: APP_CONFIG.eventDefinitionText,
    eventPredictionLevel: APP_CONFIG.eventPredictionLevel,
    observedEventsCount,
    totalRows: validRows.length,
    predictors: {
      baselineRuleScore: baselineStats,
      ...(modelStats ? { trainedModel: modelStats } : {}),
      ...(persistenceStats ? { persistenceBenchmark: persistenceStats } : {}),
    },
    teamNotes: effectiveMeta
      ? (effectiveMeta.isSynthetic
          ? 'Generated via DustWatch Backtest Evaluation Workbench (SYNTHETIC DEMO DATA - not for real accuracy validation).'
          : effectiveMeta.isSample
          ? 'Generated via DustWatch Backtest Evaluation Workbench (Sample demonstration data).'
          : effectiveMeta.isUnknownOrigin
          ? 'Generated via DustWatch CSV evaluation (Unverified provenance - not real-world validation).'
          : 'Generated via DustWatch Backtest Evaluation Workbench.')
      : 'Generated via DustWatch browser evaluation tool (Unverified origin).',
    ...(effectiveMeta?.isSynthetic ? { isSynthetic: true } : {}),
    ...(effectiveMeta?.isSample ? { isSample: true } : {}),
    ...(effectiveMeta?.isUnknownOrigin ? { isUnknownOrigin: true } : {}),
    ...(effectiveMeta?.hindcastLabel ? { hindcastLabel: effectiveMeta.hindcastLabel } : {}),
    ...(effectiveMeta?.searchedPeriod ? { searchedPeriod: effectiveMeta.searchedPeriod } : {}),
    ...(effectiveMeta?.thresholdsUsed ? { thresholdsUsed: effectiveMeta.thresholdsUsed } : {}),
    ...(effectiveMeta?.splitInfo ? { splitInfo: effectiveMeta.splitInfo } : {}),
  };

  return {
    success: true,
    result: {
      totalRows: lines.length - 1,
      validRowsCount: validRows.length,
      ignoredRowsCount: ignoredErrors.length,
      ignoredErrors,
      observedEventsCount,
      hasEnoughEvents,
      predictors: {
        baselineRuleScore: baselineStats,
        ...(modelStats ? { trainedModel: modelStats } : {}),
        persistenceBenchmark: persistenceStats,
      },
      exampleMisses,
      exampleFalseAlarms,
      jsonOutput: JSON.stringify(evaluationSet, null, 2),
      workbenchMetadata: effectiveMeta,
    },
  };
}


/**
 * Returns header-only CSV template as requested.
 */
export function getCsvTemplate(): string {
  return 'timestamp,city,observed_event,model_level,baseline_level,persistence_level\n';
}
