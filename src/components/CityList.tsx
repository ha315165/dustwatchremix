/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { APP_CONFIG, CITIES } from '../config.ts';
import { CityOutlook, RiskCategory } from '../types.ts';

interface CityListProps {
  outlooks: Record<string, CityOutlook>;
  selectedCityId: string;
  onSelectCity: (cityId: string) => void;
  viewMode: 'highest12h' | 'now';
}

export const CityList: React.FC<CityListProps> = ({
  outlooks,
  selectedCityId,
  onSelectCity,
  viewMode,
}) => {
  return (
    <div className="bg-white border border-[#D5D9DF] rounded-lg p-3 shadow-sm">
      <h2 className="text-sm font-bold text-[#1A1A1A] mb-2 px-1 flex items-center justify-between">
        <span>UAE Locations</span>
        <span className="text-xs font-normal text-[#4A4F57]">
          {viewMode === 'highest12h' ? '12h Peak Risk' : 'Current Risk'}
        </span>
      </h2>

      <div className="grid grid-cols-2 gap-2">
        {CITIES.map((city) => {
          const outlook = outlooks[city.id];
          const category: RiskCategory = outlook
            ? viewMode === 'highest12h'
              ? outlook.peakLevel
              : outlook.levelNow
            : 'Low';

          const score = outlook
            ? viewMode === 'highest12h'
              ? outlook.peakScore
            : outlook.scoreNow
            : 0;

          const colorCfg = APP_CONFIG.colors[category];
          const isSelected = city.id === selectedCityId;

          return (
            <button
              key={city.id}
              type="button"
              onClick={() => onSelectCity(city.id)}
              aria-pressed={isSelected}
              className={`w-full text-left px-3 py-2.5 rounded-md flex items-center justify-between transition-colors min-h-[44px] cursor-pointer ${
                isSelected
                  ? 'bg-blue-50 border-2 border-[#1A56DB] shadow-xs'
                  : 'border border-transparent hover:bg-gray-100 hover:border-gray-200'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  style={{ backgroundColor: colorCfg.bg, color: colorCfg.text }}
                  className="w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0"
                  aria-hidden="true"
                >
                  {colorCfg.abbr}
                </span>
                <span className="font-semibold text-sm text-[#1A1A1A] truncate">
                  {city.name}
                </span>
              </div>

              {/* Text badge with full risk word and score */}
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                <span
                  style={{
                    backgroundColor: colorCfg.badgeBg,
                    color: colorCfg.badgeText,
                    borderColor: colorCfg.border,
                  }}
                  className="text-xs px-2 py-0.5 rounded font-semibold border"
                >
                  {colorCfg.label}
                </span>
                <span className="text-xs text-[#4A4F57] w-6 text-right font-mono">
                  {Math.round(score)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
