/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { APP_CONFIG } from './config.ts';
import { STRINGS } from './strings.ts';
import { AdviceResponse, CityOutlook, SchoolActivityType } from './types.ts';
import { hasUnsupportedSafetyClaims } from './schoolPolicy.ts';

// Bounded in-memory cache keeping at most 200 entries, dropping the oldest
class BoundedCache<T> {
  private map = new Map<string, T>();
  private readonly max = 200;

  get(key: string): T | undefined {
    return this.map.get(key);
  }

  set(key: string, value: T): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  clear(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }
}

const adviceCache = new BoundedCache<AdviceResponse>();
export const schoolCache = new BoundedCache<string>();

export function clearClientSchoolCache(): void {
  schoolCache.clear();
}

export function clearClientAdviceCache(): void {
  adviceCache.clear();
}

export function clearSchoolAdviceCache(): void {
  schoolCache.clear();
}

export function clearAdviceCache(): void {
  adviceCache.clear();
}

import {
  deterministicNormalize,
  deterministicSerialize,
  serializeSchoolAdviceInputs,
  makeSchoolAdviceCacheKey,
  serializeGeminiAdviceInputs,
  makeGeminiCacheKey,
} from './cacheKey.ts';

export {
  deterministicNormalize,
  deterministicSerialize,
  serializeSchoolAdviceInputs,
  makeSchoolAdviceCacheKey,
  serializeGeminiAdviceInputs,
  makeGeminiCacheKey,
};



/**
 * Validates that an advice string conforms to prompt limits:
 * - At most 2 sentences
 * - At most 300 characters
 * - Contains no digits that were not present in the input JSON
 */
function isValidField(text: string, allowedDigits: Set<string>): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 300) return false;

  const sentences = trimmed.split(/[.!?]+(?:\s+|$)/).filter((s) => s.trim().length > 0);
  if (sentences.length > 2) return false;

  const matches = trimmed.match(/\d/g);
  if (matches) {
    for (const d of matches) {
      if (!allowedDigits.has(d)) {
        return false;
      }
    }
  }

  return true;
}

export function isValidSchoolSummary(text: string, allowedDigits: Set<string>): boolean {
  if (!isValidField(text, allowedDigits)) return false;
  if (hasUnsupportedSafetyClaims(text)) return false;
  return true;
}

/**
 * Collects all digits present in the input JSON for validation.
 */
function extractAllowedDigits(payload: unknown): Set<string> {
  const str = JSON.stringify(payload);
  const digits = new Set<string>();
  const matches = str.match(/\d/g);
  if (matches) {
    for (const d of matches) {
      digits.add(d);
    }
  }
  return digits;
}

/**
 * Retrieves advice for the selected city outlook, using Gemini AI if available
 * or falling back to the standard pre-written advice.
 */
export async function getAdviceForOutlook(outlook: CityOutlook): Promise<AdviceResponse> {
  const peakLevel = outlook.peakLevel;

  // Pre-written fallback advice
  const fallbackAdvice = STRINGS.advice.fixed[peakLevel] || STRINGS.advice.fixed.Low;
  const standardResponse: AdviceResponse = {
    schools: fallbackAdvice.schools,
    workers: fallbackAdvice.workers,
    families: fallbackAdvice.families,
    isAI: false,
    peakLevel,
    worstWindowText: outlook.worstWindow.displayRange,
    cityName: outlook.city.name,
  };

  const peakHour = outlook.hourlyResults[outlook.peakHourIndex] || outlook.hourlyResults[0];
  const topFactors = peakHour
    ? Object.values(peakHour.subScores)
        .filter((s) => s.subScore !== null)
        .slice(0, 4)
        .map((s) => ({
          name: s.displayName,
          value: s.rawValue,
          unit: s.unit,
          status: s.status,
        }))
    : [];

  const inputPayload = {
    city: outlook.city.name,
    levelNow: outlook.levelNow,
    peakLevel,
    peakWindow: outlook.worstWindow.displayRange,
    confidence: outlook.confidence,
    topFactors,
    dataSourceType: outlook.dataSourceType,
  };

  const cacheKey = serializeGeminiAdviceInputs(inputPayload);
  const cached = adviceCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const allowedDigits = extractAllowedDigits(inputPayload);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), APP_CONFIG.geminiTimeoutMs);

    try {
      const response = await fetch('/api/gemini/advice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputPayload),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Do not cache fallback on transport or HTTP failure, enabling subsequent recovery
        return standardResponse;
      }

      const json = await response.json();
      if (!json.ok || !json.data) {
        // Do not cache fallback on server failure
        return standardResponse;
      }

      const { schools, workers, families } = json.data;

      // Strict validation
      if (
        isValidField(schools, allowedDigits) &&
        isValidField(workers, allowedDigits) &&
        isValidField(families, allowedDigits)
      ) {
        const aiResponse: AdviceResponse = {
          schools: schools.trim(),
          workers: workers.trim(),
          families: families.trim(),
          isAI: true,
          modelName: APP_CONFIG.geminiModelName,
          peakLevel,
          worstWindowText: outlook.worstWindow.displayRange,
          cityName: outlook.city.name,
        };
        // Only cache valid verified AI responses
        adviceCache.set(cacheKey, aiResponse);
        return aiResponse;
      }

      return standardResponse;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return standardResponse;
  }
}

export interface SchoolAdviceResult {
  summary: string;
  isAI: boolean;
}

export async function getSchoolModeAdvice(
  cityName: string,
  activityType: SchoolActivityType,
  hour: string,
  assessment: {
    status?: string;
    recommendedAction: string;
    actionTitle: string;
    primaryGuidance: string;
    reason: string;
    triggeredRules: Array<{ rule: { id: string; metric: string } }>;
    dataMissingForAssessment?: boolean;
    isIncomplete?: boolean;
    isPolicyConfigured?: boolean;
    isFictionalDemo?: boolean;
  },
  readings: {
    temperature: number | null;
    relativeHumidity: number | null;
    heatIndex: { heatIndexCelsius: number | null; category: string };
    pm10: number | null;
    dust: number | null;
    windSpeed: number | null;
    pm25?: number | null;
    pm2_5?: number | null;
    visibility?: number | null;
    wind?: number | null;
  },
  outlookContext?: {
    levelNow?: string;
    peakLevel?: string;
    peakWindow?: string;
    confidence?: string;
  },
  policyContext?: {
    policyVersion?: string;
    schoolName?: string;
    sourceDocument?: string;
    [key: string]: unknown;
  }
): Promise<SchoolAdviceResult> {
  const fallbackSummary = assessment.primaryGuidance;

  // Gate AI summaries if:
  // 1. Policy is unconfigured
  // 2. Policy is fictional demo data
  // 3. Zero rules apply to the selected activity
  // 4. Required assessment data is missing/invalid or assessment is incomplete
  const isGated =
    assessment.isPolicyConfigured === false ||
    assessment.isFictionalDemo === true ||
    assessment.status === 'policy_unconfigured' ||
    assessment.status === 'no_applicable_rules' ||
    assessment.status === 'assessment_unavailable' ||
    assessment.isIncomplete === true ||
    assessment.dataMissingForAssessment === true;

  if (isGated) {
    let summaryText = fallbackSummary;
    if (assessment.isFictionalDemo) {
      summaryText = 'Demonstration rule guidance. AI summary generation is gated for fictional demonstration data.';
    } else if (assessment.status === 'no_applicable_rules') {
      summaryText = 'No applicable rules configured for this activity under the current school policy.';
    } else if (assessment.status === 'policy_unconfigured' || assessment.isPolicyConfigured === false) {
      summaryText = 'School policy configuration required before evaluating outdoor activity recommendations.';
    } else if (assessment.status === 'assessment_unavailable' || assessment.dataMissingForAssessment || assessment.isIncomplete) {
      summaryText = fallbackSummary || 'Assessment unavailable: required environmental data is missing or incomplete.';
    }
    return {
      summary: summaryText,
      isAI: false,
    };
  }

  // Validate activity to fixed list: break or pe, plus lunch only if enabled
  const lunchAllowed = APP_CONFIG.schoolActivities?.showLunch ?? false;
  let normalizedActivity: 'break' | 'pe' | 'lunch' = 'break';
  if (activityType === 'pe') normalizedActivity = 'pe';
  else if (lunchAllowed && (String(activityType) === 'lunch_other' || String(activityType) === 'lunch')) normalizedActivity = 'lunch';

  // Validate action to fixed list: normal, shorten, or cancel
  let normalizedAction: 'normal' | 'shorten' | 'cancel' = 'normal';
  if (assessment.recommendedAction === 'modified') normalizedAction = 'shorten';
  else if (assessment.recommendedAction === 'indoor_only' || assessment.recommendedAction === 'suspend') normalizedAction = 'cancel';

  const levelsStr = `${outlookContext?.levelNow ?? ''}->${outlookContext?.peakLevel ?? normalizedAction}`;
  const peakWin = outlookContext?.peakWindow ?? hour;
  const conf = outlookContext?.confidence ?? 'Medium';

  // Send rule IDs and metric names instead of free text, sorted stably
  const triggeredRules = assessment.triggeredRules.map((tr) => ({
    ruleId: tr.rule.id,
    metric: tr.rule.metric,
  }));
  triggeredRules.sort((a, b) => a.ruleId.localeCompare(b.ruleId));

  // Accept numbers as well as strings for readings
  const inputPayload: Record<string, unknown> = {
    city: cityName,
    activity: normalizedActivity,
    hour,
    action: normalizedAction,
    status: assessment.status || 'criteria_met_no_actions',
    reason: assessment.reason,
    heatIndex: readings.heatIndex.heatIndexCelsius,
    temperature: readings.temperature,
    humidity: readings.relativeHumidity,
    pm10: readings.pm10,
    dust: readings.dust,
    windSpeed: readings.windSpeed ?? readings.wind,
    triggeredRules,
    levelNow: outlookContext?.levelNow,
    peakLevel: outlookContext?.peakLevel,
    peakWindow: peakWin,
    confidence: conf,
    lunchEnabled: lunchAllowed,
    isPolicyConfigured: assessment.isPolicyConfigured ?? true,
    isFictionalDemo: assessment.isFictionalDemo ?? false,
    isIncomplete: assessment.isIncomplete ?? false,
    dataMissingForAssessment: assessment.dataMissingForAssessment ?? false,
  };

  if (readings.wind !== undefined) {
    inputPayload.wind = readings.wind;
  }
  const pm25Val = readings.pm25 ?? readings.pm2_5;
  if (pm25Val !== undefined) {
    inputPayload.pm25 = pm25Val;
  }
  if (readings.pm2_5 !== undefined) {
    inputPayload.pm2_5 = readings.pm2_5;
  }
  if (readings.visibility !== undefined) {
    inputPayload.visibility = readings.visibility;
  }
  if (policyContext !== undefined) {
    if (policyContext.policyVersion !== undefined) inputPayload.policyVersion = policyContext.policyVersion;
    if (policyContext.schoolName !== undefined) inputPayload.schoolName = policyContext.schoolName;
    inputPayload.policyContext = policyContext;
  }

  const cacheKey = serializeSchoolAdviceInputs(inputPayload);
  const cachedSummary = schoolCache.get(cacheKey);
  if (cachedSummary) {
    return { summary: cachedSummary, isAI: true };
  }

  try {
    const allowedDigits = extractAllowedDigits(inputPayload);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), APP_CONFIG.geminiTimeoutMs);

    try {
      const res = await fetch('/api/gemini/school-advice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputPayload),
        signal: controller.signal,
      });

      if (!res.ok) return { summary: fallbackSummary, isAI: false };
      const json = await res.json();
      if (!json.ok || !json.data?.summary) return { summary: fallbackSummary, isAI: false };

      const rawSummary = String(json.data.summary).trim();
      if (isValidSchoolSummary(rawSummary, allowedDigits)) {
        schoolCache.set(cacheKey, rawSummary);
        return { summary: rawSummary, isAI: true };
      }

      return { summary: fallbackSummary, isAI: false };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return { summary: fallbackSummary, isAI: false };
  }
}
