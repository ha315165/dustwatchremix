/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateHeatIndex,
  DEFAULT_UNCONFIGURED_POLICY,
  FICTIONAL_DEMO_POLICY,
  evaluateActivityPolicy,
  isFiniteNumber,
  resolvePrecedence,
  validateSchoolPolicy,
} from './schoolPolicy.ts';
import { RawHourlyVariables, SchoolPolicyConfig } from './types.ts';
import { getSchoolModeAdvice } from './geminiService.ts';

test('Heat Index: calculates correct values under moderate and extreme conditions', () => {
  // 1. Moderate heat: 30°C and 50% RH -> ~31°C (Caution)
  const hiModerate = calculateHeatIndex(30, 50);
  assert.equal(hiModerate.isAvailable, true);
  assert.ok(hiModerate.heatIndexCelsius! >= 30 && hiModerate.heatIndexCelsius! <= 33);
  assert.equal(hiModerate.category, 'Caution');

  // 2. High heat: 36°C and 45% RH -> Danger (41 - 54°C)
  const hiDanger = calculateHeatIndex(36, 45);
  assert.equal(hiDanger.isAvailable, true);
  assert.ok(hiDanger.heatIndexCelsius! >= 41 && hiDanger.heatIndexCelsius! < 54);
  assert.equal(hiDanger.category, 'Danger');

  // 3. Cool condition: 18°C (< 20°C / 68°F threshold) -> not applicable
  const hiCool = calculateHeatIndex(18, 55);
  assert.equal(hiCool.isAvailable, false);
  assert.equal(hiCool.heatIndexCelsius, null);
  assert.equal(hiCool.category, 'not applicable');

  // 4. Mild condition: 23°C and 40% RH -> Below Caution range
  const hiMild = calculateHeatIndex(23, 40);
  assert.equal(hiMild.isAvailable, true);
  assert.equal(hiMild.category, 'Below Caution range');
});

test('Heat Index: missing and non-finite inputs return not applicable and never substitute zero', () => {
  const missingTemp = calculateHeatIndex(null, 50);
  assert.equal(missingTemp.isAvailable, false);
  assert.equal(missingTemp.heatIndexCelsius, null);
  assert.equal(missingTemp.category, 'not applicable');
  assert.ok(missingTemp.notes.includes('Assessment unavailable'));

  const nanTemp = calculateHeatIndex(NaN, 50);
  assert.equal(nanTemp.isAvailable, false);
  assert.equal(nanTemp.heatIndexCelsius, null);

  const infTemp = calculateHeatIndex(Infinity, 50);
  assert.equal(infTemp.isAvailable, false);
  assert.equal(infTemp.heatIndexCelsius, null);

  const negInfHumidity = calculateHeatIndex(35, -Infinity);
  assert.equal(negInfHumidity.isAvailable, false);
  assert.equal(negInfHumidity.heatIndexCelsius, null);

  const undefinedHumidity = calculateHeatIndex(35, undefined);
  assert.equal(undefinedHumidity.isAvailable, false);
  assert.equal(undefinedHumidity.heatIndexCelsius, null);
});

test('School Policy: unconfigured policy reports distinct policy_unconfigured status', () => {
  const sampleRaw: RawHourlyVariables = {
    time: '2026-10-21T10:00',
    temperature_2m: 32,
    relative_humidity_2m: 40,
    pm10: 100,
    pm2_5: 30,
    dust: 50,
    wind_speed_10m: 15,
    wind_gusts_10m: 25,
    wind_direction_10m: 300,
    visibility: 9000,
    aerosol_optical_depth: 0.3,
  };

  const hi = calculateHeatIndex(sampleRaw.temperature_2m, sampleRaw.relative_humidity_2m);
  const result = evaluateActivityPolicy(sampleRaw, hi, DEFAULT_UNCONFIGURED_POLICY, 'break');

  assert.equal(result.status, 'policy_unconfigured');
  assert.equal(result.actionTitle, 'School policy configuration required');
  assert.ok(result.primaryGuidance.includes('Review the applicable school policy'));
  assert.equal(result.triggeredRules.length, 0);
  assert.equal(result.isIncomplete, false);
});

test('School Policy: zero applicable rules configured for an activity never reports criteria met', () => {
  // Configured policy with ONLY PE rules, evaluating 'break'
  const peOnlyPolicy: SchoolPolicyConfig = {
    isConfigured: true,
    schoolName: 'PE Only Academy',
    policyVersion: '1.0',
    effectiveDate: '2026-10-01',
    rules: [
      {
        id: 'pe-heat-only',
        name: 'PE Heat Rule',
        activity: 'pe',
        metric: 'temperature',
        operator: '>=',
        threshold: 38,
        unit: '°C',
        recommendedAction: 'indoor_only',
        actionTitle: 'Move PE indoors',
        actionGuidance: 'Outdoor PE suspended.',
        reason: 'High temperature.',
        severity: 2,
      },
    ],
    precedenceOrder: ['suspend', 'indoor_only', 'modified', 'normal'],
  };

  const cleanRaw: RawHourlyVariables = {
    time: '2026-10-21T10:00',
    temperature_2m: 28,
    relative_humidity_2m: 40,
    pm10: 30,
    pm2_5: 10,
    dust: 20,
    wind_speed_10m: 10,
    wind_gusts_10m: 15,
    wind_direction_10m: 300,
    visibility: 10000,
    aerosol_optical_depth: 0.1,
  };

  const hi = calculateHeatIndex(cleanRaw.temperature_2m, cleanRaw.relative_humidity_2m);
  const breakResult = evaluateActivityPolicy(cleanRaw, hi, peOnlyPolicy, 'break');

  // Must report distinct 'no_applicable_rules' state
  assert.equal(breakResult.status, 'no_applicable_rules');
  assert.equal(breakResult.actionTitle, 'No applicable rules configured for this activity');
  assert.ok(breakResult.primaryGuidance.includes('No approved policy rules are defined for this activity'));
  assert.notEqual(breakResult.actionTitle, 'Conditions meet the configured criteria for this activity');
  assert.equal(breakResult.totalApplicableRulesCount, 0);
  assert.equal(breakResult.evaluatedRulesCount, 0);
});

test('School Policy: distinguishes all 5 outcomes clearly', () => {
  const cleanRaw: RawHourlyVariables = {
    time: '2026-10-21T10:00',
    temperature_2m: 28,
    relative_humidity_2m: 40,
    pm10: 30,
    pm2_5: 10,
    dust: 20,
    wind_speed_10m: 10,
    wind_gusts_10m: 15,
    wind_direction_10m: 300,
    visibility: 10000,
    aerosol_optical_depth: 0.1,
  };
  const hiClean = calculateHeatIndex(cleanRaw.temperature_2m, cleanRaw.relative_humidity_2m);

  // 1. policy_unconfigured
  const resUnconfigured = evaluateActivityPolicy(cleanRaw, hiClean, DEFAULT_UNCONFIGURED_POLICY, 'break');
  assert.equal(resUnconfigured.status, 'policy_unconfigured');

  // 2. no_applicable_rules
  const lunchPolicy: SchoolPolicyConfig = {
    ...FICTIONAL_DEMO_POLICY,
    rules: FICTIONAL_DEMO_POLICY.rules.filter((r) => r.activity === 'break'),
  };
  const resNoRules = evaluateActivityPolicy(cleanRaw, hiClean, lunchPolicy, 'lunch_other');
  assert.equal(resNoRules.status, 'no_applicable_rules');

  // 3. assessment_unavailable (missing readings when no rules trigger)
  const missingRaw: RawHourlyVariables = {
    ...cleanRaw,
    pm10: null, // PM10 rule cannot be evaluated
    dust: null,
  };
  const hiMissing = calculateHeatIndex(missingRaw.temperature_2m, missingRaw.relative_humidity_2m);
  const resMissing = evaluateActivityPolicy(missingRaw, hiMissing, FICTIONAL_DEMO_POLICY, 'break');
  assert.equal(resMissing.status, 'assessment_unavailable');
  assert.equal(resMissing.isIncomplete, true);
  assert.equal(resMissing.dataMissingForAssessment, true);

  // 4. criteria_met_no_actions (all rules evaluated and none triggered)
  const resMet = evaluateActivityPolicy(cleanRaw, hiClean, FICTIONAL_DEMO_POLICY, 'break');
  assert.equal(resMet.status, 'criteria_met_no_actions');
  assert.equal(resMet.actionTitle, 'Conditions meet the configured criteria for this activity');
  assert.equal(resMet.isIncomplete, false);

  // 5. action_triggered (one or more rules triggered)
  const hazardRaw: RawHourlyVariables = {
    ...cleanRaw,
    pm10: 350, // triggers indoor_only
  };
  const hiHazard = calculateHeatIndex(hazardRaw.temperature_2m, hazardRaw.relative_humidity_2m);
  const resTriggered = evaluateActivityPolicy(hazardRaw, hiHazard, FICTIONAL_DEMO_POLICY, 'break');
  assert.equal(resTriggered.status, 'action_triggered');
  assert.equal(resTriggered.recommendedAction, 'indoor_only');
  assert.equal(resTriggered.isIncomplete, false);
});

test('School Policy: partial evaluation preserves triggered action and marks assessment incomplete', () => {
  // Condition: PM10 is 300 µg/m³ (triggers indoor_only), but temperature is NaN (so heat index cannot be evaluated)
  const partialRaw: RawHourlyVariables = {
    time: '2026-10-21T12:00',
    temperature_2m: NaN, // Invalid reading!
    relative_humidity_2m: 50,
    pm10: 300, // triggers indoor_only
    pm2_5: 90,
    dust: 180,
    wind_speed_10m: 20,
    wind_gusts_10m: 30,
    wind_direction_10m: 320,
    visibility: 4000,
    aerosol_optical_depth: 0.8,
  };

  const hi = calculateHeatIndex(partialRaw.temperature_2m, partialRaw.relative_humidity_2m);
  const peRes = evaluateActivityPolicy(partialRaw, hi, FICTIONAL_DEMO_POLICY, 'pe');

  // Triggered action is preserved
  assert.equal(peRes.status, 'action_triggered');
  assert.equal(peRes.recommendedAction, 'indoor_only');
  // Incomplete flag must be explicitly true
  assert.equal(peRes.isIncomplete, true);
  assert.equal(peRes.dataMissingForAssessment, true);
  assert.ok(peRes.primaryGuidance.includes('partial'));
  assert.ok(peRes.reason.includes('incomplete'));
});

test('School Policy: non-finite readings (NaN, Infinity, -Infinity) are treated as unavailable', () => {
  assert.equal(isFiniteNumber(null), false);
  assert.equal(isFiniteNumber(undefined), false);
  assert.equal(isFiniteNumber(NaN), false);
  assert.equal(isFiniteNumber(Infinity), false);
  assert.equal(isFiniteNumber(-Infinity), false);
  assert.equal(isFiniteNumber('100'), false);
  assert.equal(isFiniteNumber(100), true);
  assert.equal(isFiniteNumber(0), true);

  const infRaw: RawHourlyVariables = {
    time: '2026-10-21T12:00',
    temperature_2m: 30,
    relative_humidity_2m: 45,
    pm10: Infinity, // non-finite reading
    pm2_5: -Infinity,
    dust: NaN,
    wind_speed_10m: 15,
    wind_gusts_10m: 20,
    wind_direction_10m: 300,
    visibility: 10000,
    aerosol_optical_depth: 0.2,
  };

  const hi = calculateHeatIndex(infRaw.temperature_2m, infRaw.relative_humidity_2m);
  const res = evaluateActivityPolicy(infRaw, hi, FICTIONAL_DEMO_POLICY, 'break');

  // Non-finite readings must NOT trigger rules by accident or substitute zero
  assert.equal(res.status, 'assessment_unavailable');
  assert.equal(res.isIncomplete, true);
});

test('School Policy Precedence: malformed or incomplete precedence configuration cannot select a less protective action', () => {
  // Triggered actions: 'suspend' and 'indoor_only'
  // Malformed precedence order reverses safety: puts 'normal' and 'modified' first, omits 'suspend'
  const malformedPrecedence: any[] = ['normal', 'modified'];
  const winning = resolvePrecedence(['suspend', 'indoor_only'], malformedPrecedence);
  // Must NEVER select 'normal' or 'modified' when 'suspend' or 'indoor_only' is triggered
  assert.equal(winning, 'suspend');

  // When 'indoor_only' and 'modified' triggered with empty precedence order
  const emptyWinning = resolvePrecedence(['modified', 'indoor_only'], []);
  assert.equal(emptyWinning, 'indoor_only');

  // When policy precedence attempts to prefer 'modified' over 'indoor_only'
  const reversePrecedence: any[] = ['modified', 'indoor_only'];
  const safeWinning = resolvePrecedence(['indoor_only', 'modified'], reversePrecedence);
  // 'indoor_only' has protection level 3 > 'modified' level 2
  assert.equal(safeWinning, 'indoor_only');
});

test('School Policy Runtime Validation: localStorage policy validation fails safely to DEFAULT_UNCONFIGURED_POLICY', () => {
  // 1. null or non-object
  assert.equal(validateSchoolPolicy(null).isConfigured, false);
  assert.equal(validateSchoolPolicy('invalid string').isConfigured, false);
  assert.equal(validateSchoolPolicy(12345).isConfigured, false);

  // 2. Missing required fields
  assert.equal(validateSchoolPolicy({ isConfigured: true }).isConfigured, false);

  // 3. Rule with non-finite threshold (NaN)
  const corruptRulePolicy = {
    isConfigured: true,
    schoolName: 'Corrupt Academy',
    policyVersion: '1.0',
    effectiveDate: '2026-10-01',
    rules: [
      {
        id: 'r1',
        name: 'Corrupt Rule',
        activity: 'break',
        metric: 'pm10',
        operator: '>=',
        threshold: NaN, // invalid non-finite threshold
        unit: 'µg/m³',
        recommendedAction: 'indoor_only',
        actionTitle: 'Title',
        actionGuidance: 'Guidance',
        reason: 'Reason',
        severity: 2,
      },
    ],
    precedenceOrder: ['suspend', 'indoor_only', 'modified', 'normal'],
  };
  assert.equal(validateSchoolPolicy(corruptRulePolicy).isConfigured, false);

  // 4. Rule with invalid operator or metric
  const invalidOperatorPolicy = {
    ...corruptRulePolicy,
    rules: [
      {
        ...corruptRulePolicy.rules[0],
        threshold: 150,
        operator: 'LIKE', // invalid operator
      },
    ],
  };
  assert.equal(validateSchoolPolicy(invalidOperatorPolicy).isConfigured, false);

  // 5. Valid policy validates cleanly and ensures complete precedence order
  const validPolicyInput = {
    isConfigured: true,
    schoolName: 'Official Abu Dhabi School',
    policyVersion: '2.1',
    effectiveDate: '2026-10-15',
    rules: [
      {
        id: 'r-valid',
        name: 'Valid PM10 Limit',
        activity: 'break',
        metric: 'pm10',
        operator: '>=',
        threshold: 200,
        unit: 'µg/m³',
        recommendedAction: 'indoor_only',
        actionTitle: 'Keep indoors',
        actionGuidance: 'Blowing dust advisory.',
        reason: 'Particulates elevated.',
        severity: 2,
      },
    ],
    precedenceOrder: ['indoor_only', 'modified'], // missing suspend and normal
  };
  const validated = validateSchoolPolicy(validPolicyInput);
  assert.equal(validated.isConfigured, true);
  assert.equal(validated.schoolName, 'Official Abu Dhabi School');
  assert.equal(validated.rules.length, 1);
  // Sanitizer appended missing actions
  assert.ok(validated.precedenceOrder.includes('suspend'));
  assert.ok(validated.precedenceOrder.includes('normal'));
});

test('AI Summary Gating: getSchoolModeAdvice gates AI call on unconfigured, demo, no applicable rules, or incomplete data', async () => {
  const dummyReadings = {
    temperature: 30,
    relativeHumidity: 45,
    heatIndex: { heatIndexCelsius: 32, category: 'Caution' },
    pm10: 50,
    dust: 25,
    windSpeed: 15,
  };

  // 1. Unconfigured policy
  const unconfiguredRes = await getSchoolModeAdvice(
    'Dubai',
    'break',
    '10:00',
    {
      status: 'policy_unconfigured',
      recommendedAction: 'normal',
      actionTitle: 'School policy configuration required',
      primaryGuidance: 'Review school policy.',
      reason: 'Unconfigured.',
      triggeredRules: [],
      isPolicyConfigured: false,
    },
    dummyReadings
  );
  assert.equal(unconfiguredRes.isAI, false);
  assert.ok(unconfiguredRes.summary.includes('configuration required'));

  // 2. Fictional demonstration policy
  const demoRes = await getSchoolModeAdvice(
    'Dubai',
    'break',
    '10:00',
    {
      status: 'criteria_met_no_actions',
      recommendedAction: 'normal',
      actionTitle: 'Criteria met',
      primaryGuidance: 'Conditions meet criteria.',
      reason: 'None triggered.',
      triggeredRules: [],
      isPolicyConfigured: true,
      isFictionalDemo: true, // DEMO GATED
    },
    dummyReadings
  );
  assert.equal(demoRes.isAI, false);
  assert.ok(demoRes.summary.includes('demonstration') || demoRes.summary.includes('Criteria met'));

  // 3. No applicable rules configured
  const noRulesRes = await getSchoolModeAdvice(
    'Dubai',
    'break',
    '10:00',
    {
      status: 'no_applicable_rules',
      recommendedAction: 'normal',
      actionTitle: 'No applicable rules configured for this activity',
      primaryGuidance: 'No approved policy rules defined.',
      reason: 'No rules.',
      triggeredRules: [],
      isPolicyConfigured: true,
    },
    dummyReadings
  );
  assert.equal(noRulesRes.isAI, false);
  assert.ok(noRulesRes.summary.includes('No applicable rules'));

  // 4. Incomplete / missing assessment data
  const incompleteRes = await getSchoolModeAdvice(
    'Dubai',
    'break',
    '10:00',
    {
      status: 'action_triggered',
      recommendedAction: 'indoor_only',
      actionTitle: 'Move indoors',
      primaryGuidance: 'PM10 elevated.',
      reason: 'Particulates.',
      triggeredRules: [{ rule: { id: 'pm10-severe', metric: 'pm10' } }],
      dataMissingForAssessment: true,
      isIncomplete: true, // INCOMPLETE GATED
      isPolicyConfigured: true,
    },
    dummyReadings
  );
  assert.equal(incompleteRes.isAI, false);
});

test('School Policy: heat-index applicability when temperature is under 20°C', () => {
  const policyWithHeatRule: SchoolPolicyConfig = {
    isConfigured: true,
    schoolName: 'UAE Academy',
    policyVersion: '1.0',
    effectiveDate: '2026-10-01',
    precedenceOrder: ['suspend', 'indoor_only', 'modified', 'normal'],
    rules: [
      {
        id: 'rule-heat-high',
        name: 'High Heat Index Warning',
        activity: 'break',
        metric: 'heat_index',
        operator: '>=',
        threshold: 35,
        unit: '°C',
        recommendedAction: 'modified',
        actionTitle: 'Shorten outdoor play',
        actionGuidance: 'Reduce strenuous outdoor exertion.',
        reason: 'High heat index.',
        severity: 1,
      },
    ],
  };

  // 1. Valid cold/mild day: T=18°C, RH=50%. Heat index is not applicable by NOAA formula (<20°C).
  // Because T=18°C is safely below threshold 35°C, rule must NOT trigger and must NOT be flagged as missing data.
  const rawCool: RawHourlyVariables = {
    time: '2026-10-21T08:00',
    temperature_2m: 18,
    relative_humidity_2m: 50,
    pm10: 40,
    pm2_5: 15,
    dust: 20,
    wind_speed_10m: 10,
    wind_gusts_10m: 15,
    wind_direction_10m: 300,
    visibility: 10000,
    aerosol_optical_depth: 0.1,
  };

  const hiCool = calculateHeatIndex(rawCool.temperature_2m, rawCool.relative_humidity_2m);
  assert.equal(hiCool.isAvailable, false);
  assert.equal(hiCool.category, 'not applicable');

  const evalCool = evaluateActivityPolicy(rawCool, hiCool, policyWithHeatRule, 'break');
  assert.equal(evalCool.status, 'criteria_met_no_actions');
  assert.equal(evalCool.recommendedAction, 'normal');
  assert.equal(evalCool.isIncomplete, false);
  assert.equal(evalCool.dataMissingForAssessment, false);

  // 2. Genuine missing temperature: T=null, RH=50%. Heat index cannot be evaluated.
  const rawMissingTemp: RawHourlyVariables = {
    ...rawCool,
    temperature_2m: null,
  };
  const hiMissing = calculateHeatIndex(rawMissingTemp.temperature_2m, rawMissingTemp.relative_humidity_2m);
  const evalMissing = evaluateActivityPolicy(rawMissingTemp, hiMissing, policyWithHeatRule, 'break');
  assert.equal(evalMissing.status, 'assessment_unavailable');
  assert.equal(evalMissing.dataMissingForAssessment, true);
  assert.equal(evalMissing.triggeredRules.some((r) => r.isDataMissing), true);

  // 3. Mixed rules: Heat rule (T=18°C, safe) + PM10 rule (PM10 is null/missing)
  const policyMixed: SchoolPolicyConfig = {
    ...policyWithHeatRule,
    rules: [
      ...policyWithHeatRule.rules,
      {
        id: 'rule-pm10-mod',
        name: 'PM10 elevated',
        activity: 'break',
        metric: 'pm10',
        operator: '>=',
        threshold: 100,
        unit: 'µg/m³',
        recommendedAction: 'indoor_only',
        actionTitle: 'Move indoors',
        actionGuidance: 'Elevated particulate levels.',
        reason: 'PM10 high',
        severity: 2,
      },
    ],
  };

  const rawMissingPM10: RawHourlyVariables = {
    ...rawCool,
    pm10: null,
  };
  const evalMixedMissing = evaluateActivityPolicy(rawMissingPM10, hiCool, policyMixed, 'break');
  // Since no rule triggered and PM10 is missing, status must be assessment_unavailable
  assert.equal(evalMixedMissing.status, 'assessment_unavailable');
  assert.equal(evalMixedMissing.dataMissingForAssessment, true);
  assert.equal(evalMixedMissing.triggeredRules.some((r) => r.rule.metric === 'pm10' && r.isDataMissing), true);

  // 4. Mixed rules where one triggers and another is missing
  const policyMixedWithTrigger: SchoolPolicyConfig = {
    ...policyMixed,
    rules: [
      ...policyMixed.rules,
      {
        id: 'rule-wind-gust',
        name: 'Severe Wind Gusts',
        activity: 'break',
        metric: 'wind_gusts',
        operator: '>=',
        threshold: 10,
        unit: 'km/h',
        recommendedAction: 'suspend',
        actionTitle: 'Suspend outdoor activity',
        actionGuidance: 'High winds.',
        reason: 'Wind gusts high',
        severity: 3,
      },
    ],
  };

  const evalMixedTriggerAndMissing = evaluateActivityPolicy(rawMissingPM10, hiCool, policyMixedWithTrigger, 'break');
  // Action was triggered by wind gusts, but PM10 was missing: action preserved, assessment marked incomplete
  assert.equal(evalMixedTriggerAndMissing.status, 'action_triggered');
  assert.equal(evalMixedTriggerAndMissing.recommendedAction, 'suspend');
  assert.equal(evalMixedTriggerAndMissing.isIncomplete, true);
  assert.equal(evalMixedTriggerAndMissing.dataMissingForAssessment, true);
  assert.equal(evalMixedTriggerAndMissing.triggeredRules.some((r) => r.rule.metric === 'pm10' && r.isDataMissing), true);
  assert.equal(evalMixedTriggerAndMissing.triggeredRules.some((r) => r.rule.id === 'rule-wind-gust' && r.isTriggered), true);
});
