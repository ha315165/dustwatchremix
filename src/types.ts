/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type RiskCategory = 'Low' | 'Moderate' | 'High' | 'Very High';
export type RiskAbbr = 'L' | 'M' | 'H' | 'VH';
export type ConfidenceLevel = 'Low' | 'Medium' | 'High';

export interface CityLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface RawHourlyVariables {
  time: string; // ISO string or YYYY-MM-DDTHH:00
  pm10: number | null;
  pm2_5: number | null;
  dust: number | null;
  aerosol_optical_depth: number | null;
  wind_speed_10m: number | null;
  wind_gusts_10m: number | null;
  wind_direction_10m: number | null;
  relative_humidity_2m: number | null;
  temperature_2m: number | null;
  visibility: number | null;
}

export interface VariableThreshold {
  low: number;
  high: number;
  weight: number;
  reversed?: boolean;
  unit: string;
  displayName: string;
}

export interface ThresholdConfig {
  dust: VariableThreshold;
  pm10: VariableThreshold;
  wind_gusts_10m: VariableThreshold;
  wind_speed_10m: VariableThreshold;
  aerosol_optical_depth: VariableThreshold;
  visibility: VariableThreshold;
  relative_humidity_2m: VariableThreshold;
}

export interface CategoryCutoffs {
  Low: [number, number];
  Moderate: [number, number];
  High: [number, number];
  'Very High': [number, number];
}

export interface SubScoreDetail {
  variableKey: keyof ThresholdConfig;
  displayName: string;
  rawValue: number | null;
  unit: string;
  subScore: number | null; // 0-100 or null if missing
  weight: number;
  effectiveWeight: number;
  status: 'low' | 'moderate' | 'high' | 'missing';
  reversed?: boolean;
}

export interface HourlyRiskResult {
  hourIndex: number; // 0 to 11
  time: string; // ISO / formatted hour in Asia/Dubai
  displayHour: string; // e.g. "14:00" or "2 PM"
  baselineScore: number; // 0-100
  baselineCategory: RiskCategory;
  modelScore?: number; // 0-100 if model applied
  modelCategory?: RiskCategory;
  finalScore: number; // baseline or modelScore
  category: RiskCategory;
  missingVariables: string[];
  subScores: Record<string, SubScoreDetail>;
  topContributors: string[];
  isParticleCapped: boolean;
  contextVariables: {
    pm2_5: { value: number | null; unit: string };
    temperature_2m: { value: number | null; unit: string };
  };
}

export interface TimeWindow {
  startHourIndex: number;
  endHourIndex: number;
  displayRange: string; // e.g. "14:00 - 17:00"
  averageScore: number;
  level: RiskCategory;
}

export interface CityOutlook {
  city: CityLocation;
  levelNow: RiskCategory;
  scoreNow: number;
  peakHourIndex: number;
  peakHourTime: string;
  peakLevel: RiskCategory;
  peakScore: number;
  bestWindow: TimeWindow;
  worstWindow: TimeWindow;
  confidence: ConfidenceLevel;
  confidenceReasons: string[];
  hourlyResults: HourlyRiskResult[];
  activeModelInfo?: {
    name: string;
    version: string;
    trainedDate: string;
  };
  dataSourceType: 'live' | 'cached' | 'sample' | 'snapshot';
  fetchTime: string; // Asia/Dubai formatted
  fetchTimestamp: number;
  isUnavailable?: boolean;
  unavailableReason?: string;
}

export interface AdviceResponse {
  schools: string;
  workers: string;
  families: string;
  isAI: boolean;
  modelName?: string;
  peakLevel: RiskCategory;
  worstWindowText: string;
  cityName: string;
}

export interface ModelFileConfig {
  model_name: string;
  model_type: 'logistic_regression';
  version: string;
  trained_on: string;
  trained_date: string;
  feature_names: string[];
  coefficients: number[];
  intercept: number;
  scaler?: {
    mean: number[];
    scale: number[];
  };
  probability_cutoffs: {
    moderate: number;
    high: number;
    very_high: number;
  };
}

export interface EvaluationPredictorStats {
  hits: number;
  misses: number;
  falseAlarms: number;
  correctNegatives: number;
  total: number;
  hitRate: number | null; // hits / (hits + misses)
  missRate: number | null; // misses / (hits + misses)
  falseAlarmRatio: number | null; // falseAlarms / (hits + falseAlarms)
  accuracy: number | null; // (hits + correctNegatives) / total
}

export interface EvaluationResultSet {
  datasetDescription: string;
  period: string;
  cities: string[];
  eventDefinitionUsed: string;
  eventPredictionLevel: RiskCategory;
  observedEventsCount: number;
  totalRows: number;
  predictors: {
    baselineRuleScore: EvaluationPredictorStats;
    trainedModel?: EvaluationPredictorStats;
    persistenceBenchmark?: EvaluationPredictorStats;
  };
  teamNotes?: string;
  isSynthetic?: boolean;
  isSample?: boolean;
  isUnknownOrigin?: boolean;
  hindcastLabel?: string;
  searchedPeriod?: { start: string; end: string };
  thresholdsUsed?: Record<string, unknown>;
  splitInfo?: SplitEvaluationStats;
}

export interface CsvRowValidation {
  rowNumber: number;
  timestamp: string;
  city: string;
  observed_event: 0 | 1;
  model_level: RiskCategory;
  baseline_level: RiskCategory;
  persistence_level?: RiskCategory;
  isValid: boolean;
  error?: string;
}

export interface OpenMeteoAirQualityResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  hourly: {
    time: string[];
    pm10?: (number | null)[];
    pm2_5?: (number | null)[];
    dust?: (number | null)[];
    aerosol_optical_depth?: (number | null)[];
  };
}

export interface OpenMeteoWeatherResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  hourly: {
    time: string[];
    wind_speed_10m?: (number | null)[];
    wind_gusts_10m?: (number | null)[];
    wind_direction_10m?: (number | null)[];
    relative_humidity_2m?: (number | null)[];
    temperature_2m?: (number | null)[];
    visibility?: (number | null)[];
  };
}

export interface RawCityData {
  city: CityLocation;
  airQuality: OpenMeteoAirQualityResponse;
  weather: OpenMeteoWeatherResponse;
  fetchTimestamp: number;
  isSampleOrSnapshot?: boolean;
  snapshotLabel?: string;
  simulatedOldHours?: number;
  isSynthetic?: boolean;
  isSample?: boolean;
  isUnknownOrigin?: boolean;
}

export type SchoolActivityType = 'break' | 'pe' | 'lunch_other';

export type SchoolRecommendedAction = 'normal' | 'modified' | 'indoor_only' | 'suspend';

export const VALID_ASSESSMENT_STATUSES = [
  'policy_unconfigured',
  'no_applicable_rules',
  'assessment_unavailable',
  'criteria_met_no_actions',
  'action_triggered',
] as const;

export type SchoolAssessmentStatus = (typeof VALID_ASSESSMENT_STATUSES)[number];

export type HeatStressCategory =
  | 'Below Caution range'
  | 'Caution'
  | 'Extreme Caution'
  | 'Danger'
  | 'Extreme Danger'
  | 'not applicable'
  | 'Unavailable';

export interface HeatIndexResult {
  heatIndexCelsius: number | null;
  heatIndexFahrenheit: number | null;
  category: HeatStressCategory;
  isAvailable: boolean;
  notes: string;
}

export interface SchoolPolicyRule {
  id: string;
  name: string;
  activity: SchoolActivityType | 'all';
  metric:
    | 'heat_index'
    | 'temperature'
    | 'relative_humidity'
    | 'pm10'
    | 'pm2_5'
    | 'dust'
    | 'wind_speed'
    | 'wind_gusts'
    | 'visibility';
  operator: '>' | '>=' | '<' | '<=';
  threshold: number;
  unit: string;
  recommendedAction: SchoolRecommendedAction;
  actionTitle: string;
  actionGuidance: string;
  reason: string;
  sourceReference?: string;
  severity: number; // 1 = advisory/modified, 2 = indoor only, 3 = suspend
}

export interface SchoolPolicyConfig {
  isConfigured: boolean; // false until verified school policy supplied
  schoolName: string;
  policyVersion: string;
  effectiveDate: string;
  approvedBy?: string;
  sourceDocument?: string;
  isFictionalDemo?: boolean;
  rules: SchoolPolicyRule[];
  precedenceOrder: SchoolRecommendedAction[];
}

export interface TriggeredRuleResult {
  rule: SchoolPolicyRule;
  observedValue: number | null;
  unit: string;
  thresholdValue: number;
  isTriggered: boolean;
  isDataMissing: boolean;
}

export interface SchoolActivityAssessment {
  status: SchoolAssessmentStatus;
  recommendedAction: SchoolRecommendedAction;
  actionTitle: string;
  primaryGuidance: string;
  reason: string;
  triggeredRules: TriggeredRuleResult[];
  conflictingRules: boolean;
  dataMissingForAssessment: boolean;
  isIncomplete: boolean;
  evaluatedRulesCount: number;
  totalApplicableRulesCount: number;
}

export interface HourlySchoolAssessment {
  hourIndex: number;
  time: string;
  displayHour: string;
  environmentalReadings: {
    temperature: number | null;
    relativeHumidity: number | null;
    heatIndex: HeatIndexResult;
    pm10: number | null;
    pm2_5: number | null;
    dust: number | null;
    windSpeed: number | null;
    windGusts: number | null;
    windDirection: number | null;
    visibility: number | null;
  };
  missingReadings: string[];
  activityAssessments: Record<SchoolActivityType, SchoolActivityAssessment>;
  officialAlertDetected: boolean;
  officialAlertFeedStatus?: 'unconnected_external_source';
}

// ----------------------------------------------------
// Evaluation Workbench Types (Part A: Backtest Builder)
// ----------------------------------------------------

export type EvidenceType =
  | 'satellite_image'
  | 'observation_report'
  | 'ground_measurement'
  | 'reanalysis_data'
  | 'model_forecast';

export interface ObservedEventRow {
  id: string;
  rowNumber: number;
  city: string; // specific city name/id or 'ALL'
  start: string; // ISO Asia/Dubai time e.g. 2026-10-10T08:00
  end: string; // ISO Asia/Dubai time e.g. 2026-10-10T18:00
  evidence_type: EvidenceType;
  source_name: string;
  source_link: string;
  notes: string;
  isIndependent: boolean;
  flagReason?: string;
}

export interface HindcastHourlyPrediction {
  timestamp: string; // ISO string e.g. 2026-10-10T08:00
  cityId: string;
  cityName: string;
  baseline_level: RiskCategory;
  baseline_score: number;
  model_level?: RiskCategory | '';
  persistence_level?: RiskCategory;
  isCoreDataMissing: boolean;
  missingVariables: string[];
  rawVariables: RawHourlyVariables;
  isSynthetic?: boolean;
  isSample?: boolean;
  snapshotLabel?: string;
}

export interface EventEvaluationSummary {
  event: ObservedEventRow;
  highestBaselineLevel: RiskCategory | 'None';
  firstDetectionHour: string | null;
  leadTimeHours: number | null;
  detected: boolean;
}

export interface FalseAlarmEpisode {
  city: string;
  startHour: string;
  endHour: string;
  durationHours: number;
  peakLevel: RiskCategory;
  peakScore: number;
}

export interface WorkbenchMetadata {
  timeGenerated: string;
  daysRequested: number;
  searchedPeriod: { start: string; end: string };
  searchedCities: string[];
  hoursEvaluated: number;
  hoursExcluded: number;
  hoursExcludedReason: string;
  eventsUsed: number;
  eventsExcluded: number;
  excludedEventDetails: Array<{ city: string; start: string; end: string; reason: string }>;
  trainedModelLoaded: boolean;
  activeModelInfo?: { name: string; version: string; trainedDate: string };
  configSnapshot: {
    thresholds: ThresholdConfig;
    cutoffs: unknown;
    confidenceRules: unknown;
    particleCapEnabled: boolean;
    particleCapDustThreshold: number;
    particleCapPm10Threshold: number;
    particleCapMaxScore: number;
    matchToleranceHours: number;
  };
  eventPredictionLevel: RiskCategory;
  eventDefinitionText: string;
  hindcastLabel: string;
  isSynthetic?: boolean;
  isSample?: boolean;
  isUnknownOrigin?: boolean;
}

export interface SplitEvaluationStats {
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
}

export interface WorkbenchEvaluationOutput {
  csvText: string;
  metadataJson: string;
  evaluatedRows: Array<{
    timestamp: string;
    city: string;
    observed_event: 0 | 1;
    model_level: RiskCategory | '';
    baseline_level: RiskCategory;
    persistence_level?: RiskCategory;
  }>;
  metadata: WorkbenchMetadata;
  eventSummaries: EventEvaluationSummary[];
  falseAlarmEpisodes: FalseAlarmEpisode[];
  hasEnoughEvents: boolean;
  splitStats?: SplitEvaluationStats;
  isSynthetic?: boolean;
  isSample?: boolean;
  isUnknownOrigin?: boolean;
}

// ----------------------------------------------------
// Evaluation Workbench Types (Part B: Nurse Comparison)
// ----------------------------------------------------

export type NurseAction = 'normal' | 'shorten' | 'cancel';

export interface NurseComparisonInputRow {
  rowNumber: number;
  date: string; // YYYY-MM-DD
  hour: number; // 0-23
  activity: 'break' | 'pe';
  nurse_action: NurseAction;
}

export type NurseAgreementCategory =
  | 'same_action'
  | 'dustwatch_more_cautious'
  | 'dustwatch_less_cautious';

export interface NurseComparisonResultRow {
  rowNumber: number;
  date: string;
  hour: number;
  timestamp: string;
  city: string;
  activity: 'break' | 'pe';
  nurse_action: NurseAction;
  dustwatch_action?: NurseAction;
  status: 'evaluated' | 'not_evaluated' | 'outside_data';
  agreement_category?: NurseAgreementCategory;
  readings?: {
    temperature: number | null;
    relativeHumidity: number | null;
    heatIndex: number | null;
    pm10: number | null;
    pm2_5: number | null;
    dust: number | null;
    windSpeed: number | null;
    windGusts: number | null;
    visibility: number | null;
  };
  triggeredRules?: string[];
  reason?: string;
}

export interface NurseComparisonSummary {
  totalRows: number;
  evaluatedCount: number;
  sameActionCount: number;
  dustwatchMoreCautiousCount: number;
  dustwatchLessCautiousCount: number;
  notEvaluatedCount: number;
  outsideDataCount: number;
  agreementRatePct: number | null; // (sameAction / evaluatedCount) * 100
  lessCautiousRows: NurseComparisonResultRow[];
  allRows: NurseComparisonResultRow[];
  hindcastLabel: string;
  isSynthetic?: boolean;
  note: string;
}
