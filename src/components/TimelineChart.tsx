/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { BarChart3, Table as TableIcon } from 'lucide-react';
import { APP_CONFIG } from '../config.ts';
import { STRINGS } from '../strings.ts';
import { HourlyRiskResult } from '../types.ts';

interface TimelineChartProps {
  hourlyResults: HourlyRiskResult[];
  selectedHourIndex: number;
  onSelectHour: (index: number) => void;
}

export const TimelineChart: React.FC<TimelineChartProps> = ({
  hourlyResults,
  selectedHourIndex,
  onSelectHour,
}) => {
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');

  if (!hourlyResults || hourlyResults.length === 0) {
    return null;
  }

  return (
    <div className="bg-white border border-[#D5D9DF] rounded-lg p-4 shadow-sm">
      {/* Header with Table / Chart toggle */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-bold text-sm text-[#1A1A1A]">
            {STRINGS.panel.timelineTitle}
          </h3>
          <p className="text-xs text-[#4A4F57]">
            Select any hour to view detailed factor breakdown
          </p>
        </div>

        <div className="flex items-center bg-gray-100 p-0.5 rounded-md border border-[#D5D9DF]">
          <button
            type="button"
            onClick={() => setViewMode('chart')}
            className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 transition-colors ${
              viewMode === 'chart'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-[#4A4F57] hover:text-[#1A1A1A]'
            }`}
            aria-label={STRINGS.panel.showAsChart}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{STRINGS.panel.showAsChart}</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 transition-colors ${
              viewMode === 'table'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-[#4A4F57] hover:text-[#1A1A1A]'
            }`}
            aria-label={STRINGS.panel.showAsTable}
          >
            <TableIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{STRINGS.panel.showAsTable}</span>
          </button>
        </div>
      </div>

      {viewMode === 'chart' ? (
        /* Accessible Interactive Bar Chart */
        <div
          role="region"
          aria-label="12-hour risk timeline bar chart"
          className="pt-2 pb-1"
        >
          <div className="flex items-end justify-between gap-1 sm:gap-2 h-44 border-b border-[#D5D9DF] px-1">
            {hourlyResults.map((hourRes, idx) => {
              const isSelected = idx === selectedHourIndex;
              const colorCfg = APP_CONFIG.colors[hourRes.category];
              // Minimum height of 8% so 0 score bars are still visible and clickable
              const heightPct = Math.max(8, Math.round(hourRes.finalScore));

              return (
                <button
                  key={hourRes.hourIndex}
                  type="button"
                  onClick={() => onSelectHour(idx)}
                  aria-pressed={isSelected}
                  aria-label={`Hour ${hourRes.displayHour}, Risk ${hourRes.category}, Score ${Math.round(hourRes.finalScore)}`}
                  className={`flex-1 flex flex-col items-center justify-end h-full group focus:outline-none cursor-pointer relative transition-all ${
                    isSelected ? 'z-10' : ''
                  }`}
                >
                  {/* Score tooltip or label above bar on hover / selection */}
                  <span
                    className={`text-[10px] sm:text-xs font-mono font-bold mb-1 transition-opacity ${
                      isSelected
                        ? 'opacity-100 text-blue-800'
                        : 'opacity-70 group-hover:opacity-100 text-[#4A4F57]'
                    }`}
                  >
                    {Math.round(hourRes.finalScore)}
                  </span>

                  {/* Bar element */}
                  <div
                    style={{
                      height: `${heightPct}%`,
                      backgroundColor: colorCfg.bg,
                    }}
                    className={`w-full rounded-t-sm transition-all ${
                      isSelected
                        ? 'ring-3 ring-[#1A56DB] brightness-110 shadow-sm'
                        : 'hover:brightness-95 opacity-90'
                    }`}
                  />
                </button>
              );
            })}
          </div>

          {/* Hour and Level Labels row */}
          <div className="flex items-start justify-between gap-1 sm:gap-2 mt-2 px-1 text-center">
            {hourlyResults.map((hourRes, idx) => {
              const isSelected = idx === selectedHourIndex;
              const colorCfg = APP_CONFIG.colors[hourRes.category];

              return (
                <button
                  key={hourRes.hourIndex}
                  type="button"
                  onClick={() => onSelectHour(idx)}
                  className={`flex-1 flex flex-col items-center cursor-pointer p-0.5 rounded ${
                    isSelected ? 'bg-blue-50 font-bold' : 'hover:bg-gray-100'
                  }`}
                  aria-label={`Select ${hourRes.displayHour}`}
                >
                  <span className="text-[11px] sm:text-xs text-[#1A1A1A]">
                    {hourRes.displayHour}
                  </span>
                  <span
                    style={{ color: colorCfg.badgeText }}
                    className="text-[10px] font-semibold"
                  >
                    {colorCfg.abbr}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* Accessible Table Alternative */
        <div className="overflow-x-auto max-h-64 border border-[#D5D9DF] rounded-md">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-gray-50 border-b border-[#D5D9DF] text-[#4A4F57]">
              <tr>
                <th className="py-2 px-3 font-semibold">{STRINGS.panel.hourCol}</th>
                <th className="py-2 px-3 font-semibold">{STRINGS.panel.riskCol}</th>
                <th className="py-2 px-3 font-semibold">{STRINGS.panel.scoreCol}</th>
                <th className="py-2 px-3 font-semibold">{STRINGS.panel.keyFactorsCol}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#D5D9DF]">
              {hourlyResults.map((hourRes, idx) => {
                const isSelected = idx === selectedHourIndex;
                const colorCfg = APP_CONFIG.colors[hourRes.category];

                return (
                  <tr
                    key={hourRes.hourIndex}
                    onClick={() => onSelectHour(idx)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50 font-semibold' : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="py-2 px-3 text-[#1A1A1A]">{hourRes.displayHour}</td>
                    <td className="py-2 px-3">
                      <span
                        style={{
                          backgroundColor: colorCfg.badgeBg,
                          color: colorCfg.badgeText,
                          borderColor: colorCfg.border,
                        }}
                        className="px-2 py-0.5 rounded text-xs font-semibold border"
                      >
                        {colorCfg.label}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono text-[#1A1A1A]">
                      {Math.round(hourRes.finalScore)}
                    </td>
                    <td className="py-2 px-3 text-[#4A4F57] text-xs">
                      {hourRes.topContributors.join(', ') || 'Normal'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
