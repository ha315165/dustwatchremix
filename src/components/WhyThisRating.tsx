/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertCircle, Cpu, Info, ShieldAlert } from 'lucide-react';
import { STRINGS } from '../strings.ts';
import { HourlyRiskResult, ModelFileConfig } from '../types.ts';

interface WhyThisRatingProps {
  selectedHour: HourlyRiskResult;
  activeModelInfo?: {
    name: string;
    version: string;
    trainedDate: string;
  };
}

export const WhyThisRating: React.FC<WhyThisRatingProps> = ({
  selectedHour,
  activeModelInfo,
}) => {
  const subScores = selectedHour.subScores;
  const scoredFactorKeys = Object.keys(subScores);

  const getStatusBadge = (status: 'low' | 'moderate' | 'high' | 'missing') => {
    switch (status) {
      case 'high':
        return <span className="text-[10px] bg-red-100 text-red-800 font-semibold px-1.5 py-0.2 rounded border border-red-200">High</span>;
      case 'moderate':
        return <span className="text-[10px] bg-amber-100 text-amber-800 font-semibold px-1.5 py-0.2 rounded border border-amber-200">Moderate</span>;
      case 'low':
        return <span className="text-[10px] bg-emerald-100 text-emerald-800 font-semibold px-1.5 py-0.2 rounded border border-emerald-200">Low</span>;
      case 'missing':
        return <span className="text-[10px] bg-gray-100 text-gray-700 font-semibold px-1.5 py-0.2 rounded border border-gray-300">Missing</span>;
    }
  };

  return (
    <div className="bg-white border border-[#D5D9DF] rounded-lg p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-sm text-[#1A1A1A]">
          {STRINGS.whyThisRating.title}
        </h3>
        <span className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
          {selectedHour.displayHour}
        </span>
      </div>

      <p className="text-xs text-[#4A4F57] mb-3">
        {STRINGS.whyThisRating.hourSubtitle(selectedHour.displayHour)}
      </p>

      {/* Active Mode Banner */}
      <div className="mb-3 p-2.5 rounded-md bg-gray-50 border border-[#D5D9DF] text-xs text-[#1A1A1A] flex items-start gap-2">
        <Cpu className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
        <div>
          {activeModelInfo ? (
            <span className="font-medium">
              {STRINGS.whyThisRating.activeModeModel(
                activeModelInfo.name,
                activeModelInfo.version,
                activeModelInfo.trainedDate
              )}
            </span>
          ) : (
            <span className="font-medium text-[#4A4F57]">
              {STRINGS.whyThisRating.activeModeBaseline}
            </span>
          )}
        </div>
      </div>

      {/* When trained model is active, show comparison next to baseline */}
      {selectedHour.modelScore !== undefined && (
        <div className="mb-3 p-2.5 rounded-md bg-blue-50 border border-blue-200 text-xs text-blue-950">
          <div className="font-semibold mb-1">{STRINGS.whyThisRating.comparisonTitle}</div>
          <p>
            {STRINGS.whyThisRating.baselineComparison(
              selectedHour.baselineCategory,
              Math.round(selectedHour.baselineScore),
              selectedHour.category,
              Math.round(selectedHour.finalScore)
            )}
          </p>
        </div>
      )}

      {/* Particle cap notice if active */}
      {selectedHour.isParticleCapped && (
        <div className="mb-3 p-2.5 rounded-md bg-amber-50 border border-amber-300 text-xs text-amber-900 flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p>{STRINGS.whyThisRating.particleCapNotice}</p>
        </div>
      )}

      {/* Missing variables warning */}
      {selectedHour.missingVariables.length > 0 && (
        <div className="mb-3 p-2.5 rounded-md bg-red-50 border border-red-200 text-xs text-red-900 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">{STRINGS.whyThisRating.missingDataWarning}: </span>
            <span>{selectedHour.missingVariables.join(', ')} (confidence lowered)</span>
          </div>
        </div>
      )}

      {/* Scored factors list */}
      <div className="mb-3">
        <div className="text-xs font-semibold text-[#4A4F57] uppercase tracking-wider mb-2">
          {STRINGS.whyThisRating.scoredFactors}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {scoredFactorKeys.map((key) => {
            const factor = subScores[key];
            if (!factor) return null;

            return (
              <div
                key={key}
                className="flex items-center justify-between p-2 rounded bg-gray-50 border border-gray-100"
              >
                <div>
                  <div className="font-medium text-[#1A1A1A]">{factor.displayName}</div>
                  <div className="text-[11px] text-[#4A4F57]">
                    {factor.rawValue !== null
                      ? `${factor.rawValue} ${factor.unit}`
                      : 'Missing (null)'}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {getStatusBadge(factor.status)}
                  {factor.subScore !== null && (
                    <span className="font-mono text-[11px] text-gray-500 w-6 text-right">
                      {Math.round(factor.subScore)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Contextual factors (PM2.5, Temperature) */}
      <div className="mb-3 pt-2 border-t border-gray-100">
        <div className="text-xs font-semibold text-[#4A4F57] uppercase tracking-wider mb-1.5">
          {STRINGS.whyThisRating.contextFactors}
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2 rounded bg-gray-50 border border-gray-100 flex justify-between">
            <span className="text-[#4A4F57]">PM2.5 particles:</span>
            <span className="font-medium text-[#1A1A1A]">
              {selectedHour.contextVariables.pm2_5.value !== null
                ? `${selectedHour.contextVariables.pm2_5.value} ${selectedHour.contextVariables.pm2_5.unit}`
                : 'n/a'}
            </span>
          </div>
          <div className="p-2 rounded bg-gray-50 border border-gray-100 flex justify-between">
            <span className="text-[#4A4F57]">Air Temperature:</span>
            <span className="font-medium text-[#1A1A1A]">
              {selectedHour.contextVariables.temperature_2m.value !== null
                ? `${selectedHour.contextVariables.temperature_2m.value} ${selectedHour.contextVariables.temperature_2m.unit}`
                : 'n/a'}
            </span>
          </div>
        </div>
      </div>

      {/* Top contributors */}
      {selectedHour.topContributors.length > 0 && (
        <div className="mb-3 text-xs text-[#4A4F57]">
          <span className="font-semibold text-[#1A1A1A]">
            {STRINGS.whyThisRating.topContributors}:{' '}
          </span>
          <span>{selectedHour.topContributors.join('; ')}</span>
        </div>
      )}

      {/* Scientific Caution */}
      <div className="p-2.5 rounded-md bg-blue-50/50 border border-blue-100 text-xs text-[#1A1A1A] flex items-start gap-2">
        <Info className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
        <p className="leading-relaxed italic">{STRINGS.whyThisRating.scientificCaution}</p>
      </div>
    </div>
  );
};
