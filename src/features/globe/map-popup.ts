import mapboxgl from 'mapbox-gl';

const FONT = "font-family: 'Plus Jakarta Sans', sans-serif";

/** Nicknames and vendor strings are user-controlled and rendered via setHTML. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeColor(value: string | undefined): string {
  return value !== undefined && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value
    : '#B4B4B4';
}

export const MAP_POPUP_CLASS = 'device-popup';

export function mapPopupRow(
  label: string,
  value: string,
  valueColor = '#B4B4B4',
): string {
  return `<p style="margin: 6px 0;"><span style="${FONT}; font-weight: 700; font-size: 12px; line-height: 18px; color: #FFFFFF;">${escapeHtml(label)}:</span> <span style="${FONT}; font-weight: 400; font-size: 12px; line-height: 18px; color: ${safeColor(valueColor)};">${escapeHtml(value)}</span></p>`;
}

export function createStyledMapPopup({
  map,
  coordinates,
  title,
  subtitle,
  fields,
  linkHref,
  linkLabel,
}: {
  map: mapboxgl.Map;
  coordinates: [number, number];
  title: string;
  subtitle?: string;
  fields: {
    label: string;
    value?: string | number | null;
    valueColor?: string;
  }[];
  linkHref?: string;
  linkLabel?: string;
}): mapboxgl.Popup {
  const fieldsHtml = fields
    .filter((field) => field.value != null && String(field.value).trim() !== '')
    .map((field) =>
      mapPopupRow(field.label, String(field.value), field.valueColor),
    )
    .join('');

  const subtitleHtml =
    subtitle !== undefined
      ? `<h4 style="${FONT}; font-weight: 700; font-size: 12px; line-height: 18px; color: #FFFFFF; margin: 0 0 8px 0;">${escapeHtml(subtitle)}</h4>`
      : '';

  const safeHref =
    linkHref !== undefined &&
    linkHref.startsWith('/') &&
    !linkHref.startsWith('//')
      ? escapeHtml(linkHref)
      : null;
  const linkHtml =
    safeHref !== null && linkLabel !== undefined
      ? `<a href="${safeHref}" style="display: block; margin: 12px 0 0; ${FONT}; font-size: 12px; font-weight: 700; color: #B7EE65; text-decoration: underline;">${escapeHtml(linkLabel)}</a>`
      : '';

  return new mapboxgl.Popup({ offset: 25, className: MAP_POPUP_CLASS })
    .setLngLat(coordinates)
    .setHTML(
      `<h3 style="${FONT}; font-weight: 700; font-size: 14px; line-height: 20px; color: #B7EE65; margin: 0 0 12px 0;">${escapeHtml(title)}</h3>
       <div style="width: 100%; height: 1px; background-color: #B7EE65; margin: 0 0 12px 0;"></div>
       ${subtitleHtml}
       ${fieldsHtml}
       ${linkHtml}`,
    )
    .addTo(map);
}
