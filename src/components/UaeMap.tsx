/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import {
  AlertTriangle,
  Layers,
  Radio,
  RefreshCw,
  Sun,
  Thermometer,
  Wind,
} from 'lucide-react';
import { APP_CONFIG, CITIES } from '../config.ts';
import { CityOutlook, RiskCategory } from '../types.ts';
import {
  AEROSOL_INDEX_LEVELS,
  AOD_LEVELS,
  AerosolCellData,
  AerosolDetectionConfig,
  AirQualityCellData,
  AirQualityMetric,
  GridCell,
  OverlayDataResult,
  OverlayType,
  TemperatureCellData,
  UAE_GRID_CELLS,
  UAE_RASTER_BOUNDS,
  fetchGridAerosol,
  fetchGridAirQuality,
  fetchGridTemperature,
  generateRasterDataUrl,
  getAerosolDetectionConfig,
  getAirQualityColor,
  getAodColor,
  getTemperatureColor,
  interpolateValueAtPoint,
} from '../overlayService.ts';

interface UaeMapProps {
  outlooks: Record<string, CityOutlook>;
  selectedCityId: string;
  onSelectCity: (cityId: string) => void;
  viewMode: 'highest12h' | 'now';
}

export const UaeMap: React.FC<UaeMapProps> = ({
  outlooks,
  selectedCityId,
  onSelectCity,
  viewMode,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const imageOverlayRef = useRef<L.ImageOverlay | null>(null);
  const aerosolTileLayerRef = useRef<L.TileLayer | null>(null);
  const tileLayerClipCleanupRef = useRef<(() => void) | null>(null);

  // Active overlay state
  const [activeOverlay, setActiveOverlay] = useState<OverlayType>('none');
  const [aqMetric, setAqMetric] = useState<AirQualityMetric>('us_aqi');
  const [isLoadingOverlay, setIsLoadingOverlay] = useState<boolean>(false);
  const [overlayError, setOverlayError] = useState<string | null>(null);

  // Hover sampling coordinates
  const [hoverSample, setHoverSample] = useState<{
    lat: number;
    lon: number;
    valText: string;
    categoryText: string;
    metricLabel: string;
  } | null>(null);

  // Fetched data caches in component state
  const [tempData, setTempData] = useState<OverlayDataResult<TemperatureCellData> | null>(null);
  const [aqData, setAqData] = useState<OverlayDataResult<AirQualityCellData> | null>(null);
  const [aerosolData, setAerosolData] = useState<OverlayDataResult<AerosolCellData> | null>(null);
  const [aerosolMeta, setAerosolMeta] = useState<AerosolDetectionConfig | null>(null);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [24.3, 54.6],
      zoom: 7,
      minZoom: 6,
      maxZoom: 11,
      scrollWheelZoom: true,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      if (tileLayerClipCleanupRef.current) {
        tileLayerClipCleanupRef.current();
        tileLayerClipCleanupRef.current = null;
      }
      map.remove();
      mapInstanceRef.current = null;
      imageOverlayRef.current = null;
      aerosolTileLayerRef.current = null;
    };
  }, []);

  // Update city markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    Object.values(markersRef.current).forEach((m) => m.remove());
    markersRef.current = {};

    CITIES.forEach((city) => {
      const outlook = outlooks[city.id];
      const category: RiskCategory = outlook
        ? viewMode === 'highest12h'
          ? outlook.peakLevel
          : outlook.levelNow
        : 'Low';

      const colorCfg = APP_CONFIG.colors[category];
      const isSelected = city.id === selectedCityId;

      const markerHtml = `
        <div class="relative flex flex-col items-center group cursor-pointer focus:outline-none" role="button" tabindex="0" aria-label="${city.name}, Risk: ${category}">
          <div
            style="background-color: ${colorCfg.bg}; color: ${colorCfg.text}; border: ${isSelected ? '3px solid #1A56DB' : '2px solid white'};"
            class="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-md transition-transform transform ${
              isSelected ? 'scale-125 ring-4 ring-blue-500/30' : 'hover:scale-110'
            }"
          >
            ${colorCfg.abbr}
          </div>
          ${
            isSelected
              ? `<div class="mt-1 bg-white/95 text-[#1A1A1A] border border-[#D5D9DF] px-2 py-0.5 rounded shadow text-xs font-semibold whitespace-nowrap">
                   ${city.name}: ${category}
                 </div>`
              : `<div class="mt-0.5 bg-black/60 text-white px-1.5 py-0.2 rounded text-[10px] font-medium hidden group-hover:block whitespace-nowrap">
                   ${city.name}
                 </div>`
          }
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'custom-city-marker',
        html: markerHtml,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });

      const marker = L.marker([city.latitude, city.longitude], {
        icon: customIcon,
        riseOnHover: true,
        zIndexOffset: 1000, // City markers remain elevated on top of all raster/grid overlays
        alt: `${city.name} ${category}`,
      });

      const popupContent = `
        <div style="font-family: inherit; min-width: 150px; padding: 2px;">
          <div style="font-weight: 700; font-size: 13px; color: #1A1A1A; margin-bottom: 4px;">
            ${city.name}
          </div>
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
            <span style="background-color: ${colorCfg.bg}; color: ${colorCfg.text}; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 11px;">
              ${category} Risk
            </span>
            <span style="font-size: 11px; color: #4A4F57;">
              Score: ${outlook ? Math.round(viewMode === 'highest12h' ? outlook.peakScore : outlook.scoreNow) : 'N/A'}/100
            </span>
          </div>
          ${outlook ? `
            <div style="font-size: 11px; color: #4A4F57; border-top: 1px solid #E5E7EB; padding-top: 4px; line-height: 1.4;">
              <div><strong>Now:</strong> ${outlook.levelNow} (${Math.round(outlook.scoreNow)})</div>
              <div><strong>12h Peak:</strong> ${outlook.peakLevel} (${Math.round(outlook.peakScore)}) @ ${outlook.peakHourTime}</div>
            </div>
          ` : ''}
        </div>
      `;
      marker.bindPopup(popupContent, { offset: [0, -10] });

      marker.on('click', () => {
        onSelectCity(city.id);
      });

      marker.addTo(map);
      markersRef.current[city.id] = marker;
    });
  }, [outlooks, selectedCityId, viewMode, onSelectCity]);

  // Load overlay data when activeOverlay changes
  const loadOverlayData = useCallback(async (overlay: OverlayType) => {
    setOverlayError(null);
    setHoverSample(null);
    if (overlay === 'none') {
      return;
    }

    setIsLoadingOverlay(true);
    try {
      if (overlay === 'temperature') {
        const data = await fetchGridTemperature();
        setTempData(data);
      } else if (overlay === 'air_quality') {
        const data = await fetchGridAirQuality();
        setAqData(data);
      } else if (overlay === 'aerosol') {
        const aerosolConfig = getAerosolDetectionConfig();
        setAerosolMeta(aerosolConfig);
        const data = await fetchGridAerosol();
        const validCells = data.cells.filter((c) => c.status === 'ok' && c.aod !== null);
        if (validCells.length === 0) {
          setAerosolData(null);
          setOverlayError('Aerosol Optical Depth (AOD) data is currently unavailable. No synthetic data is displayed.');
        } else {
          setAerosolData(data);
        }
      } else if (overlay === 'satellite_omps') {
        const aerosolConfig = getAerosolDetectionConfig();
        setAerosolMeta(aerosolConfig);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load overlay';
      setOverlayError(msg);
    } finally {
      setIsLoadingOverlay(false);
    }
  }, []);

  useEffect(() => {
    loadOverlayData(activeOverlay);
  }, [activeOverlay, loadOverlayData]);

  // Render continuous raster or aerosol satellite layers onto Leaflet
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // 0. Clean up previous tile layer clipping listeners if present
    if (tileLayerClipCleanupRef.current) {
      tileLayerClipCleanupRef.current();
      tileLayerClipCleanupRef.current = null;
    }

    // 1. Remove previous continuous image overlay if present
    if (imageOverlayRef.current) {
      imageOverlayRef.current.remove();
      imageOverlayRef.current = null;
    }

    // 2. Remove previous aerosol tile layer if present
    if (aerosolTileLayerRef.current) {
      aerosolTileLayerRef.current.remove();
      aerosolTileLayerRef.current = null;
    }

    // 3. Render according to active overlay
    if (activeOverlay === 'aerosol' && aerosolData) {
      const points = aerosolData.cells.map((c) => ({
        lat: c.lat,
        lon: c.lon,
        value: c.aod,
      }));

      const dataUrl = generateRasterDataUrl(points, 'aerosol', 280, 200, UAE_RASTER_BOUNDS);
      if (dataUrl) {
        const overlay = L.imageOverlay(dataUrl, UAE_RASTER_BOUNDS, {
          opacity: 0.72,
          interactive: false,
        });
        overlay.addTo(map);
        imageOverlayRef.current = overlay;
      }
    } else if (activeOverlay === 'temperature' && tempData) {
      // Build continuous raster canvas
      const points = tempData.cells.map((c) => ({
        lat: c.lat,
        lon: c.lon,
        value: c.temperatureC,
      }));

      const dataUrl = generateRasterDataUrl(points, 'temperature', 280, 200, UAE_RASTER_BOUNDS);
      if (dataUrl) {
        const overlay = L.imageOverlay(dataUrl, UAE_RASTER_BOUNDS, {
          opacity: 0.72,
          interactive: false,
        });
        overlay.addTo(map);
        imageOverlayRef.current = overlay;
      }
    } else if (activeOverlay === 'air_quality' && aqData) {
      // Extract values according to selected air quality metric
      const points = aqData.cells.map((c) => {
        let val: number | null = null;
        if (aqMetric === 'us_aqi') val = c.usAqi;
        else if (aqMetric === 'pm10') val = c.pm10;
        else if (aqMetric === 'pm2_5') val = c.pm2_5;
        else if (aqMetric === 'european_aqi') val = c.europeanAqi;
        return { lat: c.lat, lon: c.lon, value: val };
      });

      const dataUrl = generateRasterDataUrl(points, aqMetric, 280, 200, UAE_RASTER_BOUNDS);
      if (dataUrl) {
        const overlay = L.imageOverlay(dataUrl, UAE_RASTER_BOUNDS, {
          opacity: 0.74,
          interactive: false,
        });
        overlay.addTo(map);
        imageOverlayRef.current = overlay;
      }
    } else if (activeOverlay === 'satellite_omps' && aerosolMeta) {
      const tileLayer = L.tileLayer(aerosolMeta.tileUrl, {
        opacity: 0.65,
        maxNativeZoom: aerosolMeta.maxNativeZoom,
        maxZoom: aerosolMeta.maxZoom,
        minZoom: aerosolMeta.minZoom,
        tileSize: aerosolMeta.tileSize,
        attribution: aerosolMeta.attribution,
        zIndex: 2,
        bounds: aerosolMeta.bounds,
      });
      tileLayer.addTo(map);
      aerosolTileLayerRef.current = tileLayer;

      // Restrict displayed layer strictly to the UAE region using geographic clipping
      const updateClip = () => {
        const container = tileLayer.getContainer();
        if (!container || !mapInstanceRef.current) return;
        const currentMap = mapInstanceRef.current;
        const [[south, west], [north, east]] = aerosolMeta.bounds;
        const nw = currentMap.latLngToLayerPoint([north, west]);
        const se = currentMap.latLngToLayerPoint([south, east]);
        const clipVal = `polygon(${nw.x}px ${nw.y}px, ${se.x}px ${nw.y}px, ${se.x}px ${se.y}px, ${nw.x}px ${se.y}px)`;
        container.style.clipPath = clipVal;
        (container.style as unknown as { webkitClipPath?: string }).webkitClipPath = clipVal;
      };

      updateClip();
      map.on('move', updateClip);
      map.on('zoom', updateClip);
      map.on('viewreset', updateClip);

      const cleanup = () => {
        map.off('move', updateClip);
        map.off('zoom', updateClip);
        map.off('viewreset', updateClip);
      };
      tileLayerClipCleanupRef.current = cleanup;
    }

    return () => {
      if (tileLayerClipCleanupRef.current) {
        tileLayerClipCleanupRef.current();
        tileLayerClipCleanupRef.current = null;
      }
    };
  }, [activeOverlay, aqMetric, tempData, aqData, aerosolData, aerosolMeta]);

  // Interactive mouse sampling over continuous raster
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (activeOverlay !== 'temperature' && activeOverlay !== 'air_quality' && activeOverlay !== 'aerosol') {
      setHoverSample(null);
      return;
    }

    const handleMouseMove = (e: L.LeafletMouseEvent) => {
      const { lat, lng: lon } = e.latlng;
      const [[south, west], [north, east]] = UAE_RASTER_BOUNDS;

      if (lat < south || lat > north || lon < west || lon > east) {
        setHoverSample(null);
        return;
      }

      if (activeOverlay === 'temperature' && tempData) {
        const points = tempData.cells.map((c) => ({
          lat: c.lat,
          lon: c.lon,
          value: c.temperatureC,
        }));
        const val = interpolateValueAtPoint(lat, lon, points, 1.35, 2);
        if (val !== null) {
          const color = getTemperatureColor(val);
          setHoverSample({
            lat,
            lon,
            valText: `${Math.round(val * 10) / 10} °C`,
            categoryText: color.label,
            metricLabel: '2m Ambient Temperature',
          });
        } else {
          setHoverSample(null);
        }
      } else if (activeOverlay === 'air_quality' && aqData) {
        let unit = '';
        let label = 'US EPA AQI';
        const points = aqData.cells.map((c) => {
          let v: number | null = null;
          if (aqMetric === 'us_aqi') { v = c.usAqi; unit = 'AQI'; label = 'US EPA AQI'; }
          else if (aqMetric === 'pm10') { v = c.pm10; unit = 'µg/m³'; label = 'PM10 Particulate'; }
          else if (aqMetric === 'pm2_5') { v = c.pm2_5; unit = 'µg/m³'; label = 'PM2.5 Particles'; }
          else if (aqMetric === 'european_aqi') { v = c.europeanAqi; unit = 'EAQI'; label = 'European AQI'; }
          return { lat: c.lat, lon: c.lon, value: v };
        });

        const val = interpolateValueAtPoint(lat, lon, points, 1.35, 2);
        if (val !== null) {
          const rounded = Math.round(val * 10) / 10;
          const color = getAirQualityColor(aqMetric, rounded);
          setHoverSample({
            lat,
            lon,
            valText: `${rounded} ${unit}`,
            categoryText: color.category,
            metricLabel: label,
          });
        } else {
          setHoverSample(null);
        }
      } else if (activeOverlay === 'aerosol' && aerosolData) {
        const points = aerosolData.cells.map((c) => ({
          lat: c.lat,
          lon: c.lon,
          value: c.aod,
        }));
        const val = interpolateValueAtPoint(lat, lon, points, 1.35, 2);
        if (val !== null) {
          const rounded = Math.round(val * 100) / 100;
          const color = getAodColor(rounded);
          setHoverSample({
            lat,
            lon,
            valText: `${rounded.toFixed(2)} AOD`,
            categoryText: color.label,
            metricLabel: 'Aerosol Optical Depth (550nm)',
          });
        } else {
          setHoverSample(null);
        }
      }
    };

    map.on('mousemove', handleMouseMove);
    return () => {
      map.off('mousemove', handleMouseMove);
    };
  }, [activeOverlay, aqMetric, tempData, aqData, aerosolData]);

  return (
    <div className="relative w-full rounded-lg overflow-hidden border border-[#D5D9DF] bg-[#EAEDF1] shadow-sm flex flex-col">
      {/* 1. Interactive Layer Selector Bar */}
      <div className="bg-white border-b border-[#D5D9DF] p-2.5 z-20 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-[#1A1A1A] flex items-center gap-1 mr-1">
            <Layers className="w-4 h-4 text-blue-700" />
            <span>Overlays:</span>
          </span>

          <button
            type="button"
            onClick={() => setActiveOverlay('none')}
            className={`px-2.5 py-1.5 rounded-md font-semibold transition-colors cursor-pointer ${
              activeOverlay === 'none'
                ? 'bg-blue-700 text-white shadow-xs'
                : 'bg-gray-100 text-[#4A4F57] hover:bg-gray-200 hover:text-[#1A1A1A]'
            }`}
          >
            Standard Risk Markers
          </button>

          <button
            type="button"
            onClick={() => setActiveOverlay('temperature')}
            className={`px-2.5 py-1.5 rounded-md font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
              activeOverlay === 'temperature'
                ? 'bg-blue-700 text-white shadow-xs'
                : 'bg-gray-100 text-[#4A4F57] hover:bg-gray-200 hover:text-[#1A1A1A]'
            }`}
          >
            <Thermometer className="w-3.5 h-3.5 text-amber-500" />
            <span>Continuous Temperature (°C)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveOverlay('air_quality')}
            className={`px-2.5 py-1.5 rounded-md font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
              activeOverlay === 'air_quality'
                ? 'bg-blue-700 text-white shadow-xs'
                : 'bg-gray-100 text-[#4A4F57] hover:bg-gray-200 hover:text-[#1A1A1A]'
            }`}
          >
            <Wind className="w-3.5 h-3.5 text-purple-600" />
            <span>Continuous Air Quality Heatmap</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveOverlay('aerosol')}
            className={`px-2.5 py-1.5 rounded-md font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
              activeOverlay === 'aerosol'
                ? 'bg-blue-700 text-white shadow-xs'
                : 'bg-gray-100 text-[#4A4F57] hover:bg-gray-200 hover:text-[#1A1A1A]'
            }`}
          >
            <Radio className="w-3.5 h-3.5 text-emerald-600" />
            <span>Aerosol Detection (CAMS AOD)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveOverlay('satellite_omps')}
            className={`px-2.5 py-1.5 rounded-md font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
              activeOverlay === 'satellite_omps'
                ? 'bg-blue-700 text-white shadow-xs'
                : 'bg-gray-100 text-[#4A4F57] hover:bg-gray-200 hover:text-[#1A1A1A]'
            }`}
          >
            <Sun className="w-3.5 h-3.5 text-amber-600" />
            <span>NASA OMPS Satellite Index</span>
          </button>
        </div>

        {/* Loading Indicator */}
        <div className="flex items-center gap-2">
          {isLoadingOverlay && (
            <span className="flex items-center gap-1 text-[11px] text-blue-700 font-semibold bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>
                {activeOverlay === 'aerosol'
                  ? 'Loading Copernicus CAMS AOD continuous raster...'
                  : activeOverlay === 'satellite_omps'
                  ? 'Configuring NASA OMPS satellite layer...'
                  : 'Generating continuous raster surface...'}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* 1b. Air Quality Metric Sub-selector (When Air Quality Overlay is Active) */}
      {activeOverlay === 'air_quality' && (
        <div className="bg-purple-50/70 border-b border-purple-200 px-3 py-1.5 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-purple-950 text-[11px]">Select Air Quality Metric:</span>
          <div className="inline-flex rounded-md p-0.5 bg-white border border-purple-200 gap-1">
            <button
              type="button"
              onClick={() => setAqMetric('us_aqi')}
              className={`px-2 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                aqMetric === 'us_aqi' ? 'bg-purple-700 text-white shadow-xs' : 'text-purple-950 hover:bg-purple-100'
              }`}
            >
              US EPA AQI (0–500)
            </button>
            <button
              type="button"
              onClick={() => setAqMetric('pm10')}
              className={`px-2 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                aqMetric === 'pm10' ? 'bg-purple-700 text-white shadow-xs' : 'text-purple-950 hover:bg-purple-100'
              }`}
            >
              PM10 (µg/m³)
            </button>
            <button
              type="button"
              onClick={() => setAqMetric('pm2_5')}
              className={`px-2 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                aqMetric === 'pm2_5' ? 'bg-purple-700 text-white shadow-xs' : 'text-purple-950 hover:bg-purple-100'
              }`}
            >
              PM2.5 (µg/m³)
            </button>
            <button
              type="button"
              onClick={() => setAqMetric('european_aqi')}
              className={`px-2 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                aqMetric === 'european_aqi' ? 'bg-purple-700 text-white shadow-xs' : 'text-purple-950 hover:bg-purple-100'
              }`}
            >
              European AQI (0–100)
            </button>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {overlayError && (
        <div className="bg-red-50 border-b border-red-300 p-2 text-xs text-red-900 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-red-700 shrink-0" />
            <span>{overlayError}</span>
          </div>
          <button
            type="button"
            onClick={() => loadOverlayData(activeOverlay)}
            className="px-2 py-0.5 bg-red-700 hover:bg-red-800 text-white rounded text-[11px] font-semibold cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* 2. Map Canvas Container */}
      <div className="relative w-full h-[380px] sm:h-[480px] md:h-[540px]">
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Live Hover Sample Badge (Bottom Left) */}
        {hoverSample && (
          <div className="absolute bottom-3 left-3 z-[1000] bg-white/95 backdrop-blur-sm border border-[#D5D9DF] rounded-md px-2.5 py-1.5 shadow-md text-xs pointer-events-none">
            <div className="text-[10px] text-[#4A4F57] uppercase tracking-wider font-semibold flex items-center gap-1">
              <span>Coordinate Sample ({hoverSample.lat.toFixed(2)}°N, {hoverSample.lon.toFixed(2)}°E)</span>
              <span className="text-gray-400">&bull;</span>
              <span className="text-gray-500 font-normal">Resampled Model</span>
            </div>
            <div className="font-bold text-[#1A1A1A] mt-0.5">
              {hoverSample.metricLabel}: <span className="text-blue-700">{hoverSample.valText}</span>
            </div>
            <div className="text-[11px] text-[#5F6368]">
              Classification: {hoverSample.categoryText}
            </div>
          </div>
        )}

        {/* Dynamic Map Legend Overlay (Top Right) */}
        <div className="absolute top-3 right-3 z-[1000] bg-white/95 backdrop-blur-sm border border-[#D5D9DF] rounded-md p-2.5 shadow-md text-xs max-w-[220px]">
          {activeOverlay === 'none' && (
            <div>
              <div className="font-semibold text-[#1A1A1A] mb-1.5">City Risk Levels</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                <div className="flex items-center gap-1.5">
                  <span
                    style={{ backgroundColor: APP_CONFIG.colors.Low.bg, color: APP_CONFIG.colors.Low.text }}
                    className="w-4 h-4 rounded-full flex items-center justify-center font-bold text-[10px]"
                  >
                    L
                  </span>
                  <span className="text-[#1A1A1A]">Low</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    style={{ backgroundColor: APP_CONFIG.colors.Moderate.bg, color: APP_CONFIG.colors.Moderate.text }}
                    className="w-4 h-4 rounded-full flex items-center justify-center font-bold text-[10px]"
                  >
                    M
                  </span>
                  <span className="text-[#1A1A1A]">Moderate</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    style={{ backgroundColor: APP_CONFIG.colors.High.bg, color: APP_CONFIG.colors.High.text }}
                    className="w-4 h-4 rounded-full flex items-center justify-center font-bold text-[10px]"
                  >
                    H
                  </span>
                  <span className="text-[#1A1A1A]">High</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    style={{ backgroundColor: APP_CONFIG.colors['Very High'].bg, color: APP_CONFIG.colors['Very High'].text }}
                    className="w-4 h-4 rounded-full flex items-center justify-center font-bold text-[10px]"
                  >
                    VH
                  </span>
                  <span className="text-[#1A1A1A]">Very High</span>
                </div>
              </div>
            </div>
          )}

          {activeOverlay === 'temperature' && (
            <div>
              <div className="font-bold text-[#1A1A1A] mb-1">Continuous Temperature (°C)</div>
              {/* Continuous Gradient Bar */}
              <div className="h-2.5 w-full rounded mb-1.5" style={{ background: 'linear-gradient(to right, #3b82f6, #06b6d4, #10b981, #f59e0b, #ea580c, #b91c1c)' }} />
              <div className="space-y-1 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-2.5 rounded" style={{ backgroundColor: '#3b82f6' }} />
                  <span>&lt; 20°C (Mild)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-2.5 rounded" style={{ backgroundColor: '#06b6d4' }} />
                  <span>20–25°C</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-2.5 rounded" style={{ backgroundColor: '#10b981' }} />
                  <span>26–31°C</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-2.5 rounded" style={{ backgroundColor: '#f59e0b' }} />
                  <span>32–37°C</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-2.5 rounded" style={{ backgroundColor: '#ea580c' }} />
                  <span>38–43°C</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-2.5 rounded" style={{ backgroundColor: '#b91c1c' }} />
                  <span>≥ 44°C (Extreme)</span>
                </div>
              </div>
            </div>
          )}

          {activeOverlay === 'air_quality' && (
            <div>
              <div className="font-bold text-[#1A1A1A] mb-1">
                {aqMetric === 'us_aqi' && 'US EPA AQI (0–500)'}
                {aqMetric === 'pm10' && 'PM10 Particulate (µg/m³)'}
                {aqMetric === 'pm2_5' && 'PM2.5 Particles (µg/m³)'}
                {aqMetric === 'european_aqi' && 'European AQI (0–100)'}
              </div>
              {/* Continuous Gradient Bar */}
              <div className="h-2.5 w-full rounded mb-1.5" style={{ background: 'linear-gradient(to right, #10b981, #facc15, #f97316, #ef4444, #8b5cf6, #881337)' }} />
              <div className="space-y-1 text-[11px]">
                {aqMetric === 'us_aqi' && (
                  <>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#10b981]" /><span>0–50 Good</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#facc15]" /><span>51–100 Moderate</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#f97316]" /><span>101–150 Sensitive</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#ef4444]" /><span>151–200 Unhealthy</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#8b5cf6]" /><span>201–300 Very Unhealthy</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#881337]" /><span>301+ Hazardous</span></div>
                  </>
                )}
                {aqMetric === 'pm10' && (
                  <>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#10b981]" /><span>0–50 µg/m³ Low</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#facc15]" /><span>51–100 Moderate</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#f97316]" /><span>101–250 Elevated</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#ef4444]" /><span>251–400 High</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#881337]" /><span>&gt; 400 Hazardous</span></div>
                  </>
                )}
                {aqMetric === 'pm2_5' && (
                  <>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#10b981]" /><span>0–12 µg/m³ Good</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#facc15]" /><span>12.1–35.4 Moderate</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#f97316]" /><span>35.5–55.4 Sensitive</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#ef4444]" /><span>55.5–150.4 Unhealthy</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#881337]" /><span>&gt; 150.4 Very Unhealthy</span></div>
                  </>
                )}
                {aqMetric === 'european_aqi' && (
                  <>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#10b981]" /><span>0–20 Good</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#84cc16]" /><span>21–40 Fair</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#facc15]" /><span>41–60 Moderate</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#f97316]" /><span>61–80 Poor</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded bg-[#ef4444]" /><span>81–100 Very Poor</span></div>
                  </>
                )}
              </div>
            </div>
          )}

          {activeOverlay === 'aerosol' && (
            <div>
              <div className="font-bold text-[#1A1A1A] mb-0.5">Aerosol Optical Depth (AOD)</div>
              <div className="text-[10px] text-[#5F6368] mb-1.5 font-medium">Copernicus CAMS Model (550nm)</div>
              {aerosolData ? (
                <>
                  {/* Continuous Gradient Bar */}
                  <div
                    className="h-2.5 w-full rounded mb-1.5"
                    style={{ background: 'linear-gradient(to right, #10b981, #84cc16, #facc15, #f97316, #ef4444, #881337)' }}
                  />
                  <div className="space-y-1 text-[11px]">
                    {AOD_LEVELS.map((lvl) => (
                      <div key={lvl.range} className="flex items-center gap-1.5">
                        <span className="w-3 h-2.5 rounded shrink-0" style={{ backgroundColor: lvl.color }} />
                        <span className="truncate"><strong>{lvl.range}:</strong> {lvl.label}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="p-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-900">
                  <div className="font-semibold">AOD Data Unavailable</div>
                  <div className="text-[10px] mt-0.5 text-amber-800">
                    Model aerosol extinction data could not be retrieved. No synthetic or substitute data is displayed.
                  </div>
                </div>
              )}
              <div className="mt-2 pt-1.5 border-t border-gray-200 text-[10px] text-[#5F6368] leading-tight">
                Column-integrated measure of light extinction. Indicates atmospheric aerosol loading aloft; not direct ground-level PM10 or surface dust concentration.
              </div>
            </div>
          )}

          {activeOverlay === 'satellite_omps' && (
            <div>
              <div className="font-bold text-[#1A1A1A] mb-0.5">NASA OMPS Aerosol Index</div>
              <div className="text-[10px] text-[#5F6368] mb-1.5 font-medium">Suomi-NPP Spaceborne Satellite</div>
              <div className="space-y-1 text-[11px]">
                {AEROSOL_INDEX_LEVELS.map((lvl) => (
                  <div key={lvl.range} className="flex items-center gap-1.5">
                    <span className="w-3 h-2.5 rounded shrink-0 border border-gray-300" style={{ backgroundColor: lvl.color }} />
                    <span className="truncate"><strong>{lvl.range}:</strong> {lvl.label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 pt-1.5 border-t border-gray-200 text-[10px] text-[#5F6368] leading-tight">
                UV Aerosol Index detects UV-absorbing particles (dust plumes & smoke aloft) across the atmospheric column. Does not quantify ground-level PM10 or surface dust.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. Bottom Layer Metadata, Timestamp & Scientific Attribution Bar */}
      <div className="bg-white border-t border-[#D5D9DF] p-3 text-xs text-[#4A4F57] space-y-1 z-20">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-[11px]">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-[#1A1A1A]">
              Active Layer:
            </span>
            <span className="px-1.5 py-0.2 rounded bg-gray-100 border text-[#1A1A1A] font-medium">
              {activeOverlay === 'none' && 'Ten City Risk Monitoring Stations'}
              {activeOverlay === 'temperature' && 'Full-Country Continuous 2m Temperature Forecast Heatmap'}
              {activeOverlay === 'air_quality' && `Full-Country Continuous Air Quality Heatmap: ${aqMetric.toUpperCase()}`}
              {activeOverlay === 'aerosol' && 'Copernicus CAMS Column Aerosol Optical Depth (AOD @ 550nm)'}
              {activeOverlay === 'satellite_omps' && 'NASA Suomi-NPP OMPS UV Aerosol Index (Satellite Observation)'}
            </span>
            <span className="text-[10px] text-gray-500">
              {activeOverlay === 'aerosol' ? '[Atmospheric Composition NWP Forecast (~0.4° Resampled)]' : activeOverlay === 'satellite_omps' ? '[Spaceborne Satellite Observation (Daily Level 3)]' : activeOverlay === 'none' ? '' : '[Atmospheric NWP / CAMS Model Forecast (Resampled)]'}
            </span>
          </div>

          <div className="text-[10px] text-[#717680]">
            {activeOverlay === 'temperature' && tempData && `Model Run: ${tempData.timestamp}`}
            {activeOverlay === 'air_quality' && aqData && `CAMS Model Run: ${aqData.timestamp}`}
            {activeOverlay === 'aerosol' && aerosolData && `CAMS Model Run: ${aerosolData.timestamp}`}
            {activeOverlay === 'satellite_omps' && aerosolMeta && `Daily Swath: ${aerosolMeta.dateString}`}
          </div>
        </div>

        {/* Clear source attribution, methodology and non-conflation disclaimer */}
        <p className="text-[11px] leading-relaxed text-[#5F6368] pt-1 border-t border-gray-100">
          {activeOverlay === 'none' && (
            <span>
              DustWatch monitors particulate and meteorological risk across 10 official UAE municipality coordinates. Select an overlay above to inspect continuous environmental heatmaps or aerosol detection.
            </span>
          )}
          {activeOverlay === 'temperature' && (
            <span>
              <strong>Attribution & Methodology:</strong> Data from Open-Meteo NWP Numerical Weather Prediction blend (ECMWF IFS / ICON). Native model resolution is ~0.4° (~40km); continuous IQAir-style visual surface is generated via Inverse Distance Weighting (IDW) spatial resampling. <em>Visual interpolation does not increase native physical sensor resolution.</em>
            </span>
          )}
          {activeOverlay === 'air_quality' && (
            <span>
              <strong>Attribution & Methodology:</strong> Atmospheric particulate dispersion model from Copernicus Atmosphere Monitoring Service (CAMS) via Open-Meteo. Native resolution is ~0.25°–0.4°; continuous gradient surface is rendered via IDW spatial resampling without rectangular cell seams. Distinguishes between US EPA AQI (0–500), European AQI (0–100), and PM mass concentrations. <em>Spatial resampling does not increase physical sensor resolution or replace micro-scale station observations.</em>
            </span>
          )}
          {activeOverlay === 'aerosol' && (
            <span className="text-amber-950 bg-amber-50/80 p-2 rounded border border-amber-200 block text-[11px] leading-relaxed">
              <strong>Atmospheric Aerosol Optical Depth (AOD @ 550nm):</strong> Derived from Copernicus Atmosphere Monitoring Service (CAMS) global aerosol models via Open-Meteo (~0.4° native resolution, ~40 km grid). Continuous surface is generated via Inverse Distance Weighting (IDW) spatial resampling across 36 UAE regional locations.
              <span className="block mt-1 font-medium text-amber-900">
                Scientific Limitations & Non-Conflation: Aerosol Optical Depth is a column-integrated, dimensionless optical measurement of light extinction by airborne aerosols (mineral dust, sea salt, sulfates) from surface to the top of the atmosphere. It is NOT a direct measurement of ground-level PM10 or PM2.5 concentrations, nor a micro-sensor reading. Spatial resampling illustrates regional gradients and does not increase native physical sensor resolution.
              </span>
            </span>
          )}
          {activeOverlay === 'satellite_omps' && (
            <span className="text-blue-950 bg-blue-50/80 p-2 rounded border border-blue-200 block text-[11px] leading-relaxed">
              <strong>Spaceborne Satellite Aerosol Index (NASA OMPS):</strong> Acquired daily by the Ozone Mapping and Profiler Suite (OMPS) aboard the Suomi-NPP satellite. Uses 340/378nm UV spectral contrast to observe absorbing aerosol plumes (mineral dust storms and elevated smoke). Native satellite tile resolution is GIBS Level 6 (~2 km equator / ~50 km sensor footprint); display at closer zoom levels uses client-side native zoom scaling and does not increase native spatial resolution.
              <span className="block mt-1 font-medium text-blue-900">
                Visualization & Scientific Limitations: Display is geographically clipped to the UAE monitoring region (22.5°N–26.3°N, 51.3°E–56.6°E) as a visualization choice aligning with national model outlooks; the spaceborne satellite observes a wider regional orbit. Aerosol Index is a qualitative spaceborne column indicator of UV-absorbing particles aloft. It does not identify chemical composition, nor does it quantify ground-level PM10 / PM2.5 concentrations or surface health hazard.
              </span>
            </span>
          )}
        </p>
      </div>
    </div>
  );
};
