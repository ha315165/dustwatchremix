/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CITIES } from './config.ts';
import { RawCityData, OpenMeteoAirQualityResponse, OpenMeteoWeatherResponse } from './types.ts';

export const SAMPLE_DATA_LABEL = 'SAMPLE DATA (synthetic, for layout testing only)';

/**
 * Generates an array of 48 ISO strings matching "YYYY-MM-DDTHH:00"
 * spanning 2 days around the current Asia/Dubai time.
 */
export function generateSampleTimestamps(): string[] {
  // Compute current date in Asia/Dubai
  const now = new Date();
  const dubaiFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  
  // Format as YYYY-MM-DD
  const dubaiDateStr = dubaiFormatter.format(now);
  const baseDate = new Date(`${dubaiDateStr}T00:00:00Z`);

  const times: string[] = [];
  for (let i = 0; i < 48; i++) {
    const d = new Date(baseDate.getTime() + i * 3600 * 1000);
    const yr = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const da = String(d.getUTCDate()).padStart(2, '0');
    const hr = String(d.getUTCHours()).padStart(2, '0');
    times.push(`${yr}-${mo}-${da}T${hr}:00`);
  }
  return times;
}

/**
 * Builds synthetic 48-hour data for all 10 UAE cities showcasing distinct
 * risk profiles: clean, moderate, high/very high, and missing data.
 */
export function createSyntheticSampleData(): Record<string, RawCityData> {
  const timestamps = generateSampleTimestamps();
  const result: Record<string, RawCityData> = {};

  for (const city of CITIES) {
    const pm10Arr: (number | null)[] = [];
    const pm25Arr: (number | null)[] = [];
    const dustArr: (number | null)[] = [];
    const aodArr: (number | null)[] = [];

    const windSpeedArr: (number | null)[] = [];
    const windGustsArr: (number | null)[] = [];
    const windDirArr: (number | null)[] = [];
    const rhArr: (number | null)[] = [];
    const tempArr: (number | null)[] = [];
    const visArr: (number | null)[] = [];

    for (let h = 0; h < 48; h++) {
      const diurnal = Math.sin(((h % 24) - 6) * (Math.PI / 12)); // peaks around 12:00-14:00

      if (city.id === 'liwa') {
        // High to Very High Dust Storm in Liwa
        const severity = Math.max(0.2, (diurnal + 1) / 2);
        pm10Arr.push(Math.round(260 + severity * 220)); // 300 - 480
        pm25Arr.push(Math.round(70 + severity * 60));
        dustArr.push(Math.round(200 + severity * 210)); // 240 - 410
        aodArr.push(Number((0.8 + severity * 1.1).toFixed(2))); // 1.0 - 1.9
        windSpeedArr.push(Math.round(30 + severity * 25)); // 35 - 55 km/h
        windGustsArr.push(Math.round(52 + severity * 30)); // 60 - 82 km/h
        windDirArr.push(320); // North-westerly Shamal
        rhArr.push(Math.round(22 - severity * 8)); // 14 - 20%
        tempArr.push(Math.round(34 + severity * 6));
        visArr.push(Math.round(1800 - severity * 1000)); // 800 - 1600m
      } else if (city.id === 'ruwais') {
        // High Dust Event in Ruwais
        const severity = Math.max(0.1, (diurnal + 0.8) / 1.8);
        pm10Arr.push(Math.round(180 + severity * 190)); // 220 - 370
        pm25Arr.push(Math.round(50 + severity * 45));
        dustArr.push(Math.round(140 + severity * 170)); // 170 - 310
        aodArr.push(Number((0.6 + severity * 0.9).toFixed(2)));
        windSpeedArr.push(Math.round(25 + severity * 22)); // 30 - 47 km/h
        windGustsArr.push(Math.round(44 + severity * 28)); // 50 - 72 km/h
        windDirArr.push(315);
        rhArr.push(Math.round(30 - severity * 10));
        tempArr.push(Math.round(32 + severity * 5));
        visArr.push(Math.round(3500 - severity * 2200)); // 1300 - 3000m
      } else if (city.id === 'al-ain') {
        // Moderate Dust in Al Ain
        const mod = Math.max(0, (diurnal + 0.5) / 1.5);
        pm10Arr.push(Math.round(90 + mod * 100)); // 110 - 190
        pm25Arr.push(Math.round(30 + mod * 25));
        dustArr.push(Math.round(60 + mod * 80)); // 75 - 140
        aodArr.push(Number((0.35 + mod * 0.45).toFixed(2)));
        windSpeedArr.push(Math.round(18 + mod * 14)); // 20 - 32 km/h
        windGustsArr.push(Math.round(30 + mod * 18)); // 35 - 48 km/h
        windDirArr.push(340);
        rhArr.push(Math.round(38 - mod * 12));
        tempArr.push(Math.round(31 + mod * 7));
        visArr.push(Math.round(7000 - mod * 2500));
      } else if (city.id === 'fujairah') {
        // Missing (null) values in Fujairah to test missing data and confidence rules
        // For hours 2 to 8, dust is missing, and pm10 is missing for some
        const isPeakMissingHour = (h % 12 >= 2 && h % 12 <= 6);
        pm10Arr.push(isPeakMissingHour && h % 2 === 0 ? null : Math.round(75 + (diurnal + 1) * 20));
        pm25Arr.push(Math.round(25 + (diurnal + 1) * 8));
        dustArr.push(isPeakMissingHour ? null : Math.round(45 + (diurnal + 1) * 15));
        aodArr.push(isPeakMissingHour ? null : Number((0.25 + (diurnal + 1) * 0.1).toFixed(2)));
        windSpeedArr.push(Math.round(14 + (diurnal + 1) * 6));
        windGustsArr.push(Math.round(22 + (diurnal + 1) * 10));
        windDirArr.push(110);
        rhArr.push(Math.round(55 - (diurnal + 1) * 10));
        tempArr.push(Math.round(29 + (diurnal + 1) * 4));
        visArr.push(isPeakMissingHour ? null : 9000);
      } else {
        // Clean baseline air in Abu Dhabi, Dubai, Sharjah, Ajman, Umm Al Quwain, RAK
        const calm = Math.max(0, (diurnal + 0.3) / 1.3);
        pm10Arr.push(Math.round(35 + calm * 30)); // 35 - 65 µg/m³
        pm25Arr.push(Math.round(14 + calm * 12));
        dustArr.push(Math.round(12 + calm * 20)); // 12 - 32 µg/m³
        aodArr.push(Number((0.15 + calm * 0.12).toFixed(2)));
        windSpeedArr.push(Math.round(10 + calm * 8)); // 10 - 18 km/h
        windGustsArr.push(Math.round(16 + calm * 12)); // 16 - 28 km/h
        windDirArr.push(300);
        rhArr.push(Math.round(52 - calm * 15));
        tempArr.push(Math.round(28 + calm * 6));
        visArr.push(Math.round(10000 - calm * 800)); // 9200 - 10000m
      }
    }

    const airQuality: OpenMeteoAirQualityResponse = {
      latitude: city.latitude,
      longitude: city.longitude,
      timezone: 'Asia/Dubai',
      hourly: {
        time: timestamps,
        pm10: pm10Arr,
        pm2_5: pm25Arr,
        dust: dustArr,
        aerosol_optical_depth: aodArr,
      },
    };

    const weather: OpenMeteoWeatherResponse = {
      latitude: city.latitude,
      longitude: city.longitude,
      timezone: 'Asia/Dubai',
      hourly: {
        time: timestamps,
        wind_speed_10m: windSpeedArr,
        wind_gusts_10m: windGustsArr,
        wind_direction_10m: windDirArr,
        relative_humidity_2m: rhArr,
        temperature_2m: tempArr,
        visibility: visArr,
      },
    };

    result[city.id] = {
      city,
      airQuality,
      weather,
      fetchTimestamp: Date.now(),
      isSampleOrSnapshot: true,
      snapshotLabel: SAMPLE_DATA_LABEL,
    };
  }

  return result;
}
