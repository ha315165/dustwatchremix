/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CityLocation, ThresholdConfig, EvaluationResultSet, RiskCategory } from './types.ts';

export const CITIES: CityLocation[] = [
  { id: 'abu-dhabi', name: 'Abu Dhabi', latitude: 24.45, longitude: 54.38 },
  { id: 'dubai', name: 'Dubai', latitude: 25.20, longitude: 55.27 },
  { id: 'sharjah', name: 'Sharjah', latitude: 25.35, longitude: 55.39 },
  { id: 'ajman', name: 'Ajman', latitude: 25.41, longitude: 55.44 },
  { id: 'umm-al-quwain', name: 'Umm Al Quwain', latitude: 25.56, longitude: 55.55 },
  { id: 'ras-al-khaimah', name: 'Ras Al Khaimah', latitude: 25.79, longitude: 55.94 },
  { id: 'fujairah', name: 'Fujairah', latitude: 25.12, longitude: 56.33 },
  { id: 'al-ain', name: 'Al Ain', latitude: 24.21, longitude: 55.76 },
  { id: 'liwa', name: 'Liwa', latitude: 23.13, longitude: 53.77 },
  { id: 'ruwais', name: 'Ruwais', latitude: 24.11, longitude: 52.73 },
];

export const APP_CONFIG = {
  appName: 'DustWatch',
  timezone: 'Asia/Dubai',
  defaultSelectedCityId: 'abu-dhabi',
  showTestViewLink: true,
  geminiModelName: 'gemini-3.8-flash',
  
  // Data refresh timings (ms)
  cacheDurationMs: 10 * 60 * 1000, // 10 minutes in memory
  autoRefreshIntervalMs: 30 * 60 * 1000, // 30 minutes
  requestTimeoutMs: 10 * 1000, // 10 seconds
  geminiTimeoutMs: 18 * 1000, // 18 seconds (gives server sufficient headroom)

  // Event prediction level for evaluation
  eventPredictionLevel: 'High' as RiskCategory,

  // Activity configuration (Lunch off by default, Break and PE only)
  schoolActivities: {
    showLunch: false,
  },

  // Match tolerance hours for false alarm episodes (placeholder)
  matchToleranceHours: 3, // PLACEHOLDER: hours before/after event window to match false alarm episodes
  matchToleranceNotice: 'PLACEHOLDER: 3 hours match tolerance window',
  hindcastLabel: 'Hindcast from Open-Meteo past data. Not a true archive of past 12-hour forecasts.',

  // Text notice for placeholder configuration
  thresholdsNotice: 'PLACEHOLDER: to be set and justified by the team\'s data lead. Not scientifically validated.',

  // Dust event definition text and provenance labels
  eventDefinitionStatus: 'Provisional: proposed by the team, not yet confirmed by the data lead',
  eventDefinitionDataSource: 'Applied to: Open-Meteo Air Quality (PM10) and Weather API (visibility) hourly model-forecast grid points.',
  eventDefinitionCircularWarning: 'If events are defined from the same forecast data the model uses, the test is circular. Confirm events with an independent source.',
  eventDefinitionText: 'A dust event is defined as an episode where hourly PM10 ≥ 200 µg/m³ or horizontal visibility < 1000 m (associated with suspended mineral dust) is sustained for ≥ 2 consecutive hours at a station.',

  // Particle cap switch
  particleCapEnabled: true,
  particleCapDustThreshold: 10,
  particleCapPm10Threshold: 10,
  particleCapMaxScore: 24, // Capped to stay in Low

  // Thresholds and weights: straight-line scaling
  thresholds: {
    dust: {
      low: 20,
      high: 300,
      weight: 0.30,
      unit: 'µg/m³',
      displayName: 'Dust concentration',
    },
    pm10: {
      low: 50,
      high: 400,
      weight: 0.25,
      unit: 'µg/m³',
      displayName: 'PM10 particles',
    },
    wind_gusts_10m: {
      low: 25,
      high: 70,
      weight: 0.10,
      unit: 'km/h',
      displayName: 'Wind gusts',
    },
    wind_speed_10m: {
      low: 15,
      high: 50,
      weight: 0.10,
      unit: 'km/h',
      displayName: 'Sustained wind',
    },
    aerosol_optical_depth: {
      low: 0.2,
      high: 1.5,
      weight: 0.10,
      unit: 'AOD',
      displayName: 'Aerosol optical depth',
    },
    visibility: {
      low: 10000, // 0 at 10000m or above
      high: 1000,  // 100 at 1000m or below
      weight: 0.10,
      reversed: true,
      unit: 'm',
      displayName: 'Horizontal visibility',
    },
    relative_humidity_2m: {
      low: 60, // 0 at 60% or above
      high: 15, // 100 at 15% or below
      weight: 0.05,
      reversed: true,
      unit: '%',
      displayName: 'Relative humidity',
    },
  } as ThresholdConfig,

  // Score cutoffs (Low: 0-24, Moderate: 25-49, High: 50-74, Very High: 75-100)
  // Exactly on a cutoff goes to the higher category
  cutoffs: {
    lowMax: 24,
    moderateMin: 25,
    moderateMax: 49,
    highMin: 50,
    highMax: 74,
    veryHighMin: 75,
  },

  // Confidence rule parameters
  confidenceRules: {
    cutoffMargin: 5,
    dustPm10DiffThreshold: 40,
    highWindSubScore: 60,
    lowParticleSubScore: 20,
    highParticleSubScore: 60,
    lowWindSubScore: 20,
    oldDataHours: 3,
  },

  // Official evaluation results (empty until real dataset is evaluated)
  evaluationResults: null as EvaluationResultSet | null,

  // Colours and theme
  colors: {
    Low: {
      bg: '#2E7D32',
      text: '#FFFFFF',
      badgeBg: '#E8F5E9',
      badgeText: '#1B5E20',
      border: '#A5D6A7',
      label: 'Low',
      abbr: 'L',
    },
    Moderate: {
      bg: '#F9A825',
      text: '#1A1A1A',
      badgeBg: '#FFF9C4',
      badgeText: '#F57F17',
      border: '#FFF176',
      label: 'Moderate',
      abbr: 'M',
    },
    High: {
      bg: '#EF6C00',
      text: '#1A1A1A',
      badgeBg: '#FFE0B2',
      badgeText: '#E65100',
      border: '#FFB74D',
      label: 'High',
      abbr: 'H',
    },
    'Very High': {
      bg: '#C62828',
      text: '#FFFFFF',
      badgeBg: '#FFCDD2',
      badgeText: '#B71C1C',
      border: '#E57373',
      label: 'Very High',
      abbr: 'VH',
    },
  },
};
