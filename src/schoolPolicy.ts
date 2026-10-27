/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  HeatIndexResult,
  HeatStressCategory,
  HourlySchoolAssessment,
  RawHourlyVariables,
  SchoolActivityAssessment,
  SchoolActivityType,
  SchoolAssessmentStatus,
  SchoolPolicyConfig,
  SchoolPolicyRule,
  SchoolRecommendedAction,
  TriggeredRuleResult,
} from './types.ts';

/**
 * Checks if a value is a valid, finite number (not null, undefined, NaN, Infinity, -Infinity).
 */
export function isFiniteNumber(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val);
}

/**
 * Protective ordering of school actions from most protective to least protective.
 */
export const ACTION_PROTECTION_LEVEL: Record<SchoolRecommendedAction, number> = {
  suspend: 4,
  indoor_only: 3,
  modified: 2,
  normal: 1,
};

export const STANDARD_PROTECTIVE_PRECEDENCE: SchoolRecommendedAction[] = [
  'suspend',
  'indoor_only',
  'modified',
  'normal',
];

/**
 * Detects unsupported claims that conditions or outdoor activities are completely safe or approved.
 * Distinguishes unverified overclaims from valid cautious advice (e.g. routine precautions).
 */
export function hasUnsupportedSafetyClaims(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const overclaimPatterns = [
    /\b(?:conditions|air|environment|outdoor\s+play|outdoor\s+activities|it)\s+(?:are|is)\s+(?:completely\s+|entirely\s+|totally\s+)?safe\b/i,
    /\b(?:completely|guaranteed|entirely|totally)\s+safe\b/i,
    /\bofficially\s+approved\b/i,
    /\bapproved\s+for\s+all\s+(?:outdoor\s+)?activities\b/i,
    /\b(?:no|zero)\s+risk\b/i,
    /\bsafe\s+to\s+proceed\s+without\s+precautions\b/i,
  ];
  return overclaimPatterns.some((pattern) => pattern.test(text));
}

/**
 * Resolves precedence among triggered actions, strictly guaranteeing that an incomplete
 * or malformed precedence configuration can NEVER select a less protective action
 * than any triggered rule requires.
 */
export function resolvePrecedence(
  triggeredActions: SchoolRecommendedAction[],
  configuredPrecedence?: SchoolRecommendedAction[]
): SchoolRecommendedAction {
  if (triggeredActions.length === 0) return 'normal';

  // Highest protection demanded by any triggered rule
  const maxRequiredProtection = Math.max(
    ...triggeredActions.map((a) => ACTION_PROTECTION_LEVEL[a] ?? 1)
  );

  // Build sanitized precedence order: start with valid configured actions, then append remaining standard actions
  const sanitizedOrder: SchoolRecommendedAction[] = [];
  if (Array.isArray(configuredPrecedence)) {
    for (const action of configuredPrecedence) {
      if (
        STANDARD_PROTECTIVE_PRECEDENCE.includes(action) &&
        !sanitizedOrder.includes(action)
      ) {
        sanitizedOrder.push(action);
      }
    }
  }
  for (const action of STANDARD_PROTECTIVE_PRECEDENCE) {
    if (!sanitizedOrder.includes(action)) {
      sanitizedOrder.push(action);
    }
  }

  // Find candidate action from sanitized precedence order
  let candidate: SchoolRecommendedAction = 'normal';
  for (const action of sanitizedOrder) {
    if (triggeredActions.includes(action)) {
      candidate = action;
      break;
    }
  }

  // Safety invariant: incomplete or malformed precedence configuration
  // CANNOT select a less protective action than any triggered rule demands!
  if ((ACTION_PROTECTION_LEVEL[candidate] ?? 1) < maxRequiredProtection) {
    const protectiveAction = triggeredActions.find(
      (a) => ACTION_PROTECTION_LEVEL[a] === maxRequiredProtection
    );
    if (protectiveAction) {
      candidate = protectiveAction;
    }
  }

  return candidate;
}

/**
 * Calculates the Heat Index using the official NOAA / Steadman regression equation.
 * Returns both Celsius and Fahrenheit values and standard heat stress category.
 *
 * Requirements:
 * - If inputs are missing or non-finite (null, undefined, NaN, Infinity, -Infinity), explicitly returns unavailable.
 * - Never treats missing temperature or humidity as zero.
 */
export function calculateHeatIndex(
  temperatureCelsius: number | null | undefined,
  relativeHumidity: number | null | undefined
): HeatIndexResult {
  if (
    !isFiniteNumber(temperatureCelsius) ||
    !isFiniteNumber(relativeHumidity)
  ) {
    return {
      heatIndexCelsius: null,
      heatIndexFahrenheit: null,
      category: 'not applicable',
      isAvailable: false,
      notes: 'Assessment unavailable: required temperature or humidity data is missing or invalid.',
    };
  }

  // Convert Celsius to Fahrenheit for NOAA formula
  const T = temperatureCelsius * 1.8 + 32;
  const RH = relativeHumidity;

  // For low ambient temperature (< 68°F / 20°C), heat index is not meaningful
  if (T < 68) {
    return {
      heatIndexCelsius: null,
      heatIndexFahrenheit: null,
      category: 'not applicable',
      isAvailable: false,
      notes: 'Heat index is not meaningful when ambient temperature is below 20°C (68°F).',
    };
  }

  // Simple preliminary heat index
  let hi = 0.5 * (T + 61.0 + (T - 68.0) * 1.2 + RH * 0.094);

  // If average is 80°F or above, apply the full Rothfusz regression
  if (hi >= 80) {
    hi =
      -42.379 +
      2.04901523 * T +
      10.14333127 * RH -
      0.22475541 * T * RH -
      0.00683783 * T * T -
      0.05481717 * RH * RH +
      0.00122874 * T * T * RH +
      0.00085282 * T * RH * RH -
      0.00000199 * T * T * RH * RH;

    // NOAA low-humidity adjustment
    if (RH < 13 && T >= 80 && T <= 112) {
      const adj = ((13 - RH) / 4) * Math.sqrt((17 - Math.abs(T - 95.0)) / 17);
      hi -= adj;
    }
    // NOAA high-humidity adjustment
    else if (RH > 85 && T >= 80 && T <= 87) {
      const adj = ((RH - 85) / 10) * ((87 - T) / 5);
      hi += adj;
    }
  }

  const hiF = Math.round(hi * 10) / 10;
  const hiC = Math.round(((hi - 32) / 1.8) * 10) / 10;

  // Standard NOAA Heat Stress Categories (NWS general reference, not school policy)
  let category: HeatStressCategory = 'Below Caution range';
  let notes = 'Heat index is below the Caution range (NWS general reference, not school policy).';

  if (hiC >= 54) {
    category = 'Extreme Danger';
    notes = 'Heat stroke highly likely with continued outdoor exposure.';
  } else if (hiC >= 41) {
    category = 'Danger';
    notes = 'Sunstroke and heat exhaustion likely; heat stroke possible with prolonged activity.';
  } else if (hiC >= 32) {
    category = 'Extreme Caution';
    notes = 'Sunstroke, muscle cramps, and heat exhaustion possible with prolonged physical activity.';
  } else if (hiC >= 27) {
    category = 'Caution';
    notes = 'Fatigue possible with prolonged exposure and physical activity.';
  }

  return {
    heatIndexCelsius: hiC,
    heatIndexFahrenheit: hiF,
    category,
    isAvailable: true,
    notes,
  };
}

/**
 * Default Unconfigured Policy State.
 * As required by the sequencing instructions:
 * "Until the verified policy is provided, display a clear 'School policy configuration required' state."
 */
export const DEFAULT_UNCONFIGURED_POLICY: SchoolPolicyConfig = {
  isConfigured: false,
  schoolName: 'Pending Policy Configuration',
  policyVersion: '0.0 (Unconfigured)',
  effectiveDate: 'Pending Approved Guidelines',
  approvedBy: 'Awaiting Approved School Rules',
  sourceDocument: 'School operational policy documentation pending verification.',
  isFictionalDemo: false,
  rules: [],
  precedenceOrder: ['suspend', 'indoor_only', 'modified', 'normal'],
};

/**
 * Fictional Demo Policy.
 * Explicitly labelled for testing and presentation only.
 * Never presented as actual school policy.
 */
export const FICTIONAL_DEMO_POLICY: SchoolPolicyConfig = {
  isConfigured: true,
  isFictionalDemo: true,
  schoolName: 'Example UAE Academy (Demonstration Only)',
  policyVersion: '1.0-DEMO (Fictional Test Data)',
  effectiveDate: '2026-10-01',
  approvedBy: 'Health & Safety Committee (Fictional Test Sample)',
  sourceDocument: 'Fictional School Outdoor Break & Physical Activity Guidelines 2026',
  rules: [
    {
      id: 'heat-danger-break',
      name: 'High Heat Stress Outdoor Restriction (Break)',
      activity: 'break',
      metric: 'heat_index',
      operator: '>=',
      threshold: 40,
      unit: '°C',
      recommendedAction: 'indoor_only',
      actionTitle: 'Move break indoors',
      actionGuidance: 'Outdoor break should be moved indoors. Heat index exceeds the configured 40°C threshold.',
      reason: 'Calculated Heat Index is in the high danger zone for free outdoor play.',
      sourceReference: 'Fictional Section 4.2',
      severity: 2,
    },
    {
      id: 'heat-caution-pe',
      name: 'Moderate Heat Stress Modification (PE)',
      activity: 'pe',
      metric: 'heat_index',
      operator: '>=',
      threshold: 35,
      unit: '°C',
      recommendedAction: 'modified',
      actionTitle: 'Modify PE activities (mandatory hydration and shade)',
      actionGuidance: 'Reduce continuous vigorous cardio. Mandate shade rests and water breaks every 15 minutes.',
      reason: 'Heat index >= 35°C requires reduced physical intensity.',
      sourceReference: 'Fictional Section 4.3',
      severity: 1,
    },
    {
      id: 'heat-danger-pe',
      name: 'High Heat Stress Outdoor Prohibition (PE)',
      activity: 'pe',
      metric: 'heat_index',
      operator: '>=',
      threshold: 41,
      unit: '°C',
      recommendedAction: 'indoor_only',
      actionTitle: 'Move PE to indoor gymnasium',
      actionGuidance: 'Outdoor physical education sessions are prohibited. Conduct PE inside air-conditioned sports hall.',
      reason: 'Heat index >= 41°C falls into Danger category for vigorous activity.',
      sourceReference: 'Fictional Section 4.4',
      severity: 2,
    },
    {
      id: 'pm10-advisory-all',
      name: 'Elevated Particulate Air Quality Advisory',
      activity: 'all',
      metric: 'pm10',
      operator: '>=',
      threshold: 150,
      unit: 'µg/m³',
      recommendedAction: 'modified',
      actionTitle: 'Accommodate sensitive students with respiratory conditions',
      actionGuidance: 'Permit students with asthma, allergies, or breathing conditions to remain indoors in air-conditioned areas.',
      reason: 'PM10 concentration >= 150 µg/m³ indicates hazy particulate conditions.',
      sourceReference: 'Fictional Section 5.1',
      severity: 1,
    },
    {
      id: 'pm10-severe-all',
      name: 'Severe Particulate Outdoor Restriction',
      activity: 'all',
      metric: 'pm10',
      operator: '>=',
      threshold: 250,
      unit: 'µg/m³',
      recommendedAction: 'indoor_only',
      actionTitle: 'Keep all students indoors; close perimeter doors',
      actionGuidance: 'Suspend all student outdoor activities. Keep classroom windows and building perimeter doors closed.',
      reason: 'PM10 concentration >= 250 µg/m³ indicates severe particulate pollution or blowing dust.',
      sourceReference: 'Fictional Section 5.2',
      severity: 2,
    },
    {
      id: 'dust-severe-all',
      name: 'Mineral Dust Concentration Alert',
      activity: 'all',
      metric: 'dust',
      operator: '>=',
      threshold: 200,
      unit: 'µg/m³',
      recommendedAction: 'indoor_only',
      actionTitle: 'Move all student activities indoors due to dust',
      actionGuidance: 'Model-estimated mineral dust concentration exceeds 200 µg/m³. Restrict outdoor exposure.',
      reason: 'Dust forecast exceeds configured threshold.',
      sourceReference: 'Fictional Section 5.3',
      severity: 2,
    },
    {
      id: 'wind-gusts-break',
      name: 'High Wind Gust Hazard',
      activity: 'break',
      metric: 'wind_gusts',
      operator: '>=',
      threshold: 50,
      unit: 'km/h',
      recommendedAction: 'indoor_only',
      actionTitle: 'Restrict outdoor playground use (wind gusts)',
      actionGuidance: 'High wind gusts can cause flying debris and eye irritation. Move playground activities indoors.',
      reason: 'Wind gusts >= 50 km/h exceed safe playground thresholds.',
      sourceReference: 'Fictional Section 6.1',
      severity: 2,
    },
  ],
  precedenceOrder: ['suspend', 'indoor_only', 'modified', 'normal'],
};

const VALID_METRICS = new Set([
  'heat_index',
  'temperature',
  'relative_humidity',
  'pm10',
  'pm2_5',
  'dust',
  'wind_speed',
  'wind_gusts',
  'visibility',
]);

const VALID_OPERATORS = new Set(['>', '>=', '<', '<=']);
const VALID_ACTIONS = new Set(['normal', 'modified', 'indoor_only', 'suspend']);
const VALID_ACTIVITIES = new Set(['break', 'pe', 'lunch_other', 'all']);

/**
 * Validates a policy rule object at runtime.
 */
function isValidRule(rule: unknown): rule is SchoolPolicyRule {
  if (!rule || typeof rule !== 'object') return false;
  const r = rule as Record<string, unknown>;

  if (typeof r.id !== 'string' || r.id.trim().length === 0) return false;
  if (typeof r.name !== 'string' || r.name.trim().length === 0) return false;
  if (typeof r.activity !== 'string' || !VALID_ACTIVITIES.has(r.activity)) return false;
  if (typeof r.metric !== 'string' || !VALID_METRICS.has(r.metric)) return false;
  if (typeof r.operator !== 'string' || !VALID_OPERATORS.has(r.operator)) return false;
  if (typeof r.threshold !== 'number' || !Number.isFinite(r.threshold)) return false;
  if (typeof r.unit !== 'string') return false;
  if (typeof r.recommendedAction !== 'string' || !VALID_ACTIONS.has(r.recommendedAction)) return false;
  if (typeof r.actionTitle !== 'string') return false;
  if (typeof r.actionGuidance !== 'string') return false;
  if (typeof r.reason !== 'string') return false;
  if (typeof r.severity !== 'number' || !Number.isFinite(r.severity)) return false;

  return true;
}

/**
 * Validates policy data loaded from localStorage at runtime.
 * Validates the rule structure, metric, operator, finite threshold, action, activity,
 * severity, and precedence order.
 * If data is invalid or corrupt, fails safely to DEFAULT_UNCONFIGURED_POLICY.
 */
export function validateSchoolPolicy(data: unknown): SchoolPolicyConfig {
  if (!data || typeof data !== 'object') {
    return DEFAULT_UNCONFIGURED_POLICY;
  }

  const p = data as Record<string, unknown>;

  if (typeof p.isConfigured !== 'boolean') {
    return DEFAULT_UNCONFIGURED_POLICY;
  }
  if (typeof p.schoolName !== 'string' || p.schoolName.trim().length === 0) {
    return DEFAULT_UNCONFIGURED_POLICY;
  }
  if (typeof p.policyVersion !== 'string') {
    return DEFAULT_UNCONFIGURED_POLICY;
  }
  if (typeof p.effectiveDate !== 'string') {
    return DEFAULT_UNCONFIGURED_POLICY;
  }
  if (!Array.isArray(p.rules)) {
    return DEFAULT_UNCONFIGURED_POLICY;
  }

  // Validate all rules
  const validatedRules: SchoolPolicyRule[] = [];
  for (const rule of p.rules) {
    if (!isValidRule(rule)) {
      return DEFAULT_UNCONFIGURED_POLICY;
    }
    validatedRules.push(rule);
  }

  // Sanitize precedence order
  const precedenceOrder: SchoolRecommendedAction[] = [];
  if (Array.isArray(p.precedenceOrder)) {
    for (const a of p.precedenceOrder) {
      if (typeof a === 'string' && VALID_ACTIONS.has(a) && !precedenceOrder.includes(a as SchoolRecommendedAction)) {
        precedenceOrder.push(a as SchoolRecommendedAction);
      }
    }
  }

  // Ensure all 4 actions exist in precedence order
  for (const action of STANDARD_PROTECTIVE_PRECEDENCE) {
    if (!precedenceOrder.includes(action)) {
      precedenceOrder.push(action);
    }
  }

  return {
    isConfigured: p.isConfigured,
    schoolName: p.schoolName,
    policyVersion: p.policyVersion,
    effectiveDate: p.effectiveDate,
    approvedBy: typeof p.approvedBy === 'string' ? p.approvedBy : undefined,
    sourceDocument: typeof p.sourceDocument === 'string' ? p.sourceDocument : undefined,
    isFictionalDemo: p.isFictionalDemo === true,
    rules: validatedRules,
    precedenceOrder,
  };
}

/**
 * Extracts the metric value corresponding to a rule from the raw environmental variables.
 * Returns null if the reading is missing or non-finite (e.g. NaN, Infinity, -Infinity).
 */
function getMetricValue(
  metric: SchoolPolicyRule['metric'],
  raw: RawHourlyVariables,
  heatIndex: HeatIndexResult
): number | null {
  let val: number | null = null;
  switch (metric as string) {
    case 'heat_index':
    case 'heatIndex':
      val = heatIndex.heatIndexCelsius;
      break;
    case 'temperature':
      val = raw.temperature_2m;
      break;
    case 'relative_humidity':
    case 'relativeHumidity':
      val = raw.relative_humidity_2m;
      break;
    case 'pm10':
      val = raw.pm10;
      break;
    case 'pm2_5':
      val = raw.pm2_5;
      break;
    case 'dust':
      val = raw.dust;
      break;
    case 'wind_speed':
    case 'windSpeed':
      val = raw.wind_speed_10m;
      break;
    case 'wind_gusts':
    case 'windGusts':
      val = raw.wind_gusts_10m;
      break;
    case 'visibility':
      val = raw.visibility;
      break;
    default:
      val = null;
  }
  return isFiniteNumber(val) ? val : null;
}

/**
 * Evaluates whether an observed value triggers a rule threshold.
 */
function isRuleTriggered(operator: SchoolPolicyRule['operator'], value: number, threshold: number): boolean {
  switch (operator) {
    case '>':
      return value > threshold;
    case '>=':
      return value >= threshold;
    case '<':
      return value < threshold;
    case '<=':
      return value <= threshold;
    default:
      return false;
  }
}

/**
 * Evaluates a single hour of environmental readings against a configured school policy
 * for a specific activity type (Break, PE, Lunch/Other).
 *
 * Clearly distinguishes 5 mutually distinct evaluation outcomes:
 * 1. policy_unconfigured: Policy is not configured yet.
 * 2. no_applicable_rules: Policy is configured, but zero rules apply to this activity.
 * 3. assessment_unavailable: Rules exist, but missing/invalid readings prevent verification.
 * 4. criteria_met_no_actions: Rules were evaluated and no thresholds were exceeded.
 * 5. action_triggered: One or more rules were triggered. (Marked isIncomplete: true if other rules lacked data).
 */
export function evaluateActivityPolicy(
  raw: RawHourlyVariables,
  heatIndex: HeatIndexResult,
  policy: SchoolPolicyConfig,
  activity: SchoolActivityType
): SchoolActivityAssessment {
  // 1. Outcome: Policy unconfigured
  if (!policy || !policy.isConfigured) {
    return {
      status: 'policy_unconfigured',
      recommendedAction: 'normal',
      actionTitle: 'School policy configuration required',
      primaryGuidance: 'Review the applicable school policy. Authorized school thresholds have not been configured yet.',
      reason: 'School policy is not configured.',
      triggeredRules: [],
      conflictingRules: false,
      dataMissingForAssessment: false,
      isIncomplete: false,
      evaluatedRulesCount: 0,
      totalApplicableRulesCount: 0,
    };
  }

  // Filter rules that apply to this activity or all activities
  const relevantRules = policy.rules.filter(
    (r) => r.activity === activity || r.activity === 'all'
  );

  // 2. Outcome: No applicable rules configured for this activity
  // Must NEVER be reported as "Conditions meet the configured criteria"
  if (relevantRules.length === 0) {
    return {
      status: 'no_applicable_rules',
      recommendedAction: 'normal',
      actionTitle: 'No applicable rules configured for this activity',
      primaryGuidance: 'No approved policy rules are defined for this activity under the active school policy. Review school operational guidelines or configure activity-specific rules.',
      reason: 'No applicable rules configured for this activity.',
      triggeredRules: [],
      conflictingRules: false,
      dataMissingForAssessment: false,
      isIncomplete: false,
      evaluatedRulesCount: 0,
      totalApplicableRulesCount: 0,
    };
  }

  const triggeredResults: TriggeredRuleResult[] = [];
  let evaluatedRulesCount = 0;
  let missingRulesCount = 0;

  for (const rule of relevantRules) {
    const val = getMetricValue(rule.metric, raw, heatIndex);

    if (val === null) {
      // If rule is heat_index and heat index is not applicable solely because
      // ambient temperature is below 20°C (68°F), but temperature and humidity are valid finite numbers:
      if (
        (rule.metric === 'heat_index' || (rule.metric as string) === 'heatIndex') &&
        isFiniteNumber(raw.temperature_2m) &&
        isFiniteNumber(raw.relative_humidity_2m) &&
        raw.temperature_2m < 20
      ) {
        // For high-heat safety threshold rules (operator '>=' or '>' with threshold >= 20°C):
        // Apparent temperature at T < 20°C cannot exceed a high-heat threshold >= 20°C.
        if ((rule.operator === '>=' || rule.operator === '>') && rule.threshold >= 20) {
          evaluatedRulesCount++;
          triggeredResults.push({
            rule,
            observedValue: null,
            unit: rule.unit,
            thresholdValue: rule.threshold,
            isTriggered: false,
            isDataMissing: false,
          });
          continue;
        }
      }

      // Genuinely missing or non-finite reading
      missingRulesCount++;
      triggeredResults.push({
        rule,
        observedValue: null,
        unit: rule.unit,
        thresholdValue: rule.threshold,
        isTriggered: false,
        isDataMissing: true,
      });
      continue;
    }

    evaluatedRulesCount++;
    const triggered = isRuleTriggered(rule.operator, val, rule.threshold);
    if (triggered) {
      triggeredResults.push({
        rule,
        observedValue: val,
        unit: rule.unit,
        thresholdValue: rule.threshold,
        isTriggered: true,
        isDataMissing: false,
      });
    }
  }

  const actuallyTriggered = triggeredResults.filter((r) => r.isTriggered);

  // 3 & 4. Outcomes when NO rules triggered
  if (actuallyTriggered.length === 0) {
    if (missingRulesCount > 0) {
      // 3. Outcome: Assessment unavailable due to missing/invalid data
      return {
        status: 'assessment_unavailable',
        recommendedAction: 'normal',
        actionTitle: 'Assessment unavailable: required data is missing',
        primaryGuidance: 'Review the applicable school policy. Some environmental readings are unavailable and cannot be verified against school thresholds.',
        reason: 'One or more required inputs are missing or invalid.',
        triggeredRules: triggeredResults,
        conflictingRules: false,
        dataMissingForAssessment: true,
        isIncomplete: true,
        evaluatedRulesCount,
        totalApplicableRulesCount: relevantRules.length,
      };
    }

    // 4. Outcome: All applicable rules were evaluated and none triggered
    return {
      status: 'criteria_met_no_actions',
      recommendedAction: 'normal',
      actionTitle: 'Conditions meet the configured criteria for this activity',
      primaryGuidance: 'Conditions meet the configured criteria for this activity under current school thresholds. Continue monitoring for changing conditions.',
      reason: 'No configured school policy thresholds were exceeded for this hour.',
      triggeredRules: [],
      conflictingRules: false,
      dataMissingForAssessment: false,
      isIncomplete: false,
      evaluatedRulesCount,
      totalApplicableRulesCount: relevantRules.length,
    };
  }

  // 5. Outcome: One or more actions triggered
  // If some rules triggered but other applicable rules could not be evaluated,
  // preserve the triggered action but mark the assessment incomplete!
  const isIncomplete = missingRulesCount > 0;

  const triggeredActions = actuallyTriggered.map((tr) => tr.rule.recommendedAction);
  const winningAction = resolvePrecedence(triggeredActions, policy.precedenceOrder);

  // Select winning rule for guidance context
  const matchingRules = actuallyTriggered.filter(
    (tr) => tr.rule.recommendedAction === winningAction
  );
  matchingRules.sort((a, b) => b.rule.severity - a.rule.severity);
  const winningRule = matchingRules[0]?.rule;

  // Check conflicting rules across different actions
  const uniqueActions = new Set(triggeredActions);
  const conflicting = uniqueActions.size > 1;

  let titleText = winningRule?.actionTitle || 'A configured threshold has been exceeded';
  let guidanceText = winningRule?.actionGuidance || 'Review the applicable school policy for recommended activity adjustments.';
  let reasonText = winningRule
    ? `A configured threshold has been exceeded: ${winningRule.name} (${winningRule.metric} ${winningRule.operator} ${winningRule.threshold} ${winningRule.unit}).`
    : 'A configured school threshold has been exceeded.';

  if (isIncomplete) {
    guidanceText += ' Note: This assessment is partial; additional applicable environmental readings were unavailable.';
    reasonText += ' (Assessment is incomplete: some rule metrics were missing/invalid).';
  }

  return {
    status: 'action_triggered',
    recommendedAction: winningAction,
    actionTitle: titleText,
    primaryGuidance: guidanceText,
    reason: reasonText,
    triggeredRules: triggeredResults,
    conflictingRules: conflicting,
    dataMissingForAssessment: isIncomplete,
    isIncomplete,
    evaluatedRulesCount,
    totalApplicableRulesCount: relevantRules.length,
  };
}

/**
 * Normalizes reading to number or null, safely eliminating NaN, Infinity, -Infinity.
 */
function safeFiniteNumber(val: unknown): number | null {
  return isFiniteNumber(val) ? val : null;
}

/**
 * Builds the complete 12-hour school assessment for a city.
 */
export function buildHourlySchoolAssessments(
  hourlyVariables: RawHourlyVariables[],
  policy: SchoolPolicyConfig
): HourlySchoolAssessment[] {
  return hourlyVariables.map((raw, idx) => {
    const tempSafe = safeFiniteNumber(raw.temperature_2m);
    const rhSafe = safeFiniteNumber(raw.relative_humidity_2m);
    const pm10Safe = safeFiniteNumber(raw.pm10);
    const pm2_5Safe = safeFiniteNumber(raw.pm2_5);
    const dustSafe = safeFiniteNumber(raw.dust);
    const windSpeedSafe = safeFiniteNumber(raw.wind_speed_10m);
    const windGustsSafe = safeFiniteNumber(raw.wind_gusts_10m);
    const windDirSafe = safeFiniteNumber(raw.wind_direction_10m);
    const visSafe = safeFiniteNumber(raw.visibility);

    const heatIndex = calculateHeatIndex(tempSafe, rhSafe);

    const missingReadings: string[] = [];
    if (tempSafe === null) missingReadings.push('Temperature');
    if (rhSafe === null) missingReadings.push('Relative humidity');
    if (pm10Safe === null) missingReadings.push('PM10');
    if (pm2_5Safe === null) missingReadings.push('PM2.5');
    if (dustSafe === null) missingReadings.push('Dust');
    if (windSpeedSafe === null) missingReadings.push('Wind speed');
    if (windGustsSafe === null) missingReadings.push('Wind gusts');

    const cleanRaw: RawHourlyVariables = {
      ...raw,
      temperature_2m: tempSafe,
      relative_humidity_2m: rhSafe,
      pm10: pm10Safe,
      pm2_5: pm2_5Safe,
      dust: dustSafe,
      wind_speed_10m: windSpeedSafe,
      wind_gusts_10m: windGustsSafe,
      wind_direction_10m: windDirSafe,
      visibility: visSafe,
    };

    const breakAssessment = evaluateActivityPolicy(cleanRaw, heatIndex, policy, 'break');
    const peAssessment = evaluateActivityPolicy(cleanRaw, heatIndex, policy, 'pe');
    const lunchAssessment = evaluateActivityPolicy(cleanRaw, heatIndex, policy, 'lunch_other');

    const displayHour = raw.time.includes('T')
      ? raw.time.split('T')[1].substring(0, 5)
      : raw.time;

    return {
      hourIndex: idx,
      time: raw.time,
      displayHour,
      environmentalReadings: {
        temperature: tempSafe,
        relativeHumidity: rhSafe,
        heatIndex,
        pm10: pm10Safe,
        pm2_5: pm2_5Safe,
        dust: dustSafe,
        windSpeed: windSpeedSafe,
        windGusts: windGustsSafe,
        windDirection: windDirSafe,
        visibility: visSafe,
      },
      missingReadings,
      activityAssessments: {
        break: breakAssessment,
        pe: peAssessment,
        lunch_other: lunchAssessment,
      },
      officialAlertDetected: false,
      officialAlertFeedStatus: 'unconnected_external_source',
    };
  });
}
