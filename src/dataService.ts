/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { APP_CONFIG, CITIES } from './config.ts';
import { createSyntheticSampleData, SAMPLE_DATA_LABEL } from './sampleData.ts';
import {
  CityLocation,
  CityOutlook,
  HourlyRiskResult,
  ModelFileConfig,
  OpenMeteoAirQualityResponse,
  OpenMeteoWeatherResponse,
  RawCityData,
  RawHourlyVariables,
} from './types.ts';
import {
  calculateConfidence,
  find3HourWindows,
  predictRisk,
  validateModelConfig,
} from './riskEngine.ts';

export interface DataFetchStatus {
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  isDemoMode: boolean;
  isSnapshotLoaded: boolean;
  snapshotLabel?: string;
  hasLiveCache: boolean;
  lastLiveFetchTime?: string;
  lastLiveFetchTimestamp?: number;
  lastFetchTimeFormatted?: string;
  activeBanner?: {
    type: 'sample' | 'cached' | 'snapshot' | 'demo';
    message: string;
  } | null;
}

// In-memory cache for live responses
let inMemoryLiveCache: Record<string, RawCityData> | null = null;
let lastLiveFetchTimestamp = 0;
let lastLiveFetchTimeString = '';

// Snapshot store
let loadedSnapshotData: Record<string, RawCityData> | null = null;
let loadedSnapshotTime = '';

// Simulation flags for Test view
export const simulationState = {
  simulateApiFailure: false,
  simulateMissingDust: false,
  simulateOldDataHours: 0,
};

/**
 * Returns current date and hour in Asia/Dubai timezone.
 * Returns ISO-like string e.g. "2026-10-21T01:00"
 */
export function getCurrentDubaiHour(): { hourString: string; displayFormatted: string } {
  const now = new Date();
  
  // Formatters for Asia/Dubai
  const dubaiFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = dubaiFormatter.formatToParts(now);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';

  const yr = getPart('year');
  const mo = getPart('month');
  const da = getPart('day');
  const hr = getPart('hour');
  const min = getPart('minute');

  const hourString = `${yr}-${mo}-${da}T${hr}:00`;
  const displayFormatted = `${yr}-${mo}-${da} ${hr}:${min} GST`;

  return { hourString, displayFormatted };
}

/**
 * Single fetch helper with timeout and 1 retry.
 */
async function fetchWithRetry(url: string, timeoutMs: number = APP_CONFIG.requestTimeoutMs): Promise<unknown> {
  const attempt = async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timeoutId);
    }
  };

  try {
    return await attempt();
  } catch (err) {
    // Retry once
    return await attempt();
  }
}

/**
 * Builds API URLs for city data.
 */
export function getCityApiUrls(city: CityLocation) {
  const airQualityUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${city.latitude}&longitude=${city.longitude}&hourly=pm10,pm2_5,dust,aerosol_optical_depth&timezone=Asia%2FDubai&forecast_days=2`;
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${city.latitude}&longitude=${city.longitude}&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,relative_humidity_2m,temperature_2m,visibility&wind_speed_unit=kmh&timezone=Asia%2FDubai&forecast_days=2`;
  return { airQualityUrl, weatherUrl };
}

/**
 * Fetches live data for a single city.
 */
async function fetchCityLiveData(city: CityLocation): Promise<RawCityData> {
  const { airQualityUrl, weatherUrl } = getCityApiUrls(city);

  const [airQuality, weather] = (await Promise.all([
    fetchWithRetry(airQualityUrl),
    fetchWithRetry(weatherUrl),
  ])) as [OpenMeteoAirQualityResponse, OpenMeteoWeatherResponse];

  return {
    city,
    airQuality,
    weather,
    fetchTimestamp: Date.now(),
    isSampleOrSnapshot: false,
  };
}

/**
 * Fetches all 10 cities together using comma-separated latitude and longitude values
 * (one request per API), falling back to parallel individual requests if needed.
 */
export async function fetchAllCitiesLiveData(): Promise<Record<string, RawCityData>> {
  const lats = CITIES.map((c) => c.latitude).join(',');
  const lons = CITIES.map((c) => c.longitude).join(',');

  const batchAqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lons}&hourly=pm10,pm2_5,dust,aerosol_optical_depth&timezone=Asia%2FDubai&forecast_days=2`;
  const batchWxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,relative_humidity_2m,temperature_2m,visibility&wind_speed_unit=kmh&timezone=Asia%2FDubai&forecast_days=2`;

  try {
    const [aqResponses, wxResponses] = (await Promise.all([
      fetchWithRetry(batchAqUrl),
      fetchWithRetry(batchWxUrl),
    ])) as [OpenMeteoAirQualityResponse | OpenMeteoAirQualityResponse[], OpenMeteoWeatherResponse | OpenMeteoWeatherResponse[]];

    const aqList = Array.isArray(aqResponses) ? aqResponses : [aqResponses];
    const wxList = Array.isArray(wxResponses) ? wxResponses : [wxResponses];

    if (aqList.length !== CITIES.length || wxList.length !== CITIES.length) {
      throw new Error(
        `Batch response size mismatch: expected ${CITIES.length} cities, got AQ ${aqList.length}, WX ${wxList.length}`
      );
    }

    const results: Record<string, RawCityData> = {};
    for (let i = 0; i < CITIES.length; i++) {
      const city = CITIES[i];
      const aq = aqList[i];
      const wx = wxList[i];

      if (!aq?.hourly?.time || !wx?.hourly?.time || aq.hourly.time.length === 0 || wx.hourly.time.length === 0) {
        throw new Error(`Incomplete hourly data received for city: ${city.name} (${city.id})`);
      }

      // Validate coordinate proximity where available
      if (
        (typeof aq.latitude === 'number' && Math.abs(aq.latitude - city.latitude) > 0.8) ||
        (typeof aq.longitude === 'number' && Math.abs(aq.longitude - city.longitude) > 0.8)
      ) {
        throw new Error(`Coordinate mismatch in batch response for city: ${city.name}`);
      }

      results[city.id] = {
        city,
        airQuality: aq,
        weather: wx,
        fetchTimestamp: Date.now(),
        isSampleOrSnapshot: false,
      };
    }
    return results;
  } catch (batchErr) {
    console.warn('Batch fetch failed, attempting parallel individual requests:', batchErr);
    // Fallback: parallel requests
    const results: Record<string, RawCityData> = {};
    const promises = CITIES.map(async (city) => {
      const data = await fetchCityLiveData(city);
      results[city.id] = data;
    });
    await Promise.all(promises);
    return results;
  }
}

/**
 * Slices 12 consecutive hours starting at current Asia/Dubai hour from raw responses.
 */
export function extract12Hours(
  rawCity: RawCityData,
  currentDubaiHourStr: string
): RawHourlyVariables[] {
  const aq = rawCity.airQuality?.hourly;
  const wx = rawCity.weather?.hourly;

  const aqTimes = aq?.time || [];
  const wxTimes = wx?.time || [];

  // Build timestamp lookup maps to guarantee correct hour alignment
  const aqIndexMap = new Map<string, number>();
  for (let i = 0; i < aqTimes.length; i++) {
    if (aqTimes[i]) aqIndexMap.set(aqTimes[i], i);
  }

  const wxIndexMap = new Map<string, number>();
  for (let i = 0; i < wxTimes.length; i++) {
    if (wxTimes[i]) wxIndexMap.set(wxTimes[i], i);
  }

  // Use sorted unique timestamps from available feeds
  const allTimes = Array.from(new Set([...aqTimes, ...wxTimes])).sort();

  // Find current hour index
  let startIndex = allTimes.findIndex(
    (t) => t === currentDubaiHourStr || t.startsWith(currentDubaiHourStr.slice(0, 13))
  );
  if (startIndex === -1) {
    startIndex = 0;
  }

  // Ensure we can extract 12 hours
  const safeEnd = Math.min(allTimes.length, startIndex + 12);
  const slicedTimes = allTimes.slice(startIndex, safeEnd);

  // If array has fewer than 12 hours from startIndex, pad from start
  while (slicedTimes.length < 12 && allTimes.length > slicedTimes.length) {
    slicedTimes.push(allTimes[slicedTimes.length]);
  }

  return slicedTimes.map((t) => {
    const aqIdx = aqIndexMap.get(t);
    const wxIdx = wxIndexMap.get(t);

    // Simulation: missing dust values
    const dustVal = simulationState.simulateMissingDust
      ? null
      : aqIdx !== undefined ? (aq?.dust?.[aqIdx] ?? null) : null;

    return {
      time: t,
      pm10: aqIdx !== undefined ? (aq?.pm10?.[aqIdx] ?? null) : null,
      pm2_5: aqIdx !== undefined ? (aq?.pm2_5?.[aqIdx] ?? null) : null,
      dust: dustVal,
      aerosol_optical_depth: aqIdx !== undefined ? (aq?.aerosol_optical_depth?.[aqIdx] ?? null) : null,
      wind_speed_10m: wxIdx !== undefined ? (wx?.wind_speed_10m?.[wxIdx] ?? null) : null,
      wind_gusts_10m: wxIdx !== undefined ? (wx?.wind_gusts_10m?.[wxIdx] ?? null) : null,
      wind_direction_10m: wxIdx !== undefined ? (wx?.wind_direction_10m?.[wxIdx] ?? null) : null,
      relative_humidity_2m: wxIdx !== undefined ? (wx?.relative_humidity_2m?.[wxIdx] ?? null) : null,
      temperature_2m: wxIdx !== undefined ? (wx?.temperature_2m?.[wxIdx] ?? null) : null,
      visibility: wxIdx !== undefined ? (wx?.visibility?.[wxIdx] ?? null) : null,
    };
  });
}

/**
 * Computes complete CityOutlook for a given city data object.
 */
export function processCityOutlook(
  rawCity: RawCityData,
  modelConfig: ModelFileConfig | null = null,
  currentDubaiHourStr: string,
  fetchTimeString: string
): CityOutlook {
  const hourly12 = extract12Hours(rawCity, currentDubaiHourStr);
  const hourlyResults: HourlyRiskResult[] = hourly12.map((raw, idx) =>
    predictRisk(idx, raw, modelConfig, APP_CONFIG)
  );

  const levelNow = hourlyResults[0]?.category || 'Low';
  const scoreNow = hourlyResults[0]?.finalScore || 0;

  // Find peak hour (highest score)
  let peakIdx = 0;
  let peakScore = -1;
  for (let i = 0; i < hourlyResults.length; i++) {
    if (hourlyResults[i].finalScore > peakScore) {
      peakScore = hourlyResults[i].finalScore;
      peakIdx = i;
    }
  }

  const peakHour = hourlyResults[peakIdx] || hourlyResults[0];
  const peakLevel = peakHour.category;
  const peakHourTime = peakHour.displayHour;

  const { bestWindow, worstWindow } = find3HourWindows(hourlyResults);

  // Confidence: synthetic, demo, sample, or snapshot data is never live
  const isSyntheticData = Boolean(
    rawCity.isSampleOrSnapshot ||
    (rawCity.snapshotLabel && /synthetic|sample|mock|demo/i.test(rawCity.snapshotLabel))
  );
  const isLive = !isSyntheticData && !simulationState.simulateApiFailure;
  let fetchAgeHours = (Date.now() - rawCity.fetchTimestamp) / (1000 * 3600);
  if (simulationState.simulateOldDataHours > 0) {
    fetchAgeHours = simulationState.simulateOldDataHours;
  }

  // Ensure synthetic, sample, or unknown-origin evaluation cannot be treated as real evaluation
  const evalRes = APP_CONFIG.evaluationResults;
  const hasRealEvaluation = Boolean(
    evalRes &&
    !evalRes.isSynthetic &&
    !evalRes.isSample &&
    !evalRes.isUnknownOrigin &&
    evalRes.datasetDescription &&
    !/synthetic|sample|mock|demo|unknown/i.test(evalRes.datasetDescription) &&
    (!evalRes.hindcastLabel || !/synthetic|sample|mock|demo|unknown/i.test(evalRes.hindcastLabel))
  );

  const { confidence, reasons } = calculateConfidence(
    hourlyResults,
    peakIdx,
    isLive,
    fetchAgeHours,
    hasRealEvaluation,
    APP_CONFIG
  );

  let dataSourceType: 'live' | 'cached' | 'sample' | 'snapshot' = 'live';
  if (rawCity.snapshotLabel && rawCity.snapshotLabel !== SAMPLE_DATA_LABEL) {
    dataSourceType = 'snapshot';
  } else if (rawCity.isSampleOrSnapshot) {
    dataSourceType = 'sample';
  } else if (fetchAgeHours > 0.16) {
    // older than 10 mins cached
    dataSourceType = 'cached';
  }

  // Only populate activeModelInfo if modelConfig is genuinely valid and loaded
  const validatedModel = modelConfig ? validateModelConfig(modelConfig) : null;
  const isModelGenuinelyValid = Boolean(validatedModel?.isValid && validatedModel.config);

  return {
    city: rawCity.city,
    levelNow,
    scoreNow,
    peakHourIndex: peakIdx,
    peakHourTime,
    peakLevel,
    peakScore,
    bestWindow,
    worstWindow,
    confidence,
    confidenceReasons: reasons,
    hourlyResults,
    activeModelInfo: isModelGenuinelyValid && modelConfig
      ? {
          name: modelConfig.model_name,
          version: modelConfig.version,
          trainedDate: modelConfig.trained_date,
        }
      : undefined,
    dataSourceType,
    fetchTime: fetchTimeString,
    fetchTimestamp: rawCity.fetchTimestamp,
  };
}

/**
 * Main coordinator function that fetches data (or uses cache/fallback/demo)
 * and produces CityOutlook records for all cities.
 */
export async function getCityOutlooks(
  isDemoMode: boolean,
  forceRefresh: boolean = false,
  modelConfig: ModelFileConfig | null = null
): Promise<{
  outlooks: Record<string, CityOutlook>;
  rawCityData: Record<string, RawCityData>;
  status: DataFetchStatus;
}> {
  const { hourString: currentDubaiHourStr, displayFormatted: currentDubaiTimeStr } =
    getCurrentDubaiHour();

  // 1. Demo Mode or Snapshot Loaded
  if (isDemoMode) {
    let sourceData = loadedSnapshotData;
    let label = loadedSnapshotTime ? `Saved real snapshot from ${loadedSnapshotTime}` : SAMPLE_DATA_LABEL;
    let bannerType: 'snapshot' | 'demo' = loadedSnapshotData ? 'snapshot' : 'demo';

    if (!sourceData) {
      sourceData = createSyntheticSampleData();
      label = SAMPLE_DATA_LABEL;
      bannerType = 'demo';
    }

    const outlooks: Record<string, CityOutlook> = {};
    for (const city of CITIES) {
      outlooks[city.id] = processCityOutlook(sourceData[city.id], modelConfig, currentDubaiHourStr, currentDubaiTimeStr);
    }

    return {
      outlooks,
      rawCityData: sourceData,
      status: {
        isLoading: false,
        isError: false,
        isDemoMode: true,
        isSnapshotLoaded: !!loadedSnapshotData,
        snapshotLabel: label,
        hasLiveCache: !!inMemoryLiveCache,
        lastLiveFetchTime: lastLiveFetchTimeString,
        lastLiveFetchTimestamp,
        lastFetchTimeFormatted: currentDubaiTimeStr,
        activeBanner: {
          type: bannerType,
          message: label,
        },
      },
    };
  }

  // 2. Check 10-minute cache if not force refreshed
  const now = Date.now();
  if (
    !forceRefresh &&
    !simulationState.simulateApiFailure &&
    inMemoryLiveCache &&
    now - lastLiveFetchTimestamp < APP_CONFIG.cacheDurationMs
  ) {
    const outlooks: Record<string, CityOutlook> = {};
    for (const city of CITIES) {
      outlooks[city.id] = processCityOutlook(
        inMemoryLiveCache[city.id],
        modelConfig,
        currentDubaiHourStr,
        lastLiveFetchTimeString
      );
    }

    return {
      outlooks,
      rawCityData: inMemoryLiveCache,
      status: {
        isLoading: false,
        isError: false,
        isDemoMode: false,
        isSnapshotLoaded: false,
        hasLiveCache: true,
        lastLiveFetchTime: lastLiveFetchTimeString,
        lastLiveFetchTimestamp,
        lastFetchTimeFormatted: lastLiveFetchTimeString,
        activeBanner: null,
      },
    };
  }

  // 3. Attempt live fetch
  try {
    if (simulationState.simulateApiFailure) {
      throw new Error('Simulated Open-Meteo API Network Error');
    }

    const liveData = await fetchAllCitiesLiveData();

    inMemoryLiveCache = liveData;
    lastLiveFetchTimestamp = Date.now();
    lastLiveFetchTimeString = currentDubaiTimeStr;

    const outlooks: Record<string, CityOutlook> = {};
    for (const city of CITIES) {
      outlooks[city.id] = processCityOutlook(
        liveData[city.id],
        modelConfig,
        currentDubaiHourStr,
        lastLiveFetchTimeString
      );
    }

    return {
      outlooks,
      rawCityData: liveData,
      status: {
        isLoading: false,
        isError: false,
        isDemoMode: false,
        isSnapshotLoaded: false,
        hasLiveCache: true,
        lastLiveFetchTime: lastLiveFetchTimeString,
        lastLiveFetchTimestamp,
        lastFetchTimeFormatted: lastLiveFetchTimeString,
        activeBanner: null,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to fetch live API data';
    console.warn('Open-Meteo live fetch failed, falling back:', errorMsg);

    // If an earlier live response exists in this session, use it with banner
    if (inMemoryLiveCache) {
      const outlooks: Record<string, CityOutlook> = {};
      for (const city of CITIES) {
        outlooks[city.id] = processCityOutlook(
          inMemoryLiveCache[city.id],
          modelConfig,
          currentDubaiHourStr,
          lastLiveFetchTimeString
        );
      }

      return {
        outlooks,
        rawCityData: inMemoryLiveCache,
        status: {
          isLoading: false,
          isError: true,
          errorMessage: errorMsg,
          isDemoMode: false,
          isSnapshotLoaded: false,
          hasLiveCache: true,
          lastLiveFetchTime: lastLiveFetchTimeString,
          lastLiveFetchTimestamp,
          lastFetchTimeFormatted: lastLiveFetchTimeString,
          activeBanner: {
            type: 'cached',
            message: `Live data unavailable. Showing the last live data from ${lastLiveFetchTimeString}.`,
          },
        },
      };
    }

    // Otherwise fall back to synthetic sample data
    const sampleData = createSyntheticSampleData();
    const outlooks: Record<string, CityOutlook> = {};
    for (const city of CITIES) {
      outlooks[city.id] = processCityOutlook(
        sampleData[city.id],
        modelConfig,
        currentDubaiHourStr,
        currentDubaiTimeStr
      );
    }

    return {
      outlooks,
      rawCityData: sampleData,
      status: {
        isLoading: false,
        isError: true,
        errorMessage: errorMsg,
        isDemoMode: false,
        isSnapshotLoaded: false,
        hasLiveCache: false,
        lastFetchTimeFormatted: currentDubaiTimeStr,
        activeBanner: {
          type: 'sample',
          message: 'Showing saved sample data, not live data',
        },
      },
    };
  }
}

/**
 * Exports current live or loaded data as a downloadable snapshot JSON.
 */
export function exportSnapshotJson(rawCityData: Record<string, RawCityData>): string {
  const { displayFormatted } = getCurrentDubaiHour();
  const isSynthetic = Object.values(rawCityData).some(
    (c) => Boolean(c.isSampleOrSnapshot) || Boolean(c.snapshotLabel?.toLowerCase().includes('synthetic'))
  );
  const payload = {
    app: APP_CONFIG.appName,
    fetchTime: displayFormatted,
    fetchTimestamp: Date.now(),
    isSynthetic,
    cities: rawCityData,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Loads a snapshot JSON object into the session.
 */
export function importSnapshotJson(jsonContent: string): {
  success: boolean;
  error?: string;
  count?: number;
  isSynthetic?: boolean;
} {
  try {
    const parsed = JSON.parse(jsonContent);
    if (!parsed || !parsed.cities || typeof parsed.cities !== 'object') {
      return { success: false, error: 'Invalid snapshot format: missing "cities" object' };
    }

    const snapshotCities = parsed.cities as Record<string, RawCityData>;
    const isSynthetic =
      Boolean(parsed.isSynthetic) ||
      Object.values(snapshotCities).some(
        (c) => Boolean(c.snapshotLabel?.toLowerCase().includes('synthetic'))
      );

    for (const city of CITIES) {
      if (!snapshotCities[city.id]) {
        return { success: false, error: `Snapshot missing data for required city: ${city.name}` };
      }
      snapshotCities[city.id].isSampleOrSnapshot = true;
      snapshotCities[city.id].snapshotLabel = isSynthetic
        ? `Synthetic demonstration snapshot from ${parsed.fetchTime || 'saved session'}`
        : `Saved real snapshot from ${parsed.fetchTime || 'unknown time'}`;
    }

    loadedSnapshotData = snapshotCities;
    loadedSnapshotTime = parsed.fetchTime || 'saved snapshot';

    return { success: true, count: Object.keys(snapshotCities).length, isSynthetic };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to parse JSON';
    return { success: false, error: msg };
  }
}

/**
 * Clears loaded snapshot.
 */
export function clearSnapshot(): void {
  loadedSnapshotData = null;
  loadedSnapshotTime = '';
}
