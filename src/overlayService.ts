/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type OverlayType = 'none' | 'temperature' | 'air_quality' | 'aerosol' | 'satellite_omps';
export type AirQualityMetric = 'us_aqi' | 'pm10' | 'pm2_5' | 'european_aqi';
export type OverlayMetric = 'temperature' | AirQualityMetric | 'aerosol' | 'aod';

export interface GridCell {
  id: string;
  lat: number;
  lon: number;
  bounds: [[number, number], [number, number]];
  regionLabel: string;
}

export interface TemperatureCellData {
  cellId: string;
  lat: number;
  lon: number;
  temperatureC: number | null;
  time: string;
  status: 'ok' | 'missing' | 'error';
}

export interface AirQualityCellData {
  cellId: string;
  lat: number;
  lon: number;
  usAqi: number | null;
  europeanAqi: number | null;
  pm10: number | null;
  pm2_5: number | null;
  time: string;
  status: 'ok' | 'missing' | 'error';
}

export interface AerosolCellData {
  cellId: string;
  lat: number;
  lon: number;
  aod: number | null; // Column-integrated Aerosol Optical Depth at 550nm
  time: string;
  status: 'ok' | 'missing' | 'error';
}

export interface OverlayDataResult<T> {
  type: OverlayType;
  cells: T[];
  timestamp: string;
  sourceAttribution: string;
  dataSourceNature: 'model_forecast' | 'satellite_observation';
  disclaimer: string;
  isCached: boolean;
  validCount?: number;
  missingCount?: number;
  invalidCount?: number;
}

// Bounding box for the continuous UAE environmental raster overlay
// Strictly encompassing UAE territory: 22.5°N - 26.3°N, 51.3°E - 56.6°E
export const UAE_RASTER_BOUNDS: [[number, number], [number, number]] = [
  [22.5, 51.3],
  [26.3, 56.6],
];

// Regular 36-point geographic grid covering the UAE landmass and territorial waters
export const UAE_GRID_CELLS: GridCell[] = (() => {
  const lats = [23.0, 23.6, 24.2, 24.8, 25.4, 25.9];
  const lons = [51.8, 52.7, 53.6, 54.5, 55.4, 56.2];
  const halfLat = 0.3;
  const halfLon = 0.45;

  const cells: GridCell[] = [];
  for (let r = 0; r < lats.length; r++) {
    for (let c = 0; c < lons.length; c++) {
      const lat = lats[r];
      const lon = lons[c];
      const id = `cell-${lat.toFixed(1)}-${lon.toFixed(1)}`;

      let regionLabel = 'UAE Desert / Inland';
      if (lat >= 25.0 && lon >= 54.8) regionLabel = 'Northern Emirates / Coast';
      else if (lat >= 24.0 && lon >= 54.0 && lon <= 55.0) regionLabel = 'Abu Dhabi Central & Capital';
      else if (lat <= 23.5) regionLabel = 'Liwa / Empty Quarter Border';
      else if (lon <= 52.5) regionLabel = 'Al Dhafra / Western Region';
      else if (lon >= 55.8) regionLabel = 'Eastern Region / Hajar Mountains';

      cells.push({
        id,
        lat,
        lon,
        bounds: [
          [lat - halfLat, lon - halfLon],
          [lat + halfLat, lon + halfLon],
        ],
        regionLabel,
      });
    }
  }
  return cells;
})();

// In-memory overlay cache with 10-minute TTL
let cachedTempData: OverlayDataResult<TemperatureCellData> | null = null;
let cachedTempTimestamp = 0;

let cachedAqData: OverlayDataResult<AirQualityCellData> | null = null;
let cachedAqTimestamp = 0;

let cachedAerosolData: OverlayDataResult<AerosolCellData> | null = null;
let cachedAerosolTimestamp = 0;

const CACHE_TTL_MS = 10 * 60 * 1000;

export function clearOverlayCache(): void {
  cachedTempData = null;
  cachedTempTimestamp = 0;
  cachedAqData = null;
  cachedAqTimestamp = 0;
  cachedAerosolData = null;
  cachedAerosolTimestamp = 0;
}

/**
 * Single fetch helper with timeout and 1 retry
 */
async function fetchWithTimeout(url: string, timeoutMs = 9000): Promise<unknown> {
  const attempt = async () => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return await res.json();
    } finally {
      clearTimeout(id);
    }
  };

  try {
    return await attempt();
  } catch {
    return await attempt();
  }
}

/**
 * Fetches genuine gridded temperature across the UAE using Open-Meteo Numerical Weather Prediction models.
 */
export async function fetchGridTemperature(): Promise<OverlayDataResult<TemperatureCellData>> {
  const now = Date.now();
  if (cachedTempData && now - cachedTempTimestamp < CACHE_TTL_MS) {
    return { ...cachedTempData, isCached: true };
  }

  const lats = UAE_GRID_CELLS.map((c) => c.lat).join(',');
  const lons = UAE_GRID_CELLS.map((c) => c.lon).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m&timezone=Asia%2FDubai`;

  try {
    const rawResponses = (await fetchWithTimeout(url)) as Array<{
      current?: { time?: string; temperature_2m?: number | null };
    }>;

    const list = Array.isArray(rawResponses) ? rawResponses : [rawResponses];
    const cells: TemperatureCellData[] = UAE_GRID_CELLS.map((cell, idx) => {
      const resp = list[idx];
      const val = resp?.current?.temperature_2m;
      const isValid = typeof val === 'number' && Number.isFinite(val);
      return {
        cellId: cell.id,
        lat: cell.lat,
        lon: cell.lon,
        temperatureC: isValid ? Math.round(val * 10) / 10 : null,
        time: resp?.current?.time || new Date().toISOString(),
        status: isValid ? 'ok' : 'missing',
      };
    });

    const result: OverlayDataResult<TemperatureCellData> = {
      type: 'temperature',
      cells,
      timestamp: cells[0]?.time || new Date().toISOString(),
      sourceAttribution: 'Open-Meteo NWP Numerical Weather Prediction Model (ECMWF IFS / ICON blend)',
      dataSourceNature: 'model_forecast',
      disclaimer: 'Gridded 2m ambient air temperature forecast (~0.4° native resolution). Rendered via continuous spatial resampling for display; not direct physical thermometer readings at every micro-location.',
      isCached: false,
    };

    cachedTempData = result;
    cachedTempTimestamp = now;
    return result;
  } catch (err) {
    throw new Error(`Failed to load gridded temperature overlay: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Fetches genuine gridded air quality (AQI, PM10, PM2.5) across the UAE using Copernicus CAMS / Open-Meteo.
 */
export async function fetchGridAirQuality(): Promise<OverlayDataResult<AirQualityCellData>> {
  const now = Date.now();
  if (cachedAqData && now - cachedAqTimestamp < CACHE_TTL_MS) {
    return { ...cachedAqData, isCached: true };
  }

  const lats = UAE_GRID_CELLS.map((c) => c.lat).join(',');
  const lons = UAE_GRID_CELLS.map((c) => c.lon).join(',');
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lons}&current=pm10,pm2_5,us_aqi,european_aqi&timezone=Asia%2FDubai`;

  try {
    const rawResponses = (await fetchWithTimeout(url)) as Array<{
      current?: {
        time?: string;
        us_aqi?: number | null;
        european_aqi?: number | null;
        pm10?: number | null;
        pm2_5?: number | null;
      };
    }>;

    const list = Array.isArray(rawResponses) ? rawResponses : [rawResponses];
    const cells: AirQualityCellData[] = UAE_GRID_CELLS.map((cell, idx) => {
      const resp = list[idx]?.current;
      const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
      const hasAnyData = isNum(resp?.pm10) || isNum(resp?.pm2_5) || isNum(resp?.us_aqi);

      return {
        cellId: cell.id,
        lat: cell.lat,
        lon: cell.lon,
        usAqi: isNum(resp?.us_aqi) ? Math.round(resp.us_aqi) : null,
        europeanAqi: isNum(resp?.european_aqi) ? Math.round(resp.european_aqi) : null,
        pm10: isNum(resp?.pm10) ? Math.round(resp.pm10 * 10) / 10 : null,
        pm2_5: isNum(resp?.pm2_5) ? Math.round(resp.pm2_5 * 10) / 10 : null,
        time: resp?.time || new Date().toISOString(),
        status: hasAnyData ? 'ok' : 'missing',
      };
    });

    const result: OverlayDataResult<AirQualityCellData> = {
      type: 'air_quality',
      cells,
      timestamp: cells[0]?.time || new Date().toISOString(),
      sourceAttribution: 'Copernicus Atmosphere Monitoring Service (CAMS) Global & Regional Models via Open-Meteo',
      dataSourceNature: 'model_forecast',
      disclaimer: 'Atmospheric particulate and air quality index dispersion model estimates (~0.25°–0.4° native resolution). Continuous IQAir-style surface is rendered via smooth spatial resampling; this visual smoothing does not increase physical sensor resolution.',
      isCached: false,
    };

    cachedAqData = result;
    cachedAqTimestamp = now;
    return result;
  } catch (err) {
    throw new Error(`Failed to load gridded air quality overlay: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Fetches genuine gridded Aerosol Optical Depth (AOD @ 550nm) across the UAE using Copernicus CAMS via Open-Meteo.
 * Does not invent observations or fill missing cells with fabricated values.
 */
export async function fetchGridAerosol(forceRefresh = false): Promise<OverlayDataResult<AerosolCellData>> {
  const now = Date.now();
  if (!forceRefresh && cachedAerosolData && now - cachedAerosolTimestamp < CACHE_TTL_MS) {
    return { ...cachedAerosolData, isCached: true };
  }

  const lats = UAE_GRID_CELLS.map((c) => c.lat).join(',');
  const lons = UAE_GRID_CELLS.map((c) => c.lon).join(',');
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lons}&current=aerosol_optical_depth&timezone=Asia%2FDubai`;

  try {
    const rawResponses = (await fetchWithTimeout(url)) as Array<{
      current?: { time?: string; aerosol_optical_depth?: number | null };
    }>;

    const list = Array.isArray(rawResponses) ? rawResponses : [rawResponses];
    let validCount = 0;
    let missingCount = 0;
    let invalidCount = 0;

    const cells: AerosolCellData[] = UAE_GRID_CELLS.map((cell, idx) => {
      const resp = list[idx];
      const val = resp?.current?.aerosol_optical_depth;

      if (val === null || val === undefined) {
        missingCount++;
        return {
          cellId: cell.id,
          lat: cell.lat,
          lon: cell.lon,
          aod: null,
          time: resp?.current?.time || new Date().toISOString(),
          status: 'missing',
        };
      }

      if (typeof val !== 'number' || !Number.isFinite(val) || Number.isNaN(val) || val < 0) {
        invalidCount++;
        return {
          cellId: cell.id,
          lat: cell.lat,
          lon: cell.lon,
          aod: null,
          time: resp?.current?.time || new Date().toISOString(),
          status: 'error',
        };
      }

      validCount++;
      return {
        cellId: cell.id,
        lat: cell.lat,
        lon: cell.lon,
        aod: Math.round(val * 100) / 100,
        time: resp?.current?.time || new Date().toISOString(),
        status: 'ok',
      };
    });

    const result: OverlayDataResult<AerosolCellData> = {
      type: 'aerosol',
      cells,
      timestamp: cells[0]?.time || new Date().toISOString(),
      sourceAttribution: 'Copernicus Atmosphere Monitoring Service (CAMS) Global Atmospheric Model via Open-Meteo',
      dataSourceNature: 'model_forecast',
      disclaimer: 'Gridded column-integrated Aerosol Optical Depth (AOD at 550nm, ~0.4° native resolution). AOD measures total optical extinction throughout the atmospheric column by airborne particles (mineral dust, marine aerosol, and combustion aerosols). Rendered via continuous IDW spatial resampling for regional visualization without increasing native sensor resolution. AOD is NOT a direct measurement of ground-level PM10 or surface dust concentration.',
      isCached: false,
      validCount,
      missingCount,
      invalidCount,
    };

    cachedAerosolData = result;
    cachedAerosolTimestamp = now;
    return result;
  } catch (err) {
    throw new Error(`Failed to load gridded aerosol overlay: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export const fetchGridAod = fetchGridAerosol;

export interface AerosolDetectionConfig {
  tileUrl: string;
  attribution: string;
  dateString: string;
  productName: string;
  instrument: string;
  platform: string;
  layerIdentifier: string;
  disclaimer: string;
  dataSourceNature: 'satellite_observation';
  maxNativeZoom: number;
  maxZoom: number;
  minZoom: number;
  tileSize: number;
  bounds: [[number, number], [number, number]];
}

export interface AerosolIndexLevel {
  range: string;
  label: string;
  color: string;
  description: string;
}

export const AEROSOL_INDEX_LEVELS: AerosolIndexLevel[] = [
  {
    range: '≤ 0.5',
    label: 'Low / Near-Zero Signal',
    color: '#e0e0e0',
    description: 'Clean atmosphere, non-absorbing particles (clouds, marine aerosol), or background',
  },
  {
    range: '0.5–1.5',
    label: 'Positive Aerosol Signal',
    color: '#facc15',
    description: 'Detectable UV-absorbing aerosols (e.g. elevated dust, haze, or smoke aloft)',
  },
  {
    range: '1.5–3.0',
    label: 'Moderate Aerosol Signal',
    color: '#f97316',
    description: 'Elevated column absorbing aerosols from dust plumes or regional smoke transport',
  },
  {
    range: '> 3.0',
    label: 'Stronger Aerosol Signal',
    color: '#881337',
    description: 'Strong column absorption from dense absorbing plumes or high-altitude transport',
  },
];

export interface AodLevel {
  range: string;
  label: string;
  color: string;
  min: number;
  max: number;
  description: string;
}

export const AOD_LEVELS: AodLevel[] = [
  {
    range: '≤ 0.20',
    label: 'Clean / Low',
    color: '#10b981',
    min: 0,
    max: 0.2,
    description: 'Clean background atmospheric column with low particulate extinction',
  },
  {
    range: '0.21–0.50',
    label: 'Moderate / Light Haze',
    color: '#facc15',
    min: 0.2,
    max: 0.5,
    description: 'Typical regional arid background with light ambient dust haze',
  },
  {
    range: '0.51–1.00',
    label: 'Elevated Aerosol',
    color: '#f97316',
    min: 0.5,
    max: 1.0,
    description: 'Elevated column aerosol loading from dust transport or haze',
  },
  {
    range: '1.01–1.80',
    label: 'High / Heavy Dust',
    color: '#ef4444',
    min: 1.0,
    max: 1.8,
    description: 'High extinction from dense mineral dust plumes aloft',
  },
  {
    range: '> 1.80',
    label: 'Very High / Extreme Plume',
    color: '#881337',
    min: 1.8,
    max: Infinity,
    description: 'Severe aerosol column loading and heavy solar attenuation',
  },
];

/**
 * Discrete color mapping for Aerosol Optical Depth (AOD @ 550nm)
 */
export function getAodColor(val: number | null): { bg: string; text: string; label: string } {
  if (val === null || !Number.isFinite(val) || Number.isNaN(val)) {
    return { bg: '#9ca3af', text: '#ffffff', label: 'Unavailable' };
  }
  if (val <= 0.2) return { bg: '#10b981', text: '#ffffff', label: 'Clean / Low (≤ 0.20)' };
  if (val <= 0.5) return { bg: '#facc15', text: '#111827', label: 'Moderate (0.21–0.50)' };
  if (val <= 1.0) return { bg: '#f97316', text: '#ffffff', label: 'Elevated (0.51–1.00)' };
  if (val <= 1.8) return { bg: '#ef4444', text: '#ffffff', label: 'High (1.01–1.80)' };
  return { bg: '#881337', text: '#ffffff', label: 'Very High (> 1.80)' };
}

/**
 * Returns NASA GIBS satellite configuration for UV Aerosol Index detection (OMPS Nadir Mapper).
 * Transparent PNG tile layer in Web Mercator (EPSG:3857) allows underlying map and city markers to remain visible.
 * Note: GIBS GoogleMapsCompatible_Level6 matrix defines native tiles up to Level 6.
 * maxNativeZoom: 6 instructs Leaflet to request native tiles up to zoom 6 and auto-scale them for higher zoom levels (up to 11).
 * bounds: Restricts tile fetching and display to the UAE region (UAE_RASTER_BOUNDS), matching model raster extents.
 */
export function getAerosolDetectionConfig(dateOverride?: string): AerosolDetectionConfig {
  const now = new Date();
  const yr = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  const da = String(now.getUTCDate()).padStart(2, '0');
  const dateString = dateOverride || `${yr}-${mo}-${da}`;

  const layerIdentifier = 'OMPS_Aerosol_Index';
  // NASA GIBS WMTS EPSG:3857 Level 6 tile template (transparent PNG)
  const tileUrl = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layerIdentifier}/default/${dateString}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`;

  return {
    tileUrl,
    attribution: 'Imagery &copy; NASA Earth Science Data and Information System (ESDIS) / GIBS / Suomi-NPP OMPS',
    dateString,
    productName: 'Suomi-NPP / OMPS UV Aerosol Index (Level 3 Daily)',
    instrument: 'Ozone Mapping and Profiler Suite (OMPS) Nadir Mapper',
    platform: 'Suomi-NPP Polar Orbiting Satellite',
    layerIdentifier,
    disclaimer: 'Spaceborne satellite UV Aerosol Index indicates the presence of UV-absorbing aerosols (such as mineral dust, smoke, and volcanic ash) in the atmospheric column. It cannot independently identify the aerosol source or directly quantify ground-level particulate matter concentrations (PM10/PM2.5) or ground-level air quality. Display is geographically restricted to the UAE region (22.5°N–26.3°N, 51.3°E–56.6°E) to align visually with national model outlooks; the spaceborne satellite observes a wider regional orbit.',
    dataSourceNature: 'satellite_observation',
    maxNativeZoom: 6,
    maxZoom: 11,
    minZoom: 6,
    tileSize: 256,
    bounds: UAE_RASTER_BOUNDS,
  };
}

/**
 * Interpolates value at point (lat, lon) using Inverse Distance Weighting (IDW).
 * Does NOT invent values: if all nearby points are missing or distance exceeds maxDistanceDeg, returns null.
 */
export function interpolateValueAtPoint(
  lat: number,
  lon: number,
  points: Array<{ lat: number; lon: number; value: number | null }>,
  maxDistanceDeg = 1.35,
  power = 2
): number | null {
  let weightedSum = 0;
  let weightTotal = 0;
  let minDistance = Infinity;
  let exactValue: number | null = null;

  for (const p of points) {
    if (p.value === null || !Number.isFinite(p.value)) continue;

    const dLat = lat - p.lat;
    const dLon = lon - p.lon;
    const dist = Math.sqrt(dLat * dLat + dLon * dLon);

    if (dist < minDistance) {
      minDistance = dist;
    }

    // Exact or near-exact match
    if (dist < 0.01) {
      exactValue = p.value;
      break;
    }

    if (dist <= maxDistanceDeg) {
      const w = 1 / Math.pow(dist, power);
      weightedSum += p.value * w;
      weightTotal += w;
    }
  }

  if (exactValue !== null) return exactValue;
  if (weightTotal === 0 || minDistance > maxDistanceDeg) return null;

  return weightedSum / weightTotal;
}

interface ColorStop {
  val: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Continuous smooth RGB color ramp interpolation.
 */
export function getContinuousColorRgba(
  metric: OverlayMetric,
  value: number | null
): [number, number, number, number] {
  if (value === null || !Number.isFinite(value)) {
    return [0, 0, 0, 0]; // Transparent for missing data
  }

  let stops: ColorStop[];

  if (metric === 'temperature') {
    stops = [
      { val: 14, r: 59, g: 130, b: 246, a: 160 },   // Deep blue
      { val: 20, r: 6, g: 182, b: 212, a: 168 },    // Cyan
      { val: 26, r: 16, g: 185, b: 129, a: 175 },   // Emerald
      { val: 32, r: 234, g: 179, b: 8, a: 182 },    // Yellow/Amber
      { val: 38, r: 249, g: 115, b: 22, a: 190 },   // Orange
      { val: 44, r: 239, g: 68, b: 68, a: 200 },    // Red
      { val: 50, r: 153, g: 27, b: 27, a: 215 },    // Crimson/Dark Red
    ];
  } else if (metric === 'us_aqi') {
    // Continuous EPA AQI color ramp
    stops = [
      { val: 0, r: 16, g: 185, b: 129, a: 165 },    // Good (Green)
      { val: 50, r: 74, g: 222, b: 128, a: 172 },   // Light Green
      { val: 100, r: 250, g: 204, b: 21, a: 180 },  // Moderate (Yellow)
      { val: 150, r: 249, g: 115, b: 22, a: 190 },  // Sensitive (Orange)
      { val: 200, r: 239, g: 68, b: 68, a: 200 },   // Unhealthy (Red)
      { val: 300, r: 139, g: 92, b: 246, a: 215 },  // Very Unhealthy (Purple)
      { val: 500, r: 136, g: 19, b: 55, a: 230 },   // Hazardous (Maroon)
    ];
  } else if (metric === 'pm10') {
    stops = [
      { val: 0, r: 16, g: 185, b: 129, a: 165 },
      { val: 50, r: 132, g: 204, b: 22, a: 172 },
      { val: 100, r: 250, g: 204, b: 21, a: 180 },
      { val: 250, r: 249, g: 115, b: 22, a: 195 },
      { val: 400, r: 239, g: 68, b: 68, a: 205 },
      { val: 600, r: 136, g: 19, b: 55, a: 225 },
    ];
  } else if (metric === 'pm2_5') {
    stops = [
      { val: 0, r: 16, g: 185, b: 129, a: 165 },
      { val: 12, r: 132, g: 204, b: 22, a: 172 },
      { val: 35.4, r: 250, g: 204, b: 21, a: 180 },
      { val: 55.4, r: 249, g: 115, b: 22, a: 195 },
      { val: 150, r: 239, g: 68, b: 68, a: 205 },
      { val: 250, r: 136, g: 19, b: 55, a: 225 },
    ];
  } else if (metric === 'aerosol' || metric === 'aod') {
    // Aerosol Optical Depth (AOD @ 550nm): 0.0 (clean) -> 0.2 -> 0.5 -> 1.0 -> 1.8 -> 3.0 (extreme)
    stops = [
      { val: 0.0, r: 16, g: 185, b: 129, a: 165 },   // Clean background (Emerald #10b981)
      { val: 0.2, r: 132, g: 204, b: 22, a: 172 },  // Low / Mild (Lime #84cc16)
      { val: 0.5, r: 250, g: 204, b: 21, a: 185 },  // Moderate haze (Yellow #facc15)
      { val: 1.0, r: 249, g: 115, b: 22, a: 198 },  // Elevated / Noticeable (Orange #f97316)
      { val: 1.8, r: 239, g: 68, b: 68, a: 215 },   // High / Heavy dust (Red #ef4444)
      { val: 3.0, r: 136, g: 19, b: 55, a: 230 },   // Extreme / Severe plume (Maroon #881337)
    ];
  } else {
    // european_aqi
    stops = [
      { val: 0, r: 16, g: 185, b: 129, a: 165 },
      { val: 20, r: 132, g: 204, b: 22, a: 172 },
      { val: 40, r: 250, g: 204, b: 21, a: 180 },
      { val: 60, r: 249, g: 115, b: 22, a: 195 },
      { val: 80, r: 239, g: 68, b: 68, a: 205 },
      { val: 100, r: 153, g: 27, b: 27, a: 220 },
    ];
  }

  // Value below lowest stop
  if (value <= stops[0].val) {
    const s = stops[0];
    return [s.r, s.g, s.b, s.a];
  }

  // Value above highest stop
  const last = stops[stops.length - 1];
  if (value >= last.val) {
    return [last.r, last.g, last.b, last.a];
  }

  // Linear interpolation between surrounding stops
  for (let i = 0; i < stops.length - 1; i++) {
    const s1 = stops[i];
    const s2 = stops[i + 1];
    if (value >= s1.val && value <= s2.val) {
      const span = s2.val - s1.val;
      const t = span > 0 ? (value - s1.val) / span : 0;
      return [
        Math.round(s1.r + t * (s2.r - s1.r)),
        Math.round(s1.g + t * (s2.g - s1.g)),
        Math.round(s1.b + t * (s2.b - s1.b)),
        Math.round(s1.a + t * (s2.a - s1.a)),
      ];
    }
  }

  return [last.r, last.g, last.b, last.a];
}

/**
 * Builds continuous raster RGBA pixel buffer across UAE bounding box using IDW spatial interpolation.
 */
export function buildRasterImageData(
  width: number,
  height: number,
  bounds: [[number, number], [number, number]],
  points: Array<{ lat: number; lon: number; value: number | null }>,
  metric: OverlayMetric
): Uint8ClampedArray {
  const [[south, west], [north, east]] = bounds;
  const buffer = new Uint8ClampedArray(width * height * 4);

  const latSpan = north - south;
  const lonSpan = east - west;

  for (let y = 0; y < height; y++) {
    const lat = north - (y / (height - 1)) * latSpan;
    const rowOffset = y * width * 4;

    for (let x = 0; x < width; x++) {
      const lon = west + (x / (width - 1)) * lonSpan;
      const val = interpolateValueAtPoint(lat, lon, points, 1.45, 2);
      const [r, g, b, a] = getContinuousColorRgba(metric, val);

      const idx = rowOffset + x * 4;
      buffer[idx] = r;
      buffer[idx + 1] = g;
      buffer[idx + 2] = b;
      buffer[idx + 3] = a;
    }
  }

  return buffer;
}

/**
 * Generates continuous raster Data URL for Leaflet L.imageOverlay.
 * Validates that there are valid data points and verifies that the generated buffer contains visible non-zero pixels.
 * Returns null if all points are missing/invalid or if no visible pixels are produced.
 */
export function generateRasterDataUrl(
  points: Array<{ lat: number; lon: number; value: number | null }>,
  metric: OverlayMetric,
  width = 240,
  height = 180,
  bounds = UAE_RASTER_BOUNDS
): string | null {
  if (typeof document === 'undefined') return null;

  try {
    const validPoints = points.filter((p) => p.value !== null && Number.isFinite(p.value));
    if (validPoints.length === 0) {
      return null;
    }

    const rawBytes = buildRasterImageData(width, height, bounds, points, metric);

    // Verify raster contains visible pixels (non-zero alpha)
    let hasVisiblePixels = false;
    for (let i = 3; i < rawBytes.length; i += 4) {
      if (rawBytes[i] > 0) {
        hasVisiblePixels = true;
        break;
      }
    }
    if (!hasVisiblePixels) {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const imgData = ctx.createImageData(width, height);
    imgData.data.set(rawBytes);
    ctx.putImageData(imgData, 0, 0);

    return canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('Failed to generate continuous raster canvas:', err);
    return null;
  }
}

/**
 * Discrete color mapping for temperature in °C (retained for legend breakpoints & tooltips)
 */
export function getTemperatureColor(tempC: number | null): { bg: string; text: string; label: string } {
  if (tempC === null || Number.isNaN(tempC)) {
    return { bg: '#9ca3af', text: '#ffffff', label: 'Unavailable' };
  }
  if (tempC < 20) return { bg: '#3b82f6', text: '#ffffff', label: '< 20°C (Mild)' };
  if (tempC < 26) return { bg: '#06b6d4', text: '#ffffff', label: '20–25°C (Pleasant)' };
  if (tempC < 32) return { bg: '#10b981', text: '#ffffff', label: '26–31°C (Warm)' };
  if (tempC < 38) return { bg: '#f59e0b', text: '#111827', label: '32–37°C (Hot)' };
  if (tempC < 44) return { bg: '#ea580c', text: '#ffffff', label: '38–43°C (Very Hot)' };
  return { bg: '#b91c1c', text: '#ffffff', label: '≥ 44°C (Extreme Heat)' };
}

/**
 * Discrete color mapping for Air Quality metrics (retained for legend breakpoints & tooltips)
 */
export function getAirQualityColor(
  metric: AirQualityMetric,
  value: number | null
): { bg: string; text: string; category: string } {
  if (value === null || Number.isNaN(value)) {
    return { bg: '#9ca3af', text: '#ffffff', category: 'Data Missing' };
  }

  if (metric === 'us_aqi') {
    if (value <= 50) return { bg: '#10b981', text: '#ffffff', category: 'Good (0–50)' };
    if (value <= 100) return { bg: '#facc15', text: '#111827', category: 'Moderate (51–100)' };
    if (value <= 150) return { bg: '#f97316', text: '#ffffff', category: 'Unhealthy for Sensitive (101–150)' };
    if (value <= 200) return { bg: '#ef4444', text: '#ffffff', category: 'Unhealthy (151–200)' };
    if (value <= 300) return { bg: '#8b5cf6', text: '#ffffff', category: 'Very Unhealthy (201–300)' };
    return { bg: '#881337', text: '#ffffff', category: 'Hazardous (301–500)' };
  }

  if (metric === 'european_aqi') {
    if (value <= 20) return { bg: '#10b981', text: '#ffffff', category: 'Good (0–20)' };
    if (value <= 40) return { bg: '#84cc16', text: '#111827', category: 'Fair (21–40)' };
    if (value <= 60) return { bg: '#facc15', text: '#111827', category: 'Moderate (41–60)' };
    if (value <= 80) return { bg: '#f97316', text: '#ffffff', category: 'Poor (61–80)' };
    return { bg: '#ef4444', text: '#ffffff', category: 'Very Poor (81–100)' };
  }

  if (metric === 'pm10') {
    if (value <= 50) return { bg: '#10b981', text: '#ffffff', category: 'Low (0–50 µg/m³)' };
    if (value <= 100) return { bg: '#facc15', text: '#111827', category: 'Moderate (51–100 µg/m³)' };
    if (value <= 250) return { bg: '#f97316', text: '#ffffff', category: 'Elevated (101–250 µg/m³)' };
    if (value <= 400) return { bg: '#ef4444', text: '#ffffff', category: 'High (251–400 µg/m³)' };
    return { bg: '#881337', text: '#ffffff', category: 'Hazardous (> 400 µg/m³)' };
  }

  // pm2_5
  if (value <= 12) return { bg: '#10b981', text: '#ffffff', category: 'Good (0–12 µg/m³)' };
  if (value <= 35.4) return { bg: '#facc15', text: '#111827', category: 'Moderate (12.1–35.4 µg/m³)' };
  if (value <= 55.4) return { bg: '#f97316', text: '#ffffff', category: 'Unhealthy for Sensitive (35.5–55.4 µg/m³)' };
  if (value <= 150.4) return { bg: '#ef4444', text: '#ffffff', category: 'Unhealthy (55.5–150.4 µg/m³)' };
  return { bg: '#881337', text: '#ffffff', category: 'Very Unhealthy (> 150.4 µg/m³)' };
}
