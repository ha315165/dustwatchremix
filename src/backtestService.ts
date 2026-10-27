/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { APP_CONFIG, CITIES } from './config.ts';
import {
  CityLocation,
  EventEvaluationSummary,
  EvidenceType,
  FalseAlarmEpisode,
  HindcastHourlyPrediction,
  ModelFileConfig,
  NurseAction,
  NurseAgreementCategory,
  NurseComparisonInputRow,
  NurseComparisonResultRow,
  NurseComparisonSummary,
  ObservedEventRow,
  OpenMeteoAirQualityResponse,
  OpenMeteoWeatherResponse,
  RawCityData,
  RawHourlyVariables,
  RiskCategory,
  SchoolPolicyConfig,
  SplitEvaluationStats,
  WorkbenchEvaluationOutput,
  WorkbenchMetadata,
} from './types.ts';
import { calculateHourlyBaseline, predictRisk } from './riskEngine.ts';
import { isPredictedEvent } from './evaluation.ts';
import { calculateHeatIndex, evaluateActivityPolicy } from './schoolPolicy.ts';

// Hindcast Label
export const HINDCAST_PROVENANCE_LABEL =
  'Hindcast from Open-Meteo past data. Not a true archive of past 12-hour forecasts.';
export const SYNTHETIC_HINDCAST_LABEL =
  'Synthetic demonstration data (Not real Open-Meteo hindcast data).';

/**
 * Single fetch helper with 10-second timeout and 1 retry.
 */
async function fetchWithRetry(url: string, timeoutMs: number = 10000): Promise<unknown> {
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
 * Creates synthetic hindcast data for testing or offline environments.
 */
export function generateSyntheticHindcastData(
  days: number,
  cities: CityLocation[] = CITIES
): Record<string, RawCityData> {
  const result: Record<string, RawCityData> = {};
  const totalHours = Math.max(24, days * 24 + 24);
  const now = new Date();

  // Create timestamps hourly going backwards
  const timeStrings: string[] = [];
  const baseTime = new Date(now.getTime() - (days * 24) * 3600 * 1000);
  baseTime.setMinutes(0, 0, 0);

  for (let h = 0; h < totalHours; h++) {
    const d = new Date(baseTime.getTime() + h * 3600 * 1000);
    // Format in Asia/Dubai YYYY-MM-DDTHH:00
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const hr = String(d.getHours()).padStart(2, '0');
    timeStrings.push(`${yr}-${mo}-${da}T${hr}:00`);
  }

  for (let cIdx = 0; cIdx < cities.length; cIdx++) {
    const city = cities[cIdx];
    const pm10Arr: (number | null)[] = [];
    const dustArr: (number | null)[] = [];
    const aodArr: (number | null)[] = [];
    const windSpeedArr: (number | null)[] = [];
    const windGustsArr: (number | null)[] = [];
    const windDirArr: (number | null)[] = [];
    const relHumArr: (number | null)[] = [];
    const tempArr: (number | null)[] = [];
    const visArr: (number | null)[] = [];

    for (let h = 0; h < totalHours; h++) {
      // Simulate diurnal cycle plus synthetic dust events
      const hourOfDay = h % 24;
      const dayIndex = Math.floor(h / 24);
      
      // Inject synthetic dust episodes on specific days (e.g., day 5 and day 12)
      const isDustDay = dayIndex % 7 === 3;
      const isPeakDustHour = isDustDay && hourOfDay >= 11 && hourOfDay <= 17;

      const baseDust = isPeakDustHour ? 220 + (cIdx * 10) : 30 + Math.sin(h * 0.1) * 20;
      const basePm10 = isPeakDustHour ? 280 + (cIdx * 15) : 55 + Math.sin(h * 0.1) * 30;
      const baseWind = isPeakDustHour ? 38 + (h % 5) : 18 + Math.cos(h * 0.2) * 8;
      const baseGust = baseWind + (isPeakDustHour ? 22 : 10);
      const baseVis = isPeakDustHour ? 1200 : 9000;
      const baseHum = Math.max(15, 45 + Math.cos(h * 0.15) * 25);
      const baseTemp = 28 + Math.sin((hourOfDay - 6) * 0.26) * 10;

      pm10Arr.push(Math.round(basePm10));
      dustArr.push(Math.round(baseDust));
      aodArr.push(isPeakDustHour ? 1.4 : 0.35);
      windSpeedArr.push(Math.round(baseWind));
      windGustsArr.push(Math.round(baseGust));
      windDirArr.push((h * 15) % 360);
      relHumArr.push(Math.round(baseHum));
      tempArr.push(Math.round(baseTemp));
      visArr.push(Math.round(baseVis));
    }

    result[city.id] = {
      city,
      airQuality: {
        latitude: city.latitude,
        longitude: city.longitude,
        timezone: 'Asia/Dubai',
        hourly: {
          time: timeStrings,
          pm10: pm10Arr,
          pm2_5: pm10Arr.map((v) => (v ? Math.round(v * 0.4) : null)),
          dust: dustArr,
          aerosol_optical_depth: aodArr,
        },
      },
      weather: {
        latitude: city.latitude,
        longitude: city.longitude,
        timezone: 'Asia/Dubai',
        hourly: {
          time: timeStrings,
          wind_speed_10m: windSpeedArr,
          wind_gusts_10m: windGustsArr,
          wind_direction_10m: windDirArr,
          relative_humidity_2m: relHumArr,
          temperature_2m: tempArr,
          visibility: visArr,
        },
      },
      fetchTimestamp: Date.now(),
      isSampleOrSnapshot: true,
      snapshotLabel: SYNTHETIC_HINDCAST_LABEL,
    };
  }

  return result;
}

/**
 * A1: Fetches hindcast data from Open-Meteo for all 10 cities.
 * Input: N days (1 to 92, default 30).
 * past_days=N, forecast_days=1, timezone=Asia/Dubai.
 * Uses 10s timeout and 1 retry.
 *
 * Strict validation: Requires matching responses for every city and validates
 * hourly data arrays. Never silently reuses data from another city or falls
 * back to synthetic data upon failure.
 */
export async function fetchHindcastData(
  days: number = 30,
  onProgress?: (status: string) => void
): Promise<Record<string, RawCityData>> {
  const boundedDays = Math.min(92, Math.max(1, Math.round(days)));

  onProgress?.(`Preparing hindcast request for ${CITIES.length} UAE cities (${boundedDays} past days)...`);

  const lats = CITIES.map((c) => c.latitude).join(',');
  const lons = CITIES.map((c) => c.longitude).join(',');

  const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lons}&hourly=pm10,pm2_5,dust,aerosol_optical_depth&timezone=Asia%2FDubai&past_days=${boundedDays}&forecast_days=1`;
  const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,relative_humidity_2m,temperature_2m,visibility&wind_speed_unit=kmh&timezone=Asia%2FDubai&past_days=${boundedDays}&forecast_days=1`;

  try {
    onProgress?.('Fetching Open-Meteo historical batch weather and air quality...');
    const [aqResponses, wxResponses] = (await Promise.all([
      fetchWithRetry(aqUrl, 10000),
      fetchWithRetry(wxUrl, 10000),
    ])) as [
      OpenMeteoAirQualityResponse | OpenMeteoAirQualityResponse[],
      OpenMeteoWeatherResponse | OpenMeteoWeatherResponse[]
    ];

    const aqList = Array.isArray(aqResponses) ? aqResponses : [aqResponses];
    const wxList = Array.isArray(wxResponses) ? wxResponses : [wxResponses];

    if (aqList.length !== CITIES.length || wxList.length !== CITIES.length) {
      throw new Error(
        `Open-Meteo hindcast batch mismatch: expected ${CITIES.length} cities, but received ${aqList.length} air-quality and ${wxList.length} weather responses.`
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
        throw new Error(`Coordinate mismatch in hindcast batch response for city: ${city.name}`);
      }

      // Validate hourly series timestamp alignment between weather and air quality
      if (aq.hourly.time[0] !== wx.hourly.time[0]) {
        throw new Error(`Timestamp mismatch between weather and air-quality for city: ${city.name}`);
      }

      results[city.id] = {
        city,
        airQuality: aq,
        weather: wx,
        fetchTimestamp: Date.now(),
        isSampleOrSnapshot: false,
        snapshotLabel: HINDCAST_PROVENANCE_LABEL,
      };
    }

    onProgress?.(`Loaded past data for ${CITIES.length} cities.`);
    return results;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('Open-Meteo batch hindcast fetch failed:', errorMsg);
    onProgress?.(`Fetch failed: ${errorMsg}`);
    throw new Error(`Unable to fetch historical hindcast data: ${errorMsg}`);
  }
}

/**
 * A2: Generates hourly predictions for every city and hour.
 * - baseline_level & baseline_score from existing baseline rules
 * - model_level from predictRisk if trained model loaded, else blank ""
 * - persistence_level: baseline level from 12 hours earlier
 * - Drop first 12 hours for each city because they have no persistence value
 * - Keep missing-data flags; never treat missing values as zero
 * - Mark hours with missing core data as not evaluated
 */
export function buildHourlyPredictions(
  rawCityData: Record<string, RawCityData>,
  activeModel: ModelFileConfig | null
): HindcastHourlyPrediction[] {
  const allPredictions: HindcastHourlyPrediction[] = [];

  for (const city of CITIES) {
    const data = rawCityData[city.id];
    if (!data) continue;

    const wxTimes = data.weather?.hourly?.time || [];
    const aqTimes = data.airQuality?.hourly?.time || [];

    const wxIndexMap = new Map<string, number>();
    for (let i = 0; i < wxTimes.length; i++) {
      if (wxTimes[i]) wxIndexMap.set(wxTimes[i], i);
    }

    const aqIndexMap = new Map<string, number>();
    for (let i = 0; i < aqTimes.length; i++) {
      if (aqTimes[i]) aqIndexMap.set(aqTimes[i], i);
    }

    // Match weather and air-quality observations by timestamps
    // Collect union of unique timestamps in chronological order
    const allTimesSet = new Set<string>();
    for (const t of wxTimes) if (t) allTimesSet.add(t);
    for (const t of aqTimes) if (t) allTimesSet.add(t);
    const sortedTimes = Array.from(allTimesSet).sort();
    const totalHours = sortedTimes.length;

    // Temporary array to store all calculated hours before dropping the first 12
    const cityHours: {
      timestamp: string;
      baseline_level: RiskCategory;
      baseline_score: number;
      model_level?: RiskCategory | '';
      isCoreDataMissing: boolean;
      missingVariables: string[];
      rawVariables: RawHourlyVariables;
    }[] = [];

    for (let h = 0; h < totalHours; h++) {
      const time = sortedTimes[h];
      const aqIdx = aqIndexMap.get(time);
      const wxIdx = wxIndexMap.get(time);

      const dust = aqIdx !== undefined ? (data.airQuality?.hourly?.dust?.[aqIdx] ?? null) : null;
      const pm10 = aqIdx !== undefined ? (data.airQuality?.hourly?.pm10?.[aqIdx] ?? null) : null;
      const pm2_5 = aqIdx !== undefined ? (data.airQuality?.hourly?.pm2_5?.[aqIdx] ?? null) : null;
      const aod = aqIdx !== undefined ? (data.airQuality?.hourly?.aerosol_optical_depth?.[aqIdx] ?? null) : null;

      const wind_speed = wxIdx !== undefined ? (data.weather?.hourly?.wind_speed_10m?.[wxIdx] ?? null) : null;
      const wind_gusts = wxIdx !== undefined ? (data.weather?.hourly?.wind_gusts_10m?.[wxIdx] ?? null) : null;
      const wind_dir = wxIdx !== undefined ? (data.weather?.hourly?.wind_direction_10m?.[wxIdx] ?? null) : null;
      const humidity = wxIdx !== undefined ? (data.weather?.hourly?.relative_humidity_2m?.[wxIdx] ?? null) : null;
      const temp = wxIdx !== undefined ? (data.weather?.hourly?.temperature_2m?.[wxIdx] ?? null) : null;
      const visibility = wxIdx !== undefined ? (data.weather?.hourly?.visibility?.[wxIdx] ?? null) : null;

      const rawVars: RawHourlyVariables = {
        time,
        pm10,
        pm2_5,
        dust,
        aerosol_optical_depth: aod,
        wind_speed_10m: wind_speed,
        wind_gusts_10m: wind_gusts,
        wind_direction_10m: wind_dir,
        relative_humidity_2m: humidity,
        temperature_2m: temp,
        visibility,
      };

      // Check missing core data: dust, pm10, wind, visibility are required core inputs
      const isCoreMissing =
        dust === null || pm10 === null || wind_speed === null || visibility === null;

      const baselineResult = calculateHourlyBaseline(h % 12, rawVars);

      let modelLevel: RiskCategory | '' = '';
      if (activeModel) {
        try {
          const modelRes = predictRisk(h % 12, rawVars, activeModel);
          // Only populate model_level when a trained model was genuinely loaded and produced a valid model category.
          // Never label baseline fallback output as a trained-model prediction.
          modelLevel = modelRes.modelCategory || '';
        } catch {
          modelLevel = '';
        }
      }

      cityHours.push({
        timestamp: time,
        baseline_level: baselineResult.baselineCategory,
        baseline_score: baselineResult.baselineScore,
        model_level: modelLevel,
        isCoreDataMissing: isCoreMissing,
        missingVariables: baselineResult.missingVariables,
        rawVariables: rawVars,
      });
    }

    // A2 Rule: Drop the first 12 hours of each city because they have no persistence value.
    // Persistence level is the baseline level from 12 hours earlier.
    const snapshotLabel = data.snapshotLabel;
    const isSynthetic = Boolean(
      (data.isSampleOrSnapshot && snapshotLabel !== HINDCAST_PROVENANCE_LABEL) ||
      snapshotLabel === SYNTHETIC_HINDCAST_LABEL ||
      /synthetic|sample|mock|demo/i.test(snapshotLabel || '')
    );

    for (let h = 12; h < cityHours.length; h++) {
      const current = cityHours[h];
      const persistence_level = cityHours[h - 12].baseline_level;

      allPredictions.push({
        timestamp: current.timestamp,
        cityId: city.id,
        cityName: city.name,
        baseline_level: current.baseline_level,
        baseline_score: current.baseline_score,
        model_level: current.model_level,
        persistence_level,
        isCoreDataMissing: current.isCoreDataMissing,
        missingVariables: current.missingVariables,
        rawVariables: current.rawVariables,
        isSynthetic,
        snapshotLabel,
      });
    }
  }

  // Sort chronologically then by city
  allPredictions.sort((a, b) => {
    if (a.timestamp < b.timestamp) return -1;
    if (a.timestamp > b.timestamp) return 1;
    return a.cityName.localeCompare(b.cityName);
  });

  return allPredictions;
}

/**
 * A3: Parses and validates the team-supplied observed events CSV.
 * Columns: city (or ALL), start, end, evidence_type, source_name, source_link, notes
 * Checks independence: evidence_type is model_forecast or source_name mentions Open-Meteo or CAMS
 */
export function parseEventLogCsv(
  csvText: string,
  includeNonIndependent: boolean = false
): {
  success: boolean;
  events: ObservedEventRow[];
  ignoredRows: string[];
  nonIndependentCount: number;
  circularityWarningTriggered: boolean;
  error?: string;
} {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) {
    return {
      success: false,
      events: [],
      ignoredRows: [],
      nonIndependentCount: 0,
      circularityWarningTriggered: false,
      error: 'Event log CSV is empty or missing headers.',
    };
  }

  const headerLine = lines[0];
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());
  const reqCols = ['city', 'start', 'end', 'evidence_type', 'source_name', 'source_link', 'notes'];
  const missing = reqCols.filter((col) => !headers.includes(col));
  if (missing.length > 0) {
    return {
      success: false,
      events: [],
      ignoredRows: [],
      nonIndependentCount: 0,
      circularityWarningTriggered: false,
      error: `Missing required columns: ${missing.join(', ')}. Expected: ${reqCols.join(', ')}`,
    };
  }

  const idxCity = headers.indexOf('city');
  const idxStart = headers.indexOf('start');
  const idxEnd = headers.indexOf('end');
  const idxEvidence = headers.indexOf('evidence_type');
  const idxSource = headers.indexOf('source_name');
  const idxLink = headers.indexOf('source_link');
  const idxNotes = headers.indexOf('notes');

  const validEvidenceTypes = new Set<string>([
    'satellite_image',
    'observation_report',
    'ground_measurement',
    'reanalysis_data',
    'model_forecast',
  ]);

  const events: ObservedEventRow[] = [];
  const ignoredRows: string[] = [];
  let nonIndependentCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const rowNum = i + 1;
    const parts = lines[i].split(',').map((p) => p.trim());
    if (parts.length < reqCols.length) {
      ignoredRows.push(`Row ${rowNum}: Not enough columns (found ${parts.length}, expected >= ${reqCols.length})`);
      continue;
    }

    const city = parts[idxCity];
    const start = parts[idxStart];
    const end = parts[idxEnd];
    const evidence = parts[idxEvidence]?.toLowerCase();
    const sourceName = parts[idxSource];
    const sourceLink = parts[idxLink];
    const notes = parts.slice(idxNotes).join(','); // handle commas in notes

    if (!city || !start || !end) {
      ignoredRows.push(`Row ${rowNum}: City, start time, or end time is blank.`);
      continue;
    }

    if (!validEvidenceTypes.has(evidence)) {
      ignoredRows.push(
        `Row ${rowNum}: Invalid evidence_type "${evidence}". Must be one of: satellite_image, observation_report, ground_measurement, reanalysis_data, model_forecast.`
      );
      continue;
    }

    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      ignoredRows.push(`Row ${rowNum}: Invalid start or end ISO timestamp ("${start}", "${end}").`);
      continue;
    }

    if (endDate.getTime() <= startDate.getTime()) {
      ignoredRows.push(`Row ${rowNum}: End time must be strictly after start time.`);
      continue;
    }

    // Independence check:
    // Flag any event whose evidence_type is model_forecast, or whose source_name mentions Open-Meteo or CAMS
    const isModelForecast = evidence === 'model_forecast';
    const mentionsOpenMeteoOrCams =
      /open-meteo|openmeteo|cams|copernicus\s*atmosphere/i.test(sourceName) ||
      /open-meteo|openmeteo|cams/i.test(sourceLink);

    const isNonIndependent = isModelForecast || mentionsOpenMeteoOrCams;
    let flagReason: string | undefined = undefined;

    if (isNonIndependent) {
      nonIndependentCount++;
      flagReason = 'Not independent of the prediction data';
    }

    const eventObj: ObservedEventRow = {
      id: `evt-${rowNum}-${start}`,
      rowNumber: rowNum,
      city,
      start,
      end,
      evidence_type: evidence as EvidenceType,
      source_name: sourceName,
      source_link: sourceLink,
      notes,
      isIndependent: !isNonIndependent,
      flagReason,
    };

    // If flagged as non-independent, exclude by default unless includeNonIndependent is true
    if (!isNonIndependent || includeNonIndependent) {
      events.push(eventObj);
    }
  }

  return {
    success: true,
    events,
    ignoredRows,
    nonIndependentCount,
    circularityWarningTriggered: includeNonIndependent && nonIndependentCount > 0,
  };
}

/**
 * Returns default template CSV for event log.
 */
export function getEventLogTemplateCsv(): string {
  return [
    'city,start,end,evidence_type,source_name,source_link,notes',
    'Abu Dhabi,2026-10-10T10:00,2026-10-10T16:00,observation_report,NCM Official Weather Station Bulletin,https://ncm.ae,Observed dust storm with blowing sand',
    'Dubai,2026-10-10T11:00,2026-10-10T17:00,satellite_image,MODIS Terra Aerosol True Color,https://worldview.earthdata.nasa.gov,Visible dust plume moving north across coast',
    'ALL,2026-10-15T08:00,2026-10-15T15:00,ground_measurement,Air Quality Monitoring Network Station,https://example.org,Sustained PM10 above 250 across multiple stations',
  ].join('\n');
}

/**
 * Calculates predictor statistics from an array of evaluated rows.
 */
function calculatePredictorStatsFromRows(
  rows: Array<{
    observed_event: 0 | 1;
    level: RiskCategory | '';
  }>
) {
  let hits = 0;
  let misses = 0;
  let falseAlarms = 0;
  let correctNegatives = 0;

  for (const r of rows) {
    if (!r.level) continue;
    const isPred = isPredictedEvent(r.level, APP_CONFIG.eventPredictionLevel);
    const isObs = r.observed_event === 1;

    if (isPred && isObs) hits++;
    else if (!isPred && isObs) misses++;
    else if (isPred && !isObs) falseAlarms++;
    else correctNegatives++;
  }

  const total = hits + misses + falseAlarms + correctNegatives;
  const observedEvents = hits + misses;
  const predictedEvents = hits + falseAlarms;

  return {
    hits,
    misses,
    falseAlarms,
    correctNegatives,
    total,
    hitRate: observedEvents > 0 ? hits / observedEvents : null,
    missRate: observedEvents > 0 ? misses / observedEvents : null,
    falseAlarmRatio: predictedEvents > 0 ? falseAlarms / predictedEvents : null,
    accuracy: total > 0 ? (hits + correctNegatives) / total : null,
  };
}

/**
 * A3, A4, A5: Evaluates hourly predictions against observed events.
 */
export function evaluatePredictionsAgainstEvents(params: {
  predictions: HindcastHourlyPrediction[];
  events: ObservedEventRow[];
  searchedPeriod: { start: string; end: string };
  searchedCities: string[];
  daysRequested: number;
  activeModel: ModelFileConfig | null;
  splitDate?: string;
  allParsedEventsCount?: number;
  excludedNonIndependentCount?: number;
}): WorkbenchEvaluationOutput {
  const {
    predictions,
    events,
    searchedPeriod,
    searchedCities,
    daysRequested,
    activeModel,
    splitDate,
    allParsedEventsCount = events.length,
    excludedNonIndependentCount = 0,
  } = params;

  const searchedCitiesSet = new Set(
    searchedCities.map((c) => c.toLowerCase().trim())
  );
  const isAllCitiesSearched =
    searchedCitiesSet.has('all') || searchedCities.length === CITIES.length;

  const evaluatedRows: WorkbenchEvaluationOutput['evaluatedRows'] = [];
  let hoursExcludedOutsideSearch = 0;
  let hoursExcludedMissingCoreData = 0;

  // Filter and evaluate each prediction
  for (const pred of predictions) {
    const isCitySearched =
      isAllCitiesSearched ||
      searchedCitiesSet.has(pred.cityName.toLowerCase()) ||
      searchedCitiesSet.has(pred.cityId.toLowerCase());

    const isInsidePeriod =
      pred.timestamp >= searchedPeriod.start && pred.timestamp <= searchedPeriod.end;

    // Rule A3: Hours outside searched period or searched cities are EXCLUDED
    if (!isCitySearched || !isInsidePeriod) {
      hoursExcludedOutsideSearch++;
      continue;
    }

    // Rule A2: Hours with missing core data are marked "not evaluated" and excluded
    if (pred.isCoreDataMissing) {
      hoursExcludedMissingCoreData++;
      continue;
    }

    // Check if hour is inside an event window for this city (or ALL)
    let isInsideEvent = false;
    for (const evt of events) {
      const isEvtCity =
        evt.city.toUpperCase() === 'ALL' ||
        evt.city.toLowerCase() === pred.cityName.toLowerCase() ||
        evt.city.toLowerCase() === pred.cityId.toLowerCase();

      if (isEvtCity && pred.timestamp >= evt.start && pred.timestamp <= evt.end) {
        isInsideEvent = true;
        break;
      }
    }

    evaluatedRows.push({
      timestamp: pred.timestamp,
      city: pred.cityName,
      observed_event: isInsideEvent ? 1 : 0,
      model_level: pred.model_level || '',
      baseline_level: pred.baseline_level,
      persistence_level: pred.persistence_level,
    });
  }

  // Construct CSV text
  const isSyntheticData = predictions.some(
    (p) => p.isSynthetic || (p.snapshotLabel && /synthetic|mock|demo/i.test(p.snapshotLabel))
  );
  const isSampleData = predictions.some(
    (p) => Boolean(p.isSample || (p.snapshotLabel && /sample/i.test(p.snapshotLabel)))
  );
  const detectedLabel = predictions.find((p) => p.snapshotLabel)?.snapshotLabel;
  let hindcastLabel = HINDCAST_PROVENANCE_LABEL;
  if (detectedLabel) {
    hindcastLabel = detectedLabel;
  } else if (isSyntheticData) {
    hindcastLabel = SYNTHETIC_HINDCAST_LABEL;
  }

  const csvLines: string[] = [];
  if (isSyntheticData) {
    csvLines.push('# dataset: synthetic');
    csvLines.push(`# provenance: ${hindcastLabel}`);
  } else {
    csvLines.push('# dataset: hindcast');
    csvLines.push(`# provenance: ${hindcastLabel}`);
  }
  csvLines.push('timestamp,city,observed_event,model_level,baseline_level,persistence_level');
  for (const r of evaluatedRows) {
    csvLines.push(
      `${r.timestamp},${r.city},${r.observed_event},${r.model_level || ''},${r.baseline_level},${r.persistence_level || ''}`
    );
  }
  const csvText = csvLines.join('\n');

  // A5: Event-level summaries
  const eventSummaries: EventEvaluationSummary[] = [];
  const riskLevelsRank: Record<RiskCategory, number> = {
    Low: 1,
    Moderate: 2,
    High: 3,
    'Very High': 4,
  };

  for (const evt of events) {
    // Window from 12 hours before start to end
    const startDateObj = new Date(evt.start);
    const windowStart = new Date(startDateObj.getTime() - 12 * 3600 * 1000).toISOString();

    const matchingPreds = predictions.filter((p) => {
      const isEvtCity =
        evt.city.toUpperCase() === 'ALL' ||
        evt.city.toLowerCase() === p.cityName.toLowerCase() ||
        evt.city.toLowerCase() === p.cityId.toLowerCase();
      return isEvtCity && p.timestamp >= windowStart && p.timestamp <= evt.end;
    });

    let highestLevel: RiskCategory | 'None' = 'None';
    let highestRank = 0;
    let firstDetectionHour: string | null = null;

    matchingPreds.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    for (const p of matchingPreds) {
      const rank = riskLevelsRank[p.baseline_level];
      if (rank > highestRank) {
        highestRank = rank;
        highestLevel = p.baseline_level;
      }

      if (
        firstDetectionHour === null &&
        isPredictedEvent(p.baseline_level, APP_CONFIG.eventPredictionLevel)
      ) {
        firstDetectionHour = p.timestamp;
      }
    }

    let leadTimeHours: number | null = null;
    let detected = false;

    if (firstDetectionHour) {
      detected = true;
      const detectTime = new Date(firstDetectionHour).getTime();
      const eventStartTime = new Date(evt.start).getTime();
      // Lead time in hours: positive = before event start, negative = after event start
      leadTimeHours = Math.round((eventStartTime - detectTime) / (3600 * 1000));
    }

    eventSummaries.push({
      event: evt,
      highestBaselineLevel: highestLevel,
      firstDetectionHour,
      leadTimeHours,
      detected,
    });
  }

  // A5: False alarm episodes
  // Runs of consecutive hours at or above config.eventPredictionLevel that do NOT overlap
  // any event window extended by config.matchToleranceHours (placeholder 3) inside searched period.
  const falseAlarmEpisodes: FalseAlarmEpisode[] = [];
  const toleranceHours = APP_CONFIG.matchToleranceHours ?? 3;

  // Build extended event intervals
  const extendedEventIntervals = events.map((e) => {
    const s = new Date(new Date(e.start).getTime() - toleranceHours * 3600 * 1000).toISOString();
    const end = new Date(new Date(e.end).getTime() + toleranceHours * 3600 * 1000).toISOString();
    return { city: e.city.toUpperCase(), start: s, end };
  });

  // Group evaluated predictions by city
  const cityPredsMap: Record<string, HindcastHourlyPrediction[]> = {};
  for (const p of predictions) {
    const isCitySearched =
      isAllCitiesSearched ||
      searchedCitiesSet.has(p.cityName.toLowerCase()) ||
      searchedCitiesSet.has(p.cityId.toLowerCase());
    const isInsidePeriod =
      p.timestamp >= searchedPeriod.start && p.timestamp <= searchedPeriod.end;

    if (isCitySearched && isInsidePeriod && !p.isCoreDataMissing) {
      if (!cityPredsMap[p.cityName]) cityPredsMap[p.cityName] = [];
      cityPredsMap[p.cityName].push(p);
    }
  }

  for (const [cityName, pList] of Object.entries(cityPredsMap)) {
    pList.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    let inRun = false;
    let runStart = '';
    let runEnd = '';
    let runScores: number[] = [];
    let runLevels: RiskCategory[] = [];

    const flushRun = () => {
      if (!inRun) return;
      // Check if this run overlaps any extended event window for this city or ALL
      const overlapsAnyEvent = extendedEventIntervals.some((intv) => {
        const cityMatch = intv.city === 'ALL' || intv.city === cityName.toUpperCase();
        if (!cityMatch) return false;
        return runStart <= intv.end && runEnd >= intv.start;
      });

      if (!overlapsAnyEvent) {
        let maxScore = 0;
        let maxLevel: RiskCategory = 'Low';
        let maxRank = 0;
        for (let i = 0; i < runScores.length; i++) {
          if (runScores[i] > maxScore) maxScore = runScores[i];
          const rank = riskLevelsRank[runLevels[i]];
          if (rank > maxRank) {
            maxRank = rank;
            maxLevel = runLevels[i];
          }
        }

        falseAlarmEpisodes.push({
          city: cityName,
          startHour: runStart,
          endHour: runEnd,
          durationHours: runScores.length,
          peakLevel: maxLevel,
          peakScore: maxScore,
        });
      }

      inRun = false;
      runStart = '';
      runEnd = '';
      runScores = [];
      runLevels = [];
    };

    for (const p of pList) {
      const isAlarm = isPredictedEvent(p.baseline_level, APP_CONFIG.eventPredictionLevel);
      if (isAlarm) {
        if (!inRun) {
          inRun = true;
          runStart = p.timestamp;
        }
        runEnd = p.timestamp;
        runScores.push(p.baseline_score);
        runLevels.push(p.baseline_level);
      } else {
        flushRun();
      }
    }
    flushRun();
  }

  // A4 Split evaluation (Tuning period vs Test period)
  let splitStats: SplitEvaluationStats | undefined = undefined;
  if (splitDate && splitDate.trim().length > 0) {
    const tuningRows = evaluatedRows.filter((r) => r.timestamp < splitDate);
    const testRows = evaluatedRows.filter((r) => r.timestamp >= splitDate);

    const calcSplitPreds = (rows: typeof evaluatedRows) => ({
      baselineRuleScore: calculatePredictorStatsFromRows(
        rows.map((r) => ({ observed_event: r.observed_event, level: r.baseline_level }))
      ),
      trainedModel: rows.some((r) => r.model_level && r.model_level.length > 0)
        ? calculatePredictorStatsFromRows(
            rows.map((r) => ({ observed_event: r.observed_event, level: r.model_level }))
          )
        : undefined,
      persistenceBenchmark: rows.some((r) => r.persistence_level)
        ? calculatePredictorStatsFromRows(
            rows.map((r) => ({
              observed_event: r.observed_event,
              level: r.persistence_level || '',
            }))
          )
        : undefined,
    });

    splitStats = {
      splitDate,
      tuningPeriod: {
        periodRange: `Start to ${splitDate}`,
        rowsCount: tuningRows.length,
        observedEventsCount: tuningRows.filter((r) => r.observed_event === 1).length,
        predictors: calcSplitPreds(tuningRows),
      },
      testPeriod: {
        periodRange: `${splitDate} to End`,
        rowsCount: testRows.length,
        observedEventsCount: testRows.filter((r) => r.observed_event === 1).length,
        predictors: calcSplitPreds(testRows),
      },
    };
  }

  // Metadata JSON construction
  const metadata: WorkbenchMetadata = {
    timeGenerated: new Date().toISOString(),
    daysRequested,
    searchedPeriod,
    searchedCities: isAllCitiesSearched ? ['All 10 Cities'] : searchedCities,
    hoursEvaluated: evaluatedRows.length,
    hoursExcluded: hoursExcludedOutsideSearch + hoursExcludedMissingCoreData,
    hoursExcludedReason: `Outside searched window/cities: ${hoursExcludedOutsideSearch} hours; Missing core readings: ${hoursExcludedMissingCoreData} hours`,
    eventsUsed: events.length,
    eventsExcluded: allParsedEventsCount - events.length,
    excludedEventDetails:
      excludedNonIndependentCount > 0
        ? [
            {
              city: 'Multiple',
              start: '-',
              end: '-',
              reason: `${excludedNonIndependentCount} non-independent event(s) excluded (model forecast / CAMS / Open-Meteo source)`,
            },
          ]
        : [],
    trainedModelLoaded: activeModel !== null,
    activeModelInfo: activeModel
      ? {
          name: activeModel.model_name,
          version: activeModel.version,
          trainedDate: activeModel.trained_date,
        }
      : undefined,
    configSnapshot: {
      thresholds: APP_CONFIG.thresholds,
      cutoffs: APP_CONFIG.cutoffs,
      confidenceRules: APP_CONFIG.confidenceRules,
      particleCapEnabled: APP_CONFIG.particleCapEnabled,
      particleCapDustThreshold: APP_CONFIG.particleCapDustThreshold,
      particleCapPm10Threshold: APP_CONFIG.particleCapPm10Threshold,
      particleCapMaxScore: APP_CONFIG.particleCapMaxScore,
      matchToleranceHours: APP_CONFIG.matchToleranceHours,
    },
    eventPredictionLevel: APP_CONFIG.eventPredictionLevel,
    eventDefinitionText: APP_CONFIG.eventDefinitionText,
    hindcastLabel,
    isSynthetic: isSyntheticData,
    isSample: isSampleData,
  };

  const metadataJson = JSON.stringify(metadata, null, 2);

  return {
    csvText,
    metadataJson,
    evaluatedRows,
    metadata,
    eventSummaries,
    falseAlarmEpisodes,
    hasEnoughEvents: events.length >= 10,
    splitStats,
    isSynthetic: isSyntheticData,
    isSample: isSampleData,
  };
}

// ----------------------------------------------------
// Part B: Nurse Comparison Service Logic
// ----------------------------------------------------

/**
 * Parses Nurse Log CSV:
 * date (YYYY-MM-DD), hour (0 to 23), activity (break or pe), nurse_action (normal, shorten or cancel)
 */
export function parseNurseLogCsv(csvText: string): {
  success: boolean;
  rows: NurseComparisonInputRow[];
  ignoredRows: string[];
  error?: string;
} {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) {
    return {
      success: false,
      rows: [],
      ignoredRows: [],
      error: 'Nurse log CSV is empty or missing headers.',
    };
  }

  const headerLine = lines[0];
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());
  const reqCols = ['date', 'hour', 'activity', 'nurse_action'];
  const missing = reqCols.filter((col) => !headers.includes(col));
  if (missing.length > 0) {
    return {
      success: false,
      rows: [],
      ignoredRows: [],
      error: `Missing required columns: ${missing.join(', ')}. Expected: ${reqCols.join(', ')}`,
    };
  }

  const idxDate = headers.indexOf('date');
  const idxHour = headers.indexOf('hour');
  const idxActivity = headers.indexOf('activity');
  const idxAction = headers.indexOf('nurse_action');

  const rows: NurseComparisonInputRow[] = [];
  const ignoredRows: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const rowNum = i + 1;
    const parts = lines[i].split(',').map((p) => p.trim());
    if (parts.length < reqCols.length) {
      ignoredRows.push(`Row ${rowNum}: Not enough columns`);
      continue;
    }

    const date = parts[idxDate];
    const rawHour = parts[idxHour];
    const activity = parts[idxActivity]?.toLowerCase();
    const action = parts[idxAction]?.toLowerCase();

    // Validate date format YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      ignoredRows.push(`Row ${rowNum}: Invalid date format "${date}". Must be YYYY-MM-DD.`);
      continue;
    }

    const hour = parseInt(rawHour, 10);
    if (Number.isNaN(hour) || hour < 0 || hour > 23) {
      ignoredRows.push(`Row ${rowNum}: Invalid hour "${rawHour}". Must be 0 to 23.`);
      continue;
    }

    if (activity !== 'break' && activity !== 'pe') {
      ignoredRows.push(`Row ${rowNum}: Invalid activity "${activity}". Must be break or pe.`);
      continue;
    }

    if (action !== 'normal' && action !== 'shorten' && action !== 'cancel') {
      ignoredRows.push(`Row ${rowNum}: Invalid nurse_action "${action}". Must be normal, shorten or cancel.`);
      continue;
    }

    rows.push({
      rowNumber: rowNum,
      date,
      hour,
      activity: activity as 'break' | 'pe',
      nurse_action: action as NurseAction,
    });
  }

  return {
    success: true,
    rows,
    ignoredRows,
  };
}

/**
 * Returns default template CSV for Nurse logs.
 */
export function getNurseLogTemplateCsv(): string {
  return [
    'date,hour,activity,nurse_action',
    '2026-10-10,10,break,normal',
    '2026-10-10,13,pe,shorten',
    '2026-10-10,14,break,cancel',
    '2026-10-15,11,break,shorten',
    '2026-10-15,12,pe,cancel',
  ].join('\n');
}

/**
 * B2, B3, B4: Evaluates nurse logs against school policy and Open-Meteo hindcast data.
 * Checks:
 * - If policy not configured or is fictional demo: shows "School policy not loaded" and stops.
 * - Rows outside available 92-day data marked "outside available data"
 * - Rows with missing readings marked "Not evaluated"
 * - Action levels: normal (0) < shorten (1) < cancel (2)
 * - Result called strictly "agreement", never "accuracy"
 */
export function evaluateNurseComparison(params: {
  nurseRows: NurseComparisonInputRow[];
  schoolPolicy: SchoolPolicyConfig | null;
  rawCityData: Record<string, RawCityData>;
  schoolCityId: string;
}): {
  success: boolean;
  error?: string;
  summary?: NurseComparisonSummary;
} {
  const { nurseRows, schoolPolicy, rawCityData, schoolCityId } = params;

  // B2: If school policy is not configured, show "School policy not loaded" and stop.
  // Never use the fictional test policy for this comparison.
  if (
    !schoolPolicy ||
    !schoolPolicy.isConfigured ||
    schoolPolicy.isFictionalDemo === true ||
    schoolPolicy.rules.length === 0
  ) {
    return {
      success: false,
      error: 'School policy not loaded',
    };
  }

  const cityData = rawCityData[schoolCityId];
  if (!cityData) {
    return {
      success: false,
      error: `Environmental telemetry for selected campus (${schoolCityId}) is not loaded. Cannot substitute another city's data.`,
    };
  }
  const cityName = cityData?.city?.name || schoolCityId;

  const wxTimes = cityData?.weather?.hourly?.time || [];
  const aqTimes = cityData?.airQuality?.hourly?.time || [];

  const wxTimeIndexMap = new Map<string, number>();
  for (let i = 0; i < wxTimes.length; i++) {
    if (wxTimes[i]) wxTimeIndexMap.set(wxTimes[i], i);
  }

  const aqTimeIndexMap = new Map<string, number>();
  for (let i = 0; i < aqTimes.length; i++) {
    if (aqTimes[i]) aqTimeIndexMap.set(aqTimes[i], i);
  }

  const allTimes = Array.from(new Set([...wxTimes, ...aqTimes])).sort();
  const earliestTime = allTimes[0] || '';
  const latestTime = allTimes[allTimes.length - 1] || '';

  const resultRows: NurseComparisonResultRow[] = [];
  let sameCount = 0;
  let moreCautiousCount = 0;
  let lessCautiousCount = 0;
  let notEvaluatedCount = 0;
  let outsideDataCount = 0;

  const actionSeverity: Record<NurseAction, number> = {
    normal: 0,
    shorten: 1,
    cancel: 2,
  };

  for (const item of nurseRows) {
    const formattedHour = String(item.hour).padStart(2, '0');
    const targetIso = `${item.date}T${formattedHour}:00`;

    // Check if outside available Open-Meteo data
    const wxIdx = wxTimeIndexMap.get(targetIso);
    const aqIdx = aqTimeIndexMap.get(targetIso);

    if (allTimes.length === 0 || targetIso < earliestTime || targetIso > latestTime) {
      outsideDataCount++;
      resultRows.push({
        rowNumber: item.rowNumber,
        date: item.date,
        hour: item.hour,
        timestamp: targetIso,
        city: cityName,
        activity: item.activity,
        nurse_action: item.nurse_action,
        status: 'outside_data',
        reason: 'Outside available Open-Meteo past data date range',
      });
      continue;
    }

    if (wxIdx === undefined && aqIdx === undefined) {
      outsideDataCount++;
      resultRows.push({
        rowNumber: item.rowNumber,
        date: item.date,
        hour: item.hour,
        timestamp: targetIso,
        city: cityName,
        activity: item.activity,
        nurse_action: item.nurse_action,
        status: 'outside_data',
        reason: 'Specific hour timestamp not found in retrieved hindcast series',
      });
      continue;
    }

    // Extract readings for that hour matching strictly by timestamp
    const dust = aqIdx !== undefined ? (cityData?.airQuality?.hourly?.dust?.[aqIdx] ?? null) : null;
    const pm10 = aqIdx !== undefined ? (cityData?.airQuality?.hourly?.pm10?.[aqIdx] ?? null) : null;
    const pm2_5 = aqIdx !== undefined ? (cityData?.airQuality?.hourly?.pm2_5?.[aqIdx] ?? null) : null;
    const aod = aqIdx !== undefined ? (cityData?.airQuality?.hourly?.aerosol_optical_depth?.[aqIdx] ?? null) : null;

    const windSpeed = wxIdx !== undefined ? (cityData?.weather?.hourly?.wind_speed_10m?.[wxIdx] ?? null) : null;
    const windGusts = wxIdx !== undefined ? (cityData?.weather?.hourly?.wind_gusts_10m?.[wxIdx] ?? null) : null;
    const windDir = wxIdx !== undefined ? (cityData?.weather?.hourly?.wind_direction_10m?.[wxIdx] ?? null) : null;
    const humidity = wxIdx !== undefined ? (cityData?.weather?.hourly?.relative_humidity_2m?.[wxIdx] ?? null) : null;
    const temp = wxIdx !== undefined ? (cityData?.weather?.hourly?.temperature_2m?.[wxIdx] ?? null) : null;
    const visibility = wxIdx !== undefined ? (cityData?.weather?.hourly?.visibility?.[wxIdx] ?? null) : null;

    const rawVars: RawHourlyVariables = {
      time: targetIso,
      pm10,
      pm2_5,
      dust,
      aerosol_optical_depth: aod,
      wind_speed_10m: windSpeed,
      wind_gusts_10m: windGusts,
      wind_direction_10m: windDir,
      relative_humidity_2m: humidity,
      temperature_2m: temp,
      visibility,
    };

    const heatIndexRes = calculateHeatIndex(temp, humidity);

    // Evaluate School Mode action
    const assessment = evaluateActivityPolicy(
      rawVars,
      heatIndexRes,
      schoolPolicy,
      item.activity
    );

    const rowReadings = {
      temperature: temp,
      relativeHumidity: humidity,
      heatIndex: heatIndexRes.heatIndexCelsius,
      pm10,
      pm2_5,
      dust,
      windSpeed,
      windGusts,
      visibility,
    };

    // 1. Exclude if no applicable rules configured for this activity
    if (assessment.status === 'no_applicable_rules') {
      notEvaluatedCount++;
      resultRows.push({
        rowNumber: item.rowNumber,
        date: item.date,
        hour: item.hour,
        timestamp: targetIso,
        city: cityName,
        activity: item.activity,
        nurse_action: item.nurse_action,
        status: 'not_evaluated',
        reason: `No applicable rules configured for activity "${item.activity}". Excluded from agreement denominator.`,
        readings: rowReadings,
      });
      continue;
    }

    // 2. Exclude if policy is unconfigured or assessment unavailable due to missing data
    if (
      assessment.status === 'policy_unconfigured' ||
      assessment.status === 'assessment_unavailable'
    ) {
      notEvaluatedCount++;
      resultRows.push({
        rowNumber: item.rowNumber,
        date: item.date,
        hour: item.hour,
        timestamp: targetIso,
        city: cityName,
        activity: item.activity,
        nurse_action: item.nurse_action,
        status: 'not_evaluated',
        reason: 'Required environmental readings missing or invalid for school policy assessment. Excluded from agreement denominator.',
        readings: rowReadings,
      });
      continue;
    }

    // Map DustWatch action to normal, shorten, or cancel
    let dwAction: NurseAction = 'normal';
    if (assessment.recommendedAction === 'modified') {
      dwAction = 'shorten';
    } else if (
      assessment.recommendedAction === 'indoor_only' ||
      assessment.recommendedAction === 'suspend'
    ) {
      dwAction = 'cancel';
    }

    // 3. If action was triggered but assessment was incomplete (partial readings):
    // Preserve the triggered action, disclose the limitation, but exclude from fully evaluated denominator
    if (assessment.isIncomplete) {
      notEvaluatedCount++;
      resultRows.push({
        rowNumber: item.rowNumber,
        date: item.date,
        hour: item.hour,
        timestamp: targetIso,
        city: cityName,
        activity: item.activity,
        nurse_action: item.nurse_action,
        dustwatch_action: dwAction,
        status: 'not_evaluated',
        reason: `Incomplete assessment: rule triggered action "${dwAction}", but other applicable readings were unavailable. Excluded from fully evaluated agreement denominator.`,
        readings: rowReadings,
        triggeredRules: assessment.triggeredRules
          .filter((tr) => tr.isTriggered)
          .map((tr) => tr.rule.name),
      });
      continue;
    }

    // 4. Truly fully evaluated row (criteria_met_no_actions or complete action_triggered)
    const dwLevel = actionSeverity[dwAction];
    const nurseLevel = actionSeverity[item.nurse_action];

    let category: NurseAgreementCategory = 'same_action';
    if (dwLevel === nurseLevel) {
      category = 'same_action';
      sameCount++;
    } else if (dwLevel > nurseLevel) {
      category = 'dustwatch_more_cautious';
      moreCautiousCount++;
    } else {
      category = 'dustwatch_less_cautious';
      lessCautiousCount++;
    }

    resultRows.push({
      rowNumber: item.rowNumber,
      date: item.date,
      hour: item.hour,
      timestamp: targetIso,
      city: cityName,
      activity: item.activity,
      nurse_action: item.nurse_action,
      dustwatch_action: dwAction,
      status: 'evaluated',
      agreement_category: category,
      readings: rowReadings,
      triggeredRules: assessment.triggeredRules
        .filter((tr) => tr.isTriggered)
        .map((tr) => tr.rule.name),
      reason: assessment.reason,
    });
  }

  const evaluatedCount = sameCount + moreCautiousCount + lessCautiousCount;
  const agreementRatePct = evaluatedCount > 0 ? (sameCount / evaluatedCount) * 100 : null;

  const isSynthetic = Boolean(
    cityData.isSampleOrSnapshot ||
    cityData.snapshotLabel === SYNTHETIC_HINDCAST_LABEL ||
    /synthetic|sample|mock|demo/i.test(cityData.snapshotLabel || '')
  );
  const resolvedLabel = cityData.snapshotLabel || (isSynthetic ? SYNTHETIC_HINDCAST_LABEL : HINDCAST_PROVENANCE_LABEL);

  return {
    success: true,
    summary: {
      totalRows: nurseRows.length,
      evaluatedCount,
      sameActionCount: sameCount,
      dustwatchMoreCautiousCount: moreCautiousCount,
      dustwatchLessCautiousCount: lessCautiousCount,
      notEvaluatedCount,
      outsideDataCount,
      agreementRatePct: agreementRatePct !== null ? Math.round(agreementRatePct * 10) / 10 : null,
      lessCautiousRows: resultRows.filter((r) => r.agreement_category === 'dustwatch_less_cautious'),
      allRows: resultRows,
      hindcastLabel: resolvedLabel,
      isSynthetic,
      note: "Differences can come from model data versus the nurses' app or on-site observation. Environmental telemetry is derived from Open-Meteo atmospheric model reanalysis/forecast data, not calibrated co-located ground instruments, and should not be interpreted as ground-truth model validation.",
    },
  };
}
