/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Recursively sorts object keys and normalizes values to produce a
 * deterministic, canonical representation of any JSON-serializable value.
 *
 * Guarantees:
 * - Nested objects have their keys sorted alphabetically at every level.
 * - Arrays maintain order, while their contents are recursively normalized.
 * - Undefined object properties are omitted.
 * - Non-finite numbers (NaN, Infinity, -Infinity) normalize to null.
 * - Primitives (strings, booleans, finite numbers) are preserved.
 */
export function deterministicNormalize(val: unknown): unknown {
  if (val === null || val === undefined) {
    return val;
  }
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val !== 'object') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map((item) => deterministicNormalize(item));
  }
  // Plain object: sort keys
  const obj = val as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    const propVal = obj[key];
    if (propVal !== undefined) {
      result[key] = deterministicNormalize(propVal);
    }
  }
  return result;
}

export function deterministicSerialize(value: unknown): string {
  const normalized = deterministicNormalize(value);
  return JSON.stringify(normalized);
}

export function serializeSchoolAdviceInputs(input: Record<string, unknown>): string {
  return deterministicSerialize(input);
}

export function makeSchoolAdviceCacheKey(
  cityOrPayload?: string | Record<string, unknown>,
  activity?: string,
  hour?: string,
  action?: string,
  readings?: unknown,
  triggeredRules?: unknown
): string {
  if (cityOrPayload && typeof cityOrPayload === 'object') {
    return deterministicSerialize(cityOrPayload as Record<string, unknown>);
  }
  const obj: Record<string, unknown> = {
    city: cityOrPayload ?? '',
    activity: activity ?? '',
    hour: hour ?? '',
    action: action ?? '',
    readings: readings ?? {},
    triggeredRules: triggeredRules ?? [],
  };
  return deterministicSerialize(obj);
}

export function serializeGeminiAdviceInputs(input: Record<string, unknown>): string {
  return deterministicSerialize(input);
}

export function makeGeminiCacheKey(
  cityOrPayload?: string | Record<string, unknown>,
  levels?: string,
  peakWindow?: string,
  confidence?: string,
  topFactors?: unknown,
  dataSourceType?: string
): string {
  if (cityOrPayload && typeof cityOrPayload === 'object') {
    return deterministicSerialize(cityOrPayload as Record<string, unknown>);
  }
  const obj: Record<string, unknown> = {
    city: cityOrPayload ?? '',
    levels: levels ?? '',
    peakWindow: peakWindow ?? '',
    confidence: confidence ?? '',
    topFactors: topFactors ?? [],
    dataSourceType: dataSourceType ?? '',
  };
  return deterministicSerialize(obj);
}
