/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  ArrowRight,
  Database,
  Calculator,
  ShieldCheck,
  MessageSquare,
  AlertTriangle,
  Info,
  ExternalLink,
  BookOpen,
  GraduationCap,
  Thermometer,
  Layers,
} from 'lucide-react';
import { APP_CONFIG } from '../config.ts';
import { STRINGS } from '../strings.ts';

export const HowItWorksScreen: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-[#1A1A1A]">
          {STRINGS.howItWorks.title}
        </h1>
        <p className="text-sm text-[#4A4F57] mt-1">
          {STRINGS.howItWorks.subtitle}
        </p>
      </div>

      {/* 1. Visual Flow Diagram (Boxes & Arrows, stacks on mobile) */}
      <section aria-labelledby="flow-heading" className="bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-sm">
        <h2 id="flow-heading" className="text-base font-bold text-[#1A1A1A] mb-4">
          Pipeline Flow Architecture
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-stretch">
          {/* Step 1 */}
          <div className="p-4 rounded-lg bg-blue-50/60 border border-blue-200 flex flex-col justify-between">
            <div>
              <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-sm mb-2">
                1
              </div>
              <h3 className="font-bold text-sm text-[#1A1A1A] mb-1">
                {STRINGS.howItWorks.flow.step1Title}
              </h3>
              <p className="text-xs text-[#4A4F57] leading-relaxed">
                {STRINGS.howItWorks.flow.step1Desc}
              </p>
            </div>
            <div className="hidden md:flex justify-end pt-2 text-blue-400">
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>

          {/* Step 2 */}
          <div className="p-4 rounded-lg bg-amber-50/60 border border-amber-200 flex flex-col justify-between">
            <div>
              <div className="w-8 h-8 rounded-full bg-amber-600 text-white font-bold flex items-center justify-center text-sm mb-2">
                2
              </div>
              <h3 className="font-bold text-sm text-[#1A1A1A] mb-1">
                {STRINGS.howItWorks.flow.step2Title}
              </h3>
              <p className="text-xs text-[#4A4F57] leading-relaxed">
                {STRINGS.howItWorks.flow.step2Desc}
              </p>
            </div>
            <div className="hidden md:flex justify-end pt-2 text-amber-400">
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>

          {/* Step 3 */}
          <div className="p-4 rounded-lg bg-purple-50/60 border border-purple-200 flex flex-col justify-between">
            <div>
              <div className="w-8 h-8 rounded-full bg-purple-600 text-white font-bold flex items-center justify-center text-sm mb-2">
                3
              </div>
              <h3 className="font-bold text-sm text-[#1A1A1A] mb-1">
                {STRINGS.howItWorks.flow.step3Title}
              </h3>
              <p className="text-xs text-[#4A4F57] leading-relaxed">
                {STRINGS.howItWorks.flow.step3Desc}
              </p>
            </div>
            <div className="hidden md:flex justify-end pt-2 text-purple-400">
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>

          {/* Step 4 */}
          <div className="p-4 rounded-lg bg-emerald-50/60 border border-emerald-200 flex flex-col justify-between">
            <div>
              <div className="w-8 h-8 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center text-sm mb-2">
                4
              </div>
              <h3 className="font-bold text-sm text-[#1A1A1A] mb-1">
                {STRINGS.howItWorks.flow.step4Title}
              </h3>
              <p className="text-xs text-[#4A4F57] leading-relaxed">
                {STRINGS.howItWorks.flow.step4Desc}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Dust Event Definition Box */}
      <section className="bg-amber-50 border border-amber-300 rounded-lg p-5 shadow-xs space-y-3">
        <div className="flex items-start gap-2.5">
          <BookOpen className="w-5 h-5 text-amber-800 shrink-0 mt-0.5" />
          <div className="space-y-2 w-full">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-base font-bold text-amber-950">
                {STRINGS.howItWorks.eventDefTitle}
              </h2>
              <span className="text-xs bg-amber-200 text-amber-900 px-2 py-0.5 rounded font-semibold border border-amber-300">
                {APP_CONFIG.eventDefinitionStatus}
              </span>
            </div>

            <p className="text-sm text-amber-900 font-mono bg-white/70 p-3 rounded border border-amber-200">
              {APP_CONFIG.eventDefinitionText}
            </p>

            <div className="text-xs text-amber-900 space-y-1">
              <p className="font-medium text-amber-950">
                {APP_CONFIG.eventDefinitionDataSource}
              </p>
              <p className="p-2 bg-amber-100/70 border border-amber-300 rounded font-semibold text-amber-950">
                {APP_CONFIG.eventDefinitionCircularWarning}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2b. Dedicated School Mode & Nurse Decision Support Architecture */}
      <section className="bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-sm space-y-4">
        <h2 className="text-base font-bold text-[#1A1A1A] flex items-center gap-2">
          <GraduationCap className="w-5 h-5 text-amber-700" />
          <span>School Mode: Architecture & Nurse Decision Support</span>
        </h2>
        <p className="text-sm text-[#1A1A1A] leading-relaxed">
          Developed in consultation with UAE school nurses and health coordinators, School Mode introduces a dedicated decision-support workflow for outdoor recess and Physical Education (PE).
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="p-3.5 rounded-lg bg-blue-50/70 border border-blue-200 space-y-2">
            <h3 className="font-bold text-sm text-blue-950 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-blue-700" />
              <span>Strict Separation of Concerns & Humidity Usage</span>
            </h3>
            <p className="text-[#333] leading-relaxed">
              <strong>Regional Dust Risk:</strong> A 0–100 atmospheric risk index (Low, Moderate, High, Very High) derived from particulate concentrations, wind dynamics, and relative humidity.
            </p>
            <p className="text-[#333] leading-relaxed">
              <strong>Humidity in Dust Score:</strong> Relative humidity IS used in the regional dust score with a 5% weighting (low humidity contributes to higher dust risk because arid ground and dry air facilitate particle lofting). Temperature is NOT used in the dust score.
            </p>
            <p className="text-[#333] leading-relaxed">
              <strong>School Policy Evaluation:</strong> A separate evaluation engine that compares multiple environmental parameters (Heat Index, PM10, PM2.5, wind gusts, visibility) against school-approved thresholds for specific student activity types.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-amber-50/70 border border-amber-200 space-y-2">
            <h3 className="font-bold text-sm text-amber-950 flex items-center gap-1.5">
              <Thermometer className="w-4 h-4 text-amber-700" />
              <span>NOAA Steadman Heat Index</span>
            </h3>
            <p className="text-[#333] leading-relaxed">
              Calculated using the official NOAA/NWS Steadman regression formula combining dry-bulb ambient temperature and relative humidity.
            </p>
            <p className="text-[#333] leading-relaxed">
              Categorised into five standardized brackets (NWS general reference, not school policy): <strong>Below Caution range</strong>, <strong>Caution</strong>, <strong>Extreme Caution</strong>, <strong>Danger</strong>, and <strong>Extreme Danger</strong>.
            </p>
            <p className="text-[#333] leading-relaxed">
              Where the heat index is not meaningful (temperatures below 20°C / 68°F) or data is missing, the system displays <strong>not applicable</strong>. All operational activity rules must come from approved school policy, not general references.
            </p>
          </div>
        </div>

        <div className="p-3.5 bg-gray-50 rounded-lg border border-gray-200 text-xs space-y-2">
          <h4 className="font-bold text-[#1A1A1A]">Rule Hierarchy & Decision Precedence:</h4>
          <p className="text-[#4A4F57] leading-relaxed">
            When multiple thresholds are simultaneously triggered (e.g. Extreme Heat Index + Elevated Dust), the system applies strict safety precedence:
            <br />
            <span className="font-semibold text-red-700">Cancel / Move Indoors</span> takes precedence over <span className="font-semibold text-amber-700">Shorten / Restrict</span>, which takes precedence over <span className="font-semibold text-emerald-700">Normal Outdoor Activity</span>.
            DustWatch always explains exactly which condition triggered the recommendation.
          </p>
        </div>
      </section>

      {/* 3. Data Sources & Transparency Matrix */}
      <section className="bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-sm space-y-4">
        <h2 className="text-base font-bold text-[#1A1A1A] flex items-center gap-2">
          <Database className="w-4 h-4 text-blue-700" />
          <span>Data Sources & Model Provenance Matrix</span>
        </h2>
        <p className="text-sm text-[#1A1A1A] leading-relaxed">
          Full scientific transparency regarding the operational data feeds, physical sensors, and reanalysis models utilized across DustWatch:
        </p>

        <div className="overflow-x-auto border border-[#D5D9DF] rounded-lg">
          <table className="w-full text-xs text-left">
            <thead className="bg-gray-50 border-b border-[#D5D9DF] text-[#1A1A1A]">
              <tr>
                <th className="py-2.5 px-3 font-bold">Data Feed / System</th>
                <th className="py-2.5 px-3 font-bold">Parameters / Variables</th>
                <th className="py-2.5 px-3 font-bold">Nature / Model Provenance</th>
                <th className="py-2.5 px-3 font-bold">Role in DustWatch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              <tr className="hover:bg-gray-50">
                <td className="py-2.5 px-3 font-semibold text-blue-900">Open-Meteo Weather API</td>
                <td className="py-2.5 px-3">Temperature, Relative Humidity, Wind Speed, Wind Gusts, Wind Direction, Visibility</td>
                <td className="py-2.5 px-3">Open-Meteo weather model forecast (model selection varies)</td>
                <td className="py-2.5 px-3">Atmospheric forcing for dust transport, convective gust scoring & Heat Index</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="py-2.5 px-3 font-semibold text-amber-900">Open-Meteo Air Quality API</td>
                <td className="py-2.5 px-3">PM10, PM2.5, Dust Concentration, Aerosol Optical Depth (AOD @ 550nm)</td>
                <td className="py-2.5 px-3 text-amber-800 font-medium">Chemical transport model forecasts (Copernicus CAMS). Model-derived, NOT live ground-level optical monitors.</td>
                <td className="py-2.5 px-3">Particulate loading for 12-hour dust scoring and school policy checks</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="py-2.5 px-3 font-semibold text-purple-900">NASA Earthdata & Worldview</td>
                <td className="py-2.5 px-3">True-color imagery & Corrected Reflectance (MODIS Terra/Aqua, VIIRS SNPP/NOAA-20)</td>
                <td className="py-2.5 px-3">Spaceborne polar-orbiting satellite optical radiometer sensors</td>
                <td className="py-2.5 px-3">Contextual verification link for visual tracking of synoptic dust plumes (not scored)</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="py-2.5 px-3 font-semibold text-emerald-900">NASA MERRA-2 Reanalysis</td>
                <td className="py-2.5 px-3 font-mono">DUCMASS (Dust column mass density, kg/m²), TOTEXTTAU (Aerosol optical thickness extinction @ 550nm)</td>
                <td className="py-2.5 px-3">Global atmospheric reanalysis incorporating Goddard Earth Observing System (GEOS-5)</td>
                <td className="py-2.5 px-3">Historical dust climatology reference context for independent offline event labelling (not live ground truth)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="p-3 bg-amber-50 rounded-md border border-amber-200 text-xs text-amber-950 space-y-1">
          <p>
            <strong>Critical Sensor vs. Model Distinction:</strong> PM10 and PM2.5 fields from open APIs are model-based atmospheric chemistry simulations. They represent total particulate matter from all sources (including combustion, sea spray, and construction), not dust exclusively.
          </p>
          <p>
            <strong>Provisional Calibration:</strong> All thresholds and weights are provisional student team starting points. They have not been clinically or meteorologically validated by government health authorities.
          </p>
        </div>
      </section>

      {/* 4. What DustWatch Predicts and Does Not */}
      <section className="bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-sm space-y-4">
        <h2 className="text-base font-bold text-[#1A1A1A] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <span>{STRINGS.howItWorks.predictsTitle}</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {STRINGS.howItWorks.predictsItems.map((item, idx) => (
            <div key={idx} className="p-3 rounded-md bg-gray-50 border border-gray-200">
              <h3 className="font-bold text-sm text-[#1A1A1A] mb-1">
                {item.title}
              </h3>
              <p className="text-xs text-[#4A4F57] leading-relaxed">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 5. Responsible AI Principles & Human Safety */}
      <section className="bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-sm space-y-3">
        <h2 className="text-base font-bold text-[#1A1A1A] flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-700" />
          <span>{STRINGS.howItWorks.responsibleTitle}</span>
        </h2>
        <p className="text-sm text-[#1A1A1A] leading-relaxed">
          {STRINGS.howItWorks.responsibleDesc}
        </p>
        <div className="pt-2">
          <a
            href={STRINGS.disclaimer.ncmUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:text-blue-900 underline"
          >
            <span>Visit the UAE National Center of Meteorology (NCM)</span>
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </section>

      {/* 6. What Gemini Does vs. What the Team Built */}
      <section className="bg-white border border-[#D5D9DF] rounded-lg p-5 shadow-sm space-y-3">
        <h2 className="text-base font-bold text-[#1A1A1A] flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-blue-600" />
          <span>{STRINGS.howItWorks.geminiTitle}</span>
        </h2>
        <p className="text-sm text-[#1A1A1A] leading-relaxed">
          {STRINGS.howItWorks.geminiDesc}
        </p>
      </section>
    </div>
  );
};
