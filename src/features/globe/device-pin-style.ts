import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type mapboxgl from 'mapbox-gl';
import { CarFront, Sun, Thermometer } from 'lucide-react';

import { logger } from '@/lib/logger/logger';

/**
 * Per-device-kind teardrop marker for the fleet map: kind-colored border,
 * near-black center disc, white icon glyph.
 *
 * `DeviceKind` maps 1:1 to the on-chain device-class taxonomy in
 * `device-types.ts` / `devices_device_type_check` — 'vehicle' is the only
 * kind this app's onboarding actually produces today; the rest are wired
 * up so a future device class renders correctly with no further pin work.
 */
export type DeviceKind =
  'vehicle' | 'charger' | 'solar' | 'thermostat' | 'battery';

export const KIND_COLOR: Record<DeviceKind, string> = {
  vehicle: '#22C55E',
  charger: '#86E05C',
  solar: '#F5B915',
  thermostat: '#2E9FE0',
  battery: '#F2802E',
};

// Brand green for vehicles only; other kinds use their KIND_COLOR.
export const ACTIVE_COLOR = '#B7EE65';

function pinColorForKind(kind: DeviceKind): string {
  return kind === 'vehicle' ? ACTIVE_COLOR : KIND_COLOR[kind];
}

export function deviceKindFromDeviceType(deviceType: string): DeviceKind {
  switch (deviceType) {
    case 'charger':
      return 'charger';
    case 'solar':
      return 'solar';
    case 'thermostat':
      return 'thermostat';
    case 'battery':
      return 'battery';
    default:
      return 'vehicle';
  }
}

// Teardrop pin geometry: 32x39 viewBox, core circle, glyph transform.
const PIN_VIEWBOX_W = 32;
const PIN_VIEWBOX_H = 39;
const PIN_PATH =
  'M15.8328 0C24.5771 0 31.6657 7.23112 31.6657 16.1512C31.6657 22.9904 27.4984 28.8369 21.6128 31.1923L16.7346 37.9942C16.6329 38.1366 16.4979 38.2528 16.341 38.333C16.184 38.4133 16.0097 38.4551 15.8328 38.4551C15.656 38.4551 15.4817 38.4133 15.3247 38.333C15.1678 38.2528 15.0328 38.1366 14.9311 37.9942L10.0528 31.1923C4.16725 28.8369 0 22.9904 0 16.1512C0 7.23112 7.08861 0 15.8328 0Z';
const PIN_CORE_FILL = '#0E0E0E';

const ICON_INTRINSIC_SIZE = 24;

const CHARGER_GLYPH =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_INTRINSIC_SIZE}" height="${ICON_INTRINSIC_SIZE}" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
  '<rect x="5" y="3" width="9" height="18" rx="1.5"/><path d="M7.5 6.5h4"/>' +
  '<path d="M10 10.4l-1.7 3.2h2.2L10.6 17"/>' +
  '<path d="M14 9h2.4A1.6 1.6 0 0 1 18 10.6V15a1.5 1.5 0 0 1-3 0v-2.2"/></svg>';

const BATTERY_GLYPH =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_INTRINSIC_SIZE}" height="${ICON_INTRINSIC_SIZE}" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
  '<rect x="2" y="7" width="17" height="10" rx="2"/>' +
  '<path d="M21 10v4"/><path d="M8 12h4l-1.5 2.5L12 12"/></svg>';

const ICON_COMPONENT: Record<
  Exclude<DeviceKind, 'charger' | 'battery'>,
  typeof CarFront
> = {
  vehicle: CarFront,
  solar: Sun,
  thermostat: Thermometer,
};

function glyphMarkup(kind: Exclude<DeviceKind, 'charger' | 'battery'>) {
  return renderToStaticMarkup(
    createElement(ICON_COMPONENT[kind], {
      width: ICON_INTRINSIC_SIZE,
      height: ICON_INTRINSIC_SIZE,
      color: '#ffffff',
      strokeWidth: 2.4,
    }),
  );
}

const GLYPH: Record<DeviceKind, string> = {
  vehicle: glyphMarkup('vehicle'),
  battery: BATTERY_GLYPH,
  solar: glyphMarkup('solar'),
  thermostat: glyphMarkup('thermostat'),
  charger: CHARGER_GLYPH,
};

function pinMarkup(kind: DeviceKind, renderWidth: number) {
  const renderHeight = Math.round(
    (renderWidth * PIN_VIEWBOX_H) / PIN_VIEWBOX_W,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${renderWidth}" height="${renderHeight}" viewBox="0 0 ${PIN_VIEWBOX_W} ${PIN_VIEWBOX_H}">
    <path fill-rule="evenodd" clip-rule="evenodd" fill="${pinColorForKind(kind)}" d="${PIN_PATH}"/>
    <circle cx="15.825" cy="16.155" r="12.82" fill="${PIN_CORE_FILL}"/>
    <g transform="translate(7.43 7.76) scale(0.7)">${GLYPH[kind]}</g>
  </svg>`;
}

const PIN_RASTER_WIDTH = 96;
const PIN_RASTER_HEIGHT = Math.round(
  (PIN_RASTER_WIDTH * PIN_VIEWBOX_H) / PIN_VIEWBOX_W,
);

export function devicePinIconId(kind: DeviceKind): string {
  return `device-pin-${kind}`;
}

// Mapbox `icon-image` expression: per-kind teardrop pin, keyed by
// `deviceType` (our `devices.device_type` column, copied onto each
// GeoJSON feature — see to-geojson.ts).
export function devicePinExpression(): mapboxgl.ExpressionSpecification {
  return [
    'match',
    ['get', 'deviceType'],
    'charger',
    devicePinIconId('charger'),
    'solar',
    devicePinIconId('solar'),
    'thermostat',
    devicePinIconId('thermostat'),
    'battery',
    devicePinIconId('battery'),
    devicePinIconId('vehicle'),
  ] as unknown as mapboxgl.ExpressionSpecification;
}

// Glow behind the pin — kind color per device, keyed by our own
// `deviceType` property (see to-geojson.ts).
export function deviceGlowColorExpression(): mapboxgl.ExpressionSpecification {
  return [
    'match',
    ['get', 'deviceType'],
    'charger',
    KIND_COLOR.charger,
    'solar',
    KIND_COLOR.solar,
    'thermostat',
    KIND_COLOR.thermostat,
    'battery',
    KIND_COLOR.battery,
    ACTIVE_COLOR,
  ] as unknown as mapboxgl.ExpressionSpecification;
}

export function devicePinSizeExpression(): mapboxgl.ExpressionSpecification {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    0,
    0.28,
    20,
    0.5,
  ] as mapboxgl.ExpressionSpecification;
}

// Circle clusters pick up globe lighting by default (emissive-strength 0)
// and dim toward the horizon. Symbol pins default to 1 (self-lit), so they
// stay fully bright at the edge unless they opt into the same lighting.
export const GLOBE_SYMBOL_LIGHTING = {
  'icon-emissive-strength': 0,
} as const;

export const GLOBE_TEXT_LIGHTING = {
  'text-emissive-strength': 0,
} as const;

const CLUSTER_KIND_PROPERTY: Record<Exclude<DeviceKind, 'vehicle'>, string> = {
  charger: 'charger_count',
  solar: 'solar_count',
  thermostat: 'thermostat_count',
  battery: 'battery_count',
};

function typeCountExpression(deviceType: string) {
  return ['+', ['case', ['==', ['get', 'deviceType'], deviceType], 1, 0]];
}

// Supercluster sums these so a cluster can keep the pin color of a
// single-kind group (solar-only, thermostat-only, …). Mixed groups fall
// back to the vehicle green in `deviceClusterColorExpression`.
export function deviceTypeClusterProperties(): Record<string, unknown> {
  return {
    charger_count: typeCountExpression('charger'),
    solar_count: typeCountExpression('solar'),
    thermostat_count: typeCountExpression('thermostat'),
    battery_count: typeCountExpression('battery'),
  };
}

export function deviceClusterColorExpression(): mapboxgl.ExpressionSpecification {
  return [
    'case',
    ['==', ['get', CLUSTER_KIND_PROPERTY.solar], ['get', 'point_count']],
    KIND_COLOR.solar,
    ['==', ['get', CLUSTER_KIND_PROPERTY.thermostat], ['get', 'point_count']],
    KIND_COLOR.thermostat,
    ['==', ['get', CLUSTER_KIND_PROPERTY.battery], ['get', 'point_count']],
    KIND_COLOR.battery,
    ['==', ['get', CLUSTER_KIND_PROPERTY.charger], ['get', 'point_count']],
    KIND_COLOR.charger,
    pinColorForKind('vehicle'),
  ] as unknown as mapboxgl.ExpressionSpecification;
}

function svgMarkupToImageData(
  svg: string,
  width: number,
  height: number,
): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const svg64 = window.btoa(unescape(encodeURIComponent(svg)));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(ctx.getImageData(0, 0, width, height));
    };
    img.onerror = () => reject(new Error('Failed to rasterize device pin SVG'));
    img.src = `data:image/svg+xml;base64,${svg64}`;
  });
}

// Idempotent: loads each per-kind pin into the map's sprite exactly once.
export function ensureDeviceKindIcons(map: mapboxgl.Map): void {
  const kinds = Object.keys(KIND_COLOR) as DeviceKind[];
  kinds.forEach((kind) => {
    const imageId = devicePinIconId(kind);
    if (map.hasImage(imageId)) {
      return;
    }
    svgMarkupToImageData(
      pinMarkup(kind, PIN_RASTER_WIDTH),
      PIN_RASTER_WIDTH,
      PIN_RASTER_HEIGHT,
    )
      .then((imageData) => {
        if (!map.hasImage(imageId)) {
          map.addImage(imageId, imageData);
        }
      })
      .catch((error: unknown) => {
        logger.warn('globe.device_pin_rasterize_failed', {
          imageId,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  });
}
