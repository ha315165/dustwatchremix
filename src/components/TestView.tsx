/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Cpu,
  Download,
  FileCode,
  FileDown,
  FileUp,
  Layers,
  Play,
  RotateCcw,
  ShieldAlert,
  Sliders,
  Terminal,
  Upload,
} from 'lucide-react';
import { APP_CONFIG, CITIES } from '../config.ts';
import { STRINGS } from '../strings.ts';
import {
  CityOutlook,
  ModelFileConfig,
  RawCityData,
  RawHourlyVariables,
} from '../types.ts';
import {
  exportSnapshotJson,
  getCityApiUrls,
  importSnapshotJson,
  simulationState,
} from '../dataService.ts';
import {
  calculateConfidence,
  calculateHourlyBaseline,
  predictRisk,
  scoreToCategory,
  validateModelConfig,
} from '../riskEngine.ts';
import { SchoolPolicyConfig, WorkbenchEvaluationOutput } from '../types.ts';
import { EvaluationWorkbench } from './EvaluationWorkbench.tsx';

interface TestViewProps {
  outlooks: Record<string, CityOutlook>;
  rawCityData: Record<string, RawCityData>;
  selectedCityId: string;
  onSelectCity: (id: string) => void;
  onDataRefresh: (force: boolean) => void;
  activeModel: ModelFileConfig | null;
  onSetActiveModel: (model: ModelFileConfig | null) => void;
  schoolPolicy?: SchoolPolicyConfig | null;
  onSendToAccuracyChecker?: (output: WorkbenchEvaluationOutput) => void;
}

interface SelfCheckResult {
  id: number;
  title: string;
  description: string;
  passed: boolean;
  details: string;
}

export const TestView: React.FC<TestViewProps> = ({
  outlooks,
  rawCityData,
  selectedCityId,
  onSelectCity,
  onDataRefresh,
  activeModel,
  onSetActiveModel,
  schoolPolicy = null,
  onSendToAccuracyChecker = () => {},
}) => {
  const currentOutlook = outlooks[selectedCityId] || outlooks[APP_CONFIG.defaultSelectedCityId];
  const currentRaw = rawCityData[selectedCityId] || rawCityData[APP_CONFIG.defaultSelectedCityId];

  // Tab between Workbench and Diagnostics
  const [activeMainTab, setActiveMainTab] = useState<'workbench' | 'diagnostics'>('workbench');

  const [simApiFail, setSimApiFail] = useState<boolean>(simulationState.simulateApiFailure);
  const [simMissingDust, setSimMissingDust] = useState<boolean>(simulationState.simulateMissingDust);
  const [simOldData, setSimOldData] = useState<boolean>(simulationState.simulateOldDataHours > 0);

  const [modelFileError, setModelFileError] = useState<string | null>(null);
  const [snapshotMsg, setSnapshotMsg] = useState<string | null>(null);
  const [selfCheckResults, setSelfCheckResults] = useState<SelfCheckResult[] | null>(null);
  const [geminiHealth, setGeminiHealth] = useState<{
    status: string;
    aiEnabled: boolean;
    model: string;
    time: string;
    lastGeminiError: { code: string | number; time: string } | null;
  } | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((data) => setGeminiHealth(data))
      .catch(() => {});
  }, []);

  // Toggle simulations
  const toggleApiFailure = () => {
    simulationState.simulateApiFailure = !simApiFail;
    setSimApiFail(!simApiFail);
    onDataRefresh(true);
  };

  const toggleMissingDust = () => {
    simulationState.simulateMissingDust = !simMissingDust;
    setSimMissingDust(!simMissingDust);
    onDataRefresh(false);
  };

  const toggleOldData = () => {
    const nextVal = !simOldData;
    simulationState.simulateOldDataHours = nextVal ? 4 : 0;
    setSimOldData(nextVal);
    onDataRefresh(false);
  };

  const resetAllSimulations = () => {
    simulationState.simulateApiFailure = false;
    simulationState.simulateMissingDust = false;
    simulationState.simulateOldDataHours = 0;
    setSimApiFail(false);
    setSimMissingDust(false);
    setSimOldData(false);
    onDataRefresh(true);
  };

  // Snapshot Save
  const handleSaveSnapshot = () => {
    const jsonStr = exportSnapshotJson(rawCityData);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dustwatch_snapshot_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setSnapshotMsg('Snapshot exported successfully.');
  };

  // Snapshot Load
  const handleLoadSnapshot = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const res = importSnapshotJson(text);
      if (res.success) {
        setSnapshotMsg(`Loaded real snapshot for ${res.count} cities into Demo mode.`);
        onDataRefresh(true);
      } else {
        setSnapshotMsg(`Snapshot error: ${res.error}`);
      }
    };
    reader.readAsText(file);
  };

  // Model File Load
  const handleLoadModelFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setModelFileError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        const val = validateModelConfig(parsed);
        if (val.isValid && val.config) {
          onSetActiveModel(val.config);
          onDataRefresh(false);
          setModelFileError(null);
        } else {
          setModelFileError(val.error || 'Invalid model JSON format');
          onSetActiveModel(null);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Invalid JSON file';
        setModelFileError(msg);
        onSetActiveModel(null);
      }
    };
    reader.readAsText(file);
  };

  // Run the 6 Self-checks requested in prompt
  const runSelfChecks = () => {
    const checks: SelfCheckResult[] = [];

    // Check 1: all variables at their low values give score 0 and Low
    const lowRaw: RawHourlyVariables = {
      time: '2026-10-20T12:00',
      dust: 20,
      pm10: 50,
      wind_gusts_10m: 25,
      wind_speed_10m: 15,
      aerosol_optical_depth: 0.2,
      visibility: 10000,
      relative_humidity_2m: 60,
      pm2_5: 10,
      temperature_2m: 28,
      wind_direction_10m: 300,
    };
    const res1 = calculateHourlyBaseline(0, lowRaw, APP_CONFIG);
    const pass1 = res1.baselineScore === 0 && res1.category === 'Low';
    checks.push({
      id: 1,
      title: 'Low values baseline calibration',
      description: 'All variables at low values give score 0 and Low.',
      passed: pass1,
      details: `Score: ${res1.baselineScore}, Category: ${res1.category}`,
    });

    // Check 2: all variables at their high values give score 100 and Very High
    const highRaw: RawHourlyVariables = {
      time: '2026-10-20T12:00',
      dust: 300,
      pm10: 400,
      wind_gusts_10m: 70,
      wind_speed_10m: 50,
      aerosol_optical_depth: 1.5,
      visibility: 1000,
      relative_humidity_2m: 15,
      pm2_5: 100,
      temperature_2m: 40,
      wind_direction_10m: 320,
    };
    const res2 = calculateHourlyBaseline(0, highRaw, APP_CONFIG);
    const pass2 = res2.baselineScore === 100 && res2.category === 'Very High';
    checks.push({
      id: 2,
      title: 'High values baseline calibration',
      description: 'All variables at high values give score 100 and Very High.',
      passed: pass2,
      details: `Score: ${res2.baselineScore}, Category: ${res2.category}`,
    });

    // Check 3: missing dust gives Low confidence
    const missingDustRaw: RawHourlyVariables = {
      time: '2026-10-20T12:00',
      dust: null,
      pm10: 120,
      wind_gusts_10m: 35,
      wind_speed_10m: 20,
      aerosol_optical_depth: 0.4,
      visibility: 8000,
      relative_humidity_2m: 40,
      pm2_5: 25,
      temperature_2m: 30,
      wind_direction_10m: 310,
    };
    const hourly3 = [calculateHourlyBaseline(0, missingDustRaw, APP_CONFIG)];
    const conf3 = calculateConfidence(hourly3, 0, true, 0.5, true, APP_CONFIG);
    const pass3 = conf3.confidence === 'Low';
    checks.push({
      id: 3,
      title: 'Missing key particle confidence degradation',
      description: 'Missing dust gives Low confidence.',
      passed: pass3,
      details: `Confidence: ${conf3.confidence}, Reasons: ${conf3.reasons[0] || 'n/a'}`,
    });

    // Check 4: a score exactly on a cutoff goes into higher category and drops confidence one level
    const cutoffsPassed =
      scoreToCategory(25) === 'Moderate' &&
      scoreToCategory(50) === 'High' &&
      scoreToCategory(75) === 'Very High';
    // Near cutoff drops confidence:
    const cutoffRaw: RawHourlyVariables = {
      time: '2026-10-20T12:00',
      dust: 90,
      pm10: 137.5, // gives baseline score ~25 exactly
      wind_gusts_10m: 25,
      wind_speed_10m: 15,
      aerosol_optical_depth: 0.2,
      visibility: 10000,
      relative_humidity_2m: 60,
      pm2_5: 20,
      temperature_2m: 30,
      wind_direction_10m: 300,
    };
    const hourly4 = [calculateHourlyBaseline(0, cutoffRaw, APP_CONFIG)];
    const conf4 = calculateConfidence(hourly4, 0, true, 0.5, true, APP_CONFIG);
    const pass4 = cutoffsPassed && conf4.reasons.some((r) => r.includes('cutoff'));
    checks.push({
      id: 4,
      title: 'Cutoff boundary mapping & confidence penalty',
      description: 'Score exactly on cutoff goes into higher category and drops confidence one level.',
      passed: pass4,
      details: `25->${scoreToCategory(25)}, 50->${scoreToCategory(50)}, 75->${scoreToCategory(75)}; Cutoff penalty triggered: ${conf4.confidence}`,
    });

    // Check 5: strong wind with clean particles stays below High when particle cap is on
    const strongWindCleanRaw: RawHourlyVariables = {
      time: '2026-10-20T12:00',
      dust: 20, // subScore 0 (< 10)
      pm10: 50, // subScore 0 (< 10)
      wind_gusts_10m: 90, // subScore 100
      wind_speed_10m: 70, // subScore 100
      aerosol_optical_depth: 1.5, // subScore 100
      visibility: 1000, // subScore 100
      relative_humidity_2m: 15, // subScore 100
      pm2_5: 5,
      temperature_2m: 25,
      wind_direction_10m: 300,
    };
    const res5 = calculateHourlyBaseline(0, strongWindCleanRaw, APP_CONFIG);
    const pass5 = res5.finalScore <= 24 && res5.category === 'Low';
    checks.push({
      id: 5,
      title: 'Particle cap suppression of false wind alarms',
      description: 'Strong wind with clean particles stays below High when particle cap is on.',
      passed: pass5,
      details: `Final Score: ${res5.finalScore} (Capped: ${res5.isParticleCapped}), Category: ${res5.category}`,
    });

    // Check 6: predictRisk without a model file returns baseline result
    const sampleRaw: RawHourlyVariables = {
      time: '2026-10-20T12:00',
      dust: 120,
      pm10: 180,
      wind_gusts_10m: 40,
      wind_speed_10m: 25,
      aerosol_optical_depth: 0.5,
      visibility: 6000,
      relative_humidity_2m: 30,
      pm2_5: 35,
      temperature_2m: 32,
      wind_direction_10m: 310,
    };
    const baseRes6 = calculateHourlyBaseline(0, sampleRaw, APP_CONFIG);
    const predRes6 = predictRisk(0, sampleRaw, null, APP_CONFIG);
    const pass6 = predRes6.finalScore === baseRes6.baselineScore && predRes6.category === baseRes6.baselineCategory;
    checks.push({
      id: 6,
      title: 'Prediction slot fallback architecture',
      description: 'predictRisk without a model file returns the baseline result.',
      passed: pass6,
      details: `Baseline: ${baseRes6.baselineScore} (${baseRes6.baselineCategory}) === Predicted: ${predRes6.finalScore} (${predRes6.category})`,
    });

    setSelfCheckResults(checks);
  };

  const { airQualityUrl, weatherUrl } = currentOutlook
    ? getCityApiUrls(currentOutlook.city)
    : { airQualityUrl: '', weatherUrl: '' };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold text-[#1A1A1A]">
              {STRINGS.testView.title}
            </h1>
            <span className="bg-red-100 text-red-800 border border-red-300 rounded px-2 py-0.5 text-xs font-bold uppercase">
              For testing only
            </span>
          </div>
          <p className="text-xs text-[#4A4F57] mt-1">
            {STRINGS.testView.subtitle}
          </p>
        </div>

        {/* City Switcher for test inspection */}
        <div className="flex items-center gap-2">
          <label htmlFor="test-city-select" className="text-xs font-semibold text-[#1A1A1A]">
            Selected City:
          </label>
          <select
            id="test-city-select"
            value={selectedCityId}
            onChange={(e) => onSelectCity(e.target.value)}
            className="border border-[#D5D9DF] rounded px-3 py-1.5 text-xs font-medium bg-white"
          >
            {CITIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Tabs: Workbench (Team Only) vs Diagnostics */}
      <div className="flex border-b border-[#D5D9DF] gap-2">
        <button
          type="button"
          onClick={() => setActiveMainTab('workbench')}
          className={`px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeMainTab === 'workbench'
              ? 'border-blue-700 text-blue-700 bg-blue-50/50'
              : 'border-transparent text-[#4A4F57] hover:text-[#1A1A1A] hover:bg-gray-50'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Evaluation Workbench (Team Only)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMainTab('diagnostics')}
          className={`px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeMainTab === 'diagnostics'
              ? 'border-blue-700 text-blue-700 bg-blue-50/50'
              : 'border-transparent text-[#4A4F57] hover:text-[#1A1A1A] hover:bg-gray-50'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>Diagnostics & Model Simulation</span>
        </button>
      </div>

      {activeMainTab === 'workbench' && (
        <EvaluationWorkbench
          rawCityData={rawCityData}
          selectedCityId={selectedCityId}
          activeModel={activeModel}
          schoolPolicy={schoolPolicy}
          onSendToAccuracyChecker={onSendToAccuracyChecker}
        />
      )}

      {activeMainTab === 'diagnostics' && (
        <div className="space-y-8">
          {/* 1. Simulation Controls */}
          <section className="bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-base font-bold text-[#1A1A1A] flex items-center gap-2">
            <Sliders className="w-4 h-4 text-blue-700" />
            <span>{STRINGS.testView.simulationTitle}</span>
          </h2>
          <button
            type="button"
            onClick={resetAllSimulations}
            className="inline-flex items-center gap-1.5 text-xs text-gray-700 hover:text-black border border-gray-300 px-2.5 py-1 rounded hover:bg-gray-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{STRINGS.testView.resetSimulations}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={toggleApiFailure}
            className={`p-3 rounded-lg border text-left text-xs transition-colors min-h-[44px] cursor-pointer ${
              simApiFail
                ? 'bg-red-50 border-red-300 text-red-900 font-semibold'
                : 'bg-gray-50 border-[#D5D9DF] text-[#1A1A1A] hover:bg-gray-100'
            }`}
          >
            <div className="font-bold mb-1">{STRINGS.testView.simApiFail}</div>
            <div className="text-[11px] opacity-80">
              {simApiFail ? 'Active: Forces network failure & triggers fallbacks' : 'Inactive: Normal live requests'}
            </div>
          </button>

          <button
            type="button"
            onClick={toggleMissingDust}
            className={`p-3 rounded-lg border text-left text-xs transition-colors min-h-[44px] cursor-pointer ${
              simMissingDust
                ? 'bg-amber-50 border-amber-300 text-amber-900 font-semibold'
                : 'bg-gray-50 border-[#D5D9DF] text-[#1A1A1A] hover:bg-gray-100'
            }`}
          >
            <div className="font-bold mb-1">{STRINGS.testView.simMissingDust}</div>
            <div className="text-[11px] opacity-80">
              {simMissingDust ? 'Active: Replaces dust values with null' : 'Inactive: Normal particulate telemetry'}
            </div>
          </button>

          <button
            type="button"
            onClick={toggleOldData}
            className={`p-3 rounded-lg border text-left text-xs transition-colors min-h-[44px] cursor-pointer ${
              simOldData
                ? 'bg-purple-50 border-purple-300 text-purple-900 font-semibold'
                : 'bg-gray-50 border-[#D5D9DF] text-[#1A1A1A] hover:bg-gray-100'
            }`}
          >
            <div className="font-bold mb-1">{STRINGS.testView.simOldData}</div>
            <div className="text-[11px] opacity-80">
              {simOldData ? 'Active: Simulates 4-hour stale fetch age' : 'Inactive: Fresh timestamps'}
            </div>
          </button>
        </div>
      </section>

      {/* 2. Snapshots & Model File Loader */}
      <section className="bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-sm space-y-4">
        <h2 className="text-base font-bold text-[#1A1A1A] flex items-center gap-2">
          <Terminal className="w-4 h-4 text-purple-700" />
          <span>{STRINGS.testView.snapshotTitle}</span>
        </h2>

        <div className="flex flex-wrap items-center gap-3">
          {/* Save snapshot */}
          <button
            type="button"
            onClick={handleSaveSnapshot}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-[#D5D9DF] text-[#1A1A1A] rounded-md text-xs font-semibold hover:bg-gray-50 min-h-[44px]"
          >
            <FileDown className="w-4 h-4 text-blue-600" />
            <span>{STRINGS.testView.saveSnapshot}</span>
          </button>

          {/* Load snapshot */}
          <label className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-[#D5D9DF] text-[#1A1A1A] rounded-md text-xs font-semibold hover:bg-gray-50 cursor-pointer min-h-[44px]">
            <FileUp className="w-4 h-4 text-purple-600" />
            <span>{STRINGS.testView.loadSnapshot}</span>
            <input
              type="file"
              accept=".json"
              onChange={handleLoadSnapshot}
              className="hidden"
            />
          </label>

          {/* Load Model File */}
          <label className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-[#D5D9DF] text-[#1A1A1A] rounded-md text-xs font-semibold hover:bg-gray-50 cursor-pointer min-h-[44px]">
            <Cpu className="w-4 h-4 text-emerald-600" />
            <span>{STRINGS.testView.loadModelFile}</span>
            <input
              type="file"
              accept=".json"
              onChange={handleLoadModelFile}
              className="hidden"
            />
          </label>

          {activeModel && (
            <button
              type="button"
              onClick={() => {
                onSetActiveModel(null);
                onDataRefresh(false);
              }}
              className="text-xs text-red-600 underline font-medium hover:text-red-800"
            >
              Unload model (return to baseline)
            </button>
          )}
        </div>

        {snapshotMsg && (
          <div className="p-2.5 bg-gray-50 border border-gray-200 rounded text-xs text-[#1A1A1A]">
            {snapshotMsg}
          </div>
        )}

        {modelFileError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-900 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <strong>Model file validation error: </strong>
              <span>{modelFileError} (Reverted to baseline rule score)</span>
            </div>
          </div>
        )}

        {activeModel && (
          <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-md text-xs text-emerald-950">
            <strong>Active Trained Model: </strong>
            <span>{activeModel.model_name} (v{activeModel.version}, trained: {activeModel.trained_date})</span>
          </div>
        )}
      </section>

      {/* 2b. Gemini AI Service Status & Error Telemetry */}
      <section className="bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-sm space-y-3">
        <h2 className="text-base font-bold text-[#1A1A1A] flex items-center gap-2">
          <Terminal className="w-4 h-4 text-blue-700" />
          <span>Gemini AI Service Telemetry & Diagnostics</span>
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 bg-gray-50 border border-gray-200 rounded">
            <span className="text-[#4A4F57] block font-medium">Model & Status</span>
            <span className="font-bold text-sm text-[#1A1A1A] block mt-0.5">
              {geminiHealth?.model || APP_CONFIG.geminiModelName}
            </span>
            <span className="text-[11px] text-gray-600">
              {geminiHealth?.aiEnabled ? 'Configured (Active)' : 'Fallback Only'}
            </span>
          </div>

          <div className="p-3 bg-gray-50 border border-gray-200 rounded">
            <span className="text-[#4A4F57] block font-medium">Last Gemini Error Code</span>
            <span className="font-bold text-sm text-red-700 block mt-0.5 font-mono">
              {geminiHealth?.lastGeminiError ? String(geminiHealth.lastGeminiError.code) : 'None'}
            </span>
            <span className="text-[11px] text-gray-500">
              {geminiHealth?.lastGeminiError ? 'Error reported on server' : 'Zero active errors'}
            </span>
          </div>

          <div className="p-3 bg-gray-50 border border-gray-200 rounded">
            <span className="text-[#4A4F57] block font-medium">Last Error Timestamp</span>
            <span className="font-bold text-xs text-[#1A1A1A] block mt-0.5 font-mono">
              {geminiHealth?.lastGeminiError ? geminiHealth.lastGeminiError.time : 'No errors recorded'}
            </span>
            <span className="text-[11px] text-gray-500">ISO server time</span>
          </div>
        </div>
        <p className="text-[11px] text-gray-500 italic">
          Credentials security: Server-side Gemini API keys and secrets are never transmitted to or displayed in the client interface.
        </p>
      </section>

      {/* 3. Automated Diagnostic Self-Checks */}
      <section className="bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-base font-bold text-[#1A1A1A] flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-emerald-700" />
              <span>{STRINGS.testView.selfChecksTitle}</span>
            </h2>
            <p className="text-xs text-[#4A4F57] mt-0.5">
              Runs 6 fixed synthetic test cases defined in project specifications.
            </p>
          </div>

          <button
            type="button"
            onClick={runSelfChecks}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md text-xs sm:text-sm font-semibold hover:bg-blue-700 min-h-[44px]"
          >
            <Play className="w-4 h-4" />
            <span>{STRINGS.testView.runChecks}</span>
          </button>
        </div>

        {selfCheckResults && (
          <div className="space-y-2 pt-2 border-t border-[#D5D9DF]">
            {selfCheckResults.map((check) => (
              <div
                key={check.id}
                className={`p-3 rounded-md border text-xs flex items-start justify-between gap-3 ${
                  check.passed
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                    : 'bg-red-50 border-red-300 text-red-950'
                }`}
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold">
                      Self-Check ({check.id}): {check.title}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                        check.passed
                          ? 'bg-emerald-200 text-emerald-900 border-emerald-300'
                          : 'bg-red-200 text-red-900 border-red-300'
                      }`}
                    >
                      {check.passed ? 'PASS' : 'FAIL'}
                    </span>
                  </div>
                  <p className="text-[#4A4F57]">{check.description}</p>
                  <p className="font-mono text-[11px] opacity-80 pt-0.5">{check.details}</p>
                </div>

                {check.passed ? (
                  <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. Selected City Diagnostics Table & Exact URLs */}
      <section className="bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-base font-bold text-[#1A1A1A]">
            {STRINGS.testView.diagnosticsTitle}: {currentOutlook.city.name}
          </h2>
          <div className="text-xs text-[#4A4F57] mt-1 space-y-1">
            <p>
              <strong>Data Source Type: </strong>
              <span className="font-mono font-bold uppercase">{currentOutlook.dataSourceType}</span> |{' '}
              <strong>Fetch Timestamp: </strong>
              <span>{currentOutlook.fetchTime}</span>
            </p>
            <p className="break-all font-mono text-[11px] text-gray-600">
              <strong>Air Quality URL: </strong>
              <a href={airQualityUrl} target="_blank" rel="noopener noreferrer" className="underline text-blue-600">
                {airQualityUrl}
              </a>
            </p>
            <p className="break-all font-mono text-[11px] text-gray-600">
              <strong>Weather URL: </strong>
              <a href={weatherUrl} target="_blank" rel="noopener noreferrer" className="underline text-blue-600">
                {weatherUrl}
              </a>
            </p>
          </div>
        </div>

        {/* 12-hour hourly breakdown table */}
        <div className="overflow-x-auto border border-[#D5D9DF] rounded-md">
          <table className="w-full text-[11px] text-left">
            <thead className="bg-gray-100 border-b border-[#D5D9DF] text-[#1A1A1A] font-semibold">
              <tr>
                <th className="py-2 px-2.5">Hour</th>
                <th className="py-2 px-2">Dust (µg/m³)</th>
                <th className="py-2 px-2">PM10 (µg/m³)</th>
                <th className="py-2 px-2">Wind Gust (km/h)</th>
                <th className="py-2 px-2">Wind Spd (km/h)</th>
                <th className="py-2 px-2">AOD</th>
                <th className="py-2 px-2">Visibility (m)</th>
                <th className="py-2 px-2">Humidity (%)</th>
                <th className="py-2 px-2">Baseline</th>
                {activeModel && <th className="py-2 px-2 text-purple-700">Model</th>}
                <th className="py-2 px-2 font-bold">Final Risk</th>
                <th className="py-2 px-2">Missing Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#D5D9DF]">
              {currentOutlook.hourlyResults.map((h) => {
                const isDustMissing = h.subScores.dust?.rawValue === null;
                const isPm10Missing = h.subScores.pm10?.rawValue === null;

                return (
                  <tr key={h.hourIndex} className="hover:bg-gray-50">
                    <td className="py-2 px-2.5 font-bold font-mono text-[#1A1A1A]">{h.displayHour}</td>
                    <td className={`py-2 px-2 font-mono ${isDustMissing ? 'text-red-600 font-bold bg-red-50' : ''}`}>
                      {h.subScores.dust?.rawValue ?? 'NULL'}
                    </td>
                    <td className={`py-2 px-2 font-mono ${isPm10Missing ? 'text-red-600 font-bold bg-red-50' : ''}`}>
                      {h.subScores.pm10?.rawValue ?? 'NULL'}
                    </td>
                    <td className="py-2 px-2 font-mono">{h.subScores.wind_gusts_10m?.rawValue ?? 'NULL'}</td>
                    <td className="py-2 px-2 font-mono">{h.subScores.wind_speed_10m?.rawValue ?? 'NULL'}</td>
                    <td className="py-2 px-2 font-mono">{h.subScores.aerosol_optical_depth?.rawValue ?? 'NULL'}</td>
                    <td className="py-2 px-2 font-mono">{h.subScores.visibility?.rawValue ?? 'NULL'}</td>
                    <td className="py-2 px-2 font-mono">{h.subScores.relative_humidity_2m?.rawValue ?? 'NULL'}</td>
                    <td className="py-2 px-2 font-mono font-bold">
                      {Math.round(h.baselineScore)} ({h.baselineCategory})
                    </td>
                    {activeModel && (
                      <td className="py-2 px-2 font-mono font-bold text-purple-700">
                        {h.modelScore !== undefined ? `${Math.round(h.modelScore)} (${h.modelCategory})` : 'n/a'}
                      </td>
                    )}
                    <td className="py-2 px-2 font-bold">
                      <span
                        style={{
                          backgroundColor: APP_CONFIG.colors[h.category].badgeBg,
                          color: APP_CONFIG.colors[h.category].badgeText,
                        }}
                        className="px-1.5 py-0.5 rounded text-[10px]"
                      >
                        {h.category}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-red-600">
                      {h.missingVariables.length > 0 ? h.missingVariables.join(', ') : 'None'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
        </div>
      )}
    </div>
  );
};
