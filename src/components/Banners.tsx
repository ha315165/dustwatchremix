/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertTriangle, Database, Info } from 'lucide-react';
import { DataFetchStatus } from '../dataService.ts';

interface BannersProps {
  status: DataFetchStatus;
}

export const Banners: React.FC<BannersProps> = ({ status }) => {
  if (!status.activeBanner && !status.isDemoMode && !status.isError) {
    return null;
  }

  // Determine styling based on banner type
  const banner = status.activeBanner;
  if (!banner) return null;

  let bgClass = 'bg-amber-50 border-amber-300 text-amber-900';
  let Icon = AlertTriangle;

  if (banner.type === 'sample' || banner.type === 'demo') {
    bgClass = 'bg-blue-50 border-blue-300 text-blue-900';
    Icon = Database;
  } else if (banner.type === 'cached') {
    bgClass = 'bg-amber-50 border-amber-300 text-amber-900';
    Icon = AlertTriangle;
  } else if (banner.type === 'snapshot') {
    bgClass = 'bg-purple-50 border-purple-300 text-purple-900';
    Icon = Info;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`border-b px-4 py-2.5 flex items-center justify-between text-sm ${bgClass}`}
    >
      <div className="max-w-7xl mx-auto w-full flex items-center gap-2">
        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className="font-medium">{banner.message}</span>
      </div>
    </div>
  );
};
