/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { ExternalLink, ShieldCheck, Clock, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';
import { APP_CONFIG, CITIES } from '../config.ts';
import { STRINGS } from '../strings.ts';
import { CityOutlook, HourlyRiskResult } from '../types.ts';
import { UaeMap } from './UaeMap.tsx';
import { CityList } from './CityList.tsx';
import { TimelineChart } from './TimelineChart.tsx';
import { AdvicePanel } from './AdvicePanel.tsx';
import { WhyThisRating } from './WhyThisRating.tsx';

interface MapScreenProps {
  outlooks: Record<string, CityOutlook>;
  selectedCityId: string;
  onSelectCity: (cityId: string) => void;
  lastUpdatedFormatted: string;
}

export const MapScreen: React.FC<MapScreenProps> = ({
  outlooks,
  selectedCityId,
  onSelectCity,
  lastUpdatedFormatted,
}) => {
  const [viewMode, setViewMode] = useState<'highest12h' | 'now'>('highest12h');

  // Currently selected city outlook
  const currentOutlook = outlooks[selectedCityId] || outlooks[APP_CONFIG.defaultSelectedCityId];

  // Selected hour index within the 12-hour outlook
  // Default to the peak hour as required: "By default the hour with the highest score is selected"
  const [selectedHourIndex, setSelectedHourIndex] = useState<number>(0);

  useEffect(() => {
    if (currentOutlook) {
      setSelectedHourIndex(currentOutlook.peakHourIndex);
    }
  }, [currentOutlook?.city.id, currentOutlook?.peakHourIndex]);

  if (!currentOutlook) {
    return (
      <div className="p-8 text-center text-[#4A4F57]">
        Loading UAE DustWatch telemetry...
      </div>
    );
  }

  const selectedHourResult: HourlyRiskResult =
    currentOutlook.hourlyResults[selectedHourIndex] || currentOutlook.hourlyResults[0];

  const levelNowCfg = APP_CONFIG.colors[currentOutlook.levelNow];
  const peakLevelCfg = APP_CONFIG.colors[currentOutlook.peakLevel];

  const getConfidenceBadgeColor = (conf: 'Low' | 'Medium' | 'High') => {
    switch (conf) {
      case 'High':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'Medium':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'Low':
        return 'bg-red-100 text-red-800 border-red-300';
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Toggle above the map */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white border border-[#D5D9DF] rounded-lg p-3 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-[#4A4F57]">
            Map View Display:
          </span>
          <div
            role="radiogroup"
            aria-label="Map Outlook Display Toggle"
            className="inline-flex rounded-md shadow-xs bg-gray-100 p-0.5 border border-[#D5D9DF]"
          >
            <button
              type="button"
              role="radio"
              aria-checked={viewMode === 'highest12h'}
              onClick={() => setViewMode('highest12h')}
              className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors cursor-pointer min-h-[38px] ${
                viewMode === 'highest12h'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-[#4A4F57] hover:text-[#1A1A1A]'
              }`}
            >
              {STRINGS.toggles.highest12h}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={viewMode === 'now'}
              onClick={() => setViewMode('now')}
              className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors cursor-pointer min-h-[38px] ${
                viewMode === 'now'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-[#4A4F57] hover:text-[#1A1A1A]'
              }`}
            >
              {STRINGS.toggles.now}
            </button>
          </div>
        </div>

        <div className="text-xs text-[#4A4F57] flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          <span>{STRINGS.toggles.lastUpdated(lastUpdatedFormatted)}</span>
        </div>
      </div>

      {/* Main Grid: Left Map + City List (Desktop), Right Side Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Map & City List (7 cols on lg) */}
        <div className="lg:col-span-7 space-y-4">
          <UaeMap
            outlooks={outlooks}
            selectedCityId={selectedCityId}
            onSelectCity={onSelectCity}
            viewMode={viewMode}
          />

          <CityList
            outlooks={outlooks}
            selectedCityId={selectedCityId}
            onSelectCity={onSelectCity}
            viewMode={viewMode}
          />
        </div>

        {/* Right Column: Selected City Detailed Panel (5 cols on lg) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Main City Summary Card */}
          <div className="bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs uppercase tracking-wider font-semibold text-[#4A4F57]">
                  Selected City
                </span>
                <h2 className="text-2xl font-bold text-[#1A1A1A]">
                  {currentOutlook.city.name}
                </h2>
              </div>

              {/* Confidence Badge & Reasons */}
              <div className="text-right">
                <div className="text-[11px] text-[#4A4F57] mb-0.5">
                  {STRINGS.panel.confidence}
                </div>
                <span
                  className={`inline-block px-2.5 py-0.5 rounded text-xs font-bold border ${getConfidenceBadgeColor(
                    currentOutlook.confidence
                  )}`}
                >
                  {currentOutlook.confidence} Confidence
                </span>
              </div>
            </div>

            {/* Confidence explanation reasons */}
            {currentOutlook.confidenceReasons.length > 0 && (
              <div className="bg-gray-50 border border-gray-200 rounded-md p-2.5 text-xs text-[#4A4F57] space-y-1">
                <div className="font-semibold text-[#1A1A1A] flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-gray-600" />
                  <span>Confidence Factors:</span>
                </div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {currentOutlook.confidenceReasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Quick Metrics: Risk Now vs Highest in next 12h */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
              <div className="bg-[#F6F7F9] p-3 rounded-lg border border-[#D5D9DF]">
                <div className="text-xs text-[#4A4F57] font-medium mb-1">
                  {STRINGS.panel.riskNow}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    style={{
                      backgroundColor: levelNowCfg.badgeBg,
                      color: levelNowCfg.badgeText,
                      borderColor: levelNowCfg.border,
                    }}
                    className="px-2.5 py-0.5 rounded font-bold text-sm border"
                  >
                    {levelNowCfg.label}
                  </span>
                  <span className="text-xs text-[#4A4F57] font-mono">
                    ({Math.round(currentOutlook.scoreNow)})
                  </span>
                </div>
              </div>

              <div className="bg-[#F6F7F9] p-3 rounded-lg border border-[#D5D9DF]">
                <div className="text-xs text-[#4A4F57] font-medium mb-1">
                  {STRINGS.panel.highestNext12h}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    style={{
                      backgroundColor: peakLevelCfg.badgeBg,
                      color: peakLevelCfg.badgeText,
                      borderColor: peakLevelCfg.border,
                    }}
                    className="px-2.5 py-0.5 rounded font-bold text-sm border"
                  >
                    {peakLevelCfg.label}
                  </span>
                  <span className="text-xs text-[#4A4F57]">
                    {STRINGS.panel.atHour(currentOutlook.peakHourTime)}
                  </span>
                </div>
              </div>
            </div>

            {/* Best and Worst 3-Hour Windows */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-gray-100">
              <div className="p-2.5 rounded-md border border-emerald-200 bg-emerald-50/50">
                <div className="text-xs font-semibold text-emerald-900 flex items-center gap-1 mb-1">
                  <TrendingDown className="w-3.5 h-3.5 text-emerald-700" />
                  <span>{STRINGS.panel.bestWindow}</span>
                </div>
                <div className="text-sm font-bold text-[#1A1A1A]">
                  {currentOutlook.bestWindow.displayRange}
                </div>
                <div className="text-xs text-[#4A4F57] mt-0.5">
                  Est. {currentOutlook.bestWindow.level} (avg score {currentOutlook.bestWindow.averageScore})
                </div>
              </div>

              <div className="p-2.5 rounded-md border border-amber-200 bg-amber-50/50">
                <div className="text-xs font-semibold text-amber-900 flex items-center gap-1 mb-1">
                  <TrendingUp className="w-3.5 h-3.5 text-amber-700" />
                  <span>{STRINGS.panel.worstWindow}</span>
                </div>
                <div className="text-sm font-bold text-[#1A1A1A]">
                  {currentOutlook.worstWindow.displayRange}
                </div>
                <div className="text-xs text-[#4A4F57] mt-0.5">
                  Est. {currentOutlook.worstWindow.level} (avg score {currentOutlook.worstWindow.averageScore})
                </div>
              </div>
            </div>
          </div>

          {/* 12-Hour Timeline */}
          <TimelineChart
            hourlyResults={currentOutlook.hourlyResults}
            selectedHourIndex={selectedHourIndex}
            onSelectHour={setSelectedHourIndex}
          />

          {/* Audience Advice Tabs */}
          <AdvicePanel outlook={currentOutlook} />

          {/* "Why This Rating" Box */}
          <WhyThisRating
            selectedHour={selectedHourResult}
            activeModelInfo={currentOutlook.activeModelInfo}
          />

          {/* Satellite Imagery Link */}
          <div className="bg-white border border-[#D5D9DF] rounded-lg p-3.5 shadow-xs flex items-center justify-between text-xs">
            <div>
              <a
                href={STRINGS.panel.satelliteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-blue-700 hover:text-blue-900 underline flex items-center gap-1 text-sm"
              >
                <span>{STRINGS.panel.satelliteLink}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <p className="text-[#4A4F57] mt-0.5">{STRINGS.panel.satelliteNote}</p>
            </div>
          </div>

          {/* Panel Footer: Data sources & Last updated */}
          <div className="text-xs text-[#4A4F57] px-1 py-2 space-y-1">
            <p>{STRINGS.panel.dataSources}</p>
            <p>{STRINGS.toggles.lastUpdated(currentOutlook.fetchTime)}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
