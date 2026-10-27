/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useId } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Calendar,
  CheckCircle,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Eye,
  FileCheck,
  FileDown,
  FileSpreadsheet,
  FileText,
  Filter,
  Info,
  Layers,
  Play,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Upload,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { APP_CONFIG, CITIES } from '../config.ts';
import {
  CityLocation,
  EventEvaluationSummary,
  FalseAlarmEpisode,
  HindcastHourlyPrediction,
  ModelFileConfig,
  NurseComparisonSummary,
  ObservedEventRow,
  RawCityData,
  SchoolPolicyConfig,
  WorkbenchEvaluationOutput,
} from '../types.ts';
import {
  HINDCAST_PROVENANCE_LABEL,
  buildHourlyPredictions,
  evaluateNurseComparison,
  evaluatePredictionsAgainstEvents,
  fetchHindcastData,
  generateSyntheticHindcastData,
  getEventLogTemplateCsv,
  getNurseLogTemplateCsv,
  parseEventLogCsv,
  parseNurseLogCsv,
} from '../backtestService.ts';

interface EvaluationWorkbenchProps {
  rawCityData: Record<string, RawCityData>;
  selectedCityId: string;
  activeModel: ModelFileConfig | null;
  schoolPolicy: SchoolPolicyConfig | null;
  onSendToAccuracyChecker: (output: WorkbenchEvaluationOutput) => void;
}

export const EvaluationWorkbench: React.FC<EvaluationWorkbenchProps> = ({
  rawCityData,
  selectedCityId,
  activeModel,
  schoolPolicy,
  onSendToAccuracyChecker,
}) => {
  const eventLogInputId = useId();
  const nurseLogInputId = useId();

  // Workbench sub-tab: 'backtest' (Part A) | 'nurse' (Part B)
  const [activeTab, setActiveTab] = useState<'backtest' | 'nurse'>('backtest');

  // --------------------------------------------------------------------------
  // Part A State
  // --------------------------------------------------------------------------
  const [pastDaysN, setPastDaysN] = useState<number>(30);
  const [isFetchingData, setIsFetchingData] = useState<boolean>(false);
  const [fetchProgressMsg, setFetchProgressMsg] = useState<string>('');
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Hindcast hourly data
  const [hindcastRawData, setHindcastRawData] = useState<Record<string, RawCityData> | null>(null);
  const [predictions, setPredictions] = useState<HindcastHourlyPrediction[]>([]);

  // Searched period and cities
  const [searchedStartDate, setSearchedStartDate] = useState<string>('');
  const [searchedEndDate, setSearchedEndDate] = useState<string>('');
  const [selectedCities, setSelectedCities] = useState<string[]>(CITIES.map((c) => c.name));

  // Chronological Split
  const [splitDate, setSplitDate] = useState<string>('');

  // Observed events
  const [eventCsvText, setEventCsvText] = useState<string>('');
  const [includeNonIndependentEvents, setIncludeNonIndependentEvents] = useState<boolean>(false);
  const [parsedEvents, setParsedEvents] = useState<ObservedEventRow[]>([]);
  const [ignoredEventRows, setIgnoredEventRows] = useState<string[]>([]);
  const [nonIndependentCount, setNonIndependentCount] = useState<number>(0);
  const [eventParseError, setEventParseError] = useState<string | null>(null);

  // Evaluation results output
  const [evaluationOutput, setEvaluationOutput] = useState<WorkbenchEvaluationOutput | null>(null);
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);

  // --------------------------------------------------------------------------
  // Part B State
  // --------------------------------------------------------------------------
  const [nurseSchoolCityId, setNurseSchoolCityId] = useState<string>(selectedCityId);
  const [nurseCsvText, setNurseCsvText] = useState<string>('');
  const [nurseParseError, setNurseParseError] = useState<string | null>(null);
  const [nurseComparisonSummary, setNurseComparisonSummary] = useState<NurseComparisonSummary | null>(null);
  const [nurseFilter, setNurseFilter] = useState<'all' | 'less_cautious' | 'more_cautious' | 'same' | 'not_evaluated' | 'outside_data'>('all');

  // --------------------------------------------------------------------------
  // Part A Handlers
  // --------------------------------------------------------------------------

  // A1: Fetch past data from Open-Meteo
  const handleBuildPastPredictions = async () => {
    setIsFetchingData(true);
    setFetchError(null);
    setFetchProgressMsg('Connecting to Open-Meteo historical API...');
    setEvaluationOutput(null);

    try {
      const data = await fetchHindcastData(pastDaysN, (msg) => setFetchProgressMsg(msg));
      setHindcastRawData(data);

      setFetchProgressMsg('Calculating hourly baseline and persistence predictions...');
      const preds = buildHourlyPredictions(data, activeModel);
      setPredictions(preds);

      if (preds.length > 0) {
        setSearchedStartDate(preds[0].timestamp);
        setSearchedEndDate(preds[preds.length - 1].timestamp);
      }
      setFetchProgressMsg(`Ready. Calculated predictions across ${preds.length} city-hours.`);
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch Open-Meteo past data.');
    } finally {
      setIsFetchingData(false);
    }
  };

  // Quick fallback: Generate synthetic 30-day data for test demo
  const handleGenerateSyntheticBacktest = () => {
    setIsFetchingData(true);
    setFetchError(null);
    setFetchProgressMsg('Generating local synthetic hindcast series...');
    setTimeout(() => {
      const data = generateSyntheticHindcastData(pastDaysN, CITIES);
      setHindcastRawData(data);
      const preds = buildHourlyPredictions(data, activeModel);
      setPredictions(preds);
      if (preds.length > 0) {
        setSearchedStartDate(preds[0].timestamp);
        setSearchedEndDate(preds[preds.length - 1].timestamp);
      }
      setIsFetchingData(false);
      setFetchProgressMsg(`Generated ${preds.length} hours of synthetic hindcast data.`);
    }, 150);
  };

  // A3: Event CSV file upload handler
  const handleEventFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setEventParseError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setEventCsvText(text);
      processEventLog(text, includeNonIndependentEvents);
    };
    reader.onerror = () => {
      setEventParseError('Failed to read the selected CSV file.');
    };
    reader.readAsText(file);
  };

  const processEventLog = (text: string, allowNonIndependent: boolean) => {
    const res = parseEventLogCsv(text, allowNonIndependent);
    if (!res.success) {
      setEventParseError(res.error || 'Failed to parse event log CSV.');
      setParsedEvents([]);
      setIgnoredEventRows([]);
      setNonIndependentCount(0);
    } else {
      setEventParseError(null);
      setParsedEvents(res.events);
      setIgnoredEventRows(res.ignoredRows);
      setNonIndependentCount(res.nonIndependentCount);
    }
  };

  const handleToggleIncludeNonIndependent = (checked: boolean) => {
    setIncludeNonIndependentEvents(checked);
    if (eventCsvText) {
      processEventLog(eventCsvText, checked);
    }
  };

  // Load sample events for team testing
  const handleLoadSampleEvents = () => {
    const sampleText = getEventLogTemplateCsv();
    setEventCsvText(sampleText);
    processEventLog(sampleText, includeNonIndependentEvents);
  };

  // Download event log template
  const handleDownloadEventTemplate = () => {
    const blob = new Blob([getEventLogTemplateCsv()], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dustwatch_observed_events_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Toggle city in searched cities list
  const handleToggleCity = (cityName: string) => {
    setSelectedCities((prev) =>
      prev.includes(cityName) ? prev.filter((c) => c !== cityName) : [...prev, cityName]
    );
  };

  const handleSelectAllCities = () => {
    setSelectedCities(CITIES.map((c) => c.name));
  };

  // A4: Run Evaluation
  const handleRunEvaluation = () => {
    if (predictions.length === 0) {
      setFetchError('Please build past predictions first before running evaluation.');
      return;
    }

    setIsEvaluating(true);
    try {
      const output = evaluatePredictionsAgainstEvents({
        predictions,
        events: parsedEvents,
        searchedPeriod: {
          start: searchedStartDate || predictions[0].timestamp,
          end: searchedEndDate || predictions[predictions.length - 1].timestamp,
        },
        searchedCities: selectedCities,
        daysRequested: pastDaysN,
        activeModel,
        splitDate: splitDate.trim().length > 0 ? splitDate : undefined,
        allParsedEventsCount: parsedEvents.length + (includeNonIndependentEvents ? 0 : nonIndependentCount),
        excludedNonIndependentCount: includeNonIndependentEvents ? 0 : nonIndependentCount,
      });

      setEvaluationOutput(output);
    } finally {
      setIsEvaluating(false);
    }
  };

  // A4: Download Evaluation CSV
  const handleDownloadEvaluationCsv = () => {
    if (!evaluationOutput) return;
    const blob = new Blob([evaluationOutput.csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dustwatch_backtest_evaluation_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // A4: Download Metadata JSON
  const handleDownloadMetadataJson = () => {
    if (!evaluationOutput) return;
    const blob = new Blob([evaluationOutput.metadataJson], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dustwatch_evaluation_metadata_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // --------------------------------------------------------------------------
  // Part B Handlers (Nurse Comparison)
  // --------------------------------------------------------------------------

  const handleNurseFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setNurseParseError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setNurseCsvText(text);
      processNurseLog(text);
    };
    reader.onerror = () => {
      setNurseParseError('Failed to read selected Nurse CSV file.');
    };
    reader.readAsText(file);
  };

  const processNurseLog = (text: string) => {
    const res = parseNurseLogCsv(text);
    if (!res.success) {
      setNurseParseError(res.error || 'Failed to parse nurse log CSV.');
      setNurseComparisonSummary(null);
      return;
    }

    // Resolve active school policy from prop or localStorage
    let policyToUse = schoolPolicy;
    if (!policyToUse || !policyToUse.isConfigured) {
      try {
        const saved = localStorage.getItem('dustwatch_school_policy');
        if (saved) policyToUse = JSON.parse(saved);
      } catch {
        // ignore
      }
    }

    // Ensure past data is available
    const rawSource = hindcastRawData || rawCityData;
    const evalRes = evaluateNurseComparison({
      nurseRows: res.rows,
      schoolPolicy: policyToUse,
      rawCityData: rawSource,
      schoolCityId: nurseSchoolCityId,
    });

    if (!evalRes.success) {
      setNurseParseError(evalRes.error || 'Failed to evaluate nurse logs.');
      setNurseComparisonSummary(null);
    } else {
      setNurseParseError(null);
      setNurseComparisonSummary(evalRes.summary || null);
    }
  };

  const handleLoadSampleNurseLog = () => {
    const sample = getNurseLogTemplateCsv();
    setNurseCsvText(sample);
    processNurseLog(sample);
  };

  const handleDownloadNurseTemplate = () => {
    const blob = new Blob([getNurseLogTemplateCsv()], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dustwatch_nurse_log_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Filter nurse rows for display
  const filteredNurseRows = (nurseComparisonSummary?.allRows || []).filter((r) => {
    if (nurseFilter === 'all') return true;
    if (nurseFilter === 'less_cautious') return r.agreement_category === 'dustwatch_less_cautious';
    if (nurseFilter === 'more_cautious') return r.agreement_category === 'dustwatch_more_cautious';
    if (nurseFilter === 'same') return r.agreement_category === 'same_action';
    if (nurseFilter === 'not_evaluated') return r.status === 'not_evaluated';
    if (nurseFilter === 'outside_data') return r.status === 'outside_data';
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Provenance Banner */}
      <div className="p-3.5 bg-blue-50 border-2 border-blue-300 rounded-lg flex items-start gap-3 shadow-xs">
        <Layers className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm text-blue-950 uppercase tracking-wide">
              Evaluation Workbench (Team Only)
            </span>
            <span className="text-[11px] bg-blue-100 text-blue-900 border border-blue-300 px-2 py-0.5 rounded font-mono font-medium">
              100% Client-Side Browser Execution
            </span>
          </div>
          <p className="text-xs text-blue-900 font-semibold">
            {HINDCAST_PROVENANCE_LABEL}
          </p>
        </div>
      </div>

      {/* Tabs: Part A (Backtest Builder) vs Part B (Nurse Comparison) */}
      <div className="flex border-b border-[#D5D9DF] gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('backtest')}
          className={`px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'backtest'
              ? 'border-blue-700 text-blue-700 bg-blue-50/50'
              : 'border-transparent text-[#4A4F57] hover:text-[#1A1A1A] hover:bg-gray-50'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Part A: Backtest Builder</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('nurse')}
          className={`px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'nurse'
              ? 'border-blue-700 text-blue-700 bg-blue-50/50'
              : 'border-transparent text-[#4A4F57] hover:text-[#1A1A1A] hover:bg-gray-50'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          <span>Part B: Nurse Comparison (School Mode)</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* PART A: BACKTEST BUILDER                                                  */}
      {/* ========================================================================= */}
      {activeTab === 'backtest' && (
        <div className="space-y-6">
          {/* Section A1: Past Data Retrieval */}
          <section className="bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-base font-bold text-[#1A1A1A] flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-blue-700" />
                  <span>A1. Past Data Retrieval (Open-Meteo Hindcast)</span>
                </h3>
                <p className="text-xs text-[#4A4F57] mt-0.5">
                  Fetch historical weather & air-quality series for all 10 UAE cities with timezone Asia/Dubai.
                </p>
              </div>
              <span className="text-[11px] font-semibold bg-gray-100 text-gray-800 px-2 py-0.5 rounded border border-gray-300">
                Max 92 Days
              </span>
            </div>

            <div className="flex flex-wrap items-end gap-3 pt-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[#1A1A1A] block">
                  Past Days (N):
                </label>
                <input
                  type="number"
                  min={1}
                  max={92}
                  value={pastDaysN}
                  onChange={(e) => setPastDaysN(Math.min(92, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                  className="w-32 px-3 py-1.5 border border-[#D5D9DF] rounded text-sm font-mono focus:outline-blue-600"
                />
              </div>

              <button
                type="button"
                onClick={handleBuildPastPredictions}
                disabled={isFetchingData}
                className="px-4 py-2 bg-blue-600 text-white rounded text-xs sm:text-sm font-bold hover:bg-blue-700 disabled:opacity-50 min-h-[40px] flex items-center gap-2"
              >
                <Play className="w-4 h-4" />
                <span>{isFetchingData ? 'Fetching Data...' : 'Build past predictions'}</span>
              </button>

              <button
                type="button"
                onClick={handleGenerateSyntheticBacktest}
                disabled={isFetchingData}
                className="px-3 py-2 bg-white border border-[#D5D9DF] text-[#4A4F57] rounded text-xs font-medium hover:bg-gray-50 min-h-[40px]"
              >
                Generate Synthetic Series
              </button>
            </div>

            {/* Progress / Status display */}
            {fetchProgressMsg && (
              <div className="p-3 bg-gray-50 border border-gray-200 rounded text-xs font-mono text-[#1A1A1A] flex items-center gap-2">
                <Info className="w-4 h-4 text-blue-600 shrink-0" />
                <span>{fetchProgressMsg}</span>
              </div>
            )}

            {fetchError && (
              <div className="p-3 bg-red-50 border border-red-300 rounded text-xs text-red-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Error: </strong>
                  <span>{fetchError}</span>
                </div>
              </div>
            )}

            {predictions.length > 0 && (
              <div className="space-y-2">
                <div className="p-3 bg-emerald-50 border border-emerald-300 rounded text-xs text-emerald-900 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                    <span>
                      Successfully computed <strong>{predictions.length}</strong> hourly predictions across 10 cities.
                      First 12 hours dropped per city for 12-hour persistence benchmark.
                    </span>
                  </div>
                  <span className="font-mono text-[11px] bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300 font-semibold">
                    {predictions[0].timestamp} &rarr; {predictions[predictions.length - 1].timestamp}
                  </span>
                </div>
                {predictions[0]?.isSynthetic && (
                  <div className="p-2.5 bg-amber-50 border border-amber-300 rounded text-xs text-amber-900 flex items-center gap-2 font-medium">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      Dataset Provenance: Synthetic demonstration data. Real-world accuracy claims cannot be substantiated using synthetic data.
                    </span>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Section A2 & A3: Observed Events Log & Search Filter */}
          <section className="bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-xs space-y-4">
            <h3 className="text-base font-bold text-[#1A1A1A] flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-blue-700" />
              <span>A3. Observed Events Log & Search Boundaries</span>
            </h3>

            {/* Crucial requirement statement */}
            <div className="p-3 bg-amber-50 border border-amber-300 rounded text-xs text-amber-950 font-medium">
              <strong>Evaluation Boundary Rule: </strong>
              Hours outside the searched period or searched cities are excluded from evaluation, because &ldquo;no event found&rdquo; is not the same as &ldquo;no event happened&rdquo;.
            </div>

            {/* Search Period and Cities Configuration */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4 bg-gray-50 border border-gray-200 rounded">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[#1A1A1A] block">
                  Searched Period Start (ISO / Local):
                </label>
                <input
                  type="text"
                  value={searchedStartDate}
                  onChange={(e) => setSearchedStartDate(e.target.value)}
                  placeholder="YYYY-MM-DDTHH:00"
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-[#D5D9DF] rounded focus:outline-blue-600"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-[#1A1A1A] block">
                  Searched Period End (ISO / Local):
                </label>
                <input
                  type="text"
                  value={searchedEndDate}
                  onChange={(e) => setSearchedEndDate(e.target.value)}
                  placeholder="YYYY-MM-DDTHH:00"
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-[#D5D9DF] rounded focus:outline-blue-600"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-[#1A1A1A]">
                    Searched Cities:
                  </label>
                  <button
                    type="button"
                    onClick={handleSelectAllCities}
                    className="text-[11px] text-blue-700 hover:underline"
                  >
                    Select All
                  </button>
                </div>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1.5 bg-white border border-[#D5D9DF] rounded">
                  {CITIES.map((c) => {
                    const isSelected = selectedCities.includes(c.name);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleToggleCity(c.name)}
                        className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                          isSelected
                            ? 'bg-blue-600 text-white border-blue-700 font-semibold'
                            : 'bg-gray-100 text-[#4A4F57] border-gray-300 hover:bg-gray-200'
                        }`}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Event Log CSV Upload Controls */}
            <div className="space-y-3 pt-2">
              <div className="flex flex-wrap items-center gap-3">
                <label
                  htmlFor={eventLogInputId}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded text-xs sm:text-sm font-semibold hover:bg-blue-700 cursor-pointer min-h-[40px]"
                >
                  <Upload className="w-4 h-4" />
                  <span>Upload Event Log CSV</span>
                </label>
                <input
                  id={eventLogInputId}
                  type="file"
                  accept=".csv"
                  onChange={handleEventFileUpload}
                  className="sr-only"
                />

                <button
                  type="button"
                  onClick={handleLoadSampleEvents}
                  className="px-3 py-2 bg-white border border-[#D5D9DF] text-[#1A1A1A] rounded text-xs font-medium hover:bg-gray-50 min-h-[40px] flex items-center gap-1.5"
                >
                  <Sparkles className="w-4 h-4 text-amber-600" />
                  <span>Load Sample Event Log</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadEventTemplate}
                  className="px-3 py-2 bg-white border border-[#D5D9DF] text-[#4A4F57] rounded text-xs font-medium hover:bg-gray-50 min-h-[40px] flex items-center gap-1.5"
                >
                  <FileDown className="w-4 h-4" />
                  <span>Download Event Template CSV</span>
                </button>
              </div>

              {/* Independence check toggle and warning */}
              <div className="p-3 bg-gray-50 border border-[#D5D9DF] rounded space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-[#1A1A1A]">
                  <input
                    type="checkbox"
                    checked={includeNonIndependentEvents}
                    onChange={(e) => handleToggleIncludeNonIndependent(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span>Include non-independent events in evaluation (default: excluded)</span>
                </label>

                {nonIndependentCount > 0 && (
                  <div className="text-xs text-amber-900 bg-amber-50 p-2 rounded border border-amber-300 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <span>
                        Found <strong>{nonIndependentCount}</strong> event(s) marked &ldquo;Not independent of the prediction data&rdquo; (evidence is model_forecast or source cites Open-Meteo/CAMS).
                      </span>
                      {includeNonIndependentEvents && (
                        <p className="mt-1 font-bold text-red-700">
                          Warning: If events are defined from the same forecast data the model uses, the test is circular. Confirm events with an independent source.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {eventParseError && (
                <div className="p-3 bg-red-50 border border-red-300 rounded text-xs text-red-900">
                  <strong>Error parsing CSV: </strong> {eventParseError}
                </div>
              )}

              {parsedEvents.length > 0 && (
                <div className="p-3 bg-emerald-50 border border-emerald-300 rounded text-xs text-emerald-950 flex items-center justify-between flex-wrap gap-2">
                  <span>
                    Loaded <strong>{parsedEvents.length}</strong> active observed events for evaluation.
                    {ignoredEventRows.length > 0 && ` (${ignoredEventRows.length} invalid rows ignored)`}
                  </span>
                  <span className="text-[11px] font-mono bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300">
                    {parsedEvents.filter((e) => e.isIndependent).length} independent
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Section A4: Chronological Split & Run Evaluation */}
          <section className="bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-xs space-y-4">
            <h3 className="text-base font-bold text-[#1A1A1A] flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-700" />
              <span>A4. Chronological Partitioning & Output Generation</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-gray-50 border border-gray-200 rounded">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[#1A1A1A] block">
                  Optional Chronological Split Date:
                </label>
                <input
                  type="date"
                  value={splitDate}
                  onChange={(e) => setSplitDate(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-mono border border-[#D5D9DF] rounded focus:outline-blue-600"
                />
              </div>

              <div className="p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-900 flex items-center">
                <p className="font-semibold">
                  Only change thresholds using the tuning period. Report the test period.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleRunEvaluation}
                disabled={isEvaluating || predictions.length === 0}
                className="px-5 py-2.5 bg-blue-700 text-white rounded text-xs sm:text-sm font-bold hover:bg-blue-800 disabled:opacity-50 min-h-[44px] flex items-center gap-2 shadow-xs"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{isEvaluating ? 'Evaluating...' : 'Run Backtest Evaluation'}</span>
              </button>

              {evaluationOutput && (
                <>
                  <button
                    type="button"
                    onClick={handleDownloadEvaluationCsv}
                    className="px-3.5 py-2 bg-white border border-[#D5D9DF] text-[#1A1A1A] rounded text-xs font-semibold hover:bg-gray-50 min-h-[44px] flex items-center gap-1.5"
                  >
                    <Download className="w-4 h-4 text-blue-600" />
                    <span>Download evaluation CSV</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadMetadataJson}
                    className="px-3.5 py-2 bg-white border border-[#D5D9DF] text-[#1A1A1A] rounded text-xs font-semibold hover:bg-gray-50 min-h-[44px] flex items-center gap-1.5"
                  >
                    <FileText className="w-4 h-4 text-purple-600" />
                    <span>Download metadata JSON</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onSendToAccuracyChecker(evaluationOutput)}
                    className="px-4 py-2 bg-emerald-600 text-white rounded text-xs sm:text-sm font-bold hover:bg-emerald-700 min-h-[44px] flex items-center gap-2 shadow-xs"
                  >
                    <Send className="w-4 h-4" />
                    <span>Send to Accuracy checker</span>
                  </button>
                </>
              )}
            </div>
          </section>

          {/* Section A5: Event-Level Summary & False Alarm Episodes */}
          {evaluationOutput && (
            <section className="bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-xs space-y-6">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-base font-bold text-[#1A1A1A] flex items-center gap-2">
                  <Eye className="w-4 h-4 text-blue-700" />
                  <span>A5. Event-Level Detection & False Alarm Episodes</span>
                </h3>
                <span className="text-xs font-mono font-semibold bg-blue-50 text-blue-900 border border-blue-200 px-2 py-0.5 rounded">
                  Event Level: &ge; {APP_CONFIG.eventPredictionLevel}
                </span>
              </div>

              {/* Too few events warning */}
              {!evaluationOutput.hasEnoughEvents && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded text-xs text-amber-900 flex items-center gap-2 font-semibold">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Too few events for reliable conclusions</span>
                </div>
              )}

              {/* Event-Level Table */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-[#1A1A1A] uppercase tracking-wide">
                  Observed Events Detection Summary
                </h4>
                {evaluationOutput.eventSummaries.length === 0 ? (
                  <p className="text-xs text-[#4A4F57] italic">No observed events loaded in active evaluation.</p>
                ) : (
                  <div className="overflow-x-auto border border-[#D5D9DF] rounded">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-gray-50 border-b border-[#D5D9DF] text-[#4A4F57]">
                        <tr>
                          <th className="py-2 px-3">City</th>
                          <th className="py-2 px-3">Event Window</th>
                          <th className="py-2 px-3">Source & Evidence</th>
                          <th className="py-2 px-3 text-center">Peak Baseline (12h-End)</th>
                          <th className="py-2 px-3 text-center">First Detection</th>
                          <th className="py-2 px-3 text-center">Lead Time</th>
                          <th className="py-2 px-3 text-center">Outcome</th>
                        </tr>
                      </thead>
                      <tbody>
                        {evaluationOutput.eventSummaries.map((summary, idx) => (
                          <tr key={idx} className="border-b border-[#D5D9DF] hover:bg-gray-50">
                            <td className="py-2 px-3 font-semibold">{summary.event.city}</td>
                            <td className="py-2 px-3 font-mono text-[11px]">
                              {summary.event.start} &rarr; {summary.event.end}
                            </td>
                            <td className="py-2 px-3 text-[11px]">
                              <div>{summary.event.source_name}</div>
                              <span className="text-[10px] text-gray-500 font-mono">
                                ({summary.event.evidence_type})
                              </span>
                            </td>
                            <td className="py-2 px-3 text-center font-bold">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] ${
                                  summary.highestBaselineLevel === 'Very High'
                                    ? 'bg-red-100 text-red-800'
                                    : summary.highestBaselineLevel === 'High'
                                    ? 'bg-orange-100 text-orange-800'
                                    : summary.highestBaselineLevel === 'Moderate'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-green-100 text-green-800'
                                }`}
                              >
                                {summary.highestBaselineLevel}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-center font-mono text-[11px]">
                              {summary.firstDetectionHour ? summary.firstDetectionHour.split('T')[1] : 'None'}
                            </td>
                            <td className="py-2 px-3 text-center font-mono text-[11px]">
                              {summary.leadTimeHours !== null
                                ? `${summary.leadTimeHours > 0 ? `+${summary.leadTimeHours}` : summary.leadTimeHours} hrs`
                                : '-'}
                            </td>
                            <td className="py-2 px-3 text-center font-bold">
                              {summary.detected ? (
                                <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded text-[11px]">
                                  Detected
                                </span>
                              ) : (
                                <span className="text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded text-[11px]">
                                  Missed
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* False Alarm Episodes */}
              <div className="space-y-2 pt-2 border-t border-[#D5D9DF]">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h4 className="text-xs font-bold text-[#1A1A1A] uppercase tracking-wide">
                    False Alarm Episodes ({evaluationOutput.falseAlarmEpisodes.length})
                  </h4>
                  <span className="text-[11px] text-[#4A4F57] italic">
                    Tolerance window: &plusmn;{APP_CONFIG.matchToleranceHours}h ({APP_CONFIG.matchToleranceNotice})
                  </span>
                </div>

                {evaluationOutput.falseAlarmEpisodes.length === 0 ? (
                  <p className="text-xs text-emerald-800 bg-emerald-50 p-3 rounded border border-emerald-200">
                    No false alarm episodes identified inside the searched period.
                  </p>
                ) : (
                  <div className="overflow-x-auto border border-[#D5D9DF] rounded">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-gray-50 border-b border-[#D5D9DF] text-[#4A4F57]">
                        <tr>
                          <th className="py-2 px-3">City</th>
                          <th className="py-2 px-3">Episode Window</th>
                          <th className="py-2 px-3 text-center">Duration</th>
                          <th className="py-2 px-3 text-center">Peak Level</th>
                          <th className="py-2 px-3 text-center">Peak Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {evaluationOutput.falseAlarmEpisodes.map((ep, idx) => (
                          <tr key={idx} className="border-b border-[#D5D9DF] hover:bg-gray-50">
                            <td className="py-2 px-3 font-semibold">{ep.city}</td>
                            <td className="py-2 px-3 font-mono text-[11px]">
                              {ep.startHour} &rarr; {ep.endHour}
                            </td>
                            <td className="py-2 px-3 text-center font-mono">{ep.durationHours} hrs</td>
                            <td className="py-2 px-3 text-center font-bold text-amber-800">{ep.peakLevel}</td>
                            <td className="py-2 px-3 text-center font-mono">{ep.peakScore}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Split Stats (if enabled) */}
              {evaluationOutput.splitStats && (
                <div className="space-y-3 pt-2 border-t border-[#D5D9DF]">
                  <h4 className="text-xs font-bold text-[#1A1A1A] uppercase tracking-wide flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-blue-700" />
                    <span>Chronological Split Comparison (Split Date: {evaluationOutput.splitStats.splitDate})</span>
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Tuning Period */}
                    <div className="p-3 bg-gray-50 border border-gray-200 rounded space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-[#1A1A1A]">Tuning Period (Before Split)</span>
                        <span className="text-[10px] text-gray-600 font-mono">
                          {evaluationOutput.splitStats.tuningPeriod.rowsCount} hours
                        </span>
                      </div>
                      <p className="text-[11px] text-[#4A4F57] italic">
                        Only change thresholds using the tuning period.
                      </p>
                      <div className="text-xs space-y-1 font-mono pt-1">
                        <div>Hits: {evaluationOutput.splitStats.tuningPeriod.predictors.baselineRuleScore.hits}</div>
                        <div>Misses: {evaluationOutput.splitStats.tuningPeriod.predictors.baselineRuleScore.misses}</div>
                        <div>False Alarms: {evaluationOutput.splitStats.tuningPeriod.predictors.baselineRuleScore.falseAlarms}</div>
                        <div className="font-bold text-blue-700">
                          Hit Rate: {evaluationOutput.splitStats.tuningPeriod.predictors.baselineRuleScore.hitRate !== null
                            ? `${(evaluationOutput.splitStats.tuningPeriod.predictors.baselineRuleScore.hitRate * 100).toFixed(1)}%`
                            : 'n/a'}
                        </div>
                      </div>
                    </div>

                    {/* Test Period */}
                    <div className="p-3 bg-blue-50/50 border border-blue-200 rounded space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-blue-950">Test Period (On / After Split)</span>
                        <span className="text-[10px] text-blue-900 font-mono">
                          {evaluationOutput.splitStats.testPeriod.rowsCount} hours
                        </span>
                      </div>
                      <p className="text-[11px] text-blue-900 font-semibold">
                        Report the test period.
                      </p>
                      <div className="text-xs space-y-1 font-mono pt-1 text-[#1A1A1A]">
                        <div>Hits: {evaluationOutput.splitStats.testPeriod.predictors.baselineRuleScore.hits}</div>
                        <div>Misses: {evaluationOutput.splitStats.testPeriod.predictors.baselineRuleScore.misses}</div>
                        <div>False Alarms: {evaluationOutput.splitStats.testPeriod.predictors.baselineRuleScore.falseAlarms}</div>
                        <div className="font-bold text-blue-700">
                          Hit Rate: {evaluationOutput.splitStats.testPeriod.predictors.baselineRuleScore.hitRate !== null
                            ? `${(evaluationOutput.splitStats.testPeriod.predictors.baselineRuleScore.hitRate * 100).toFixed(1)}%`
                            : 'n/a'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* PART B: NURSE COMPARISON (SCHOOL MODE)                                    */}
      {/* ========================================================================= */}
      {activeTab === 'nurse' && (
        <div className="space-y-6">
          <section className="bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-base font-bold text-[#1A1A1A] flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-blue-700" />
                  <span>Part B: School Nurse Agreement Evaluation</span>
                </h3>
                <p className="text-xs text-[#4A4F57] mt-0.5">
                  Evaluate real historical school outdoor activity decisions against DustWatch policy calculations.
                </p>
              </div>

              {/* Explicit privacy guarantee label */}
              <span className="text-xs bg-emerald-50 text-emerald-800 border border-emerald-300 px-2.5 py-1 rounded font-semibold">
                No names or personal data.
              </span>
            </div>

            {/* Resolve active school policy from prop or localStorage */}
            {(() => {
              let activePolicy = schoolPolicy;
              if (!activePolicy || !activePolicy.isConfigured) {
                try {
                  const saved = localStorage.getItem('dustwatch_school_policy');
                  if (saved) activePolicy = JSON.parse(saved);
                } catch {
                  // ignore
                }
              }

              const isPolicyLoadedAndValid =
                activePolicy && activePolicy.isConfigured && activePolicy.isFictionalDemo !== true && activePolicy.rules.length > 0;

              if (!isPolicyLoadedAndValid) {
                return (
                  <div className="p-4 bg-red-50 border-2 border-red-300 rounded-md text-xs text-red-950 space-y-2">
                    <div className="flex items-center gap-2 font-bold text-sm text-red-800">
                      <ShieldAlert className="w-5 h-5 text-red-700" />
                      <span>School policy not loaded</span>
                    </div>
                    <p>
                      An approved school policy must be configured in School Mode before evaluating nurse comparison logs.
                      The fictional demonstration policy cannot be used for this comparison.
                    </p>
                  </div>
                );
              }

              return (
                <div className="space-y-4 pt-2">
                  <div className="flex flex-wrap items-center gap-4 p-3 bg-gray-50 border border-gray-200 rounded text-xs">
                    <div className="space-y-1">
                      <label className="font-semibold text-[#1A1A1A] block">
                        School Location City:
                      </label>
                      <select
                        value={nurseSchoolCityId}
                        onChange={(e) => setNurseSchoolCityId(e.target.value)}
                        className="px-2.5 py-1.5 border border-[#D5D9DF] rounded bg-white text-xs font-semibold focus:outline-blue-600"
                      >
                        {CITIES.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <span className="text-gray-500 block">Loaded Policy:</span>
                      <span className="font-bold text-[#1A1A1A]">
                        {activePolicy?.schoolName} (v{activePolicy?.policyVersion})
                      </span>
                    </div>
                  </div>

                  {/* Upload action bar */}
                  <div className="flex flex-wrap items-center gap-3">
                  <label
                    htmlFor={nurseLogInputId}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded text-xs sm:text-sm font-semibold hover:bg-blue-700 cursor-pointer min-h-[40px]"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Upload Nurse CSV</span>
                  </label>
                  <input
                    id={nurseLogInputId}
                    type="file"
                    accept=".csv"
                    onChange={handleNurseFileUpload}
                    className="sr-only"
                  />

                  <button
                    type="button"
                    onClick={handleLoadSampleNurseLog}
                    className="px-3 py-2 bg-white border border-[#D5D9DF] text-[#1A1A1A] rounded text-xs font-medium hover:bg-gray-50 min-h-[40px] flex items-center gap-1.5"
                  >
                    <Sparkles className="w-4 h-4 text-amber-600" />
                    <span>Load Sample Nurse Log</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadNurseTemplate}
                    className="px-3 py-2 bg-white border border-[#D5D9DF] text-[#4A4F57] rounded text-xs font-medium hover:bg-gray-50 min-h-[40px] flex items-center gap-1.5"
                  >
                    <FileDown className="w-4 h-4" />
                    <span>Download Nurse CSV Template</span>
                  </button>
                </div>

                {nurseParseError && (
                  <div className="p-3 bg-red-50 border border-red-300 rounded text-xs text-red-900">
                    <strong>Error: </strong> {nurseParseError}
                  </div>
                )}
              </div>
            );
          })()}
        </section>

          {/* Nurse Comparison Results Output */}
          {nurseComparisonSummary && (
            <section className="bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-xs space-y-6">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-base font-bold text-[#1A1A1A] flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-emerald-600" />
                  <span>Nurse vs. DustWatch Agreement Breakdown</span>
                </h3>
                {nurseComparisonSummary.agreementRatePct !== null && (
                  <span className="text-xs bg-emerald-50 text-emerald-900 border border-emerald-300 px-2.5 py-1 rounded font-bold font-mono">
                    Agreement: {nurseComparisonSummary.agreementRatePct}%
                  </span>
                )}
              </div>

                {/* Telemetry Provenance Badge & Synthetic Warning */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs bg-blue-100 text-blue-900 border border-blue-300 px-2 py-0.5 rounded font-bold uppercase tracking-wide">
                    Telemetry Source
                  </span>
                  <span className="text-xs text-blue-950 font-semibold">
                    {nurseComparisonSummary.hindcastLabel}
                  </span>
                </div>

                {nurseComparisonSummary.isSynthetic && (
                  <div className="p-3 bg-amber-100 border border-amber-400 rounded text-xs text-amber-950 flex items-start gap-2 font-semibold">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div>
                      <span>
                        Notice: Telemetry data used for this comparison is synthetic demonstration data. Real-world nurse agreement claims cannot be substantiated using synthetic data.
                      </span>
                    </div>
                  </div>
                )}

                {/* Required Note B5 */}
                <div className="p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-950 font-semibold">
                  {nurseComparisonSummary.note}
                </div>

              {/* Summary Counter Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                <div className="p-3 rounded bg-emerald-50 border border-emerald-200 text-center">
                  <span className="text-emerald-800 font-medium block">Same Action</span>
                  <span className="text-xl font-bold font-mono text-emerald-900">
                    {nurseComparisonSummary.sameActionCount}
                  </span>
                </div>

                <div className="p-3 rounded bg-blue-50 border border-blue-200 text-center">
                  <span className="text-blue-800 font-medium block">DustWatch More Cautious</span>
                  <span className="text-xl font-bold font-mono text-blue-900">
                    {nurseComparisonSummary.dustwatchMoreCautiousCount}
                  </span>
                </div>

                <div className="p-3 rounded bg-red-50 border-2 border-red-300 text-center">
                  <span className="text-red-800 font-bold block">DustWatch Less Cautious</span>
                  <span className="text-xl font-bold font-mono text-red-900">
                    {nurseComparisonSummary.dustwatchLessCautiousCount}
                  </span>
                </div>

                <div className="p-3 rounded bg-gray-50 border border-gray-200 text-center">
                  <span className="text-gray-600 font-medium block">Not Evaluated</span>
                  <span className="text-xl font-bold font-mono text-gray-800">
                    {nurseComparisonSummary.notEvaluatedCount}
                  </span>
                </div>

                <div className="p-3 rounded bg-amber-50 border border-amber-200 text-center">
                  <span className="text-amber-800 font-medium block">Outside Available Data</span>
                  <span className="text-xl font-bold font-mono text-amber-900">
                    {nurseComparisonSummary.outsideDataCount}
                  </span>
                </div>
              </div>

              {/* Highlighted Table: "DustWatch Less Cautious" Rows */}
              {nurseComparisonSummary.lessCautiousRows.length > 0 && (
                <div className="space-y-2 p-4 bg-red-50/60 border-2 border-red-300 rounded-lg">
                  <div className="flex items-center gap-2 text-red-950 font-bold text-xs uppercase tracking-wide">
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                    <span>Highlighted Safety Review: DustWatch Less Cautious Rows ({nurseComparisonSummary.lessCautiousRows.length})</span>
                  </div>
                  <p className="text-xs text-red-900">
                    These rows represent incidents where the school nurse took more restrictive protective action than DustWatch recommended. Examine the environmental readings below:
                  </p>
                  <div className="overflow-x-auto border border-red-200 rounded bg-white">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-red-100/60 text-red-950 border-b border-red-200">
                        <tr>
                          <th className="py-2 px-3">Date / Hour</th>
                          <th className="py-2 px-3">Activity</th>
                          <th className="py-2 px-3 text-center">Nurse Action</th>
                          <th className="py-2 px-3 text-center">DustWatch</th>
                          <th className="py-2 px-3 text-center">Temp / RH</th>
                          <th className="py-2 px-3 text-center">Heat Index</th>
                          <th className="py-2 px-3 text-center">PM10 / Dust</th>
                          <th className="py-2 px-3 text-center">Wind</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nurseComparisonSummary.lessCautiousRows.map((r, i) => (
                          <tr key={i} className="border-b border-red-100 hover:bg-red-50/30">
                            <td className="py-2 px-3 font-mono font-semibold">
                              {r.date} {String(r.hour).padStart(2, '0')}:00
                            </td>
                            <td className="py-2 px-3 uppercase text-[11px] font-bold">{r.activity}</td>
                            <td className="py-2 px-3 text-center font-bold text-red-700 uppercase">
                              {r.nurse_action}
                            </td>
                            <td className="py-2 px-3 text-center font-bold text-gray-800 uppercase">
                              {r.dustwatch_action}
                            </td>
                            <td className="py-2 px-3 text-center font-mono text-[11px]">
                              {r.readings?.temperature ?? '-'}°C / {r.readings?.relativeHumidity ?? '-'}%
                            </td>
                            <td className="py-2 px-3 text-center font-mono text-[11px]">
                              {r.readings?.heatIndex !== null && r.readings?.heatIndex !== undefined ? `${r.readings.heatIndex}°C` : 'n/a'}
                            </td>
                            <td className="py-2 px-3 text-center font-mono text-[11px]">
                              {r.readings?.pm10 ?? '-'} / {r.readings?.dust ?? '-'}
                            </td>
                            <td className="py-2 px-3 text-center font-mono text-[11px]">
                              {r.readings?.windGusts ?? r.readings?.windSpeed ?? '-'} km/h
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Complete Rows Table with Filter */}
              <div className="space-y-3 pt-2 border-t border-[#D5D9DF]">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h4 className="text-xs font-bold text-[#1A1A1A] uppercase tracking-wide">
                    All Logged Rows ({nurseComparisonSummary.totalRows})
                  </h4>

                  {/* Filter chips */}
                  <div className="flex flex-wrap gap-1 text-xs">
                    {(['all', 'less_cautious', 'more_cautious', 'same', 'not_evaluated', 'outside_data'] as const).map(
                      (filterKey) => (
                        <button
                          key={filterKey}
                          type="button"
                          onClick={() => setNurseFilter(filterKey)}
                          className={`px-2.5 py-1 rounded border text-[11px] transition-colors ${
                            nurseFilter === filterKey
                              ? 'bg-blue-600 text-white border-blue-700 font-bold'
                              : 'bg-white text-[#4A4F57] border-[#D5D9DF] hover:bg-gray-50'
                          }`}
                        >
                          {filterKey.replace('_', ' ')}
                        </button>
                      )
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto border border-[#D5D9DF] rounded">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-gray-50 border-b border-[#D5D9DF] text-[#4A4F57]">
                      <tr>
                        <th className="py-2 px-3">Row</th>
                        <th className="py-2 px-3">Date / Hour</th>
                        <th className="py-2 px-3">Activity</th>
                        <th className="py-2 px-3 text-center">Nurse Action</th>
                        <th className="py-2 px-3 text-center">DustWatch</th>
                        <th className="py-2 px-3 text-center">Agreement Status</th>
                        <th className="py-2 px-3">Evaluation Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredNurseRows.map((r) => (
                        <tr key={r.rowNumber} className="border-b border-[#D5D9DF] hover:bg-gray-50">
                          <td className="py-2 px-3 font-mono text-gray-500">{r.rowNumber}</td>
                          <td className="py-2 px-3 font-mono font-semibold">
                            {r.date} {String(r.hour).padStart(2, '0')}:00
                          </td>
                          <td className="py-2 px-3 uppercase font-bold text-[11px]">{r.activity}</td>
                          <td className="py-2 px-3 text-center font-bold uppercase">{r.nurse_action}</td>
                          <td className="py-2 px-3 text-center font-bold uppercase">
                            {r.dustwatch_action || '-'}
                          </td>
                          <td className="py-2 px-3 text-center">
                            {r.status === 'outside_data' ? (
                              <span className="text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded text-[11px]">
                                Outside Available Data
                              </span>
                            ) : r.status === 'not_evaluated' ? (
                              <span className="text-gray-700 bg-gray-100 border border-gray-300 px-2 py-0.5 rounded text-[11px]">
                                Not Evaluated
                              </span>
                            ) : r.agreement_category === 'same_action' ? (
                              <span className="text-emerald-800 bg-emerald-50 border border-emerald-300 px-2 py-0.5 rounded font-bold text-[11px]">
                                Same Action
                              </span>
                            ) : r.agreement_category === 'dustwatch_more_cautious' ? (
                              <span className="text-blue-800 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded text-[11px]">
                                DustWatch More Cautious
                              </span>
                            ) : (
                              <span className="text-red-800 bg-red-100 border border-red-300 px-2 py-0.5 rounded font-bold text-[11px]">
                                DustWatch Less Cautious
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-[11px] text-[#4A4F57]">
                            {r.reason || r.triggeredRules?.join(', ') || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};
