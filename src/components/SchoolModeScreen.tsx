/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  GraduationCap,
  HelpCircle,
  Info,
  Printer,
  RotateCcw,
  School,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Thermometer,
  Trash2,
  Wind,
  X,
} from 'lucide-react';
import { APP_CONFIG, CITIES } from '../config.ts';
import { STRINGS } from '../strings.ts';
import {
  CityOutlook,
  HourlySchoolAssessment,
  RawCityData,
  SchoolActivityAssessment,
  SchoolActivityType,
  SchoolPolicyConfig,
  SchoolPolicyRule,
  SchoolRecommendedAction,
} from '../types.ts';
import {
  DEFAULT_UNCONFIGURED_POLICY,
  FICTIONAL_DEMO_POLICY,
  buildHourlySchoolAssessments,
  validateSchoolPolicy,
} from '../schoolPolicy.ts';
import { extract12Hours, getCurrentDubaiHour } from '../dataService.ts';
import { getSchoolModeAdvice, serializeSchoolAdviceInputs } from '../geminiService.ts';

interface SchoolModeScreenProps {
  outlooks: Record<string, CityOutlook>;
  rawCityData: Record<string, RawCityData>;
  selectedCityId: string;
  onSelectCity: (id: string) => void;
  lastUpdatedFormatted: string;
  schoolPolicy?: SchoolPolicyConfig;
  onUpdateSchoolPolicy?: (policy: SchoolPolicyConfig) => void;
}

export const SchoolModeScreen: React.FC<SchoolModeScreenProps> = ({
  outlooks,
  rawCityData,
  selectedCityId,
  onSelectCity,
  lastUpdatedFormatted,
  schoolPolicy: propSchoolPolicy,
  onUpdateSchoolPolicy,
}) => {
  const currentOutlook = outlooks[selectedCityId];
  const currentRaw = rawCityData[selectedCityId];
  const selectedCityInfo = CITIES.find((c) => c.id === selectedCityId) || {
    id: selectedCityId,
    name: selectedCityId,
    latitude: 0,
    longitude: 0,
  };

  // Activities: Show Break and PE only (Lunch behind config.schoolActivities, off by default)
  const showLunch = APP_CONFIG.schoolActivities?.showLunch ?? false;
  const [selectedActivity, setSelectedActivity] = useState<SchoolActivityType>('break');

  // Track if rules were edited in the browser
  const [isLocallyEdited, setIsLocallyEdited] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dustwatch_policy_is_locally_edited') === 'true';
    } catch {
      return false;
    }
  });

  // Base configured policy preset
  const [baseConfiguredPreset, setBaseConfiguredPreset] = useState<'unconfigured' | 'demo'>(() => {
    try {
      const preset = localStorage.getItem('dustwatch_base_preset');
      return preset === 'demo' ? 'demo' : 'unconfigured';
    } catch {
      return 'unconfigured';
    }
  });

  // School policy configuration state
  const [schoolPolicy, setSchoolPolicy] = useState<SchoolPolicyConfig>(() => {
    if (propSchoolPolicy) return validateSchoolPolicy(propSchoolPolicy);
    try {
      const saved = localStorage.getItem('dustwatch_school_policy');
      if (saved) return validateSchoolPolicy(JSON.parse(saved));
    } catch {
      // ignore
    }
    return DEFAULT_UNCONFIGURED_POLICY;
  });

  useEffect(() => {
    if (propSchoolPolicy) {
      setSchoolPolicy(propSchoolPolicy);
      setEditableRules(propSchoolPolicy.rules);
    }
  }, [propSchoolPolicy]);

  const updatePolicy = (newPolicy: SchoolPolicyConfig) => {
    setSchoolPolicy(newPolicy);
    setEditableRules(newPolicy.rules);
    onUpdateSchoolPolicy?.(newPolicy);
  };

  // Selected hour index within the 12-hour outlook
  const [selectedHourIndex, setSelectedHourIndex] = useState<number>(0);

  // Policy Editor Modal state
  const [showPolicyModal, setShowPolicyModal] = useState<boolean>(false);
  const [editableRules, setEditableRules] = useState<SchoolPolicyRule[]>(schoolPolicy.rules);

  // Gemini advice state for school mode, tracked with request key to prevent stale advice
  const [activeAdviceState, setActiveAdviceState] = useState<{
    key: string;
    summary: string;
    isAI: boolean;
  } | null>(null);
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);

  // Reset to 'break' if lunch is disabled and lunch was previously active
  useEffect(() => {
    if (!showLunch && selectedActivity === 'lunch_other') {
      setSelectedActivity('break');
    }
  }, [showLunch, selectedActivity]);

  // Extract 12 hours from raw data
  const { hourString } = getCurrentDubaiHour();
  const raw12Hours = currentRaw ? extract12Hours(currentRaw, hourString) : [];

  // Compute 12-hour school assessments
  const hourlyAssessments: HourlySchoolAssessment[] = buildHourlySchoolAssessments(
    raw12Hours,
    schoolPolicy
  );

  const selectedAssessment = hourlyAssessments[selectedHourIndex] || hourlyAssessments[0];
  const currentActivityAssessment = selectedAssessment?.activityAssessments[selectedActivity];

  // Derive canonical request key from current inputs
  const currentRequestKey = React.useMemo(() => {
    if (!currentOutlook || !selectedAssessment || !currentActivityAssessment) return '';
    const lunchAllowed = APP_CONFIG.schoolActivities?.showLunch ?? false;
    let normalizedActivity: 'break' | 'pe' | 'lunch' = 'break';
    if (selectedActivity === 'pe') normalizedActivity = 'pe';
    else if (lunchAllowed && (String(selectedActivity) === 'lunch_other' || String(selectedActivity) === 'lunch')) normalizedActivity = 'lunch';

    let normalizedAction: 'normal' | 'shorten' | 'cancel' = 'normal';
    if (currentActivityAssessment.recommendedAction === 'modified') normalizedAction = 'shorten';
    else if (currentActivityAssessment.recommendedAction === 'indoor_only' || currentActivityAssessment.recommendedAction === 'suspend') normalizedAction = 'cancel';

    const readings = selectedAssessment.environmentalReadings;
    const inputPayload = {
      city: currentOutlook.city.name,
      activity: normalizedActivity,
      hour: selectedAssessment.displayHour,
      action: normalizedAction,
      status: currentActivityAssessment.status,
      reason: currentActivityAssessment.reason,
      heatIndex: readings.heatIndex.heatIndexCelsius,
      temperature: readings.temperature,
      humidity: readings.relativeHumidity,
      pm10: readings.pm10,
      pm25: readings.pm2_5,
      dust: readings.dust,
      windSpeed: readings.windSpeed,
      visibility: readings.visibility,
      triggeredRules: currentActivityAssessment.triggeredRules
        .map((tr) => ({
          ruleId: tr.rule.id,
          metric: tr.rule.metric,
        }))
        .sort((a, b) => a.ruleId.localeCompare(b.ruleId)),
      levelNow: currentOutlook.levelNow,
      peakLevel: currentOutlook.peakLevel,
      peakWindow: currentOutlook.worstWindow.displayRange,
      confidence: currentOutlook.confidence,
      lunchEnabled: lunchAllowed,
      isPolicyConfigured: schoolPolicy.isConfigured,
      isFictionalDemo: schoolPolicy.isFictionalDemo,
      isIncomplete: currentActivityAssessment.isIncomplete,
      dataMissingForAssessment: currentActivityAssessment.dataMissingForAssessment,
      policyVersion: schoolPolicy.policyVersion,
      schoolName: schoolPolicy.schoolName,
      policyContext: {
        policyVersion: schoolPolicy.policyVersion,
        schoolName: schoolPolicy.schoolName,
        sourceDocument: schoolPolicy.sourceDocument,
      },
    };
    return serializeSchoolAdviceInputs(inputPayload);
  }, [
    currentOutlook,
    selectedAssessment,
    currentActivityAssessment,
    selectedActivity,
    schoolPolicy,
  ]);

  const aiSummary = activeAdviceState?.key === currentRequestKey ? activeAdviceState.summary : undefined;
  const isAiGenerated = activeAdviceState?.key === currentRequestKey ? activeAdviceState.isAI : false;

  // Update AI advice when request inputs change
  useEffect(() => {
    if (!currentOutlook || !selectedAssessment || !currentActivityAssessment || !currentRequestKey) {
      setActiveAdviceState(null);
      setIsAiLoading(false);
      return;
    }

    const requestKey = currentRequestKey;
    let isMounted = true;
    setIsAiLoading(true);

    const readings = selectedAssessment.environmentalReadings;

    getSchoolModeAdvice(
      currentOutlook.city.name,
      selectedActivity,
      selectedAssessment.displayHour,
      {
        status: currentActivityAssessment.status,
        recommendedAction: currentActivityAssessment.recommendedAction,
        actionTitle: currentActivityAssessment.actionTitle,
        primaryGuidance: currentActivityAssessment.primaryGuidance,
        reason: currentActivityAssessment.reason,
        triggeredRules: currentActivityAssessment.triggeredRules.map((tr) => ({
          rule: { id: tr.rule.id, metric: tr.rule.metric },
        })),
        dataMissingForAssessment: currentActivityAssessment.dataMissingForAssessment,
        isIncomplete: currentActivityAssessment.isIncomplete,
        isPolicyConfigured: schoolPolicy.isConfigured,
        isFictionalDemo: schoolPolicy.isFictionalDemo,
      },
      {
        temperature: readings.temperature,
        relativeHumidity: readings.relativeHumidity,
        heatIndex: {
          heatIndexCelsius: readings.heatIndex.heatIndexCelsius,
          category: readings.heatIndex.category,
        },
        pm10: readings.pm10,
        pm25: readings.pm2_5,
        dust: readings.dust,
        windSpeed: readings.windSpeed,
        visibility: readings.visibility,
      },
      {
        levelNow: currentOutlook.levelNow,
        peakLevel: currentOutlook.peakLevel,
        peakWindow: currentOutlook.worstWindow.displayRange,
        confidence: currentOutlook.confidence,
      },
      {
        policyVersion: schoolPolicy.policyVersion,
        schoolName: schoolPolicy.schoolName,
        sourceDocument: schoolPolicy.sourceDocument,
      }
    )
      .then((res) => {
        if (isMounted) {
          setActiveAdviceState({
            key: requestKey,
            summary: res.summary,
            isAI: res.isAI,
          });
          setIsAiLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setActiveAdviceState({
            key: requestKey,
            summary: currentActivityAssessment.primaryGuidance,
            isAI: false,
          });
          setIsAiLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [currentRequestKey]);

  // Load demonstration policy
  const handleLoadFictionalDemo = () => {
    updatePolicy(FICTIONAL_DEMO_POLICY);
    setBaseConfiguredPreset('demo');
    setIsLocallyEdited(false);
    try {
      localStorage.setItem('dustwatch_school_policy', JSON.stringify(FICTIONAL_DEMO_POLICY));
      localStorage.setItem('dustwatch_base_preset', 'demo');
      localStorage.removeItem('dustwatch_policy_is_locally_edited');
    } catch {
      // ignore
    }
  };

  const handleResetToUnconfigured = () => {
    updatePolicy(DEFAULT_UNCONFIGURED_POLICY);
    setBaseConfiguredPreset('unconfigured');
    setIsLocallyEdited(false);
    try {
      localStorage.setItem('dustwatch_school_policy', JSON.stringify(DEFAULT_UNCONFIGURED_POLICY));
      localStorage.setItem('dustwatch_base_preset', 'unconfigured');
      localStorage.removeItem('dustwatch_policy_is_locally_edited');
    } catch {
      // ignore
    }
  };

  // Reset to configured policy (clears local browser rule edits)
  const handleResetToConfiguredPolicy = () => {
    const base = baseConfiguredPreset === 'demo' ? FICTIONAL_DEMO_POLICY : DEFAULT_UNCONFIGURED_POLICY;
    updatePolicy(base);
    setIsLocallyEdited(false);
    try {
      localStorage.setItem('dustwatch_school_policy', JSON.stringify(base));
      localStorage.removeItem('dustwatch_policy_is_locally_edited');
    } catch {
      // ignore
    }
  };

  // Save edits made in browser modal
  const handleSaveModalRuleEdits = () => {
    const updatedPolicy: SchoolPolicyConfig = {
      ...schoolPolicy,
      isConfigured: editableRules.length > 0,
      rules: editableRules,
    };
    updatePolicy(updatedPolicy);
    setIsLocallyEdited(true);
    setShowPolicyModal(false);
    try {
      localStorage.setItem('dustwatch_school_policy', JSON.stringify(updatedPolicy));
      localStorage.setItem('dustwatch_policy_is_locally_edited', 'true');
    } catch {
      // ignore
    }
  };

  const handleRuleThresholdChange = (index: number, newThreshold: number) => {
    setEditableRules((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], threshold: newThreshold };
      return copy;
    });
  };

  const handleRuleActionChange = (index: number, newAction: SchoolRecommendedAction) => {
    setEditableRules((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], recommendedAction: newAction };
      return copy;
    });
  };

  const handleDeleteRule = (index: number) => {
    setEditableRules((prev) => prev.filter((_, i) => i !== index));
  };

  const getActionBadge = (
    actionOrAssessment?: SchoolActivityAssessment | SchoolRecommendedAction | null,
    isConfigured: boolean = true,
    dataMissing?: boolean
  ) => {
    let status: string | undefined;
    let action: SchoolRecommendedAction = 'normal';
    let isIncomplete = false;

    if (actionOrAssessment && typeof actionOrAssessment === 'object') {
      status = actionOrAssessment.status;
      action = actionOrAssessment.recommendedAction;
      isIncomplete = actionOrAssessment.isIncomplete;
      dataMissing = actionOrAssessment.dataMissingForAssessment;
    } else if (typeof actionOrAssessment === 'string') {
      action = actionOrAssessment as SchoolRecommendedAction;
    }

    if (!isConfigured || status === 'policy_unconfigured') {
      return (
        <span className="bg-gray-100 text-gray-800 border border-gray-300 px-2.5 py-1 rounded text-xs font-bold inline-flex items-center gap-1.5">
          <HelpCircle className="w-3.5 h-3.5 text-gray-600" />
          <span>Policy Configuration Required</span>
        </span>
      );
    }

    if (status === 'no_applicable_rules') {
      return (
        <span className="bg-slate-100 text-slate-800 border border-slate-300 px-2.5 py-1 rounded text-xs font-bold inline-flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-slate-600" />
          <span>No Applicable Rules Configured</span>
        </span>
      );
    }

    if (status === 'assessment_unavailable' || (dataMissing && (!status || status !== 'action_triggered'))) {
      return (
        <span className="bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-1 rounded text-xs font-bold inline-flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
          <span>Assessment Unavailable (Data Missing)</span>
        </span>
      );
    }

    // Never display "Criteria Met" if assessment is incomplete
    if (status === 'criteria_met_no_actions') {
      if (isIncomplete || dataMissing) {
        return (
          <span className="bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-1 rounded text-xs font-bold inline-flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
            <span>Assessment Incomplete</span>
          </span>
        );
      }
      return (
        <span className="bg-emerald-100 text-emerald-900 border border-emerald-300 px-2.5 py-1 rounded text-xs font-bold inline-flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
          <span>Criteria Met</span>
        </span>
      );
    }

    // Distinguish triggered rule with normal action from un-triggered criteria met
    if (action === 'normal') {
      return (
        <span className="bg-blue-100 text-blue-900 border border-blue-300 px-2.5 py-1 rounded text-xs font-bold inline-flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-blue-700" />
          <span>Normal Activity Rule Triggered{isIncomplete ? ' (Incomplete Data)' : ''}</span>
        </span>
      );
    }

    switch (action) {
      case 'modified':
        return (
          <span className="bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-1 rounded text-xs font-bold inline-flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
            <span>Modified Activity Advised{isIncomplete ? ' (Incomplete Data)' : ''}</span>
          </span>
        );
      case 'indoor_only':
        return (
          <span className="bg-orange-100 text-orange-900 border border-orange-300 px-2.5 py-1 rounded text-xs font-bold inline-flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-orange-700" />
            <span>Move Indoors{isIncomplete ? ' (Incomplete Data)' : ''}</span>
          </span>
        );
      case 'suspend':
        return (
          <span className="bg-red-100 text-red-900 border border-red-300 px-2.5 py-1 rounded text-xs font-bold inline-flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-red-700" />
            <span>Suspend Activity{isIncomplete ? ' (Incomplete Data)' : ''}</span>
          </span>
        );
    }
  };

  // Color mapping: "Below Caution range" replaces "Normal", "not applicable" is neutral gray
  const getHeatCategoryColor = (cat: string) => {
    switch (cat) {
      case 'Extreme Danger':
        return 'text-red-700 bg-red-100 border-red-300';
      case 'Danger':
        return 'text-orange-800 bg-orange-100 border-orange-300';
      case 'Extreme Caution':
        return 'text-amber-800 bg-amber-100 border-amber-300';
      case 'Caution':
        return 'text-yellow-800 bg-yellow-100 border-yellow-300';
      case 'Below Caution range':
        return 'text-emerald-800 bg-emerald-100 border-emerald-300';
      case 'not applicable':
      default:
        return 'text-gray-700 bg-gray-100 border-gray-300';
    }
  };

  if (!currentOutlook || !currentRaw || !selectedAssessment) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto pb-12">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-xs">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-[#1A1A1A] flex items-center gap-2">
                <School className="w-6 h-6 text-blue-700" />
                <span>DustWatch School Mode</span>
              </h1>
              <span className="text-xs bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded font-semibold">
                Campus Data Unavailable
              </span>
            </div>
            <p className="text-xs text-[#4A4F57] mt-1">
              Campus Location: <strong>{selectedCityInfo.name}</strong>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="school-city-select-fallback" className="text-xs font-semibold text-[#1A1A1A]">
              Campus Location:
            </label>
            <select
              id="school-city-select-fallback"
              value={selectedCityId}
              onChange={(e) => onSelectCity(e.target.value)}
              className="border border-[#D5D9DF] rounded-md px-3 py-2 text-xs font-semibold bg-white text-[#1A1A1A] min-h-[44px]"
            >
              {CITIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="p-8 text-center bg-white border border-[#D5D9DF] rounded-lg space-y-3">
          <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-base font-bold text-[#1A1A1A]">
            Telemetry Unavailable for {selectedCityInfo.name}
          </h2>
          <p className="text-xs text-[#4A4F57] max-w-lg mx-auto leading-relaxed">
            Environmental observations and hourly forecasts for the selected campus ({selectedCityInfo.name}) are currently unavailable. DustWatch isolates campus telemetry and never substitutes readings from another city.
          </p>
        </div>
      </div>
    );
  }

  const readings = selectedAssessment.environmentalReadings;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Printable Document Header (shown only when printing) */}
      <div className="hidden print:block mb-6 p-4 border-b border-black">
        <h1 className="text-xl font-bold">DustWatch School Mode Outdoor Activity Assessment</h1>
        <p className="text-sm">Campus Location: {currentOutlook.city.name} | Printed on: {new Date().toLocaleString()}</p>
        <p className="text-xs font-mono mt-1">
          Policy Source: {schoolPolicy.sourceDocument || 'School Operational Rules'} | Version: {schoolPolicy.policyVersion} | Effective Date: {schoolPolicy.effectiveDate}
        </p>
      </div>

      {/* 1. Header with UAE Location Selection, Title & Print Button */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-xs print:hidden">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[#1A1A1A] flex items-center gap-2">
              <School className="w-6 h-6 text-blue-700" />
              <span>DustWatch School Mode</span>
            </h1>
            <span className="text-xs bg-blue-100 text-blue-900 border border-blue-200 px-2 py-0.5 rounded font-semibold">
              Nurse & Staff Workflow
            </span>
          </div>
          <p className="text-xs text-[#4A4F57] mt-1 max-w-2xl leading-relaxed">
            Support authorised school staff by combining environmental observations with the school’s approved outdoor activity thresholds.
          </p>
        </div>

        {/* City Selector & Print Action */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <label htmlFor="school-city-select" className="text-xs font-semibold text-[#1A1A1A]">
            Campus Location:
          </label>
          <select
            id="school-city-select"
            value={selectedCityId}
            onChange={(e) => onSelectCity(e.target.value)}
            className="border border-[#D5D9DF] rounded-md px-3 py-2 text-xs font-semibold bg-white text-[#1A1A1A] min-h-[44px]"
          >
            {CITIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => window.print()}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-[#1A1A1A] border border-[#D5D9DF] rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer min-h-[44px]"
          >
            <Printer className="w-3.5 h-3.5 text-gray-700" />
            <span>Print View</span>
          </button>
        </div>
      </div>

      {/* 2. Critical Separation Banner: Dust Risk vs School Activity Assessment */}
      <div className="p-4 rounded-lg bg-blue-50/70 border border-blue-200 text-xs text-[#1A1A1A] space-y-1.5 shadow-xs print:hidden">
        <div className="font-bold flex items-center gap-1.5 text-blue-950">
          <Info className="w-4 h-4 text-blue-700 shrink-0" />
          <span>Understanding the Distinction Between Environmental Dust Risk and School Activity Policy</span>
        </div>
        <p className="leading-relaxed text-[#4A4F57]">
          <strong>Estimated Dust Risk</strong> is the general atmospheric particulate risk across the region calculated by DustWatch.
          <strong> School Activity Assessment</strong> evaluates multi-factor environmental readings (including heat stress, particulate matter, and wind gusts) against your school’s approved administrative rules. Relative humidity IS used in the regional dust score with a 5% weighting (low humidity reflects dry conditions that facilitate airborne dust). Air temperature is NOT included in the dust score, but is combined with humidity in the separate Heat Index calculation for School Mode.
        </p>
      </div>

      {/* 2b. Mandatory Local Policy Edits Banner */}
      {isLocallyEdited && (
        <div className="p-3.5 rounded-lg bg-amber-50 border-2 border-amber-400 text-amber-950 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-800 shrink-0" />
            <div>
              <span className="font-bold text-sm block">Using locally edited rules, not the school's approved policy</span>
              <span className="text-[11px] text-amber-900">
                Rule criteria have been customized in this browser. To restore approved administrative rules, reset below.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleResetToConfiguredPolicy}
            className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-md font-semibold cursor-pointer shrink-0 text-xs shadow-xs"
          >
            Reset to configured policy
          </button>
        </div>
      )}

      {/* 3. Policy Configuration Status Bar */}
      <div
        className={`p-4 rounded-lg border text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs ${
          !schoolPolicy.isConfigured
            ? 'bg-amber-50 border-amber-300 text-amber-950'
            : schoolPolicy.isFictionalDemo
            ? 'bg-purple-50 border-purple-300 text-purple-950'
            : 'bg-emerald-50 border-emerald-300 text-emerald-950'
        }`}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm">
              {!schoolPolicy.isConfigured
                ? 'School Policy Configuration Required'
                : schoolPolicy.isFictionalDemo
                ? 'FICTIONAL TEST POLICY (Demonstration Only — Not Real Policy)'
                : `Active Policy: ${schoolPolicy.schoolName}`}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/80 border">
              v{schoolPolicy.policyVersion}
            </span>
            {isLocallyEdited && (
              <span className="text-[10px] bg-amber-200 text-amber-900 border border-amber-300 px-1.5 py-0.2 rounded font-bold">
                Locally Edited
              </span>
            )}
          </div>
          <p className="text-[#4A4F57] text-xs">
            {!schoolPolicy.isConfigured
              ? 'Approved school operational policy is required before evaluating recommendations. Displaying unconfigured state.'
              : schoolPolicy.isFictionalDemo
              ? 'This policy uses fictional demonstration thresholds for testing the rule engine. It must not be mistaken for operational school guidance.'
              : `Effective: ${schoolPolicy.effectiveDate}. Source: ${schoolPolicy.sourceDocument || 'School Safety Guidelines'}.`}
          </p>
        </div>

        {/* Quick Demo Controls */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap print:hidden">
          {!schoolPolicy.isConfigured ? (
            <button
              type="button"
              onClick={handleLoadFictionalDemo}
              className="px-3 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-md text-xs font-semibold cursor-pointer min-h-[44px]"
            >
              Load Fictional Test Policy (Demo)
            </button>
          ) : (
            <button
              type="button"
              onClick={handleResetToUnconfigured}
              className="px-3 py-2 bg-white border border-gray-300 hover:bg-gray-100 text-gray-800 rounded-md text-xs font-semibold cursor-pointer min-h-[44px]"
            >
              Reset to Unconfigured State
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setEditableRules(schoolPolicy.rules);
              setShowPolicyModal(true);
            }}
            className="px-3 py-2 bg-white border border-[#D5D9DF] hover:bg-gray-50 text-[#1A1A1A] rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer min-h-[44px]"
          >
            <Settings className="w-3.5 h-3.5 text-gray-600" />
            <span>View / Edit Policy Rules</span>
          </button>
        </div>
      </div>

      {/* 4. Side-by-Side Dual Assessment Banner */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left Card: Estimated Dust Risk */}
        <div className="bg-white border border-[#D5D9DF] rounded-lg p-4 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#4A4F57]">
              Regional Dust Risk (DustWatch)
            </span>
            <span
              style={{
                backgroundColor: APP_CONFIG.colors[currentOutlook.peakLevel].badgeBg,
                color: APP_CONFIG.colors[currentOutlook.peakLevel].badgeText,
                borderColor: APP_CONFIG.colors[currentOutlook.peakLevel].border,
              }}
              className="px-2.5 py-0.5 rounded text-xs font-bold border"
            >
              {currentOutlook.peakLevel} Peak
            </span>
          </div>
          <p className="text-xs text-[#4A4F57] leading-relaxed">
            Atmospheric model score based on PM10, dust concentration, wind speed, gusts, AOD, humidity (5% weight), and visibility.
          </p>
          <div className="text-xs text-[#1A1A1A] pt-1 border-t border-gray-100 flex justify-between">
            <span>Peak 3-Hour Window:</span>
            <span className="font-semibold">{currentOutlook.worstWindow.displayRange}</span>
          </div>
        </div>

        {/* Right Card: School Activity Status */}
        <div className="bg-white border border-[#D5D9DF] rounded-lg p-4 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#4A4F57]">
              School Activity Status ({selectedActivity.toUpperCase()})
            </span>
            {getActionBadge(currentActivityAssessment, schoolPolicy.isConfigured)}
          </div>
          <p className="text-xs text-[#1A1A1A] font-medium">
            {currentActivityAssessment?.actionTitle}
          </p>
          <div className="text-xs text-[#4A4F57] pt-1 border-t border-gray-100 flex justify-between">
            <span>Rule Evaluation:</span>
            <span>
              {schoolPolicy.isConfigured
                ? `${currentActivityAssessment?.triggeredRules.filter((r) => r.isTriggered).length || 0} policy thresholds triggered`
                : 'Awaiting verified policy'}
            </span>
          </div>
        </div>
      </div>

      {/* 5. Environmental Conditions Dashboard */}
      <div className="bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-[#D5D9DF] pb-3">
          <div>
            <h2 className="text-base font-bold text-[#1A1A1A] flex items-center gap-2">
              <Sun className="w-5 h-5 text-amber-600" />
              <span>Environmental Conditions Dashboard</span>
            </h2>
            <p className="text-xs text-[#4A4F57]">
              Hourly meteorological and particulate matter telemetry for {currentOutlook.city.name} at {selectedAssessment.displayHour} GST.
            </p>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-[#4A4F57]">
            <Clock className="w-3.5 h-3.5" />
            <span>Updated: {lastUpdatedFormatted}</span>
          </div>
        </div>

        {/* Environmental Telemetry Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
          {/* Temperature */}
          <div className="p-3 rounded-lg border border-[#D5D9DF] bg-gray-50/70">
            <div className="text-[#4A4F57] font-medium flex items-center gap-1 mb-1">
              <Thermometer className="w-3.5 h-3.5 text-red-600" />
              <span>Air Temperature</span>
            </div>
            <div className="text-lg font-bold text-[#1A1A1A]">
              {readings.temperature !== null ? `${readings.temperature} °C` : <span className="text-gray-500 font-normal text-xs">not applicable</span>}
            </div>
            <div className="text-[10px] text-[#4A4F57] mt-0.5">Forecast (2m ambient)</div>
          </div>

          {/* Relative Humidity */}
          <div className="p-3 rounded-lg border border-[#D5D9DF] bg-gray-50/70">
            <div className="text-[#4A4F57] font-medium flex items-center gap-1 mb-1">
              <Sun className="w-3.5 h-3.5 text-blue-600" />
              <span>Relative Humidity</span>
            </div>
            <div className="text-lg font-bold text-[#1A1A1A]">
              {readings.relativeHumidity !== null ? `${readings.relativeHumidity} %` : <span className="text-gray-500 font-normal text-xs">not applicable</span>}
            </div>
            <div className="text-[10px] text-[#4A4F57] mt-0.5">Used in dust score (5% wt)</div>
          </div>

          {/* Combined Heat Index: Categories labeled NWS general reference, no example thresholds */}
          <div className="p-3 rounded-lg border border-[#D5D9DF] bg-amber-50/40">
            <div className="text-[#4A4F57] font-medium flex items-center justify-between gap-1 mb-1">
              <span>Heat Index (Apparent)</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold border ${getHeatCategoryColor(readings.heatIndex.category)}`}>
                {readings.heatIndex.category}
              </span>
            </div>
            <div className="text-lg font-bold text-[#1A1A1A]">
              {readings.heatIndex.heatIndexCelsius !== null
                ? `${readings.heatIndex.heatIndexCelsius} °C`
                : <span className="text-gray-500 font-normal text-xs">not applicable</span>}
            </div>
            <div className="text-[10px] text-[#4A4F57] mt-0.5 font-medium">
              NWS general reference, not school policy
            </div>
          </div>

          {/* PM10 Particles */}
          <div className="p-3 rounded-lg border border-[#D5D9DF] bg-gray-50/70">
            <div className="text-[#4A4F57] font-medium flex items-center gap-1 mb-1">
              <Eye className="w-3.5 h-3.5 text-purple-600" />
              <span>PM10 Particulate</span>
            </div>
            <div className="text-lg font-bold text-[#1A1A1A]">
              {readings.pm10 !== null ? `${readings.pm10} µg/m³` : <span className="text-gray-500 font-normal text-xs">not applicable</span>}
            </div>
            <div className="text-[10px] text-[#4A4F57] mt-0.5">Model-based estimate (CAMS)</div>
          </div>

          {/* PM2.5 Particles */}
          <div className="p-3 rounded-lg border border-[#D5D9DF] bg-gray-50/70">
            <div className="text-[#4A4F57] font-medium flex items-center gap-1 mb-1">
              <Eye className="w-3.5 h-3.5 text-indigo-600" />
              <span>PM2.5 Fine Particles</span>
            </div>
            <div className="text-lg font-bold text-[#1A1A1A]">
              {readings.pm2_5 !== null ? `${readings.pm2_5} µg/m³` : <span className="text-gray-500 font-normal text-xs">not applicable</span>}
            </div>
            <div className="text-[10px] text-[#4A4F57] mt-0.5">Model-based estimate (CAMS)</div>
          </div>

          {/* Mineral Dust Concentration */}
          <div className="p-3 rounded-lg border border-[#D5D9DF] bg-gray-50/70">
            <div className="text-[#4A4F57] font-medium flex items-center gap-1 mb-1">
              <Wind className="w-3.5 h-3.5 text-amber-700" />
              <span>Mineral Dust</span>
            </div>
            <div className="text-lg font-bold text-[#1A1A1A]">
              {readings.dust !== null ? `${readings.dust} µg/m³` : <span className="text-gray-500 font-normal text-xs">not applicable</span>}
            </div>
            <div className="text-[10px] text-[#4A4F57] mt-0.5">Atmospheric forecast (CAMS)</div>
          </div>

          {/* Wind Speed & Gusts */}
          <div className="p-3 rounded-lg border border-[#D5D9DF] bg-gray-50/70">
            <div className="text-[#4A4F57] font-medium flex items-center gap-1 mb-1">
              <Wind className="w-3.5 h-3.5 text-blue-700" />
              <span>Wind Speed & Gusts</span>
            </div>
            <div className="text-base font-bold text-[#1A1A1A]">
              {readings.windSpeed !== null ? `${readings.windSpeed} km/h` : 'N/A'}{' '}
              <span className="text-xs font-normal text-[#4A4F57]">
                (Gusts: {readings.windGusts !== null ? `${readings.windGusts} km/h` : 'N/A'})
              </span>
            </div>
            <div className="text-[10px] text-[#4A4F57] mt-0.5">
              Direction: {readings.windDirection !== null ? `${readings.windDirection}°` : 'N/A'}
            </div>
          </div>

          {/* Horizontal Visibility */}
          <div className="p-3 rounded-lg border border-[#D5D9DF] bg-gray-50/70">
            <div className="text-[#4A4F57] font-medium flex items-center gap-1 mb-1">
              <Eye className="w-3.5 h-3.5 text-gray-700" />
              <span>Horizontal Visibility</span>
            </div>
            <div className="text-lg font-bold text-[#1A1A1A]">
              {readings.visibility !== null ? `${readings.visibility} m` : <span className="text-gray-500 font-normal text-xs">not applicable</span>}
            </div>
            <div className="text-[10px] text-[#4A4F57] mt-0.5">Atmospheric visibility</div>
          </div>
        </div>

        {/* Static NCM Link Banner: Honest labeling of current alert-feed capability */}
        <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-xs flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-amber-800 shrink-0" />
            <span className="text-amber-950 font-medium">
              Official alert feed: Direct live feed unconnected. Authorised school staff must verify active official weather warnings directly with the National Center of Meteorology at ncm.ae.
            </span>
          </div>
          <a
            href="https://www.ncm.ae"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 hover:text-blue-900 underline font-semibold flex items-center gap-1 shrink-0"
          >
            <span>Visit ncm.ae</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* 6. Hourly School Activity Recommendations */}
      <div className="bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#D5D9DF] pb-3">
          <div>
            <h2 className="text-base font-bold text-[#1A1A1A] flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-blue-700" />
              <span>12-Hour Activity Schedule Recommendations</span>
            </h2>
            <p className="text-xs text-[#4A4F57]">
              Evaluated against school approved policy precedence rules. Select an hour to inspect triggered conditions.
            </p>
          </div>

          {/* Activity Category Tabs: Break & PE only by default */}
          <div
            role="tablist"
            aria-label="School Activity Tabs"
            className="flex items-center bg-gray-100 p-0.5 rounded-md border border-[#D5D9DF]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={selectedActivity === 'break'}
              onClick={() => setSelectedActivity('break')}
              className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer min-h-[38px] ${
                selectedActivity === 'break'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-[#4A4F57] hover:text-[#1A1A1A]'
              }`}
            >
              Outdoor Break
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={selectedActivity === 'pe'}
              onClick={() => setSelectedActivity('pe')}
              className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer min-h-[38px] ${
                selectedActivity === 'pe'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-[#4A4F57] hover:text-[#1A1A1A]'
              }`}
            >
              Physical Education (PE)
            </button>
            {showLunch && (
              <button
                type="button"
                role="tab"
                aria-selected={selectedActivity === 'lunch_other'}
                onClick={() => setSelectedActivity('lunch_other')}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer min-h-[38px] ${
                  selectedActivity === 'lunch_other'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-[#4A4F57] hover:text-[#1A1A1A]'
                }`}
              >
                Lunch / Outdoor Play
              </button>
            )}
          </div>
        </div>

        {/* 12-Hour Selector Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-1 print:grid print:grid-cols-6 print:gap-2">
          {hourlyAssessments.map((item, idx) => {
            const isSelected = idx === selectedHourIndex;
            const actAssessment = item.activityAssessments[selectedActivity];
            const action = actAssessment.recommendedAction;
            const isMissingData =
              actAssessment.dataMissingForAssessment &&
              (!actAssessment.triggeredRules ||
                actAssessment.triggeredRules.filter((r) => r.isTriggered).length === 0);

            let badgeBg = 'bg-gray-100 text-[#1A1A1A] border-gray-200';
            let labelText = action.replace('_', ' ');

            if (!schoolPolicy.isConfigured || actAssessment.status === 'policy_unconfigured') {
              labelText = 'Pending';
            } else if (actAssessment.status === 'no_applicable_rules') {
              badgeBg = 'bg-slate-100 text-slate-800 border-slate-300';
              labelText = 'No Rules';
            } else if (actAssessment.status === 'assessment_unavailable') {
              badgeBg = 'bg-amber-50 text-amber-900 border-amber-300';
              labelText = 'Data Missing';
            } else {
              if (action === 'normal') badgeBg = 'bg-emerald-50 text-emerald-900 border-emerald-200';
              if (action === 'modified') badgeBg = 'bg-amber-50 text-amber-900 border-amber-200';
              if (action === 'indoor_only') badgeBg = 'bg-orange-50 text-orange-900 border-orange-200';
              if (action === 'suspend') badgeBg = 'bg-red-50 text-red-900 border-red-200';
              if (actAssessment.isIncomplete) {
                labelText += ' (Partial)';
              }
            }

            return (
              <button
                key={item.hourIndex}
                type="button"
                onClick={() => setSelectedHourIndex(idx)}
                aria-pressed={isSelected}
                className={`px-3 py-2 rounded-md border text-xs flex flex-col items-center min-w-[70px] cursor-pointer transition-all ${badgeBg} ${
                  isSelected ? 'ring-2 ring-blue-600 font-bold shadow-xs' : 'hover:opacity-80'
                }`}
              >
                <span>{item.displayHour}</span>
                <span className="text-[10px] uppercase tracking-wider font-semibold opacity-80 mt-0.5">
                  {labelText}
                </span>
              </button>
            );
          })}
        </div>

        {/* Selected Hour Policy Decision Detail Box */}
        <div className="p-4 rounded-lg border border-[#D5D9DF] bg-gray-50/50 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-[#1A1A1A]">
                {selectedAssessment.displayHour} GST Recommendation:
              </span>
              {getActionBadge(currentActivityAssessment, schoolPolicy.isConfigured)}
            </div>

            {currentActivityAssessment.conflictingRules && (
              <span className="text-xs bg-red-100 text-red-900 border border-red-300 px-2 py-0.5 rounded font-semibold">
                Conflicting policy conditions flagged for authorized staff
              </span>
            )}
          </div>

          {/* Action Title and Primary Guidance */}
          <div className="bg-white p-3 rounded-md border border-[#D5D9DF] space-y-1">
            <h3 className="font-bold text-sm text-[#1A1A1A]">
              {currentActivityAssessment.actionTitle}
            </h3>
            <p className="text-xs text-[#4A4F57] leading-relaxed">
              {currentActivityAssessment.primaryGuidance}
            </p>
          </div>

          {/* Policy Metadata Display (Shown on every result card and print view) */}
          <div className="text-[11px] text-[#4A4F57] bg-white p-2.5 rounded border border-[#D5D9DF] flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>Policy Source:</strong> {schoolPolicy.sourceDocument || 'School Operational Rules'}
            </span>
            <span>
              <strong>Version:</strong> {schoolPolicy.policyVersion}
            </span>
            <span>
              <strong>Effective Date:</strong> {schoolPolicy.effectiveDate}
            </span>
          </div>

          {/* Triggered Rules Breakdown */}
          <div>
            <div className="text-xs font-semibold text-[#4A4F57] uppercase tracking-wider mb-2">
              Policy Rule Evaluation & Triggered Conditions
            </div>

            {!schoolPolicy.isConfigured || currentActivityAssessment.status === 'policy_unconfigured' ? (
              <p className="text-xs text-[#4A4F57] italic">
                School policy has not been configured yet. Approved school thresholds must be supplied.
              </p>
            ) : currentActivityAssessment.status === 'no_applicable_rules' ? (
              <div className="p-3 bg-slate-50 border border-slate-300 rounded text-xs text-slate-900 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-slate-900">
                  <Info className="w-4 h-4 text-slate-600 shrink-0" />
                  <span>No Applicable Rules Configured for {selectedActivity === 'break' ? 'Outdoor Break' : selectedActivity === 'pe' ? 'Physical Education (PE)' : 'Lunch'}</span>
                </div>
                <p className="text-slate-700 leading-relaxed">
                  The active school policy contains zero rules that apply to this activity. Displaying distinct unconfigured rules state.
                </p>
              </div>
            ) : currentActivityAssessment.status === 'assessment_unavailable' ? (
              <div className="p-3 bg-amber-50 border border-amber-300 rounded text-xs text-amber-950 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>Assessment Unavailable: Required Environmental Data Is Missing</span>
                </div>
                <p className="text-amber-900 leading-relaxed">
                  One or more required environmental readings are unavailable and cannot be verified against school thresholds. Do not assume conditions are safe.
                </p>
              </div>
            ) : currentActivityAssessment.status === 'criteria_met_no_actions' ? (
              <p className="text-xs text-emerald-800 bg-emerald-50/80 p-2.5 rounded border border-emerald-200">
                Conditions meet the configured criteria for this activity under current policy rules. No threshold was exceeded.
              </p>
            ) : (
              <div className="space-y-2">
                {currentActivityAssessment.isIncomplete && (
                  <div className="p-2.5 rounded bg-amber-50 border border-amber-300 text-xs text-amber-900 flex items-center gap-2 font-medium">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>Incomplete Assessment: Configured action triggered, but some applicable environmental readings were missing or invalid.</span>
                  </div>
                )}
                {currentActivityAssessment.triggeredRules
                  .filter((r) => r.isTriggered)
                  .map((tr) => (
                    <div
                      key={tr.rule.id}
                      className="p-2.5 rounded bg-white border border-amber-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div>
                        <div className="font-semibold text-[#1A1A1A]">{tr.rule.name}</div>
                        <div className="text-[11px] text-[#4A4F57]">
                          Triggered: Rule <code>{tr.rule.id}</code> on metric <code>{tr.rule.metric}</code> ({tr.observedValue} {tr.unit})
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 uppercase shrink-0">
                        {tr.rule.recommendedAction.replace('_', ' ')}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Gemini AI Plain Language Explanation */}
          <div className="pt-2 border-t border-gray-200 print:hidden">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1A1A1A] mb-1">
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              <span>Plain-Language Summary for School Staff:</span>
            </div>
            {isAiLoading ? (
              <p className="text-xs text-[#4A4F57] italic">Preparing summary...</p>
            ) : (
              <p className="text-xs text-[#1A1A1A] leading-relaxed bg-white p-2.5 rounded border border-gray-200">
                {aiSummary || currentActivityAssessment.primaryGuidance}
              </p>
            )}
            <p className="text-[10px] text-[#4A4F57] mt-1">
              {isAiGenerated
                ? 'Explanation generated by Gemini AI from precomputed risk and policy evaluation facts.'
                : schoolPolicy.isFictionalDemo
                ? 'AI summary generation is gated for fictional demonstration data. Standard rule-based guidance is displayed.'
                : currentActivityAssessment.status === 'no_applicable_rules'
                ? 'AI summary generation is gated when no rules apply to the selected activity.'
                : currentActivityAssessment.status === 'assessment_unavailable' || currentActivityAssessment.isIncomplete
                ? 'AI summary generation is gated when environmental readings are missing or incomplete.'
                : !schoolPolicy.isConfigured
                ? 'AI summary generation is gated until school policy is configured.'
                : 'Standard rule-based guidance. DustWatch supports authorised staff; final authority remains with school leadership.'}
            </p>
          </div>
        </div>
      </div>

      {/* 7. Policy Editor / Viewer Modal */}
      {showPolicyModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-[#D5D9DF] shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-[#D5D9DF] flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base text-[#1A1A1A]">
                  School Policy Thresholds Configuration & Rules
                </h3>
                <p className="text-xs text-[#4A4F57]">
                  View and adjust operational rules. Any modification will be clearly marked as locally edited.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPolicyModal(false)}
                className="p-1.5 text-gray-500 hover:text-black rounded"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 text-xs flex-1">
              <div className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-900 leading-relaxed">
                <strong>Policy Verification Notice:</strong> Operational school rules must be officially ratified by school administration and health officers. Any browser edits must not be mistaken for official administrative ratification.
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-sm text-[#1A1A1A]">
                    Configured Activity Rules ({editableRules.length})
                  </div>
                  {isLocallyEdited && (
                    <button
                      type="button"
                      onClick={handleResetToConfiguredPolicy}
                      className="text-xs text-blue-700 hover:underline flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset to configured policy</span>
                    </button>
                  )}
                </div>

                {editableRules.length === 0 ? (
                  <p className="text-gray-500 italic py-4 text-center">
                    No rules configured. Load the fictional test policy or input approved rules.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {editableRules.map((r, i) => (
                      <div key={r.id || i} className="p-3 rounded border border-gray-200 bg-gray-50 space-y-2">
                        <div className="flex items-center justify-between font-bold text-[#1A1A1A]">
                          <span>{r.name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] bg-blue-100 text-blue-900 px-1.5 py-0.2 rounded border font-mono">
                              {r.activity.toUpperCase()}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeleteRule(i)}
                              className="text-red-600 hover:text-red-800 p-1"
                              title="Delete rule"
                              aria-label={`Delete rule ${r.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                          <label className="text-[11px] text-gray-700 flex items-center justify-between">
                            <span>Threshold ({r.unit}):</span>
                            <input
                              type="number"
                              value={r.threshold}
                              onChange={(e) => handleRuleThresholdChange(i, parseFloat(e.target.value) || 0)}
                              className="w-20 px-2 py-1 border rounded bg-white font-mono text-right"
                            />
                          </label>

                          <label className="text-[11px] text-gray-700 flex items-center justify-between">
                            <span>Action:</span>
                            <select
                              value={r.recommendedAction}
                              onChange={(e) => handleRuleActionChange(i, e.target.value as SchoolRecommendedAction)}
                              className="px-2 py-1 border rounded bg-white text-xs"
                            >
                              <option value="normal">normal</option>
                              <option value="modified">modified</option>
                              <option value="indoor_only">indoor_only</option>
                              <option value="suspend">suspend</option>
                            </select>
                          </label>
                        </div>

                        <div className="text-[11px] text-gray-500">
                          Metric: <code>{r.metric}</code> {r.operator} {r.threshold} {r.unit} &rarr; Action: <strong>{r.recommendedAction}</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-[#D5D9DF] bg-gray-50 flex items-center justify-between gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleLoadFictionalDemo}
                className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold cursor-pointer"
              >
                Load Fictional Demo Preset
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPolicyModal(false)}
                  className="px-3 py-2 bg-white border border-[#D5D9DF] hover:bg-gray-100 text-gray-700 rounded text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveModalRuleEdits}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
