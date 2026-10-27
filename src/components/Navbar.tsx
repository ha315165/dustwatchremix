/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { GraduationCap, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import { STRINGS } from '../strings.ts';

interface NavbarProps {
  activeScreen: 'map' | 'school-mode' | 'how-it-works' | 'accuracy' | 'test-view';
  onSelectScreen: (screen: 'map' | 'school-mode' | 'how-it-works' | 'accuracy' | 'test-view') => void;
  isDemoMode: boolean;
  onToggleDemoMode: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  lastUpdated: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeScreen,
  onSelectScreen,
  isDemoMode,
  onToggleDemoMode,
  onRefresh,
  isRefreshing,
  lastUpdated,
}) => {
  return (
    <header className="bg-white border-b border-[#D5D9DF] sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        {/* Brand & Tagline */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onSelectScreen('map')}
              className="text-left group cursor-pointer focus:outline-none"
              aria-label="DustWatch Home"
            >
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold tracking-tight text-[#1A1A1A] group-hover:text-blue-700 transition-colors">
                  {STRINGS.app.title}
                </span>
                <span className="text-xs bg-amber-100 text-amber-900 border border-amber-300 rounded px-1.5 py-0.5 font-medium">
                  {STRINGS.app.badge}
                </span>
              </div>
              <p className="text-xs text-[#4A4F57] hidden sm:block">
                {STRINGS.app.subtitle}
              </p>
            </button>
          </div>

          {/* Quick mobile refresh button */}
          <div className="flex items-center gap-2 md:hidden">
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              aria-label={STRINGS.toggles.refresh}
              className="p-2 border border-[#D5D9DF] rounded-md text-[#1A1A1A] hover:bg-gray-100 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav aria-label="Main navigation" className="flex items-center gap-1 overflow-x-auto py-1">
          <button
            type="button"
            onClick={() => onSelectScreen('map')}
            className={`px-3 py-2 rounded-md text-sm font-semibold whitespace-nowrap transition-colors min-h-[44px] ${
              activeScreen === 'map'
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'text-[#4A4F57] hover:text-[#1A1A1A] hover:bg-gray-100'
            }`}
            aria-current={activeScreen === 'map' ? 'page' : undefined}
          >
            {STRINGS.nav.map}
          </button>
          <button
            type="button"
            onClick={() => onSelectScreen('school-mode')}
            className={`px-3 py-2 rounded-md text-sm font-semibold whitespace-nowrap transition-colors min-h-[44px] flex items-center gap-1.5 ${
              activeScreen === 'school-mode'
                ? 'bg-amber-50 text-amber-900 border border-amber-300 shadow-xs'
                : 'text-[#4A4F57] hover:text-[#1A1A1A] hover:bg-gray-100'
            }`}
            aria-current={activeScreen === 'school-mode' ? 'page' : undefined}
          >
            <GraduationCap className="w-4 h-4 text-amber-700" />
            <span>{STRINGS.nav.schoolMode}</span>
          </button>
          <button
            type="button"
            onClick={() => onSelectScreen('how-it-works')}
            className={`px-3 py-2 rounded-md text-sm font-semibold whitespace-nowrap transition-colors min-h-[44px] ${
              activeScreen === 'how-it-works'
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'text-[#4A4F57] hover:text-[#1A1A1A] hover:bg-gray-100'
            }`}
            aria-current={activeScreen === 'how-it-works' ? 'page' : undefined}
          >
            {STRINGS.nav.howItWorks}
          </button>
          <button
            type="button"
            onClick={() => onSelectScreen('accuracy')}
            className={`px-3 py-2 rounded-md text-sm font-semibold whitespace-nowrap transition-colors min-h-[44px] ${
              activeScreen === 'accuracy'
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'text-[#4A4F57] hover:text-[#1A1A1A] hover:bg-gray-100'
            }`}
            aria-current={activeScreen === 'accuracy' ? 'page' : undefined}
          >
            {STRINGS.nav.accuracy}
          </button>
        </nav>

        {/* Right side controls: Demo Mode switch & Refresh button */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Demo mode toggle switch */}
          <label className="flex items-center gap-2 cursor-pointer bg-gray-50 border border-[#D5D9DF] px-2.5 py-1.5 rounded-md min-h-[44px]">
            <input
              type="checkbox"
              checked={isDemoMode}
              onChange={onToggleDemoMode}
              className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
              aria-label={STRINGS.toggles.demoMode}
            />
            <span className="text-xs font-medium text-[#1A1A1A] select-none">
              {STRINGS.toggles.demoMode}
            </span>
          </label>

          {/* Desktop Refresh button */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-[#D5D9DF] text-[#1A1A1A] rounded-md text-sm font-medium hover:bg-gray-50 disabled:opacity-50 min-h-[44px]"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
            <span>{isRefreshing ? STRINGS.toggles.refreshing : STRINGS.toggles.refresh}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
