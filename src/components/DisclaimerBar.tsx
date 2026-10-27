/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { STRINGS } from '../strings.ts';

export const DisclaimerBar: React.FC = () => {
  return (
    <aside
      aria-label="Important project disclaimer"
      className="fixed bottom-0 left-0 right-0 z-50 bg-[#1A1A1A] text-white border-t border-[#333333] px-4 py-2.5 shadow-lg"
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between text-xs sm:text-sm gap-2">
        <p className="leading-tight text-center sm:text-left text-gray-200">
          <strong className="text-white font-semibold">DustWatch:</strong> {STRINGS.disclaimer.barText}
        </p>
        <a
          href={STRINGS.disclaimer.ncmUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-blue-300 hover:text-blue-100 underline focus-visible:ring-2 focus-visible:ring-blue-400 rounded px-1 py-0.5 text-xs font-medium"
        >
          {STRINGS.disclaimer.ncmLinkLabel} &rarr;
        </a>
      </div>
    </aside>
  );
};
