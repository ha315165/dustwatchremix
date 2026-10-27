/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { APP_CONFIG } from '../config.ts';
import { STRINGS } from '../strings.ts';

interface FooterProps {
  onSelectScreen: (screen: 'map' | 'school-mode' | 'how-it-works' | 'accuracy' | 'test-view') => void;
  activeScreen: string;
}

export const Footer: React.FC<FooterProps> = ({ onSelectScreen, activeScreen }) => {
  return (
    <footer className="border-t border-[#D5D9DF] bg-white py-6 pb-20 px-4 mt-12 text-xs text-[#4A4F57]">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <p className="font-semibold text-[#1A1A1A]">
            {STRINGS.app.title} &bull; {STRINGS.app.badge}
          </p>
          <p className="text-[11px] text-[#4A4F57] mt-0.5">
            {STRINGS.panel.dataSources}
          </p>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <a
            href={STRINGS.disclaimer.ncmUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline text-blue-700 font-medium"
          >
            {STRINGS.disclaimer.ncmLinkLabel}
          </a>

          {/* Test view link (hidden if config.showTestViewLink is false) */}
          {APP_CONFIG.showTestViewLink && (
            <button
              type="button"
              onClick={() => onSelectScreen(activeScreen === 'test-view' ? 'map' : 'test-view')}
              className="hover:underline text-purple-700 font-semibold cursor-pointer"
            >
              {activeScreen === 'test-view' ? 'Close Test view' : STRINGS.nav.testView}
            </button>
          )}
        </div>
      </div>
    </footer>
  );
};
