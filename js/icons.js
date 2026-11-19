/** Google Weather icon URLs, with a small offline SVG fallback. */

const ICON_BY_TYPE = {
  CLEAR: "sunny",
  MOSTLY_CLEAR: "mostly_sunny",
  PARTLY_CLOUDY: "partly_cloudy",
  MOSTLY_CLOUDY: "mostly_cloudy",
  CLOUDY: "cloudy",
  WINDY: "cloudy",
  WIND_AND_RAIN: "showers",
  LIGHT_RAIN_SHOWERS: "drizzle",
  CHANCE_OF_SHOWERS: "scattered_showers",
  SCATTERED_SHOWERS: "scattered_showers",
  RAIN_SHOWERS: "showers",
  HEAVY_RAIN_SHOWERS: "showers",
  LIGHT_TO_MODERATE_RAIN: "drizzle",
  MODERATE_TO_HEAVY_RAIN: "showers",
  RAIN: "showers",
  LIGHT_RAIN: "drizzle",
  HEAVY_RAIN: "showers",
  RAIN_PERIODICALLY_HEAVY: "showers",
  LIGHT_SNOW_SHOWERS: "flurries",
  CHANCE_OF_SNOW_SHOWERS: "flurries",
  SCATTERED_SNOW_SHOWERS: "snow_showers",
  SNOW_SHOWERS: "snow_showers",
  HEAVY_SNOW_SHOWERS: "heavy_snow",
  LIGHT_TO_MODERATE_SNOW: "snow_showers",
  MODERATE_TO_HEAVY_SNOW: "heavy_snow",
  SNOW: "snow_showers",
  LIGHT_SNOW: "flurries",
  HEAVY_SNOW: "heavy_snow",
  SNOWSTORM: "blowing_snow",
  SNOW_PERIODICALLY_HEAVY: "heavy_snow",
  HEAVY_SNOW_STORM: "blowing_snow",
  BLOWING_SNOW: "blowing_snow",
  RAIN_AND_SNOW: "wintry_mix",
  HAIL: "wintry_mix",
  HAIL_SHOWERS: "wintry_mix",
  THUNDERSTORM: "isolated_tstorms",
  THUNDERSHOWER: "isolated_tstorms",
  LIGHT_THUNDERSTORM_RAIN: "isolated_tstorms",
  SCATTERED_THUNDERSTORMS: "isolated_tstorms",
  HEAVY_THUNDERSTORM: "strong_tstorms",
};

export function iconSlug(condition, isDaytime = true) {
  const type = condition?.type || "";
  if (!isDaytime && (type === "CLEAR" || type === "MOSTLY_CLEAR")) {
    return type === "CLEAR" ? "clear" : "mostly_clear";
  }
  return ICON_BY_TYPE[type] || "partly_cloudy";
}

export function iconUrl(condition, { isDaytime = true, dark = false } = {}) {
  const base = condition?.iconBaseUri;
  if (base) return `${dark ? `${base}_dark` : base}.svg`;
  const slug = iconSlug(condition, isDaytime);
  return `https://maps.gstatic.com/weather/v1/${slug}${dark ? "_dark" : ""}.svg`;
}

export function fallbackIconSvg(type = "") {
  const name = String(type);
  const storm = /THUNDER/.test(name);
  const snow = /SNOW|HAIL|SLEET/.test(name);
  const rain = /RAIN|SHOWER|DRIZZLE/.test(name);
  const cloud = /CLOUD|FOG|MIST|DUST|SMOKE/.test(name) || rain || snow || storm;
  const sun = !cloud || /PARTLY|MOSTLY_CLEAR|CLEAR/.test(name);
  const parts = [];
  if (sun && !storm) {
    parts.push(`<circle cx="16" cy="15" r="5" fill="#f0a14a"/>`);
  }
  if (cloud) {
    parts.push(`<path d="M10 24h14a5 5 0 0 0 .4-10 6.5 6.5 0 0 0-12.4 1.6A4.2 4.2 0 0 0 10 24z" fill="#d7dee8"/>`);
  }
  if (rain || storm) {
    parts.push(`<path d="M13 27l-1.2 3M18 27l-1.2 3M23 27l-1.2 3" stroke="#3d6f9a" stroke-width="1.6" stroke-linecap="round"/>`);
  }
  if (snow) {
    parts.push(`<path d="M14 28h.1M19 30h.1M23 28h.1" stroke="#d7dee8" stroke-width="2.4" stroke-linecap="round"/>`);
  }
  if (!sun && !cloud) {
    parts.push(`<circle cx="18" cy="18" r="6" fill="#f0a14a"/>`);
  }
  return `<svg class="wx-fallback" viewBox="0 0 36 36" aria-hidden="true">${parts.join("")}</svg>`;
}
